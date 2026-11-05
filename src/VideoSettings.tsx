import type {ReactNode} from 'react';
import ArkVideoControls from './ArkVideoControls';
import VideoReferences from './VideoReferences';
import {videoReferenceCounts,WORKBENCH_VIDEO_MODEL_TITLE} from './video-inputs';

type Props = {
 draft: any;
 model: any;
 assets: any[];
 assetsHref?: string;
 update: (values:any) => void;
 reload: (added?:any[]) => Promise<void>;
 changeOptions: (name:string, value:any) => void;
 busy: boolean;
 issue: string;
 context: ReactNode;
};

export default function VideoSettings({draft,model,assets,assetsHref,update,reload,changeOptions,busy,issue,context}:Props){
 const controls={draft,model,update,changeOptions,busy};
 const textOnly=draft.inputs.reference_mode==='text'&&!Object.values(videoReferenceCounts(draft.inputs)).some(Boolean);
 const rate=model?.price_per_second;
 return <section className="video-settings" aria-label="视频设置">
  <header className="video-settings-heading">
   <h2>视频设置</h2>
   <div className="video-model-badge"><strong>{model?.title||WORKBENCH_VIDEO_MODEL_TITLE}</strong>{rate!==undefined&&<small>¥{rate.toFixed(2)}/秒</small>}</div>
  </header>
  <div className="video-settings-fields">
   <section aria-label="生成参数">
    {model?<><ArkVideoControls {...controls}/><ArkVideoControls {...controls} section="settings"/></>:<p className="video-settings-note">生成服务未启用，请联系管理员。</p>}
    {context&&<div className="video-settings-context">{context}</div>}
   </section>
   <section aria-label="视频参考素材">
    <div className="video-settings-material-heading">
     <h3>参考素材</h3>
     {assetsHref&&<a href={assetsHref}>管理素材</a>}
    </div>
    {model&&<VideoReferences draft={draft} model={model} assets={assets} update={update} reload={reload} busy={busy} library/>}
    {textOnly&&<p className="video-settings-note">文字生视频只使用提示词。需要参考素材时，请切换创作方式。</p>}
   </section>
  </div>
  {issue&&<p className="video-settings-message" role="status">{issue}</p>}
 </section>;
}
