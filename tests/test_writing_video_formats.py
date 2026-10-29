"""Real generation routing/persistence with an intercepted model boundary, no paid calls."""
import json

import pytest

from test_workflows import client, account
from test_creation import finish, fake_model
from backend import capabilities as c, store as s
from backend.writing_methods import writing_request


@pytest.mark.parametrize('format_name', ['短视频脚本', '视频脚本', '口播脚本'])
def test_generation_selects_video_methods_and_keeps_admin_style(client, monkeypatch, format_name):
    owner = account(client)['user']['id']
    video = c.save({'title': '管理员视频文风', 'body': 'ADMIN_VIDEO_STYLE', 'purpose': 'writing',
                    'platforms': ['channels'], 'status': 'published'}, owner)
    c.save({'title': '公众号专用', 'body': 'WECHAT_ONLY_STYLE', 'purpose': 'writing',
            'platforms': ['wechat'], 'status': 'published'}, owner)
    before = s.config('system_capabilities')
    requests = []
    fake_model(monkeypatch, lambda _, messages: requests.append(messages) or '先确认使用场景，再比较配置。')
    response = client.post('/api/studio/text/generate', json={
        'brief': '介绍电梯选型', 'format': format_name, 'target_words': 300,
    })
    assert response.status_code == 200, response.text
    result = finish(client, response.json())
    assert result['status'] == 'done', result
    assert len(requests) == 1
    system = requests[0][0]['content']
    saved = s.get(owner, result['result']['content_id'])
    trace = saved['request_snapshot']
    ids = {item['id'] for item in trace['configuration']['items']}
    assert trace['platform'] == 'channels'
    assert {'skill:short-video-script', video['id']} <= ids
    assert 'skill:wechat-narrative' not in ids
    assert 'ADMIN_VIDEO_STYLE' in system and 'WECHAT_ONLY_STYLE' not in system
    assert '短视频口播适配：' in system and '重新组织成有人对镜头说话' in system
    assert ('口播成稿交付约束：' in system) == (format_name == '口播脚本')
    assert trace['system_hash'] == s.digest(system)
    assert json.loads(requests[0][1]['content'])['内容形式'] == format_name
    assert saved['format'] == format_name and saved['body'] == '先确认使用场景，再比较配置。'
    assert s.config('system_capabilities') == before


def test_oral_output_contract_survives_disabled_skill_without_reinserting_it(client, monkeypatch):
    owner = account(client)['user']['id']
    skill = next(item for item in c.list_() if item['id'] == 'skill:short-video-script')
    c.save({**skill, 'body': 'DISABLED_VIDEO_STYLE', 'status': 'disabled'}, owner)
    role = next(item for item in c.list_() if item['id'] == 'role:writing')
    c.save({**role, 'body': 'CUSTOM_ADMIN_VOICE'}, owner)
    before = s.config('system_capabilities')
    requests = []
    fake_model(monkeypatch, lambda _, messages: requests.append(messages) or '先看现场。')
    result = finish(client, client.post('/api/studio/text/generate', json={
        'brief': '介绍电梯选型', 'format': '口播脚本',
    }).json())
    assert result['status'] == 'done', result
    system = requests[0][0]['content']
    assert '口播成稿交付约束：' in system
    assert '只输出可以直接朗读的完整口播正文' in system
    assert all(term in system for term in ('标题', '分镜', '时间轴', '镜头说明', '朗读指令'))
    assert 'CUSTOM_ADMIN_VOICE' in system and 'DISABLED_VIDEO_STYLE' not in system
    assert '短视频口播适配：' not in system
    saved = s.get(owner, result['result']['content_id'])
    assert 'skill:short-video-script' not in {item['id'] for item in saved['capabilities']['items']}
    assert s.config('system_capabilities') == before


def test_oral_contract_keeps_structured_transport_and_other_formats_unchanged(client):
    owner = account(client)['user']['id']
    method = c.snapshot('writing', owner)
    output_rules = '只返回 JSON 对象，包含 title 和 body 两个字段。'
    oral = writing_request(method, policy='', brief='介绍电梯', format_name='口播脚本', output_rules=output_rules)
    system = oral['messages'][0]['content']
    assert output_rules in system and '保持规定字段结构' in system
    assert '标题只放独立标题字段' in system
    for form in ('公众号文章', '通用文案', '短视频脚本', '视频脚本'):
        request = writing_request(method, policy='', brief='介绍电梯', format_name=form, output_rules=output_rules)
        assert '口播成稿交付约束：' not in request['messages'][0]['content']
        assert ('短视频口播适配：' in request['messages'][0]['content']) == (form in ('短视频脚本', '视频脚本'))
