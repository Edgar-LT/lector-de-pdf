@echo off
title VoxPDF Studio - Conversor de PDF a Audiolibro
cd /d "%~dp0"

echo ========================================================
echo   VoxPDF Studio - Portafolio de Ingenieria y Software
echo   Iniciando servidor Python + Motor Neuronal edge-tts...
echo ========================================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] No se encontro el entorno virtual .venv.
    pause
    exit /b 1
)

start "" http://127.0.0.1:8000
".venv\Scripts\python.exe" -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
pause
