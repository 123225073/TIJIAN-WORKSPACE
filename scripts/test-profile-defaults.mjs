import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
process.on('uncaughtException', error=>{console.error(error.name+': '+error.message);process.exitCode=1});

// Execute the real TS/TSX with a tiny hook/element harness, never a server/provider.
const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
globalThis.location={hash:'#studio/topics'};
globalThis.history={replaceState(){}};
globalThis.confirm=()=>true;
globalThis.fetch=()=>{throw Error('Network forbidden in isolated profile tests')};
let renderer;
const hooks={
 useState(initial){const r=renderer,index=r.cursor++;if(!r.slots[index])r.slots[index]={value:typeof initial==='function'?initial():initial};return [r.slots[index].value,value=>{const old=r.slots[index].value,next=typeof value==='function'?value(old):value;if(next!==old){r.slots[index].value=next;r.dirty=true}}]},
 useRef(initial){const r=renderer,index=r.cursor++;return (r.slots[index]??={value:{current:initial}}).value},
 useMemo(fn){renderer.cursor++;return fn()},
 useCallback(fn){renderer.cursor++;return fn},
 useEffect(fn,deps){const r=renderer,index=r.cursor++,old=r.slots[index];if(!old||!deps||deps.some((d,i)=>!Object.is(d,old.deps?.[i]))){r.effects.push(()=>{old?.cleanup?.();const next={deps,cleanup:fn()};r.slots[index]=next})}},
};
hooks.useLayoutEffect=hooks.useEffect;
const jsx=(type,props,key)=>({type,props:props||{},key});
const stub=name=>Object.assign(()=>null,{label:name});
let requests=[],handler=async()=>({items:[],tools:[]});
const api=async(path,body,method)=>{requests.push({path,body,method});return handler(path,body,method)};
const modules={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'./api':{api,getToken:()=> 'isolated',download:async()=>{},hasToken:()=>true,restoreLogin:async()=>{},setToken:()=>{}},'./OperationFeedback':{activeJob:job=>!!job&&['queued','running'].includes(job.status),JobFeedback:stub('JobFeedback')},'./ReferencePicker':{defaultScope:{mode:'auto',item_ids:[],modules:[],folder_ids:[],excluded_ids:[]},ReferencePicker:stub('ReferencePicker')},'./DeliveryBundle':{bundleOrder:item=>item.bundle_order||[],bundleHidden:item=>item.bundle_hidden||[]}};
globalThis.__profileTestModules=new Proxy(modules,{get:(obj,name)=>obj[name]??=new Proxy({default:stub(name.replace('./',''))},{get:(o,key)=>o[key]??=stub(key)})});
const load=async(file)=>{
 let source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 source=source.replace(/import\s+([^;]+?)\s+from\s+(['"])([^'"]+)\2;/g,(_,binding,q,name)=>{
  const ref=`globalThis.__profileTestModules[${JSON.stringify(name)}]`;
  if(binding.includes(', {')){const [name,named]=binding.split(/, (?=\{)/);return `const ${name}=${ref}.default; const ${named.replace(/\s+as\s+/g,':')}=${ref};`;}
  if(binding.startsWith('{'))return `const ${binding.replace(/\s+as\s+/g,':')}=${ref};`;
  return `const ${binding}=${ref}.default;`;
 }).replace(/import\s+['"][^'"]+['"];?/g,'');
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
};
const helper=await load('src/profile-defaults.ts');modules['./profile-defaults']=helper;
const {latestProfileId,resolveProfileId,profileScope,profileChoiceKey,readProfileChoice,writeProfileChoice,profileUnavailable,unavailableProfileOption,taskProfileInitial,flowProfileInitial,useProfileDefault}=helper;
const profiles=[{id:'old',title:'旧 IP',created:'2026-01-01',updated:'2026-04-01'},{id:'new',title:'最新 IP',created:'2026-05-01',updated:'2026-05-01'}];
const state={user:{id:'alice'},workspace:'D:\\alice',complete:true,models:[],bindings:{},objects:profiles};
const scope=profileScope(state),other=profileScope({...state,user:{id:'bob'}}),workspace=profileScope({...state,workspace:'D:\\elsewhere'});
let checks=0;
function check(label,fn){fn();checks++;console.log('PASS:',label)}
check('latest created/configured, stable ties, archived filtering, immutable list',()=>{
 assert.equal(latestProfileId(profiles),'new');assert.equal(latestProfileId([...profiles,{...profiles[0],id:'configured',updated:'2026-06-01'}]),'configured');
 assert.equal(latestProfileId([{id:'bad',updated:'invalid'},...profiles,{id:'archived',updated:'2027-01-01',archived:true}]),'new');
 assert.equal(latestProfileId([{id:'a',updated:'2026-01-01'},{id:'b',updated:'2026-01-01'}]),'a');assert.equal(profiles[0].id,'old');assert.equal(latestProfileId([]),'');
});
check('undefined defaults; explicit empty/nonempty/history/deleted are preserved',()=>{
 assert.equal(resolveProfileId(profiles,undefined),'new');assert.equal(resolveProfileId(profiles,''),'');assert.equal(resolveProfileId(profiles,'old'),'old');assert.equal(resolveProfileId(profiles,'deleted'),'deleted');
 assert.equal(resolveProfileId(profiles,undefined,false),'');assert.equal(resolveProfileId([],undefined),'');assert.equal(profileUnavailable([], 'new',false),false);assert.equal(profileUnavailable(profiles,'deleted'),true);assert.equal(unavailableProfileOption(profiles,'deleted')[0].value,'deleted');
});
check('storage preserves generic on restart and separates account/workspace/context',()=>{
 const key=profileChoiceKey(scope,'test');writeProfileChoice(key,'');assert.equal(readProfileChoice(key),'');
 assert.equal(readProfileChoice(profileChoiceKey(other,'test')),undefined);assert.equal(readProfileChoice(profileChoiceKey(workspace,'test')),undefined);assert.equal(readProfileChoice(profileChoiceKey(scope,'other')),undefined);
 values.set(key,'{broken');assert.equal(readProfileChoice(key),undefined);values.set(key,'{"value":null}');assert.equal(readProfileChoice(key),undefined);
});
check('task/flow history detection and legacy composer compatibility',()=>{
 assert.equal(taskProfileInitial({profile_id:'old'},{profile:''},scope),'old');assert.equal(taskProfileInitial({profile_id:''},{profile:''},scope),undefined);assert.equal(taskProfileInitial({profile_id:'old'},{profile:'new',profile_scope:other},scope),'old');
 assert.equal(taskProfileInitial({identity_skipped:true}),'');assert.equal(taskProfileInitial({messages:[{}]}),undefined);assert.equal(taskProfileInitial({profile_id:''}),undefined);
 assert.equal(flowProfileInitial({version:0}),undefined);assert.equal(flowProfileInitial({id:'flow',version:1,profile_id:''}),undefined);assert.equal(flowProfileInitial({brief:'历史想法'}),undefined);assert.equal(flowProfileInitial({version:0},''),'');assert.equal(flowProfileInitial({identity_skipped:true}),'');assert.equal(flowProfileInitial({profile_id:'old'}),'old');
});
class Render {
 constructor(fn,props){this.fn=fn;this.props=props;this.slots=[];this.effects=[];this.tree=null;this.dirty=true}
 draw(props=this.props){this.props=props;this.cursor=0;this.dirty=false;renderer=this;this.tree=this.fn(props);renderer=null;for(const effect of this.effects.splice(0))effect();return this.tree}
 async settle(){for(let n=0;n<12;n++){await Promise.resolve();await Promise.resolve();if(this.dirty)this.draw()}return this.tree}
 close(){for(const slot of this.slots)slot?.cleanup?.()}
}
const all=(tree)=>tree==null?[]:Array.isArray(tree)?tree.flatMap(all):typeof tree==='object'?[tree,...all(tree.props?.children)]:[];
const named=(tree,label)=>all(tree).find(node=>node.type?.label===label);
const identity=tree=>all(tree).find(node=>node.type?.label==='ChoiceMenu'&&node.props.label==='运营身份');
const select=tree=>all(tree).find(node=>node.type==='select'&&all(node.props.children).some(n=>n.type==='option'&&n.props.children==='先不指定'));
const context=(task,items=profiles,s=state)=>({state:s,task,list:kind=>kind==='profile'?items:[],opts:()=>items.map(p=>({value:p.id,label:p.title})),get:()=>undefined,refresh:async()=>{},refreshItems:async()=>{},setError:error=>{throw Error(error)}});
check('selector waits for async list, keeps explicit empty, never leaks on scope change',()=>{
 const r=new Render(p=>useProfileDefault(p.profiles,p.scope,'selector',p.initial,p.ready),{profiles:[],scope,ready:false});
 assert.equal(r.draw()[0],'');assert.equal(r.draw({profiles,scope,ready:true})[0],'new');r.tree[1]('');assert.equal(r.draw()[0],'');
 assert.equal(r.draw({profiles:[{id:'bob'}],scope:other,ready:true})[0],'bob');assert.equal(r.draw({profiles,scope:workspace,ready:true})[0],'new');assert.equal(r.draw({profiles,scope,ready:true})[0],'');r.close();
 const reopened=new Render(()=>useProfileDefault(profiles,scope,'selector'),{});assert.equal(reopened.draw()[0],'');reopened.close();
});
const TaskWorkspace=(await load('src/TaskWorkspace.tsx')).default;
const task={id:'task-default',kind:'task',title:'写一篇文章',profile_id:'',messages:[]};
let r=new Render(TaskWorkspace,context(task));r.draw();
check('TaskWorkspace actually selects latest IP for a new task',()=>assert.equal(identity(r.tree).props.value,'new'));
identity(r.tree).props.onChange('old');r.draw();
check('TaskWorkspace nonempty choice survives a newer configuration',()=>{
 r.draw(context(task,[...profiles,{id:'newest',updated:'2026-08-01'}]));assert.equal(identity(r.tree).props.value,'old');
});
identity(r.tree).props.onChange('');r.draw();r.close();
r=new Render(TaskWorkspace,context(task));r.draw();
check('TaskWorkspace generic survives unmount/restart',()=>assert.equal(identity(r.tree).props.value,''));
handler=async()=>({});requests=[];
await all(r.tree).find(n=>n.type==='button'&&n.props['aria-label']==='发送要求').props.onClick();await r.settle();
check('TaskWorkspace explicit generic sends empty profile plus skip_profile',()=>{const sent=requests.find(req=>req.path==='/tasks/task-default/send');assert.equal(sent.body.profile_id,'');assert.equal(sent.body.skip_profile,true)});r.close();
r=new Render(TaskWorkspace,context({...task,id:'historical',profile_id:'old',messages:[{role:'user',text:'历史'}]}));r.draw();
check('TaskWorkspace keeps historical identity and displays deleted identity',()=>{
 assert.equal(identity(r.tree).props.value,'old');r.draw(context({...task,id:'historical',profile_id:'old',messages:[{}]},[]));assert.equal(identity(r.tree).props.value,'old');assert(identity(r.tree).props.options.some(p=>p.value==='old'&&p.label.includes('不可用')));
});r.close();
r=new Render(TaskWorkspace,context({...task,id:'skip',profile_id:'old',identity_required:true}));r.draw();requests=[];
await all(r.tree).find(n=>n.type==='button'&&n.props.children==='跳过定位，通用创作').props.onClick();await r.settle();
check('skip-identity button clears profile before request and persists generic',()=>{assert.equal(requests.at(-1).body.profile_id,'');assert.equal(requests.at(-1).body.skip_profile,true);assert.equal(identity(r.tree).props.value,'')});r.close();
r=new Render(TaskWorkspace,context({...task,id:'async-task'},[],{...state,complete:false}));r.draw();
check('TaskWorkspace async loading does not cache an inferred empty choice',()=>assert(!values.has('assistant-composer:alice:async-task')));
r.draw(context({...task,id:'async-task'}));check('TaskWorkspace selects newest after async profile list completes',()=>assert.equal(identity(r.tree).props.value,'new'));r.close();
values.set('assistant-composer:alice:legacy-task',JSON.stringify({profile:'',text:'旧稿要求'}));
r=new Render(TaskWorkspace,context({...task,id:'legacy-task',messages:[{role:'user',text:'已有对话'}]}));r.draw();
check('TaskWorkspace unmarked old empty composer/history defaults to latest',()=>assert.equal(identity(r.tree).props.value,'new'));r.close();
r=new Render(TaskWorkspace,context({...task,id:'marked-skip-task',identity_skipped:true}));r.draw();
check('TaskWorkspace explicit identity_skipped remains generic',()=>assert.equal(identity(r.tree).props.value,''));r.close();
const CreationFlow=(await load('src/CreationFlow.tsx')).default;
let serverFlow={version:0};
handler=async(path,body)=>path.startsWith('/studio/flow?')||path==='/studio/flow'?body?{...body,id:'saved',version:1}:serverFlow:{items:[],tools:[]};
r=new Render(CreationFlow,{t:context(null),route:'flow?work=fresh'});r.draw();await r.settle();
check('CreationFlow new blank flow receives latest IP after restore',()=>assert.equal(select(r.tree).props.value,'new'));
select(r.tree).props.onChange({target:{value:''}});r.draw();r.close();
r=new Render(CreationFlow,{t:context(null),route:'flow?work=fresh'});r.draw();await r.settle();
check('CreationFlow explicit blank survives reopening with a server-empty flow',()=>assert.equal(select(r.tree).props.value,''));r.close();
serverFlow={id:'old-flow',version:3,brief:'旧主题',profile_id:'old'};
r=new Render(CreationFlow,{t:context(null),route:'flow?work=old-flow'});r.draw();await r.settle();
check('CreationFlow restored nonempty historical profile stays unchanged',()=>assert.equal(select(r.tree).props.value,'old'));r.close();
serverFlow={id:'blank-flow',version:1,profile_id:''};
r=new Render(CreationFlow,{t:context(null),route:'flow?work=blank-flow'});r.draw();await r.settle();
check('CreationFlow unmarked saved blank history defaults to latest IP',()=>assert.equal(select(r.tree).props.value,'new'));r.close();
serverFlow={version:0};
r=new Render(CreationFlow,{t:context(null,[],{...state,complete:false}),route:'flow?work=async-flow'});r.draw();await r.settle();
check('CreationFlow waits for full list before defaulting',()=>assert.equal(select(r.tree).props.value,''));
r.draw({t:context(null),route:'flow?work=async-flow'});await r.settle();check('CreationFlow async list then selects latest',()=>assert.equal(select(r.tree).props.value,'new'));r.close();
serverFlow={id:'newly-created-empty',version:1,brief:'',profile_id:''};
r=new Render(CreationFlow,{t:context(null),route:'flow?work=newly-created-empty'});r.draw();await r.settle();
check('CreationFlow API-new empty id/version1 still defaults to latest',()=>assert.equal(select(r.tree).props.value,'new'));r.close();
serverFlow={id:'marked-empty',version:5,brief:'已有草稿',profile_id:''};writeProfileChoice(profileChoiceKey(scope,'flow:marked-empty'),'');
r=new Render(CreationFlow,{t:context(null),route:'flow?work=marked-empty'});r.draw();await r.settle();
check('CreationFlow marked v5 empty remains generic',()=>assert.equal(select(r.tree).props.value,''));r.close();
serverFlow={id:'origin-skip',version:5,profile_id:'',identity_skipped:true};
r=new Render(CreationFlow,{t:context(null),route:'flow?work=origin-skip'});r.draw();await r.settle();
check('CreationFlow origin identity_skipped remains generic',()=>assert.equal(select(r.tree).props.value,''));r.close();
const TopicDelivery=(await load('src/TopicDelivery.tsx')).default;
handler=async(path,body)=>path==='/studio/topics'&&body?{...body,id:'new-topic',version:1}:path==='/studio/topics/generate'?{id:'job',status:'queued',input:{action:'studio_topics'}}:{items:[]};
r=new Render(TopicDelivery,{t:context(null),page:'topics'});r.draw();await r.settle();named(r.tree,'TopicLibraryControls').props.onAddTopic();r.draw();
check('TopicDelivery drawer defaults to latest IP',()=>assert.equal(named(r.tree,'TopicAddDrawer').props.profileId,'new'));
named(r.tree,'TopicAddDrawer').props.setTitle('测试选题');r.draw();requests=[];named(r.tree,'TopicAddDrawer').props.add();await r.settle();
check('TopicDelivery manual topic includes chosen IP in real submit handler',()=>assert.equal(requests.find(q=>q.path==='/studio/topics'&&q.body).body.profile_id,'new'));r.close();
r=new Render(TopicDelivery,{t:context(null),page:'topics'});r.draw();await r.settle();named(r.tree,'TopicLibraryControls').props.onAddTopic();r.draw();named(r.tree,'TopicAddDrawer').props.onProfileChange('');r.draw();r.close();
r=new Render(TopicDelivery,{t:context(null),page:'topics'});r.draw();await r.settle();named(r.tree,'TopicLibraryControls').props.onAddTopic();r.draw();
check('TopicDelivery generic choice survives restart',()=>assert.equal(named(r.tree,'TopicAddDrawer').props.profileId,''));
named(r.tree,'TopicAddDrawer').props.setBrief('测试方向');r.draw();requests=[];named(r.tree,'TopicAddDrawer').props.generate();await r.settle();
check('TopicDelivery AI suggestions pass explicit generic through existing contract',()=>assert.equal(requests.find(q=>q.path==='/studio/topics/generate').body.profile_id,''));r.close();
for(const [id,origin,marker,wanted] of [
 ['implicit-origin',{profile_id:'',version:5},undefined,'new'],
 ['marked-origin',{profile_id:'',version:5},'',''],
 ['skipped-topic-origin',{profile_id:'',identity_skipped:true},undefined,''],
 ['nonempty-origin',{profile_id:'old'},undefined,'old'],
]){
 if(marker!==undefined)writeProfileChoice(profileChoiceKey(scope,'flow:'+id),marker);
 handler=async path=>path.startsWith('/studio/flow?')?{...origin,id}:{items:[]};
 r=new Render(TopicDelivery,{t:context(null),page:'topics?return='+encodeURIComponent('studio/flow?work='+id+'&step=1')});r.draw();await r.settle();named(r.tree,'TopicLibraryControls').props.onAddTopic();r.draw();
 check('TopicDelivery inherits origin policy: '+id,()=>assert.equal(named(r.tree,'TopicAddDrawer').props.profileId,wanted));r.close();
}
const KnowledgeAssistant=(await load('src/KnowledgeAssistant.tsx')).default;
const starts=[];
const homeContext={...context(null),state:{...state,bindings:{qa:'test'},models:[{id:'test',capability:'text',published:true}]},profile:'new',profileSkipped:false,openTask:async(...args)=>{starts.push(args);return {id:'home-task',messages:[]}}};
r=new Render(KnowledgeAssistant,{t:homeContext});r.draw();all(r.tree).find(n=>n.type==='textarea').props.onChange({target:{value:'测试问题'}});r.draw();requests=[];
all(r.tree).find(n=>n.type==='button'&&n.props.className==='ka-submit').props.onClick();await r.settle();
check('KnowledgeAssistant routes default IP through the shared task entry',()=>assert.equal(starts.at(-1)[3],'new'));r.close();
r=new Render(KnowledgeAssistant,{t:{...homeContext,profile:'',profileSkipped:true}});r.draw();all(r.tree).find(n=>n.type==='textarea').props.onChange({target:{value:'通用创作'}});r.draw();requests=[];
all(r.tree).find(n=>n.type==='button'&&n.props.className==='ka-submit').props.onClick();await r.settle();
check('KnowledgeAssistant carries deliberate generic flag on first send',()=>{assert.equal(starts.at(-1)[3],'');assert.equal(requests.at(-1).body.skip_profile,true)});r.close();
const forbidden=['src/WechatArticleForm.tsx','src/ArticleImagePicker.tsx'];
check('forms without identity selectors do not acquire a new selection/default rewrite',()=>forbidden.forEach(file=>assert(!fs.readFileSync(file,'utf8').includes('./profile-defaults'))));
console.log(`PASS: ${checks} isolated profile/default/component checks; zero network/provider calls`);
