"""Exercise packaged service with isolated data and packaged media/ASR tools only."""
import hashlib, io, json, os, socket, subprocess, sys, time
from pathlib import Path
import httpx
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]
resources=root/'release/0.31.0/win-unpacked/resources'
exe=resources/'backend/tijian-service/tijian-service.exe'
ffmpeg=resources/'media-tools/ffmpeg.exe';ffprobe=resources/'media-tools/ffprobe.exe';asr=resources/'asr-tools'
source=Path(sys.argv[1]); assert source.is_file() and exe.is_file() and ffmpeg.is_file() and ffprobe.is_file() and (asr/'whisper-cli.exe').is_file() and (asr/'ggml-small-q5_1.bin').is_file()
dir=root/'.runtime'/('release-compose-check-'+str(time.time_ns()));dir.mkdir()
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while chunk:=f.read(1024*1024):h.update(chunk)
 return h.hexdigest()
original=digest(source)
clip=dir/'speech.mp4'
subprocess.run([str(ffmpeg),'-v','error','-y','-ss','58','-i',str(source),'-t','12','-vf','scale=320:-2','-c:v','libx264','-c:a','aac','-threads','2',str(clip)],check=True,capture_output=True)
cliphash=digest(clip)
Image.new('RGB',(320,480),'red').save(dir/'b-roll.png')
over=Image.new('RGBA',(720,1280),(0,0,0,0));ImageDraw.Draw(over).rectangle((100,100,620,240),fill=(255,220,0,255));over.save(dir/'intro.png')
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
log=(dir/'backend.log').open('w',encoding='utf-8')
env={**os.environ,'TIJIAN_DATA':str(dir),'TIJIAN_PORT':str(port),'TIJIAN_ALLOW_SELF_REGISTRATION':'1','TIJIAN_FFMPEG':str(ffmpeg),'TIJIAN_FFPROBE':str(ffprobe),'TIJIAN_ASR_DIR':str(asr),'PYTHONIOENCODING':'utf-8'}
child=subprocess.Popen([str(exe)],cwd=dir,env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
def req(c,method,url,**kwargs):
 r=c.request(method,url,**kwargs)
 if not r.is_success:raise RuntimeError(f'{method} {url}: {r.status_code} {r.text[:1000]}')
 return r.json()
def job(c,url):
 for _ in range(1200):
  j=req(c,'GET',url)
  if j['status']=='done':return j
  if j['status'] in ('failed','interrupted','cancelled'):raise RuntimeError(str(j))
  time.sleep(.5)
 raise TimeoutError(url)
try:
 with httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=30,trust_env=False) as c:
  for i in range(160):
   if child.poll() is not None:raise RuntimeError('packaged backend exited')
   try:
    if c.get('/api/health').is_success:break
   except httpx.RequestError:pass
   time.sleep(.25)
  else:raise TimeoutError('backend startup')
  auth=req(c,'POST','/api/auth/register',json={'email':f'isolated-{time.time_ns()}@example.test','password':'not-shared-Valid123!','name':'隔离打包验收'});c.headers['Authorization']='Bearer '+auth['token']
  status=req(c,'GET','/api/studio/local-asr/status');assert status['available'],status
  def upload(p):
   with p.open('rb') as f:return req(c,'POST','/api/studio/upload',files={'file':(p.name,f,'video/mp4' if p.suffix=='.mp4' else 'image/png')})
  a=upload(clip);b=upload(dir/'b-roll.png');intro=upload(dir/'intro.png')
  a=a.get('asset',a);b=b.get('asset',b);intro=intro.get('asset',intro)
  aj=req(c,'POST',f"/api/studio/assets/{a['id']}/transcribe-local",json={'start_time':0,'end_time':12});recognized=job(c,'/api/jobs/'+aj['id']);srt=recognized['result']['srt'];assert ' --> ' in srt and any('\u4e00'<=ch<='\u9fff' for ch in srt)
  draft=req(c,'POST','/api/studio/drafts',json={'tool':'compose','title':'隔离成片验收','input':{'scenes':[]},'options':{}})
  config={'scenes':[{'asset_id':a['id'],'trim':0,'length':12,'fit':'contain','volume':1}], 'b_roll':[{'asset_id':b['id'],'start':4,'trim':0,'length':2,'fit':'cover'}], 'aspect_ratio':'9:16','resolution':'720p','srt':srt,'intro':{'overlay_asset_id':intro['id'],'overlay_duration':3}}
  project=req(c,'POST','/api/studio/local-compose/projects',json={'draft_id':draft['id'],'title':'本地验收','project':config});saved=req(c,'GET','/api/studio/local-compose/projects?draft_id='+draft['id'])['items'][0];assert saved['project']['srt']==srt and saved['project']['b_roll'][0]['asset_id']==b['id']
  j=req(c,'POST',f"/api/studio/local-compose/projects/{project['id']}/render",json={'version':project['version']});done=job(c,'/api/studio/local-compose/jobs/'+j['id']);result=done['result_asset_id']
  r=c.get('/api/studio/assets/'+result+'/file');r.raise_for_status();out=dir/'output.mp4';out.write_bytes(r.content)
  info=json.loads(subprocess.run([str(ffprobe),'-v','error','-show_streams','-show_format','-of','json',str(out)],check=True,capture_output=True).stdout);assert any(s['codec_type']=='video' for s in info['streams']) and any(s['codec_type']=='audio' for s in info['streams']);assert abs(float(info['format']['duration'])-12)<.3
  subprocess.run([str(ffmpeg),'-v','error','-i',str(out),'-f','null','-'],check=True,capture_output=True)
  def frame(sec):
   data=subprocess.run([str(ffmpeg),'-v','error','-ss',str(sec),'-i',str(out),'-frames:v','1','-f','image2pipe','-vcodec','png','-'],check=True,capture_output=True).stdout
   return Image.open(io.BytesIO(data)).convert('RGB')
  yellow=frame(1).getpixel((360,150));red=frame(5).getpixel((360,640));later=frame(8).getpixel((360,640));assert yellow[0]>220 and yellow[1]>180 and yellow[2]<60;assert red[0]>220 and red[1]<50 and red[2]<50;assert later[1]>50 or later[2]>50
  downloaded=c.get('/api/studio/assets/'+a['id']+'/file');downloaded.raise_for_status();assert hashlib.sha256(downloaded.content).hexdigest()==cliphash and digest(source)==original
  report={'ok':True,'packaged_backend':True,'packaged_ffmpeg':True,'packaged_whisper':True,'real_recognition':True,'subtitle_characters':len(srt),'project_restored':True,'a_roll_b_roll_intro_export':True,'decoded_video_and_audio':True,'verified_intro_b_roll_and_return':True,'duration':info['format']['duration'],'source_unchanged':True,'production_data_touched':False,'directory':str(dir)}
  (dir/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
finally:
 child.terminate()
 try:child.wait(timeout=10)
 except subprocess.TimeoutExpired:child.kill();child.wait()
 log.close()
