"""Reviewed, local text-only writing methods. No upstream tools are executed."""
import re
from . import store as s

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

def builtin_skills():
    return [dict(id='skill:wechat-editor', kind='skill', purpose='writing', title='公众号读者与传播写作',
                 body=ARTICLE_METHOD, status='published', version=1, history=[],
                 origin='yaoleifly/wechat-writing-style (MIT) · 电梯行业审阅适配'),
            dict(id='skill:humanizer', kind='skill', purpose='writing', title='Humanizer 中文去 AI 味',
                 body=('中文嵌入模式：只返回终稿，锁定事实、数字、日期、引文与图片链接。\n' +
                       (s.ROOT/'vendor/writing-skills/humanizer/SKILL.md').read_text(encoding='utf-8')),
                 status='published', version=1, history=[], origin='blader/humanizer (MIT) · 本地文本方法')]

INTERNAL_CITATION = re.compile(r'\[(?:资料|来源|系统资料)?\s*[0-9a-f]{32}(?:[0-9a-f]{32})?\](?!\()', re.I)

def publish_body(body):
    """Hide machine-only citations in the delivery, retain source metadata elsewhere."""
    return re.sub(r'\n{3,}', '\n\n', INTERNAL_CITATION.sub('', body)).strip()
