@echo off
title CreatorFlow
cd /d "%~dp0"

echo Starting CreatorFlow, please wait a moment...
if not exist node_modules (
  echo First time setup, installing the pieces. This runs only once...
  call npm install
)

start "" http://localhost:4321
echo.
echo CreatorFlow is opening in your browser.
echo Keep this window open while you work. Close it when you are done.
echo.
call npm run dev
pause
