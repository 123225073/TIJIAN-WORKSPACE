import {RadarSources} from './RadarSources';
import {MemorySettings} from './MemorySettings';
import {SystemCapabilities} from './SystemCapabilities';
import {useState} from 'react';
import {PageTitle} from './WorkPages';
import {WechatSettings,WechatLibrary} from './WechatLibrary';
import {PromptEditor,PlatformAccounts} from './WorkflowPanels';
import {SourceWizard} from './DiscoveryPanels';
import {benchmarkFields} from './BenchmarkPage';
import {DeleteRecord} from './DeleteRecord';
const modules=[['workspace','工作区与数据','存储、备份与文件同步'],['ai','AI 与创作偏好','模型选择与写作偏好'],['memory','记忆与 Wiki','夜间整理、专用模型与运行记录'],['benchmark','对标与订阅','微信读书连接、账号与检查频率'],['cimi','次幂服务','付费接口连接与认证'],['radar','雷达信源','来源地址与启停管理'],['accounts','平台账号','平台连接与登录状态']];
export function SettingsHub({t,renderPreferences}:any){
 const visibleModules=t.state.user?.role==='admin'?[...modules,['system','系统能力 · 管理员','系统提示词、Skills 与版本管理']]:modules;
 const parts=t.route.split('/'),module=visibleModules.some(x=>x[0]===parts[1])?parts[1]:'workspace',accounts=t.list('benchmark'),account=accounts.find((x:any)=>x.id===parts[2])||accounts[0],returnTab=parts[3]||'saved';
 const [sourceEdit,setSourceEdit]=useState<any>(null);
 const back=module==='workspace'&&parts[3]==='knowledge'?'knowledge':module==='benchmark'||module==='cimi'?'benchmark/'+(account?.id||'')+'/'+returnTab:module==='radar'?'radar':module==='ai'?'content':'home';
 return <div className="work-page settings-hub"><PageTitle number="设置" title="设置中心" description="连接、后台配置和运行规则集中管理。业务页面只保留状态与操作入口。" actions={<a className="settings-link" href={'#'+back}>← {back.startsWith('benchmark')?'返回对标研究':back==='radar'?'返回行业雷达':back==='content'?'返回内容中心':back==='knowledge'?'返回知识资产':'返回今日工作'}</a>}/><div className="settings-layout"><nav className="settings-nav" aria-label="设置模块">{visibleModules.map(([key,label,description])=><a key={key} className={module===key?'active':''} href={'#settings/'+key+(account&&(key==='benchmark'||key==='cimi')?'/'+account.id+'/'+returnTab:'')}><strong>{label}</strong><small>{description}</small></a>)}</nav><div className="settings-content"><div className="section-intro"><h2>{visibleModules.find(x=>x[0]===module)?.[1]}</h2><p>{visibleModules.find(x=>x[0]===module)?.[2]}</p></div>
 {(module==='workspace'||module==='ai')&&renderPreferences(module)}
 {module==='ai'&&<><PromptEditor {...t}/>{t.state.user?.role==='admin'&&<div className="button-row"><a className="settings-link" href="#settings/system">系统角色与 Skills 管理 →</a><a className="settings-link" href="#admin">管理模型服务与验证 →</a></div>}</>}
 {module==='memory'&&<MemorySettings {...t}/>}
 {module==='system'&&t.state.user?.role==='admin'&&<SystemCapabilities/>}
 {module==='cimi'&&<WechatSettings/>}
 {module==='benchmark'&&<><label className="field"><span>要配置的对标账号</span><select aria-label="配置对标账号" value={account?.id||''} onChange={e=>{location.hash='settings/benchmark/'+e.target.value+'/'+returnTab}}>{accounts.map((x:any)=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label>{account?<><section className="surface"><div className="block-heading"><h3>{account.title}</h3><button onClick={()=>t.editItem(account,benchmarkFields.filter((f:any)=>!['抖音','douyin'].includes(account.platform)||f.key!=='feed_url'))}>编辑账号资料</button></div><p>{account.platform} · {account.reason||'未填写关注理由'}</p><p className="path">{account.url||'未填写代表作品链接'}</p><DeleteRecord item={account} t={t}/></section>{['公众号','wechat','微信公众号'].includes(account.platform)?<WechatLibrary key={account.id} account={account} t={t} mode="settings"/>:<p>{['抖音','douyin'].includes(account.platform)?'抖音无需填写 RSS。回到对标研究获取作品、下载媒体及开启订阅通知。':'此平台使用手动作品发现或链接采集。订阅地址可在“编辑账号资料”维护。'}</p>}</>:<p>请先在<a href="#benchmark">对标研究</a>添加账号。</p>}</>}
 {module==='radar'&&<RadarSources {...t}/>}
 {module==='accounts'&&<PlatformAccounts {...t} embedded/>}
 </div></div>{sourceEdit&&<SourceWizard t={t} item={sourceEdit.id?sourceEdit:null} onClose={()=>setSourceEdit(null)}/>}</div>
}
