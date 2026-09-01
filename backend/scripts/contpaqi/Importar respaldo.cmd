@echo off
title Importar respaldo a NEXO
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0importar-respaldo.ps1"
if errorlevel 1 pause
