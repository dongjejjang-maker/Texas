@echo off
title Texas Holdem Server Restarter
echo ==========================================
echo [L.D.J Holdem] 서버를 재시작합니다...
echo ==========================================

echo 1. 기존 프로세스 종료 중...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im ngrok.exe >nul 2>&1

timeout /t 2 /nobreak >nul

echo 2. 서버 가동 시작...
start /b node server.js

echo 3. ngrok 터널 가동 시작...
echo (주소: https://sphere-tinsmith-thickness.ngrok-free.dev)
start "" ngrok http 3000 --domain=sphere-tinsmith-thickness.ngrok-free.dev

echo ==========================================
echo 완료! 이제 브라우저에서 접속하세요.
echo ==========================================
pause
