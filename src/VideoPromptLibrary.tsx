import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {ArrowDownToLine, BookmarkPlus, BookOpen, Plus, Search} from 'lucide-react';
import {StudioModal} from './AssetPicker';
import {api} from './api';
import './video-prompt-library.css';

type PromptFields = {title: string; category: string; body: string};
type Prompt = PromptFields & {id: string; version?: number; summary?: string};
type Editor = PromptFields & {id?: string; version?: number};

const endpoint = '/studio/video-prompts';
const presets: Prompt[] = [
 {
  id: 'brand-comparison', category: '选购与品牌', title: '品牌怎么比',
  summary: '用三个具体问题，把品牌选择讲明白。',
  body: '住宅大堂里，一位电梯顾问站在关闭的电梯门旁，面对镜头说：“选电梯，先问三件事。”镜头依次切到两份无标识的配置表、轿厢门口和维保联络卡。旁白：“配置是否适合这栋楼？现场能不能装？以后谁来维护？”最后回到顾问点头收尾。现场光线自然，语气像与业主交谈，画面避开商标和价格。',
 },
 {
  id: 'quotation', category: '选购与品牌', title: '报价单先看哪三项',
  summary: '给正在比价的业主或采购人员一个简单看法。',
  body: '桌面摊开一份无品牌的电梯报价单，顾问用手指从上到下指向三处。口播：“这张单，先分清设备、安装和后续服务。两份报价，要把包含的项目对齐再比。”俯拍跟随手指移动，切到业主在空白便签上画出三栏，收尾定格在整齐的桌面。画面不出现可辨识的金额或客户信息。',
 },
 {
  id: 'cabin-details', category: '产品与体验', title: '跟着镜头看轿厢',
  summary: '从乘客视角展示照明、面板和空间。',
  body: '从大堂平视拍摄，电梯门缓缓打开，镜头沿乘客视线进入轿厢。依次给顶灯的均匀光线、操作面板和扶手一个短特写，最后切到轿厢全景。旁白：“每天都要坐的电梯，照明、按钮位置和扶手这些细节，现场试一次更清楚。”背景保留轻微开门声，金属反光柔和，按钮排布在不同镜头中保持一致。',
 },
 {
  id: 'accessibility', category: '产品与体验', title: '长辈乘梯，先体验这些细节',
  summary: '用一段平视镜头讲清楚乘坐体验。',
  body: '一位长者在家人陪同下走进明亮的住宅电梯，镜头平视跟拍，从轿门口过渡到扶手和操作面板。顾问在画外说：“门口好不好进，按钮能不能看清，扶手顺不顺手，带家里长辈试乘一遍。”最后停在两人轻松交流的中景。动作从容，人物真实自然，保留大堂和脚步环境声。',
 },
 {
  id: 'retrofit-site', category: '加装与改造', title: '老楼加装前，先踏勘哪里',
  summary: '展示现场沟通，比抽象介绍更直观。',
  body: '老小区的住宅入口，工程师与居民代表站在通道一侧，对照楼栋平面图。镜头先交代单元入口与楼前空间，再切到工程师在图上比划通行路线，最后回到两人沟通的中景。口播：“先看看电梯放哪儿、怎么进楼、会不会挡住大家走路。方案要到现场才能谈清楚。”自然日光，生活化纪实风格，图纸隐藏住户信息。',
 },
 {
  id: 'renewal', category: '加装与改造', title: '老电梯改造，先说清楚停梯安排',
  summary: '用居民能理解的方式讲项目沟通。',
  body: '镜头从住宅大堂里的一张空白公告板缓慢移向关闭的电梯门。一名物业人员和工程师在旁边对照计划表，画外音说：“准备改造前，先告诉居民哪天停梯、预计多久、临时怎么走。”切到工作人员把示意图贴上公告板，结尾留出一块干净的画面给后期字幕。场景保持安静有序，不展示真实楼栋和住户信息。',
 },
 {
  id: 'maintenance', category: '维保与乘梯', title: '电梯维保记录怎么沟通',
  summary: '聚焦交接现场，便于配专业口播。',
  body: '在电梯大堂一侧，维保人员把记录表递给物业人员，两人一起核对已完成的项目和待跟进事项。镜头从记录表的手部动作切到两人的对话中景。旁白：“交接时，把今天做了什么、发现了什么、谁来跟进说清楚。”背景里的电梯门保持关闭，人物停在公共区域，纸面不出现可辨识的个人资料。',
 },
 {
  id: 'showroom', category: '门店与项目', title: '到展厅试乘，怎么体验',
  summary: '用自然的邀请介绍真实体验动线。',
  body: '镜头从明亮的电梯展厅入口轻轻推进，顾问在样梯旁招手，引导来访者看轿厢、按面板并体验开关门。画外音：“带上你的户型图，现场看空间、试操作，再聊哪种方案合适。”最后切到咨询桌，两人把图纸铺开开始交流。画面干净明亮，语气热情自然，结尾留出位置给后期添加门店信息。',
 },
];

