import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import AssetPicker,{AssetThumbnail} from './AssetPicker';
import {mediaKind,type Asset} from './ResourcePreview';
import WechatPublishPanel from './WechatPublishPanel';
import {GatewayConnectionGuide} from './PublishConnectionGuide';

type Props={flowId:string;platform:string;contentId:string;contentVersion:number;dirty?:boolean};
const labels:Record<string,string>={website:'官网 / 品牌博客',wechat:'微信公众号',xiaohongshu:'小红书',zhihu:'知乎',baijiahao:'百家号',toutiao:'今日头条',jianshu:'简书',sohu:'搜狐号'};
const base='/studio/matrix-publish';
const accountsHref='#publish-accounts';
const stateLabel:Record<string,string>={published:'发布服务确认已发布',accepted:'发布服务已接收，等待平台处理',draft:'已建立平台草稿',sending:'发布服务正在处理',unknown:'请求结果待核查，请在发布服务核对原请求'};

export default function MatrixPublish(props:Props){
 if(!labels[props.platform]||!props.contentId)return null;
 const key=JSON.stringify([props.flowId,props.platform,props.contentId,props.contentVersion]);
 return props.platform==='wechat'?<WechatMatrixPublish key={key} {...props}/>:<GatewayPublish key={key} {...props}/>;
}

export function PublishAccounts({embedded=false}:{embedded?:boolean}){
 const [platform,setPlatform]=useState('wechat');
 return <div className="publish-account-page">
  <header>{embedded?<h2>发布账号管理</h2>:<h1>发布账号管理</h1>}<p>集中配置内容矩阵的图文发布连接。凭据加密保存在本机，工作台重启后会继续使用；平台撤销或凭据过期时，可以在这里更新。</p></header>
  <nav aria-label="选择发布平台">{Object.entries(labels).map(([id,label])=><button type="button" key={id} aria-pressed={platform===id} onClick={()=>setPlatform(id)}>{label}</button>)}</nav>
  {platform==='wechat'?<WechatPublishPanel delivery={{}} dirty={false} accountsOnly/>:<GatewayPublish key={platform} platform={platform} flowId="" contentId="" contentVersion={0} accountsOnly/>}
 </div>;
}

function GatewayPublish({flowId,platform,contentId,contentVersion,dirty,accountsOnly=false}:Props&{accountsOnly?:boolean}){
 const [endpoint,setEndpoint]=useState(''),[configured,setConfigured]=useState(false),[enabled,setEnabled]=useState(true),[loaded,setLoaded]=useState(false);
 const [mode,setMode]=useState<'gateway'|'wordpress'>('gateway'),[username,setUsername]=useState('');
 const [savedConnection,setSavedConnection]=useState(''),[revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[receipt,setReceipt]=useState<any>(null);
 const secret=useRef<HTMLInputElement>(null),lock=useRef(false);
 const scope={platform,flow_id:flowId,content_id:contentId,content_version:contentVersion};
 const query=new URLSearchParams(Object.fromEntries(Object.entries(scope).map(([key,value])=>[key,String(value)])));
 useEffect(()=>{
  let live=true;
  void Promise.all([api(base+'/config'),accountsOnly?Promise.resolve({items:[]}):api(base+'/dispatch?'+query)]).then(([cfg,records])=>{
   if(!live)return;
   const item=(cfg.items||[]).find((row:any)=>row.platform===platform);
   setEndpoint(item?.endpoint||'');setConfigured(!!item?.configured);setEnabled(item?.enabled!==false);
   setMode(item?.mode==='wordpress'?'wordpress':'gateway');setUsername(item?.username||'');
   setRevision(item?.revision||0);setSavedConnection(JSON.stringify([item?.endpoint||'',item?.enabled!==false,item?.mode==='wordpress'?'wordpress':'gateway',item?.username||'']));
   setReceipt(records.items?.find((row:any)=>row.platform===platform&&row.content_id===contentId&&row.content_version===contentVersion)||null);setLoaded(true);
  }).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false};
 },[]);
 const connectionChanged=savedConnection!==JSON.stringify([endpoint,enabled,mode,username]);
 const readReceipt=async()=>{const records=await api(base+'/dispatch?'+query);setReceipt(records.items?.find((row:any)=>row.platform===platform&&row.content_id===contentId&&row.content_version===contentVersion)||null)};
 const action=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}};
 const dispatch=()=>{if(connectionChanged||!window.confirm('将已保存的稿件发送到 '+labels[platform]+' 的发布服务。\n地址 '+endpoint+(username?'\n账号 '+username:'')+'\n稿件版本 v'+contentVersion+'，确认继续？'))return;
  void action(async()=>{const next=await api(base+'/dispatch',{...scope,config_revision:revision,confirmed:true,request_id:crypto.randomUUID()});setReceipt(next.record||next)});
 };
 const link=typeof receipt?.url==='string'&&/^https:\/\//i.test(receipt.url)?receipt.url:'';
 return <section className="wp-panel matrix-publish" aria-label={labels[platform]+(accountsOnly?'连接':'发布')}>
  <div className="wp-heading"><div><h3>{labels[platform]}{accountsOnly?'连接':'发布'}</h3><p>{!accountsOnly&&`已保存文稿 v${contentVersion} · `}{!loaded?'正在读取连接':configured?(enabled?'已保存并启用':'已停用'):'待配置连接'}</p></div>{!accountsOnly&&<div className="matrix-publish-actions"><a href={accountsHref}>管理发布账号</a><button type="button" className="st-primary" disabled={busy||!!dirty||!configured||!enabled||connectionChanged||!!receipt} onClick={dispatch}>提交发布</button></div>}</div>
  {dirty&&<p role="status">请先保存当前修改。</p>}
  {accountsOnly&&<div className="wp-settings matrix-account-form">
   <GatewayConnectionGuide platform={platform} mode={mode} endpoint={endpoint}/>
   <form onSubmit={e=>{e.preventDefault();setNotice('');void action(async()=>{const token=secret.current?.value;const value=await api(base+'/config',{platform,endpoint,...(token?{token}:{}),enabled,mode,...(mode==='wordpress'?{username}:{})});setConfigured(!!value.configured);setRevision(value.revision);setEndpoint(value.endpoint);setUsername(value.username||'');setSavedConnection(JSON.stringify([value.endpoint,value.enabled!==false,value.mode||'gateway',value.username||'']));if(secret.current)secret.current.value='';setNotice('连接设置已保存')})}}>
    <fieldset className="matrix-publish-config" disabled={busy||!loaded}>
    {platform==='website'&&<label>接入方式<select value={mode} onChange={e=>setMode(e.target.value==='wordpress'?'wordpress':'gateway')}><option value="gateway">自定义 HTTPS 发布接口</option><option value="wordpress">WordPress 官网</option></select></label>}
    <label>{mode==='wordpress'?'WordPress 网站地址':'HTTPS 发布地址'}<input aria-label={mode==='wordpress'?'WordPress 网站地址':'HTTPS 发布地址'} type="url" required value={endpoint} onChange={e=>setEndpoint(e.target.value)}/><small className="publish-field-hint">{mode==='wordpress'?'填写你自己的 HTTPS 网站地址。':'复制发布服务商提供的完整发文地址，不是平台官网或创作中心地址。'}</small></label>
    {mode==='wordpress'&&<label>WordPress 用户名<input aria-label="WordPress 用户名" required value={username} onChange={e=>setUsername(e.target.value)}/><small className="publish-field-hint">来自网站后台「用户 → 个人资料 → 用户名」。</small></label>}
    <label>{mode==='wordpress'?'WordPress 应用程序密码':'访问令牌'}<input aria-label={mode==='wordpress'?'WordPress 应用程序密码':'访问令牌'} type="password" ref={secret} autoComplete="new-password" placeholder={configured?'留空保留已保存的凭据':'输入发布凭据'}/><small className="publish-field-hint">{mode==='wordpress'?'来自该用户个人资料中的「应用程序密码」，请勿填写网页登录密码。':'来自同一发布服务商，与上方地址配套；已保存后不会回显。'}</small></label>
    <label className="matrix-publish-checkbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用连接</label>
    <button type="submit">保存连接</button>
    </fieldset>
   </form>
  </div>}
  {receipt&&<p role="status">{stateLabel[receipt.status]||'请到发布服务核对结果'}{link&&<> · <a href={link} target="_blank" rel="noreferrer">查看结果 ↗</a></>}</p>}
  {!accountsOnly&&(receipt?.status==='sending'||error)&&<button type="button" disabled={busy} onClick={()=>void action(readReceipt)}>刷新发布记录</button>}
  {notice&&<p className="wp-notice" role="status">{notice}</p>}
  {error&&<p role="alert" className="wp-error">{error}</p>}
 </section>;
}

