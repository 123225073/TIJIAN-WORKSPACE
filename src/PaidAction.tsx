import {useEffect,useRef,useState} from 'react';

type Request={title:string;description:string;run:()=>void};
export function usePaidAction(){
 const [request,setRequest]=useState<Request|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),pending=useRef(false);
 useEffect(()=>{if(request){dialog.current?.showModal();return()=>dialog.current?.close()}},[request]);
 const cancel=()=>{pending.current=false;setRequest(null)};
 const confirm=(title:string,description:string,run:()=>void)=>{if(pending.current)return;pending.current=true;setRequest({title,description,run})};
 const modal=request&&<dialog ref={dialog} className="paid-confirm" aria-labelledby="paid-title" onCancel={cancel} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(e.target===e.currentTarget&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))cancel()}}>
  <span className="section-number">次幂付费操作</span><h2 id="paid-title">{request.title}</h2>
  <p style={{whiteSpace:'pre-line'}}>{request.description}</p>
  <p className="local-warning">这会调用次幂付费接口并可能扣费。未发现新文章、筛选未命中或请求失败，也可能产生费用。金额为参考估算，以次幂实际账单为准。</p>
  <a href="https://www.showdoc.com.cn/2265380957870963/11559023150418150" target="_blank" rel="noreferrer">查看官方报价</a>
  <div className="modal-footer"><button autoFocus onClick={cancel}>取消，不调用</button><button className="primary" onClick={()=>{if(!pending.current)return;const run=request.run;cancel();run()}}>确认扣费并继续</button></div>
 </dialog>;
 return {confirm,modal};
}
