import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api} from '../src/api';
import {ProfileFromTask} from '../src/ProfileFromTask';
import PersonalIP from '../src/PersonalIP';
import TopicFromTask from '../src/TopicFromTask';
import '../src/style.css';
import '../src/studio.css';

function Harness(){
 const seed=(window as any).ipFixture;
 const [state,setState]=useState<any>(null),[route,setRoute]=useState(location.hash),[form,setForm]=useState<any>(null),[values,setValues]=useState<any>({}),[error,setError]=useState(''),[toast,setToast]=useState('');
 const refresh=async()=>setState(await api('/state'));
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),400);const navigate=()=>setRoute(location.hash);window.addEventListener('hashchange',navigate);return()=>{clearInterval(timer);window.removeEventListener('hashchange',navigate)}},[]);
 if(!state)return <p>正在读取隔离数据</p>;
 const list=(kind:string)=>state.objects.filter((x:any)=>x.kind===kind&&!x.archived),get=(id:string)=>state.objects.find((x:any)=>x.id===id);
 const openForm=(next:any)=>{setValues(Object.fromEntries(next.fields.map((x:any)=>[x.key,x.value||''])));setError('');setForm(next)};
 const t:any={state,list,get,refresh,setToast,setForm:openForm,editItem:(item:any,fields:any[])=>openForm({title:'编辑档案',fields:fields.map(x=>({...x,value:item[x.key]})),action:async(data:any)=>api('/objects/'+item.id,{...data,version:item.version},'PATCH')}),newItem:(kind:string,title:string,fields:any[],initial:any)=>openForm({title,fields,action:async(data:any)=>api('/objects/'+kind,{...initial,...data})})};
 const task=get(seed.task_id);
 return <main className="ip-test-root" style={{maxWidth:1120,padding:24,margin:'auto'}}>{toast&&<p role="status">{toast}</p>}{route.startsWith('#studio/brand')?<PersonalIP t={t} assets={[]}/>:<><ProfileFromTask t={t} task={task} mode="profile" modelId=""/><TopicFromTask t={t} task={task}/></>}{form&&<div role="dialog" aria-label={form.title}><h2>{form.title}</h2>{form.fields.map((field:any)=><label style={{display:'block'}} key={field.key}>{field.label}{field.type==='textarea'?<textarea aria-label={field.label} value={values[field.key]} onChange={e=>setValues({...values,[field.key]:e.target.value})}/>:<input aria-label={field.label} value={values[field.key]} onChange={e=>setValues({...values,[field.key]:e.target.value})}/>}</label>)}<button onClick={()=>void (async()=>{try{await form.action(values);setForm(null);await refresh()}catch(e:any){setError(e.message)}})()}>{form.submit||'保存'}</button>{error&&<p role="alert">{error}</p>}</div>}</main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
