@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js，或在已有 Node.js 的终端运行 npm run dev。
  pause
  exit /b 1
)
if not exist "data\world-manifest.json" (
  echo 地图数据尚未生成，请先查看 README.md 中的数据准备步骤。
  pause
  exit /b 1
)
node -e "fetch('http://127.0.0.1:4173',{signal:AbortSignal.timeout(1500)}).then(async r=>process.exit(r.ok && (await r.text()).includes('CHANGSHA, ON FOOT') ? 0 : 1)).catch(()=>process.exit(1))" >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:4173"
  exit /b 0
)
start "" "http://127.0.0.1:4173"
node scripts\serve.mjs
pause
