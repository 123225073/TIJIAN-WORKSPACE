"""Create a synthetic local video/run only inside a test's isolated data directory."""
import json
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import hifly_render, media_studio as m, store as s

owner, draft_id = sys.argv[1:3]
draft = s.get(owner, draft_id)
aid = s.uid()
source = m._path(owner, aid + '.mp4')
if len(sys.argv)>3:
    subprocess.run([hifly_render.ffmpeg(), '-v', 'error', '-y', '-ss', '58', '-i', sys.argv[3], '-t', '12', '-vf', 'scale=320:-2', '-c:v', 'libx264', '-c:a', 'aac', '-threads', '2', str(source)], check=True, capture_output=True)
else:
    subprocess.run([hifly_render.ffmpeg(), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x480:r=25:d=6',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', '-c:v', 'libx264',
                    '-c:a', 'aac', '-threads', '2', str(source)], check=True, capture_output=True)
run_id = s.uid()
asset = s.put(owner, 'studio_asset', {**m._metadata(source, '.mp4'), 'title': '隔离合成测试视频', 'status': 'ready',
              'provider': 'hifly', 'compat': m.COMPAT['video'], 'local_file': source.name, 'run_id': run_id,
              'draft_id': draft_id}, aid)
s.put(owner, 'studio_run', {'title': '隔离合成测试视频', 'status': 'succeeded', 'provider': 'hifly',
      'tool': 'text_avatar', 'draft_id': draft_id, 'draft_version': draft['version'], 'asset_ids': [asset['id']]}, run_id)
print(json.dumps({'asset_id': aid, 'run_id': run_id, 'file': str(source)}))
