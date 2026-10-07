import io,json
from contextlib import contextmanager
from PIL import Image
import pytest
from backend import illustrations as i

@pytest.mark.parametrize('status,error,expected',[
 (400,{'error':{'param':'size','message':'Unsupported size. Supported: 1024x1024, 1536x1024'}},2),
 (422,{'error':{'code':'unsupported_size','message':'1536x1024'}},2),
 (400,{'error':{'param':'quality','message':'Unsupported quality'}},1),
 (400,{'id':'already-submitted','error':{'code':'unsupported_size'}},1),
 (500,{'error':{'code':'unsupported_size'}},1),
 (401,{'error':{'code':'unsupported_size'}},1),
 (400,{'error':{'param':'size','message':'Unsupported size 2560x1440.'}},2),
 (400,{'error':{'code':'unsupported_size','message':'1024x1024 or 2048x2048'}},2),
 (400,{'id':None,'error':{'code':'unsupported_size'}},1),
 (400,{'data':[],'error':{'code':'unsupported_size'}},1),
])
def test_retry_only_definite_size_rejection_once(monkeypatch,status,error,expected):
    monkeypatch.setattr(i.g,'model_record',lambda model:({'model':'gpt-image-2.5','capability':'image','published':True},{'published':True}))
    monkeypatch.setattr(i.g,'headers',lambda p:{})
    monkeypatch.setattr(i.g,'endpoint',lambda p,path:'https://example.invalid/'+path)
    monkeypatch.setattr(i.network,'public_target',lambda url:(url,{},{}))
    raw=io.BytesIO();Image.new('RGB',(20,20)).save(raw,format='PNG')
    import base64
    success=json.dumps({'data':[{'b64_json':base64.b64encode(raw.getvalue()).decode()}]}).encode()
    calls=[];adjustments=[]
    class Response:
        def __init__(self,status,data):self.status_code=status;self.data=data
        def iter_bytes(self):yield self.data
        def close(self):pass
    class Client:
        def __init__(self,**kw):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        @contextmanager
        def stream(self,method,url,**kwargs):
            calls.append(kwargs['json']);yield Response(status,json.dumps(error).encode()) if len(calls)==1 else Response(200,success)
    monkeypatch.setattr(i.httpx,'Client',Client)
    if expected==2:
        assert i.generate('test','原提示词','2560x1440',on_size_adjustment=lambda a,b:adjustments.append((a,b)),_retry_size=True).startswith('data:image/png')
        chosen='2048x2048' if '2048x2048' in str(error) else '1536x1024'
        assert calls[-1]['size']==chosen and adjustments==[('2560x1440',chosen)]
        assert calls[-1]['prompt']=='原提示词'
    else:
        with pytest.raises(ValueError):i.generate('test','原提示词','2560x1440',_retry_size=True)
    assert len(calls)==expected
