"""The twelve approved IP questions; deterministic interview order, AI report only."""
import re
import unicodedata

VERSION = 'ip-positioning-12-v1'
QUESTIONS = [
    ('customers', '你的电梯主要卖给谁？别墅 / 自建房业主、旧楼加装整栋业主、厂房物流园、开发商、装修公司渠道——各自大概占比多少？', '参考：别墅 / 自建房约六成，旧楼加装约三成，装修渠道约一成。写你的实际情况，不清楚可填“不知道”。', '主要卖给谁', '销售台账或负责客户的同事'),
    ('sales', '一年签多少台？客单价什么区间？', '参考：去年签了多少台，通常每单多少钱；没有统计就写“不知道”。报价区间是否允许公开，也请说明。', '一年签几台，客单价多少', '销售或财务台账负责人'),
    ('region', '你在哪个城市，能覆盖多大范围？（决定内容要不要埋地域词）', '参考：所在城市、主要服务的区县、最远能服务到哪里。一个区做透，也可以成为优势。', '城市和覆盖范围', '销售或服务区域负责人'),
    ('advantages', '你手上有别人没有的东西是什么？安装队、维保资质、厂家一手价、本地关系、老客户存量、某一类场景做得特别多——挑最实在的写。', '参考：有自己的安装队、做过较多别墅项目、已有老客户。资质和价格优势只写能提供依据的事实。', '别人没有的东西', '安装、维保或资质管理负责人'),
    ('questions', '客户最常问你的 5 个问题，用他们的原话写。', '参考：“这梯多少钱？”“后期谁来保养？”“停电怎么办？”写你真实听到的问题，不够五条也可以。', '客户最常问的 5 个问题', '一线销售或客户沟通记录'),
    ('lost_deals', '客户最后没签单，最常见的 3 个原因是什么？', '参考：担心售后、预算不合适、家人意见不同。写真实丢单原因，不够三条可以说明。', '没签单的 3 个原因', '丢单复盘记录或销售同事'),
    ('competitors', '同行在短视频里都在发什么？你觉得最假、最烦的是哪一种？', '参考：只报最低价、夸大承诺、只讲参数。写你看过的内容和不认同的具体做法。', '同行都在发什么，你最烦哪种', '你关注的同行账号'),
    ('appearance', '你愿意出镜吗？愿意露脸、露工地、露报价单吗？分别到什么程度？', '参考：愿意露脸讲解；工地需客户允许；报价单只能遮盖客户信息后展示。不露脸也可以如实写。', '愿意出镜到什么程度', '本人、客户及公司授权负责人'),
    ('time', '一周能稳定拿出多少时间拍和剪？能出几条？', '参考：每周两小时、能做两条。按能长期坚持的时间填写，不必追求每天更新。', '一周能投入多少时间', '本人或协助拍摄剪辑的同事'),
    ('goal', '这个账号你最终要什么？私信线索、门店到访、招商、还是个人接单？', '从私信线索 / 门店到访 / 招商 / 个人接单中选一个主要目标；有次要目标可另外注明。', '账号最终要什么', '本人或业务负责人'),
    ('materials', '手上现成的素材有什么？工地视频、验收单、客户回访、故障现场、安装过程、报价单。', '参考：已有安装过程视频、展厅照片、已获授权的回访。没有现成素材就写“暂无”，先用手上的。', '现成素材有什么', '素材保管人及客户授权负责人'),
    ('boundaries', '有没有绝对不能碰的？比如不能露品牌名、不能露价格、公司不允许。', '参考：不能公开价格、不能露客户姓名住址、品牌名需审批。没有确认的规定写“待确认”，不要默认已获授权。', '不能碰的线', '公司、品牌或客户授权负责人'),
]
REPORT_SECTIONS = ['一、一句话定位', '二、客户决策链', '三、三个内容支柱', '四、人设三件套', '五、不该发的内容', '六、平台与节奏', '七、变现漏斗', '八、30 天冷启动表']
REPORT_RULES = '''按以下八段输出完整定位策划报告，不跳段、不合并，body 使用 Markdown，段落标题必须逐字使用：
一、一句话定位：用“我是【谁】，专帮【哪类人】解决【什么具体问题】，凭【什么证据】”给出3个版本，每版注明适用平台、吸引谁、指向的变现方式。
二、客户决策链：拆成掏钱的、反对的、使用的三种角色，写各自最怕什么，指出要说服谁、谁不必作为说服重点。
三、三个内容支柱：必须有“报价与避坑”和“现场实拍”。每根给支柱名、解决哪种心理、10条具体选题；每条包含20字以内标题、前3秒画面、拍摄地点、信任/线索/转发目的、评论区可能有争议的一句话。选题要能在真实工地、展厅或获授权客户家中拍摄。
四、人设三件套：15秒自我介绍口播（只用有依据的事实和数字）、可信度证据清单（现有/缺少/补充方法）、针对电梯销售的三条说话禁忌。
五、不该发的内容：6条具体红线及原因，合规、信任、平台风险各至少一条；不得把推测的限流机制说成平台事实。
六、平台与节奏：只选一个主平台并说明理由，建议发布频率、单条时长、封面统一规则、3个账号名、1版简介。
七、变现漏斗：刷到至签单共5步，每步给客户疑问、对应内容、下一步引导及一句私信话术。
八、30 天冷启动表：按周列拍什么、发几条、每条目标、收集的反馈、建议验收指标（必须明确是计划目标而非实际效果承诺）。
所有内容贴合本次回答；建议和既有事实分开。未知标【待确认】并说明向谁核实。不编造报价、资质、业绩、客户、授权和安装能力。
报价只能引用用户提供且明确允许公开的数字区间；未提供或未允许公开时，标【待确认：向销售/财务及授权负责人核实】，不得为了满足报告格式补造数字。用户的边界优先于宣传建议。
禁止“打造专业形象”“赋能”“闭环”“深度种草”“链接用户”等空话。不要扮演拥有真实从业年限或操盘业绩的人。
'''


