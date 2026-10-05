"""One editable layout for the local WeChat proof and draft payload."""
from __future__ import annotations

import re

from . import upstream
from .writing_methods import publish_body


DEFAULT = {'font_size': '16', 'line_height': '1.8', 'paragraph_gap': '12', 'accent': 'forest'}
OPTIONS = {
    'font_size': {'15', '16', '17'},
    'line_height': {'1.6', '1.8', '2.0'},
    'paragraph_gap': {'8', '12', '18'},
    'accent': {'forest', 'blue', 'ink'},
}
ACCENTS = {'forest': '#087f5b', 'blue': '#315ed6', 'ink': '#303b3d'}
LIST = re.compile(r'<(?:ol|ul)\b[^>]*>(.*?)</(?:ol|ul)>', re.S)
ITEM = re.compile(r'<li\b[^>]*>(.*?)</li>', re.S)
INLINE_COLORS = {'ink': '#243b34', 'forest': '#087f5b', 'blue': '#315ed6', 'red': '#c34539', 'orange': '#ac631d'}
INLINE_SIZES = {'14', '16', '18', '20', '24'}
INLINE_STYLE = re.compile(r'\{#(color|size):([a-z0-9]+)\}|\{#/(color|size)\}')


def style(value=None):
    if value is None or value == '':
        return DEFAULT.copy()
    if not isinstance(value, dict) or set(value) - set(OPTIONS):
        raise ValueError('公众号排版设置无效')
    result = {**DEFAULT, **value}
    if any(not isinstance(result[key], str) or result[key] not in choices for key, choices in OPTIONS.items()):
        raise ValueError('公众号排版设置无效')
    return result


def render(body, settings=None):
    chosen = style(settings)
    color = ACCENTS[chosen['accent']]
    font = chosen['font_size']
    line = chosen['line_height']
    gap = chosen['paragraph_gap']
    styles = upstream.wechat.DEFAULT_STYLES.copy()
    styles.update({
        'body': f"font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:{font}px;color:#333333;line-height:{line};word-break:normal;overflow-wrap:break-word;text-align:left;letter-spacing:0;word-spacing:0;",
        'p': f'margin:0 0 {gap}px;line-height:{line};color:#333333;text-align:left;word-break:normal;overflow-wrap:break-word;letter-spacing:0;word-spacing:0;',
        'h2': f'font-size:{int(font)+2}px;font-weight:700;color:#203a31;margin:24px 0 12px;padding:5px 0 5px 12px;border-left:3px solid {color};line-height:1.5;',
        'h3': f'font-size:{int(font)+1}px;font-weight:700;color:#203a31;margin:20px 0 10px;line-height:1.5;',
        'ul': 'margin:0;padding:0;list-style:none;',
        'ol': 'margin:0;padding:0;list-style:none;',
        'li': f'margin:0 0 {max(4, int(gap)-4)}px;line-height:{line};color:#243b34;',
        'section_divider': f'text-align:center;color:{color};font-size:10px;letter-spacing:8px;margin:22px 0;',
        'img': 'display:block;max-width:100%;height:auto;margin:12px auto;border-radius:4px;',
        'caption': 'font-size:12px;color:#7a8c80;text-align:center;margin:4px 0 16px;',
        'blockquote': f'margin:18px 0;padding:10px 16px;border-left:3px solid {color};background:#f6f8f7;color:#444444;text-align:left;line-height:{line};letter-spacing:0;word-spacing:0;',
    })
    styles['strong'] = 'font-weight:700;'
    list_style = upstream.wechat.DEFAULT_LIST_STYLE.copy()
    list_style.update(num_container=f'color:{color};font-weight:700;margin-right:7px;',
                      bullet_container=f'color:{color};margin-right:7px;')
    marked = re.sub(r'(?m)^# ', '## ', publish_body(body))
    # The upstream parser closes a list on each blank line and restarts its
    # explicit counter at 1. Markdown commonly separates list items this way.
    marked = re.sub(r'(?m)(^(\d+)\.\s+[^\n]+)\n(?:[ \t]*\n)+(?=(\d+)\.\s+)',
                    lambda match: match.group(1) + '\n' if int(match.group(3)) == int(match.group(2)) + 1 else match.group(0),
                    marked)
    marked = re.sub(r'(?m)(^[-*+]\s+[^\n]+)\n(?:[ \t]*\n)+(?=[-*+]\s+)', r'\1\n', marked)
    output = upstream.wechat.convert_markdown_to_wechat_html(marked, styles=styles, list_style=list_style)

    # The public-account editor may reintroduce native <ol>/<ul> markers.
    # Render each explicit marker as a plain paragraph, so numbering cannot double.
    def flatten(match):
        items = ITEM.findall(match.group(1))
        return ''.join(f'<p style="{styles["li"]}">{item}</p>' for item in items)

    output = LIST.sub(flatten, output)
    # The upstream parser restarts lists around intervening paragraphs. Keep
    # explicit editorial numbering even when each point has its own explanation.
    numbers = re.findall(r'(?m)^\s*(\d+)\.\s+', marked)
    if numbers and len(set(numbers)) > 1:
        iterator = iter(numbers)
        output = re.sub(r'>\d+\.</span>', lambda m: '>'+next(iterator, m.group(0)[1:-7])+'.</span>', output)

    def inline_style(match):
        kind, value, closing = match.groups()
        if closing:
            return '</span>'
        if kind == 'color' and value in INLINE_COLORS:
            return f'<span style="color:{INLINE_COLORS[value]};">'
        if kind == 'size' and value in INLINE_SIZES:
            return f'<span style="font-size:{value}px;">'
        return match.group(0)

    return INLINE_STYLE.sub(inline_style, output)
