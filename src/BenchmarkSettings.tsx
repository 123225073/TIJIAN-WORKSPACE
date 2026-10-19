import {useState} from 'react';

export type BenchmarkPreferences={provider:string;accountKey:string;ghid:string;limit:number;maxCalls:number;from:string;to:string};
export const benchmarkDefaults:BenchmarkPreferences={provider:'tikhub',accountKey:'',ghid:'',limit:20,maxCalls:3,from:'',to:''};

// No credentials or provider calls here. Both the inline panel and SettingsHub
// can use these fields without changing the account/fetch API contract.
export function BenchmarkTechnicalSettings({platform,value,onChange,disabled=false}:{platform:string;value:BenchmarkPreferences;onChange:(next:BenchmarkPreferences)=>void;disabled?:boolean}){
 const change=(patch:Partial<BenchmarkPreferences>)=>onChange({...value,...patch});
 return <fieldset className="bv-technical-settings" disabled={disabled}>
  <legend>对标获取设置</legend>
  <p>日常只需粘贴链接。以下设置供维护账号或调整获取范围时使用；保存设置不会获取作品。</p>
  <label className="field"><span>获取服务</span><select aria-label="获取服务" value={value.provider} onChange={e=>change({provider:e.target.value})}><option value="tikhub">TikHub</option>{platform==='wechat'&&<option value="cimidata">次幂</option>}</select></label>
  <label className="field"><span>{platform==='douyin'?'sec_user_id':platform==='channels'?'username':'公众号 biz'}（可选）</span><input value={value.accountKey} onChange={e=>change({accountKey:e.target.value})}/><small>仅在没有分享链接或需要核对账号身份时填写，不支持用昵称代替。</small></label>
  {platform==='wechat'&&<label className="field"><span>公众号原始ID ghid</span><input value={value.ghid} onChange={e=>change({ghid:e.target.value})} placeholder="gh_…"/></label>}
  <label className="field"><span>每次最多获取作品</span><input type="number" min={1} max={500} value={value.limit} onChange={e=>change({limit:Number(e.target.value)})}/></label>
  <label className="field"><span>每次最多付费请求</span><input type="number" min={1} max={50} value={value.maxCalls} onChange={e=>change({maxCalls:Number(e.target.value)})}/></label>
  <label className="field"><span>起始日期</span><input type="date" value={value.from} onChange={e=>change({from:e.target.value})}/></label>
  <label className="field"><span>截止日期</span><input type="date" value={value.to} onChange={e=>change({to:e.target.value})}/></label>
  <small>日期同时筛选已保存作品；清空日期可查看全部。设置不会自动触发付费请求。</small>
 </fieldset>;
}

// Optional SettingsHub integration: <BenchmarkSettingsPanel owner={t.state.user.id}/>.
// Merge only settings fields so existing link/name/selected-account drafts survive.
export function BenchmarkSettingsPanel({owner}:{owner:string}){
 const key='benchmark-v2-draft:'+owner;
 const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}};
 const [platform,setPlatform]=useState(()=>read().platform||'douyin');
 const [value,setValue]=useState<BenchmarkPreferences>(()=>({...benchmarkDefaults,...read()}));
 const [notice,setNotice]=useState('');
 return <section className="surface"><label className="field"><span>新增账号的平台</span><select value={platform} onChange={e=>{setPlatform(e.target.value);setValue({...value,provider:'tikhub',accountKey:'',ghid:''});setNotice('')}}><option value="douyin">抖音</option><option value="channels">视频号</option><option value="wechat">公众号</option></select></label><BenchmarkTechnicalSettings platform={platform} value={value} onChange={next=>{setValue(next);setNotice('')}}/><button disabled={!owner} onClick={()=>{try{const {provider,accountKey,ghid,limit,maxCalls,from,to}=value;localStorage.setItem(key,JSON.stringify({...read(),platform,provider,accountKey,ghid,limit,maxCalls,from,to}));setNotice('设置已保存，返回看同行后生效；未调用获取服务。')}catch{setNotice('无法保存设置，请检查本机存储权限。')}}}>保存对标设置</button><p role="status">{notice}</p></section>;
}
