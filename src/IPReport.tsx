import {useId,type ReactNode} from 'react';
import Markdown from './Markdown';
import './ip-report.css';

export type IPReportProps={
 title?:string;
 body:string;
 onBodyChange?:(body:string)=>void;
 disabled?:boolean;
 /** Optional archive summary fields, kept separate from the report reading view. */
 children?:ReactNode;
};

/** The saved positioning report is a document; interview answers stay in the guide. */
export default function IPReport({title='个人 IP 定位策划报告',body,onBodyChange,disabled=false,children}:IPReportProps){
 const id=useId(),headingId='ip-report-title-'+id,editId='ip-report-edit-'+id;
 const content=String(body||'');
 const leadingHeading=/^\s*#\s+([^\r\n]+?)(?:\s+#+)?[ \t]*(?:\r?\n|$)/.exec(content);
 const archiveTitle=title.trim();
 const reportTitle=leadingHeading?.[1].trim()||(archiveTitle?(archiveTitle.includes('报告')?archiveTitle:archiveTitle+' · 个人 IP 报告'):'个人 IP 定位策划报告');
 // Presentation only: the editable/saved source retains its original H1.
 const readingBody=leadingHeading?content.slice(leadingHeading[0].length):content;
 return <article className="ip-report" aria-labelledby={headingId}>
  <header className="ip-report-heading"><span>PERSONAL IP / POSITIONING REPORT</span><h2 id={headingId}>{reportTitle}</h2><p>围绕你的业务、客户与表达方式，形成可持续使用的创作定位。</p></header>
  <div className="ip-report-body">{readingBody.trim()?<Markdown text={readingBody}/>:<p className="ip-report-empty">定位报告尚未整理完成。完成引导并生成报告后，将在这里显示完整方案。</p>}</div>
  {(children||onBodyChange)&&<div className="ip-report-adjustments">
   {children&&<details className="ip-report-summary"><summary>档案摘要 · 查看或修改</summary><div className="ip-report-summary-fields">{children}</div></details>}
   {onBodyChange&&<details className="ip-report-editor"><summary>修改报告正文</summary><div><label htmlFor={editId}>完整定位策划报告</label><p id={editId+'-help'}>支持 Markdown 标题、段落与列表。修改后，请使用页面上的确认保存按钮。</p><textarea id={editId} aria-describedby={editId+'-help'} value={content} disabled={disabled} onChange={event=>onBodyChange(event.target.value)} rows={18} spellCheck={false}/></div></details>}
  </div>}
 </article>;
}
