"""Owner-scoped topic library and editable platform delivery drafts."""
from __future__ import annotations

import json
import re
from fastapi import Depends

from . import capabilities, gateway as g, jobs, store as s, wechat_layout
from .creation import model

TOPIC_FIELDS = {'title', 'angle', 'rationale', 'audience', 'source_ids', 'profile_id', 'origin', 'origin_ref', 'status', 'next_action'}
DELIVERY_FIELDS = {
    'wechat': ('title', 'summary', 'body', 'cover_brief', 'keywords', 'publishing_notes'),
    'channels': ('title', 'caption', 'script', 'shotlist', 'cover_brief', 'tags'),
    'douyin': ('title', 'caption', 'script', 'shotlist', 'cover_brief', 'tags'),
}
PLATFORM_NAMES = {'wechat': '公众号', 'channels': '视频号', 'douyin': '抖音'}
MEDIA_FIELDS = {'wechat': {'cover_asset_id': 'image'}, 'channels': {'cover_asset_id': 'image', 'video_asset_id': 'video'}, 'douyin': {'cover_asset_id': 'image', 'video_asset_id': 'video'}}
BUNDLE_SECTIONS = ('title', 'copy', 'cover', 'video')
DELIVERY_GUIDES = {
    'wechat': '为公众号写可直接编辑的完整文章：标题点明读者问题与收获；开篇迅速切入问题，围绕一个角度具体解释，不套用固定结构，并保留已有正文图片的素材标记。正文按本次目标字数写作；已有正文较长时保留其事实与图片，不硬截断。摘要概括读者收获。正文不含内部资料ID；事实依据与待核对项放在publishing_notes，不可编造法规、数字、报价或客户案例。cover_brief 必须依据本篇正文核心内容提出具体封面画面建议，不能声称已生成图片；keywords 是检索词。',
    'channels': '为视频号写适合真人或数字人口播的稿件：标题清楚可信；caption 是发布文案；script 用自然口语讲一个核心问题；shotlist 按镜头说明画面、动作及对应口播，素材不足写待补充；cover_brief 是封面建议；tags 与内容直接相关，不堆热门词。',
    'douyin': '为抖音短视频写适合拍摄的稿件：开头迅速提出真实问题，随后给具体解释或行动建议；caption 与 script 各司其职，shotlist 按镜头列画面与口播对应关系；封面建议和标签准确、克制，不承诺爆款或编造冲突。',
}

_INLINE_ASSET = re.compile(
    r'!\[[^\]\n]*\]\((/api/(?:studio/assets/[0-9a-f]{32}(?:[0-9a-f]{32})?/file'
    r'|illustrations/[0-9a-f]{32}/file))'
    r'(?:\s+"[^"]*")?\)'
)
_BODY_IMAGE = re.compile(r'!\[[^\]\n]*\]\((?:\\.|[^)\n])*\)|<img\b[^>]*>', re.IGNORECASE)


def _target_words(value):
    if type(value) is not int or not 100 <= value <= 10000:
        raise ValueError('目标字数须为100—10000之间的整数')
    return value


def _article_words(body):
    # Markdown image URLs and alt text are not part of the visible article length.
    visible = _INLINE_ASSET.sub('', body)
    return len(re.findall(r'[\u3400-\u9fff]|[A-Za-z0-9]+', visible))

def _keep_inline_images(original, generated):
    seen = set(_INLINE_ASSET.findall(generated))
    missing = []
    for match in _INLINE_ASSET.finditer(original):
        if match.group(1) not in seen:
            missing.append(match.group(0))
            seen.add(match.group(1))
    if not missing:
        return generated
    first, separator, rest = generated.partition('\n\n')
    return first + '\n\n' + '\n\n'.join(missing) + (separator + rest if separator else '')


OPTIMIZE_SCOPES = {'all', 'title', 'body', 'summary', 'cover_brief'}


def _wechat_field_limit(field, value):
    if field == 'title' and len(value) > 32:
        raise ValueError('AI 标题超过公众号 32 字上限，原稿未修改；请缩短标题后重试')
    if field == 'summary' and len(value) > 120:
        raise ValueError('AI 摘要超过公众号 120 字上限，原稿未修改；请缩短摘要后重试')


def _protected_body(body):
    """Hide original Markdown/HTML images from the model in their original order."""
    markers = []

    def replace(match):
        markers.append(match.group(0))
        return f'[[INLINE_IMAGE_{len(markers)}]]'

    return _BODY_IMAGE.sub(replace, body), markers


