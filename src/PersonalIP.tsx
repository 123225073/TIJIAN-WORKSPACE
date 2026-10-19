import {useEffect,useState} from 'react';
import {ArrowRight, AudioLines, Plus, ShieldCheck, UserRound} from 'lucide-react';
import ArchiveInterview from './ArchiveInterview';
import './personal-ip.css';
import {latestProfileId} from './profile-defaults';
import {CloneAssetPreview} from './ResourcePreview';
import AssetRename from './AssetRename';
import Markdown from './Markdown';
import IPQuestionnaire from './IPQuestionnaire';

export default function PersonalIP({t,assets}:{t:any;assets:any[]}){
 const profiles=(t.list?.('profile')||[]).filter((p:any)=>!p.archived);
 const focused=new URLSearchParams(location.hash.split('?')[1]||'').get('profile')||latestProfileId(profiles);
 const [interview,setInterview]=useState<any>(()=>new URLSearchParams(location.hash.split('?')[1]||'').get('interview')==='1'?{target:null}:null);
 const [editor,setEditor]=useState<any>(null);
 useEffect(()=>{const open=()=>{if(new URLSearchParams(location.hash.split('?')[1]||'').get('interview')==='1')setInterview({target:null})};window.addEventListener('hashchange',open);return()=>window.removeEventListener('hashchange',open)},[]);
 const owned=assets.filter(a=>a.visibility!=='public'&&!a.archived);
 const resource=(kind:'avatar'|'voice')=>owned.filter(a=>a.asset_type===kind&&a.provider==='hifly');
 const openEditor=(profile?:any)=>setEditor({profile});
 return <div className="ip-dashboard">
  {interview&&<ArchiveInterview t={t} type="profile" target={interview.target} onClose={()=>{setInterview(null);void t.refresh?.()}}/>}
  {editor&&<IPQuestionnaire t={t} profile={editor.profile} onClose={()=>{setEditor(null);void t.refresh?.()}}/>}
  <section className="ip-hero"><div className="ip-hero-mark"><ShieldCheck size={23}/></div><div><span>我的创作身份</span><h2>先让工具认识你，再开始创作</h2><p>个人定位、服务对象和代理品牌写在同一份档案里。声音与数字人形象也在这里管理，创作时可直接选择。</p></div></section>
  <section className="ip-profile"><div className="st-section-head"><div><h2>个人 IP 档案 <span className="ip-asset-count">{profiles.length}</span></h2><p>每份 IP 独立保存，创作时可选择使用哪一份。</p></div><div className="st-inline"><button onClick={()=>setInterview({target:null})}>AI 访谈新增 IP</button><button className="st-primary" onClick={()=>openEditor()}><Plus size={15}/>新增 IP</button></div></div>
   {profiles.length?<div className="ip-profile-list">{profiles.map((profile:any)=><article key={profile.id} data-profile-id={profile.id} className={'ip-profile-card'+(profile.id===focused?' is-focused':'')}><span className="st-brand-monogram">{profile.title?.slice(0,1)||'我'}</span><div className="ip-profile-content"><header><h3>{profile.title}</h3><span className="ip-profile-status">{profile.status==='accepted'?'已确认定位':'待完善定位'}</span></header><p>{profile.position||'还没有填写个人定位'}</p><dl><div><dt>面向谁</dt><dd>{profile.audience||'待完善'}</dd></div><div><dt>代理品牌与业务</dt><dd>{profile.agency_brands||'待完善'}</dd></div><div><dt>表达方式</dt><dd>{profile.style||'待完善'}</dd></div></dl>{profile.body&&<details><summary>查看完整定位方案</summary><Markdown text={profile.body}/></details>}<div className="ip-profile-actions"><button onClick={()=>setInterview({target:profile})}>AI 访谈补全</button><button onClick={()=>openEditor(profile)}>编辑档案 <ArrowRight size={14}/></button>{profile.positioning_task_id&&<a href={'#task/'+profile.positioning_task_id}>查看定位沟通 →</a>}</div></div></article>)}</div>:<div className="ip-empty"><UserRound size={29}/><p>先建一份个人档案，后续文案、图片和视频便能统一使用你的身份信息。</p><button className="st-primary" onClick={()=>openEditor()}><Plus size={15}/>建立我的 IP</button></div>}
  </section>
  <div className="ip-assets">
   {([['avatar','数字人形象','通过飞影，用本人或获授权的人物视频、照片建立可复用的形象。','studio/avatar/create','studio/avatar/library',UserRound],['voice','我的声音','在飞影创建获授权的声音，供文字驱动和文本配音选择。','studio/audio/create','studio/audio/library',AudioLines]] as const).map(([kind,title,help,create,library,Icon])=><section key={kind} aria-label={title}><div className="st-section-head"><div><h2><Icon size={19}/>{title}<span className="ip-asset-count">{resource(kind).length}</span></h2><p>{help}</p></div><a className="st-link" href={'#'+library}>管理全部 <ArrowRight size={14}/></a></div><div className="ip-asset-list">{resource(kind).map((a:any)=><article key={a.id} className="ip-resource-card"><header><div className="ip-asset-icon"><Icon size={19}/></div><div><strong>{a.title||a.name||title}</strong><small>{a.resource_selectable===false?a.resource_unavailable_reason||'当前不可用':a.status==='ready'?'可用于创作':a.status==='failed'?'创建失败':'处理中或待接入'}</small></div><AssetRename asset={a}/></header><CloneAssetPreview asset={a} compact/></article>)}{!resource(kind).length&&<div className="ip-asset-empty">还没有{title}</div>}</div><a className="ip-create" href={'#'+create}><Plus size={16}/>创建{kind==='avatar'?'形象':'声音'}</a></section>)}
  </div>
 </div>;
}
