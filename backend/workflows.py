import json
import re
from fastapi import Depends
from . import store as s,jobs,network,upstream,gateway as g,library

_DRAFT_KINDS = {'studio_text_draft', 'studio_draft'}


def _live(owner, ident, kinds):
    obj = s.get(owner, ident)
    if obj['kind'] not in kinds or obj.get('archived') or obj.get('deleted'):
        raise s.Missing('对象不存在或无权访问')
    return obj


def _flow(owner, ident):
    return _live(owner, ident, {'studio_flow'})


def _draft_flow_ids(owner, obj):
    """Legacy references count as ownership until their flow is upgraded."""
    ids = {obj['flow_id']} if obj.get('flow_id') else set()
    ids.update(f['id'] for f in s.list_(owner, 'studio_flow') if f.get('last_draft') == obj['id'])
    return ids


def _draft_task_ids(owner, obj):
    ids = {obj[key] for key in ('task_id', 'origin_task_id') if obj.get(key)}
    ids.update(task['id'] for task in s.list_(owner, 'task')
               if obj['id'] in (task.get('media_outcomes') or {}).values())
    ids.update(j.get('task_id') or j.get('input', {}).get('task_id')
               for j in s.list_(owner, 'job')
               if (j.get('result') or {}).get('draft_id') == obj['id'])
    return ids - {None, ''}


def _task_draft(owner, obj):
    return bool(_draft_task_ids(owner, obj))


def _scope_objects(owner):
    # Only scope metadata crosses into Python. Historical bodies, messages and
    # inline media are not needed to recover bindings. Keep the same ordering
    # as list_ so legacy setdefault precedence is unchanged.
    fields = ('flow_id', 'origin_task_id', 'task_id', 'draft_id', 'studio_draft_id',
              'run_id', 'job_id', 'media_outcomes', 'asset_ids', 'status',
              'input_draft_id', 'input_task_id', 'result_content_id')
    paths = ["'$." + key + "'" for key in fields[:10]] + [
        "'$.input.draft_id'", "'$.input.task_id'", "'$.result.content_id'"]
    with s.conn() as c:
        rows = c.execute(
            'SELECT id,kind,version,json_extract(data,' + ','.join(paths) + ') AS scope '
            'FROM objects WHERE owner=? AND kind IN '
            "('studio_text_draft','studio_draft','task','job','studio_run','content','studio_asset') "
            'ORDER BY updated DESC', (owner,)).fetchall()
    return {row['id']: {**dict(zip(fields, json.loads(row['scope']))),
                       'id': row['id'], 'kind': row['kind'], 'version': row['version']}
            for row in rows}


def _latest_flow(owner):
    with s.conn() as c:
        row = c.execute('SELECT * FROM objects WHERE owner=? AND kind=? ORDER BY updated DESC LIMIT 1',
                        (owner, 'studio_flow')).fetchone()
    return s.unpack(row) if row else None