function WechatMatrixPublish({flowId,contentId,contentVersion,dirty}:Props){
 const path='/wechat-publish/matrix/'+encodeURIComponent(flowId)+'/'+encodeURIComponent(contentId);
 const [delivery,setDelivery]=useState<any>(null),[cover,setCover]=useState(''),[summary,setSummary]=useState('');
 const [assets,setAssets]=useState<Asset[]>([]),[picker,setPicker]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let live=true;
  void Promise.all([api(path),api('/studio/assets?asset_type=image')]).then(([item,library])=>{
   if(!live)return;
   if(item.version!==contentVersion)throw Error('文稿版本已变化，请刷新后核对');
   setDelivery(item.delivery);setCover(item.delivery?.cover_asset_id||item.cover_asset_id||'');
   setSummary(item.delivery?.summary||item.summary||'');setAssets((library.items||[]).filter((asset:Asset)=>mediaKind(asset)==='image'));setLoaded(true);
  }).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false};
 },[path,contentVersion]);
 const asset=assets.find(x=>x.id===cover);
 const changed=!!dirty||!delivery||delivery.cover_asset_id!==cover||delivery.summary!==(summary||'').trim();
 const prepare=async()=>{if(busy)return;setBusy(true);setError('');try{setDelivery(await api(path,{version:contentVersion,cover_asset_id:cover,summary}))}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 return <section className="wp-panel matrix-publish" aria-label="公众号发布">
  <div className="wp-heading"><div><h3>公众号发布</h3><p>当前已保存文稿 v{contentVersion}</p></div><div className="matrix-publish-actions"><a href={accountsHref}>管理发布账号</a><button type="button" disabled={!loaded||busy||!!dirty||!cover||!changed} onClick={()=>void prepare()}>保存封面与摘要</button></div></div>
  <div className="matrix-publish-config">{asset&&<div className="matrix-cover"><AssetThumbnail asset={asset}/></div>}
   <button type="button" disabled={!loaded||busy||!!dirty} onClick={()=>setPicker(true)}>{asset?'更换公众号封面':'选择公众号封面'}</button>
   <label>摘要（可选，最多 120 字）<textarea rows={2} maxLength={120} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
  </div>
  {dirty&&<p role="status">请先保存文稿修改。</p>}{error&&<p role="alert" className="wp-error">{error}</p>}
  {delivery&&<WechatPublishPanel delivery={delivery} dirty={changed} managed/>}
  {picker&&<AssetPicker items={assets} busy={busy} onClose={()=>setPicker(false)} onSelect={asset=>{setCover(asset.id);setPicker(false)}}/>}
 </section>;
}
