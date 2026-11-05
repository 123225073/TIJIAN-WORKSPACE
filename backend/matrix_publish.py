"""Version-bound article delivery to an owner's HTTPS publishing gateway."""
import base64
import json
import re
import time
from html import escape
from urllib.parse import urlsplit

import httpx
import markdown
from bs4 import BeautifulSoup
from fastapi import Depends

from . import content_matrix, flow_deliverables, gateway, network, store
from .article_production import reader_article_body

PREFIX = '/api/studio/matrix-publish'
RECEIPT_KIND = 'studio_matrix_publish_receipt'
PLATFORMS = tuple(platform for platform in content_matrix.CHANNELS if platform != 'wechat')
ALLOWED_TAGS = {'a', 'b', 'blockquote', 'br', 'code', 'del', 'em', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4',
                'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
                'td', 'th', 'thead', 'tr', 'u', 'ul'}
ATTACHMENT_LIMIT = 12 * 1024 * 1024


def valid_https(value, *, endpoint=False):
    if not isinstance(value, str) or not value or len(value) > 2048 or re.search(r'[\s\\]', value):
        return False
    try:
        parts = urlsplit(value)
        return bool(parts.scheme == 'https' and parts.hostname and not parts.username and not parts.password and
                    parts.port in (None, 443) and (not endpoint or not (parts.query or parts.fragment)))
    except ValueError:
        return False


def platform_value(data):
    platform = data.get('platform')
    if not isinstance(platform, str) or platform not in PLATFORMS:
        raise ValueError('请选择已支持的图文发布平台')
    return platform


def config_key(owner, platform):
    return 'matrix_publish:' + owner + ':' + platform


def public_config(platform, config):
    return {'platform': platform, 'endpoint': config.get('endpoint', ''), 'enabled': config.get('enabled', False),
            'mode': config.get('mode', 'gateway'), 'username': config.get('username', ''),
            'revision': config.get('revision', 0),
            'has_token': bool(config.get('secret')), 'configured': bool(config.get('endpoint') and config.get('secret'))}


def update_config(owner, data):
    platform = platform_value(data)
    endpoint, token, enabled = data.get('endpoint'), data.get('token', ''), data.get('enabled', True)
    mode = data.get('mode', 'gateway')
    if mode not in ('gateway', 'wordpress') or (mode == 'wordpress' and platform != 'website'):
        raise ValueError('该平台不支持此发布方式')
    username = data.get('username', '') if mode == 'wordpress' else ''
    if mode == 'wordpress':
        if not isinstance(username, str) or not re.fullmatch(r'[^\s:\x00-\x1f\x7f]{1,120}', username):
            raise ValueError('请输入有效的 WordPress 用户名')
        if isinstance(token, str):
            token = token.replace(' ', '')
    if not isinstance(token, str) or len(token) > 4096 or (token and not re.fullmatch(r'[\x21-\x7e]+', token)):
        raise ValueError('令牌应为可见字符且不含空格')
    if type(enabled) is not bool or not valid_https(endpoint, endpoint=True):
        raise ValueError('请填写不含账户、查询参数和片段的 HTTPS 发布接口')
    if mode == 'wordpress':
        endpoint = endpoint.rstrip('/').removesuffix('/wp-json/wp/v2')
    network.public_target(endpoint)
    key = config_key(owner, platform)
    with store.LOCK:
        old = store.config(key, {})
        if not token and (old.get('endpoint') != endpoint or old.get('mode', 'gateway') != mode or old.get('username', '') != username):
            raise ValueError('更换接口或账号需要填写对应凭据')
        secret = gateway.cipher().encrypt(token.encode()).decode() if token else old.get('secret')
        if not secret:
            raise ValueError('请填写发布接口令牌')
        config = {'endpoint': endpoint, 'secret': secret, 'enabled': enabled, 'mode': mode, 'username': username,
                  'revision': old.get('revision', 0) + 1}
        store.set_config(key, config)
    return public_config(platform, config)


