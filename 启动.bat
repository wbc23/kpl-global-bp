@echo off
rem KPL BP 数据平台一键启动：启动数据服务并打开浏览器
cd /d %~dp0
start "KPL-BP 数据服务（关闭此窗口=停止服务）" cmd /k npm start
timeout /t 2 >nul
start "" http://localhost:9100
