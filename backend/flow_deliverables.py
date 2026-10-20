"""Read-only, topic-scoped delivery manifests and local image bundles."""
import base64
import io
import re
import zipfile
from urllib.parse import quote

import markdown
from bs4 import BeautifulSoup
from fastapi import Depends, Response

from . import store as s, media_studio
from .article_production import reader_article_body

PLATFORMS = [('wechat', '公众号'), ('xiaohongshu', '小红书'), ('moments', '朋友圈'),
             ('video', '短视频'), ('avatar', '数字人口播')]
FORMATS = {'公众号': 'wechat', '公众号文章': 'wechat', '小红书文案': 'xiaohongshu',
           '朋友圈文案': 'moments', '短视频脚本': 'video', '口播脚本': 'avatar'}
LOCAL_IMAGE = re.compile(r'^/api/(studio/assets/([a-f0-9]{32}(?:[a-f0-9]{32})?)|illustrations/([a-f0-9]{32}))/file$')
EXTENSIONS = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
              'image/gif': '.gif', 'image/avif': '.avif'}
ZIP_LIMIT = 100 * 1024 * 1024


def _live(owner, ident, kind):
    obj = s.get(owner, ident)
    if obj['kind'] != kind or obj.get('archived') or obj.get('deleted'):
        raise s.Missing('对象不存在或无权访问')
    return obj


def _index(owner):
    # Do not load job stream_text, provider snapshots or inline image payloads.
    fields = {'flow_id': 'flow_id', 'topic_id': 'topic_id', 'creation_channel': 'creation_channel',
              'draft_id': 'draft_id', 'studio_draft_id': 'studio_draft_id', 'job_id': 'job_id',
              'run_id': 'run_id', 'source_ids': 'source_ids', 'archived': 'archived', 'deleted': 'deleted',
              'task_id': 'task_id', 'origin_task_id': 'origin_task_id',
              'input_draft_id': 'input.draft_id', 'result_content_id': 'result.content_id',
              'status': 'status', 'asset_ids': 'asset_ids'}
    projection = ','.join("'" + key + "',json_extract(data,'$." + path + "')" for key, path in fields.items())
    with s.conn() as c:
        rows = c.execute('SELECT id,kind,version,updated,json_object(' + projection + ") AS data FROM objects WHERE owner=? AND kind IN ('content','studio_text_draft','studio_draft','job','studio_run','studio_delivery','studio_topic')", (owner,)).fetchall()
    return {row['id']: s.unpack(row) for row in rows}


class Scope:
    def __init__(self, owner, flow):
        self.owner, self.flow, self.rows = owner, flow, _index(owner)
        self.image_cache = {}
        self.links = {}
        for row in self.rows.values():
            if row['kind'] == 'job' and row.get('result_content_id'):
                self.links.setdefault(row['result_content_id'], set()).add(row.get('input_draft_id'))
            if row['kind'] == 'studio_run':
                for ident in row.get('asset_ids') or []:
                    self.links.setdefault(ident, set()).add(row.get('draft_id'))
            if row['kind'] == 'studio_delivery' and row.get('flow_id') == flow['id']:
                for ident in row.get('source_ids') or []:
                    self.links.setdefault(ident, set()).add(row['id'])

    def topic(self, obj, seen=None):
        """Only stored object/draft/job/delivery links establish a topic."""
        seen = set(seen or ())
        if obj['id'] in seen or len(seen) > 12:
            return '', '关联记录存在循环，待归类'
        seen.add(obj['id'])
        if obj.get('flow_id') not in (None, '', self.flow['id']):
            return '', '属于其他作品'
        if obj.get('task_id') or obj.get('origin_task_id'):
            return '', '属于独立任务，待归类'
        direct = obj.get('topic_id')
        if direct and (not isinstance(direct, str) or direct not in self.rows
                       or self.rows[direct]['kind'] != 'studio_topic'
                       or self.rows[direct].get('archived') or self.rows[direct].get('deleted')):
            return '', '选题记录无效或已移除，待归类'
        topics = {direct} if direct else set()
        links = set(self.links.get(obj['id'], ()))
        links.update(obj[key] for key in ('draft_id', 'studio_draft_id', 'job_id', 'run_id') if isinstance(obj.get(key), str))
        for ident in links - {None, ''}:
            parent = self.rows.get(ident)
            if not parent or parent.get('archived') or parent.get('deleted'):
                continue
            if parent.get('flow_id') != self.flow['id']:
                continue
            topic, reason = self.topic(parent, seen)
            if reason == '关联选题存在冲突，待归类':
                return '', reason
            if topic:
                topics.add(topic)
        # Media generated from a chosen document has an explicit source link.
        if obj.get('kind') == 'studio_draft':
            for ident in obj.get('source_ids') or []:
                parent = self.rows.get(ident)
                if parent and parent['kind'] == 'content' and parent.get('flow_id') == self.flow['id']:
                    topic, reason = self.topic(parent, seen)
                    if reason == '关联选题存在冲突，待归类':
                        return '', reason
                    if topic:
                        topics.add(topic)
        if len(topics) > 1:
            return '', '关联选题存在冲突，待归类'
        if not topics:
            return '', '旧记录缺少可确认的选题关联，待归类'
        return next(iter(topics)), ''