def _sync_flow_outputs(owner, flow_id=None):
    """Recover output scope from stored jobs/runs; provider task IDs are opaque."""
    objects = _scope_objects(owner)
    bindings = {ident: ('flow_id', obj['flow_id']) if obj.get('flow_id') else ('origin_task_id', obj['origin_task_id'])
                for ident, obj in objects.items() if obj['kind'] in _DRAFT_KINDS
                and (obj.get('flow_id') or obj.get('origin_task_id'))
                and (flow_id is None or obj.get('flow_id') == flow_id)}
    for obj in objects.values():
        if obj['kind'] == 'task' and flow_id is None:
            for ident in (obj.get('media_outcomes') or {}).values():
                bindings.setdefault(ident, ('origin_task_id', obj['id']))
    outputs = {}
    for obj in objects.values():
        if obj['kind'] not in {'job', 'studio_run'}:
            continue
        binding = bindings.get(obj.get('draft_id') or obj.get('input_draft_id'))
        if not binding or (obj['kind'] == 'job' and (obj.get('task_id') or obj.get('input_task_id'))):
            continue
        outputs[obj['id']] = binding
        if obj['kind'] == 'job' and obj.get('status') == 'done' and obj.get('result_content_id'):
            outputs[obj['result_content_id']] = binding
        if obj['kind'] == 'studio_run':
            outputs.update({ident: binding for ident in obj.get('asset_ids') or []})
    for obj in objects.values():
        if obj['kind'] not in {'content', 'studio_asset', 'job', 'studio_run'} or (obj['kind'] in {'content', 'job'} and obj.get('task_id')) or obj.get('origin_task_id'):
            continue
        binding = outputs.get(obj['id']) or outputs.get(obj.get('run_id')) or outputs.get(obj.get('job_id')) or bindings.get(obj.get('studio_draft_id') or obj.get('draft_id'))
        if binding and not obj.get('flow_id'):
            # Callers retain LOCK; fetch the full owned record only when writing
            # a repair, preserving content and optimistic version/history checks.
            obj = s.get(owner, obj['id'])
            s.put(owner, obj['kind'], {**obj, binding[0]: binding[1]}, obj['id'], obj['version'])


def _copy(owner, obj, flow_id):
    # Copies keep user-editable content and immutable media files, never task/run
    # associations, export paths, checks or generated-job histories.
    excluded = {'id', 'kind', 'version', 'updated', 'created', 'flow_id', 'task_id',
                'file', 'file_hash', 'file_missing', 'check', 'candidates',
                'job_ids', 'job_versions', 'optimization_job_id', 'generated_at',
                'origin_task_id', 'run_id', 'draft_id', 'studio_draft_id', 'job_id'}
    values = {k: v for k, v in obj.items() if k not in excluded}
    values.update(flow_id=flow_id, imported_from=obj['id'], imported_version=obj['version'])
    if obj['kind'] == 'studio_text_draft':
        values.update(job_ids=[], job_versions={})
    if obj['kind'] in {'content', 'studio_delivery'}:
        values.update(status='draft', check=None)
    return s.put(owner, obj['kind'], values)


def _draft_path(obj):
    return {'text': 'text', 'text_image': 'image', 'image_edit': 'image',
            'text_video': 'video', 'image_video': 'video', 'text_avatar': 'avatar/text',
            'tts': 'audio/tts', 'compose': 'compose'}.get(obj.get('tool'), '')


def _display_draft(owner, obj):
    if obj['kind'] == 'studio_draft':
        from .media_studio import migrate_video_draft
        return migrate_video_draft(owner, obj)
    return obj


def _upgrade_flow(owner, row):
    """Copy only already-linked legacy objects, never select a latest object."""
    sources = {}
    for field, kinds in [('last_draft', _DRAFT_KINDS), ('content_id', {'content'}),
                         *[(key, {'studio_asset'}) for key in ('visual_id', 'cover_id', 'video_id', 'audio_id')]]:
        if not row.get(field):
            continue
        obj = _live(owner, row[field], kinds)
        if obj.get('flow_id') != row['id']:
            sources[field] = obj
    changes = {field: _copy(owner, obj, row['id'])['id'] for field, obj in sources.items()}
    return s.put(owner, 'studio_flow', {**row, **changes}, row['id'], row['version']) if changes else row


