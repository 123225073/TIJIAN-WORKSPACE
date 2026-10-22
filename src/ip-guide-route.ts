export function ipGuideRoute({task='',target='',session='',model=''}:{task?:string;target?:string;session?:string;model?:string}={}){
 const params=new URLSearchParams();
 if(task)params.set('task',task);
 if(target)params.set('target',target);
 if(session)params.set('session',session);
 if(model)params.set('model',model);
 return 'studio/ip-guide'+(params.size?'?'+params.toString():'');
}
