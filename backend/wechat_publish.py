"""Owner-scoped WeChat Official Account drafts and explicit free-publish actions."""
from __future__ import annotations

import hashlib
import base64
import ipaddress
import io
import re
import time
from threading import RLock
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, Response
from PIL import Image

from . import gateway, media_studio, store, wechat_layout

BASE = 'https://api.weixin.qq.com/cgi-bin'
PUBLIC_IP_URL = 'https://checkip.amazonaws.com'
TOKEN_CACHE = {}
LOCK = RLock()
LOCAL_IMAGE = re.compile(
    r'!\[([^\]\n]*)\]\(/api/(?:studio/assets/([a-f0-9]{32}|[a-f0-9]{64})|illustrations/([a-f0-9]{32}))/file'
    r'(?:[ \t]+(?:"[^"\n]*"|\'[^\'\n]*\'|\([^()\n]*\)))?[ \t]*\)'
)
IMAGE_START = re.compile(r'!\[[^\]\n]*\]\(')


def _accounts(owner):
    return store.config('wechat_publish_accounts:' + owner, [])


def _public(account):
    return {k: v for k, v in account.items() if k != 'secret'} | {'has_secret': bool(account.get('secret'))}


def _account(owner, account_id):
    account = next((a for a in _accounts(owner) if a['id'] == account_id), None)
    if not account:
        raise ValueError('请选择已连接的公众号')
    return account


def _json(response):
    try:
        value = response.json()
    except (ValueError, UnicodeError):
        raise ValueError('微信接口没有返回有效结果，请稍后核查公众号后台') from None
    if response.status_code != 200:
        raise ValueError('微信接口 HTTP ' + str(response.status_code))
    if not isinstance(value, dict):
        raise ValueError('微信接口返回格式异常（应为 JSON 对象）')
    code = value.get('errcode', 0)
    if code:
        hint = {40164: '请把本机的公网出口 IP 加入公众号接口 IP 白名单',
                40125: 'AppSecret 无效或已重置。请核对所选公众号的 AppID，在“修改连接”中填写对应的最新 AppSecret，保存后测试连接；IP 白名单不能解决此错误',
                40013: 'AppID 无效，请核对所选公众号的 AppID',
                40001: '接口调用凭证无效；请先测试连接并核对 AppID 与 AppSecret',
                48001: '当前公众号没有此接口权限', 45009: '接口调用达到频率限制'}.get(code, '请检查公众号接口权限或本次请求参数')
        if code == 40164:
            match = re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', str(value.get('errmsg', ''))[:300])
            if match:
                try:
                    address = ipaddress.ip_address(match.group())
                except ValueError:
                    address = None
                if address and address.is_global:
                    hint += f'；微信识别的出口 IP：{address}'
        raise ValueError(f'微信接口错误 {code}：{hint}')
    return value


def _inline_image_url(result):
    """WeChat's uploadimg response may contain an http:// CDN URL."""
    value = result.get('url')
    if not isinstance(value, str) or not value:
        detail = '微信返回了素材编号而非正文图片 URL' if result.get('media_id') else '微信未返回 url 字段'
        raise ValueError('公众号正文图片上传失败：' + detail + '；请核对接口权限及图片格式')
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme in ('http', 'https') and bool(parsed.hostname)
                 and not parsed.username and not parsed.password and not parsed.fragment
                 and not re.search(r'[\s<>"\'()]', value) and len(value) <= 2048)
        if valid:
            host = parsed.hostname.rstrip('.').lower()
            try:
                valid = ipaddress.ip_address(host).is_global
            except ValueError:
                valid = '.' in host and not host.endswith(('.local', '.localhost', '.internal'))
    except ValueError:
        valid = False
    if not valid:
        raise ValueError('公众号正文图片上传失败：微信返回的 url 不是有效的 http/https 图片地址')
    return value


def _public_egress_ip():
    """Probe from this backend process, with the same proxy policy as WeChat calls."""
    try:
        with httpx.Client(timeout=5, trust_env=False) as client:
            response = client.get(PUBLIC_IP_URL)
    except httpx.TimeoutException:
        raise ValueError('公网出口 IP 检测超时，请检查本机网络后重试') from None
    except httpx.HTTPError:
        raise ValueError('无法连接公网 IP 检测服务，请检查本机网络后重试') from None
    if response.status_code != 200:
        raise ValueError('公网 IP 检测服务暂时不可用，请稍后重试')
    value = response.text.strip()
    try:
        address = ipaddress.ip_address(value) if len(value) <= 45 else None
    except ValueError:
        address = None
    if not isinstance(address, ipaddress.IPv4Address) or not address.is_global:
        raise ValueError('公网 IP 检测服务未返回有效的公网 IPv4 地址，请稍后重试')
    return str(address)