def _install_flow_routes(app, user):
    """Wrap registered handlers: keep existing validation and dependency wiring."""
    def endpoint(path, method):
        return next(route for route in app.routes if getattr(route, 'path', '') == path
                    and method in getattr(route, 'methods', set()))

    text_create = endpoint('/api/studio/text/drafts', 'POST').dependant.call
    text_patch = endpoint('/api/studio/text/drafts/{id}', 'PATCH').dependant.call
    media_create = endpoint('/api/studio/drafts', 'POST').dependant.call
    media_patch = endpoint('/api/studio/drafts/{id}', 'PATCH').dependant.call

    def save_draft(owner, data, flow_id='', ident=None, task_id=''):
        with s.LOCK:
            if flow_id:
                _flow(owner, flow_id)
            if task_id:
                _live(owner, task_id, {'task'})
            old = _live(owner, ident, _DRAFT_KINDS) if ident else None
            task_ids = _draft_task_ids(owner, old) if old else set()
            if old and (old.get('flow_id', '') != flow_id or
                        (not flow_id and _draft_flow_ids(owner, old)) or
                        (task_ids and task_id not in task_ids) or
                        (task_id and task_id not in task_ids)):
                raise s.Conflict('草稿属于另一创作范围，请使用作品草稿接口或手动导入副本')
            if 'flow_id' in data and data['flow_id'] != flow_id:
                raise ValueError('不能修改草稿归属')
            if any(key in data and data[key] != task_id for key in ('origin_task_id', 'task_id')):
                raise ValueError('不能修改任务草稿归属')
            payload = {k: v for k, v in data.items() if k not in {'flow_id', 'origin_task_id', 'task_id'}}
            if (flow_id or task_id) and isinstance(payload.get('job_ids'), list):
                for job_id in payload['job_ids']:
                    job = _live(owner, job_id, {'job'})
                    if not ident or job.get('input', {}).get('draft_id') != ident:
                        raise s.Conflict('生成记录不属于当前草稿')
            is_text = (old or data).get('tool') == 'text'
            if old and data.get('tool', old['tool']) != old['tool']:
                raise ValueError('请新建草稿以切换工具')
            call = (text_patch if is_text else media_patch) if old else (text_create if is_text else media_create)
            result = call(**({'id': ident} if old else {}), data=payload, u={'id': owner})
            if flow_id or task_id:
                result = s.put(owner, result['kind'], {**result, **({'flow_id': flow_id} if flow_id else {'origin_task_id': task_id}),
                               **{k: old[k] for k in ('imported_from', 'imported_version') if old and k in old}},
                               result['id'], result['version'])
            return result

    # Generic saves cannot strip or reassign a persistent flow binding.
    for path, kind in [('/api/studio/text/drafts', 'studio_text_draft'), ('/api/studio/drafts', 'studio_draft')]:
        def create(data, u, _kind=kind):
            if data.get('flow_id') or data.get('origin_task_id') or data.get('task_id'):
                raise ValueError('请使用作品或任务草稿接口创建')
            return save_draft(u['id'], {**data, **({'tool': 'text'} if _kind == 'studio_text_draft' else {})})
        def patch(id, data, u, _kind=kind):
            _live(u['id'], id, {_kind})
            return save_draft(u['id'], data, ident=id)
        def listing(u, _kind=kind):
            return {'items': [_display_draft(u['id'], obj) for obj in s.list_(u['id'], _kind)
                             if not obj.get('archived') and not _draft_flow_ids(u['id'], obj)
                             and not _task_draft(u['id'], obj)]}
        endpoint(path, 'POST').dependant.call = create
        endpoint(path + '/{id}', 'PATCH').dependant.call = patch
        endpoint(path, 'GET').dependant.call = listing

    flow_route = endpoint('/api/studio/flow', 'POST')
    original_save = flow_route.dependant.call

    def flow_save(data, u):
        owner = u['id']
        with s.LOCK:
            old = None if data.get('new') is True else (_flow(owner, data['id']) if data.get('id') else next(iter(s.list_(owner, 'studio_flow')), None))
            if old and data.get('version') != old['version']:
                raise s.Conflict('创作主题已在其他页面更新，请刷新后重试')
            values = {**(old or {}), **data}
            # Old references are copied only when retained by their original flow.
            copies = {}
            _sync_flow_outputs(owner)
            for field, kinds in [('last_draft', _DRAFT_KINDS), ('content_id', {'content'}),
                                 *[(key, {'studio_asset'}) for key in ('visual_id', 'cover_id', 'video_id', 'audio_id')]]:
                if not values.get(field):
                    continue
                obj = _live(owner, values[field], kinds)
                if old and obj.get('flow_id') == old['id']:
                    continue
                if old and old.get(field) == obj['id']:
                    copies[field] = obj
                    continue
                raise s.Conflict('稿件不属于当前作品，请手动导入副本')
            if values.get('last_draft'):
                draft = _live(owner, values['last_draft'], _DRAFT_KINDS)
                path = _draft_path(draft)
                if not path or values.get('last_draft_tool') != path:
                    raise ValueError('草稿与创作工具不一致')
            # Run all original field/reference checks before making legacy copies.
            result = original_save(data=values, u=u)
            if copies:
                changes = {field: _copy(owner, obj, result['id'])['id'] for field, obj in copies.items()}
                result = s.put(owner, 'studio_flow', {**result, **changes}, result['id'], result['version'])
            return result

    flow_route.dependant.call = flow_save
    flow_route.endpoint = flow_save

    def flow_read(work_id, u):
        with s.LOCK:
            row = _flow(u['id'], work_id) if work_id else _latest_flow(u['id'])
            _sync_flow_outputs(u['id'])
            return _upgrade_flow(u['id'], row) if row else {'version': 0}
    endpoint('/api/studio/flow', 'GET').dependant.call = flow_read

    @app.get('/api/studio/flows/{flow_id}/drafts')
    def flow_drafts(flow_id: str, tool: str = '', u=Depends(user)):
        with s.LOCK:
            _flow(u['id'], flow_id)
            _sync_flow_outputs(u['id'], flow_id)
            kinds = list(_DRAFT_KINDS)
            with s.conn() as c:
                rows = c.execute(
                    'SELECT * FROM objects WHERE owner=? AND kind IN (?,?) '
                    "AND json_extract(data,'$.flow_id')=? AND json_extract(data,'$.archived') IS NOT 1 "
                    + ("AND json_extract(data,'$.tool')=? " if tool else '')
                    + 'ORDER BY kind=? DESC,updated DESC',
                    [u['id'], *kinds, flow_id] + ([tool] if tool else []) + [kinds[0]]).fetchall()
            return {'items': [_display_draft(u['id'], obj) for obj in map(s.unpack, rows)
                             if not obj.get('archived')]}

    @app.get('/api/studio/tasks/{task_id}/drafts')
    def task_drafts(task_id: str, u=Depends(user)):
        with s.LOCK:
            task = _live(u['id'], task_id, {'task'})
            items = [_live(u['id'], ident, _DRAFT_KINDS)
                     for ident in dict.fromkeys((task.get('media_outcomes') or {}).values())]
            items.extend(obj for kind in _DRAFT_KINDS for obj in s.list_(u['id'], kind)
                         if obj.get('origin_task_id') == task_id and not obj.get('archived')
                         and obj['id'] not in {item['id'] for item in items})
            if any(obj.get('flow_id') for obj in items):
                raise s.Conflict('任务草稿关联异常，不能编辑作品草稿')
            return {'items': [{**_display_draft(u['id'], obj), 'origin_task_id': task_id} for obj in items]}

    @app.post('/api/studio/tasks/{task_id}/drafts')
    def task_draft_create(task_id: str, data: dict, u=Depends(user)):
        return save_draft(u['id'], data, task_id=task_id)

    @app.patch('/api/studio/tasks/{task_id}/drafts/{draft_id}')
    def task_draft_patch(task_id: str, draft_id: str, data: dict, u=Depends(user)):
        return save_draft(u['id'], data, ident=draft_id, task_id=task_id)

    @app.post('/api/studio/flows/{flow_id}/drafts')
    def flow_draft_create(flow_id: str, data: dict, u=Depends(user)):
        return save_draft(u['id'], data, flow_id)

    @app.patch('/api/studio/flows/{flow_id}/drafts/{draft_id}')
    def flow_draft_patch(flow_id: str, draft_id: str, data: dict, u=Depends(user)):
        return save_draft(u['id'], data, flow_id, draft_id)

    @app.post('/api/studio/flows/{flow_id}/imports')
    def flow_import(flow_id: str, data: dict, u=Depends(user)):
        kinds = {'last_draft': _DRAFT_KINDS, 'content_id': {'content'},
                 'delivery_id': {'studio_delivery'},
                 **{field: {'studio_asset'} for field in ('visual_id', 'cover_id', 'video_id', 'audio_id')}}
        if set(data) - {'field', 'source_id', 'version'} or data.get('field') not in kinds:
            raise ValueError('请选择有效的作品字段与导入来源')
        with s.LOCK:
            row = _flow(u['id'], flow_id)
            if 'version' in data and (type(data['version']) is not int or data['version'] != row['version']):
                raise s.Conflict('作品已更新，请刷新后导入')
            field = data['field']
            obj = _live(u['id'], data.get('source_id'), kinds[field])
            asset_type = {'visual_id': 'image', 'cover_id': 'image', 'video_id': 'video', 'audio_id': 'audio'}.get(field)
            if asset_type and (obj.get('asset_type') != asset_type or obj.get('status') != 'ready'):
                raise ValueError('请选择可用的对应类型素材')
            if field == 'last_draft' and not _draft_path(obj):
                raise ValueError('此工具不能用于一站式创作')
            if field == 'delivery_id' and obj.get('topic_id') != row.get('topic_id'):
                raise ValueError('导入交付稿的选题须与当前作品一致')
            copied = _copy(u['id'], obj, flow_id)
            changes = {'assembled': 'no'}
            if field != 'delivery_id':
                changes[field] = copied['id']
            if field == 'last_draft':
                changes.update(last_draft_tool=_draft_path(copied), tool_path=_draft_path(copied))
            saved = s.put(u['id'], 'studio_flow', {**row, **changes}, flow_id, row['version'])
            name = 'draft' if field == 'last_draft' else 'delivery' if field == 'delivery_id' else 'content' if field == 'content_id' else 'asset'
            if name == 'asset':
                from .media_studio import _public
                copied = _public(copied)
            return {'flow': saved, name: copied}

    for path in ('/api/studio/text/generate', '/api/studio/generate'):
        route = endpoint(path, 'POST')
        original = route.dependant.call
        def generate(data, u, _original=original, **kwargs):
            with s.LOCK:
                draft = _live(u['id'], data['draft_id'], _DRAFT_KINDS) if data.get('draft_id') else None
                flow_id = data.get('flow_id', '')
                task_id = data.get('origin_task_id') or data.get('task_id', '')
                if data.get('origin_task_id') and data.get('task_id') and data['origin_task_id'] != data['task_id']:
                    raise ValueError('任务归属参数不一致')
                if draft and draft.get('flow_id', '') != flow_id:
                    raise s.Conflict('生成草稿不属于当前创作范围')
                task_ids = _draft_task_ids(u['id'], draft) if draft else set()
                if task_ids and not task_id and not flow_id:
                    mapped = {task['id'] for task in s.list_(u['id'], 'task')
                              if draft['id'] in (task.get('media_outcomes') or {}).values()
                              and not task.get('archived')}
                    if len(mapped) == 1:
                        task_id = next(iter(mapped))
                if (task_ids and task_id not in task_ids) or (task_id and (task_id not in task_ids or flow_id)):
                    raise s.Conflict('生成草稿不属于当前任务')
                if task_id:
                    _live(u['id'], task_id, {'task'})
                if flow_id:
                    _flow(u['id'], flow_id)
                if data.get('content_id'):
                    content = _live(u['id'], data['content_id'], {'content'})
                    if content.get('task_id') or content.get('flow_id', '') != flow_id:
                        raise s.Conflict('原稿不属于当前创作范围，请手动导入副本')
                result = _original(data={k: v for k, v in data.items() if k not in {'flow_id', 'task_id', 'origin_task_id'}}, u=u, **kwargs)
                _sync_flow_outputs(u['id'])
                return result
        route.dependant.call = generate

    for path, method in [('/api/objects/{kind}', 'POST'), ('/api/objects/{id}', 'PATCH')]:
        object_route = next((route for route in app.routes if getattr(route, 'path', '') == path
                             and method in getattr(route, 'methods', set())), None)
        if object_route:
            original_object = object_route.dependant.call
            def object_save(data, u, _original=original_object, **kwargs):
                with s.LOCK:
                    old = s.get(u['id'], kwargs['id']) if 'id' in kwargs else {}
                    protected = ('flow_id', 'origin_task_id', 'task_id', 'studio_draft_id', 'draft_id', 'job_id', 'run_id') if old.get('kind', kwargs.get('kind')) == 'content' else ()
                    for key in protected:
                        if key in data and data[key] != old.get(key, ''):
                            raise ValueError('普通编辑接口不能创建或修改作品/任务归属')
                    return _original(data=data, u=u, **kwargs)
            object_route.dependant.call = object_save

