import {useEffect,useState} from 'react';
// Only non-secret UI choices. Prefix with the signed-in user to avoid sharing views.
export function useViewState<T>(key:string,initial:T){
 const [value,setValue]=useState<T>(()=>{try{return JSON.parse(sessionStorage.getItem(key)||'null')??initial}catch{return initial}});
 useEffect(()=>{sessionStorage.setItem(key,JSON.stringify(value))},[key,value]);
 return [value,setValue] as const;
}
