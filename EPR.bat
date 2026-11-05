@echo off
setlocal EnableExtensions
chcp 65001 >nul
title ERP Data Technology - Servidor
color 0A
cd /d "%~dp0"

echo.
echo ============================================
echo   ERP DATA TECHNOLOGY V2.0
echo   Iniciando servidor...
echo ============================================
echo.
echo [OK] Directorio: %CD%
echo.

REM ---------- 1) Node.js instalado ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] No se encontro Node.js en el PATH.
    echo         Instalalo desde https://nodejs.org y volve a ejecutar este archivo.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo [OK] Node.js %NODEVER%

REM ---------- 2) Archivo .env ----------
if not exist ".env" (
    echo [ERROR] Falta el archivo .env con la conexion a la base de datos.
    echo         Pedile una copia a quien administra el sistema.
    echo.
    pause
    exit /b 1
)
echo [OK] Archivo .env encontrado

REM ---------- 3) Puerto configurado (lee .env, por defecto 3000) ----------
set "PUERTO=3000"
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="PORT" set "PUERTO=%%b"
)
echo [OK] Puerto: %PUERTO%

REM ---------- 4) Dependencias ----------
if not exist "node_modules\express" (
    echo [!] Faltan dependencias. Ejecutando npm install...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Fallo la instalacion de dependencias.
        echo         Revisa tu conexion a internet y volve a intentar.
        echo.
        pause
        exit /b 1
    )
)
echo [OK] Dependencias instaladas
echo.

REM ---------- 5) Puerto ocupado ----------
set "PIDPUERTO="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PUERTO% .*LISTENING"') do (
    if not defined PIDPUERTO set "PIDPUERTO=%%p"
)

if defined PIDPUERTO (
    echo [!] El puerto %PUERTO% ya esta en uso por el proceso PID %PIDPUERTO%.
    echo     Probablemente ya hay otra instancia del ERP abierta.
    echo.
    choice /C SN /N /M "  Cerrar esa instancia y reiniciar el servidor? [S]i / [N]o, solo abrir el navegador: "
    if errorlevel 2 (
        echo.
        echo Abriendo http://localhost:%PUERTO% ...
        start "" "http://localhost:%PUERTO%"
        ping -n 3 127.0.0.1 >nul
        exit /b 0
    )
    echo.
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PUERTO% .*LISTENING"') do (
        echo Cerrando proceso %%p...
        taskkill /PID %%p /F >nul 2>nul
    )
    ping -n 2 127.0.0.1 >nul
    set "SIGUE="
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PUERTO% .*LISTENING"') do set "SIGUE=1"
    if defined SIGUE (
        echo [ERROR] El puerto %PUERTO% sigue ocupado.
        echo         Cerralo manualmente con el Administrador de tareas.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Puerto %PUERTO% liberado
)

REM ---------- 6) Iniciar servidor ----------
echo.
echo [OK] Iniciando servidor en http://localhost:%PUERTO%
echo      Para detenerlo: Ctrl+C o cerra esta ventana.
echo.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PUERTO%'"

node server.js
set "CODIGO=%errorlevel%"

echo.
if "%CODIGO%"=="0" (
    echo [OK] Servidor detenido.
) else (
    echo [ERROR] El servidor se detuvo con codigo %CODIGO%.
    echo         Copia el mensaje de arriba para poder diagnosticarlo.
)
echo.
pause
exit /b %CODIGO%
