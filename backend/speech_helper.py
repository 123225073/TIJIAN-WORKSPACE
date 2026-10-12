"""Deterministic speech extraction. Formatting cleanup is never a rewrite."""
import html
import json
import re

_SPEECH = {'口播', '口播稿', '口播脚本', '朗读正文', '旁白', 'spoken', 'script'}
_PRODUCTION = {'标题', '发布标题', '视频标题', '文章标题', '摘要', '发布文案', '分镜', '分镜脚本',
               '画面', '画面建议', '封面建议', '封面提示词', '制作说明', '拍摄建议', '话题标签'}
_CUE = re.compile(r'(?:【|\[|（|\()(?:分镜|制作说明|画面|镜头|字幕|音效|配乐|动作|语气|停顿)(?:[：:][^】\]）)\n]*|\s*)(?:】|\]|）|\))')
_QUOTES = re.compile(r'“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』|"[^"\n]*"|\x27[^\x27\n]*\x27')
SPEECH_REQUEST_RULE = ('本次口播输出约束：输出完整、可直接朗读的纯口播正文，保留用户明确要求、事实与完整结尾；'
                       '不输出文稿标题、小标题、发布文案、Markdown标记、分镜、画面、字幕标签或制作说明。'
                       '用户明确要求朗读的引语与原话保留，不把自然说话中的“标题”等词删掉。')


def speech_generation_request(data, draft=None):
    """Append request-level rules only; never replace administrator/user prompts."""
    format_name = data.get('format') or (draft or {}).get('input', {}).get('format')
    brief = data.get('brief')
    if format_name not in {'口播脚本', '视频脚本'} or not isinstance(brief, str) or not brief.strip():
        return data
    # Keep the existing invalid-input error, rather than making a large input valid.
    if len(brief) > 30000:
        return data
    if len(brief) + len(SPEECH_REQUEST_RULE) + 2 > 30000:
        raise ValueError('创作要求过长，请稍微缩短，为口播格式要求留出空间')
    return {**data, 'brief':brief + '\n\n' + SPEECH_REQUEST_RULE}


def _structured(body):
    value = body.strip()
    value = re.sub(r'^```(?:json)?\s*\n', '', value, flags=re.I)
    value = re.sub(r'\n```\s*$', '', value)
    if not value.startswith('{'):
        return {}
    try:
        result = json.loads(value)
        return result if isinstance(result, dict) else {}
    except (ValueError, TypeError):
        return {}


def clean_speech(text, title='', explicit=False):
    text = html.unescape(text.replace('\r\n', '\n').replace('\r', '\n'))
    text = re.sub(r'<(?:script|style)\b[^>]*>.*?</(?:script|style)>', '', text, flags=re.I | re.S)
    # Preserve heading boundaries until the same title rules as Markdown run.
    text = re.sub(r'<h([1-6])\b[^>]*>(.*?)</h\1\s*>', lambda m:'\n'+'#'*int(m[1])+' '+m[2]+'\n', text, flags=re.I | re.S)
    text = re.sub(r'!\[[^\]\n]*\]\((?:\\.|[^)\n])*\)|<img\b[^>]*>', '', text, flags=re.I)
    text = re.sub(r'\[([^\]\n]+)\]\([^\n)]+\)', r'\1', text)
    text = re.sub(r'<br\s*/?>|</(?:p|div)>', '\n', text, flags=re.I)
    text = re.sub(r'<[A-Za-z/][^>]*>', '', text)
    # Only recognized, explicitly marked production cues are removed.
    result, skip_level = [], None
    for line in text.split('\n'):
        stripped = line.strip()
        quoted = stripped.startswith('>')
        heading = re.match(r'^(#{1,6})\s+(.+?)(?:\s+#+)?$', stripped)
        level = len(heading[1]) if heading else 0
        label = (heading[2] if heading else stripped).strip().strip('*').rstrip('：:').strip()
        if heading and level == 1 and label == '标题':
            continue
        if not quoted and label in _PRODUCTION and (heading or not explicit):
            skip_level = level
            continue
        if not quoted and (label in _SPEECH or label == '正文') and (heading or not explicit):
            skip_level = None
            continue
        if skip_level is not None:
            if not quoted and heading and level <= skip_level:
                skip_level = None
            else:
                continue
        # Metadata with a value occupies this line only, never the next paragraph.
        inline = re.match(r'^(?:#{1,6}\s*)?(?:\*\*)?([^：:]+?)(?:\*\*)?\s*[：:]\s*(.*)$', stripped)
        if not explicit and not quoted and inline and inline[1] in _PRODUCTION:
            result.append('')
            continue
        if heading and not quoted:
            # Non-quoted Markdown headings are document structure, including
            # headings accidentally returned inside an explicit script field.
            continue
        if not quoted:
            quote_ranges = [(m.start(), m.end()) for m in _QUOTES.finditer(line)]
            line = _CUE.sub(lambda m:m[0] if any(start <= m.start() < end for start, end in quote_ranges) else '', line)
        if not explicit and not any(x.strip() for x in result) and stripped and stripped.strip('*') == title.strip():
            continue
        if re.match(r'^\s*(?:```|~~~|[-*_]{3,}\s*$)', line):
            continue
        line = re.sub(r'^\s*(?:>\s*)+', '', line)
        line = re.sub(r'^\s*(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+)', '', line)
        line = re.sub(r'\*\*([^\n]+?)\*\*|__([^\n]+?)__', lambda m:m[1] or m[2], line)
        line = re.sub(r'(?<!\w)[*_]([^\n]+?)[*_](?!\w)', r'\1', line)
        line = re.sub(r'`([^`]+)`', r'\1', line)
        result.append(line.rstrip())
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(result)).strip()


def speech_from_content(content):
    """Prefer explicit fields, including structured model output stored as body."""
    body = content.get('body') or ''
    raw = _structured(body) if isinstance(body, str) else {}
    chosen, field, explicit = '', 'body', False
    for data in (content, raw):
        for key in ('spoken', 'script'):
            if isinstance(data.get(key), str) and data[key].strip():
                chosen, field, explicit = data[key], key, True
                break
        if explicit:
            break
    if not explicit:
        chosen = raw.get('body', body)
        if not isinstance(chosen, str):
            raise ValueError('文稿正文格式无效，请先在文案创作中核对')
        # A clearly labelled speech section excludes caption/shot list sections.
        match = re.search(r'(?m)^\s*(?:#{1,6}\s*)?(?:\*\*)?(口播脚本|口播稿|朗读正文|旁白)(?:\*\*)?\s*[：:]?\s*$', chosen)
        if match:
            chosen, field, explicit = chosen[match.end():], 'speech_section', True
    title = raw.get('title') if isinstance(raw.get('title'), str) else content.get('title', '')
    text = clean_speech(chosen, title, explicit or content.get('format') in {'口播脚本', '视频脚本'})
    speech_format = content.get('format') in {'口播脚本', '视频脚本'}
    return {'text':text, 'source_field':field, 'needs_conversion':bool(text) and not (explicit or speech_format),
            'cleaned':text != chosen.strip(), 'content_id':content.get('id', ''), 'content_version':content.get('version')}


def conversion_input(content):
    # A new, editable input for the existing writer; no model is invoked here.
    return {'format':'口播脚本', 'brief':'将以下原稿改写为可直接朗读的完整口播稿。保留事实、观点、结尾和用户明确要求；不虚构经历。'
            '只输出朗读正文，不含标题、Markdown、分镜、画面或制作说明。\n原创作要求：'
            + str(content.get('brief') or '') + '\n原稿：\n' + str(content.get('body') or '')}
