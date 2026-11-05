import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronRight,Search,Sparkles,X} from 'lucide-react';
import {pictureStyleById,pictureStyles} from './picture-styles';
import './image-style-picker.css';

const categories=[['all','全部风格'],['scene','写实场景'],['engineering','产品工程'],['animation','动漫与 3D']] as const;
const styleCategory:Record<string,string>={editorial:'scene',architecture:'scene',presenter:'scene',consultation:'scene',home:'scene',product:'engineering',engineering:'engineering',industrial:'engineering',concrete:'animation',realistic3d:'animation',anime:'animation',animation3d:'animation'};
const sample=(id:string)=>{const index=pictureStyles.findIndex(item=>item.id===id);return {backgroundPosition:`${index%4/3*100}% ${Math.floor(index/4)/2*100}%`}};
function StylePreview({id}:{id:string}){
 return id==='auto'||!pictureStyles.some(item=>item.id===id)?<span className="image-style-auto-preview" aria-hidden="true"><Sparkles size={24}/></span>:<span className="image-style-sample" style={sample(id)} role="img" aria-label={pictureStyleById(id).title+'风格参考图'}/>;
}
/** Shared gallery: choosing a reference changes only the saved visual style. */
export default function ImageStylePicker({value,onChange,disabled=false,article=false}:{value?:string;onChange:(id:string)=>void;disabled?:boolean;article?:boolean}){
 const uid=useId(),style=pictureStyleById(value),title=uid+'-title',description=uid+'-description';
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[category,setCategory]=useState('all');
 const dialog=useRef<HTMLDialogElement>(null),search=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const autoLabel=article?'自动匹配文章风格':'保留原要求 / 原图风格',currentLabel=style.id==='auto'?autoLabel:style.title;
 const visible=pictureStyles.filter(item=>(category==='all'||styleCategory[item.id]===category)&&(!query.trim()||(item.title+' '+item.description).includes(query.trim())));
 const close=()=>setOpen(false);
 useEffect(()=>{if(!open)return;dialog.current?.showModal();search.current?.focus();return()=>{dialog.current?.close();trigger.current?.focus()}},[open]);
 useEffect(()=>{if(disabled)setOpen(false)},[disabled]);
 const choose=(id:string)=>{onChange(id);close()};
 return <div className="image-style-picker">
  <span className="image-style-label">画面风格</span>
  <button ref={trigger} type="button" className="image-style-trigger" aria-label={'画面风格：'+currentLabel} aria-haspopup="dialog" aria-expanded={open} aria-describedby={description} disabled={disabled} onClick={()=>{setQuery('');setCategory('all');setOpen(true)}}>
   <StylePreview id={style.id}/><span><strong>{currentLabel}</strong><small>看图选风格</small></span><ChevronRight size={15}/>
  </button>
  <p className="image-style-description" id={description}>{style.id==='auto'&&!article?'按你的要求生成；编辑图片时保留原图风格。':style.description}</p>
  {open&&createPortal(<dialog ref={dialog} className="image-style-gallery" aria-labelledby={title} onCancel={event=>{event.preventDefault();close()}}>
   <header className="image-style-gallery-head"><div><span>风格参考库</span><h2 id={title}>看图，选择这次的画面风格</h2><p>同一个电梯场景，直观比较不同画法。参考图用于说明风格，生成内容会依据你的文章或要求。</p></div><button type="button" className="image-style-gallery-close" onClick={close} aria-label="关闭风格图库"><X size={20}/><span>关闭</span></button></header>
   <div className="image-style-gallery-tools"><nav aria-label="风格分类">{categories.map(([id,label])=><button type="button" key={id} aria-pressed={category===id} onClick={()=>setCategory(id)}>{label}</button>)}</nav><label className="image-style-search"><Search size={17}/><input ref={search} aria-label="搜索画面风格" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索纪实、产品、动漫…"/>{query&&<button type="button" aria-label="清空风格搜索" onClick={()=>setQuery('')}><X size={15}/></button>}</label></div>
   <div className="image-style-gallery-scroll">
    {!query.trim()&&category==='all'&&<button type="button" className="image-style-auto-card" aria-label={autoLabel} aria-pressed={style.id==='auto'} onClick={()=>choose('auto')}><StylePreview id="auto"/><span><strong>{autoLabel}</strong><small>{article?'由文章内容匹配，整组图片保持统一':'沿用你的提示词；图片编辑优先保留原图风格'}</small></span>{style.id==='auto'&&<Check size={19}/>}</button>}
    <div className="image-style-gallery-grid" aria-label="图片风格模板">{visible.map(item=><button type="button" key={item.id} className="image-style-card" aria-label={item.title} aria-pressed={style.id===item.id} onClick={()=>choose(item.id)}><StylePreview id={item.id}/><span className="image-style-card-copy"><span><strong>{item.title}</strong>{style.id===item.id&&<Check size={18}/>}</span><small>{item.description}</small></span></button>)}</div>
    {!visible.length&&<p className="image-style-no-results">没有找到这种风格，换个关键词试试。</p>}
   </div><footer className="image-style-gallery-foot"><span>{pictureStyles.length} 种风格 · 点击图片即可选用</span><span>选择风格不会开始生成</span></footer>
  </dialog>,document.body)}
 </div>;
}
