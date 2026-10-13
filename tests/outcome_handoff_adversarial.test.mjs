// Runs original source callbacks without app/build/browser/backend/model access.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import ts from 'typescript';

const sourceModule=(file,mocks)=>{
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};new Function('require','exports',source)(name=>{
  if(name in mocks)return mocks[name];
  if(name.endsWith('.css'))return {};
  throw Error('Unmocked dependency: '+name);
 },exports);return exports;
};
const hooks=()=>{const slots=[];let cursor=0;return {
 begin(){cursor=0},
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
 useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]},
 useEffect(){},
};};
const jsx=(type,props)=>({type,props});
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function mountHandoff({content,save,api}){
 const component=sourceModule('src/OutcomeHandoff.tsx',{'react':hooks(),'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ArrowRight:'ArrowRight'},'./api':{api}}).default;
 const tree=component({content,task:{id:'task'},platform:'wechat',save,disabled:false,t:{refresh:async()=>{}},onBusy:()=>{}});
 return tree.props.children.find(x=>x?.type==='button');
}

test('handoff binds the just-saved version, rejecting another-window changes',async()=>{
 globalThis.location={hash:''};const writes=[];
 const button=mountHandoff({content:{id:'article',version:1},save:async()=>({id:'article',version:2}),api:async(path,body)=>{
  if(!body)return {items:[{id:'article',version:3,body:'Another window changed the article'}]};
  writes.push(body);return {route:'studio/topics?topic=created'};
 }});
 button.props.onClick();await turn();
 assert.deepEqual(writes,[{version:2}],'Actual callback silently promotes the token to another window\'s v3');
});

for(const field of ['body','title','summary','cover_brief','cover_asset_id','wechat_style'])
test(`handoff stops if recovery changes ${field} while the PATCH is saving`,async()=>{
 globalThis.location={hash:''};globalThis.localStorage=storage();
 const a=field==='wechat_style'?{font_size:'15'}:'A',b=field==='wechat_style'?{font_size:'16'}:'B',c=field==='wechat_style'?{font_size:'17'}:'C';
 const original={id:'article',version:1,[field]:a},fields=row=>({[field]:row[field]}),key='platform-draft:alice:article';
 localStorage.setItem(key,JSON.stringify({values:{[field]:a},baseline:{[field]:a},version:1,recovery:[{version:1,label:'local recovery',fields:{[field]:c}}]}));
 const patch=deferred(),started=deferred();let server=original;
 const draftHooks=hooks();
 const {useArticleDraft}=sourceModule('src/article-draft.tsx',{'react':draftHooks,'react/jsx-runtime':{jsx,jsxs:jsx},'./api':{api:async(path,body)=>{
  if(!body)return {items:[server]};started.resolve();await patch.promise;server={...original,...body,version:2};return server;
 }}});
 const render=()=>{draftHooks.begin();return useArticleDraft({content:original,key,fields,path:'/tasks/task/outcomes/article',refresh:async()=>{}})};
 let draft=render();draft.change(field,b);draft=render();
 const writes=[];
 const button=mountHandoff({content:original,save:draft.save,api:async(path,body)=>{
  if(!body)return {items:[server]};writes.push(body);return {route:'studio/topics?topic=created'};
 }});
 button.props.onClick();await started.promise;
 // ArticleDraftFeedback exposes restore() during handoffBusy; its button is enabled.
 draft.restore(0);patch.resolve();await turn();draft=render();
 assert.deepEqual(draft.values[field],c);assert.equal(draft.dirty,true);
 assert.equal(writes.length,0,'Actual callback transfers B and navigates away while the current draft is C');
});

test('explicit no-IP handoff does not fall back to the newest IP',{skip:!process.env.HANDOFF_IDENTITY_FIXTURE},()=>{
 globalThis.localStorage=storage();
 const {flowProfileInitial,resolveProfileId}=sourceModule('src/profile-defaults.ts',{'react':hooks()});
 const {flow,profiles}=JSON.parse(process.env.HANDOFF_IDENTITY_FIXTURE);
 const initial=flowProfileInitial(flow,undefined);
 const value=resolveProfileId(profiles,initial,true);
 assert.equal(value,'','Explicit generic choice disappeared and selected another existing IP');
});

test('real TopicDelivery render accepts the handoff route and reopens its edited delivery',{skip:!process.env.HANDOFF_REVIEW_FIXTURE},()=>{
 globalThis.localStorage=storage();
 const {flow,topic,copy,items,edited:delivery,route}=JSON.parse(process.env.HANDOFF_REVIEW_FIXTURE);
 const slots=[[topic],items,[],flow,true],effects=[];let cursor=0;
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},useRef:v=>({current:v}),useMemo:fn=>fn(),useEffect:(fn,deps)=>effects.push({fn,deps})};
 const profiles=sourceModule('src/profile-defaults.ts',{'react':react});
 const component=sourceModule('src/TopicDelivery.tsx',{
  'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'lucide-react':{},'./profile-defaults':{...profiles,useProfileDefault:()=>['',()=>{}]},
  './api':{api:async()=>{throw Error('No live API is allowed')}},
  './speech-helper':{speechFromContent:()=>({text:''})},'./OperationFeedback':{activeJob:()=>false},
  './DeliveryBundle':{bundleOrder:()=>['title','copy','cover','video'],bundleHidden:()=>[]},
  './PlatformPublishForm':{default:'PlatformPublishForm'},'./WechatArticleForm':{default:'WechatArticleForm'},
  './WechatOptimizePage':{default:'WechatOptimizePage'},'./WechatPublishPanel':{default:'WechatPublishPanel'},
  './TopicAddDrawer':{default:'TopicAddDrawer'},'./TopicLibraryControls':{default:'TopicLibraryControls'},
 }).default;
 const page=route.replace(/^studio\//,'');
 const props={page,t:{state:{user:{id:'alice'},complete:true,models:[]},list:()=>[],get:id=>id===copy.id?copy:null}};
 component(props);
 const selection=effects.find(x=>x.deps?.[0]===topic.id&&x.deps?.[1]==='wechat'&&x.deps?.[2]===slots[1]);
 assert(selection,'Actual selection useEffect should be found');selection.fn();cursor=0;
 const tree=component(props);
 const walk=x=>{if(!x)return [];if(Array.isArray(x))return x.flatMap(walk);if(typeof x!=='object')return [];return [x,...walk(x.props?.children)]};
 const form=walk(tree).find(x=>x.type==='WechatArticleForm');
 assert(form,'Actual route should render the WechatArticleForm');
 assert.equal(form.props.draft.id,delivery.id,'Actual component opens an unsaved starter instead of the existing edited delivery');
 for(const field of ['title','body','summary','cover_brief','cover_asset_id','wechat_style'])assert.deepEqual(form.props.draft[field],delivery[field],field);
});

test('keyboard edits while handoffBusy are blocked or retained, never silently discarded',()=>{
 globalThis.localStorage=storage();let latestBody='Saved B';
 const react=hooks();let first=true;const parentReact={...react,useState(initial){if(first){first=false;return [true,()=>{}]}return react.useState(initial)}};
 const draft={values:{title:'Article',body:latestBody,summary:'',cover_brief:'',wechat_style:{font_size:'16'}},version:2,saving:true,dirty:false,
  change:(field,value)=>{if(field==='body')latestBody=value},save:async()=>{}};
 const parent=sourceModule('src/PlatformArticleOutcome.tsx',{
  'react':parentReact,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{},'./api':{},
  './Markdown':{default:'Markdown'},'./AssetPicker':{default:'AssetPicker',AssetThumbnail:'AssetThumbnail'},
  './WechatLayoutProof':{default:'WechatLayoutProof',defaultWechatStyle:{}},
  './ArticleRichEditor':{default:'ArticleRichEditor'},'./ArticleImagePicker':{default:'ArticleImagePicker'},
  './article-draft':{useArticleDraft:()=>draft,ArticleDraftFeedback:'ArticleDraftFeedback'},
  './OutcomeHandoff':{default:'OutcomeHandoff'},'./article-production':{parseArticleProduction:()=>({instructions:[]})},
  './article-position':{imageTag:()=>''},
 }).default;
 const walk=x=>{if(!x)return [];if(Array.isArray(x))return x.flatMap(walk);if(typeof x!=='object')return [];return [x,...walk(x.props?.children)]};
 const parentTree=parent({content:{id:'article',version:2},platform:'wechat',task:{id:'task'},t:{state:{user:{id:'alice'}}},pictures:[],running:false,registerSave:{current:null}});
 const editorProps=walk(parentTree).find(x=>x.type==='ArticleRichEditor').props;
 let firstRef=true;const dom={textContent:'New keyboard edit C'};
 const editor=sourceModule('src/ArticleRichEditor.tsx',{
  'react':{...hooks(),forwardRef:fn=>fn,useImperativeHandle:()=>{},useRef(initial){if(firstRef){firstRef=false;return {current:dom}}return {current:initial}}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-dom':{createPortal:()=>null},'./api':{},
  './article-position':{},'./wechat-rich':{editorToMarkdown:node=>node.textContent,WECHAT_COLORS:{},WECHAT_SIZES:[]},
 }).default;
 const textbox=walk(editor(editorProps,null)).find(x=>x.props?.role==='textbox');
 const isBlocked=textbox.props.contentEditable===false||textbox.props.inert||textbox.props.onBeforeInput;
 if(!isBlocked)textbox.props.onInput();
 assert(isBlocked||latestBody===dom.textContent,'Real editor stays contentEditable, but real parent onChange drops all typing while busy');
});
