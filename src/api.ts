export type Item = {id:string; kind:string; title:string; version:number; updated:string; [key:string]:any};
export type State = {user:{id:string;name:string;email:string;role:string};objects:Item[];workspace:string|null;models:any[];skills:any[];bindings:Record<string,string>;preferences:Record<string,string>;settings:Record<string,any>};
const adminSession=location.pathname==='/admin'||location.pathname==='/admin.html'||location.pathname.startsWith('/admin/');
const sessionKey=adminSession?'tijian-admin-session':'tijian-session';
let token=sessionStorage.getItem(sessionKey)||'';
export const hasToken=()=>!!token;
export const getToken=()=>token;
export const setToken=(value:string)=>{token=value;sessionStorage.setItem(sessionKey,value);if(!value&&!adminSession)void (window as any).tijianDesktop?.rememberLogin({action:'clear'}).catch(()=>{});};
const operationLabel=(path:string)=>{
 if(path.includes('/topics/generate'))return '生成选题建议';
 if(path.includes('/deliveries/')&&path.endsWith('/generate'))return '生成平台交付稿';
 if(path.endsWith('/studio/deliveries'))return '创建平台交付稿';
 if(path.includes('/studio/deliveries/'))return '保存平台交付稿';
 if(path.startsWith('/studio/topics'))return '保存选题';
 if(path.includes('/studio/flow'))return '保存创作步骤';
 if(path.includes('/admin/bindings'))return '保存功能模型绑定';
 if(path.includes('/admin/providers'))return '配置模型平台';
 if(path.includes('/admin/system-library'))return '管理系统知识库';
 if(path.includes('/tasks/')&&path.endsWith('/send'))return '生成对话回复';
 if(path.includes('/prompt')&&path.includes('optimize'))return '优化提示词';
 if(path.includes('/import/'))return '导入资料';
 if(/^\/studio\/runs\/[^/]+\/refresh$/.test(path))return '核查生成任务';
 if(path.includes('/refresh'))return '获取最新资料';
 if(path.includes('/probe')||path.includes('/test'))return '测试连接';
 if(path.includes('/generate'))return '生成内容';
 if(path.includes('/archive'))return '归档资料';
 return '保存操作';
};
const operation=(detail:Record<string,unknown>)=>window.dispatchEvent(new CustomEvent('operation',{detail:{...detail,at:Date.now()}}));
export async function trackOperation<T>(label:string,run:()=>Promise<T>):Promise<T>{
 const id=crypto.randomUUID(),route=location.hash.slice(1)||'studio/home';
 operation({id,route,label,pending:true});
 try{const result=await run();operation({id,route,label,pending:false});return result}
 catch(e){operation({id,route,label,pending:false,error:e instanceof Error?e.message:'操作失败'});throw e}
}
export async function api<T=any>(path:string,body?:any,method?:string):Promise<T>{
 // These pages show their own progress and errors beside the action.
 const verb=method||(body?'POST':'GET'),backgroundWrite=['/studio/flow','/studio/upload'].includes(path)||/^\/studio\/(?:text\/)?drafts(?:\/|$)/.test(path)||/^\/studio\/runs\/[^/]+\/refresh$/.test(path)||/^\/studio\/deliveries(?:\/|$)/.test(path)&&!path.endsWith('/generate')||path.startsWith('/wechat-publish/');
 const tracked=verb!=='GET'&&!!token&&!path.startsWith('/auth/')&&!backgroundWrite,id=tracked?crypto.randomUUID():'',route=location.hash.slice(1)||'studio/home',label=operationLabel(path);
 if(tracked)operation({id,route,label,pending:true});
 try{
  const r=await fetch('/api'+path,{method:verb,headers:{Authorization:'Bearer '+token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body?body instanceof FormData?body:JSON.stringify(body):undefined});
  if(!r.ok){const d=await r.json().catch(()=>({}));if(r.status===401){setToken('');window.dispatchEvent(new Event('session-expired'));}const failure=new Error(typeof d.detail==='string'?d.detail:Array.isArray(d.detail)?d.detail.map((x:any)=>String(x.loc?.at(-1)||'输入')+'：'+(x.type==='string_too_short'?'长度不足，请按字段要求填写':x.msg)).join('；'):'请求失败，请检查输入') as Error&{status:number};failure.status=r.status;throw failure;}
  const result=await r.json();
  if(tracked)operation({id,route,label,pending:false,...(result?.kind==='job'?{job:result}:{})});
  return result;
 }catch(e){if(tracked)operation({id,route,label,pending:false,error:e instanceof Error?e.message:'操作失败'});throw e;}
}
export async function download(path:string,name:string){return trackOperation('导出文件',async()=>{const r=await fetch('/api'+path,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('导出失败');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)})}
export async function exportedHTML(id:string){return trackOperation('读取排版文稿',async()=>{const r=await fetch('/api/content/'+id+'/export?format=html',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('排版导出失败');return r.text()})}

export async function restoreLogin(){if(adminSession)return;const saved=await (window as any).tijianDesktop?.rememberLogin({action:"read"});if(saved?.token){setToken(saved.token);try{await api("/state")}catch{setToken("")}}}
