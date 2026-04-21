@echo off
title Texas Holdem - STOP
echo ==========================================
echo [L.D.J Holdem] 서버를 종료합니다...
echo ==========================================

taskkill /f /im node.exe >nul 2>&1
taskkill /f /im ngrok.exe >nul 2>&1

echo 서버와 접속 터널이 모두 성공적으로 닫혔습니다.
echo ==========================================
pause
exit