def _request(method, path, *, account, owner, payload=None, files=None, params=None):
    token = _token(owner, account)
    try:
        with httpx.Client(timeout=30, trust_env=False) as client:
            response = client.request(method, BASE + path, params={'access_token': token, **(params or {})}, json=payload, files=files)
        return _json(response)
    except httpx.HTTPError:
        raise ValueError('微信接口连接中断，结果可能已生效；请核查公众号后台后再操作') from None


def _token(owner, account, *, fresh=False):
    cache_key = owner + ':' + account['id'] + ':' + hashlib.sha256(account['secret'].encode()).hexdigest()
    cached = TOKEN_CACHE.get(cache_key)
    if not fresh and cached and cached[1] > time.time():
        return cached[0]
    secret = gateway.cipher().decrypt(account['secret'].encode()).decode()
    try:
        with httpx.Client(timeout=20, trust_env=False) as client:
            response = client.get(BASE + '/token', params={'grant_type': 'client_credential', 'appid': account['app_id'], 'secret': secret})
        result = _json(response)
    except httpx.HTTPError:
        raise ValueError('无法连接微信接口，请检查网络、接口 IP 白名单和账号配置') from None
    token = result.get('access_token')
    if not isinstance(token, str) or not token:
        raise ValueError('微信没有返回有效调用凭证')
    TOKEN_CACHE[cache_key] = (token, time.time() + max(60, min(int(result.get('expires_in', 7200)) - 180, 6900)))
    return token


def _image(owner, asset_id, *, inline=False):
    asset = store.get(owner, asset_id)
    if asset['kind'] != 'studio_asset' or asset.get('asset_type') != 'image' or asset.get('status') != 'ready':
        raise ValueError('请选择本账号已保存的图片素材')
    path = media_studio._path(owner, asset.get('local_file'))
    try:
        with Image.open(path) as source:
            picture = source.convert('RGB')
            max_bytes = 900_000 if inline else 1_800_000
            for edge in ((1800, 1400, 1100) if inline else (2400, 1800, 1400, 1100)):
                picture.thumbnail((edge, edge))
                for quality in (88, 76, 62, 48):
                    output = io.BytesIO()
                    picture.save(output, format='JPEG', quality=quality, optimize=True)
                    if output.tell() < max_bytes:
                        return output.getvalue()
    except (OSError, ValueError):
        pass
    raise ValueError('图片无法转换成公众号支持的 JPEG，请换一张图片')


def _illustration(owner, illustration_id):
    picture = store.get(owner, illustration_id)
    if picture['kind'] != 'illustration' or picture.get('archived'):
        raise ValueError('请选择本账号已保存的文章配图')
    data_uri = picture.get('data_uri', '')
    match = re.fullmatch(r'data:image/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', data_uri)
    if not match or len(match.group(1)) > 12_000_000:
        raise ValueError('文章配图格式无效或过大，请重新上传')
    try:
        raw = base64.b64decode(match.group(1), validate=True)
        with Image.open(io.BytesIO(raw)) as source:
            if source.width * source.height > 25_000_000:
                raise ValueError('文章配图尺寸过大，请换一张图片')
            picture = source.convert('RGB')
            for edge in (1800, 1400, 1100):
                picture.thumbnail((edge, edge))
                for quality in (88, 76, 62, 48):
                    output = io.BytesIO()
                    picture.save(output, format='JPEG', quality=quality, optimize=True)
                    if output.tell() < 900_000:
                        return output.getvalue()
    except (OSError, ValueError) as exc:
        if isinstance(exc, ValueError) and '尺寸过大' in str(exc):
            raise
    raise ValueError('文章配图无法转换成公众号支持的 JPEG，请换一张图片')


