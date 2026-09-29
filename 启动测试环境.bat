@echo off
rem KPL BP 数据平台测试环境：端口 9101、独立数据库（data/kpl-test.db）、独立构建（dist-test）
rem 与生产（9100 / data/kpl.db / dist）完全隔离，测试确认后再同步（见 README「测试环境与同步」）
cd /d %~dp0
start "KPL-BP 测试服务（关闭此窗口=停止测试环境）" cmd /k npm run start:test
timeout /t 2 >nul
start "" http://localhost:9101
