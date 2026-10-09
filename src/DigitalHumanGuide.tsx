import type {HumanSource} from './digitalHumanFields';
import {Film,Image,UserRound} from 'lucide-react';
import HelpTip from './HelpTip';
export default function DigitalHumanGuide({tool,source,onSource,configured,busy}:{tool:string;source:HumanSource;onSource:(source:HumanSource)=>void;configured:boolean;busy:boolean}) {
 const creating=tool==='avatar_create',driving=['text_avatar','audio_avatar'].includes(tool);
 const help:Record<string,string>={text_avatar:'选择自己的形象和声音，再输入口播文稿。人物视频模式使用视频里的形象和声音。',audio_avatar:'选择自己的形象或人物视频，再上传录音。视频按照录音时长和节奏口播。',photo_talk:'选择人物照片和声音，再输入口播文稿；不需要先克隆形象。',avatar_create:'选择人物视频或照片，创建后保存为可复用的专属形象。',voice_create:'选择自己的说话录音，创建后可在口播和配音中复用。',tts:'选择声音，输入文稿，生成配音。'};
 const label=creating?'创建方式':driving?'出镜方式':tool==='photo_talk'?'照片说话':tool==='voice_create'?'声音素材':'文本配音';
 return <section className="st-provider-guide" aria-label="出镜与素材方式"><header><span className="st-human-source-label">{label}<HelpTip label={label}>{help[tool]}提交后可离开页面，结果保存在生成记录中。</HelpTip></span>{!configured&&<span className="st-human-service-status">服务待配置</span>}</header>
  {(creating||driving)&&<div className="st-input-choice" role="group" aria-label={creating?'形象创建素材类型':'出镜素材类型'}>{(creating?[['video','人物视频创建'],['image','人物照片创建']]:[['avatar','我的数字人'],['video','人物视频']]).map(([value,text])=>{const Icon=value==='video'?Film:value==='image'?Image:UserRound;return <button type="button" key={value} disabled={busy} aria-pressed={source===value} onClick={()=>onSource(value as HumanSource)}><Icon size={17} aria-hidden="true"/><span>{text}</span></button>})}</div>}
 </section>;
}
