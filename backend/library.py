"""Local reference scopes and virtual folders. No external connectors or credentials."""
from datetime import datetime, timezone
from fastapi import Depends
from . import store as s

MODULES = {
    'source': ('原始资料库', ['source']),
    'wiki': ('Wiki 知识库', ['knowledge']),
    'memory': ('个人记忆', ['memory']),
    'conversation': ('历史对话', ['task']),
    'content': ('作品与选题', ['content', 'plan']),
    'radar': ('行业雷达', ['news']),
    'benchmark': ('对标资料', ['benchmark', 'wechat_article', 'douyin_work']),
    'identity': ('我的 IP', ['profile']),
    'review': ('发布与复盘', ['publication', 'metric', 'feedback']),
}
KINDS = {kind for _, kinds in MODULES.values() for kind in kinds}
DEFAULT_SCOPE = {'mode': 'auto', 'modules': ['source', 'wiki', 'memory'], 'folder_ids': [], 'item_ids': [], 'excluded_ids': []}


def fingerprint(obj):
    body = '\n'.join(m.get('text','') for m in obj.get('messages',[]) if m.get('role')=='user') if obj['kind']=='task' else s.object_body(obj)
    return s.digest(body + '\n' + str(obj.get('title', '')))


def usable(obj, profile_id=None):
    if obj.get('archived') or obj.get('exclude_ai') or obj.get('file_missing'):
        return False
    if obj.get('profile_id') and obj['profile_id'] != profile_id:
        return False
    if obj['kind'] in ['knowledge', 'memory'] and obj.get('status') not in ['accepted', 'auto']:
        return False
    today = datetime.now(timezone.utc).date().isoformat()
    if obj['kind'] == 'memory' and ((obj.get('valid_to') or '9999') < today or (obj.get('valid_from') or '') > today):
        return False
    return True


def freshness(obj, objects):
    """A derived page must not revive deleted, opted-out or changed evidence."""
    if obj['kind'] not in ['knowledge', 'memory']:
        return ''
    for ref in obj.get('source_ids', []):
        original = objects.get(ref)
        if not original or original.get('archived') or original.get('exclude_ai') or original.get('file_missing'):
            return '来源已停用或不可用'
        saved = obj.get('source_hashes', {}).get(ref)
        if saved and saved != fingerprint(original):
            if obj['kind']=='memory' and original['kind']=='task':
                quote=obj.get('evidence_excerpt',{}).get(ref)
                statements='\n'.join(m.get('text','') for m in original.get('messages',[]) if m.get('role')=='user')
                if quote and quote in statements:continue
            return '原文已更新，等待重新整理'
    return ''


def normalize_scope(owner, value=None, source_ids=None):
    if value is None:
        value = {**DEFAULT_SCOPE, 'mode': 'selected', 'modules': [], 'item_ids': source_ids} if source_ids else DEFAULT_SCOPE
    if not isinstance(value, dict) or value.get('mode', 'auto') not in ['auto', 'selected']:
        raise ValueError('参考范围无效')
    result = {'mode': value.get('mode', 'auto')}
    for key in ['modules', 'folder_ids', 'item_ids', 'excluded_ids']:
        values = value.get(key, [])
        if not isinstance(values, list) or len(values) > 10000 or any(not isinstance(x, str) for x in values):
            raise ValueError('参考范围列表无效')
        result[key] = list(dict.fromkeys(values))
    if any(x not in MODULES for x in result['modules']):
        raise ValueError('未知的工作台模块')
    for key in ['folder_ids', 'item_ids', 'excluded_ids']:
        for id in result[key]:
            obj = s.get(owner, id)
            if obj['kind'] not in (['folder'] if key == 'folder_ids' else KINDS):
                raise ValueError('所选记录不能作为参考范围')
    # An explicit empty selection remains empty. Never silently widen it.
    return result


def descendants(objects, ids):
    result = set(ids)
    while True:
        extra = {x['id'] for x in objects if x['kind'] == 'folder' and not x.get('archived') and x.get('parent_id') in result}
        if extra <= result:
            return result
        result |= extra


def candidates(owner, scope, profile_id=None, task_id=None):
    objects = s.list_(owner)
    by_id = {x['id']: x for x in objects}
    folders = descendants(objects, scope['folder_ids'])
    kinds = {kind for module in scope['modules'] for kind in MODULES[module][1]}
    chosen = set(scope['item_ids'])
    excluded = set(scope['excluded_ids'])
    result = []
    for obj in objects:
        if obj['kind'] not in KINDS or obj['id'] in excluded or obj['id'] == task_id or not usable(obj, profile_id):
            continue
        if not (obj['id'] in chosen or obj['kind'] in kinds or obj.get('folder_id') in folders):
            continue
        if freshness(obj, by_id):
            continue
        if excluded.intersection(obj.get('source_ids', [])):
            continue
        result.append(obj)
    return result


def validate_folder(owner, kind, data, id=None):
    parent = data.get('parent_id') if kind == 'folder' else data.get('folder_id')
    if kind == 'folder' and data.get('library') not in ['source', 'knowledge', 'memory']:
        raise ValueError('请选择资料库、Wiki 或记忆文件夹')
    if not parent:
        return
    obj = s.get(owner, parent)
    library = data.get('library') if kind == 'folder' else kind
    if obj['kind'] != 'folder' or obj.get('archived') or obj.get('library') != library:
        raise ValueError('文件夹不存在或属于其他资料类型')
    seen = {id} if id else set()
    while obj:
        if obj['id'] in seen:
            raise ValueError('文件夹不能移动到自身或子文件夹')
        seen.add(obj['id'])
        obj = s.get(owner, obj['parent_id']) if obj.get('parent_id') else None


def register(app, user):
    @app.post('/api/tasks/{id}/references')
    def references(id: str, data: dict, u=Depends(user)):
        with s.LOCK:
            obj = s.get(u['id'], id)
            if obj['kind'] != 'task' or obj.get('archived'):
                raise ValueError('请选择有效对话')
            scope = normalize_scope(u['id'], data.get('scope'))
            if obj.get('reference_scope') != scope:
                s.put(u['id'], 'task', {**obj, 'reference_scope': scope, 'source_ids': scope['item_ids']}, id)
        return {'scope': scope}

    @app.get('/api/library/catalog')
    def catalog(u=Depends(user)):
        return {'modules': [{'id': k, 'title': v[0], 'kinds': v[1]} for k, v in MODULES.items()], 'default_scope': DEFAULT_SCOPE}

    @app.post('/api/library/move')
    def move(data: dict, u=Depends(user)):
        ids = data.get('ids', [])
        if not isinstance(ids, list) or not ids or len(ids) > 10000 or any(not isinstance(x, str) for x in ids):
            raise ValueError('请选择要移动的条目')
        with s.LOCK:
            objects = [s.get(u['id'], id) for id in dict.fromkeys(ids)]
            for obj in objects:
                if obj['kind'] not in ['source', 'knowledge', 'memory'] or obj.get('archived'):
                    raise ValueError('只支持移动资料、Wiki 和记忆')
                validate_folder(u['id'], obj['kind'], {'folder_id': data.get('folder_id')})
            for obj in objects:
                s.put(u['id'], obj['kind'], {**obj, 'folder_id': data.get('folder_id') or None}, obj['id'], obj['version'])
        return {'moved': len(objects)}

    @app.post('/api/library/preview')
    def preview(data: dict, u=Depends(user)):
        from .retrieval import retrieve
        scope = normalize_scope(u['id'], data.get('scope'))
        return retrieve(u['id'], str(data.get('query', '')), scope, data.get('profile_id'), data.get('task_id'))
