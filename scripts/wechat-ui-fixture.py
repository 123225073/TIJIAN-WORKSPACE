"""Isolated UI contract fixture; never points at the user's database or a paid API."""
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import wechat as w, network
from backend.app import app
import uvicorn

fixture={'paid':0,'blocked':True}
@app.get('/fixture/stats')
def fixture_stats():return fixture
@app.post('/fixture/unblock')
def fixture_unblock():fixture['blocked']=False;return fixture
app.router.routes[:]=app.router.routes[-2:]+app.router.routes[:-2]

def request(path,body,token=''):
    if path.endswith('/token'):
        if body['app_id']!='ui-fixture-id' or body['app_secret']!='ui-fixture-secret':raise ValueError('测试凭据不匹配')
        return {'access_token':'fixture-token'}
    fixture['paid']+=1
    if path.endswith('/long2short'):return {'url':'https://mp.weixin.qq.com/s/converted-'+str(fixture['paid'])}
    if path.endswith('/detail'):return {'html':'<div id="js_content">'+('明确隔离测试正文。'*80)+body['url']+'</div>'}
    if path.endswith('/info'):return {'account':{'biz':'UI_BIZ','wxid':'gh_ui_fixture','nickname':'界面验收公众号'}}
    if path.endswith('/history'):
        cursor=body.get('last_id','');offset=2 if cursor else 0
        return {'items':[{'title':'电梯更新政策 '+str(i+1),'published_at':'2026-09-16T09:00:00',
                         'content_url':f'https://mp.weixin.qq.com/s?__biz=UI_BIZ&mid={i+1}&idx=1&sn=fixture'} for i in range(offset,offset+2)],
                'last_id':None if cursor else 'second-page'}
    raise ValueError('未定义的测试端点')

w.request=request
def body(url):
    if fixture['blocked']:raise ValueError('未读取到文章正文，可能遇到平台验证、访问限制或页面失效；可打开原文确认，或导入文稿。未保存验证页面')
    return {'title':'电梯更新政策正文','body':'此为隔离验收数据。'*80+url,'publisher_biz':'UI_BIZ','url':url,'published':'2026-09-16'}
network.article=body
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
