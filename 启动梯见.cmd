@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "release\0.13.0\win-unpacked\梯见工作台.exe" (
  start "" "release\0.13.0\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.9.1\win-unpacked\梯见工作台.exe" (
  start "" "release\0.9.1\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.9.0\win-unpacked\梯见工作台.exe" (
  start "" "release\0.9.0\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.8.0\win-unpacked\梯见工作台.exe" (
  start "" "release\0.8.0\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.6.0\win-unpacked\梯见工作台.exe" (
  start "" "release\0.6.0\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.5.4\win-unpacked\梯见工作台.exe" (
  start "" "release\0.5.4\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.5.3\win-unpacked\梯见工作台.exe" (
  start "" "release\0.5.3\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.5.2\win-unpacked\梯见工作台.exe" (
  start "" "release\0.5.2\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.5.1\win-unpacked\梯见工作台.exe" (
  start "" "release\0.5.1\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.5.0\win-unpacked\梯见工作台.exe" (
  start "" "release\0.5.0\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.4.3\win-unpacked\梯见工作台.exe" (
  start "" "release\0.4.3\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.4.2\win-unpacked\梯见工作台.exe" (
  start "" "release\0.4.2\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.4.1\win-unpacked\梯见工作台.exe" (
  start "" "release\0.4.1\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.4.0\win-unpacked\梯见工作台.exe" (
  start "" "release\0.4.0\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.3.0\win-unpacked\梯见工作台.exe" (
  start "" "release\0.3.0\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.2.1\win-unpacked\梯见工作台.exe" (
  start "" "release\0.2.1\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.2.0\win-unpacked\梯见工作台.exe" (
  start "" "release\0.2.0\win-unpacked\梯见工作台.exe"
  exit /b
)
if exist "release\0.1.3\win-unpacked\*.exe" (
  for %%F in ("release\0.1.3\win-unpacked\*.exe") do start "" "%%~fF"
  exit /b
)
if exist "release\0.1.2\win-unpacked\*.exe" (
  for %%F in ("release\0.1.2\win-unpacked\*.exe") do start "" "%%~fF"
  exit /b
)
if exist "release\0.1.1\win-unpacked\*.exe" (
  for %%F in ("release\0.1.1\win-unpacked\*.exe") do start "" "%%~fF"
  exit /b
)
if exist "release\win-unpacked\*.exe" (
  for %%F in ("release\win-unpacked\*.exe") do start "" "%%~fF"
  exit /b
)
start "" "node_modules\electron\dist\electron.exe" .
