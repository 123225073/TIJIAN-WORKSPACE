import pytest
from backend import wechat as w,store as s
from test_wechat import setup,article
from test_workflows import client,account

def test_conversion_consent_cache_and_body_retry(client,setup,monkeypatch):
 owner,b,a,calls,pages=setup
 item=w.ingest(owner,[w.normalize(article(1),a)])[0];requests=[]
 def response(path,body,token=''):
  if path.endswith('/token'):return {'access_token':'test-token'}
  requests.append((path,body))
  if path.endswith('long2short'):return {'url':'https://mp.weixin.qq.com/s/cached-short'}
  raise ValueError('Explicit body failure')
 monkeypatch.setattr(w,'request',response)
 with pytest.raises(ValueError,match='重新确认'):w.provider_body(owner,item)
 assert requests==[]
 with pytest.raises(ValueError,match='Explicit body failure'):w.provider_body(owner,item,True)
 saved=s.get(owner,item['id']);assert saved['short_url'].endswith('/cached-short')
 assert [r[0] for r in requests]==['/api/v2/articles/long2short','/api/v3/articles/detail']
 with pytest.raises(ValueError):w.provider_body(owner,saved,True)
 assert len(requests)==3 and requests[-1][0].endswith('/detail')

def test_conversion_invalid_destination_stops_body(client,setup,monkeypatch):
 owner,b,a,calls,pages=setup;item=w.ingest(owner,[w.normalize(article(1),a)])[0];requests=[]
 def response(path,body,token=''):requests.append(path);return {'url':'https://example.test/unsafe'}
 monkeypatch.setattr(w,'request',response)
 with pytest.raises(ValueError):w.provider_body(owner,item,True)
 assert requests==['/api/v2/articles/long2short']
 assert not s.get(owner,item['id']).get('short_url')
