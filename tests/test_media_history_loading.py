"""History previews omit large payloads but preserve counts and stored results."""
from backend import media_studio, store as s
from test_media_studio import studio


def test_history_preserves_public_contract_and_skips_blob_decode(studio, monkeypatch):
    s.set_config('models', [{'id': 'history-model', 'title': '历史图片模型'}])
    row = s.put('alice', 'studio_run', {'title': '图片历史', 'tool': 'text_image',
        'provider': 'images', 'status': 'succeeded', 'asset_ids': [],
        'result': {'data_uri': 'data:image/png;base64,' + 'A' * 2_000_000},
        'snapshot': {'tool': 'text_image', 'model_id': 'history-model', 'input': {'prompt': '原提示词'}, 'options': {}}})
    expected = media_studio._public(row)
    unpack = s.unpack
    decoded_sizes = []
    def capture(record):
        decoded_sizes.append(len(record['data']))
        return unpack(record)
    monkeypatch.setattr(s, 'unpack', capture)
    response = studio.get('/api/studio/runs')
    assert response.status_code == 200
    assert response.json()['items'] == [expected]
    assert decoded_sizes and max(decoded_sizes) < 2000
    assert response.json()['items'][0]['result_count'] == 1
    assert studio.get('/api/studio/runs', headers={'Authorization': 'Bearer bob'}).json()['items'] == []
    with s.conn() as c:
        assert len(c.execute('SELECT data FROM objects WHERE id=?', (row['id'],)).fetchone()['data']) > 2_000_000


def test_history_url_results_and_batch_statuses_are_unchanged(studio):
    rows = [s.put('alice', 'studio_run', {'title': 'URL历史', 'status': 'archive_failed',
        'result': {'urls': ['https://example.invalid/a.png', 'https://example.invalid/b.png']}, 'asset_ids': []}),
        s.put('alice', 'studio_run', {'title': '多图历史', 'status': 'partial', 'batch': [
            {'status': 'succeeded', 'urls': ['https://example.invalid/a.png'], 'asset_ids': ['saved'], 'task_id': 'original-task'},
            {'status': 'unknown', 'error': '等待核查'},
        ]})]
    expected = {row['id']: media_studio._public(row) for row in rows}
    assert {row['id']: row for row in studio.get('/api/studio/runs').json()['items']} == expected
