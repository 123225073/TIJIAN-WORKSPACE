"""Explicit, versioned conversation outcomes become independent creation works."""
from urllib.parse import quote
from fastapi import Depends
from . import store as s, jobs, topics, wechat_layout
from .assistant_workspace import _commit_rows
from .writing_methods import publish_body
from .article_production import reader_production_body


def _media_copy(obj, flow_id):
    copy = {key: value for key, value in obj.items() if key not in {
        'id', 'kind', 'version', 'updated', 'created', 'flow_id', 'origin_task_id', 'task_id', 'run_id', 'draft_id', 'job_id'}}
    copy.update(flow_id=flow_id, imported_from=obj['id'], imported_version=obj['version'])
    return copy


def _source(owner, task_id, content_id):
    task, content = s.get(owner, task_id), s.get(owner, content_id)
    if (task['kind'] != 'task' or content['kind'] != 'content'
            or content.get('task_id') != task_id
            or any(row.get('archived') or row.get('deleted') for row in (task, content))):
        raise s.Missing('请选择本次对话的有效文稿成果')
    platforms = [key for key, ident in (task.get('platform_outcomes') or {}).items() if ident == content_id]
    platform = content.get('platform')
    if not platform and len(platforms) == 1:
        platform = platforms[0]
    if not platform and not platforms and task.get('content_id') == content_id and content.get('format') in {'公众号', '公众号文章'}:
        platform, platforms = 'wechat', ['wechat']
    if platform not in platforms:
        raise s.Conflict('成果归属已变化，请重新打开当前文稿')
    return task, content, platform


def _result(owner, flow):
    checked = {}
    for key, kind in [('topic_id', 'studio_topic'), ('content_id', 'content'), ('delivery_id', 'studio_delivery')]:
        row = s.get(owner, flow[key])
        if row['kind'] != kind or row.get('archived') or row.get('deleted'):
            raise s.Conflict('原交付作品已变化，请到一站式创作核对')
        checked[key] = row
    if (checked['content_id'].get('flow_id') != flow['id']
            or checked['delivery_id'].get('flow_id') != flow['id']
            or checked['delivery_id'].get('topic_id') != flow['topic_id']
            or checked['delivery_id'].get('platform') != flow['platform']):
        raise s.Conflict('原作品的选题或平台已调整，请到一站式创作核对')
    back = 'studio/flow?work=' + flow['id'] + '&step=4'
    return {'flow': flow, 'route': 'studio/topics?topic=' + flow['topic_id'] + '&platform=' + flow['platform']
            + '&return=' + quote(back, safe='')}


