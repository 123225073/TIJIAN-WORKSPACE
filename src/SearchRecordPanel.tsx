import {useEffect,useState} from 'react';
import {api,type Item} from './api';
import {Media,assetUrl,type Asset} from './ResourcePreview';
import Markdown from './Markdown';

export default function SearchRecordPanel({id}:{id:string}){
 const [record,setRecord]=useState<Item|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setRecord(null);setError('');void api<{items:Item[]}>('/state/updates?ids='+encodeURIComponent(id)).then(response=>{
  if(!live)return;const row=response.items.find(x=>x.id===id&&!x.archived);if(!row)throw Error('这条记录已删除或不可用，请重新搜索');setRecord(row);
 }).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[id]);
 return <section className="aw-section search-record-panel" aria-label="搜索定位的记录" tabIndex={-1}>
  <header><strong>搜索定位的记录</strong><a href="#studio/works">返回全部作品</a></header>
  {error?<p role="alert">{error}</p>:!record?<p role="status">正在读取所选记录…</p>:<><h2>{record.title}</h2>{record.kind==='studio_asset'&&assetUrl(record as Asset)?<Media asset={record as Asset}/>:<Markdown text={record.body||record.text||record.input?.prompt||record.input?.brief||record.error||'本记录没有正文，请查看关联的原稿或素材。'}/>}</>}
 </section>;
}
