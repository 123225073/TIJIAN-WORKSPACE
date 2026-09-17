import ipaddress, socket, re
from datetime import datetime,timezone,timedelta,date
from urllib.parse import urlsplit, urljoin
import httpx
from bs4 import BeautifulSoup

class ArticleBlocked(ValueError):
    """A verified challenge response. Never retry the same batch blindly."""
def public_url(url):
    public_target(url)
    return url

def public_target(url):
    parts=urlsplit(url)
    if parts.scheme not in ('http','https') or not parts.hostname or parts.username or parts.password:raise ValueError('仅支持公开 HTTP/HTTPS 地址')
    try:addresses=[r[4][0] for r in socket.getaddrinfo(parts.hostname,parts.port or (443 if parts.scheme=='https' else 80),type=socket.SOCK_STREAM)]
    except OSError:raise ValueError('地址无法解析，请检查网络与域名')
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):raise ValueError('不可采集本机、内网或保留地址')
    address=next((ip for ip in addresses if ':' not in ip),addresses[0])
    # Connect to the validated IP; retain the original HTTPS certificate identity.
    return httpx.URL(url).copy_with(host=address),{'Host':parts.netloc},{'sni_hostname':parts.hostname}

def fetch(url):
    # Validate every redirect and bound bytes; never fetch arbitrary embedded media.
    with httpx.Client(timeout=25,follow_redirects=False,trust_env=False,headers={'User-Agent':'Mozilla/5.0 TijianResearch/0.1'}) as c:
        for _ in range(5):
            target,headers,extensions=public_target(url)
            with c.stream('GET',target,headers=headers,extensions=extensions) as r:
                if r.is_redirect:
                    url=urljoin(url,r.headers['location']);continue
                r.raise_for_status()
                ctype=r.headers.get('content-type','')
                if not any(t in ctype for t in ['text/','xml','json']):raise ValueError('该地址不是可读取的文章或订阅源，不自动下载媒体')
                data=bytearray()
                for chunk in r.iter_bytes():
                    data.extend(chunk)
                    if len(data)>4_000_000:raise ValueError('页面超过4MB读取上限')
                return bytes(data).decode(r.encoding or 'utf-8',errors='replace'),url
    raise ValueError('页面重定向次数过多')

def article(url):
    text,final=fetch(url)
    soup=BeautifulSoup(text,'html.parser')
    reject_blocked(soup,final)
    publisher_biz=''
    if urlsplit(final).hostname=='mp.weixin.qq.com':
        from .discovery import wechat_identity
        try:publisher_biz=wechat_identity(text,final)['biz']
        except ValueError:pass
    published=publication_date(soup,text)
    for x in soup(['script','style','nav','footer','header','noscript']):x.decompose()
    host=urlsplit(final).hostname or ''
    if host=='weixin.sogou.com':raise ValueError('搜索跳转尚未到达原文；请在内置网页完成验证，打开原文后采集')
    specific=soup.select_one('#js_content,article,.note-content,.RichContent-inner')
    if any(host==x or host.endswith('.'+x) for x in ['mp.weixin.qq.com','xiaohongshu.com','weibo.com','zhihu.com','douyin.com']) and not specific:
        raise ValueError('未读取到文章正文，可能遇到平台验证、访问限制或页面失效；可打开原文确认，或导入文稿。未保存验证页面')
    content=specific or soup.find('main') or soup.body or soup
    title=(soup.select_one('#activity-name') or soup.find('h1') or soup.title)
    body=content.get_text('\n',strip=True)
    if len(body)<100 or ('环境异常' in body[:1000] and len(body)<2000):raise ValueError('未获得有效正文，可能需要平台登录；可粘贴文章或导入文稿')
    return {'title':title.get_text(' ',strip=True) if title else final,'body':body[:100000],'url':final,'published':published,'publisher_biz':publisher_biz,'status':'ready','fetched':'正文已获取'}

def reject_blocked(soup,url):
    title=soup.title.get_text(' ',strip=True) if soup.title else ''
    path=urlsplit(url).path.lower()
    if any(x in path for x in ['/antispider','captcha','/passport/login']) or any(x in title for x in ['安全验证','访问验证','验证码','搜狗搜索验证码','环境异常']):
        raise ArticleBlocked('微信或目标平台返回验证页面，未取得正文；同批公开采集已停止，避免重复请求。可打开原文阅读，或自行确认使用次幂付费正文补采')

def publication_date(soup,text):
    for tag in soup.select('meta'):
        key=(tag.get('property') or tag.get('name') or '').lower()
        if key in ['article:published_time','pubdate','publishdate','date','dc.date.issued']:
            value=tag.get('content','');m=re.search(r'\d{4}-\d{2}-\d{2}',value)
            if m:
                try:return date.fromisoformat(m[0]).isoformat()
                except ValueError:pass
    # WeChat's publishing epoch is metadata, never executed JavaScript.
    m=re.search(r'\b(?:var\s+)?ct\s*=\s*["\x27]?(\d{10})\b',text)
    if m:
        try:return datetime.fromtimestamp(int(m[1]),timezone(timedelta(hours=8))).date().isoformat()
        except (ValueError,OSError):pass
    return ''

def within_dates(published,since,until):
    if not published:return None
    day=published[:10]
    return (not since or day>=since) and (not until or day<=until)
