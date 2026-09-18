"""Isolated UI fixture; no real platform session, remote write or paid request."""
import os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import weread as r,wechat as w,network,store as s
from backend.app import app
import uvicorn
state={'new':False,'calls':0}
@app.post('/fixture/new')
def new():state['new']=True;return state
@app.get('/fixture/stats')
def stats():return state
@app.post('/fixture/expired')
def expired():
    for u in s.all_users():s.set_config('weread.auth_error:'+u['id'],'登录失效（隔离测试）')
    return {'ok':True}
app.router.routes[:]=app.router.routes[-3:]+app.router.routes[:-3]
def request(owner,path,params):
    state['calls']+=1
    if path.endswith('/articles'):
        return {'reviews':[{'createTime':time.time()+5,'subReviews':[{'review':{'reviewId':'MP_WXS_3223096120_article_'+str(n),'mpInfo':{'originalId':'article_'+str(n),'title':'免费测试文章'+str(n)}}}]} for n in ([2,1] if state['new'] else [1])]}
    return '<div id="js_content">'+'这是隔离测试文章正文。'*80+params['reviewId']+'</div>'
r.request=request
w.paid=lambda *a,**k:(_ for _ in ()).throw(ValueError('Unexpected paid request in free test'))
network.fetch=lambda url:('<div id="js_name">免费订阅测试号</div><script>var biz="MzIyMzA5NjEyMA==";</script>',url)
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
