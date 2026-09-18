# Windows 10+ desktop target. Universal CRT is provided by the operating system.
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules
root = Path(SPECPATH).parent
a = Analysis([str(root/'backend/run.py')], pathex=[str(root)],
    binaries=[], datas=[(str(root/'vendor/douyin_downloader/LICENSE'),'vendor/douyin_downloader'),(str(root/'vendor/douyin_downloader/SOURCE.md'),'vendor/douyin_downloader'),(str(root/'dist'),'dist'),(str(root/'vendor/Easel/skills'),'vendor/Easel/skills'),(str(root/'vendor/Easel/LICENSE'),'vendor/Easel')],
    hiddenimports=collect_submodules('backend')+['markdown','yaml','uvicorn.logging','uvicorn.loops.auto','uvicorn.protocols.http.auto','uvicorn.lifespan.on'],
    hookspath=[],hooksconfig={},runtime_hooks=[],excludes=['pytest','IPython'],noarchive=False,optimize=0)
a.binaries=[entry for entry in a.binaries if Path(entry[0]).name.lower()!='ucrtbase.dll']
pyz=PYZ(a.pure)
exe=EXE(pyz,a.scripts,[],exclude_binaries=True,name='tijian-service',debug=False,bootloader_ignore_signals=False,strip=False,upx=False,console=True)
coll=COLLECT(exe,a.binaries,a.datas,strip=False,upx=False,name='tijian-service')
