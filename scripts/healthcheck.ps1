# Ver estado rápido de los 3 servicios. Uso: .\scripts\healthcheck.ps1
Write-Host ''
Write-Host '─── GDM_FAC · Estado de servicios ───' -ForegroundColor Cyan

# PostgreSQL
$pgOK = $false
& 'C:\pgportable\pgsql\bin\pg_isready.exe' -h localhost -p 5432 -q 2>$null
if ($LASTEXITCODE -eq 0) { $pgOK = $true }
if ($pgOK) {
    Write-Host '  ✔ PostgreSQL  (localhost:5432)' -ForegroundColor Green
} else {
    Write-Host '  ✘ PostgreSQL  NO RESPONDE' -ForegroundColor Red
}

# Backend
try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3000/health' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Host ('  ✔ Backend     (http://localhost:3000) status=' + $r.StatusCode) -ForegroundColor Green
} catch {
    Write-Host '  ✘ Backend     NO RESPONDE' -ForegroundColor Red
}

# Frontend
try {
    $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Host ('  ✔ Frontend    (http://localhost:5173) status=' + $r.StatusCode) -ForegroundColor Green
} catch {
    Write-Host '  ✘ Frontend    NO RESPONDE' -ForegroundColor Red
}

# Balance SW Sapien
try {
    $login = Invoke-RestMethod -Uri 'http://localhost:3000/api/v1/auth/login' `
        -Method Post -ContentType 'application/json' `
        -Body '{"email":"manager@demo.com","password":"admin123"}' -TimeoutSec 5
    $bal = Invoke-RestMethod -Uri 'http://localhost:3000/api/v1/pac/account-status' `
        -Headers @{Authorization="Bearer $($login.data.token)"} -TimeoutSec 8
    $env = if ($bal.data.is_test_mode) { 'SANDBOX' } else { 'PRODUCCION' }
    Write-Host ('  ✔ SW Sapien   ' + $env + ' · ' + $bal.data.timbres_disponibles + ' timbres disponibles') -ForegroundColor Green
} catch {
    Write-Host '  · SW Sapien   (no verificable — backend no disponible)' -ForegroundColor Gray
}

Write-Host ''
