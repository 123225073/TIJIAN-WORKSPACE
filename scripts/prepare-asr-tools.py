"""Prepare pinned Windows whisper.cpp files for offline subtitle recognition.

Only public upstream files are downloaded. The script does not use API keys.
The output is a private project build cache, not a global installation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip'
ARCHIVE_HASH = '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin'
MODEL_HASH = 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb'
MODEL_NAME = 'ggml-small-q5_1.bin'
LICENSE = '''MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
'''


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def obtain(url, expected, destination, maximum):
    if destination.is_file() and sha256(destination) == expected:
        print('使用已校验缓存：' + destination.name)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Download separately: never treat an interrupted file as a valid cache.
    fd, name = tempfile.mkstemp(prefix=destination.name + '.', suffix='.part', dir=destination.parent)
    temp = Path(name)
    try:
        print('正在下载：' + destination.name)
        request = urllib.request.Request(url, headers={'User-Agent': 'Tijian-workbench-build/1.0'})
        with os.fdopen(fd, 'wb') as target, urllib.request.urlopen(request, timeout=120) as source:
            total = 0
            while chunk := source.read(1024 * 1024):
                total += len(chunk)
                if total > maximum:
                    raise ValueError('下载文件超过预期大小')
                target.write(chunk)
        if sha256(temp) != expected:
            raise ValueError('下载文件的 SHA256 校验失败')
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)


def extract_binary(archive, output):
    # Never call extract/extractall: only flatten known, explicitly named files.
    with zipfile.ZipFile(archive) as bundle:
        seen = set()
        for item in bundle.infolist():
            p = PurePosixPath(item.filename)
            if ('\\' in item.filename or p.is_absolute() or '..' in p.parts
                    or ':' in item.filename or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError('压缩包中存在不安全路径')
            if item.filename.lower() in seen:
                raise ValueError('压缩包包含重复文件')
            seen.add(item.filename.lower())
        selected = [x for x in bundle.infolist() if x.filename == 'Release/whisper-cli.exe'
                    or (x.filename.startswith('Release/') and len(PurePosixPath(x.filename).parts) == 2
                        and x.filename.lower().endswith('.dll'))]
        if not any(x.filename == 'Release/whisper-cli.exe' for x in selected) or not selected:
            raise ValueError('压缩包缺少识别程序')
        if sum(x.file_size for x in selected) > 100 * 1024 * 1024:
            raise ValueError('压缩包文件超过预期大小')
        output.mkdir(parents=True, exist_ok=True)
        for item in selected:
            target = output / PurePosixPath(item.filename).name
            with bundle.open(item) as source, target.open('wb') as dest:
                shutil.copyfileobj(source, dest)


def main():
    parser = argparse.ArgumentParser(description='下载并校验本地字幕识别组件')
    parser.add_argument('--cache-dir', type=Path, default=ROOT / '.runtime' / 'asr-download')
    parser.add_argument('--output-dir', type=Path, default=ROOT / '.runtime' / 'asr-tools')
    args = parser.parse_args()
    archive = args.cache_dir / 'whisper-b5454-x64.zip'
    model = args.cache_dir / MODEL_NAME
    obtain(ARCHIVE_URL, ARCHIVE_HASH, archive, 100 * 1024 * 1024)
    existing_model = args.output_dir / MODEL_NAME
    if existing_model.is_file() and sha256(existing_model) == MODEL_HASH:
        model = existing_model
        print('使用已校验的现有模型：' + MODEL_NAME)
    else:
        obtain(MODEL_URL, MODEL_HASH, model, 500 * 1024 * 1024)
    # Verify again before any extraction or copying, including cached files.
    if sha256(archive) != ARCHIVE_HASH or sha256(model) != MODEL_HASH:
        raise ValueError('组件校验失败，已停止准备')
    extract_binary(archive, args.output_dir)
    destination = args.output_dir / MODEL_NAME
    if not destination.exists() or sha256(destination) != MODEL_HASH:
        with tempfile.NamedTemporaryFile(dir=args.output_dir, prefix='model-', suffix='.part', delete=False) as f:
            temp = Path(f.name)
            try:
                with model.open('rb') as src:
                    shutil.copyfileobj(src, f)
            except BaseException:
                temp.unlink(missing_ok=True)
                raise
        try:
            if sha256(temp) != MODEL_HASH:
                raise ValueError('模型复制校验失败')
            os.replace(temp, destination)
        finally:
            temp.unlink(missing_ok=True)
    (args.output_dir / 'LICENSE').write_text(LICENSE, encoding='utf-8')
    (args.output_dir / 'LICENSE-openai-whisper').write_text(
        LICENSE.replace('Copyright (c) 2023-2026 The ggml authors', 'Copyright (c) 2022 OpenAI'), encoding='utf-8')
    info = {'whisper_cpp': {'url': ARCHIVE_URL, 'sha256': ARCHIVE_HASH, 'version': 'b5454',
                            'license': 'MIT', 'license_source': 'https://github.com/ggml-org/whisper.cpp/blob/b5454/LICENSE'},
            'model': {'url': MODEL_URL, 'sha256': MODEL_HASH, 'license': 'MIT',
                      'license_source': 'https://huggingface.co/ggerganov/whisper.cpp/blob/main/README.md',
                      'original_model': 'https://github.com/openai/whisper',
                      'original_license': 'https://github.com/openai/whisper/blob/main/LICENSE'}}
    (args.output_dir / 'SOURCE.json').write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding='utf-8')
    print('本地字幕识别组件已校验并准备完成：' + str(args.output_dir))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        # Network exceptions may include URLs; do not expose them or credentials.
        print('组件准备失败：请检查网络连接、可用空间和 SHA256 校验。')
        raise SystemExit(1) from None
