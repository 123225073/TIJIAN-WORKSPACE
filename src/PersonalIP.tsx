import {useState} from 'react';
import {ArrowRight, AudioLines, Plus, ShieldCheck, UserRound} from 'lucide-react';
import ArchiveInterview from './ArchiveInterview';
import './personal-ip.css';

const fields=[
 {key:'title',label:'我的 IP 名称',required:true},
 {key:'position',label:'一句话介绍自己'},
 {key:'audience',label:'服务对象'},
 {key:'agency_brands',label:'代理品牌与业务范围',type:'textarea'},
 {key:'style',label:'表达方式',type:'textarea'},
 {key:'views',label:'专业观点',type:'textarea'},
 {key:'channels',label:'常用平台与账号'},
];

export default function PersonalIP({t,assets}:{t:any;assets:any[]}){
 const profiles=t.list?.('profile')||[];
 const profile=profiles[0];
 const [interview,setInterview]=useState<any>(null);
 const owned=assets.filter(a=>a.visibility!=='public');
 const resource=(kind:'avatar'|'voice')=>owned.filter(a=>a.asset_type===kind);
 const openEditor=()=>profile?t.editItem(profile,fields):t.newItem('profile','建立我的 IP',fields,{status:'draft'});
 return <div className="ip-dashboard">
  {interview&&<ArchiveInterview t={t} type="profile" target={interview.target} onClose={()=>{setInterview(null);void t.refresh?.()}}/>}
  <section className="ip-hero"><div className="ip-hero-mark"><ShieldCheck size={23}/></div><div><span>我的创作身份</span><h2>先让工具认识你，再开始创作</h2><p>个人定位、服务对象和代理品牌写在同一份档案里。声音与数字人形象也在这里管理，创作时可直接选择。</p></div></section>
  <section className="ip-profile"><div className="st-section-head"><div><h2>个人 IP 档案</h2><p>创作时会引用当前档案；修改后不会覆盖历史作品。</p></div><div className="st-inline"><button onClick={()=>setInterview({target:profile||null})}>AI 访谈补全</button><button className="st-primary" onClick={openEditor}>{profile?'编辑档案':'建立档案'} <ArrowRight size={15}/></button></div></div>
   {profile?<article className="ip-profile-card"><span className="st-brand-monogram">{profile.title?.slice(0,1)||'我'}</span><div><h3>{profile.title}</h3><p>{profile.position||'还没有填写个人定位'}</p><dl><div><dt>面向谁</dt><dd>{profile.audience||'待完善'}</dd></div><div><dt>代理品牌与业务</dt><dd>{profile.agency_brands||'待完善'}</dd></div><div><dt>表达方式</dt><dd>{profile.style||'待完善'}</dd></div></dl></div></article>:<div className="ip-empty"><UserRound size={29}/><p>先建一份个人档案，后续文案、图片和视频便能统一使用你的身份信息。</p><button className="st-primary" onClick={openEditor}><Plus size={15}/>建立我的 IP</button></div>}
  </section>
  <div className="ip-assets">
   {([['avatar','数字人形象','上传本人或获授权的素材，建立可复用的出镜形象。','studio/avatar/create','studio/avatar/library',UserRound],['voice','我的声音','保存获授权的声音，供口播和配音选择。','studio/audio/create','studio/audio/library',AudioLines]] as const).map(([kind,title,help,create,library,Icon])=><section key={kind}><div className="st-section-head"><div><h2><Icon size={19}/>{title}</h2><p>{help}</p></div><a className="st-link" href={'#'+library}>查看全部 <ArrowRight size={14}/></a></div><div className="ip-asset-list">{resource(kind).slice(0,4).map((a:any)=><article key={a.id}><div className="ip-asset-icon"><Icon size={19}/></div><div><strong>{a.title||a.name||title}</strong><small>{a.status==='ready'?'可用于创作':a.status==='failed'?'创建失败':'处理中或待接入'}</small></div></article>)}{!resource(kind).length&&<div className="ip-asset-empty">还没有{title}</div>}</div><a className="ip-create" href={'#'+create}><Plus size={16}/>创建{kind==='avatar'?'形象':'声音'}</a></section>)}
  </div>
 </div>;
}
