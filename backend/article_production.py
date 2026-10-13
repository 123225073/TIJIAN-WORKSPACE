"""Pure, bounded production-block parser. Keep source; project only reader copy.

Offsets here are Python code points. Frontend bookmarks use UTF-16; convert at
the API boundary. Grammar is mirrored in src/article-production.ts and fixtures.
"""
import re

OPEN = re.compile(r'^:::article-production (illustration|note) ([A-Za-z0-9_-]{1,80})[ \t]*$')
CLOSE = re.compile(r'^:::end-article-production[ \t]*$')
CARD = re.compile(r'^▧[ \t]*文章配图[ \t]*·[ \t]*\S')
TITLE = re.compile(r'^(插图方案|配图提示词|制作说明)(?:[ \t]*(?:[0-9一二三四五六七八九十]+|[（(][0-9一二三四五六七八九十]+[）)]))?[ \t]*(?:[：:｜|·]|$)')
LABEL = re.compile(r'^(?:图片内容建议|配图提示词|提示词)[ \t]*[：:][ \t]*')


def _unquote(text):
    return re.sub(r'^[ \t]{0,3}>[ \t]?', '', text).replace('**', '').strip()


def _card_payload(lines):
    if lines and CARD.match(_unquote(lines[0])):
        lines[0] = re.sub(r'^▧.*?(?=图片内容建议[ \t]*[：:])', '', _unquote(lines[0]), count=1)
    return lines


def _prompt(lines, kind):
    if kind == 'note':
        return ''
    content = [_unquote(line) for line in lines]
    at = next((i for i, line in enumerate(content) if LABEL.match(line)), None)
    if at is None:
        return TITLE.sub('', '\n'.join(content), count=1).strip()
    remaining = content[at:]
    remaining[0] = LABEL.sub('', remaining[0], count=1)
    stop = next((i for i, line in enumerate(remaining)
                 if re.match(r'^(?:制作说明|插入位置|图片说明|风格说明)[ \t]*[：:]', line)), len(remaining))
    return '\n'.join(remaining[:stop]).strip()


def parse_article_production(body):
    lines = [match for match in re.finditer(r'[^\r\n]*(?:\r\n|\n|\r|$)', body) if match[0]]
    def value(index):
        return lines[index][0].rstrip('\r\n')
    instructions, fence, i = [], None, 0
    while i < len(lines):
        line = value(i)
        code = re.match(r'^[ \t]{0,3}(`{3,}|~{3,})(.*)$', line)
        if code:
            if fence is None:
                fence = (code[1][0], len(code[1]))
            elif code[1][0] == fence[0] and len(code[1]) >= fence[1] and not code[2].strip():
                fence = None
            i += 1
            continue
        if fence or re.match(r'^(?: {4}|\t)', line):
            i += 1
            continue
        end, kind, ident = i, 'illustration', ''
        opening = OPEN.match(line)
        if opening:
            close = i + 1
            while close < len(lines) and not CLOSE.match(value(close)) and not OPEN.match(value(close)):
                close += 1
            if close == len(lines) or not CLOSE.match(value(close)):
                i += 1
                continue
            end, kind, ident, syntax = close, opening[1], opening[2], 'explicit'
            payload = [value(n) for n in range(i + 1, end)]
        elif re.match(r'^[ \t]{0,3}>', line) and TITLE.match(_unquote(line)):
            while end + 1 < len(lines) and re.match(r'^[ \t]{0,3}>', value(end + 1)):
                end += 1
            kind = 'note' if _unquote(line).startswith('制作说明') else 'illustration'
            syntax = 'quote'
            payload = [value(n) for n in range(i, end + 1)]
        elif CARD.match(_unquote(line)):
            while end + 1 < len(lines) and value(end + 1).strip() and not CARD.match(_unquote(value(end + 1))):
                end += 1
            payload = _card_payload([value(n) for n in range(i, end + 1)])
            if not any(re.match(r'^图片内容建议[ \t]*[：:]', _unquote(part)) for part in payload):
                nxt = end + 1
                while nxt < len(lines) and not value(nxt).strip():
                    nxt += 1
                if nxt >= len(lines) or not re.match(r'^图片内容建议[ \t]*[：:]', _unquote(value(nxt))):
                    i += 1
                    continue
                end = nxt
                while end + 1 < len(lines) and value(end + 1).strip() and not CARD.match(_unquote(value(end + 1))):
                    end += 1
                payload = _card_payload([value(n) for n in range(i, end + 1)])
            syntax = 'card'
        else:
            i += 1
            continue
        start, finish = lines[i].start(), lines[end].start() + len(value(end))
        instructions.append(dict(id=ident or f'legacy-{len(body[:start].encode("utf-16-le")) // 2}',
                                 kind=kind, syntax=syntax, start=start, end=finish,
                                 raw=body[start:finish], prompt=_prompt(payload, kind)))
        i = end + 1
    parts, cursor = [], 0
    for block in instructions:
        parts.append(body[cursor:block['start']])
        cursor = block['end']
    parts.append(body[cursor:])
    return dict(body=body, readerBody=''.join(parts), instructions=instructions)


def reader_production_body(body):
    return parse_article_production(body)['readerBody']


def production_bookmark(body, instruction_id):
    matches = [block for block in parse_article_production(body)['instructions']
               if block['id'] == instruction_id and block['kind'] == 'illustration']
    if len(matches) != 1:
        raise ValueError('配图指令不存在或编号重复，请重新选择')
    block = matches[0]
    return dict(body=body, instruction_id=instruction_id,
                start=block['start'], end=block['end'], raw=block['raw'])


def replace_production_instruction(body, bookmark, image_markdown):
    return replace_production_instructions(body, [dict(bookmark=bookmark, imageMarkdown=image_markdown)])


def replace_production_instructions(body, replacements):
    """Atomically replace completed members only; never mutate input or storage."""
    patches, ids = [], set()
    for replacement in replacements:
        bookmark, image = replacement['bookmark'], replacement['imageMarkdown']
        if body != bookmark['body']:
            raise ValueError('正文已变化，图片已保留；请重新选择配图指令')
        fresh = production_bookmark(body, bookmark['instruction_id'])
        if fresh != bookmark:
            raise ValueError('配图指令已变化，请重新选择')
        if fresh['instruction_id'] in ids:
            raise ValueError('同一配图指令不能重复替换')
        ids.add(fresh['instruction_id'])
        if not isinstance(image, str) or not re.fullmatch(
                r'!\[[^\]\r\n]*\]\(/api/(?:studio/assets/[a-f0-9]{32,64}|illustrations/[a-f0-9]{32})/file\)', image.strip()):
            raise ValueError('请选择已完成的本地配图')
        patches.append({**fresh, 'imageMarkdown': image.strip()})
    for patch in sorted(patches, key=lambda item: item['start'], reverse=True):
        body = body[:patch['start']] + patch['imageMarkdown'] + body[patch['end']:]
    return body


def reader_article_body(body):
    """Shared handoff/export projection including existing internal-citation rules."""
    from .writing_methods import publish_body
    return publish_body(reader_production_body(body))
