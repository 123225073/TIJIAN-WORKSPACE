"""Real pure parser/layout and isolated API regression; no paid or live writes."""
import json
from pathlib import Path

import pytest

from backend.article_production import (parse_article_production, reader_production_body,
    reader_article_body, production_bookmark, replace_production_instruction, replace_production_instructions)
from backend import wechat_layout, store as s
from test_workflows import client, account
from test_writing_improvements import bind_writing, finished

FIXTURES = json.loads((Path(__file__).parent / 'fixtures/article-production.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('example', FIXTURES, ids=[item['name'] for item in FIXTURES])
def test_shared_grammar_and_lossless_source(example):
    parsed = parse_article_production(example['body'])
    assert parsed['body'] == example['body']
    assert len(parsed['instructions']) == example['count']
    assert parsed['readerBody'] == example.get('readerBody', example['body'])
    assert [block['prompt'] for block in parsed['instructions']] == example['prompts']
    assert reader_production_body(parsed['readerBody']) == parsed['readerBody']
    for block in parsed['instructions']:
        assert example['body'][block['start']:block['end']] == block['raw']
    assert wechat_layout.render(example['body']) == wechat_layout.render(parsed['readerBody'])


def photo(number):
    return f'![已完成配图{number}](/api/studio/assets/{str(number) * 32}/file)'


def test_three_images_partial_failure_atomic_replace_and_hand_edits():
    source = FIXTURES[0]['body']
    blocks = parse_article_production(source)['instructions']
    patches = [dict(bookmark=production_bookmark(source, block['id']), imageMarkdown=photo(i + 1))
               for i, block in enumerate(blocks)]
    complete = replace_production_instructions(source, patches)
    assert complete.count('![') == 3 and not parse_article_production(complete)['instructions']
    assert '中段手工改为先看记录。' in complete and '正文应正常讨论提示词。' in complete
    assert replace_production_instructions(source, []) == source
    partial = replace_production_instructions(source, [patches[0], patches[2]])
    assert blocks[1]['raw'] in partial and len(parse_article_production(partial)['instructions']) == 1
    assert '图片内容建议' not in reader_article_body(partial)
    with pytest.raises(ValueError, match='正文已变化'):
        replace_production_instruction(source + '用户补充。', patches[0]['bookmark'], photo(1))
    with pytest.raises(ValueError, match='指令已变化'):
        replace_production_instruction(source, {**patches[0]['bookmark'], 'start': 0}, photo(1))
    with pytest.raises(ValueError, match='重复替换'):
        replace_production_instructions(source, [patches[0], patches[0]])
    with pytest.raises(ValueError, match='本地配图'):
        replace_production_instructions(source, [patches[0], {**patches[1], 'imageMarkdown': '图片已生成'}])
    assert source == FIXTURES[0]['body']


def test_note_and_metadata_remain_available_and_repeated_prompt_is_precise():
    source = FIXTURES[2]['body']
    note = parse_article_production(source)['instructions'][1]
    replaced = replace_production_instruction(source, production_bookmark(source, 'door-1'), photo(1))
    assert note['raw'] in replaced and '作者确认' not in reader_article_body(replaced)
    with pytest.raises(ValueError, match='不存在'):
        production_bookmark(source, 'editor-1')
    repeated = FIXTURES[5]['body']
    blocks = parse_article_production(repeated)['instructions']
    replaced = replace_production_instruction(repeated, production_bookmark(repeated, blocks[1]['id']), photo(1))
    assert blocks[0]['raw'] in replaced
    assert len(parse_article_production(replaced)['instructions']) == 1
    assert reader_article_body('正文[资料' + 'a' * 32 + ']。') == '正文。'


def test_real_preview_and_content_html_export_hide_three_cards_without_mutating_source(client):
    owner = account(client)['user']['id']
    source = FIXTURES[0]['body']
    row = s.put(owner, 'content', dict(title='隔离配图测试', body=source))
    preview = client.post('/api/wechat-publish/preview', json={'body': source})
    exported = client.get('/api/content/' + row['id'] + '/export?format=html')
    assert preview.status_code == exported.status_code == 200
    assert preview.json()['html'] == exported.text
    assert '图片内容建议' not in exported.text and '制作说明' not in exported.text
    assert '正文应正常讨论提示词' in exported.text and '中段手工改为先看记录' in exported.text
    assert s.get(owner, row['id'])['body'] == source and s.get(owner, row['id'])['version'] == row['version']


def test_image_links_and_note_survive_source_but_reader_is_clean():
    source = FIXTURES[2]['body']
    final = replace_production_instruction(source, production_bookmark(source, 'door-1'), photo(1))
    rendered = wechat_layout.render(final)
    assert '已完成配图1' in rendered and '/api/studio/assets/' in rendered
    assert 'article-production' not in rendered and '作者确认' not in rendered
    assert '好的提示词可以帮助说明需求' in rendered


def test_prompt_api_uses_metadata_but_reader_context_is_clean_and_utf16_offsets_return(client, monkeypatch):
    owner = account(client)['user']['id']
    source = FIXTURES[0]['body']
    row = s.put(owner, 'content', dict(title='隔离配图测试', body=source))
    target = parse_article_production(source)['instructions'][1]
    calls = []
    bind_writing(monkeypatch, lambda _, messages: calls.append(messages) or '工作人员核对记录，不要文字。')
    start = len(source[:target['start']].encode('utf-16-le')) // 2
    end = len(source[:target['end']].encode('utf-16-le')) // 2
    result = client.post('/api/studio/text/article-illustration-prompt', json={
        'content_id': row['id'], 'body': source, 'start': start, 'end': end, 'instruction_id': target['id']})
    assert result.status_code == 200, result.text
    job = finished(client, result.json())
    assert job['status'] == 'done', job
    payload = json.loads(calls[0][1]['content'])
    assert '图片内容建议' not in payload['文章全文']
    assert payload['配图制作数据']['原制作块'] == target['raw']
    assert payload['插入段落'] == target['prompt']
    assert job['result']['production_target'] == dict(instruction_id=target['id'], raw=target['raw'], start=start, end=end)
    assert s.get(owner, row['id'])['body'] == source
    assert not s.list_(owner, 'illustration') and not s.list_(owner, 'studio_run')


def test_instruction_selection_errors_never_contact_provider(client, monkeypatch):
    owner = account(client)['user']['id']
    source = FIXTURES[2]['body']
    row = s.put(owner, 'content', dict(title='隔离配图测试', body=source))
    bind_writing(monkeypatch, lambda *_: (_ for _ in ()).throw(AssertionError('provider must not be called')))
    note = parse_article_production(source)['instructions'][1]
    for data in [dict(start=0, end=2, instruction_id='door-1'), dict(start=0, end=2, instruction_id='missing'),
                 dict(start=0, end=len(source)), dict(start=note['start'], end=note['end']),
                 dict(start=0, end=2, instruction_id=True)]:
        result = client.post('/api/studio/text/article-illustration-prompt', json={'content_id': row['id'], 'body': source, **data})
        assert result.status_code == 400, result.text
