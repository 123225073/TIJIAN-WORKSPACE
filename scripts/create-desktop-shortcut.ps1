$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$target = Join-Path $projectRoot "release/$version/win-unpacked/梯见工作台.exe"
if (-not (Test-Path -LiteralPath $target)) { throw '请先生成对应版本桌面包' }
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop '梯见工作台.lnk'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $link) {
    $old = $shell.CreateShortcut($link)
    if (-not $old.TargetPath.StartsWith($projectRoot,[StringComparison]::OrdinalIgnoreCase)) { throw '同名快捷方式属于其他程序，未覆盖' }
}
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = Split-Path -Parent $target
$shortcut.IconLocation = "$target,0"
$shortcut.Description = '梯见 · 电梯行业个人工作台'
$shortcut.Save()
$verified = $shell.CreateShortcut($link)
if ($verified.TargetPath -ne $target) { throw '快捷方式校验失败' }
Write-Output $link