def _restore_protected_body(generated, markers):
    if not isinstance(generated, str):
        raise ValueError('AI 未返回完整正文，原稿未修改')
    tokens = re.findall(r'\[\[INLINE_IMAGE_\d+\]\]', generated)
    expected = [f'[[INLINE_IMAGE_{index}]]' for index in range(1, len(markers) + 1)]
    if tokens != expected or _BODY_IMAGE.search(generated):
        raise ValueError('AI 未按原顺序保留正文图片位置，请重试；原稿未修改')
    for token, marker in zip(expected, markers):
        generated = generated.replace(token, marker, 1)
    return generated


def _owned(owner, id, kind):
    obj = s.get(owner, id)
    if obj['kind'] != kind or obj.get('archived') or obj.get('deleted'):
        raise s.Missing('对象不存在或无权访问')
    return obj


def _sources(owner, ids):
    if not isinstance(ids, list) or len(ids) > 20 or any(not isinstance(id, str) for id in ids) or len(set(ids)) != len(ids):
        raise ValueError('最多选择20份不重复的资料')
    result = []
    for id in ids:
        obj = s.get(owner, id)
        if obj['kind'] not in {'source', 'content'} or obj.get('archived'):
            raise ValueError('只能引用当前账户的原始资料或作品')
        result.append(obj)
    return result


def _topic_payload(owner, data, old=None):
    if not isinstance(data, dict) or set(data) - (TOPIC_FIELDS | {'version'}):
        raise ValueError('选题字段不受支持')
    item = {**(old or {}), **data}
    title = item.get('title', '')
    if not isinstance(title, str) or not 0 < len(title.strip()) <= 200:
        raise ValueError('请填写200字以内的选题')
    for key in ('angle', 'rationale', 'audience', 'origin', 'origin_ref'):
        if not isinstance(item.get(key, ''), str) or len(item.get(key, '')) > 3000:
            raise ValueError(key + ' 不得超过3000字')
    if item.get('status', 'idea') not in {'idea', 'selected', 'used'}:
        raise ValueError('选题状态无效')
    if item.get('next_action', 'create') not in {'create', 'rework', 'hold', 'done'}:
        raise ValueError('下一步动作无效')
    _sources(owner, item.get('source_ids', []))
    if item.get('profile_id'):
        _owned(owner, item['profile_id'], 'profile')
    return {k: item.get(k, [] if k == 'source_ids' else 'idea' if k == 'status' else 'create' if k == 'next_action' else '') for k in TOPIC_FIELDS}


def _delivery_payload(platform, data, old=None, owner=None):
    fields = DELIVERY_FIELDS[platform]
    if not isinstance(data, dict) or set(data) - (set(fields) | set(MEDIA_FIELDS[platform]) | {'version', 'bundle_order', 'bundle_hidden'} | ({'target_words', 'wechat_style'} if platform == 'wechat' else set())):
        raise ValueError('交付字段不受支持')
    values = {key: data.get(key, (old or {}).get(key, '')) for key in fields}
    if any(not isinstance(value, str) or len(value) > (200000 if key == 'body' and platform == 'wechat' else 30000 if key in {'body', 'script', 'shotlist'} else 3000) for key, value in values.items()):
        raise ValueError('交付内容格式或长度不正确')
    if platform == 'wechat':
        values['target_words'] = _target_words(data.get('target_words', (old or {}).get('target_words', 1200)))
        values['wechat_style'] = wechat_layout.style(data.get('wechat_style', (old or {}).get('wechat_style')))
    if old is not None or 'bundle_order' in data or 'bundle_hidden' in data:
        order = data.get('bundle_order', (old or {}).get('bundle_order', list(BUNDLE_SECTIONS)))
        hidden = data.get('bundle_hidden', (old or {}).get('bundle_hidden', []))
        if not isinstance(order, list) or len(order) != len(BUNDLE_SECTIONS) or set(order) != set(BUNDLE_SECTIONS):
            raise ValueError('交付内容顺序无效')
        if not isinstance(hidden, list) or len(hidden) != len(set(hidden)) or set(hidden) - set(BUNDLE_SECTIONS):
            raise ValueError('交付内容选择无效')
        values.update(bundle_order=order, bundle_hidden=hidden)
    if owner is not None:
        for key, kind in MEDIA_FIELDS[platform].items():
            asset_id = data.get(key, (old or {}).get(key, ''))
            if not isinstance(asset_id, str) or len(asset_id) > 128:
                raise ValueError('素材编号无效')
            if asset_id:
                asset = _owned(owner, asset_id, 'studio_asset')
                if asset.get('asset_type') != kind or asset.get('status') != 'ready':
                    raise ValueError('请选择可用的' + ('图片' if kind == 'image' else '视频') + '素材')
            values[key] = asset_id
    return values


