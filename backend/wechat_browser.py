"""Desktop rendered-page handoff; a challenge is completed by the user, never solved here."""
import threading,time,uuid
from . import store as s

PENDING={}
LOCK=threading.RLock()
TIMEOUT=600

def read(owner,item,cancel,progress):
    ticket={'id':uuid.uuid4().hex,'owner':owner,'url':item['url'],'title':item['title'],'event':threading.Event(),'cancel':cancel,'waiting':False}
    with LOCK:PENDING[ticket['id']]=ticket
    announced=False;deadline=time.monotonic()+TIMEOUT
    try:
        while not ticket['event'].wait(.25):
            if cancel.is_set():raise InterruptedError('已取消免费采集')
            if ticket['waiting'] and not announced:
                progress('等待你完成微信验证：请操作已弹出的微信窗口，完成后会自动继续');announced=True
            if time.monotonic()>deadline:
                cancel.set();raise InterruptedError('等待验证超时，队列已暂停；可重新勾选未保存文章继续')
        if ticket.get('cancelled'):
            cancel.set();raise InterruptedError('验证窗口已关闭，队列已取消')
        data=ticket.get('result',{})
        if data.get('error'):raise ValueError(str(data['error'])[:300])
        from .wechat import canonical
        _,key,biz=canonical(data.get('url',''))
        claimed=data.get('article_key') or key
        if claimed!=item['article_key'] or data.get('publisher_biz')!=item['biz'] or (biz and biz!=item['biz']):
            raise ValueError('浏览器当前文章与所选目录不一致，未保存')
        body=data.get('body','')
        if not isinstance(body,str) or not 100<=len(body)<=100000 or not data.get('publisher_name'):
            raise ValueError('浏览器未返回有效正文和发布账号，未保存')
        return {'title':str(data.get('title') or item['title'])[:500],'body':body,'url':item['url'],
                'published':item.get('published',''),'publisher_biz':item['biz'],'source_type':'微信浏览器正文（用户完成验证后读取）'}
    finally:
        with LOCK:PENDING.pop(ticket['id'],None)

def pending(owner):
    with LOCK:
        rows=[{k:x[k] for k in ['id','url','title']} for x in PENDING.values() if x['owner']==owner and not x['cancel'].is_set()]
    active=any(j.get('input',{}).get('mode')=='browser' and j.get('status') in ['queued','running'] for j in s.list_(owner,'job'))
    return {'items':rows,'active':active}

def accept(owner,id,data):
    with LOCK:
        ticket=PENDING.get(id)
        if not ticket or ticket['owner']!=owner or ticket['cancel'].is_set():raise s.Missing('此浏览器采集已结束')
        if data.get('waiting') is True:ticket['waiting']=True
        else:
            ticket['result']=data;ticket['cancelled']=data.get('cancelled') is True;ticket['event'].set()
    return {'ok':True}
