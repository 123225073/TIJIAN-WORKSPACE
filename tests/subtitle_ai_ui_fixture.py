"""Isolated UI fixture: real local ASR and deterministic fake text model."""
import json,os,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
assert 'article-editing-ui-' in os.environ.get('TIJIAN_DATA','')
from fastapi import Depends
import uvicorn
from backend.app import app,user
from backend import store as s

@app.post('/api/test/subtitle-snapshot')
def snapshot(data:dict,u=Depends(user)):
    asset=s.get(u['id'],data['asset_id']);run=s.get(u['id'],asset['run_id'])
    s.put(u['id'],'studio_run',{**run,'snapshot':{'input':{'text':'生成时的原稿 123'}}},run['id'],run['version'])
    draft=s.get(u['id'],asset['draft_id']);s.put(u['id'],'studio_draft',{**draft,'input':{'text':'后来修改的草稿 999'}},draft['id'],draft['version'])
    return {'ok':True}

original_run=uvicorn.run
def serve(application,*args,**kwargs):
    from backend import gateway as g
    g.select=lambda *_args,**_kwargs:'fixture-text'
    def generate(_model,messages,**_kwargs):
        payload=json.loads(messages[1]['content']);data=Path(os.environ['TIJIAN_DATA'])
        (data/'model-reference.txt').write_text(payload['reference_script'],encoding='utf8')
        mode=(data/'model-mode.txt').read_text(encoding='utf8')
        if mode=='fail': raise ValueError('fixture offline')
        result=[]
        for item in payload['segments']:
            text=item['text'].replace('视频','短片')
            if mode=='number' and item['id']==0:text+='123'
            result.append({'id':item['id'],'text':text})
        return json.dumps({'segments':result},ensure_ascii=False)
    g.generate=generate
    return original_run(application,*args,**kwargs)
uvicorn.run=serve
runpy.run_path(str(Path(__file__).resolve().parent/'article-ui-fixture.py'),run_name='__main__')