def _references(content):
    if content.get('format') in ('小红书文案', '朋友圈文案'):
        values = content.get('image_asset_ids') or []
        if not isinstance(values, list):
            return [('invalid', '', '配图列表格式无效')]
        return [('studio_asset', ident, '') if isinstance(ident, str) and re.fullmatch(r'[a-f0-9]{32}(?:[a-f0-9]{32})?', ident)
                else ('invalid', '', '配图引用格式无效') for ident in dict.fromkeys(str(v) for v in values)]
    html = markdown.markdown(reader_article_body(str(content.get('body') or '')), extensions=['fenced_code'])
    soup = BeautifulSoup(html, 'html.parser')
    refs, seen = [], set()
    for node in soup.find_all('img'):
        if node.find_parent(['pre', 'code']):
            continue
        source = node.get('src', '')
        if source in seen:
            continue
        seen.add(source)
        match = LOCAL_IMAGE.fullmatch(source)
        if not match:
            refs.append(('invalid', '', '图片使用外部地址或无效引用，请先导入本地素材'))
        else:
            refs.append(('studio_asset' if match[2] else 'illustration', match[2] or match[3], ''))
    return refs


def _image(owner, content, kind, ident, scope):
    cached = scope.image_cache.get((kind, ident))
    obj = cached[0] if cached else _live(owner, ident, kind)
    if obj.get('flow_id') not in (None, '', scope.flow['id']):
        raise ValueError('配图属于其他作品，请先复制导入当前作品')
    # A saved document reference is an explicit image choice. Topic grouping
    # applies to standalone media, not to deliberate reuse inside this work.
    if kind == 'illustration' and not obj.get('flow_id') and obj.get('content_id') != content['id']:
        origin = scope.rows.get(obj.get('content_id'))
        current_topic, _ = scope.topic(content)
        origin_topic, _ = scope.topic(origin) if origin else ('', '')
        if (not origin or origin['kind'] != 'content' or origin.get('archived') or origin.get('deleted')
                or origin.get('flow_id') != scope.flow['id'] or not current_topic or origin_topic != current_topic):
            raise ValueError('旧配图来源无法确认为当前作品的同一选题，请先核对或重新导入')
    if cached:
        return cached
    if kind == 'studio_asset':
        if obj.get('asset_type') != 'image' or obj.get('status') != 'ready':
            raise ValueError('配图尚不可用或已被移除')
        path = media_studio._path(owner, obj.get('local_file'), create=False)
        if not path.is_file():
            raise ValueError('配图本地文件缺失')
        mime = obj.get('mime_type')
        if mime not in EXTENSIONS:
            raise ValueError('配图格式暂不支持打包')
        if path.stat().st_size > ZIP_LIMIT:
            raise ValueError('单张配图超过打包大小限制')
        scope.image_cache[(kind, ident)] = obj, mime, path
        return scope.image_cache[(kind, ident)]
    value = obj.get('data_uri', '')
    match = re.fullmatch(r'data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)', value)
    if not match:
        raise ValueError('旧配图数据缺失或格式无效')
    try:
        raw = base64.b64decode(match[2], validate=True)
    except ValueError:
        raise ValueError('旧配图编码无效') from None
    if not raw or len(raw) > ZIP_LIMIT:
        raise ValueError('旧配图为空或超过打包大小限制')
    # Scope is request-local. Keep one decoded copy even when many document
    # versions share the image; never persist this cache or retain its Base64.
    scope.image_cache[(kind, ident)] = {key: value for key, value in obj.items() if key != 'data_uri'}, match[1], raw
    return scope.image_cache[(kind, ident)]


