import {useEffect,useState} from 'react';
import {Download,Image as ImageIcon,LoaderCircle,Video} from 'lucide-react';
import {getToken} from './api';
import './platform-publish.css';

type Asset={id:string;title:string;asset_type:string;status:string;file_url?:string};
type Props={draft:any;assets:Asset[];busy:boolean;onChange:(key:string,value:string|string[])=>void;onSave:()=>void;onDownload:()=>void;onCreateCover:()=>void;worksHref:string};

function CoverPreview({asset}:{asset?:Asset}){
 const [url,setUrl]=useState('');
 useEffect(()=>{if(!asset?.file_url){setUrl('');return}const controller=new AbortController();let object='';fetch(asset.file_url,{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('预览不可用');object=URL.createObjectURL(await response.blob());setUrl(object)}).catch(()=>setUrl(''));return()=>{controller.abort();if(object)URL.revokeObjectURL(object)}},[asset?.id,asset?.file_url]);
 return <div className="td-cover-preview">{url?<img src={url} alt={asset?.title||'已选封面'}/>:<ImageIcon size={28}/>}</div>;
}

export default function PlatformPublishForm({draft,assets,busy,onChange,onSave,onDownload,onCreateCover,worksHref}:Props){
 const article=draft.platform==='wechat',cover=assets.find(x=>x.id===draft.cover_asset_id),video=assets.find(x=>x.id===draft.video_asset_id);
 const missing=[!draft.title?.trim()?'标题':'',!draft.cover_asset_id?'封面':'',article?!draft.body?.trim()?'正文':'':!draft.video_asset_id?'成片视频':'',!article&&!draft.caption?.trim()?'发布描述':''].filter(Boolean);
 const images=assets.filter(x=>x.asset_type==='image'&&x.status==='ready'),videos=assets.filter(x=>x.asset_type==='video'&&x.status==='ready');
 return <>
  <div className="td-editor-meta"><span>{draft.id?'已保存草稿 v'+draft.version:'待保存的发布稿'} · 尚未发布</span><span>{missing.length?'还需补充：'+missing.join('、'):'主要发布内容已填齐，请人工核对'}</span></div>
  <div className="td-publish-layout"><div className="td-publish-main">
   <section className="td-publish-card"><div className="td-section-heading"><span>01</span><strong>{article?'公众号文章信息':'短视频发布信息'}</strong><small>按平台发布时看到的顺序填写</small></div>
    <label>封面图片 <small>从本次作品或素材库选择，可随时替换</small><div className="td-cover-field"><CoverPreview asset={cover}/><select aria-label="封面图片" value={draft.cover_asset_id||''} onChange={e=>onChange('cover_asset_id',e.target.value)}><option value="">尚未选择封面</option>{images.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></div></label>
    <button type="button" className="td-create-cover" disabled={busy} onClick={onCreateCover}>去生成新封面 →</button>
    <label>{article?'文章标题':'视频标题'}{article&&<small>公众号最多 32 字 · {(draft.title||'').length}/32</small>}<input value={draft.title||''} maxLength={article?32:undefined} placeholder={article?'让读者一眼看出文章回答什么问题':'一句话说清视频主题'} onChange={e=>onChange('title',e.target.value)}/></label>
    <label>{article?'摘要 / 分享说明（可选）':'发布描述'}{article&&<small>公众号最多 120 字 · {(draft.summary||'').length}/120</small>}<textarea rows={3} value={draft[article?'summary':'caption']||''} maxLength={article?120:undefined} placeholder={article?'发布时显示的简短介绍，可手动修改':'视频发布时填写的简短说明'} onChange={e=>onChange(article?'summary':'caption',e.target.value)}/></label>
    {!article&&<label>话题标签<input value={draft.tags||''} placeholder="例如：#电梯更新 #物业管理" onChange={e=>onChange('tags',e.target.value)}/></label>}
    {!article&&<label>成片视频 <small>未生成视频也能先编辑文案，发布前再补</small><div className="td-video-field"><Video size={19}/><select aria-label="成片视频" value={draft.video_asset_id||''} onChange={e=>onChange('video_asset_id',e.target.value)}><option value="">尚未选择成片视频</option>{videos.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></div>{video&&<small>已选择：{video.title}</small>}</label>}
   </section>
   <section className="td-publish-card"><div className="td-section-heading"><span>02</span><strong>{article?'文章正文':'视频口播稿'}</strong><small>从第 4 步带入的文稿可以继续修改</small></div><label>{article?'正文':'口播内容'}<textarea rows={article?12:8} value={draft[article?'body':'script']||''} placeholder={article?'在这里编辑最终文章正文':'在这里编辑视频口播内容'} onChange={e=>onChange(article?'body':'script',e.target.value)}/></label></section>
  </div><aside className="td-publish-guide"><strong>本页使用顺序</strong><ol><li>选封面，填写标题、摘要和正文</li><li>保存发布稿</li><li>{article?'同步公众号草稿箱并核对':'导出稿件后到平台手工发布'}</li></ol><a href={'#'+worksHref}>查看或上传作品素材 →</a><small>保存和导出不会自动发布。</small></aside></div>
  <div className="td-actions td-sticky"><button className="td-primary" disabled={busy} onClick={onSave}>{busy&&<LoaderCircle className="spin" size={15}/>} {busy?'正在保存…':'保存发布稿'}</button><button disabled={busy} onClick={onDownload}><Download size={15}/>导出文稿</button></div>
 </>;
}
