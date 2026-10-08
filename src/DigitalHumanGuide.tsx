import type {HumanSource} from './digitalHumanFields';
import {Film,Image,UserRound} from 'lucide-react';
import HiflyBilling from './HiflyBilling';
export default function DigitalHumanGuide({tool,source,onSource,configured,busy,returnRoute}:{tool:string;source:HumanSource;onSource:(source:HumanSource)=>void;configured:boolean;busy:boolean;returnRoute:string}) {
 const creating=tool==='avatar_create',driving=['text_avatar','audio_avatar'].includes(tool);
 const help:Record<string,string>={text_avatar:'文稿＋飞影数字人形象＋飞影声音，生成口播视频。也可使用人物视频替代形象与声音。',audio_avatar:'原音频＋飞影数字人形象，生成同步口播视频；也可使用人物视频，不能用普通照片替代形象。',photo_talk:'人物照片＋口播文稿＋飞影声音，直接生成图片驱动视频。',avatar_create:'使用人物视频或人物照片创建可复用的飞影数字人形象；两种素材选择一种。',voice_create:'用获授权的说话录音创建飞影声音，之后可用于文字驱动与文本配音。',tts:'口播文稿＋飞影声音，生成音频。'};
 return <section className="st-provider-guide" aria-label="飞影素材要求"><header><strong>飞影数字人</strong><span className="st-human-service-status">{configured?'服务已配置':'服务未就绪'}</span></header><p className="st-human-requirements">{help[tool]}</p><small className="st-human-async-note">提交后在后台异步处理，可离开本页；进度与成果保留在生成记录中。</small>
  {!configured&&<p><a href="/admin.html#models">在管理后台检查飞影服务配置 →</a></p>}
  {(creating||driving)&&<div className="st-human-source-section"><span className="st-human-source-label">{creating?'选择创建方式':'选择出镜方式'}</span><div className="st-input-choice" role="group" aria-label={creating?'形象创建素材类型':'出镜素材类型'}>{(creating?[['video','人物视频创建'],['image','人物照片创建']]:[['avatar','选择飞影形象'],['video','使用人物视频']]).map(([value,label])=>{const Icon=value==='video'?Film:value==='image'?Image:UserRound;return <button type="button" key={value} disabled={busy} aria-pressed={source===value} onClick={()=>onSource(value as HumanSource)}><Icon size={18} aria-hidden="true"/><span>{label}</span></button>})}</div></div>}
  {driving&&source==='avatar'&&<p><a href={'#studio/avatar/library?return='+encodeURIComponent(returnRoute)}>选择已有飞影形象</a><span> · </span><a href={'#studio/avatar/create?return='+encodeURIComponent(returnRoute)}>创建飞影形象</a></p>}
  <HiflyBilling tool={tool} source={source}/>
 </section>;
}
