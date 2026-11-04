import type {ReactNode} from 'react';
import {StudioModal} from './AssetPicker';
import ArkVideoControls from './ArkVideoControls';
import VideoReferences from './VideoReferences';
import {supportsVideoModes,videoReferenceCounts} from './video-inputs';

type VideoModel = {
 id: string;
 title: string;
 configured?: boolean;
 price_per_second?: number;
};

type Props = {
 open: boolean;
 onClose: () => void;
 draft: any;
 model: any;
 models: VideoModel[];
 binding?: string;
 assets: any[];
 assetsHref?: string;
 update: (values:any) => void;
 reload: (added?:any[]) => Promise<void>;
 changeModel: (id:string) => void;
 changeOptions: (name:string, value:any) => void;
 busy: boolean;
 error?: string;
 issue: string;
 context: ReactNode;
};

export default function VideoSettings({open,onClose,draft,model,models,binding,assets,assetsHref,update,reload,changeModel,changeOptions,busy,error,issue,context}:Props){
 const configuredModes=supportsVideoModes(model);
 const controls={draft,model,update,changeOptions,busy};
 const usesMaterials=!draft.inputs.draft_run;
 const textOnly=draft.inputs.reference_mode==='text'&&!Object.values(videoReferenceCounts(draft.inputs)).some(Boolean);
 return <StudioModal title="视频设置" open={open} onClose={onClose}>
  <div className="video-settings">
   <div className="video-settings-fields">
    <section aria-label="生成参数">
     <h3>生成参数</h3>
     <label className="video-model-field">生成模型
      <select aria-label="生成模型" disabled={busy||!models.length} value={draft.model_id||binding||''} onChange={e=>changeModel(e.target.value)}>
       <option value="">后台默认模型</option>
       {models.map(item=><option key={item.id} value={item.id}>{item.title}{item.price_per_second!==undefined?' · ¥'+item.price_per_second.toFixed(2)+'/秒':''}{item.configured?'':' · 未配置'}</option>)}
      </select>
     </label>
     {configuredModes?<><ArkVideoControls {...controls}/><ArkVideoControls {...controls} section="settings"/></>:model&&
      <div className="ark-basic-grid">{Object.entries(model.options||{}).map(([key,choices])=>
       <label key={key}>{({aspect_ratio:'画面比例',resolution:'清晰度',duration:'时长',generate_audio:'声音'} as Record<string,string>)[key]||key}
        <select disabled={busy} value={JSON.stringify(draft.options?.[key])||''} onChange={e=>changeOptions(key,e.target.value?JSON.parse(e.target.value):undefined)}>
         <option value="">服务默认</option>
         {(choices as unknown[]).map(value=><option key={JSON.stringify(value)} value={JSON.stringify(value)}>{typeof value==='boolean'?(value?'开启':'关闭'):String(value)}</option>)}
        </select>
       </label>
      )}</div>
     }
     {context&&<div className="video-settings-context">{context}</div>}
    </section>
    <section aria-label="视频参考素材">
     <div className="video-settings-material-heading">
      <h3>参考素材</h3>
      {assetsHref&&<a href={assetsHref}>管理素材</a>}
     </div>
     {usesMaterials&&<VideoReferences draft={draft} model={model} assets={assets} update={update} reload={reload} busy={busy} library/>}
     {(!usesMaterials||textOnly)&&
      <p className="video-settings-note">{usesMaterials?'当前为文字生视频。需要加图或音视频时，可切换创作方式。':'当前沿用已选样片的画面与声音。'}</p>}
    </section>
   </div>
   <footer>
    {(error||issue)&&<p className="video-settings-message" role="status">{error||issue}</p>}
    <div><small>参数与素材随当前草稿保存</small><button type="button" className="st-primary" onClick={onClose}>完成设置</button></div>
   </footer>
  </div>
 </StudioModal>;
}
