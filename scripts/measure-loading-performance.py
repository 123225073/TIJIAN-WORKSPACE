"""Offline API measurements on a disposable copy; never starts schedulers/providers."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import statistics
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--rounds', type=int, default=7)
args = parser.parse_args()
destination = args.output.resolve().parent / (args.output.stem + '-data')
destination.mkdir(parents=True, exist_ok=False)
os.environ['TIJIAN_DATA'] = str(destination)
# backup() reads the source only, including committed WAL contents if present.
with sqlite3.connect(args.source.resolve().as_uri() + '?mode=ro', uri=True) as source:
    with sqlite3.connect(destination / 'workbench.sqlite') as copy:
        source.backup(copy)
        # No copied credentials, sessions, local directory configuration, or
        # subscription settings are needed to measure the object read path.
        copy.execute('DELETE FROM sessions')
        copy.execute('DELETE FROM config')

from fastapi.testclient import TestClient
from backend import app as backend, gateway, network, store as s

def forbidden(*_args, **_kwargs):
    raise AssertionError('Network/provider access is forbidden during measurement')

network.public_url = forbidden
network.public_target = forbidden
gateway.generate = forbidden
with s.conn() as c:
    owner = c.execute('SELECT owner FROM objects GROUP BY owner ORDER BY COUNT(*) DESC LIMIT 1').fetchone()[0]
    counts = dict(c.execute('SELECT kind,COUNT(*) FROM objects WHERE owner=? GROUP BY kind', (owner,)))
backend.app.dependency_overrides[backend.user] = lambda: {'id': owner, 'role': 'admin', 'name': 'Isolated measurement', 'email': 'test@example.invalid'}
# No context manager: TestClient does NOT run lifespan or filesystem/subscription jobs.
client = TestClient(backend.app, base_url='http://127.0.0.1')

def measure(path):
    times = []
    response = None
    for _ in range(args.rounds):
        start = time.perf_counter()
        response = client.get(path)
        times.append((time.perf_counter() - start) * 1000)
    return {'status': response.status_code, 'bytes': len(response.content),
            'median_ms': round(statistics.median(times), 2), 'max_ms': round(max(times), 2)}

result = {'object_counts': counts, 'rounds': args.rounds,
          'endpoints': {path: measure(path) for path in ['/api/state', '/api/bootstrap', '/api/studio/catalog', '/api/studio/assets', '/api/studio/runs']}}
held = threading.Event()
def hold_lock():
    with s.LOCK:
        held.set()
        time.sleep(.35)
for path in ['/api/state', '/api/bootstrap']:
    thread = threading.Thread(target=hold_lock)
    thread.start()
    held.wait()
    start = time.perf_counter()
    response = client.get(path)
    result.setdefault('background_lock', {})[path] = {'status': response.status_code, 'ms': round((time.perf_counter() - start) * 1000, 2)}
    thread.join()
    held.clear()
client.close()
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
