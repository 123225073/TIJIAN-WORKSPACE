import json
import httpx
import pytest
from backend import media_studio as m, store as s
from test_media_studio import studio
from test_hifly_voice_parameters import voice_http, endpoint
from test_hifly_v2 import hifly_draft, provider_http
from backend import hifly_render
import subprocess
import hashlib
import array
from pathlib import Path

def body(draft,options):
    return {'tool':draft['tool'],'title':draft['title'],'input':draft['input'],'options':options}

def test_provider_empty_voice_fields_use_documented_defaults_without_edit(studio, voice_http):
    voice,calls,behavior=voice_http
    behavior['handler']=lambda request,body: httpx.Response(200,json={'code':0,'data':[{'voice':voice['provider_resource_id'],'type':8,'rate':'','volume':'','pitch':''}]})
    before=s.get('alice',voice['id'])
    response=studio.get(endpoint(voice))
    assert response.status_code==200,response.text
    assert response.json()['parameters']=={'rate':1,'volume':1,'pitch':1}
    assert s.get('alice',voice['id'])==before and [c[0] for c in calls]==['GET']

def test_per_video_rate_is_frozen_locally_and_never_sent_to_provider_or_voice_edit(studio, provider_http):
    original=hifly_draft(studio,'text_avatar')
    first=studio.post('/api/studio/drafts',json=body(original,{'video_rate':1.1,'st_show':0}))
    assert first.status_code==200,first.text
    one=first.json()
    second=studio.post('/api/studio/drafts',json=body(one,{'video_rate':1.2,'st_show':0}))
    assert second.status_code==200,second.text
    two=second.json()
    assert one['options']['video_rate']==1.1 and two['options']['video_rate']==1.2
    path,payload,_=m._build('alice',one,m._service('hifly'))
    assert path.endswith('video/create_by_tts')
    assert 'video_rate' not in payload and 'rate' not in payload
    assert not provider_http[0]

def test_subtitles_use_original_canvas_bottom_center_and_smaller_font(studio, provider_http):
    draft=hifly_draft(studio,'text_avatar',video=True)
    raw=s.get('alice',draft['input']['video_id'])
    s.put('alice','studio_asset',{**raw,'width':1080,'height':1906},raw['id'])
    draft['options']={'st_show':1,'subtitle_position':'bottom','subtitle_size':'medium','video_rate':1.2}
    path,payload,_=m._build('alice',draft,m._service('hifly'))
    assert payload['st_pos_x']+payload['st_width']/2==540
    assert payload['st_pos_y']>1906*.75
    assert payload['st_pos_y']+payload['st_height']<1906*.95
    assert 35<=payload['st_font_size']<=60
    assert payload['st_primary_color']=='#ffffff'
    assert not {'video_rate','subtitle_position','subtitle_size'} & payload.keys()

@pytest.mark.parametrize('rate',[0,True,None,'1.1',3])
def test_invalid_video_rate_never_starts_paid_work(studio, provider_http,rate):
    draft=hifly_draft(studio,'audio_avatar')
    response=studio.post('/api/studio/drafts',json=body(draft,{'video_rate':rate}))
    assert response.status_code==400
    assert not provider_http[0]

@pytest.mark.parametrize('rate',[.5,1,1.0,1.1,1.2,2,2.0])
def test_valid_slider_endpoints_and_normal_speed_accept_json_ints_and_floats(studio,provider_http,rate):
    draft=hifly_draft(studio,'audio_avatar')
    response=studio.post('/api/studio/drafts',json=body(draft,{'video_rate':rate}))
    assert response.status_code==200,response.text
    assert response.json()['options']['video_rate']==rate and not provider_http[0]

@pytest.fixture
def playable(tmp_path):
    ff=hifly_render.ffmpeg()
    if not ff:pytest.skip('FFmpeg required for real media regression')
    source=tmp_path/'source.mp4'
    subprocess.run([ff,'-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=320x480:r=25:d=3',
        '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx264','-c:a','aac','-threads','2',str(source)],check=True,capture_output=True)
    return source

@pytest.mark.parametrize('speed',[.5,1.1,1.2,2])
def test_actual_saved_video_has_expected_duration_synced_tracks_and_unchanged_pitch(playable,tmp_path,speed):
    original=hashlib.sha256(playable.read_bytes()).hexdigest()
    output=tmp_path/'output.mp4'
    hifly_render.process(playable,output,speed,3)
    meta=m._metadata(output,'.mp4')
    assert abs(meta['duration']-3/speed)<.15
    assert (meta['width'],meta['height'])==(320,480)
    info=json.loads(subprocess.run([m._ffprobe(),'-v','error','-show_streams','-of','json',str(output)],capture_output=True,check=True).stdout)
    ends=[float(t['duration']) for t in info['streams'] if t['codec_type'] in ('audio','video')]
    assert len(ends)==2 and abs(ends[0]-ends[1])<.15
    pcm=subprocess.run([hifly_render.ffmpeg(),'-v','error','-i',str(output),'-ss','0.2','-t','1','-map','0:a:0','-ac','1','-ar','48000','-f','s16le','pipe:1'],capture_output=True,check=True).stdout
    samples=array.array('h',pcm);frequency=sum(a<=0<b for a,b in zip(samples,samples[1:]))/(len(samples)/48000)
    assert abs(frequency-440)<4
    assert hashlib.sha256(playable.read_bytes()).hexdigest()==original

def test_archive_saves_derived_media_once_and_keeps_source_and_voice(playable,studio,provider_http,monkeypatch):
    draft=hifly_draft(studio,'text_avatar')
    draft['options']={'video_rate':1.2,'st_show':0}
    voice_before=s.get('alice',draft['input']['voice_id'])
    original=m._path('alice',s.uid()+'.mp4');original.write_bytes(playable.read_bytes())
    downloaded=[]
    def download(*args,**kwargs):
        downloaded.append(True)
        return original.name,m._metadata(original,'.mp4')
    monkeypatch.setattr(m,'_download',download)
    run=s.put('alice','studio_run',{'tool':'text_avatar','title':'成片测试','provider':'hifly','service_scope':m._scope('hifly',m._service('hifly')),
        'draft_id':draft['id'],'draft_version':draft['version'],'snapshot':draft,'status':'saving','result':{'asset_type':'video','urls':['https://result.example/original.mp4']}})
    finished=m._archive('alice',run)
    saved=s.get('alice',finished['asset_ids'][0])
    assert saved['video_rate']==1.2 and saved['original_file']==original.name
    assert abs(saved['duration']-2.5)<.15 and original.read_bytes()==playable.read_bytes()
    m._archive('alice',finished)
    assert len(downloaded)==1 and s.get('alice',draft['input']['voice_id'])==voice_before
    assert not provider_http[0]
