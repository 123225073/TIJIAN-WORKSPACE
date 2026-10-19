import {useState} from 'react';
import MediaReferences from './MediaReferences';
import {videoReferenceCounts,videoReferenceModel} from './video-inputs';

export default function VideoReferences(props:any){
 const [advanced,setAdvanced]=useState(false);
 const counts=videoReferenceCounts(props.draft.inputs);
 const ark=props.model?.provider==='ark';
 if(ark&&props.draft.inputs.reference_mode==='text'&&!Object.values(counts).some(Boolean))return null;
 return <div className={'video-reference-inputs'+(advanced||!ark?' show-technical-references':'')}>
  <MediaReferences {...props} model={videoReferenceModel(props.draft,props.model)} update={(values:any)=>props.update({...values,...(Array.isArray(values.image_ids)?{image_id:values.image_ids[0]||''}:{})})}/>
  {ark&&<button className="video-reference-toggle" type="button" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}>{advanced?'收起素材地址与说明':'使用素材链接或查看说明'}</button>}
 </div>;
}
