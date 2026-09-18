export type Item = {id:string; kind:string; title:string; version:number; updated:string; [key:string]:any};
export type State = {user:{id:string;name:string;email:string;role:string};objects:Item[];workspace:string|null;models:any[];skills:any[];bindings:Record<string,string>;preferences:Record<string,string>;settings:Record<string,any>};
let token=sessionStorage.getItem('tijian-session')||'';
export const hasToken=()=>!!token;
export const getToken=()=>token;
export const setToken=(value:string)=>{token=value;sessionStorage.setItem('tijian-session',value);if(!value)void (window as any).tijianDesktop?.rememberLogin({action:'clear'}).catch(()=>{});};
export async function api<T=any>(path:string,body?:any,method?:string):Promise<T>{
 const write=(method||(body?'POST':'GET'))!=='GET'&&!path.endsWith('/references')&&!path.includes('/auth/');
 const operation={id:crypto.randomUUID(),route:location.hash.slice(1)||'home',label:(document.activeElement?.closest('button')?.textContent||'处理操作').trim().slice(0,60),pending:true};
 const notify=(changes:any)=>{if(write)window.dispatchEvent(new CustomEvent('operation',{detail:{...operation,...changes}}))};notify({});
 try{
 const r=await fetch('/api'+path,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body?body instanceof FormData?body:JSON.stringify(body):undefined});
 if(!r.ok){const d=await r.json().catch(()=>({}));if(r.status===401){setToken('');window.dispatchEvent(new Event('session-expired'));}throw new Error(typeof d.detail==='string'?d.detail:Array.isArray(d.detail)?d.detail.map((x:any)=>String(x.loc?.at(-1)||'输入')+'：'+(x.type==='string_too_short'?'长度不足，请按字段要求填写':x.msg)).join('；'):'请求失败，请检查输入');}const data=await r.json();notify({pending:false,job:data?.kind==='job'?data:undefined});return data;
 }catch(e){notify({pending:false,error:(e as Error).message});throw e}
}
export async function download(path:string,name:string){const r=await fetch('/api'+path,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('导出失败');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
export async function exportedHTML(id:string){const r=await fetch('/api/content/'+id+'/export?format=html',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('排版导出失败');return r.text();}

export async function restoreLogin(){const saved=await (window as any).tijianDesktop?.rememberLogin({action:"read"});if(saved?.token){setToken(saved.token);try{await api("/state")}catch{setToken("")}}}
