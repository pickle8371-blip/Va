@echo off
rem SAMURAI: The Endless Plains - Windows launcher.
rem Installs dependencies on first run, then starts the local dev server and opens the browser.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Download the LTS installer from https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
echo Starting the game at http://localhost:5173 - keep this window open while playing.
call npm start
