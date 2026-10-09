"""Reviewed, local text-only writing methods. No upstream tools are executed."""
import json
import re
from . import store as s

WRITING_CONTRACT = '''本次平台、内容形式、创作要求、目标字数、已选 IP 与资料由请求数据决定。用户明确要求优先于方法里的默认篇幅和结构；不要让某一平台的方法污染其他平台。
文风、叙事、标题和封面方法以管理员维护的任务方法、启用 Skills 与用户明确要求为依据，程序不重新插入已停用或删除的 Skill。
字数以中文正文字符数为参考，不把标题、摘要、封面说明和 Markdown 标记凑进正文。约定字数应尽量接近；“以内”“不超过”是上限，不能靠多加故事或重复句子超出。保留用户人工修改和必要图片链接，不用硬截断破坏句子。
写作方法改善内容质量，不能保证爆款、播放量或转化率。最终稿不含系统方法全文、内部资料 ID、机器编号、写作分析和自检报告；来源信息保留在参考记录中。'''

FORM_PLATFORMS = {'公众号文章':'wechat','小红书文案':'xiaohongshu','口播脚本':'channels','视频脚本':'channels','朋友圈文案':'moments'}
WRITING_PLATFORMS = {'wechat':'公众号文章','xiaohongshu':'小红书文案','channels':'视频号／口播脚本','douyin':'抖音脚本','moments':'朋友圈文案','general':'通用文案'}
SKILL_PLATFORMS = {'skill:writing':['wechat'], 'skill:wechat-narrative':['wechat'],
                   'skill:wechat-title-cover':['wechat'], 'skill:wechat-editor':['wechat'],
                   'skill:xiaohongshu-writing':['xiaohongshu'], 'skill:short-video-script':['channels','douyin']}

def word_requirement(brief, fallback=None):
    """Only explicit writing length is a number; keep free-form intent in the brief."""
    pattern=r'(?P<before>不超过|最多|少于)?\s*(?P<count>\d{3,5})\s*(?:个)?字(?P<after>以内|以下|左右)?'
    # In "把500字压到300字", 500 describes the old draft, 300 is the target.
    revised=re.search(r'(?:改成|缩短到|缩至|压到|压缩到|控制在|扩写到|写成)\s*'+pattern,brief)
    match=revised or re.search(pattern,brief)
    if match and 100<=int(match['count'])<=10000:
        return int(match['count']), 'maximum' if match['before'] or match['after'] in ('以内','以下') else 'approximate'
    return fallback, 'approximate' if fallback is not None else 'unspecified'

def writing_request(method, *, policy, brief, format_name, target_words=None, context=None,
                    original=None, output_rules='', payload=None, platform=None):
    """Shared transport and trace for conversation and form writing; no model calls."""
    from .capabilities import for_platform
    selected_platform=platform or FORM_PLATFORMS.get(format_name,'general')
    method=for_platform(method,selected_platform)
    inferred,mode=word_requirement(brief,target_words)
    # A structured form control is authoritative over a number elsewhere in its brief.
    if target_words is not None and target_words!=inferred:mode='approximate'
    words=target_words if target_words is not None else inferred
    data=dict(payload or {})
    data.update({'要求':brief,'内容形式':format_name,'目标字数':words,'字数约束':mode,
                 '已选上下文':context,'原稿':original})
    system=policy+'\n'+method['text']+('\n'+output_rules if output_rules else '')
    user=json.dumps(data,ensure_ascii=False)
    trace={'configuration':method['metadata'],'format':format_name,
           'platform':selected_platform,
           'target_words':words,'word_constraint':mode,'contract_version':1,
           'system_hash':s.digest(system),'input_hash':s.digest(user),'at':s.now()}
    return {'messages':[{'role':'system','content':system},{'role':'user','content':user}],
            'snapshot':trace,'payload':data}

ARTICLE_METHOD = '''公众号创作方法（电梯行业适配）：
先确定读者、他正在遇到的具体问题和本文能提供的收获，再从选题或灵感中选择一个切入角度。
标题提供真实利益点、具体疑问或有依据的认知差异，包含自然的电梯行业关键词；不靠虚构事故、价格和焦虑吸引点击。
开头三句话让读者知道为什么值得读，正文围绕一个主问题展开，提供有依据的解释、例子或可执行判断。
每段通常1至3句，长短句自然交替，适度小标题，不把所有文章写成同一套三段式。不机械地每句话换行，不通篇加粗。
从本人旧文和已确认身份提取声线；没有样本时用通俗、具体的行业表达，不编造第一人称客户经历。
写完复核：标题与正文一致、来源支持具体事实、推断与事实区分、关键词自然、结尾给读者有用的下一步。
去AI味：删除宏大开场、机械排比、首先其次最后、空洞升华、伪金句和聊天包装；保留全部事实、数字、日期、作者立场和图片链接。
只把真实来源名称留给读者。内部资料ID和质检说明放到参考信息中，不放进发布正文。缺少资料时可写常青问题，不能伪装实时新闻。
原开源指南的金融主题、固定免责声明、强制第一人称、口头禅和统一互动结尾不适用于所有电梯文章，不照搬。
本方法改善可读性和传播动机，不保证阅读量、搜索排名或爆款。
'''

