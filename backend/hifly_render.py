"""Per-output timing and documented subtitle geometry, without editing voices."""
import os
import shutil
import subprocess
from pathlib import Path
from . import store as s

VIDEO_TOOLS=('text_avatar','audio_avatar','photo_talk')
RATES=[round(i/20,2) for i in range(10,41)]
LOCAL_OPTIONS={'video_rate','subtitle_position','subtitle_size'}

def ffmpeg():
    values=[os.environ.get('TIJIAN_FFMPEG'),str(s.ROOT/'.runtime/media-tools/ffmpeg.exe'),shutil.which('ffmpeg')]
    return next((str(Path(v).resolve()) for v in values if v and Path(v).is_file()),None)

def rate(value=1):
    if type(value) not in (int,float) or value not in RATES:
        raise ValueError('本条视频语速需为 0.5 至 2 倍，按 0.05 调整')
    return value

def subtitle(source,options):
    width,height=source.get('width') or 720,source.get('height') or 1280
    if type(width) is not int or type(height) is not int or not 64<=width<=8192 or not 64<=height<=8192:
        raise ValueError('无法确定字幕画布尺寸，请关闭字幕或重新选择原素材')
    font=max(16,round(min(width,height)*{'small':.034,'medium':.044,'large':.054}[options.get('subtitle_size','medium')]))
    box_width=round(width*.84)
    # Even width gives an exact horizontal center on odd as well as even canvases.
    if (width-box_width)%2:box_width-=1
    box_height=max(font*2,round(height*.1))
    top=round(height*.82)-box_height//2 if options.get('subtitle_position','bottom')=='bottom' else (height-box_height)//2
    return {'st_font_name':'Alimama FangYuanTi VF','st_font_size':font,
            'st_primary_color':'#ffffff','st_outline_color':'#1b2028',
            'st_width':box_width,'st_height':box_height,'st_pos_x':(width-box_width)//2,'st_pos_y':top}

def process(source,output,multiplier,duration):
    multiplier=rate(multiplier)
    program=ffmpeg()
    if not program:raise ValueError('本机缺少成片处理组件，请修复安装后再设置视频语速')
    # Caller supplies private local paths. No provider URL or shell interpolation.
    command=[program,'-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',str(source),
             '-filter_complex',f'[0:v:0]setpts=(PTS-STARTPTS)/{multiplier}[v];[0:a:0]atempo={multiplier},asetpts=PTS-STARTPTS[a]',
             '-map','[v]','-map','[a]','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
             '-c:a','aac','-b:a','192k','-threads','2','-movflags','+faststart',str(output)]
    try:
        subprocess.run(command,capture_output=True,check=True,timeout=min(1800,max(120,float(duration or 60)/multiplier*10)),
                       creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    except (subprocess.SubprocessError,OSError):
        raise ValueError('原成片已保留，语速处理未完成；核查原任务可重试保存，无需重复付费生成') from None
