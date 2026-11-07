@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo ============================================
echo   易校圈 · 本地预览启动器
echo ============================================

REM ---- 1) 定位 node（PATH 里没有就用自带运行时）----
set "NODE_BIN="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_BIN set "NODE_BIN=%%i"
if not defined NODE_BIN (
  if exist "C:\Users\Nanachi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE_BIN=C:\Users\Nanachi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  )
)
if not defined NODE_BIN (
  echo [错误] 找不到 node，请先安装 Node.js 18+
  pause
  exit /b 1
)
echo [1/4] node = %NODE_BIN%

REM ---- 2) 释放 3000 端口（只结束监听该端口的进程）----
echo [2/4] 检查端口 3000 ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":3000 " ^| findstr /c:"LISTENING"') do (
  echo       端口被 PID %%p 占用，自动结束它
  taskkill /f /pid %%p >nul 2>nul
)
timeout /t 1 >nul

REM ---- 3) 启动服务（独立窗口，关闭该窗口即停止服务）----
echo [3/4] 启动服务 ...
start "yxx-server" /D "%~dp0" "%NODE_BIN%" server\app.js

REM ---- 4) 等端口就绪后打开默认浏览器 ----
echo [4/4] 等待服务就绪并打开浏览器 ...
timeout /t 3 >nul
start "" "http://localhost:3000/index.html"

echo.
echo 页面地址：http://localhost:3000/index.html
echo 修改 frontend 下的文件会自动刷新浏览器；改 server 代码请重启服务。
echo 关闭标题为 yxx-server 的窗口即可停止服务。
echo.
pause