NARRATIVE_METHOD = '''公众号真人叙事编辑（仅用于公众号文章；用户明确要求清单、说明书或其他平台时按其要求）：
先在心里完成读者画像、核心矛盾、标题候选、开头、情绪走向与结尾，再输出最终稿。写作规划不混进发布正文。
默认选择叙事解释或有判断的行业随笔，不把一篇文章写成零部件目录、六个编号小标题或每段一样长的知识卡片。
开头用读者能认出来的具体动作、疑问或有依据的反差进入。例如把“每天都坐电梯，却很难说清门后是什么”变成一个想看下去的问题。
有真实经历资料时沿着事件经过、当时的犹豫、关键变化、后来理解了什么推进；没有真实案例时用“想象一下”“比如”明确标识的日常场景，绝不能冒充作者经历。
不编造第一人称客户经历、人名、对话原话、时间、价格、事故、统计或成功故事。允许自然的态度、好奇、意外和共情；禁止无依据煽动恐惧。
正文围绕一条阅读主线，把知识融入场景和解释，用自然过渡连接。短文默认以连续段落为主，通常0至2个有信息量的小标题；篇幅需要时增加，但不要机械逐项编号。
在事实不变的前提下保留作者的判断、迟疑、反问与口语节奏；少用“其实”“本质上”“值得注意”，不强塞流行口头禅。
情绪来自具体处境和取舍，不能靠叹号、煽动句、连续排比和强行升华。每段给读者一条新信息或推进一个认识。
结尾回扣开头的疑问，给出可用的判断或留下与本文有关的下一层问题；可自然邀请读者谈经历，不写套路“点赞收藏关注”，不许诺尚未安排的下一期。
交稿前像真人编辑一样通读：删除教科书目录感、格式化转折、虚构场景和万能总结；保留用户人工修改、全部必要事实及图片链接。用户指定字数优先，不能靠多加故事把篇幅写长。
以上是传播写作方法，不承诺成为爆款。
'''

TITLE_COVER_METHOD = '''公众号标题与封面编辑（仅用于公众号成品）：
在内部比较至少3种标题方向：读者自己的问题、具体收益、由事实支撑的认知反差。选择一条既有悬念又能被正文兑现的标题，输出时不附分析。
标题用读者日常会说的词，通常12至26字；不堆“震惊、必看、颠覆、没人告诉你”，不用虚构数字、排名和恐吓。不要为了吸引点击扩大正文结论。
开头在前60至100字建立与读者的关系和未解决的问题；摘要单独说明收获，不机械复制开头。
封面建议必须承接本文唯一核心问题，描述主体、一个视觉隐喻或对照、画面层次、色调与光线、留白、安全区和短标题。封面不是正文所有知识点的密集拼贴。
公众号宽封面优先2.35:1构图，主体与关键文字放在中央安全区，兼顾列表裁切；如用户指定其他比例按用户要求。封面字通常4至12字，留出排版空间，不强行要求模型绘制很多小字。
示意图与真实项目照片区分，不冒充真实建筑、事故现场或品牌授权。既不生成伪徽章也不许诺已生成图片。
'''

def builtin_skills():
    skills=[dict(id='skill:wechat-narrative',kind='skill',purpose='writing',title='公众号场景叙事与情绪节奏',body=NARRATIVE_METHOD,status='published',version=1,history=[],origin='项目审阅适配 · Humanizer / 公众号写作方法研究'),
            dict(id='skill:wechat-title-cover',kind='skill',purpose='writing',title='公众号标题与封面构图',body=TITLE_COVER_METHOD,status='published',version=1,history=[],origin='项目原创适配 · MarketingSkills / baoyu-cover-image方法研究'),
            dict(id='skill:wechat-editor', kind='skill', purpose='writing', title='公众号读者与传播写作',
                 body=ARTICLE_METHOD, status='published', version=1, history=[],
                 origin='yaoleifly/wechat-writing-style (MIT) · 电梯行业审阅适配'),
            dict(id='skill:humanizer', kind='skill', purpose='writing', title='Humanizer 中文去 AI 味',
                 body=('中文嵌入模式：只返回终稿，锁定事实、数字、日期、引文与图片链接。\n' +
                       (s.ROOT/'vendor/writing-skills/humanizer/SKILL.md').read_text(encoding='utf-8')),
                 status='published', version=1, history=[], origin='blader/humanizer (MIT) · 本地文本方法')]
    root=s.ROOT/'vendor/writing-skills/platform-sources'
    for ident,title,filename,origin in [
        ('skill:xiaohongshu-writing','小红书文案与图文阅读节奏','小红书文案中文方法.md','宝玉小红书图文方法／王梦珂小红书运营工作台 · MIT · 中文审阅适配'),
        ('skill:short-video-script','短视频口播与分镜','短视频脚本中文方法.md','开源营销方法库：社交内容与短视频脚本 · MIT · 中文审阅适配')]:
        skills.append(dict(id=ident,kind='skill',purpose='writing',title=title,body=(root/filename).read_text(encoding='utf-8'),
                           status='published',version=2,history=[],origin=origin))
    for item in skills:
        if item['id'] in SKILL_PLATFORMS:item['platforms']=list(SKILL_PLATFORMS[item['id']])
    return skills

INTERNAL_CITATION = re.compile(r'\[(?:资料|来源|系统资料)?\s*[0-9a-f]{32}(?:[0-9a-f]{32})?\](?!\()', re.I)

def publish_body(body):
    """Hide machine-only citations in the delivery, retain source metadata elsewhere."""
    return re.sub(r'\n{3,}', '\n\n', INTERNAL_CITATION.sub('', body)).strip()