def register(app, user):
    @app.get('/api/tasks/{task_id}/outcomes/{content_id}/handoffs')
    def links(task_id: str, content_id: str, u=Depends(user)):
        _source(u['id'], task_id, content_id)
        return {'items': [{'id': row['id'], 'brief': row.get('brief', ''), 'source_version': row['source_version'],
                           'platform': row['platform']} for row in s.list_(u['id'], 'studio_flow')
                          if row.get('source_outcome_id') == content_id and not row.get('archived') and not row.get('deleted')]}

    @app.post('/api/tasks/{task_id}/outcomes/{content_id}/handoff')
    @jobs.serialized
    def transfer(task_id: str, content_id: str, data: dict, u=Depends(user)):
        owner = u['id']
        if set(data) != {'version'} or type(data.get('version')) is not int:
            raise ValueError('请先保存文稿，再使用当前版本进入平台准备')
        task, source, platform = _source(owner, task_id, content_id)
        if platform not in topics.DELIVERY_FIELDS:
            raise ValueError('此成果可导出使用；当前一站式平台准备支持公众号、视频号和抖音')
        if source['version'] != data['version']:
            raise s.Conflict('文稿已更新，请核对最新版本后重新带入')
        if any(row.get('task_id') == task_id and row.get('status') in {'queued', 'running'} for row in s.list_(owner, 'job')):
            raise s.Conflict('请等待当前对话完成，再带入工作成果')
        previous = next((row for row in s.list_(owner, 'studio_flow')
                         if row.get('source_outcome_id') == content_id and row.get('source_version') == source['version']
                         and row.get('platform') == platform and not row.get('archived') and not row.get('deleted')), None)
        if previous:
            return _result(owner, previous)
        if not str(source.get('title', '')).strip() or not str(source.get('body') or source.get('script') or '').strip():
            raise ValueError('请先补全文章标题和正文')
        profile_id = source.get('profile_id') or ''
        if profile_id:
            topics._owned(owner, profile_id, 'profile')
        cover = topics._owned(owner, source['cover_asset_id'], 'studio_asset') if source.get('cover_asset_id') else None
        if cover and (cover.get('asset_type') != 'image' or cover.get('status') != 'ready'):
            raise ValueError('封面素材不可用，请重新选择后再带入')
        flow_id, topic_id, copied_id, delivery_id = (s.uid() for _ in range(4))
        cover_id = s.uid() if cover else ''
        media_rows, references = [], {}
        if cover:
            references['/api/studio/assets/' + cover['id'] + '/file'] = '/api/studio/assets/' + cover_id + '/file'
            media_rows.append(('studio_asset', cover_id, _media_copy(cover, flow_id)))
        body = reader_production_body(publish_body(source.get('body', ''))) if platform == 'wechat' else source.get('body', '')
        for path in dict.fromkeys(topics._INLINE_ASSET.findall(body)):
            if path in references:
                continue
            kind = 'studio_asset' if '/studio/assets/' in path else 'illustration'
            ident = path.split('/')[-2]
            asset = topics._owned(owner, ident, kind)
            if kind == 'studio_asset' and (asset.get('asset_type') != 'image' or asset.get('status') != 'ready'):
                raise ValueError('正文配图不可用，请核对图片后再带入')
            fresh = s.uid()
            references[path] = path.replace(ident, fresh)
            media_rows.append((kind, fresh, _media_copy(asset, flow_id)))
        for original, fresh in references.items():
            body = body.replace(original, fresh)
        copied = {key: value for key, value in source.items() if key not in {
            'id', 'kind', 'version', 'updated', 'created', 'file', 'file_hash', 'file_missing',
            'task_id', 'origin_task_id', 'flow_id', 'check', 'candidates', 'job_id', 'job_ids', 'request_snapshot'}}
        copied.update(flow_id=flow_id, imported_from=content_id, imported_version=source['version'], status='draft', check=None)
        copied['cover_asset_id'] = cover_id
        copied['body'] = body
        payload = {key: source.get(key, '') for key in topics.DELIVERY_FIELDS[platform]}
        if platform == 'wechat':
            payload.update(body=body, wechat_style=wechat_layout.style(source.get('wechat_style')))
            copied['body'] = payload['body']
        payload['cover_asset_id'] = cover_id
        delivery = topics._delivery_payload(platform, payload)
        delivery.update(platform=platform, cover_asset_id=cover_id, topic_id=topic_id, topic_version=1, flow_id=flow_id, status='draft', source_ids=[copied_id],
                        imported_from=content_id, imported_version=source['version'], bundle_order=list(topics.BUNDLE_SECTIONS), bundle_hidden=[])
        topic = topics._topic_payload(owner, {'title': source['title'], 'source_ids': [content_id], 'profile_id': profile_id,
                                             'origin': 'AI 对话文稿转入', 'origin_ref': content_id + ':' + str(source['version'])})
        topic['source_ids'] = [copied_id]
        flow = {'brief': source['title'], 'stage': '4', 'platform': platform, 'tool_path': 'text', 'assembled': 'yes',
                'profile_id': profile_id, 'topic_id': topic_id, 'content_id': copied_id, 'cover_id': cover_id,
                'delivery_id': delivery_id, 'source_outcome_id': content_id, 'source_version': source['version'],
                'source_task_id': task_id}
        flow['identity_skipped'] = bool(task.get('identity_skipped') or not profile_id)
        rows = [('studio_topic', topic_id, topic), ('content', copied_id, copied),
                ('studio_delivery', delivery_id, delivery), ('studio_flow', flow_id, flow)]
        rows.extend(media_rows)
        _commit_rows(owner, rows)
        return _result(owner, s.get(owner, flow_id))
