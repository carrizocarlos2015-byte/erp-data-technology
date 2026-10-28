@echo off
title ERP Data Technology - Servidor
color 0A
echo.
echo ============================================
echo   ERP DATA TECHNOLOGY V2.0
echo   Iniciando servidor...
echo ============================================
echo.
cd /d "%~dp0"
echo [OK] Directorio actual: %CD%
echo.
echo [OK] Verificando dependencias...
if not exist "node_modules" (
    echo [!] Instalando node_modules por primera vez...
    call npm install
)
echo.
echo [OK] Iniciando Node.js...
echo.
node server.js
pause