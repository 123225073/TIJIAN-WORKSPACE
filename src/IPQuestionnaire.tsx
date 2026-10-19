import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import './ip-questionnaire.css';

export type IPQuestion={key:string;question:string;reference:string;label:string};
export type IPQuestionnaireSchema={version:string;questions:IPQuestion[];report_sections:string[]};
export const hasConfirmedIP=(profiles:any[])=>profiles.some(profile=>!profile.archived&&profile.status==='accepted');
export const IP_INTERVIEW_ENTRY='#studio/brand?interview=1';

const legacyLabels:Record<string,string>={position:'一句话介绍自己',audience:'服务对象',agency_brands:'代理品牌与业务范围',style:'表达方式',views:'专业观点',channels:'常用平台与账号',body:'完整定位方案'};

export default function IPQuestionnaire({t,profile,onClose}:{t:any;profile?:any;onClose:()=>void}){
 const [schema,setSchema]=useState<IPQuestionnaireSchema|null>(null),[saved,setSaved]=useState<any>(profile),[answers,setAnswers]=useState<Record<string,string>>(profile?.questionnaire_draft?.answers||profile?.questionnaire_answers||{}),[fields,setFields]=useState<Record<string,string>>(profile?.questionnaire_draft?.fields||{title:profile?.title||''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),restored=useRef(false),root=useRef<HTMLElement>(null);
 const key='ip-questionnaire:'+t.state.user.id+':'+(profile?.id||'new');
 useEffect(()=>{
  let live=true;
  void api<IPQuestionnaireSchema>('/studio/ip-questionnaire').then(result=>{if(live)setSchema(result)}).catch(e=>{if(live)setError(e.message)});
  try{const local=JSON.parse(localStorage.getItem(key)||'null');if(local&&(local.version||0)===(profile?.version||0)){setAnswers(local.answers);setFields(local.fields);setNotice('已恢复未保存的填写内容')}}catch{setError('未能恢复暂存内容，请核对后填写')}
  restored.current=true;
  return ()=>{live=false};
 },[key]);
 useEffect(()=>{
  if(!restored.current)return;
  try{localStorage.setItem(key,JSON.stringify({answers,fields,version:saved?.version||0}))}catch{setError('本机暂存失败，请保存草稿后再关闭')}
 },[answers,fields,key,saved?.version]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;root.current?.focus();return()=>previous?.focus()},[]);
 const save=async(confirmed:boolean)=>{
  if(lock.current)return;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await api('/studio/ip-questionnaire/profile',{id:saved?.id,version:saved?.version||0,answers,fields,confirmed});
   setSaved(result);localStorage.removeItem(key);await t.refresh?.();
   if(confirmed)onClose();else setNotice('草稿已保存；完成十二题并确认后，才算建立成功。');
  }catch(e:any){setError(e.message)}finally{lock.current=false;setBusy(false)}
 };
 return <div className="st-modal-backdrop"><section ref={root} tabIndex={-1} className="st-interview ip-questionnaire-dialog" role="dialog" aria-modal="true" aria-label={profile?'编辑 IP 定位问卷':'十二题 IP 定位问卷'}>
  <header><div><small>个人 IP · 十二题定位</small><h2>{profile?'编辑档案':'先把你的实际情况说清楚'}</h2></div><button disabled={busy} onClick={onClose}>关闭</button></header>
  <p>每题都有填写参考；不知道可以直接写“不知道”，不用编造数字或资质。</p>
  <label>我的 IP 名称<input aria-label="我的 IP 名称" value={fields.title} maxLength={200} disabled={busy} onChange={e=>setFields({...fields,title:e.target.value})}/></label>
  <div className="ip-questionnaire-list">{schema?.questions.map((q,index)=><label key={q.key}><strong>{String(index+1).padStart(2,'0')} · {q.label}</strong><span>{q.question}</span><small id={'ip-question-help-'+q.key}>{q.reference}</small><textarea aria-label={`${index+1}. ${q.label}`} aria-describedby={'ip-question-help-'+q.key} rows={3} maxLength={4000} value={answers[q.key]||''} disabled={busy} onChange={e=>setAnswers({...answers,[q.key]:e.target.value})}/></label>)}</div>
  {profile&&<details><summary>原有档案内容（保留，可修改）</summary><div className="ip-questionnaire-list">{Object.entries(legacyLabels).map(([key,label])=><label key={key}>{label}<textarea value={fields[key]??profile[key]??''} disabled={busy} rows={key==='body'?8:2} onChange={e=>setFields({...fields,[key]:e.target.value})}/></label>)}</div></details>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="st-alert">{error}</p>}
  <footer><span>{schema?schema.questions.filter(q=>answers[q.key]?.trim()).length:0} / 12 题已填写</span><button disabled={busy||!schema||!fields.title.trim()} onClick={()=>void save(false)}>保存草稿</button><button className="st-primary" disabled={busy||!schema||!fields.title.trim()||schema.questions.some(q=>!answers[q.key]?.trim())} onClick={()=>void save(true)}>{busy?'保存中…':'确认保存 IP'}</button></footer>
 </section></div>;
}
