import {useState} from 'react';
import {FolderOpen,Check} from 'lucide-react';
import {StudioModal} from './AssetPicker';
import {CloneAssetPreview,type Asset} from './ResourcePreview';

export default function HumanResourcePicker({kind,items,value,onSelect,onClose,onManage}:{kind:string;items:Asset[];value:string;onSelect:(asset:Asset)=>void;onClose:()=>void;onManage:()=>void}){
 const [query,setQuery]=useState(''),label=kind==='avatar'?'形象':'声音';
 const choices=items.filter(a=>(kind!=='avatar'||a.visibility!=='public')&&String(a.title||a.name||'').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <StudioModal title={'选择'+label} onClose={onClose}><div className="st-resource-picker-tools"><input autoFocus aria-label={'搜索'+label} placeholder={'搜索'+label+'名称…'} value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" onClick={onManage}><FolderOpen size={14}/>管理{label}</button></div><div className="st-resource-picker-groups">{(['mine','public'] as const).filter(group=>kind!=='avatar'||group==='mine').map(group=>{const assets=choices.filter(a=>(a.visibility==='public')===(group==='public'));return assets.length?<section key={group}><h3>{group==='mine'?'我的'+label:'公共声音'}</h3><div className="st-resource-picker-grid">{assets.map(asset=><article key={asset.id}><CloneAssetPreview asset={asset} compact/><strong>{asset.title||asset.name||'未命名'+label}</strong><button type="button" className="st-primary" onClick={()=>onSelect(asset)}>{value===asset.id?<><Check size={14}/>已选择</>:'使用这个'+label}</button></article>)}</div></section>:null})}{!choices.length&&<p className="st-muted">{query?'没有匹配的'+label:'还没有可用'+label+'，可以先创建。'}</p>}</div></StudioModal>;
}
