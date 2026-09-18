import {KnowledgeJobResult,knowledgeJob} from './KnowledgeFlow';
import {useState} from 'react';
import type {Item} from './api';
import Markdown from './Markdown';

export const jobFailed=(j:Item)=>j.status==='failed'||j.status==='done'&&j.result?.failed>0&&j.result?.success===0;
export const jobStatus=(j:Item)=>jobFailed(j)?'失败':({queued:'排队中',running:'进行中',done:j.result?.failed||j.result?.body_failed?'部分成功':'已完成',interrupted:'已中断',cancelled:'已取消'} as Record<string,string>)[j.status]||j.status;
export const jobSummary=(j:Item)=>j.result?.douyin?`成功 ${j.result.success||0} 条 · 失败 ${j.result.failed||0} 条${j.result.added!=null?' · 新发现 '+j.result.added+' 条':''}`:j.result?.radar?`新增 ${j.result.added||0} 条 · 检查 ${j.result.sources?.length||0} 个信源 · ${j.result.failed||0} 个需处理`:['queued','running'].includes(j.status)?j.progress:j.result?.success!=null&&j.result?.failed!=null?`成功 ${j.result.success} 篇 · 失败 ${j.result.failed} 篇`:j.result?.provider==='weread'?`发现 ${j.result.added||0} 篇 · 保存 ${j.result.saved||0} 篇 · 正文失败 ${j.result.body_failed||0} 篇`:j.error||(knowledgeJob(j)&&j.status==='done'?(j.result?.summary||`提炼结束 · ${j.result?.count||0} 条新增建议，请查看结果并确认`):j.progress);

export function SavedArticle({source}:{source?:Item}){
 const [open,setOpen]=useState(false);
 if(!source||source.archived)return null;
 return <div className="saved-article"><a href={'#knowledge/source/'+source.id}>打开已保存资料 →</a><button onClick={()=>setOpen(!open)}>{open?'收起正文':'查看已保存正文'}</button>{open&&<article className="saved-body"><h3>{source.title}</h3><Markdown text={source.body||'正文文件暂不可读，请在文章资料中检查。'}/></article>}</div>;
}
export function CollectionResult({job,getSource}:{job:Item;getSource?:(id:string)=>Item|undefined}){
 if(job.result?.douyin)return <div className="collection-result"><p>{jobSummary(job)}</p><p>{job.result.coverage}</p>{job.result.items.map((x:any,i:number)=><p key={i}>{x.title} · {x.status==='done'?'下载完成':'失败'} {x.reason||''}</p>)}</div>;
 if(job.result?.radar)return <div className="radar-source-results">{job.result.sources.map((r:any)=><p key={r.feed_id}><strong>{r.title}</strong> · 发现 {r.found} / 新增 {r.added} · {r.note}</p>)}</div>;
 if(knowledgeJob(job))return <KnowledgeJobResult job={job} get={getSource||(()=>undefined)}/>;
 return <section className="collection-result" aria-label="逐篇采集结果">
  <p role="status"><strong>{jobStatus(job)} · {jobSummary(job)}</strong></p>
  {job.result?.source_id&&<SavedArticle source={getSource?.(job.result.source_id)}/>}
  {job.result?.content_id&&<p><a href={'#task/'+(job.task_id||getSource?.(job.result.content_id)?.task_id||'')}>打开生成的稿件 →</a></p>}
  {job.result?.coverage&&<p className="muted">{job.result.coverage}</p>}
  {job.result?.failed_platforms?.length>0&&<p className="form-error">未成功更新：{job.result.failed_platforms.join('、')}</p>}
  {job.input?.action==='wechat_body'&&<p className="muted">{job.input?.mode==='cimidata'?'本次使用经确认的次幂付费正文接口；已有正文复用，失败不会自动重试。':job.input?.mode==='browser'?'本次使用免费浏览器采集，微信验证由用户在弹出的窗口完成，完成后自动继续。':'本次通过公开页面读取，不收次幂费用。遇到平台验证停止同批请求，可在桌面版完成验证后采集。'}</p>}
  {job.result?.items?.map((row:any,i:number)=><div className="collection-result-row" key={row.url||i}>
   <strong>{row.title||row.url||`第 ${i+1} 项`}</strong><p className={row.status==='failed'?'form-error':''}>{row.status==='done'?'正文已保存':row.status==='failed'?'采集失败':row.status}{row.reason&&` · ${row.reason}`}</p>
   {row.status==='done'&&<SavedArticle source={getSource?.(row.source_id)}/>}
   {row.url&&/^https?:\/\//i.test(row.url)&&<a href={row.url} target="_blank" rel="noreferrer">打开原文</a>}
  </div>)}
 </section>;
}