DEFAULTS={
 'daily':'日常沟通与内部工作台协作。资料检索遵循所选范围，写入前展示待写入结果。',
 'qa':'知识库问答。检索本次资料范围，回答销售沟通、软件使用和电梯行业知识问题；不提出写入操作。',
 'writing':'根据所选资料撰写可编辑文稿。适配运营身份和目标读者，事实标明来源，观点与事实分开。',
 'research':'围绕问题梳理资料、证据与缺口，给出清楚的结论。未联网检索时不声称已查到最新信息。',
 'benchmark':'分析所选内容的结构、受众、论据和表达方式，给出可借鉴的方法，不照搬原文。',
 'topics':'根据资料和运营身份提出选题、目标读者、切入角度和参考依据。',
 'profile':'通过简短访谈明确定位、受众、观点与风格，每次只问1至2个问题；不把假设当作真实身份。'}

def infer(text):
    for mode,words in [('profile',['定位','访谈']),('benchmark',['对标','拆解','仿写']),('topics',['选题','选几个主题']),('writing',['写一','写稿','文稿','创作','脚本'])]:
        if any(w in text for w in words):return mode
    return 'research'

def register(app,user,error):
    _install_flow_routes(app, user)
    @app.post('/api/tasks/{id}/profile')
    @jobs.serialized
    def save_task_profile(id:str,data:dict,u=Depends(user)):
        owner=u['id'];task=s.get(owner,id)
        if task['kind']!='task' or task.get('archived'):error(400,'请选择有效对话')
        if task['version']!=data.get('task_version'):error(409,'对话已更新，请重新打开保存窗口核对')
        if not any(m.get('role')=='assistant' and m.get('text','').strip() for m in task.get('messages',[])):error(400,'请先完成定位沟通')
        if any(j.get('task_id')==id and j.get('status') in ['queued','running'] for j in s.list_(owner,'job')):error(409,'请等待对话完成后保存')
        fields={k:str(data.get(k,'')).strip() for k in ['title','position','audience','style','body']}
        if not fields['title'] or not fields['body']:error(400,'请填写身份名称和定位方案')
        if len(fields['title'])>160 or any(len(v)>60000 for v in fields.values()):error(400,'身份内容过长')
        old=s.get(owner,data['profile_id']) if data.get('profile_id') else None
        if old and (old['kind']!='profile' or old.get('archived')):error(400,'请选择有效身份')
        if old and old['version']!=data.get('profile_version'):error(409,'身份已被修改，请重新核对后保存')
        if not old and any(x.get('positioning_task_id')==id and not x.get('archived') for x in s.list_(owner,'profile')):error(409,'此对话已有身份，请选择更新已有身份')
        return s.put(owner,'profile',{**(old or {}),**fields,'status':'accepted','positioning_task_id':id,'positioning_task_version':task['version'],'positioning_confirmed_at':s.now()},old['id'] if old else None,old['version'] if old else None)

    @app.get('/api/prompts')
    def prompts(u=Depends(user)):
        return {'defaults':DEFAULTS,'overrides':s.config('prompts:'+u['id'],{})}

    @app.put('/api/prompts')
    def save_prompts(data:dict,u=Depends(user)):
        if any(k not in DEFAULTS or not isinstance(v,str) or len(v)>12000 for k,v in data.items()):error(400,'提示词类型无效或超过12000字符')
        s.set_config('prompts:'+u['id'],data);return {'ok':True}

    @app.post('/api/tasks/open')
    def open_task(data:dict,u=Depends(user)):
        text=str(data.get('title','')).strip()
        if not text:error(400,'请输入目标')
        mode=data.get('mode') or 'auto'
        if mode not in {*DEFAULTS,'auto'}:error(400,'工作类型无效')
        refs=data.get('source_ids',[]);jobs.contextual_ids(u['id'],refs,data.get('profile_id'))
        scope=library.normalize_scope(u['id'],data.get('reference_scope'),refs)
        with s.LOCK:
            key=s.digest(str((text,mode,sorted(refs),data.get('profile_id') or '',scope)))
            old=next((x for x in s.list_(u['id'],'task') if (x.get('entry_key')==key or (x.get('title')==text[:60] and x.get('mode')==mode and sorted(x.get('source_ids',[]))==sorted(refs) and (x.get('profile_id') or '')==(data.get('profile_id') or ''))) and not x.get('archived')),None)
            if old:return old
            return s.export_object(u['id'],s.put(u['id'],'task',{'title':text[:160],'messages':[],'mode':mode,'source_ids':refs,'reference_scope':scope,'profile_id':data.get('profile_id'),'entry_key':key,'created':s.now()}))

    @app.post('/api/objects/{id}/trash')
    @jobs.serialized
    def trash(id:str,u=Depends(user)):
        obj=s.get(u['id'],id)
        if obj['kind']=='folder' and any(not x.get('archived') and (x.get('folder_id')==id or x.get('parent_id')==id) for x in s.list_(u['id'])):error(409,'文件夹还有内容，请先移动条目或子文件夹；不会连带删除资料')
        if obj['kind']=='weread_subscription' and any(j.get('input',{}).get('subscription_id')==id and (j.get('status') in ['queued','running'] or j['id'] in jobs.CANCEL) for j in s.list_(u['id'],'job')):error(409,'请先暂停免费订阅并等待当前检查停止')
        if obj['kind']=='job' and (obj.get('status') in ['running','queued'] or id in jobs.CANCEL):error(409,'请先取消并等待执行任务停止')
        if obj['kind'] in ['wechat_article','source','knowledge','memory','task','content'] and any((j.get('status') in ['running','queued'] or j['id'] in jobs.CANCEL) and (id in j.get('input',{}).get('article_ids',[]) or id in j.get('input',{}).get('source_ids',[])) for j in s.list_(u['id'],'job')):error(409,'资料正在被任务使用，请先等待或取消任务')
        if any(j.get('task_id')==id and j.get('status') in ['running','queued'] for j in s.list_(u['id'],'job')):error(409,'会话仍在执行，请先取消')
        return s.put(u['id'],obj['kind'],{**obj,'archived':True,'trashed_at':s.now()},id,obj['version'])

    @app.post('/api/objects/{id}/restore')
    def restore(id:str,u=Depends(user)):
        obj=s.get(u['id'],id)
        return s.put(u['id'],obj['kind'],{**obj,'archived':False,'trashed_at':None},id,obj['version'])

    @app.post('/api/tasks/{id}/distill')
    @jobs.serialized
    def distill(id:str,u=Depends(user)):
        owner=u['id'];task=s.get(owner,id)
        if task['kind']!='task' or task.get('archived'):error(400,'请选择有效对话')
        if not task.get('messages'):error(400,'这段对话暂无内容')
        model=g.select(owner,'knowledge');version=task['version']
        def run(progress,event):
            progress('整理本次对话的一份知识摘要')
            answer=g.generate(model,[{'role':'system','content':jobs.POLICY},{'role':'user','content':'将下面对话整理成一份Markdown摘要，区分用户确认事项、AI建议和未验证内容，保留时间与适用范围，不虚构外部事实。\n'+s.object_body(task)}])
            if event.is_set():return {'cancelled':True}
            with s.LOCK:
                current=s.get(owner,id)
                if current.get('archived'):raise ValueError('对话已删除，未保存摘要')
                previous=next((x for x in s.list_(owner,'source') if x.get('distilled_task')==id and not x.get('archived')),None)
                if previous and previous.get('body')!=previous.get('generated_body'):raise ValueError('已有摘要已手工修改，请先另存，避免覆盖你的编辑')
                obj=s.put(owner,'source',{'title':'对话摘要 · '+task['title'],'body':answer,'generated_body':answer,'source_ids':[id],'distilled_task':id,'task_version':version,'source_type':'手动提炼的对话摘要','status':'ready'},previous['id'] if previous else None)
                obj=s.export_object(owner,obj)
            return {'source_id':obj['id']}
        if any(j.get('input',{}).get('distilled_task')==id and j.get('status') in ['queued','running'] for j in s.list_(owner,'job')):error(409,'正在提炼这段对话')
        return jobs.start(owner,'提炼对话摘要',run,{'distilled_task':id})

    @app.post('/api/import/batch')
    def batch(data:dict,u=Depends(user)):
        urls=list(dict.fromkeys(re.findall(r'https?://[^\s<>]+',str(data.get('urls','')))))
        if not urls or len(urls)>100:error(400,'请提供1至100个链接，每行一个')
        benchmark=data.get('benchmark_id')
        if benchmark and s.get(u['id'],benchmark)['kind']!='benchmark':error(400,'请选择对标账号')
        if benchmark and s.get(u['id'],benchmark).get('platform') in ('抖音','douyin'):error(400,'抖音主页不是文章正文，请到对标作品库获取作品并下载媒体')
        def run(progress,event):
            from .app import import_text
            results=[]
            for i,url in enumerate(urls):
                if event.is_set():break
                progress(f'正在采集 {i+1}/{len(urls)}；成功 '+str(sum(x['status']=='done' for x in results)))
                try:
                    article=network.article(url)
                    if data.get('expected_publisher_biz') and article.get('publisher_biz')!=data['expected_publisher_biz']:
                        raise ValueError('原文发布账号与所选博主不一致或无法核实，未保存此文章')
                    obj=import_text({**article,'benchmark_id':benchmark,'source_type':'批量采集','acquisition_origin':'manual_url','acquisition_provider':'public'},u)
                    results.append({'url':url,'status':'done','source_id':obj['id'],'title':obj['title']})
                except Exception as e:results.append({'url':url,'status':'failed','reason':str(e) if isinstance(e,ValueError) else '读取失败：请检查网络或平台登录限制'})
            success=sum(x['status']=='done' for x in results)
            result={'items':results,'success':success,'failed':len(results)-success,'total':len(urls)}
            s.put(u['id'],'collection',{'title':'批量采集结果','benchmark_id':benchmark,**result})
            if not success and not event.is_set():raise ValueError('没有采集成功的文章，请查看采集记录中的失败原因')
            return result
        return jobs.start(u['id'],'批量采集文章',run,{**data,'action':'batch','trigger':'manual_url'})

    return {'batch':batch,'distill':distill}
