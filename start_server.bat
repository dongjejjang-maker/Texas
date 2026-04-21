@echo off
title Texas Holdem - START
echo ==========================================
echo [L.D.J Holdem] 서버를 가동합니다.
echo ==========================================

echo 1. 이전 프로세스 정리...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im ngrok.exe >nul 2>&1

timeout /t 1 /nobreak >nul

echo 2. 게임 서버 실행 중...
start /b node server.js

echo 3. 외부 접속 터널 열기...
start "" ngrok http 3000 --domain=sphere-tinsmith-thickness.ngrok-free.dev

echo ==========================================
echo 가동 완료! 주소: https://sphere-tinsmith-thickness.ngrok-free.dev
echo 이 창은 닫으셔도 서버는 백그라운드에서 돌아갑니다.
echo ==========================================
timeout /t 5
exit
