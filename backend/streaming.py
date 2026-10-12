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

def without_thoughts(text):
    # Some compatible endpoints embed these tags inside content instead of a
    # separate reasoning channel. An unfinished block must also stay private.
    text=re.sub(r'<(think|analysis|reasoning)\b[^>]*>.*?</\1\s*>','',text,flags=re.I|re.S)
    return re.sub(r'<(?:think|analysis|reasoning)\b[^>]*>.*$','',text,flags=re.I|re.S)

def readable(text):
    text=without_thoughts(text);raw=text.lstrip()
    if not raw.startswith(('{','```json')):return text
    # Decode completed or partial JSON strings for user-facing fields only.
    result=[];containers=[];quoted=False;escaped=False;position=0
    for m in re.finditer(r'"(reply|title|position|audience|style|views|body|summary|cover_brief|keywords|publishing_notes)"\s*:\s*"',text):
        for absolute,char in enumerate(text[position:m.start()],position):
            if quoted:
                if escaped:escaped=False
                elif char=='\\':escaped=True
                elif char=='"':quoted=False
            elif char=='"':quoted=True
            elif char in '{[':
                key=re.search(r'"([A-Za-z_]+)"\s*:\s*$',text[max(0,absolute-96):absolute])
                containers.append(key.group(1) if key else None)
            elif char in '}]' and containers:containers.pop()
        position=m.start()
        # The only nested public schema is the profile's direct fields object.
        # reasoning.body, tool arguments, and deeper objects never enter preview.
        if quoted or containers not in ([None],[None,'fields']):continue
        value=text[m.end():];end=re.search(r'(?<!\\)(?:\\\\)*"',value)
        value=value[:end.start()] if end else value
        for trim in range(min(7,len(value))+1):
            try:decoded=json.loads('"'+(value[:-trim] if trim else value)+'"');break
            except (ValueError,TypeError):decoded=''
        if decoded:result.append(without_thoughts(decoded))
    return '\n\n'.join(result)

def events(response):
    lines=[]
    for line in response.iter_lines():
        if not line:
            if lines:yield '\n'.join(lines);lines=[]
        elif line.startswith('data:'):lines.append(line[5:].lstrip())
    if lines:yield '\n'.join(lines)
