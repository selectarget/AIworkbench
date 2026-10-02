@echo off
setlocal
cd /d "%~dp0app"
if not exist "node_modules\.bin\electron-vite.cmd" (
  echo Dependencies are missing. Run npm ci in the app directory first.
  pause
  exit /b 1
)
call "node_modules\.bin\electron-vite.cmd" dev
if errorlevel 1 pause
