import os
import uvicorn
if __name__=='__main__':
    from backend.app import app
    uvicorn.run(app,host='127.0.0.1',port=int(os.environ.get('TIJIAN_PORT','18786')),log_level='warning')
