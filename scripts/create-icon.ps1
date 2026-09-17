$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot 'build'
[IO.Directory]::CreateDirectory($outputDir) | Out-Null
$bitmap = New-Object Drawing.Bitmap(256,256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.ColorTranslator]::FromHtml('#1c3036'))
$pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#c5c6a4'),5)
$graphics.DrawRectangle($pen,64,38,128,180)
$graphics.DrawLine($pen,76,61,180,61)
$graphics.DrawLine($pen,121,79,121,200)
$graphics.DrawLine($pen,136,79,136,200)
$gold = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#bd9f72'))
$graphics.FillRectangle($gold,104,129,6,15)
$bitmap.Save((Join-Path $outputDir 'tijian.png'),[Drawing.Imaging.ImageFormat]::Png)
$icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [IO.File]::Create((Join-Path $outputDir 'tijian.ico'))
$icon.Save($stream)
$stream.Dispose();$icon.Dispose();$gold.Dispose();$pen.Dispose();$graphics.Dispose();$bitmap.Dispose()