def _images(owner, content, scope, platform):
    label = dict(PLATFORMS).get(platform, '文章')
    images = []
    for index, (kind, ident, invalid) in enumerate(_references(content), 1):
        entry = {'kind': kind, 'id': ident, 'index': index, 'title': label + '配图 ' + str(index),
                 'available': False, 'url': '', 'filename': f'{index:02d}-{label}配图', 'reason': ''}
        try:
            if invalid:
                raise ValueError(invalid)
            _, mime, _ = _image(owner, content, kind, ident, scope)
            entry.update(available=True, filename=entry['filename'] + EXTENSIONS[mime],
                         url='/api/' + ('studio/assets/' if kind == 'studio_asset' else 'illustrations/') + ident + '/file')
        except (s.Missing, ValueError) as exc:
            entry['reason'] = '配图不存在、无权限或已移除' if isinstance(exc, s.Missing) else str(exc)
        images.append(entry)
    return images


def _version(owner, content, scope):
    platform = FORMATS.get(content.get('format'), '')
    images = _images(owner, content, scope, platform)
    topic, reason = scope.topic(content)
    unavailable = sum(not image['available'] for image in images)
    return {'content_id': content['id'], 'version': content['version'], 'title': content.get('title', '文稿'),
            'format': content.get('format', ''), 'platform': platform, 'body': content.get('body', ''),
            'author': content.get('author', ''), 'updated': content['updated'], 'topic_id': topic,
            'selected': content['id'] == scope.flow.get('content_id'), 'images': images,
            'unavailable_count': unavailable, 'notice': f'有 {unavailable} 张配图不可下载，请先核对；不会生成不完整图片包。' if unavailable else '',
            'scope_reason': reason, 'images_zip_url': ''}