def schema():
    return {'version': VERSION, 'questions': [dict(key=k, question=q, reference=r, label=l) for k, q, r, l, _ in QUESTIONS], 'report_sections': REPORT_SECTIONS}


def answers_from(value, complete=False):
    if not isinstance(value, dict):
        raise ValueError('请填写十二题问卷')
    result = {}
    for key, *_ in QUESTIONS:
        answer = value.get(key, '')
        if not isinstance(answer, str) or len(answer) > 4000:
            raise ValueError('每题请填写不超过4000字的文字')
        result[key] = answer.strip()
    if complete and any(not any(unicodedata.category(c)[0] in 'LN' for c in answer) for answer in result.values()):
        raise ValueError('请回答全部十二题；暂不清楚的题目可填“不知道”')
    return result


def question_message(index):
    _, question, reference, _, _ = QUESTIONS[index]
    return f'第 {index + 1} / 12 题\n{question}\n\n{reference}'


def correction_intent(answer):
    target = r'(?:上一题|上题|前一题|第[一二三四五六七八九十十二\d]+题)'
    return bool(re.match(r'^(?:(?:我想|我要|帮我|请|我|想|要|先)[，,\s]*)*(?:'
                        r'(?:更正|纠正|修改|修正|改一下|改下|重新回答).{0,12}' + target + r'|'
                        + target + r'.{0,12}(?:说错|答错|填错|写错|不对|有误|不是|改|更正|纠正))', answer))


def interview_messages(answers, index):
    messages = []
    for number in range(index):
        messages.extend([{'role':'assistant','content':question_message(number)},
                         {'role':'user','content':answers[QUESTIONS[number][0]]}])
    messages.append({'role':'assistant','content':question_message(index) if index < 12 else
                     '十二题已完成。接下来生成完整的八段定位策划报告；不知道的内容会标为【待确认】，核对后再确认建立 IP。'})
    return messages


def validate_report(body):
    if not isinstance(body, str) or not body.strip() or len(body) > 30000:
        raise ValueError('定位报告为空或过长，请重新整理')
    headings = list(re.finditer(r'^\s*(?:#{1,4}\s*)?([一二三四五六七八]、[^\n]+)\s*$', body, re.M))
    if [m.group(1).strip() for m in headings] != REPORT_SECTIONS:
        raise ValueError('定位报告未完整包含约定的八段，请重新整理；十二题回答已保留')
    for index, match in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < len(headings) else len(body)
        if not body[match.end():end].strip():
            raise ValueError('定位报告存在空段，请重新整理；十二题回答已保留')
    return body.strip()


def answer_context(answers):
    return [{'问题': q, '回答': answers[k], '未知时向谁核实': who} for k, q, _, _, who in QUESTIONS]


