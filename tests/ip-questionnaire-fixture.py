"""Disposable real SQLite/API fixture, never invokes a provider."""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import store as s, gateway as g, ip_questionnaire as ipq
assert s.DATA.is_relative_to(Path('.runtime').resolve()) and s.DATA.name.startswith('ip-questionnaire-ui-')
g.select=lambda *a,**kw:'isolated-ip-fixture'
s.init()
s.set_config('bindings',{'profile':'isolated-ip-fixture'})
def generate(*args,**kwargs):
    return json.dumps({'title':'问卷测试定位','position':'隔离测试定位','body':'\n\n'.join('## '+h+'\n固定测试报告；【待确认】，向相关负责人核实。' for h in ipq.REPORT_SECTIONS),'topic_candidates':[{'title':'隔离测试建议选题','angle':'仅供测试，具体场地待确认'}]},ensure_ascii=False)
g.generate=generate
from backend.app import app
import uvicorn
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['IP_TEST_PORT']),log_level='error',access_log=False)