def manifest(owner, flow_id):
    with s.LOCK:
        flow = _live(owner, flow_id, 'studio_flow')
        scope = Scope(owner, flow)
        topic = None
        if flow.get('topic_id'):
            try:
                topic = _live(owner, flow['topic_id'], 'studio_topic')
            except s.Missing:
                pass
        groups = [{'platform': key, 'label': label, 'versions': []} for key, label in PLATFORMS]
        by_platform = {group['platform']: group for group in groups}
        history, referenced = [], set()
        for content in s.list_(owner, 'content'):
            if content.get('flow_id') != flow_id or content.get('archived') or content.get('deleted'):
                continue
            item = _version(owner, content, scope)
            referenced.update(image['id'] for image in item['images'] if image['available'])
            if topic and item['topic_id'] == topic['id'] and item['platform'] in by_platform:
                item['images_zip_url'] = '/api/studio/flows/' + flow_id + '/deliverables/' + content['id'] + '/images.zip?version=' + str(content['version'])
                by_platform[item['platform']]['versions'].append(item)
            else:
                item['scope_reason'] = item['scope_reason'] or ('文稿平台待归类' if not item['platform'] else '历史选题的文稿')
                history.append(item)
        assets, unassigned = [], []
        for asset in s.list_(owner, 'studio_asset'):
            if asset.get('flow_id') != flow_id or asset.get('archived') or asset.get('deleted') or asset.get('status') != 'ready' or asset.get('asset_type') not in {'image', 'video', 'audio'} or asset['id'] in referenced:
                continue
            bound_topic, reason = scope.topic(asset)
            item = {key: asset.get(key) for key in ('id', 'title', 'asset_type', 'version', 'updated')}
            item.update(topic_id=bound_topic, scope_reason=reason)
            if topic and bound_topic == topic['id']:
                try:
                    path = media_studio._path(owner, asset.get('local_file'), create=False)
                    if not path.is_file():
                        raise ValueError('本地素材文件缺失')
                except ValueError as exc:
                    item['scope_reason'] = str(exc)
                    unassigned.append(item)
                    continue
                file_url = '/api/studio/assets/' + asset['id'] + '/file'
                extension = path.suffix if re.fullmatch(r'\.[a-z0-9]{1,8}', path.suffix) else ''
                name = {'image': '独立图片', 'video': '视频作品', 'audio': '音频作品'}[asset['asset_type']]
                item.update(url=file_url, file_url=file_url, mime_type=asset.get('mime_type', ''),
                            filename=name + extension, status='ready')
                if asset['asset_type'] == 'image':
                    item['thumbnail_url'] = '/api/studio/assets/' + asset['id'] + '/thumbnail'
                assets.append(item)
            else:
                item['scope_reason'] = reason or '历史选题的素材'
                unassigned.append(item)
        return {'flow_id': flow_id, 'topic_id': topic['id'] if topic else '', 'topic_title': topic.get('title', '') if topic else '',
                'groups': groups, 'history': history, 'assets': assets, 'unassigned': unassigned}


def image_zip(owner, flow_id, content_id, version):
    with s.LOCK:
        flow = _live(owner, flow_id, 'studio_flow')
        content = _live(owner, content_id, 'content')
        if content.get('flow_id') != flow_id:
            raise s.Missing('文稿不属于当前作品')
        if content['version'] != version:
            raise s.Conflict('文稿版本已变化，请刷新并重新选择版本后下载图片')
        scope = Scope(owner, flow)
        current = _live(owner, flow.get('topic_id', ''), 'studio_topic')
        topic, _ = scope.topic(content)
        if topic != current['id']:
            raise s.Conflict('文稿不属于当前选题，请返回对应选题后下载')
        item = _version(owner, content, scope)
        if item['unavailable_count']:
            raise ValueError(item['notice'])
        if not item['images']:
            raise ValueError('此版本没有可下载的配图')
        buffer, total = io.BytesIO(), 0
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            for image in item['images']:
                _, _, source = _image(owner, content, image['kind'], image['id'], scope)
                raw = source if isinstance(source, bytes) else source.read_bytes()
                total += len(raw)
                if total > ZIP_LIMIT:
                    raise ValueError('本版本配图合计超过100MB，请逐张下载')
                archive.writestr(image['filename'], raw)
        label = dict(PLATFORMS).get(item['platform'], '文章')
        filename = label + '-配图-v' + str(version) + '.zip'
        return Response(buffer.getvalue(), media_type='application/zip', headers={
            'Content-Disposition': "attachment; filename=\"images.zip\"; filename*=UTF-8''" + quote(filename),
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


def register(app, user):
    @app.get('/api/studio/flows/{flow_id}/deliverables')
    def listing(flow_id: str, u=Depends(user)):
        return manifest(u['id'], flow_id)

    @app.get('/api/studio/flows/{flow_id}/deliverables/{content_id}/images.zip')
    def images(flow_id: str, content_id: str, version: int, u=Depends(user)):
        return image_zip(u['id'], flow_id, content_id, version)
