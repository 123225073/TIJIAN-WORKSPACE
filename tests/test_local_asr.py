import io
import wave
from pathlib import Path
from threading import Event

import pytest

from backend import local_asr, media_studio, store
from test_media_studio import studio


def audio_asset(client):
    data = io.BytesIO()
    with wave.open(data, 'wb') as w:
        w.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        w.writeframes(b'\0\0' * 16000 * 3)
    response = client.post('/api/studio/upload', files={'file': ('test.wav', data.getvalue(), 'audio/wav')})
    assert response.status_code == 200, response.text
    return response.json()


def test_validates_real_timing_and_rejects_invalid_overlap():
    assert local_asr.validate_srt('1\n00:00:00.000 --> 00:00:01.000\n你好\n', 2) == '1\n00:00:00,000 --> 00:00:01,000\n你好\n'
    with pytest.raises(ValueError):
        local_asr.validate_srt('1\n00:00:00,000 --> 00:00:01,500\n你好\n\n2\n00:00:01,000 --> 00:00:02,000\n再见', 2)
    with pytest.raises(ValueError):
        local_asr.validate_srt('', 2)
    assert '00:00:37,600' in local_asr.validate_srt('1\n00:00:33,200 --> 00:00:37,660\n正常识别\n',37.6)
    assert '00:00:01,000 --> 00:00:01,500' in local_asr.validate_srt('1\n00:00:00,000 --> 00:00:01,000\n前句\n\n2\n00:00:00,990 --> 00:00:01,500\n后句\n',2)
    with pytest.raises(ValueError):
        local_asr.validate_srt('1\n00:00:33,200 --> 00:00:38,000\n超出过多\n',37.6)


def test_transcription_owner_range_and_async_contract(studio, tmp_path, monkeypatch):
    asset = audio_asset(studio)
    model = tmp_path / 'model.bin'
    model.write_bytes(b'test model')
    binary = tmp_path / 'whisper-cli.exe'
    binary.write_bytes(b'test executable')
    monkeypatch.setattr(local_asr, 'available', lambda: (binary, model))
    monkeypatch.setattr(local_asr.hifly_render, 'ffmpeg', lambda: 'ffmpeg')
    monkeypatch.setattr(media_studio, '_metadata', lambda *_: {'duration': 3})
    commands = []

    def fake_process(args, event, timeout, cwd=None):
        commands.append((args, cwd))
        if '-osrt' in args:
            assert Path(cwd) == model.parent
            assert args[args.index('-m') + 1] == model.name
            Path(args[args.index('-of') + 1] + '.srt').write_text('1\n00:00:00,000 --> 00:00:01,000\n你好\n', encoding='utf-8')

    monkeypatch.setattr(local_asr, 'run_process', fake_process)
    with pytest.raises(store.Missing):
        local_asr.start('bob', asset['id'])
    with pytest.raises(ValueError):
        local_asr.start('alice', asset['id'], 2, 4)
    job = local_asr.start('alice', asset['id'], 1, 2.5)
    saved = store.get('alice', job['id'])
    assert saved['status'] == 'done', saved
    assert saved['result']['start_time'] == 1
    assert saved['result']['end_time'] == 2.5
    assert '你好' in saved['result']['srt']
    assert commands[0][0][commands[0][0].index('-ss') + 1] == '1.0'
    assert commands[1][0][commands[1][0].index('-l') + 1] == 'zh'


def test_reference_is_generation_snapshot_not_current_draft(studio):
    draft=store.put('alice','studio_draft',{'tool':'text_avatar','input':{'text':'用户后来修改的草稿'}})
    run=store.put('alice','studio_run',{'tool':'text_avatar','draft_id':draft['id'],'snapshot':{'input':{'text':'真正生成时的口播稿'}},'asset_ids':['a'*32]})
    asset=store.put('alice','studio_asset',{'asset_type':'video','status':'ready','run_id':run['id']},'a'*32)
    assert local_asr.reference_script('alice',asset)=='真正生成时的口播稿'
    audio_run=store.put('alice','studio_run',{'tool':'audio_avatar','snapshot':{'input':{'text':'不应使用'}},'asset_ids':['b'*32]})
    audio=store.put('alice','studio_asset',{'asset_type':'video','status':'ready','run_id':audio_run['id']},'b'*32)
    assert local_asr.reference_script('alice',audio)==''
    assert local_asr.reference_script('bob',asset)==''