def _article_html(owner, account, body, settings=None):
    if re.search(r'!\[[^\n]*/api/', LOCAL_IMAGE.sub('', body)):
        raise ValueError('正文含无法识别的本地图片，请从本工作台素材库重新插入')
    for candidate in IMAGE_START.finditer(body):
        if LOCAL_IMAGE.match(body, candidate.start()):
            continue
        if body[candidate.end():].startswith('/api/'):
            raise ValueError('正文含无法识别的本地图片，请从本工作台素材库重新插入')
        raise ValueError('正文含外部图片，公众号不会保留它们；请先上传到本工作台素材库')
    images = {}

    def replace(match):
        image_id = match.group(2) or match.group(3)
        key = ('asset:' if match.group(2) else 'illustration:') + image_id
        if key not in images:
            content = _image(owner, image_id, inline=True) if match.group(2) else _illustration(owner, image_id)
            try:
                result = _request('POST', '/media/uploadimg', owner=owner, account=account,
                                  files={'media': (image_id + '.jpg', content, 'image/jpeg')})
            except ValueError as exc:
                raise ValueError('公众号正文图片上传失败：' + str(exc)) from None
            images[key] = _inline_image_url(result)
        return _image_markdown(match.group(1), images[key])

    marked = LOCAL_IMAGE.sub(replace, body)
    output = wechat_layout.render(marked, settings)
    if len(output.encode()) > 1_000_000:
        raise ValueError('正文超过公众号草稿接口限制，请缩短内容')
    return output


def _image_markdown(alt, url):
    return '\n![' + alt + '](' + url + ')\n'


def _preview_images(body):
    def replace(match):
        image_id = match.group(2) or match.group(3)
        url = ('/api/studio/assets/' if match.group(2) else '/api/illustrations/') + image_id + '/file'
        return _image_markdown(match.group(1), url)
    return LOCAL_IMAGE.sub(replace, body)


def _record(owner, delivery_id, account_id):
    return next((x for x in store.list_(owner, 'wechat_publish_record')
                 if x.get('delivery_id') == delivery_id and x.get('account_id') == account_id), None)


def _delivery(owner, delivery_id):
    item = store.get(owner, delivery_id)
    if item['kind'] != 'studio_delivery' or item.get('platform') != 'wechat' or item.get('archived'):
        raise ValueError('请选择本账号的公众号发布稿')
    return item


def _snapshot(delivery):
    fields = ('title', 'summary', 'body', 'cover_asset_id')
    return hashlib.sha256(repr((tuple(delivery.get(k, '') for k in fields),
                               wechat_layout.style(delivery.get('wechat_style')))).encode()).hexdigest()


def _save_record(owner, old, values):
    return store.put(owner, 'wechat_publish_record', {**(old or {}), **values},
                     old['id'] if old else None, expected=old['version'] if old else None)


