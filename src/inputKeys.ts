import type {KeyboardEvent} from 'react';
export function sendKey(e:KeyboardEvent<HTMLTextAreaElement>,send:()=>void,change:(value:string)=>void){
 if(e.key!=='Enter'||e.nativeEvent.isComposing||e.keyCode===229)return;
 e.preventDefault();
 if(e.repeat||e.currentTarget.readOnly||e.currentTarget.disabled)return;
 if(e.ctrlKey||e.metaKey){const field=e.currentTarget,start=field.selectionStart,end=field.selectionEnd;change(field.value.slice(0,start)+'\n'+field.value.slice(end));requestAnimationFrame(()=>{field.selectionStart=field.selectionEnd=start+1});return}
 send();
}

// Standard data-entry forms submit with Enter; multiline document editors opt out.
export function installFormKeys(){document.addEventListener('keydown',e=>{
 if(e.defaultPrevented||e.isComposing||e.keyCode===229||e.key!=='Enter')return;
 const field=e.target;if(!(field instanceof HTMLTextAreaElement)||field.dataset.enter==='newline'||field.readOnly||field.disabled)return;
 const form=field.closest('form');if(!form)return;
 if(e.repeat){e.preventDefault();return}
 if(e.ctrlKey||e.metaKey){e.preventDefault();const start=field.selectionStart,end=field.selectionEnd;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;setter.call(field,field.value.slice(0,start)+'\n'+field.value.slice(end));field.dispatchEvent(new Event('input',{bubbles:true}));requestAnimationFrame(()=>field.setSelectionRange(start+1,start+1))}
 else{e.preventDefault();const submit=Array.from(form.elements).find((x):x is HTMLButtonElement|HTMLInputElement=>(x instanceof HTMLButtonElement||x instanceof HTMLInputElement)&&x.type==='submit');if(!submit?.disabled)form.requestSubmit(submit)}
})}
