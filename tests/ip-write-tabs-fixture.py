"""Real local API and disposable SQLite; synthetic model output, no live data."""
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import store as s, gateway as g, agent

root = s.DATA.resolve()
assert root.is_relative_to(Path('.runtime').resolve()) and root.name.startswith('ip-ui-tabs-')

if '--seed' in sys.argv:
    owner = json.load(sys.stdin)['owner']
    profile = s.put(owner, 'profile', {'title': '原有 IP', 'position': '用户原有定位',
        'agency_brands': '用户自定义代理品牌', 'channels': '用户自定义账号',
        'custom_note': '用户自定义内容', 'style': '用户原有表达', 'body': '用户原有完整方案'})
    alternate = s.put(owner, 'profile', {'title': '另一份 IP', 'body': '另一份原有方案'})
    archived = s.put(owner, 'profile', {'title': '已归档 IP', 'archived': True})
    task = s.put(owner, 'task', {'title': '隔离定位沟通', 'mode': 'profile', 'profile_id': profile['id'],
        'messages': [{'role': 'user', 'text': '参考原有 IP，新增一份独立 IP'}]})
    # Historical candidate intentionally lacks an operation: UI must block it.
    s.put(owner, 'task', {**task, 'agent_proposal': {'id': s.uid(), 'kind': 'profile',
        'status': 'pending', 'fields': {'title': '历史候选', 'body': '历史定位方案'},
        'messages_hash': agent.fingerprint(task)}}, task['id'])
    print(json.dumps({'task_id': task['id'], 'profile_id': profile['id'],
        'alternate_id': alternate['id'], 'archived_id': archived['id'], 'fixture_only': True}))
    sys.exit(0)

g.select = lambda *args, **kwargs: 'isolated-ip-tabs-fixture'
def generate(model, messages):
    return json.dumps({'reply': '隔离候选，请核对。', 'action': 'profile', 'ready': True,
        'fields': {'title': '测试新增 IP', 'position': '隔离测试定位', 'audience': '物业',
        'style': '测试表达', 'views': '测试观点', 'body': '隔离测试完整方案'},
        'notes': ['测试固定回复，不代表真实模型质量']}, ensure_ascii=False)
g.generate = generate
from backend.app import app
import uvicorn
uvicorn.run(app, host='127.0.0.1', port=int(os.environ['IP_TEST_PORT']), log_level='error', access_log=False)
