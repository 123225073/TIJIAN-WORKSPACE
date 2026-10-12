import threading

from backend import jobs, store as s, streaming
from test_workflows import client, account


def test_public_progress_is_retained_without_raw_model_payload(client):
    owner = account(client)['user']['id']
    reached, release = threading.Event(), threading.Event()

    def work(progress, event):
        progress('正在核对本次参考资料')
        streaming.emit('start')
        streaming.emit('delta', '{"reply":"已经开始整理定位。","private":"hidden"}')
        reached.set()
        release.wait(5)
        progress('正在保存待确认成果')
        return {'text': '已整理'}

    job = jobs.start(owner, '公开过程测试', work, {'action': 'assistant'})
    try:
        assert reached.wait(3)
        current = s.get(owner, job['id'])
        assert any(x['text'] == '正在核对本次参考资料' for x in current.get('progress_history', []))
        assert 'hidden' not in current.get('stream_text', '')
    finally:
        release.set()
