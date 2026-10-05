$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$product = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).build.productName
$target = Join-Path $env:LOCALAPPDATA ('Programs/elevator-workbench/' + $product + '.exe')
if (-not (Test-Path -LiteralPath $target)) { throw '请先安装对应版本桌面包' }
if (-not (Get-Item -LiteralPath $target).VersionInfo.ProductVersion.StartsWith($version)) { throw '已安装程序版本与项目版本不一致' }
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop ($product + '.lnk')
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $link) {
    $old = $shell.CreateShortcut($link)
    if (-not ($old.TargetPath.StartsWith($projectRoot,[StringComparison]::OrdinalIgnoreCase) -or $old.TargetPath.Equals($target,[StringComparison]::OrdinalIgnoreCase))) { throw '同名快捷方式属于其他程序，未覆盖' }
}
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = Split-Path -Parent $target
$shortcut.IconLocation = "$target,0"
$shortcut.Description = '梯世界 · 电梯行业 AI 内容工作台'
$shortcut.Save()
$verified = $shell.CreateShortcut($link)
if ($verified.TargetPath -ne $target) { throw '快捷方式校验失败' }
$legacy = Join-Path $desktop '梯见工作台.lnk'
if (Test-Path -LiteralPath $legacy) {
    $previous = $shell.CreateShortcut($legacy)
    $previousInstalled = Join-Path $env:LOCALAPPDATA 'Programs/elevator-workbench/梯见工作台.exe'
    if ($previous.TargetPath.Equals($previousInstalled,[StringComparison]::OrdinalIgnoreCase) -or $previous.TargetPath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
        $backupRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime/shortcut-backups'))
        if (-not $backupRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw '快捷方式备份目录无效' }
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        Move-Item -LiteralPath $legacy -Destination (Join-Path $backupRoot ('梯见工作台-' + [Guid]::NewGuid().ToString('N') + '.lnk'))
    }
}
Write-Output $link
