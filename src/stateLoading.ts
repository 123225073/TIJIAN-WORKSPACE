import type {Item,State} from './api';

function sameObject(previous:Item|undefined,next:Item):boolean{
 return !!previous&&!previous.summary_only&&previous.version===next.version&&previous.updated===next.updated;
}

// Keep object identities stable across reads so unchanged drafts and effects do
// not reset. Never let a slower snapshot replace a newer job update.
export function mergeObjects(previous:Item[],incoming:Item[],partial=false,requestStarted?:number):Item[]{
 const known=new Map(previous.map(x=>[x.id,x]));
 const items=incoming.map(next=>{
  const old=known.get(next.id);known.delete(next.id);
  return old&&(old.version>next.version||old.version===next.version&&old.updated>next.updated||sameObject(old,next))?old:next;
 });
 if(partial)items.push(...known.values());
 else if(requestStarted!==undefined)items.push(...[...known.values()].filter(x=>Date.parse(x.updated)>requestStarted));
 items.sort((a,b)=>b.updated.localeCompare(a.updated));
 return items.length===previous.length&&items.every((x,i)=>x===previous[i])?previous:items;
}

export function reconcileState(previous:State|null,next:State,requestStarted?:number):State{
 if(!previous||previous.user.id!==next.user.id)return next;
 const objects=mergeObjects(previous.objects,next.objects,false,requestStarted);
 const keys=['user','workspace','models','skills','bindings','preferences','settings','complete'] as const;
 if(objects===previous.objects&&keys.every(key=>JSON.stringify(previous[key])===JSON.stringify(next[key])))return previous;
 return {...next,objects};
}

// Calls during a read are queued as one follow-up, so a save cannot lose its
// refresh by joining an older in-flight snapshot.
export function queuedRefresh(load:()=>Promise<void>):()=>Promise<void>{
 let pending:Promise<void>|null=null,again=false;
 return ()=>{
  if(pending){again=true;return pending}
  pending=(async()=>{do{again=false;await load()}while(again)})().finally(()=>{pending=null});
  return pending;
 };
}
