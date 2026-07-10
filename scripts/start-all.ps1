# ============================================================================
# GDM_FAC — arranque completo con watchdog
#
# Levanta los 3 servicios (PostgreSQL, Backend, Frontend) en ventanas
# de PowerShell separadas, con auto-reinicio si alguno cae.
#
# Uso:
#   Ejecutar en PowerShell:  .\scripts\start-all.ps1
#   Para detener:            .\scripts\stop-all.ps1
#
# Los logs de cada servicio van a scripts\logs\<servicio>.log
# ============================================================================

$root = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $root 'scripts\logs'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

Write-Host "─────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  GDM_FAC — arranque completo con watchdog" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────" -ForegroundColor Cyan

# ── 1) PostgreSQL ──────────────────────────────────────────────────
$pgReady = & 'C:\pgportable\pgsql\bin\pg_isready.exe' -h localhost -p 5432 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host '► Iniciando PostgreSQL…' -ForegroundColor Yellow
    Start-Process -FilePath 'C:\pgportable\pgsql\bin\pg_ctl.exe' `
        -ArgumentList '-D','C:\pgportable\data','-l','C:\pgportable\log.txt','start' `
        -WindowStyle Hidden -Wait
    Start-Sleep -Seconds 6
    & 'C:\pgportable\pgsql\bin\pg_isready.exe' -h localhost -p 5432 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Error 'PostgreSQL no arrancó'; exit 1 }
}
Write-Host '✔ PostgreSQL corriendo (localhost:5432)' -ForegroundColor Green

# ── 2) Backend con watchdog ───────────────────────────────────────
$beScript = @"
`$ErrorActionPreference = 'Continue'
`$env:PATH = '$env:PATH'
Set-Location '$root\backend'
while (`$true) {
    Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] Backend: iniciando…') -ForegroundColor Yellow
    npm run dev 2>&1 | Tee-Object -FilePath '$logsDir\backend.log' -Append
    `$exit = `$LASTEXITCODE
    Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] Backend cayó (exit=' + `$exit + '). Re-arrancando en 5s…') -ForegroundColor Red
    Start-Sleep -Seconds 5
}
"@
Start-Process powershell.exe -ArgumentList '-NoExit','-Command',$beScript `
    -WorkingDirectory (Join-Path $root 'backend') `
    -WindowStyle Normal
Write-Host '✔ Backend arrancado (http://localhost:3000)' -ForegroundColor Green

# ── 3) Frontend con watchdog ──────────────────────────────────────
$feScript = @"
`$ErrorActionPreference = 'Continue'
`$env:PATH = '$env:PATH'
Set-Location '$root\frontend'
while (`$true) {
    Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] Frontend: iniciando…') -ForegroundColor Yellow
    npm run dev 2>&1 | Tee-Object -FilePath '$logsDir\frontend.log' -Append
    `$exit = `$LASTEXITCODE
    Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] Frontend cayó (exit=' + `$exit + '). Re-arrancando en 5s…') -ForegroundColor Red
    Start-Sleep -Seconds 5
}
"@
Start-Process powershell.exe -ArgumentList '-NoExit','-Command',$feScript `
    -WorkingDirectory (Join-Path $root 'frontend') `
    -WindowStyle Normal
Write-Host '✔ Frontend arrancado (http://localhost:5173)' -ForegroundColor Green

Write-Host ''
Write-Host 'Los 3 servicios están corriendo. Puedes cerrar esta ventana.' -ForegroundColor Cyan
Write-Host 'Si un servicio se cae, su ventana lo reinicia automáticamente en 5s.' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Para verificar en cualquier momento:' -ForegroundColor Gray
Write-Host '  curl http://localhost:3000/health' -ForegroundColor Gray
Write-Host '  curl http://localhost:5173' -ForegroundColor Gray
Write-Host ''
Write-Host 'Para DETENER TODO:  .\scripts\stop-all.ps1' -ForegroundColor Gray
