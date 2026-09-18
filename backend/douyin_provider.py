"""Pinned upstream API client + local page transport. No UI automation or credentials here."""
import asyncio
from types import SimpleNamespace
from vendor.douyin_downloader.api_client import DouyinAPIClient,LoginRequiredError

class PageBridge:
    def __init__(self,owner,bid,sec,event,progress,read,automatic=False):
        self.owner,self.bid,self.sec,self.event,self.progress,self.read,self.automatic=owner,bid,sec,event,progress,read,automatic
    async def fetch(self,path,params,method='GET',data=None):
        if self.event.is_set():raise InterruptedError('抖音任务已取消')
        if path not in ('/aweme/v1/web/aweme/post/','/aweme/v1/web/aweme/detail/') or method!='GET':raise ValueError('不支持的抖音读取接口')
        r=self.read(self.owner,{'action':'api','url':'https://www.douyin.com/user/'+self.sec,'sec_uid':self.sec,'benchmark_id':self.bid,'path':path,'params':params,'automatic':self.automatic},self.event,self.progress)
        status=int(r.get('http_status') or 0)
        # A page-network interruption is transient; reuse upstream's three-attempt backoff.
        if status==0:status=502
        if status in (401,403,429):raise ValueError('抖音接口暂时拒绝访问（HTTP '+str(status)+'）。请在抖音窗口确认登录或验证，稍后重试；没有将其当作空列表')
        if status not in (200,500,502,503,504):raise ValueError('抖音接口连接失败，请检查平台窗口与网络')
        return SimpleNamespace(http_status=status,body=r.get('body'),text=str(r.get('text') or '')[:100])

def normalized(raw,sec):
    author=raw.get('author') or {}
    if author.get('sec_uid')!=sec:return None
    stats=raw.get('statistics') or {};images=raw.get('images') or []
    return {'aweme_id':str(raw.get('aweme_id') or ''),'sec_uid':sec,'author':author.get('nickname',''),'description':raw.get('desc',''),'create_time':raw.get('create_time',0),'media_type':'images' if images else 'video','media_count':len(images) if images else 1,'metrics':{k:stats.get(v,0) for k,v in {'like':'digg_count','comment':'comment_count','share':'share_count','collect':'collect_count'}.items()}}

def collect(owner,bid,sec,limit,trigger,event,progress,read):
    async def run():
        client=DouyinAPIClient(PageBridge(owner,bid,sec,event,progress,read,trigger=='automatic'))
        out={};cursor=0;seen=set();finished=False
        for page in range(12):
            if event.is_set():raise InterruptedError('抖音任务已取消')
            progress(f'正在读取作品第 {page+1} 页 · 已取得 {len(out)} 条')
            result=await client.get_user_post(sec,max_cursor=cursor,count=min(20,limit-len(out)))
            if not result.get('raw') or not isinstance(result['raw'].get('aweme_list'),list) or result.get('status_code') or result.get('items_missing') or result.get('risk_flags',{}).get('verify_page'):raise ValueError('抖音未返回有效作品列表，可能是网络中断或平台验证；请打开抖音窗口检查后重试')
            for raw in result['items']:
                if not isinstance(raw,dict):continue
                row=normalized(raw,sec)
                if row:out[row['aweme_id']]=row
            if not result['has_more']:finished=True;break
            if len(out)>=limit:break
            next_cursor=result['max_cursor']
            if not next_cursor or next_cursor==cursor or next_cursor in seen:raise ValueError('抖音分页游标未前进，本次未标记为完整获取')
            seen.add(cursor);cursor=next_cursor
            await asyncio.sleep(.8)
        if not out:raise ValueError('平台未返回属于该博主的作品；请确认主页和可见权限，未把推荐作品混入')
        return {'items':list(out.values())[:limit],'coverage':'平台本次分页返回结束（不包含不可见作品）' if finished and len(out)<=limit else f'已按本次上限获取 {min(len(out),limit)} 条，非全量历史','provider':'jiji262/douyin-downloader@47f4eef · 页面接口分页'}
    try:return asyncio.run(run())
    except LoginRequiredError:raise ValueError('抖音登录已失效，请打开抖音窗口重新登录')

def detail(owner,bid,sec,aweme_id,event,progress,read):
    async def run():
        client=DouyinAPIClient(PageBridge(owner,bid,sec,event,progress,read))
        raw=await client.get_video_detail(aweme_id)
        if not raw or str(raw.get('aweme_id'))!=aweme_id or not normalized(raw,sec):raise ValueError('作品详情不可读取或作者不匹配，未下载')
    try:asyncio.run(run())
    except LoginRequiredError:raise ValueError('抖音登录已失效，请打开抖音窗口重新登录')
