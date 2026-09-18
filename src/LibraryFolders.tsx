import {FolderOpen,Plus} from 'lucide-react';
import {api,type Item} from './api';
import {DeleteRecord} from './DeleteRecord';
import {folderDescendants} from './ReferencePicker';

export function LibraryFolders({t,kind,value,onChange,selected,onMoved}:any){
 const folders=t.list('folder').filter((x:Item)=>x.library===kind) as Item[];
 const current=folders.find(x=>x.id===value);
 const fields=(x?:Item)=>[{key:'title',label:'文件夹名称',required:true}, {key:'parent_id',label:'上级文件夹',options:[{value:'',label:'顶层'},...folders.filter(f=>!x||!folderDescendants(folders,x.id).has(f.id)).map(f=>({value:f.id,label:f.title}))]}];
 const tree=(parent:string,depth=0):any=>folders.filter(x=>(x.parent_id||'')===parent).map(f=><div key={f.id}><button className={'folder-item '+(value===f.id?'active':'')} style={{paddingLeft:12+depth*14}} onClick={()=>onChange(f.id)}><FolderOpen size={15}/><span>{f.title}</span><small>{t.list(kind).filter((x:Item)=>folderDescendants(folders,f.id).has(x.folder_id)).length}</small></button>{depth<20&&tree(f.id,depth+1)}</div>);
 return <aside className="library-folders"><div className="block-heading"><strong>文件夹</strong><button aria-label="新建文件夹" onClick={()=>t.newItem('folder','新建文件夹',fields(),{library:kind,parent_id:value||undefined})}><Plus size={16}/></button></div><button className={'folder-item '+(!value?'active':'')} onClick={()=>onChange('')}><FolderOpen size={15}/>全部内容</button><button className={'folder-item '+(value==='unfiled'?'active':'')} onClick={()=>onChange('unfiled')}>未分类</button>{tree('')}{current&&<div className="folder-controls"><button onClick={()=>t.editItem(current,fields(current))}>编辑文件夹</button><DeleteRecord item={current} t={t} compact onDeleted={()=>onChange('')}/></div>}{selected.length>0&&<div className="folder-move"><strong>已选 {selected.length} 条</strong><select aria-label="移动到文件夹" defaultValue="" onChange={e=>{const target=e.target.value;if(!target)return;t.action(async()=>{await api('/library/move',{ids:selected,folder_id:target==='unfiled'?null:target});onMoved()},'已移动所选内容');e.target.value=''}}><option value="">移动到…</option><option value="unfiled">未分类</option>{folders.map(f=><option key={f.id} value={f.id}>{f.title}</option>)}</select></div>}<p className="muted">文件夹用于分类，不移动或改写原始文件。</p></aside>
}
