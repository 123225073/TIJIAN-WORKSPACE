import {useEffect,useState} from 'react';
import {Gauge,LoaderCircle} from 'lucide-react';
import {api} from './api';
import {StudioModal} from './AssetPicker';
import HelpTip from './HelpTip';
import type {Asset} from './ResourcePreview';

export default function SpeechSpeed({asset,onSaved}:{asset:Asset;onSaved:()=>void}){
 const [open,setOpen]=useState(false);
 if(!asset.voice_parameter_editable)return <HelpTip label="语速">公共声音按其已有声音参数生成。可创建自己的声音后调整语速；不会用播放倍速代替生成语速。</HelpTip>;
 return <><button type="button" className="st-speech-speed-trigger" onClick={()=>setOpen(true)}><Gauge size={13}/>{asset.voice_parameters_status==='confirmed'&&asset.voice_parameters?.rate?'语速 '+asset.voice_parameters.rate+'×':'设置语速'}</button>{open&&<SpeechSpeedDialog asset={asset} onSaved={onSaved} onClose={()=>setOpen(false)}/>}</>;
}
function SpeechSpeedDialog({asset,onSaved,onClose}:{asset:Asset;onSaved:()=>void;onClose:()=>void}){
 const [current,setCurrent]=useState<{rate:number;version:number}|null>(null),[rate,setRate]=useState(1),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const endpoint='/studio/assets/'+encodeURIComponent(asset.id)+'/voice-parameters';
 useEffect(()=>{let live=true;void api(endpoint).then(result=>{if(!live)return;const value=Number(result.parameters?.rate);if(!Number.isFinite(value)||value<.5||value>2||!Number.isInteger(result.version))throw new Error('未读取到有效语速，请稍后重试');setCurrent({rate:value,version:result.version});setRate(value)}).catch(e=>{if(live)setError(e.message||'读取声音语速失败')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[endpoint]);
 const save=async()=>{if(!current||saving)return;setSaving(true);setError('');try{await api(endpoint,{version:current.version,confirmed:true,rate});onSaved();onClose()}catch(e){setError(e instanceof Error?e.message:'保存失败，请重新读取后核对');setCurrent(null)}finally{setSaving(false)}};
 return <StudioModal title="声音语速" onClose={()=>{if(!saving)onClose()}}><div className="st-speech-speed-dialog"><strong>{asset.title||'我的声音'}</strong><p>修改的是这个声音资产。保存后，后续使用它的文字口播、图片口播和配音都会采用新语速。</p>{loading?<p role="status"><LoaderCircle size={15} className="st-spin"/>正在读取当前语速…</p>:current&&<><label htmlFor="speech-speed-rate">语速 <output>{rate.toFixed(2).replace(/0$/,'')}×</output></label><input id="speech-speed-rate" aria-label="声音语速倍数" type="range" min="0.5" max="2" step="0.05" value={rate} disabled={saving} onChange={e=>setRate(Number(e.target.value))}/><div className="st-speech-speed-scale"><span>0.5× 慢</span><button type="button" disabled={saving} onClick={()=>setRate(1)}>1× 正常</button><span>2× 快</span></div></>}{error&&<p role="alert" className="st-warning">{error}</p>}<div className="st-dialog-actions"><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="button" className="st-primary" disabled={loading||saving||!current||current.rate===rate} onClick={()=>void save()}>{saving?'正在保存…':'保存此声音语速'}</button></div></div></StudioModal>;
}
