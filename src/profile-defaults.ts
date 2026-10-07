import {useState} from 'react';

type Profile = {id:string;updated?:string;created?:string;archived?:boolean;title?:string};
type ScopeState = {user?:{id?:string};workspace?:string|null;complete?:boolean};
type Storage = Pick<globalThis.Storage,'getItem'|'setItem'>;

export const profileScope=(state?:ScopeState|null)=>JSON.stringify([state?.user?.id||'',state?.workspace||'']);
export const profileChoiceKey=(scope:string,context:string)=>'tijian-profile-choice:'+JSON.stringify([scope,context]);

/** Store only deliberate choices. In particular, '' means explicitly generic. */
export function readProfileChoice(key:string,storage:Storage=localStorage):string|undefined{
 try{const saved=JSON.parse(storage.getItem(key)||'null');return typeof saved?.value==='string'?saved.value:undefined}catch{return undefined}
}
export function writeProfileChoice(key:string,value:string,storage:Storage=localStorage){
 storage.setItem(key,JSON.stringify({value}));
}

/** Lists are owner-filtered by /state. Compare timestamps without mutating them. */
export function latestProfileId(profiles:readonly Profile[]):string{
 const time=(value?:string)=>{const parsed=Date.parse(value||'');return Number.isFinite(parsed)?parsed:0};
 return profiles.filter(p=>!p.archived).reduce<Profile|undefined>((latest,p)=>{
  if(!latest)return p;
  const rank=Math.max(time(p.updated),time(p.created)),previous=Math.max(time(latest.updated),time(latest.created));
  return rank>previous?p:latest;
 },undefined)?.id||'';
}

/** undefined is unchosen; empty and nonempty strings are both existing choices. */
export function resolveProfileId(profiles:readonly Profile[],current:string|undefined,ready=true):string{
 return current!==undefined?current:ready?latestProfileId(profiles):'';
}
export const profileUnavailable=(profiles:readonly Profile[],value:string,ready=true)=>ready&&!!value&&!profiles.some(p=>p.id===value&&!p.archived);
export const unavailableProfileOption=(profiles:readonly Profile[],value:string,ready=true)=>profileUnavailable(profiles,value,ready)?[{value,label:'原 IP 已删除或不可用，请重新选择'}]:[];

export function taskProfileInitial(task:Record<string,any>,cached?:{profile?:string;profile_scope?:string}|null,scope?:string):string|undefined{
 if(cached?.profile&&(!cached.profile_scope||cached.profile_scope===scope))return cached.profile;
 // Old automatic composer saves also wrote ''. Only a deliberate choice (read
 // by useProfileDefault) or the server's skip flag proves generic was requested.
 return task.profile_id||(task.identity_skipped?'':undefined);
}
export function flowProfileInitial(flow:Record<string,any>,explicitChoice?:string):string|undefined{
 // An ID/version (or saved body) says nothing about whether an empty identity
 // was selected deliberately. Preserve nonempty values; otherwise use only
 // the scoped choice marker, including ''.
 return flow.profile_id||(flow.identity_skipped?'':explicitChoice);
}

/** A small selector for App/task/new-topic entry points, scoped without tokens. */
export function useProfileDefault(profiles:readonly Profile[],scope:string,context:string,initial?:string,ready=true):[string,(value:string)=>void]{
 const key=profileChoiceKey(scope,context);
 const [choice,setChoice]=useState<{key:string;value:string|undefined}>(()=>({key,value:readProfileChoice(key)}));
 // Derive the new scope synchronously: no render can expose the previous account.
 const current=choice.key===key?choice.value:readProfileChoice(key);
 const value=resolveProfileId(profiles,current??initial,ready);
 const select=(next:string)=>{writeProfileChoice(key,next);setChoice({key,value:next})};
 return [value,select];
}