def require_known_answer(answers):
    """Unknown answers are valid, but an entirely unanswered identity is not complete."""
    for answer in answers.values():
        compact = ''.join(c for c in answer if unicodedata.category(c)[0] in 'LN').lower()
        if compact and not re.fullmatch(r'(?:不知道|不清楚|待确认|待补充|暂不清楚|尚不清楚|未知|暂无|未填写|不确定|暂时不知道|暂不知道|暂时不清楚|未确认|未提供|不详|unknown|tbd|na)+', compact):
            return
    raise ValueError('十二题目前都没有实际信息；请至少补充一题实际情况后确认，也可以先保存草稿')


def profile_snapshot(profile, fields=None):
    """Allowlisted creation input: confirmed answers, never pending edits or metadata."""
    if not profile or profile.get('archived'):
        return None
    fields = fields if fields is not None else ('id','version','title','position','audience','style','views','channels','agency_brands','brand_id','body')
    snapshot = {key: profile.get(key) for key in fields}
    if profile.get('status') != 'accepted' or profile.get('questionnaire_version') != VERSION:
        return snapshot
    try:
        answers = answers_from(profile.get('questionnaire_answers'), complete=True)
        require_known_answer(answers)
    except ValueError:
        # Legacy archives remain usable; malformed/unconfirmed answers are not facts.
        return snapshot
    markers = profile.get('questionnaire_mapped_fields')
    custom = [key for key in ('position','audience','style','views')
              if isinstance(markers,dict) and key in markers and markers[key] is None]
    snapshot['questionnaire'] = {
        'version': VERSION, 'profile_id': profile['id'], 'profile_version': profile['version'],
        'answers': answers, 'questions': {key: question for key, question, *_ in QUESTIONS},
        'independent_fields': custom,
        'usage': '十二题是本次已确认的原始回答，包含投入时间、目标、现有素材与不可触碰的边界。'
                 '自动摘要或旧报告与回答冲突时，以回答为依据，不把旧摘要当作新事实。'
                 '独立修改字段保留用户表达要求；如与原始事实矛盾，标待确认，不自行选取或拼接事实。'
                 '不知道和待确认不等于已获授权；未允许公开的报价、资质和客户资料不得编造或公开。'
    }
    return snapshot


def topic_candidates(value):
    if not isinstance(value,list) or not 1 <= len(value) <= 30:
        raise ValueError('报告缺少30天计划的结构化选题候选，请重新整理；回答已保留')
    result=[];seen=set()
    for item in value:
        if not isinstance(item,dict) or set(item)-{'title','angle'}:
            raise ValueError('选题候选格式不完整，请重新整理')
        title=item.get('title');angle=item.get('angle')
        if not isinstance(title,str) or not 0<len(title.strip())<=200 or not isinstance(angle,str) or not 0<len(angle.strip())<=3000:
            raise ValueError('选题候选缺少标题或创作角度，请重新整理')
        pair=(title.strip(),angle.strip())
        if pair not in seen:result.append(dict(title=pair[0],angle=pair[1]));seen.add(pair)
    return result


def _mapped_values(answers):
    return {'audience': answers.get('customers', ''), 'views': answers.get('questions', ''),
            'position': '服务范围：' + answers['region'] if answers.get('region') else '',
            'style': '出镜方式：' + answers['appearance'] if answers.get('appearance') else ''}


def manual_fields(answers, old, explicit=None):
    """Refresh only unchanged questionnaire mappings; explicit archive edits win."""
    explicit = explicit or {}
    markers = old.get('questionnaire_mapped_fields')
    if not isinstance(markers, dict):
        # Compatibility with manual questionnaires saved before provenance tracking.
        # AI reports and legacy archives have independently authored summaries.
        markers = (_mapped_values(old['questionnaire_answers'])
                   if old.get('questionnaire_version') == VERSION
                   and isinstance(old.get('questionnaire_answers'), dict)
                   and not old.get('interview_id') else {})
    fields = {}; provenance = {}
    for field, value in _mapped_values(answers).items():
        current = old.get(field, '')
        automatic = (field in markers and markers[field] is not None and current == markers[field])
        if field in explicit:
            fields[field] = explicit[field]; provenance[field] = None
        elif automatic or (field not in markers and not current):
            fields[field] = value; provenance[field] = value
        else:
            fields[field] = current; provenance[field] = None
    return {**fields, 'questionnaire_mapped_fields': provenance}