def _delivery(owner, id):
    item = _owned(owner, id, 'studio_delivery')
    if item.get('flow_id'):
        flow = _owned(owner, item['flow_id'], 'studio_flow')
        if flow.get('topic_id') != item.get('topic_id'):
            raise s.Conflict('交付稿与当前作品选题不一致，请重新选择')
    return item


def register(app, user, error):
    @app.get('/api/studio/topics')
    def topic_list(include_archived: bool = False, include_deleted: bool = False, u=Depends(user)):
        topics = [x for x in s.list_(u['id'], 'studio_topic')
                  if (x.get('deleted') if include_deleted else not x.get('deleted') and (include_archived or not x.get('archived')))]
        deliveries = s.list_(u['id'], 'studio_delivery')
        flows = s.list_(u['id'], 'studio_flow')
        return {'items': [{**x,
                           'delivery_count': sum(d.get('topic_id') == x['id'] for d in deliveries),
                           'flow_count': sum(f.get('topic_id') == x['id'] for f in flows)} for x in topics]}

    @app.post('/api/studio/topics')
    def topic_create(data: dict, u=Depends(user)):
        payload = _topic_payload(u['id'], data)
        with s.LOCK:
            if payload.get('origin_ref'):
                previous = next((x for x in s.list_(u['id'], 'studio_topic') if not x.get('archived') and x.get('origin_ref') == payload['origin_ref']), None)
                if previous:
                    return previous
            item = s.put(u['id'], 'studio_topic', payload)
        s.audit(u['id'], 'create_topic', item['id'])
        return item

    @app.patch('/api/studio/topics/{id}')
    def topic_update(id: str, data: dict, u=Depends(user)):
        old = _owned(u['id'], id, 'studio_topic')
        if type(data.get('version')) is not int:
            raise ValueError('保存选题需要当前版本号')
        item = s.put(u['id'], 'studio_topic', _topic_payload(u['id'], data, old), id, expected=data['version'])
        s.audit(u['id'], 'update_topic', id)
        return item

    @app.post('/api/studio/topics/{id}/archive')
    def topic_archive(id: str, u=Depends(user)):
        old = _owned(u['id'], id, 'studio_topic')
        s.put(u['id'], 'studio_topic', {**old, 'archived': True}, id, expected=old['version'])
        s.audit(u['id'], 'archive_topic', id)
        return {'ok': True}

    @app.post('/api/studio/topics/{id}/restore')
    def topic_restore(id: str, u=Depends(user)):
        old = s.get(u['id'], id)
        if old['kind'] != 'studio_topic':
            raise s.Missing('选题不存在')
        item = s.put(u['id'], 'studio_topic', {**old, 'archived': False, 'deleted': False, 'deleted_at': ''}, id, expected=old['version'])
        s.audit(u['id'], 'restore_topic', id)
        return item

    @app.post('/api/studio/topics/batch')
    def topic_batch(data: dict, u=Depends(user)):
        """Apply a validated batch in one DB transaction; deletion keeps references and history."""
        action = data.get('action') if isinstance(data, dict) else None
        items = data.get('items') if isinstance(data, dict) else None
        if not isinstance(data, dict) or set(data) != {'action', 'items'} or action not in {'archive', 'delete', 'restore'} or not isinstance(items, list) or not 1 <= len(items) <= 100:
            raise ValueError('请选择1到100条选题并指定归档、删除或恢复')
        if any(not isinstance(item, dict) or set(item) != {'id', 'version'} or
               not isinstance(item['id'], str) or not item['id'] or type(item['version']) is not int for item in items):
            raise ValueError('批量选题编号或版本无效')
        if len({item['id'] for item in items}) != len(items):
            raise ValueError('批量选题不能重复')
        with s.conn() as c:
            prepared = []
            for item in items:
                row = c.execute('SELECT * FROM objects WHERE owner=? AND id=?', (u['id'], item['id'])).fetchone()
                if not row or row['kind'] != 'studio_topic':
                    raise s.Missing('选题不存在或无权访问')
                if row['version'] != item['version']:
                    raise s.Conflict('选题已被其他窗口更新，请刷新列表后重试')
                old = json.loads(row['data'])
                if action == 'archive' and (old.get('archived') or old.get('deleted')):
                    raise ValueError('只能归档可用选题')
                if action == 'delete' and old.get('deleted'):
                    raise ValueError('选题已在回收区')
                if action == 'restore' and not (old.get('archived') or old.get('deleted')):
                    raise ValueError('只能恢复归档或回收区中的选题')
                changed = {**old}
                if action == 'archive':
                    changed['archived'] = True
                elif action == 'delete':
                    changed.update(archived=True, deleted=True, deleted_at=s.now())
                else:
                    changed.update(archived=False, deleted=False, deleted_at='')
                prepared.append((row, changed))
            for row, changed in prepared:
                stamp = s.now()
                c.execute('INSERT INTO history VALUES (?,?,?,?,?,?)', (s.uid(), row['id'], u['id'], row['data'], row['version'], row['updated']))
                c.execute('UPDATE objects SET data=?, version=?, updated=? WHERE id=?',
                          (json.dumps(changed, ensure_ascii=False), row['version'] + 1, stamp, row['id']))
                c.execute('INSERT INTO audit VALUES (?,?,?,?,?)', (s.uid(), u['id'], action + '_topic', row['id'], stamp))
        return {'items': [s.get(u['id'], item['id']) for item in items]}

    @app.post('/api/studio/topics/generate')
    def topic_generate(data: dict, u=Depends(user)):
        if not isinstance(data, dict) or set(data) - {'brief', 'source_ids', 'profile_id', 'request_id', 'count'}:
            raise ValueError('生成选题参数无效')
        brief = str(data.get('brief', '')).strip()
        if not brief or len(brief) > 2000:
            raise ValueError('请写下2000字以内的找题方向')
        count = data.get('count', 5)
        if type(count) is not int or count not in (3, 5, 10, 20):
            raise ValueError('每次可生成3、5、10或20条选题')
        sources = _sources(u['id'], data.get('source_ids', []))
        profile = _owned(u['id'], data['profile_id'], 'profile') if data.get('profile_id') else None
        model_id = model(u['id'], 'topics', {})
        method = capabilities.snapshot('topics')
        request_id = str(data.get('request_id', ''))[:100]
        owner = u['id']
        def work(progress, event):
            progress('正在结合已选资料生成选题')
            payload = {'方向': brief, 'IP定位': {k: profile.get(k, '') for k in ('title', 'position', 'audience')} if profile else None,
                       '资料': [{'id': x['id'], 'title': x.get('title'), 'body': x.get('body', '')[:6000], 'url': x.get('url'), 'published': x.get('published')} for x in sources]}
            text = g.generate(model_id, [{'role': 'system', 'content': jobs.POLICY + '\n' + method['text'] + f'\n只返回 JSON 对象，格式为 {{"topics":[{{"title":"","angle":"","rationale":"","audience":""}}]}}，按推荐顺序最多给出{count}个选题。rationale 要包含依据资料 ID、是否属常青问题或近期信息、资料日期或缺口，以及选择理由；没有资料时明确写“仅为方向建议，待查证”。禁止编造热点、数据、业绩、政策与资料 ID。'}, {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}])
            result = g.json_result(text)
            rows = result.get('topics')
            if not isinstance(rows, list) or not 1 <= len(rows) <= count:
                raise ValueError('模型未返回有效选题列表，请重新尝试')
            if event.is_set():
                raise InterruptedError('已取消')
            validated = [_topic_payload(owner, {**row, 'source_ids': [x['id'] for x in sources], 'profile_id': profile['id'] if profile else '', 'origin': 'AI 建议，待确认', 'status': 'idea'}) for row in rows]
            progress('已生成候选选题，等待你筛选确认')
            return {'suggestions': validated}
        fingerprint = s.digest(json.dumps(data, sort_keys=True))
        with s.LOCK:
            if request_id:
                old = next((j for j in s.list_(owner, 'job') if j.get('input', {}).get('topic_request') == request_id), None)
                if old:
                    if old['input'].get('topic_fingerprint') != fingerprint:
                        raise s.Conflict('提交编号已用于另一项找题请求')
                    return old
            return jobs.start(owner, '生成选题建议', work, {'action': 'studio_topics', 'topic_request': request_id, 'topic_fingerprint': fingerprint})

    @app.post('/api/studio/topics/generate/{job_id}/confirm')
    def topic_confirm(job_id: str, data: dict, u=Depends(user)):
        job = _owned(u['id'], job_id, 'job')
        if job.get('input', {}).get('action') != 'studio_topics' or job.get('status') != 'done':
            raise ValueError('请等待找题任务完成后再确认')
        suggestions = (job.get('result') or {}).get('suggestions')
        items = data.get('items') if isinstance(data, dict) and set(data) == {'items'} else None
        if not isinstance(suggestions, list) or not isinstance(items, list) or not items or len(items) > len(suggestions):
            raise ValueError('请选择要加入选题库的候选选题')
        prepared = []
        seen = set()
        for item in items:
            if not isinstance(item, dict) or set(item) - {'index', 'title', 'angle', 'rationale', 'audience'}:
                raise ValueError('候选选题字段无效')
            index = item.get('index')
            if type(index) is not int or index < 0 or index >= len(suggestions) or index in seen:
                raise ValueError('候选选题编号无效或重复')
            seen.add(index)
            ref = f'job:{job_id}:{index}'
            fields = _topic_payload(u['id'], {**suggestions[index], **{k: v for k, v in item.items() if k != 'index'}, 'origin': 'AI 建议，已确认', 'origin_ref': ref})
            prepared.append((ref, fields))
        with s.LOCK:
            existing = {x.get('origin_ref'): x for x in s.list_(u['id'], 'studio_topic') if x.get('origin_ref')}
            if any(existing.get(ref, {}).get('archived') for ref, _ in prepared):
                raise ValueError('部分建议已归档，请到选题库恢复')
            saved = []
            for ref, fields in prepared:
                item = existing.get(ref)
                if not item:
                    item = s.put(u['id'], 'studio_topic', fields)
                    s.audit(u['id'], 'confirm_topic', item['id'])
                saved.append(item)
        return {'items': saved}

    @app.get('/api/studio/deliveries')
    def deliveries(topic_id: str = '', flow_id: str = '', u=Depends(user)):
        if topic_id:
            _owned(u['id'], topic_id, 'studio_topic')
        flow = _owned(u['id'], flow_id, 'studio_flow') if flow_id else None
        return {'items': [x for x in s.list_(u['id'], 'studio_delivery')
                          if not x.get('archived') and not x.get('deleted')
                          and x.get('flow_id', '') == flow_id
                          and (not topic_id or x['topic_id'] == topic_id)
                          and (not flow or x['topic_id'] == flow.get('topic_id'))]}

    @app.post('/api/studio/deliveries')
    def delivery_create(data: dict, u=Depends(user)):
        if not isinstance(data, dict) or set(data) - ({'topic_id', 'platform', 'flow_id'} | set(DELIVERY_FIELDS.get(data.get('platform'), ())) | set(MEDIA_FIELDS.get(data.get('platform'), {})) | {'bundle_order', 'bundle_hidden'} | ({'target_words', 'wechat_style'} if data.get('platform') == 'wechat' else set())):
            raise ValueError('新建交付参数无效')
        topic = _owned(u['id'], data.get('topic_id'), 'studio_topic')
        flow = _owned(u['id'], data['flow_id'], 'studio_flow') if data.get('flow_id') else None
        if flow and flow.get('topic_id') != topic['id']:
            raise ValueError('当前作品的选题与交付稿不一致')
        platform = data.get('platform')
        if platform not in DELIVERY_FIELDS:
            raise ValueError('请选择支持的平台')
        content = _delivery_payload(platform, {k: v for k, v in data.items() if k not in {'topic_id', 'platform', 'flow_id'}}, owner=u['id'])
        item = s.put(u['id'], 'studio_delivery', {'topic_id': topic['id'], 'topic_version': topic['version'], 'flow_id': flow['id'] if flow else '', 'platform': platform,
                     'status': 'draft', 'source_ids': topic.get('source_ids', []), 'bundle_order': list(BUNDLE_SECTIONS), 'bundle_hidden': [], **{k: '' for k in DELIVERY_FIELDS[platform]}, **{k: '' for k in MEDIA_FIELDS[platform]}, **content})
        s.audit(u['id'], 'create_delivery', item['id'])
        return item

    @app.patch('/api/studio/deliveries/{id}')
    def delivery_update(id: str, data: dict, u=Depends(user)):
        old = _delivery(u['id'], id)
        if 'flow_id' in data and data['flow_id'] != old.get('flow_id', ''):
            raise s.Conflict('交付稿不属于当前作品，不能修改归属')
        if type(data.get('version')) is not int:
            raise ValueError('保存交付稿需要当前版本号')
        values = _delivery_payload(old['platform'], {k: v for k, v in data.items() if k != 'flow_id'}, old, u['id'])
        item = s.put(u['id'], 'studio_delivery', {**old, **values, 'status': 'draft'}, id, expected=data['version'])
        s.audit(u['id'], 'update_delivery', id)
        return item

    @app.post('/api/studio/deliveries/{id}/optimize')
    def delivery_optimize(id: str, data: dict, u=Depends(user)):
        delivery = _delivery(u['id'], id)
        if delivery['platform'] != 'wechat':
            raise ValueError('当前只支持优化公众号文章')
        if not isinstance(data, dict) or set(data) - {'version', 'scope', 'instruction', 'request_id'}:
            raise ValueError('AI 优化参数无效')
        if type(data.get('version')) is not int or data['version'] != delivery['version']:
            raise s.Conflict('发布稿已更新，请刷新后重试')
        scope = data.get('scope', 'all')
        instruction = data.get('instruction', '')
        request_id = data.get('request_id', '')
        if not isinstance(scope, str) or scope not in OPTIMIZE_SCOPES or not isinstance(instruction, str) or len(instruction) > 4000 or not isinstance(request_id, str) or len(request_id) > 100:
            raise ValueError('请选择优化范围，并填写4000字以内的优化方向')
        instruction = instruction.strip() or '请根据选题和现有内容优化表达，补全缺失信息；已有内容准确时保持原意，不无故扩写或删减。'
        fields = DELIVERY_FIELDS['wechat'] if scope == 'all' else (scope,)
        topic = _owned(u['id'], delivery['topic_id'], 'studio_topic')
        sources = _sources(u['id'], topic.get('source_ids', []))
        profile = _owned(u['id'], topic['profile_id'], 'profile') if topic.get('profile_id') else None
        model_id = model(u['id'], 'writing', {})
        method = capabilities.snapshot('writing')
        original = {key: delivery.get(key, '') for key in DELIVERY_FIELDS['wechat']}
        masked_body, image_markers = _protected_body(original['body'])
        owner = u['id']
        fingerprint = s.digest(json.dumps({'version': delivery['version'], 'scope': scope, 'instruction': instruction}, ensure_ascii=False, sort_keys=True))

        def work(progress, event):
            progress('正在阅读选题、原稿与资料，准备优化' + {'all': '整篇文章', 'title': '标题', 'body': '正文', 'summary': '摘要', 'cover_brief': '封面建议'}[scope])
            current_fields = {**original, 'body': masked_body}
            guide = (
                ('只返回 JSON 对象，且只包含这些非空字符串字段：' + '、'.join(fields) + '。' if scope == 'all'
                 else '只返回优化后的' + {'title': '标题', 'body': '正文', 'summary': '摘要', 'cover_brief': '封面建议'}[scope] + '全文，不要 JSON、代码块或解释。') +
                '严格按用户的优化方向处理；可以补充、重写、精简或缩短，不预设目标字数，不按固定比例截断。'
                '保留可核实的事实和原意，不编造行业法规、报价、客户案例或资料 ID；资料不足时标记待核对。'
                '公众号标题应清楚且不超过32字，摘要概括读者收获且不超过120字；封面建议必须依据本文内容，不宣称已经生成封面。'
                '如果优化正文，必须输出完整正文，保留 Markdown 结构及所有 [[INLINE_IMAGE_数字]] 占位符各一次、顺序不变，'
                '占位符仍放在对应段落附近；不要输出真实图片 URL。模型输出不完整时系统不会修改原稿。'
                '其余字段仅作为理解上下文，不能代替本次要求。'
            )
            payload = {
                '平台': '公众号', '优化范围': scope, '用户优化方向': instruction,
                '选题': {key: topic.get(key, '') for key in ('title', 'angle', 'rationale', 'audience')},
                'IP': {key: profile.get(key, '') for key in ('title', 'position', 'audience', 'style')} if profile else None,
                '资料': [{'id': item['id'], 'title': item.get('title'), 'body': item.get('body', '')[:8000], 'url': item.get('url')} for item in sources],
                '当前发布稿': current_fields,
            }
            text = g.generate(model_id, [
                {'role': 'system', 'content': jobs.POLICY + '\n' + method['text'] + '\n' + guide},
                {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)},
            ])
            progress('模型已返回，正在检查完整性与正文图片位置')
            candidate = text.strip()
            if candidate.startswith('```'):
                candidate = re.sub(r'^```(?:json)?\s*|\s*```$', '', candidate)
            if scope == 'all':
                try:
                    result = json.loads(candidate)
                except ValueError:
                    raise ValueError('AI 未返回完整的结构化文章，原稿未修改；请重试') from None
            elif scope == 'body':
                # A complete JSON-looking article is still article text, not a transport wrapper.
                result = {'body': text}
            else:
                try:
                    parsed = json.loads(candidate) if candidate.startswith('{') else None
                except ValueError:
                    parsed = None
                result = parsed if isinstance(parsed, dict) and set(parsed) == {scope} and isinstance(parsed.get(scope), str) else {scope: text}
            if not isinstance(result, dict):
                raise ValueError('AI 未返回可审阅的完整内容，原稿未修改')
            changes = {}
            for field in fields:
                value = result.get(field)
                if not isinstance(value, str) or not value.strip():
                    raise ValueError('AI 未返回完整的' + field + '内容，原稿未修改')
                if len(value) > (200000 if field == 'body' else 3000):
                    raise ValueError('AI 返回的' + field + '超过当前稿件存储上限，原稿未修改')
                _wechat_field_limit(field, value)
                changes[field] = _restore_protected_body(value, image_markers) if field == 'body' else value
            if event.is_set():
                raise InterruptedError('已取消')
            proposal = {**original, **changes}
            progress('候选稿已生成，请比较原稿并决定是否应用')
            return {
                'delivery_id': id, 'base_version': delivery['version'], 'scope': scope,
                'instruction': instruction, 'changed_fields': list(fields),
                'original': original, 'proposal': proposal,
                'image_handling': '原稿正文图片标记逐一保留、顺序不变；请在应用前核对与段落的对应关系。',
                'model_id': model_id,
            }

        with s.LOCK:
            if request_id:
                previous = next((item for item in s.list_(owner, 'job') if item.get('input', {}).get('action') == 'studio_delivery_optimize' and item['input'].get('request_id') == request_id), None)
                if previous:
                    if previous['input'].get('fingerprint') != fingerprint or previous['input'].get('delivery_id') != id:
                        raise s.Conflict('任务编号已用于另一项优化请求')
                    return previous
            return jobs.start(owner, 'AI 优化公众号文章', work, {
                'action': 'studio_delivery_optimize', 'delivery_id': id,
                'delivery_version': delivery['version'], 'scope': scope,
                'instruction': instruction, 'request_id': request_id, 'fingerprint': fingerprint,
            })

    @app.get('/api/studio/deliveries/{id}/optimizations/by-request/{request_id}')
    def delivery_optimization_by_request(id: str, request_id: str, u=Depends(user)):
        _delivery(u['id'], id)
        if not request_id or len(request_id) > 100:
            raise ValueError('任务编号无效')
        found = next((item for item in s.list_(u['id'], 'job')
                      if item.get('input', {}).get('action') == 'studio_delivery_optimize'
                      and item['input'].get('delivery_id') == id
                      and item['input'].get('request_id') == request_id), None)
        if not found:
            raise s.Missing('优化任务尚未创建')
        return found

    @app.post('/api/studio/deliveries/{id}/optimize/{job_id}/apply')
    @app.post('/api/studio/deliveries/{id}/optimizations/{job_id}/apply')
    def delivery_apply_optimization(id: str, job_id: str, data: dict, u=Depends(user)):
        if not isinstance(data, dict) or set(data) - {'version', 'changes'} or type(data.get('version')) is not int:
            raise ValueError('应用 AI 优化需要当前发布稿版本号')
        job = _owned(u['id'], job_id, 'job')
        result = job.get('result') or {}
        if job.get('input', {}).get('action') != 'studio_delivery_optimize' or job.get('status') != 'done' or result.get('delivery_id') != id:
            raise ValueError('请选择当前发布稿已完成的 AI 优化结果')
        fields = result.get('changed_fields')
        edits = data.get('changes', {})
        if not isinstance(fields, list) or not fields or not isinstance(edits, dict) or set(edits) - set(fields):
            raise ValueError('只能修改本次优化范围内的字段')
        with s.LOCK:
            current = _delivery(u['id'], id)
            if current['version'] != data['version'] or current['version'] != result.get('base_version'):
                raise s.Conflict('发布稿已更新，AI 候选稿未覆盖新版本；请重新比较后优化')
            proposal = result.get('proposal') or {}
            changes = {key: edits.get(key, proposal.get(key)) for key in fields}
            for field, value in changes.items():
                if isinstance(value, str):
                    _wechat_field_limit(field, value)
            if 'body' in changes:
                before = [match.group(0) for match in _BODY_IMAGE.finditer(current.get('body', ''))]
                after = [match.group(0) for match in _BODY_IMAGE.finditer(changes['body'])] if isinstance(changes['body'], str) else []
                if before != after:
                    raise ValueError('优化正文须保留原有图片标记及顺序；如需删图，请先在正文编辑器中调整')
            values = _delivery_payload('wechat', changes, current, u['id'])
            saved = s.put(u['id'], 'studio_delivery', {
                **current, **values, 'status': 'draft', 'model_id': result.get('model_id', ''),
                'topic_version': _owned(u['id'], current['topic_id'], 'studio_topic')['version'],
                'generated_at': s.now(), 'optimization_job_id': job_id,
            }, id, expected=data['version'])
        s.audit(u['id'], 'apply_delivery_optimization', id)
        return saved

    @app.post('/api/studio/deliveries/{id}/generate')
    def delivery_generate(id: str, data: dict, u=Depends(user)):
        delivery = _delivery(u['id'], id)
        topic = _owned(u['id'], delivery['topic_id'], 'studio_topic')
        if not isinstance(data, dict) or set(data) - {'version', 'target_words'} or (delivery['platform'] != 'wechat' and 'target_words' in data):
            raise ValueError('生成交付稿参数无效')
        if type(data.get('version')) is not int or data['version'] != delivery['version']:
            raise s.Conflict('交付稿已更新，请刷新后重试')
        target_words = _target_words(data.get('target_words', delivery.get('target_words', 1200))) if delivery['platform'] == 'wechat' else None
        model_id = model(u['id'], 'writing', {})
        method = capabilities.snapshot('writing')
        sources = _sources(u['id'], topic.get('source_ids', []))
        profile = _owned(u['id'], topic['profile_id'], 'profile') if topic.get('profile_id') else None
        owner = u['id']
        def work(progress, event):
            progress('已读取选题与已选资料，正在生成' + PLATFORM_NAMES[delivery['platform']] + '交付稿')
            fields = DELIVERY_FIELDS[delivery['platform']]
            instructions = '只返回 JSON 对象，字段为 ' + '、'.join(fields) + '，全部为非空字符串。' + DELIVERY_GUIDES[delivery['platform']] + '把用户已有交付稿作为可保留的素材，除明显错误外不要无故覆盖其意思。缺失事实在对应字段标记“待补充”，不得虚构行业法规、资质、报价、案例、已有画面或已发布状态。生成的是可编辑草稿。'
            if target_words is not None:
                instructions += f'正文目标约{target_words}字，最多允许超过目标20%；图片标记和 Markdown 标记不计入正文长度。请自行核对长度，超限结果不会保存。'
            payload = {'平台': PLATFORM_NAMES[delivery['platform']], '选题': {k: topic.get(k) for k in ('title', 'angle', 'rationale', 'audience')},
                       'IP': {k: profile.get(k, '') for k in ('title', 'position', 'audience', 'style')} if profile else None,
                       '资料': [{'id': x['id'], 'title': x.get('title'), 'body': x.get('body', '')[:8000], 'url': x.get('url')} for x in sources],
                       '已有交付稿': {k: delivery.get(k, '') for k in fields}}
            if target_words is not None:
                payload['目标字数'] = target_words
            text = g.generate(model_id, [{'role': 'system', 'content': jobs.POLICY + '\n' + method['text'] + '\n' + instructions}, {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}])
            progress('模型已返回，正在校验字段并保留正文图片')
            result = g.json_result(text)
            values = _delivery_payload(delivery['platform'], {k: result.get(k, '') for k in fields})
            from .writing_methods import publish_body
            if 'body' in values:values['body']=publish_body(values['body'])
            if delivery['platform'] == 'wechat':
                values['body'] = _keep_inline_images(delivery.get('body', ''), values.get('body', ''))
                word_count = _article_words(values['body'])
                max_words = target_words * 6 // 5
                if word_count > max_words:
                    raise ValueError(f'AI 正文约{word_count}字，超过目标{target_words}字的允许上限{max_words}字；原稿未覆盖。请调整目标字数或重试')
            if any(not values[key].strip() for key in fields):
                raise ValueError('模型返回内容不完整，未覆盖现有交付稿')
            if event.is_set():
                raise InterruptedError('已取消')
            current = _delivery(owner, id)
            if current['version'] != delivery['version']:
                raise s.Conflict('生成期间交付稿已被编辑，未覆盖用户修改')
            progress('校验通过，正在写入新的可编辑草稿版本')
            saved = s.put(owner, 'studio_delivery', {**current, **values, **({'target_words': target_words} if target_words is not None else {}), 'status': 'draft', 'model_id': model_id, 'topic_version': topic['version'], 'source_ids': [x['id'] for x in sources], 'generated_at': s.now()}, id, expected=delivery['version'])
            return {'delivery_id': saved['id'], 'version': saved['version']}
        with s.LOCK:
            previous = next((j for j in s.list_(owner, 'job') if j.get('input', {}).get('action') == 'studio_delivery' and j['input'].get('delivery_id') == id and j['input'].get('delivery_version') == delivery['version'] and j.get('status') in ('queued', 'running', 'done')), None)
            if previous:
                if previous['input'].get('target_words') != target_words:
                    raise s.Conflict('该版本已有不同目标字数的生成任务，请等待完成后刷新')
                return previous
            return jobs.start(owner, '生成平台交付稿', work, {'action': 'studio_delivery', 'delivery_id': id, 'delivery_version': delivery['version'], 'target_words': target_words})
