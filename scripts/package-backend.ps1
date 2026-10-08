$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$outputPath = [IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime/backend-dist'))
if (-not $outputPath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid output path' }
$pythonPath = if (Test-Path '.runtime/venv/Scripts/python.exe') { '.runtime/venv/Scripts/python.exe' } else { '.venv/Scripts/python.exe' }
$env:PYTHONUSERBASE = Join-Path $projectRoot '.runtime/python-user'
$env:PYINSTALLER_CONFIG_DIR = Join-Path $projectRoot '.runtime/pyinstaller-cache'
& $pythonPath scripts/package-frontend.py
if ($LASTEXITCODE -ne 0) { throw '前端资源打包失败' }
$env:PYTHONIOENCODING = 'utf-8'
& $pythonPath -m PyInstaller --noconfirm --distpath $outputPath --workpath .runtime/pyinstaller scripts/tijian-service.spec
if ($LASTEXITCODE -ne 0) { throw '服务打包失败' }
