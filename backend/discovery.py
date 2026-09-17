"""Bounded public discovery. RSS is detected from content, never guessed from suffixes."""
import re
import httpx
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse, quote
from bs4 import BeautifulSoup
from fastapi import Depends
from . import network, upstream

def web_url(value, base=''):
    value=urljoin(base,str(value or ''))
    p=urlparse(value)
    return value if p.scheme in ('https','http') and p.hostname and not p.username and not p.password else ''

def feed(raw):
    try:
        root=ET.fromstring(raw.strip())
        if root.tag.split('}')[-1].lower() not in ('rss','feed','rdf'):return None
        return upstream.rss.parse_feed(raw)
    except (ET.ParseError,SystemExit):return None

def identify(url, keywords=''):
    raw,base=network.fetch(url)
    parsed=feed(raw);soup=BeautifulSoup(raw,'html.parser') if parsed is None else None
    if parsed is None:
        network.reject_blocked(soup,base)
        for link in soup.select('link[rel~=alternate][href]')[:3]:
            if link.get('type','').lower() not in ('application/rss+xml','application/atom+xml'):continue
            candidate=web_url(link['href'],base)
            if not candidate:continue
            try:
                value,final=network.fetch(candidate);result=feed(value)
                if result is not None:parsed=result;base=final;break
            except Exception:continue
    if parsed is not None:
        title,entries=parsed;kind='rss';note='已识别订阅，显示订阅当前提供的条目，不等于全部历史。'
    else:
        title=soup.title.get_text(' ',strip=True) if soup.title else '网页信源'
        words=[x for x in re.split(r'[,，\s]+',keywords) if x]
        entries=[{'title':a.get_text(' ',strip=True),'link':a['href'],'published':''} for a in soup.select('a[href]') if len(a.get_text(strip=True))>=4 and (not words or any(w in a.get_text() for w in words))]
        kind='web';note='未发现网站公开的订阅地址，已读取当前网页链接。可继续使用，无需填写RSS。'
    seen=set();items=[]
    for x in entries:
        link=web_url(x.get('link') or x.get('url'),base)
        if not link or link in seen:continue
        seen.add(link);items.append({'title':str(x.get('title') or link)[:500],'url':link,'published':x.get('published',''),'body':x.get('summary','')})
        if len(items)>=100:break
    return {'title':title,'url':base,'type':kind,'items':items,'note':note}

def wechat_identity(raw, url):
    import html
    from urllib.parse import parse_qs
    soup=BeautifulSoup(raw,'html.parser')
    network.reject_blocked(soup,url)
    if urlparse(url).hostname!='mp.weixin.qq.com':raise ValueError('请提供微信公众号原文链接')
    author=soup.select_one('#js_name, #js_profile_qrcode .profile_nickname, .rich_media_meta_nickname')
    # Public publisher identity, never author-name text or a mention in the article body.
    match=re.search(r"\b(?:var\s+)?(?:biz|__biz)\s*=\s*[\"\x27]([A-Za-z0-9_+/=-]+)[\"\x27]",raw)
    biz=html.unescape(match[1] if match else parse_qs(urlparse(url).query).get('__biz',[''])[0])
    if not author or not biz or not re.fullmatch(r'[A-Za-z0-9_+/=-]{3,128}',biz):
        raise ValueError('未能确认此文章的发布账号标识；请在内置网页打开原文完成验证后重试，不会用关键词搜索代替账号文章')
    return {'name':author.get_text(' ',strip=True),'biz':biz,'article_url':url,'profile_url':'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz='+quote(biz,safe='')+'#wechat_redirect'}


def discover_account(value, platform):
    value=value.strip()[:2000]
    if not value:raise ValueError('请输入一篇目标账号发布的文章链接')
    match=re.search(r'https?://[^\s<>]+',value)
    if not match:
        raise ValueError('公众号名称可能重名，请粘贴该账号发布的一篇文章链接，用发布账号标识定位作品')
    url=match.group();raw,final=network.fetch(url)
    if urlparse(final).hostname=='mp.weixin.qq.com':
        account=wechat_identity(raw,final)
        return {'title':account['name'],'account':account,'type':'wechat_account','url':account['profile_url'],'items':[],
                'note':'已从原文确认发布账号。请使用桌面端已登录的公众号读取该号发布列表；没有列表访问权限时不会返回其他作者的搜索文章。'}
    if platform in ('公众号','wechat'):
        raise ValueError('请粘贴 mp.weixin.qq.com 的公众号原文链接')
    return identify(url)


def preview(url):
    raw,final=network.fetch(url);soup=BeautifulSoup(raw,'html.parser')
    network.reject_blocked(soup,final)
    target=soup.select_one('#js_content, article, .RichContent-inner, .note-content')
    meta=soup.select_one('meta[name=description],meta[property="og:description"]')
    title=soup.select_one('#activity-name,h1,title')
    body=''
    if target:
        for el in target.select('script,style,nav,footer,noscript'):el.decompose()
        body=target.get_text('\n',strip=True)[:100000]
    return {'title':title.get_text(' ',strip=True)[:500] if title else '', 'url':final,'body':body or (meta.get('content','') if meta else ''),'status':'excerpt' if body else 'summary','note':'已读取页面正文区域，可能不包含评论、展开内容或全部回答。' if body else '当前仅获取网页简介；完整动态内容可在内置网页中阅读。'}

def register(app,user,error):
    def run(fn):
        try:return fn()
        except httpx.HTTPStatusError as e:error(502,f'来源网站返回 {e.response.status_code}，可能限制自动读取；可在内置网页打开后读取')
        except httpx.RequestError:error(502,'来源网站连接超时或网络异常，请稍后重试或在内置网页打开')
    @app.post('/api/discovery/source')
    def source(data:dict,u=Depends(user)):
        return run(lambda:identify(str(data.get('url','')),str(data.get('keywords',''))))
    @app.post('/api/discovery/account')
    def account(data:dict,u=Depends(user)):
        return run(lambda:discover_account(str(data.get('input','')),str(data.get('platform','公众号'))))
    @app.post('/api/discovery/preview')
    def read(data:dict,u=Depends(user)):
        return run(lambda:preview(str(data.get('url',''))))
    @app.post('/api/discovery/browser-target')
    def target(data:dict,u=Depends(user)):
        url=str(data.get('url',''));network.public_url(url)
        return {'url':url}
