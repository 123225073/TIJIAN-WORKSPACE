import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ArticleEditor from '../src/ArticleEditor';
import TaskWorkspace from '../src/TaskWorkspace';
import WechatArticleForm from '../src/WechatArticleForm';
import {api} from '../src/api';

function Harness(){
 const fixture=(window as any).articleFixture;
 const [state,setState]=useState(fixture.state),[error,setError]=useState(''),[draft,setDraft]=useState(fixture.content);
 const refresh=async()=>{const next=await api('/state');setState(next)};
 const t:any={state,task:{...fixture.task,platform_outcomes:{wechat:fixture.content.id},active_outcome:'wechat'},get:(id:string)=>state.objects.find((x:any)=>x.id===id),list:(kind:string)=>state.objects.filter((x:any)=>x.kind===kind),opts:()=>[],refresh,setError,action:async(fn:any)=>{try{await fn();await refresh()}catch(e:any){setError(e.message)}},setNotice:()=>{}};
 (window as any).articleRefresh=refresh;
 return <><button onClick={()=>void refresh()}>测试刷新</button>{error&&<p role="alert">{error}</p>}{fixture.mode==='platform'?<TaskWorkspace {...t}/>:fixture.mode==='wechat'?<WechatArticleForm draft={draft} assets={state.objects.filter((x:any)=>x.kind==='studio_asset')} busy={false} generating={false} onChange={(key,value)=>setDraft((v:any)=>({...v,[key]:value}))} onSave={()=>{}} onDownload={()=>{}} onOptimize={()=>{}} onCreateCover={()=>{}} onAssetsChanged={refresh} worksHref="studio/works"/>:<ArticleEditor asset={t.get(fixture.content.id)} t={t}/>}<pre data-testid="draft">{JSON.stringify(draft)}</pre></>;
}
flushSync(()=>createRoot(document.getElementById('root')!).render(<Harness/>));
