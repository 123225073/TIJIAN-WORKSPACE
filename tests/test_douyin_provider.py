"""Exercise the vendored upstream client through the actual local adapter."""
import threading
import pytest
from backend import douyin_provider as p

SEC='MS4wLjABAAAA_publisher'
def raw(id='123456',sec=SEC):
    return {'aweme_id':id,'author':{'sec_uid':sec,'nickname':'账号'},'desc':'文案','create_time':123,'statistics':{'digg_count':4}}

@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    async def sleep(*args):pass
    monkeypatch.setattr(p.asyncio,'sleep',sleep)

def collect(read,limit=30):return p.collect('owner','benchmark',SEC,limit,'manual',threading.Event(),lambda text:None,read)

def test_real_client_paginates_deduplicates_and_scopes_author():
    calls=[]
    def read(owner,ticket,*args):
        calls.append(ticket)
        cursor=ticket['params']['max_cursor']
        return {'http_status':200,'body':{'status_code':0,'aweme_list':[raw(),raw('987654','other')] if cursor==0 else [raw(),raw('234567')],'has_more':1 if cursor==0 else 0,'max_cursor':42}}
    result=collect(read)
    assert [x['aweme_id'] for x in result['items']]==['123456','234567']
    assert [x['params']['max_cursor'] for x in calls]==[0,42]
    assert all(x['params']['sec_user_id']==SEC for x in calls)
    assert '分页返回结束' in result['coverage']

def test_stuck_cursor_is_not_complete():
    with pytest.raises(ValueError,match='游标'):
        collect(lambda *args:{'http_status':200,'body':{'aweme_list':[raw()],'has_more':1,'max_cursor':0}})

@pytest.mark.parametrize('body',[{}, {'aweme_list':None}, {'aweme_list':[]}, {'aweme_list':[raw()],'verify_ticket':'verification'}])
def test_missing_empty_and_challenge_are_not_success(body):
    with pytest.raises(ValueError):collect(lambda *args:{'http_status':200,'body':body})

def test_upstream_bounded_retry_and_no_auth_retry():
    calls=[]
    def read(*args):
        calls.append(1)
        return {'http_status':503,'body':None} if len(calls)<3 else {'http_status':200,'body':{'aweme_list':[raw()],'has_more':0}}
    assert collect(read)['items'] and len(calls)==3
    calls.clear()
    def denied(*args):calls.append(1);return {'http_status':403,'body':None}
    with pytest.raises(ValueError,match='HTTP 403'):collect(denied)
    assert len(calls)==1

def test_detail_refresh_requires_same_author():
    def read(*args):return {'http_status':200,'body':{'aweme_detail':raw()}}
    p.detail('owner','benchmark',SEC,'123456',threading.Event(),lambda _:None,read)
    with pytest.raises(ValueError,match='作者不匹配'):
        p.detail('owner','benchmark',SEC,'123456',threading.Event(),lambda _:None,lambda *args:{'http_status':200,'body':{'aweme_detail':raw(sec='other')}})
