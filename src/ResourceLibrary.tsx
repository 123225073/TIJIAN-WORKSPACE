import {FolderOpen,Plus,RefreshCw,ArrowRight,Check} from 'lucide-react';
import {CloneAssetPreview,cloneConfirmed,type Asset} from './ResourcePreview';
import HiflyBilling from './HiflyBilling';

export default function ResourceLibrary({kind,assets,folder,onFolder,query,onQuery,loading,busy,syncing,onSync,createHref,defaults,onDefault,onUse,actions}:{
 kind:string;assets:Asset[];folder:'mine'|'public'|'all';onFolder:(value:'mine'|'public'|'all')=>void;
 query:string;onQuery:(value:string)=>void;loading:boolean;busy:boolean;syncing:boolean;
 onSync:()=>void;createHref:string;defaults:Record<string,string|null>;onDefault:(asset:Asset)=>void;
 onUse?:((asset:Asset)=>void);actions:(asset:Asset)=>React.ReactNode;
}){
 const label=kind==='avatar'?'形象':'声音',resourceKey=kind+'_id';
 const current=assets.filter(a=>!a.archived&&!a.deleted),owned=current.filter(a=>a.visibility!=='public'),publicAssets=current.filter(a=>a.visibility==='public');
 const choices=(folder==='mine'?owned:folder==='public'?publicAssets:[...owned,...publicAssets]).filter(a=>String(a.title||a.name||'').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <section className="st-resource-library" aria-label={'飞影'+label+'资源库'}>
  <header className="st-section-head st-resource-library-head"><div><h2>{kind==='avatar'?'可复用的出镜形象':'可复用的声音'}</h2><p>先选自己的资产，也可以使用飞影公共{label}。</p></div><div className="st-inline"><button disabled={busy||syncing} onClick={onSync}><RefreshCw size={16} className={syncing?'st-spin':''}/>{syncing?'同步中…':'同步飞影公共资源'}</button><a className="st-primary" href={createHref}><Plus size={16}/>创建{label}</a></div></header>
  <HiflyBilling/>
  <div className="st-resource-browser">
   <nav className="st-resource-folders" aria-label={label+'文件夹'}><span>资源文件夹</span>{([['mine','我的'+label,owned.length],['public','公共'+label,publicAssets.length],['all','全部资源',current.length]] as const).map(([value,title,count])=><button key={value} aria-pressed={folder===value} onClick={()=>onFolder(value)}><FolderOpen size={16}/><b>{title}</b><small>{count}</small></button>)}</nav>
   <div className="st-resource-results"><div className="st-resource-toolbar"><input className="st-search" value={query} onChange={e=>onQuery(e.target.value)} aria-label="搜索资源" placeholder={'搜索'+label+'名称…'}/><small>{choices.length} 个{label}</small></div>
    <div className="st-asset-grid">{choices.map(asset=><article className="st-asset-card st-resource-card" key={asset.id}>
     <CloneAssetPreview asset={asset} compact/>
     <h3>{asset.title||asset.name||'未命名资源'}{defaults[resourceKey]===asset.id&&<small className="st-default-badge"><Check size={12}/>默认</small>}</h3>
     <p><span className="st-status">{asset.resource_selectable===false?'当前不可用':cloneConfirmed(asset)?'克隆完成 · 可复用':asset.status==='ready'?'可用':asset.status==='failed'?'创建失败':'处理中'}</span><small>{asset.visibility==='public'?'飞影公共资源':'我的专属资产'}</small></p>
     {asset.resource_selectable===false&&<small className="st-clone-source-label">{asset.resource_unavailable_reason||'当前飞影账号不能使用此资源'}</small>}
     <div className="st-resource-choice-actions"><button type="button" aria-pressed={defaults[resourceKey]===asset.id} disabled={busy||asset.status!=='ready'||asset.resource_selectable===false} onClick={()=>onDefault(asset)}>{defaults[resourceKey]===asset.id?'取消默认':'设为默认'}</button>{onUse&&<button type="button" className="st-primary" disabled={busy||asset.status!=='ready'||asset.resource_selectable===false} onClick={()=>onUse(asset)}>使用并返回原稿<ArrowRight size={14}/></button>}</div>
     {actions(asset)}
    </article>)}</div>
    {!choices.length&&<div className="st-empty compact"><FolderOpen size={32}/><h3>{loading?'正在读取资源…':query?'没有匹配的资源':folder==='public'?'还没有公共'+label:'还没有我的'+label}</h3><p>{query?'换一个名称试试。':folder==='public'?'点击同步飞影公共资源。':'创建后会保存在这里，也可从左侧查看公共资源。'}</p></div>}
   </div>
  </div>
 </section>;
}
