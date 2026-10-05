import {useEffect,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import {api,getToken} from './api';

export type WechatStyle={font_size:string;line_height:string;paragraph_gap:string;accent:string};
export const defaultWechatStyle:WechatStyle={font_size:'16',line_height:'1.8',paragraph_gap:'12',accent:'forest'};

const LOCAL_SRC=/src="(\/api\/(?:studio\/assets\/[a-f0-9]{32,64}\/file|illustrations\/[a-f0-9]{32}\/file))"/g;
const imageData=async(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('正文图片预览失败'));reader.readAsDataURL(blob)});

export default function WechatLayoutProof({body,settings}:{body:string;settings:WechatStyle}){
 const [html,setHtml]=useState(''),[status,setStatus]=useState('正在准备公众号排版…'),[error,setError]=useState('');
 const images=useRef(new Map<string,string>());
 useEffect(()=>{
  let live=true;
  const timer=setTimeout(async()=>{
   setStatus('正在更新排版预览…');setError('');
   try{
    const result=await api('/wechat-publish/preview',{body,wechat_style:settings});
    let output=String(result.html||'');
    for(const path of new Set(Array.from(output.matchAll(LOCAL_SRC),match=>match[1]))){
     let data=images.current.get(path);
     if(!data){
      if(path.startsWith('/api/illustrations/'))data=String((await api(path.slice(4))).data_uri||'');
      else{const response=await fetch(path,{headers:{Authorization:'Bearer '+getToken()}});if(!response.ok)throw Error('正文图片无法预览，请检查素材是否仍可用');data=await imageData(await response.blob())}
      if(data)images.current.set(path,data);
     }
     if(data)output=output.replaceAll('src="'+path+'"','src="'+data+'"');
    }
    if(live){setHtml(DOMPurify.sanitize(output));setStatus('已按当前设置排版 · 同步草稿时使用同一转换规则')}
   }catch(e){if(live){setError(e instanceof Error?e.message:'排版预览失败');setStatus('')}}
  },450);
  return()=>{live=false;clearTimeout(timer)};
 },[body,settings.font_size,settings.line_height,settings.paragraph_gap,settings.accent]);
 const document=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html{background:#fff}body{max-width:680px;margin:0 auto;padding:20px 24px;box-sizing:border-box;font-family:'PingFang SC','Microsoft YaHei',sans-serif}img{max-width:100%}</style></head><body>${html||'<p style="color:#839589">填写正文后可查看公众号排版</p>'}</body></html>`;
 return <div className="wa-layout-proof">
  <div className="wa-proof-head"><strong>公众号排版预览</strong><small>在左侧直接编辑，保存后用于草稿同步</small></div>
  <p className="wa-proof-status" role="status">{error||status}</p>
  <iframe title="公众号排版预览" className="wa-proof-frame" sandbox="" srcDoc={document}/>
  <small className="wa-proof-note">预览与同步使用同一排版规则。微信编辑器仍可能调整个别样式；同步后请在公众号后台核对。</small>
 </div>;
}
