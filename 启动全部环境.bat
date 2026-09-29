@echo off
rem 一键同时启动两个环境（重启电脑后用）：
rem   生产  http://localhost:9100  （npm start，data/kpl.db）
rem   测试  http://localhost:9101  （npm run start:test，data/kpl-test.db）
rem 两个窗口各自独立，关闭某个窗口=只停对应环境
cd /d %~dp0
start "KPL-BP 数据服务（生产 9100，关闭此窗口=停止生产）" cmd /k npm start
start "KPL-BP 测试服务（测试 9101，关闭此窗口=停止测试环境）" cmd /k npm run start:test
timeout /t 3 >nul
start "" http://localhost:9100
start "" http://localhost:9101
