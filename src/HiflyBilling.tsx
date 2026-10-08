import './hifly-billing.css';

export function hiflyCostHint(tool:string,source?:string){
 if(tool==='avatar_create')return source==='image'?'照片创建形象会消耗飞影积分；创建后保存为资产，后续生成视频另行消耗积分。具体单价以飞影当前 API 账户规则为准。':'视频创建形象的积分费用未在 API 文档中明确；不能承诺免费。创建后保存为资产，后续生成视频会消耗积分。';
 if(tool==='voice_create')return '声音克隆费用未在 API 文档中明确；不能承诺免费。后续文本配音与视频生成会消耗积分。';
 return '本次生成会消耗飞影积分。公开 API 文档未公布精确单价，请以当前 API 账户计费规则及账单为准。';
}

export default function HiflyBilling({tool,source}:{tool?:string;source?:string}){
 return <details className="hifly-billing"><summary>飞影积分与费用</summary>
  {tool&&<p className="hifly-billing-current">{hiflyCostHint(tool,source)}</p>}
  <dl>
   <div><dt>明确消耗积分</dt><dd>照片创建形象；文字、音频、图片与模板驱动视频；视频翻译、唱歌视频；文字转语音。</dd></div>
   <div><dt>费用未明确</dt><dd>视频创建形象、声音克隆、模板封面、查询与同步。官方 API 文档未明确费用，不能按免费理解。</dd></div>
   <div><dt>本地查看</dt><dd>播放、放大已保存素材不会发起飞影生成任务，不产生新的生成积分消耗。</dd></div>
   <div><dt>具体价格</dt><dd>当前公开 API 文档没有公布每次／每秒积分单价或人民币兑换价格，以飞影当前账户报价和账单为准。网页版会员优惠不等同于 API 优惠。</dd></div>
  </dl>
  <p className="hifly-billing-source">核对日期：2026-10-08 · <a href="https://api.hifly.cc/hifly.html" target="_blank" rel="noreferrer">官方 API 与错误码 ↗</a></p>
 </details>;
}
