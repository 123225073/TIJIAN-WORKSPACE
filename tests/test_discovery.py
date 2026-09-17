import pytest
from backend import discovery,network,store as s
from test_workflows import client,account
from test_interaction_revision import wait

RSS='<rss version="2.0"><channel><title>电梯观察</title><item><title>更新政策</title><link>https://example.com/a</link></item><item><title>危险</title><link>javascript:alert(1)</link></item></channel></rss>'

def test_feed_detection_uses_content_and_relative_autodiscovery(monkeypatch):
    calls=[]
    def fetch(url):
        calls.append(url)
        return ('<title>行业网站</title><link rel="alternate" type="application/rss+xml" href="/subscribe">' if url.endswith('/home') else RSS),url
    monkeypatch.setattr(network,'fetch',fetch)
    result=discovery.identify('https://example.com/home')
    assert result['type']=='rss' and result['url']=='https://example.com/subscribe'
    assert len(result['items'])==1 and result['items'][0]['title']=='更新政策'
    assert calls==['https://example.com/home','https://example.com/subscribe']

def test_html_is_not_rss_by_extension_and_empty_keywords_mean_all(monkeypatch):
    monkeypatch.setattr(network,'fetch',lambda url:('<title>新闻</title><a href="/a">电梯更新政策</a><a href="/b">软件研究报告</a>',url))
    assert discovery.identify('https://example.com/rss.xml')['type']=='web'
    assert len(discovery.identify('https://example.com/rss.xml')['items'])==2
    assert len(discovery.identify('https://example.com/rss.xml','电梯')['items'])==1

def test_auto_feed_refresh_and_owner_auth(client,monkeypatch):
    assert client.post('/api/discovery/source',json={'url':'https://example.com'}).status_code==401
    owner=account(client)['user']['id']
    monkeypatch.setattr(network,'fetch',lambda url:(RSS,url))
    source=client.post('/api/objects/feed',json={'title':'自动测试','url':'https://example.com','type':'auto','enabled':True}).json()
    job=client.post('/api/radar/refresh',json={}).json()
    assert wait(owner,job)['status']=='done'
    assert s.get(owner,source['id'])['detected_type']=='rss'
    assert any(x['title']=='更新政策' for x in s.list_(owner,'news'))

def test_account_name_is_not_treated_as_article_search(monkeypatch):
    monkeypatch.setattr(network,'fetch',lambda _:pytest.fail('Names must not trigger article searches'))
    with pytest.raises(ValueError,match='文章链接'):discovery.discover_account('作者一','公众号')


def test_verification_page_must_never_be_saved_as_article(monkeypatch):
    monkeypatch.setattr(network,'fetch',lambda url:('<title>搜狗搜索</title><body>'+('请完成安全验证 '*70)+'</body>','https://weixin.sogou.com/antispider/?from=foo'))
    with pytest.raises(ValueError,match='验证'):network.article('https://weixin.sogou.com/link?id=1')
    with pytest.raises(ValueError,match='验证'):discovery.preview('https://weixin.sogou.com/link?id=1')

def test_preview_distinguishes_excerpt_and_metadata(monkeypatch):
    monkeypatch.setattr(network,'fetch',lambda url:('<title>文章</title><article>实际内容<script>bad()</script></article>',url))
    r=discovery.preview('https://example.com/a');assert r['status']=='excerpt' and r['body']=='实际内容'
    monkeypatch.setattr(network,'fetch',lambda url:('<title>搜索页</title><meta name="description" content="网页简介">',url))
    r=discovery.preview('https://example.com/a');assert r['status']=='summary' and r['body']=='网页简介'

def test_local_and_authenticated_urls_rejected(client):
    account(client)
    for url in ['http://127.0.0.1/private','http://user:pass@example.com','file:///C:/secret']:
        assert client.post('/api/discovery/source',json={'url':url}).status_code==400


def test_article_discovery_never_returns_mentions(monkeypatch):
    def fetch(url):
        if 'mp.weixin.qq.com' in url:
            return '<span id="js_name">作者一</span><script>var biz = "TARGET_BIZ";</script>',url
        return '<ul class="news-list"><li><h3><a href="/link?q=wrong">提及作者一的文章</a></h3><a class="account">其他作者</a></li></ul>',url
    monkeypatch.setattr(network,'fetch',fetch)
    result=discovery.discover_account('https://mp.weixin.qq.com/s/fixture','公众号')
    assert not any(x.get('author')=='其他作者' for x in result['items'])
    assert result.get('account',{}).get('biz')=='TARGET_BIZ'


def test_publisher_rechecked_before_batch_save(client,monkeypatch):
    owner=account(client)['user']['id']
    monkeypatch.setattr(network,'article',lambda url:{'title':'Wrong publisher','body':'Body','url':url,'publisher_biz':'OTHER_BIZ'})
    job=client.post('/api/import/batch',json={'urls':'https://mp.weixin.qq.com/s/fixture','expected_publisher_biz':'TARGET_BIZ'}).json()
    assert wait(owner,job)['status']=='failed'
    assert not any(x['title']=='Wrong publisher' for x in s.list_(owner,'source'))