def test_ai_correction_preserves_timing_and_flags_numbers(monkeypatch):
    from backend import gateway
    monkeypatch.setattr(gateway,'select',lambda *a:'test-model')
    def response(_model,messages):
        import json
        values=json.loads(messages[1]['content'])['segments']
        return json.dumps({'segments':[{'id':v['id'],'text':v['text'].replace('电替','电梯').replace('3台','4台')} for v in values]},ensure_ascii=False)
    monkeypatch.setattr(gateway,'generate',response)
    raw='1\n00:00:00,000 --> 00:00:01,000\n电替有3台\n\n2\n00:00:01,000 --> 00:00:02,000\n请核对情况\n'
    text,changed=local_asr.correct_srt('alice',raw,'电梯有3台',lambda *_:None,Event())
    assert changed and '电梯有4台' in text
    assert [x['timing'] for x in local_asr._segments(text)]==[x['timing'] for x in local_asr._segments(raw)]
    monkeypatch.setattr(gateway,'generate',lambda *_:'{"segments":[]}')
    with pytest.raises(ValueError):local_asr.correct_srt('alice',raw,'',lambda *_:None,Event())


def test_retry_corrects_saved_recognition_without_retranscribing(studio,monkeypatch):
    from backend import gateway
    asset=audio_asset(studio)
    raw='1\n00:00:00,000 --> 00:00:01,000\n电替安全\n'
    original=store.put('alice','job',{'status':'done','input':{'action':'local_asr','asset_id':asset['id'],'asset_version':asset['version'],'start_time':0,'end_time':3},'result':{'raw_srt':raw}})
    monkeypatch.setattr(gateway,'select',lambda *a:'model')
    monkeypatch.setattr(gateway,'generate',lambda *_:'{"segments":[{"id":0,"text":"电梯安全"}]}')
    job=local_asr.retry_correction('alice',asset['id'],original['id'])
    output=store.get('alice',job['id'])
    assert output['status']=='done' and output['result']['correction_status']=='corrected'
    assert '电梯安全' in output['result']['srt'] and output['result']['raw_srt']==raw
    with pytest.raises(store.Missing):local_asr.retry_correction('bob',asset['id'],original['id'])
    monkeypatch.setattr(gateway,'generate',lambda *_:(_ for _ in ()).throw(ValueError('offline')))
    failed=local_asr.retry_correction('alice',asset['id'],original['id'])
    saved=store.get('alice',failed['id'])['result']
    assert saved['correction_status']=='failed' and saved['srt']==raw


def test_latest_task_is_bound_to_owner_asset_version_and_time_range(studio):
    asset=audio_asset(studio)
    base={'asset_id':asset['id'],'asset_version':asset['version'],'start_time':0,'end_time':3}
    old=store.put('alice','job',{'created':'2026-01-01T00:00:00Z','status':'done','input':{'action':'local_asr',**base},'result':{'raw_srt':'old'}})
    other=store.put('alice','job',{'created':'2026-01-02T00:00:00Z','status':'done','input':{'action':'local_asr',**base,'end_time':2},'result':{'raw_srt':'other'}})
    newest=store.put('alice','job',{'created':'2026-01-03T00:00:00Z','status':'running','input':{'action':'local_asr_correction',**base},'result':{'raw_srt':'same'}})
    assert local_asr.latest('alice',asset['id'],0,3)['id']==newest['id']
    assert local_asr.latest('alice',asset['id'],0,2)['id']==other['id']
    assert local_asr.latest('alice',asset['id'],1,2) is None
    with pytest.raises(store.Missing):local_asr.latest('bob',asset['id'],0,3)
    store.put('alice','studio_asset',{**asset,'title':'changed'},asset['id'],asset['version'])
    assert local_asr.latest('alice',asset['id'],0,3) is None