type Props = {prompt: string; onApply: (prompt: string) => void; onClose: () => void};

export default function VideoPromptLibrary({prompt, onApply, onClose}: Props) {
 const categoriesId = useId();
 const [personal, setPersonal] = useState<Prompt[]>([]);
 const [loading, setLoading] = useState(true);
 const [query, setQuery] = useState('');
 const [scope, setScope] = useState<'all' | 'personal'>('all');
 const [category, setCategory] = useState('');
 const [selectedId, setSelectedId] = useState(presets[0].id);
 const [editor, setEditor] = useState<Editor | null>(null);
 const [confirm, setConfirm] = useState<'replace' | 'remove' | null>(null);
 const [busy, setBusy] = useState(false);
 const [status, setStatus] = useState('');
 const [error, setError] = useState('');
 const [reload, setReload] = useState(0);
 const actionLock = useRef(false);
 const preview = useRef<HTMLElement>(null);

 useEffect(() => {
  let active = true;
  setLoading(true);
  api<{items: Prompt[]}>(endpoint).then(({items}) => {
   if (active) setPersonal(items);
  }).catch((failure: Error) => {
   if (active) setError('读取我的提示词失败。' + failure.message);
  }).finally(() => {
   if (active) setLoading(false);
  });
  return () => {active = false};
 }, [reload]);

 const choices = [...presets, ...personal];
 const categories = [...new Set(choices.map(item => item.category))];
 const available = scope === 'personal' ? personal : choices;
 const visibleCategories = [...new Set(available.map(item => item.category))];
 const keywords = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const filtered = available.filter(item =>
  (!category || item.category === category) && keywords.every(word =>
   [item.title, item.category, item.summary ?? '', item.body].join(' ').toLocaleLowerCase().includes(word),
  ),
 );
 const selected = filtered.find(item => item.id === selectedId) ?? filtered[0];
 useEffect(() => {if (preview.current) preview.current.scrollTop = 0}, [selected?.id]);

 const startEditor = (values: Editor) => {
  setEditor(values);
  setConfirm(null);
  setError('');
  setStatus('');
 };

 const mutate = async (run: () => Promise<void>) => {
  if (actionLock.current) return;
  actionLock.current = true;
  setBusy(true);
  setStatus('');
  setError('');
  try {
   await run();
  } catch (failure) {
   setError((failure as Error).message);
  } finally {
   actionLock.current = false;
   setBusy(false);
  }
 };

 const save = (event: FormEvent) => {
  event.preventDefault();
  if (!editor) return;
  const {id, version, title, category, body} = editor;
  const fields = {title: title.trim(), category: category.trim(), body: body.trim()};
  if (Object.values(fields).some(value => !value)) {
   setError('请填写名称、分类和正文。');
   return;
  }
  void mutate(async () => {
   const item = id
    ? await api<Prompt>(endpoint + '/' + id, {...fields, version}, 'PATCH')
    : await api<Prompt>(endpoint, fields);
   setPersonal(items => [item, ...items.filter(current => current.id !== item.id)]);
   setScope('personal');
   setCategory('');
   setQuery('');
   setSelectedId(item.id);
   setEditor(null);
   setStatus(id ? '已保存修改' : '已保存到我的提示词');
  });
 };

 const remove = (item: Prompt) => void mutate(async () => {
  await api(endpoint + '/' + item.id + '/archive', {version: item.version});
  setPersonal(items => items.filter(current => current.id !== item.id));
  setCategory('');
  setConfirm(null);
  setStatus('已移除提示词');
 });

 const apply = (body: string, replace = false) => {
  const next = !replace && prompt.trim() ? prompt + '\n\n' + body : body;
  if ([...next].length > 10000) {
   setError('写入后会超过草稿的 10000 字限制，请先缩短当前提示词。');
   return;
  }
  onApply(next);
  onClose();
 };

 const close = () => {if (!actionLock.current) onClose()};
 return <StudioModal title="视频提示词库" onClose={close}>
  <div className="video-prompt-library">
   <div className="vpl-toolbar">
    <label className="vpl-search"><Search size={16}/><input type="search" aria-label="搜索提示词" placeholder="搜索名称、分类或正文" value={query} disabled={!!editor || busy} onChange={event => {setQuery(event.target.value);setConfirm(null)}}/></label>
    <div className="vpl-actions">
     <button type="button" disabled={loading || busy || !!editor || !prompt.trim()} onClick={() => startEditor({title: '', category: category || '我的常用', body: prompt})}><BookmarkPlus size={15}/>保存当前提示词</button>
     <button type="button" disabled={loading || busy || !!editor} onClick={() => startEditor({title: '', category: category || '我的常用', body: ''})}><Plus size={15}/>新建提示词</button>
    </div>
   </div>
   {(status || error) && <div className="vpl-notices">
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    {error && !editor && !busy && !loading && <button type="button" onClick={() => {setError('');setReload(value => value + 1)}}>重新读取</button>}
   </div>}
   {editor ? <form className="vpl-editor" onSubmit={save}>
    <div className="vpl-editor-fields">
     <label>提示词名称<input autoFocus value={editor.title} maxLength={80} required disabled={busy} onChange={event => setEditor({...editor, title: event.target.value})}/></label>
     <label>提示词分类<input value={editor.category} list={categoriesId} maxLength={32} required disabled={busy} onChange={event => setEditor({...editor, category: event.target.value})}/></label>
     <datalist id={categoriesId}>{categories.map(name => <option key={name} value={name}/>)}</datalist>
    </div>
    <label>提示词正文<textarea value={editor.body} maxLength={10000} required disabled={busy} onChange={event => setEditor({...editor, body: event.target.value})}/></label>
    <div className="vpl-actions"><button type="button" disabled={busy} onClick={() => {setEditor(null);setError('')}}>取消编辑</button><button className="st-primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存到我的提示词'}</button></div>
   </form> : <>
    <div className="vpl-filters">
     <div className="vpl-scope" role="group" aria-label="提示词来源">
      <button type="button" disabled={busy} aria-pressed={scope === 'all'} onClick={() => {setScope('all');setCategory('');setConfirm(null)}}>全部提示词</button>
      <button type="button" disabled={busy} aria-pressed={scope === 'personal'} onClick={() => {setScope('personal');setCategory('');setConfirm(null)}}>我的提示词</button>
     </div>
     <div className="vpl-categories" role="group" aria-label="按提示词分类筛选">
      {['', ...visibleCategories].map(name => <button type="button" key={name} disabled={busy} aria-pressed={category === name} onClick={() => {setCategory(name);setConfirm(null)}}>{name || '所有分类'}</button>)}
     </div>
    </div>
    <div className="vpl-browser">
     <nav className="vpl-list" aria-label="提示词列表">
      <small>{loading && scope === 'personal' ? '正在读取…' : filtered.length + ' 条提示词'}</small>
      {filtered.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={selected?.id === item.id} onClick={() => {setSelectedId(item.id);setConfirm(null);setStatus('');setError('')}}>
       <strong>{item.title}</strong><small>{item.category}{item.version ? ' · 我的' : ''}</small>
      </button>)}
      {!filtered.length && !loading && <p>{query || category ? '没有匹配的提示词。' : '还没有个人提示词。可新建一条，也可以保存当前输入。'}</p>}
     </nav>
     {selected && <section className="vpl-preview" ref={preview} aria-label="提示词预览">
      <span className="vpl-kicker"><BookOpen size={15}/>{selected.category}<span>{selected.version ? '个人提示词' : '内置提示词'}</span></span>
      <h3>{selected.title}</h3>
      {selected.summary && <p className="vpl-summary">{selected.summary}</p>}
      <p className="vpl-body">{selected.body}</p>
     </section>}
    </div>
    {selected && <div className="vpl-footer">
     {confirm === 'replace' ? <>
      <span>将用「{selected.title}」替换当前输入框的内容。</span>
      <div className="vpl-actions"><button type="button" onClick={() => setConfirm(null)}>取消</button><button className="st-primary" type="button" onClick={() => apply(selected.body, true)}>确认替换</button></div>
     </> : confirm === 'remove' ? <>
      <span>从我的提示词移除「{selected.title}」？</span>
      <div className="vpl-actions"><button type="button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button type="button" className="vpl-danger" disabled={busy} onClick={() => remove(selected)}>{busy ? '正在移除…' : '确认移除'}</button></div>
     </> : <>
      <div className="vpl-actions">
       {selected.version && <><button type="button" onClick={() => startEditor(selected)}>编辑</button><button type="button" onClick={() => setConfirm('remove')}>移除</button></>}
      </div>
      <div className="vpl-actions">
       {prompt.trim() && <button type="button" onClick={() => setConfirm('replace')}>替换当前提示词</button>}
       <button className="st-primary" type="button" onClick={() => apply(selected.body)}><ArrowDownToLine size={16}/>{prompt.trim() ? '添加到末尾' : '填入提示词'}</button>
      </div>
     </>}
    </div>}
   </>}
  </div>
 </StudioModal>;
}
