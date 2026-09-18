"""Per-worker output sink; exposes answer text, never reasoning or tool arguments."""
import threading, json, re
from contextlib import contextmanager

local=threading.local()

@contextmanager
def capture(callback,event):
    old=getattr(local,'sink',None);local.sink=(callback,event)
    try:yield
    finally:local.sink=old

def emit(phase,text=''):
    sink=getattr(local,'sink',None)
    if sink:
        if sink[1].is_set():raise InterruptedError('任务已取消')
        sink[0](phase,text)

def readable(text):
    raw=text.lstrip()
    if not raw.startswith(('{','```json')):return text
    # Decode completed or partial JSON strings for user-facing fields only.
    result=[]
    for m in re.finditer(r'"(reply|title|position|audience|style|views|body|summary)"\s*:\s*"',text):
        value=text[m.end():];end=re.search(r'(?<!\\)(?:\\\\)*"',value)
        value=value[:end.start()] if end else value
        for trim in range(min(7,len(value))+1):
            try:decoded=json.loads('"'+(value[:-trim] if trim else value)+'"');break
            except (ValueError,TypeError):decoded=''
        if decoded:result.append(decoded)
    return '\n\n'.join(result)

def events(response):
    lines=[]
    for line in response.iter_lines():
        if not line:
            if lines:yield '\n'.join(lines);lines=[]
        elif line.startswith('data:'):lines.append(line[5:].lstrip())
    if lines:yield '\n'.join(lines)
