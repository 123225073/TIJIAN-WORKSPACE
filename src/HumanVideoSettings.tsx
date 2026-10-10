import HelpTip from './HelpTip';
import './human-video-settings.css';
export const HUMAN_VIDEO_TOOLS=new Set(['text_avatar','audio_avatar','photo_talk']);
export const HUMAN_VIDEO_OPTIONS=new Set(['video_rate','st_show','subtitle_position','subtitle_size']);

export default function HumanVideoSettings({tool,options,onChange}:{tool:string;options:Record<string,any>;onChange:(options:Record<string,any>)=>void}){
 if(!HUMAN_VIDEO_TOOLS.has(tool))return null;
 const speed=Number(options.video_rate??1),captions=options.st_show===1;
 const change=(key:string,value:any)=>onChange({...options,[key]:value});
 return <div className="st-video-settings" aria-label="本条视频设置">
  <div className="st-video-rate-control"><div className="st-video-speed-label"><label htmlFor="current-video-rate">本条语速</label><HelpTip label="本条视频语速">仅保存到当前视频草稿。飞影生成后，工作台同步调整声音和画面，保留音调并保存实际成片；不改变克隆声音资产，也不增加平台生成次数。这里的倍数相对于飞影返回的原成片。</HelpTip><output htmlFor="current-video-rate">{speed.toFixed(2).replace(/0$/,'')}×</output><HelpTip label="成片与品牌水印">飞影品牌水印由 API 账号权益决定，扣积分不代表已开通无品牌水印输出；公开接口没有品牌去水印开关。“AI 生成”标识是另一项设置。需向飞影核实当前 API 账号的输出权益。</HelpTip></div>
  <div className="st-video-speed-input"><input id="current-video-rate" aria-label="本条视频语速倍数" type="range" min="0.5" max="2" step="0.05" value={speed} onChange={e=>change('video_rate',Number(Number(e.target.value).toFixed(2)))}/><div>{[1.1,1.2].map(value=><button type="button" key={value} aria-label={'本条语速 '+value+' 倍'} aria-pressed={speed===value} onClick={()=>change('video_rate',value)}>{value}×</button>)}</div></div></div>
  {tool==='text_avatar'&&<div className="st-video-caption-control"><label>字幕<HelpTip label="本条视频字幕">可关闭字幕。显示时按原素材画布设置位置，默认底部居中、白字深色描边；修改只用于下一次生成，已经烧录到视频中的字幕不会自动改变。</HelpTip><select aria-label="本条视频字幕" value={captions?'1':'0'} onChange={e=>change('st_show',Number(e.target.value))}><option value="0">不显示字幕</option><option value="1">显示字幕</option></select></label></div>}
  {captions&&tool==='text_avatar'&&<details className="st-video-subtitle-detail"><summary>字幕样式 · {options.subtitle_position==='middle'?'画面居中':'底部居中'}</summary><div className="st-video-subtitle-fields"><label>位置<select aria-label="字幕位置" value={options.subtitle_position||'bottom'} onChange={e=>change('subtitle_position',e.target.value)}><option value="bottom">底部居中</option><option value="middle">画面居中</option></select></label><label>字号<select aria-label="字幕字号" value={options.subtitle_size||'medium'} onChange={e=>change('subtitle_size',e.target.value)}><option value="small">小</option><option value="medium">标准</option><option value="large">大</option></select></label></div></details>}

 </div>;
}
