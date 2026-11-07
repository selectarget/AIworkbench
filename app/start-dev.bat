@echo off
title AI创作工作台 (开发模式)
cd /d "%~dp0"
if not exist "node_modules\.bin\electron-vite.cmd" (
  echo Dependencies are missing. Run npm ci in the app directory first.
  pause
  exit /b 1
)
echo 正在启动 AI创作工作台 开发版...
call npm run dev
if errorlevel 1 pause
