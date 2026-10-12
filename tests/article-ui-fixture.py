"""Test-only seed endpoint and offline providers; never run against user data."""
import os,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
assert 'article-editing-ui-' in os.environ.get('TIJIAN_DATA','')
from fastapi import Depends
from backend.app import app,user
from backend import store as s

@app.post('/api/test/article')
def seed(u=Depends(user)):
    task=s.put(u['id'],'task',{'title':'隔离文章测试','messages':[],'mode':'auto'})
    content=s.put(u['id'],'content',{'title':'测试稿','body':'第一段前半后半。\n\n第二段结尾。','task_id':task['id'],'format':'公众号文章','status':'draft'})
    return {'task':task,'content':content}

runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/studio-ui-fixture.py'),run_name='__main__')
