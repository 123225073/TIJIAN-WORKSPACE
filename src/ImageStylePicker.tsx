import {useId} from 'react';
import {imageStyleTemplates,pictureStyleById} from './picture-styles';
import './image-style-picker.css';

const palettes:Record<string,string[]>={auto:['#f7f4e9','#335f50','#c1a06b'],industry:['#f7f4e9','#335f50','#c1a06b'],editorial:['#d9d5ca','#777c6d','#bd9873'],diagram:['#faf8f0','#254e68','#bf964c'],handdrawn:['#faecd7','#ad7863','#839277'],minimal:['#faf9f5','#243e5c','#c5c9ca'],architecture:['#ebe5d8','#7c7d6b','#a28566'],blueprint:['#eaf2f6','#305873','#dfac6b']};
/** A compact, shared picker; color chips are a palette reference, not generated output. */
export default function ImageStylePicker({value,onChange,disabled=false,article=false}:{value?:string;onChange:(id:string)=>void;disabled?:boolean;article?:boolean}){
 const id=useId(),style=pictureStyleById(value),description=id+'-description';
 return <div className="image-style-picker">
  <label htmlFor={id}>画面风格</label>
  <select id={id} aria-label="画面风格" aria-describedby={description} value={style.id} onChange={event=>onChange(event.target.value)} disabled={disabled}>
   {imageStyleTemplates.map(item=><option key={item.id} value={item.id}>{item.id==='auto'?(article?'自动匹配文章风格':'保留原要求 / 原图风格'):item.title}</option>)}
  </select>
  <div className="image-style-description" id={description}><span className="image-style-colors" aria-hidden="true">{palettes[style.id].map((color,index)=><i key={index} style={{background:color}}/>)}</span><span>{style.id==='auto'&&!article?'按你的要求生成；编辑图片时保留原图风格。':style.description}</span></div>
 </div>;
}
