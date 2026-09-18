"""Isolated deterministic UI test sources, never used by the real application."""
import sys,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import radar,network
from backend.app import app
import uvicorn
radar.tender_request=lambda payload:[{'docId':'101','title':'电梯维保项目（测试）','publishTime':'10分钟前更新','area':'测试地区'},{'docId':'102','title':'扶梯更新项目（测试）','publishTime':'2026-09-18','area':'测试地区'}]
network.fetch=lambda url:('<title>动态测试网站</title><div id="app"></div>',url)
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='warning')
