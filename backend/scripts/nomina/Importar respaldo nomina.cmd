@echo off
title Respaldo de nomina -> paquete para NEXO
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0importar-respaldo-nomina.ps1"
if errorlevel 1 pause
