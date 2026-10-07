export type HumanSource = 'avatar'|'video'|'image';
type HumanField={key:string;label:string;type?:string;required?:boolean;hint?:string;accept?:string;resource_kind?:string;placeholder?:string};
const asset=(key:string,label:string,kind:string,hint:string):HumanField=>({key,label,type:'asset',resource_kind:kind,required:true,hint,...(kind==='audio'?{accept:'audio/mpeg,audio/mp4,audio/wav,audio/x-wav'}:kind==='video'?{accept:'video/mp4,video/quicktime'}:kind==='image'?{accept:'image/jpeg,image/png,image/webp'}:{})});
const script:HumanField={key:'text',label:'口播文稿',type:'textarea',required:true,placeholder:'输入数字人要说的话',hint:'飞影要求纯文本，最多 10000 字。'};
const avatar=asset('avatar_id','飞影数字人形象','avatar','选择已在飞影创建完成的形象；这里不是上传一张普通照片。');
const voice=asset('voice_id','飞影声音','voice','选择创建完成或声音库中的飞影声音；已有录音可以在“创建声音”中建立声音。');
const video=asset('video_id','人物视频','video','选择或上传 MP4 / MOV 人物视频，用视频替代形象选择；不能使用一张照片。');
const audio=asset('audio_id','驱动音频','audio','上传或选择 MP3、M4A、WAV 音频，时长 5 秒至 30 分钟；保留原录音，不重新配音。');
const image=asset('image_id','人物照片','image','选择或上传清晰的人物照片；图片驱动不需要先创建数字人形象。');
export const isHumanTool=(tool:string)=>['text_avatar','audio_avatar','photo_talk','avatar_create','voice_create','tts'].includes(tool);
export function digitalHumanFields(tool:string,source:HumanSource):HumanField[]|null {
 if(tool==='text_avatar')return source==='video'?[script,{...video,hint:'人物视频可替代飞影形象与声音选择；文稿仍需填写。'}]:[script,avatar,voice];
 if(tool==='audio_avatar')return [audio,source==='video'?video:avatar];
 if(tool==='photo_talk')return [image,script,voice];
 if(tool==='avatar_create')return source==='image'?[{...image,hint:'用人物照片创建可复用的飞影形象；只选择一种创建素材。'}]:[{...video,hint:'用 MP4 / MOV 人物视频创建可复用的飞影形象；只选择一种创建素材。'}];
 if(tool==='voice_create')return [{...audio,label:'声音克隆录音',hint:'上传或选择获授权的说话录音，用于在飞影创建可复用的声音；不是驱动视频的背景音乐。'}];
 if(tool==='tts')return [script,voice];
 return null;
}