def register(app, user):
    @app.post('/api/wechat-publish/preview')
    def preview_article(data: dict, u=Depends(user)):
        body = data.get('body', '')
        if not isinstance(body, str) or len(body) > 200000:
            raise ValueError('正文格式或长度不正确')
        return {'html': wechat_layout.render(_preview_images(body), data.get('wechat_style'))}

    @app.get('/api/wechat-publish/public-ip')
    def public_ip(response: Response, u=Depends(user)):
        response.headers['Cache-Control'] = 'no-store'
        return {'ip': _public_egress_ip()}

    @app.get('/api/wechat-publish/accounts')
    def accounts(u=Depends(user)):
        return {'items': [_public(x) for x in _accounts(u['id'])]}

    @app.post('/api/wechat-publish/accounts')
    def save_account(data: dict, u=Depends(user)):
        name = str(data.get('name', '')).strip()
        app_id = str(data.get('app_id', '')).strip()
        secret = str(data.get('app_secret', '')).strip()
        if not name or len(name) > 80 or not re.fullmatch(r'wx[a-fA-F0-9]{16}', app_id):
            raise ValueError('请填写公众号名称和有效的 AppID')
        with LOCK:
            items = _accounts(u['id'])
            old = next((x for x in items if x['id'] == data.get('id')), None)
            if old and old['app_id'] != app_id and not secret:
                raise ValueError('更换 AppID 时需要重新填写 AppSecret')
            if not secret and not old:
                raise ValueError('请填写 AppSecret')
            if len(secret) > 512:
                raise ValueError('AppSecret 格式无效')
            encrypted = gateway.cipher().encrypt(secret.encode()).decode() if secret else old['secret']
            changed_app = bool(old and old['app_id'] != app_id)
            item = {'id': old['id'] if old and not changed_app else store.uid(), 'name': name, 'app_id': app_id,
                    'secret': encrypted, 'enabled': old.get('enabled', True) if old and not changed_app else True}
            if changed_app:
                old['enabled'] = False
            store.set_config('wechat_publish_accounts:' + u['id'],
                             [x for x in items if x['id'] != item['id']] + [item])
            store.audit(u['id'], 'save_wechat_publish_account', item['id'])
        return _public(item)

    @app.post('/api/wechat-publish/accounts/{account_id}/test')
    def test_account(account_id: str, u=Depends(user)):
        account = _account(u['id'], account_id)
        _token(u['id'], account, fresh=True)
        return {'ok': True, 'message': '当前 AppID 与 AppSecret 已向微信重新验证；草稿及发布权限需以实际调用结果为准'}

    @app.post('/api/wechat-publish/accounts/{account_id}/state')
    def account_state(account_id: str, data: dict, u=Depends(user)):
        if type(data.get('enabled')) is not bool:
            raise ValueError('账号状态无效')
        with LOCK:
            items = _accounts(u['id'])
            account = next((x for x in items if x['id'] == account_id), None)
            if not account:
                raise ValueError('公众号账号不存在')
            account['enabled'] = data['enabled']
            store.set_config('wechat_publish_accounts:' + u['id'], items)
            store.audit(u['id'], 'wechat_publish_account_state', account_id)
        return _public(account)

    @app.get('/api/wechat-publish/records/{delivery_id}')
    def records(delivery_id: str, u=Depends(user)):
        _delivery(u['id'], delivery_id)
        return {'items': [x for x in store.list_(u['id'], 'wechat_publish_record') if x.get('delivery_id') == delivery_id]}

    @app.post('/api/wechat-publish/drafts/{delivery_id}')
    def sync_draft(delivery_id: str, data: dict, u=Depends(user)):
        with LOCK:
            owner = u['id']
            delivery = _delivery(owner, delivery_id)
            if delivery['version'] != data.get('version'):
                raise store.Conflict('发布稿已修改，请先保存并重新核对')
            account = _account(owner, data.get('account_id'))
            if not account.get('enabled', True):
                raise ValueError('此公众号连接已停用')
            if not delivery.get('title', '').strip() or len(delivery['title']) > 32:
                raise ValueError('公众号标题须为 1 至 32 字')
            if not delivery.get('body', '').strip() or not delivery.get('cover_asset_id'):
                raise ValueError('请填写正文并选择封面图片')
            if len(delivery.get('summary', '')) > 120:
                raise ValueError('摘要不能超过 120 字')
            old = _record(owner, delivery_id, account['id'])
            if old and old.get('status') in ('publishing', 'published', 'uncertain', 'removed'):
                raise ValueError('此稿件已提交发布或结果待核查，不能重复同步草稿')
            snapshot = _snapshot(delivery)
            failed_revision = bool(old and old.get('status') == 'failed')
            if failed_revision and (data.get('confirmed_retry') is not True or snapshot == old.get('snapshot')):
                raise ValueError('微信确认发布失败后，请先修改并保存发布稿，再明确确认重新同步')
            if old and old.get('status') == 'draft' and old.get('snapshot') == snapshot:
                return old
            media_id = old.get('thumb_media_id') if old and not failed_revision and old.get('cover_asset_id') == delivery['cover_asset_id'] else ''
            if not media_id:
                cover = _image(owner, delivery['cover_asset_id'])
                try:
                    cover_result = _request('POST', '/material/add_material', owner=owner, account=account, params={'type': 'image'},
                                            files={'media': ('cover.jpg', cover, 'image/jpeg')})
                except ValueError as exc:
                    raise ValueError('公众号封面上传失败：' + str(exc)) from None
                media_id = cover_result.get('media_id')
                if not isinstance(media_id, str) or not media_id:
                    raise ValueError('公众号封面上传失败：微信未返回永久素材编号 media_id')
            article = {'title': delivery['title'].strip(), 'digest': delivery.get('summary', '').strip(),
                       'content': _article_html(owner, account, delivery['body'], delivery.get('wechat_style')), 'thumb_media_id': media_id,
                       'need_open_comment': 0, 'only_fans_can_comment': 0}
            try:
                if old and not failed_revision and old.get('draft_media_id'):
                    _request('POST', '/draft/update', owner=owner, account=account,
                             payload={'media_id': old['draft_media_id'], 'index': 0, 'articles': article})
                    draft_id = old['draft_media_id']
                else:
                    result = _request('POST', '/draft/add', owner=owner, account=account, payload={'articles': [article]})
                    draft_id = result.get('media_id')
                    if not draft_id:
                        _save_record(owner, old, {'delivery_id': delivery_id, 'account_id': account['id'],
                                                  'status': 'uncertain', 'snapshot': snapshot})
                        raise ValueError('公众号未返回草稿编号，请到公众号后台核查')
            except ValueError as exc:
                if '结果可能已生效' in str(exc):
                    _save_record(owner, old, {'delivery_id': delivery_id, 'account_id': account['id'],
                                              'status': 'uncertain', 'snapshot': snapshot, 'draft_media_id': old.get('draft_media_id', '') if old else ''})
                raise
            previous = list(old.get('publish_history') or []) if old else []
            if failed_revision:
                previous.append({key: old.get(key) for key in ('status', 'snapshot', 'publish_id', 'draft_media_id', 'submitted_at', 'checked_at', 'article_url')})
            saved = _save_record(owner, old, {'delivery_id': delivery_id, 'account_id': account['id'],
                          'status': 'draft', 'snapshot': snapshot, 'draft_media_id': draft_id,
                          'cover_asset_id': delivery['cover_asset_id'], 'thumb_media_id': media_id,
                          'delivery_version': delivery['version'], 'synced_at': store.now(), 'publish_id': '',
                          'article_url': '', 'checked_at': '', 'submitted_at': '', 'publish_history': previous})
            store.audit(owner, 'sync_wechat_draft', delivery_id)
            return saved

    @app.post('/api/wechat-publish/publish/{delivery_id}')
    def publish(delivery_id: str, data: dict, u=Depends(user)):
        if data.get('confirmed') is not True:
            raise ValueError('请先核对公众号草稿，并明确确认发布')
        with LOCK:
            owner = u['id']
            delivery = _delivery(owner, delivery_id)
            account = _account(owner, data.get('account_id'))
            if not account.get('enabled', True):
                raise ValueError('此公众号连接已停用')
            record = _record(owner, delivery_id, account['id'])
            if not record or record.get('status') != 'draft':
                raise ValueError('请先将当前发布稿同步到公众号草稿箱')
            if record.get('snapshot') != _snapshot(delivery) or delivery['version'] != record.get('delivery_version'):
                raise ValueError('发布稿已更改，请重新同步并核对草稿')
            try:
                result = _request('POST', '/freepublish/submit', owner=owner, account=account,
                                  payload={'media_id': record['draft_media_id']})
            except ValueError as exc:
                if '结果可能已生效' in str(exc):
                    _save_record(owner, record, {'status': 'uncertain'})
                raise
            publish_id = result.get('publish_id')
            if not publish_id:
                _save_record(owner, record, {'status': 'uncertain'})
                raise ValueError('微信未返回发布任务编号，请到公众号后台核查')
            saved = _save_record(owner, record, {'status': 'publishing', 'publish_id': publish_id, 'submitted_at': store.now()})
            store.audit(owner, 'submit_wechat_publish', delivery_id)
            return saved

    @app.post('/api/wechat-publish/status/{delivery_id}')
    def status(delivery_id: str, data: dict, u=Depends(user)):
        owner = u['id']
        _delivery(owner, delivery_id)
        account = _account(owner, data.get('account_id'))
        record = _record(owner, delivery_id, account['id'])
        if not record or not record.get('publish_id'):
            raise ValueError('尚无可查询的发布任务')
        result = _request('POST', '/freepublish/get', owner=owner, account=account,
                          payload={'publish_id': record['publish_id']})
        code = result.get('publish_status')
        state = {0: 'published', 1: 'publishing', 2: 'failed', 3: 'failed', 4: 'failed', 5: 'removed', 6: 'removed'}.get(code, 'uncertain')
        details = result.get('article_detail') or {}
        items = details.get('item') or []
        url = items[0].get('article_url', '') if items and isinstance(items[0], dict) else ''
        saved = _save_record(owner, record, {'status': state, 'article_id': result.get('article_id', ''),
                                              'article_url': url if url.startswith('https://') else '',
                                              'wechat_status': code, 'checked_at': store.now()})
        store.audit(owner, 'check_wechat_publish', delivery_id)
        return saved