def package_content(owner, flow, content):
    original = str(content.get('body') or '')
    title = str(content.get('title') or '').strip()
    if not original.strip() or not title or len(original) > 200000 or len(title) > 500:
        raise ValueError('请保存有标题和正文的有效稿件后再发布')
    body = reader_article_body(original)
    soup = BeautifulSoup(markdown.markdown(body, extensions=['fenced_code', 'tables']), 'html.parser')
    for node in soup.find_all(['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math']):
        node.decompose()

    refs = flow_deliverables._references(content)
    if len(refs) > 12:
        raise ValueError('单篇发布最多可附 12 张图片')
    attachments, total, src_ids = [], 0, {}
    scope = flow_deliverables.Scope(owner, flow) if refs else None
    for kind, ident, error in refs:
        if error:
            raise ValueError(error)
        _, mime, source = flow_deliverables._image(owner, content, kind, ident, scope)
        size = len(source) if isinstance(source, bytes) else source.stat().st_size
        total += size
        if total > ATTACHMENT_LIMIT:
            raise ValueError('文章配图合计超过 12 MB，请压缩后再发布')
        raw = source if isinstance(source, bytes) else source.read_bytes()
        if len(raw) != size:
            raise ValueError('配图已变化，请重新打开稿件后再发布')
        prefix = 'studio/assets' if kind == 'studio_asset' else 'illustrations'
        src_ids[f'/api/{prefix}/{ident}/file'] = ident
        attachments.append({'id': ident, 'mime_type': mime, 'filename': ident + flow_deliverables.EXTENSIONS[mime],
                            'base64': base64.b64encode(raw).decode('ascii')})

    for node in soup.find_all(True):
        if node.name not in ALLOWED_TAGS:
            node.unwrap()
            continue
        attributes = {}
        if node.name == 'a' and valid_https(node.get('href', '')):
            attributes['href'] = node['href']
        if node.name == 'img':
            ident = src_ids.get(node.get('src', ''))
            if not ident:
                raise ValueError('正文配图引用无效，请从当前作品素材中重新插入')
            attributes = {'src': 'cid:' + ident, 'alt': str(node.get('alt') or '')[:500]}
        node.attrs = attributes
    plain = soup.get_text('\n', strip=True)
    if not plain and not attachments:
        raise ValueError('可发布正文为空，请核对当前稿件')
    return {'title': title, 'body': plain, 'html': str(soup), 'summary': str(content.get('summary') or '')[:1000],
            'author': str(content.get('author') or '')[:100], 'attachments': attachments}


def public_receipt(record):
    visible = {key: record[key] for key in ('id', 'platform', 'flow_id', 'content_id', 'content_version',
               'status', 'external_id', 'url', 'message', 'created', 'updated') if key in record}
    if visible['status'] == 'sending' and record.get('started', 0) + 180 < time.time():
        visible.update(status='unknown', message='未取得平台回执，请先检查已连接的发布服务')
    return visible


def post(client, endpoint, headers, deadline, **payload):
    if time.monotonic() > deadline:
        raise ValueError('等待发布回执超时')
    address, host, extensions = network.public_target(endpoint)
    with client.stream('POST', address, headers={**host, **headers}, extensions=extensions, **payload) as response:
        if response.is_redirect or not response.is_success:
            raise ValueError('发布服务没有返回可用回执')
        raw = bytearray()
        for chunk in response.iter_bytes():
            raw.extend(chunk)
            if len(raw) > 2_000_000 or time.monotonic() > deadline:
                raise ValueError('发布回执超过读取限制')
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError('发布服务未返回有效回执')
    return result


def send_wordpress(client, config, token, request, ident):
    username = config['username']
    auth = base64.b64encode(f'{username}:{token}'.encode()).decode('ascii')
    headers = {'Authorization': 'Basic ' + auth, 'Accept': 'application/json'}
    base = config['endpoint'] + '/wp-json/wp/v2'
    deadline = time.monotonic() + 120
    html, cover = request['html'], None
    for attachment in request['attachments']:
        media = post(client, base + '/media', {**headers, 'Content-Type': attachment['mime_type'],
                    'Content-Disposition': 'attachment; filename="' + attachment['filename'] + '"'}, deadline,
                    content=base64.b64decode(attachment['base64']))
        if type(media.get('id')) is not int or media['id'] <= 0 or not valid_https(media.get('source_url')):
            raise ValueError('WordPress 未返回有效配图记录')
        cover = cover or media['id']
        html = html.replace('src="cid:' + attachment['id'] + '"', 'src="' + escape(media['source_url'], quote=True) + '"')
    payload = {'title': request['title'], 'content': html, 'excerpt': request['summary'],
               'slug': 'tijian-' + ident[:32], 'status': 'publish'}
    if cover:
        payload['featured_media'] = cover
    result = post(client, base + '/posts', headers, deadline, json=payload)
    status = {'publish': 'published', 'pending': 'accepted', 'draft': 'draft'}.get(result.get('status'))
    if not status or type(result.get('id')) is not int or result['id'] <= 0:
        raise ValueError('WordPress 未返回可核验的文章记录')
    return {'status': status, 'external_id': str(result['id']), 'url': result['link'] if valid_https(result.get('link')) else ''}


