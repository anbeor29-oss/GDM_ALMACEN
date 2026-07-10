# ============================================================================
# GDM_FAC — apagado ordenado
#
# Detiene Backend, Frontend y (opcionalmente) PostgreSQL.
# Cierra también las ventanas de watchdog que abrió start-all.ps1.
# ============================================================================

Write-Host '─────────────────────────────────────────' -ForegroundColor Cyan
Write-Host '  GDM_FAC — detener servicios' -ForegroundColor Cyan
Write-Host '─────────────────────────────────────────' -ForegroundColor Cyan

# ── 1) Matar node (backend + frontend + watchdogs) ─────────────────
$nodes = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodes) {
    Write-Host ('► Deteniendo ' + $nodes.Count + ' proceso(s) node…') -ForegroundColor Yellow
    $nodes | Stop-Process -Force
    Start-Sleep -Seconds 2
    Write-Host '✔ node detenido' -ForegroundColor Green
} else {
    Write-Host '· No hay procesos node corriendo' -ForegroundColor Gray
}

# ── 2) Cerrar las ventanas del watchdog (PowerShell) ───────────────
# Las ventanas de watchdog tienen título "Windows PowerShell" y cwd en el proyecto.
# Filtro por cwd para no matar la ventana del usuario.
$psWindows = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" `
    -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -match 'backend|frontend' -and
        $_.CommandLine -match 'GDM_FAC'
    }
if ($psWindows) {
    Write-Host ('► Cerrando ' + $psWindows.Count + ' ventana(s) watchdog…') -ForegroundColor Yellow
    foreach ($w in $psWindows) {
        try { Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
    Write-Host '✔ Watchdogs cerrados' -ForegroundColor Green
}

# ── 3) PostgreSQL: preguntar (default = mantenerlo arriba) ─────────
$ans = Read-Host '¿Detener también PostgreSQL? (s/N)'
if ($ans -eq 's' -or $ans -eq 'S') {
    Write-Host '► Deteniendo PostgreSQL…' -ForegroundColor Yellow
    & 'C:\pgportable\pgsql\bin\pg_ctl.exe' -D 'C:\pgportable\data' stop -m fast 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Write-Host '✔ PostgreSQL detenido' -ForegroundColor Green
} else {
    Write-Host '· PostgreSQL sigue corriendo' -ForegroundColor Gray
}

Write-Host ''
Write-Host 'Listo.' -ForegroundColor Cyan
