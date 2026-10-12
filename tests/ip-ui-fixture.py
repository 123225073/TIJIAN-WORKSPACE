"""Disposable local UI server. Model replies are fixtures, no provider access."""
import json, os, sys, sqlite3, hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import store as s, gateway as g

root=s.DATA.resolve()
assert root.is_relative_to(Path('.runtime').resolve()) and root.name.startswith('ip-ui-')

if '--seed' in sys.argv:
    owner=json.load(sys.stdin)['owner']
    source=Path('C:/Users/CM1165/AppData/Roaming/elevator-workbench/data/workbench.sqlite')
    before=hashlib.sha256(source.read_bytes()).hexdigest()
    ids=('abc1c5dbe1754b04b1540d5fa573feea','23e64ff3057c43e485c6ec6d5959dddd')
    reader=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);reader.row_factory=sqlite3.Row
    try:rows=[reader.execute('SELECT id,kind,data,version FROM objects WHERE id=?',(id,)).fetchone() for id in ids]
    finally:reader.close()
    with s.conn() as c:
        for row in rows:
            data={k:v for k,v in json.loads(row['data']).items() if k not in {'file','file_hash','file_missing'}}
            c.execute('INSERT INTO objects VALUES (?,?,?,?,?,?)',(row['id'],owner,row['kind'],json.dumps(data,ensure_ascii=False),row['version'],s.now()))
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    print(json.dumps({'task_id':ids[0],'profile_id':ids[1],'source_db_sha256':before,'fixture_only':True}))
    sys.exit(0)

g.select=lambda *a,**k:'isolated-ip-ui-fixture'
def generate(model,messages):
    if '需求识别器' in messages[0]['content']:
        text=json.loads(messages[1]['content'])['最新用户请求']
        return json.dumps({'action':'topics' if '选题' in text else 'profile','platforms':[],'brief':text},ensure_ascii=False)
    if '"topics"' in messages[0]['content']:
        return json.dumps({'topics':[{'title':'物业电梯更新准备','angle':'资料清单','rationale':'方向建议，待查证','audience':'物业'},
                                    {'title':'电梯项目报价口径','angle':'明确现场条件','rationale':'方向建议，待查证','audience':'同行'}]},ensure_ascii=False)
    return json.dumps({'reply':'隔离测试模型已整理候选，请核对。','action':'profile','ready':True,
        'fields':{'title':'风沙讲电梯','position':'项目合作与销售获客','audience':'同行与物业','style':'通俗务实','views':'先讲清项目','body':'隔离测试定位方案，沿用参考 IP 的定位。'},
        'notes':['仅为隔离测试，不代表真实模型质量']},ensure_ascii=False)
g.generate=generate
from backend.app import app
import uvicorn
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['IP_TEST_PORT']),log_level='error',access_log=False)
