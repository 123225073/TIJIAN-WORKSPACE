$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonPath = if (Test-Path '.runtime/venv/Scripts/python.exe') { '.runtime/venv/Scripts/python.exe' } else { '.venv/Scripts/python.exe' }
$runName = 'pytest-' + [Guid]::NewGuid().ToString('N')
$env:PYTHONIOENCODING = 'utf-8'
& $pythonPath -m pytest tests -q -p no:cacheprovider --basetemp (Join-Path '.runtime' $runName)
exit $LASTEXITCODE