def send(config, request, ident):
    token = gateway.cipher().decrypt(config['secret'].encode()).decode()
    with httpx.Client(timeout=httpx.Timeout(35, connect=8), follow_redirects=False, trust_env=False) as client:
        if config.get('mode') == 'wordpress':
            return send_wordpress(client, config, token, request, ident)
        headers = {'Authorization': 'Bearer ' + token, 'Idempotency-Key': ident, 'Accept': 'application/json'}
        result = post(client, config['endpoint'], headers, time.monotonic() + 45, json=request)
    status, external_id = result.get('status'), result.get('id')
    if status not in ('published', 'accepted', 'draft') or not isinstance(external_id, str) or not external_id.strip() or len(external_id) > 200:
        return {'status': 'unknown', 'message': '发布服务未返回可核验的结果编号，请先核查服务端记录'}
    return {'status': status, 'external_id': external_id,
            'url': result['url'] if valid_https(result.get('url')) else ''}


def dispatch(owner, data):
    platform = platform_value(data)
    if data.get('confirmed') is not True:
        raise ValueError('请核对稿件和目标平台后确认发布')
    flow_id, content_id, version = data.get('flow_id'), data.get('content_id'), data.get('content_version')
    if not all(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{32,64}', value) for value in (flow_id, content_id)) or type(version) is not int:
        raise ValueError('请选择有效的作品、文稿和版本')
    request_id = data.get('request_id')
    if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', request_id):
        raise ValueError('发布请求编号无效')
    ident = store.digest(f'matrix-publish:{owner}:{platform}:{flow_id}:{content_id}:{version}')
    with store.LOCK:
        flow = flow_deliverables._live(owner, flow_id, 'studio_flow')
        content = flow_deliverables._live(owner, content_id, 'content')
        if content.get('flow_id') != flow_id:
            raise store.Missing('文稿不属于当前作品')
        try:
            return public_receipt(store.get(owner, ident))
        except store.Missing:
            pass
        if content['version'] != version:
            raise store.Conflict('文稿已更新，请重新预览后确认发布')
        selected = content.get('creation_channel') or next((key for key, spec in content_matrix.CHANNELS.items()
                                                             if spec[0] == content.get('format')), '')
        if platform != selected:
            raise ValueError('当前稿件与目标平台不一致，请选择对应平台版本')
        scope = flow_deliverables.Scope(owner, flow)
        topic, _ = scope.topic(content)
        if not topic or topic != flow.get('topic_id'):
            raise store.Conflict('文稿不属于当前选题，请核对后再发布')
        config = store.config(config_key(owner, platform), {})
        if not config.get('enabled') or not config.get('secret') or not config.get('endpoint'):
            raise ValueError('请先启用此平台的发布接口并保存令牌')
        if type(data.get('config_revision')) is not int or data['config_revision'] != config.get('revision', 0):
            raise store.Conflict('发布连接已变化，请刷新后核对实际目的地')
        payload = package_content(owner, flow, content)
        values = {'platform': platform, 'flow_id': flow_id, 'content_id': content_id, 'content_version': version}
        record = store.put(owner, RECEIPT_KIND, {**values, 'status': 'sending', 'started': time.time()}, ident)
    request = {'schema_version': 1, **values, 'request_id': ident, 'action': 'publish', **payload}
    try:
        outcome = send(config, request, ident)
    except Exception:
        # The gateway might already have accepted the submission. Replays use the stored receipt.
        outcome = {'status': 'unknown', 'message': '发布结果待核查，请先检查 WordPress 文章和媒体库' if config.get('mode') == 'wordpress'
                   else '发布结果待核查，请先检查已连接的发布服务'}
    return public_receipt(store.put(owner, RECEIPT_KIND, {**record, **outcome}, ident, expected=record['version']))


def register(app, user):
    @app.get(PREFIX + '/config')
    def list_config(u=Depends(user)):
        owner = u['id']
        return {'items': [public_config(platform, store.config(config_key(owner, platform), {})) for platform in PLATFORMS]}

    @app.post(PREFIX + '/config')
    def save_config(data: dict, u=Depends(user)):
        return update_config(u['id'], data)

    @app.post(PREFIX + '/dispatch')
    def publish(data: dict, u=Depends(user)):
        return dispatch(u['id'], data)

    @app.get(PREFIX + '/dispatch')
    def receipts(flow_id: str, u=Depends(user)):
        owner = u['id']
        flow_deliverables._live(owner, flow_id, 'studio_flow')
        return {'items': [public_receipt(row) for row in store.list_(owner, RECEIPT_KIND) if row['flow_id'] == flow_id][:50]}
