<#
  importar-respaldo.ps1 — De un respaldo .bak de CONTPAQi a NEXO, en UN comando.

  Hace todo en la PC (donde sí hay SQL Server) y sube el resultado a NEXO:
    restaura el .bak  →  extrae  →  PREVIO (conteos)  →  login  →  busca la
    empresa por RFC  →  cambia a ella  →  importa.

  Uso típico:
    .\importar-respaldo.ps1 -Bak "C:\ruta\respaldo.bak" -Nexo "https://mi-nexo.onrender.com" -Email "yo@correo.com"
  (pide la contraseña sin mostrarla). Sólo el previo, sin subir:  agrega -DryRun.

  REUTILIZABLE para cualquier cliente: apunta solo a la empresa cuyo RFC coincide
  con el del respaldo; si no existe en NEXO, avisa (créala primero).
#>
param(
  [Parameter(Mandatory = $true)][string]$Bak,
  [string]$Nexo = $env:NEXO_URL,
  [string]$Email,
  [string]$Token,
  [string]$Server = '.\SQLEXPRESS',
  [string]$WorkDir = 'E:\ContpaqMig',
  [switch]$DryRun,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$sc = 'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE'
if (-not (Test-Path $sc)) { $sc = 'sqlcmd' }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path $Bak)) { throw "No existe el respaldo: $Bak" }
if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir | Out-Null }
$svcAcct = try { (Get-CimInstance Win32_Service -Filter "Name='MSSQL`$SQLEXPRESS'").StartName } catch { 'NT SERVICE\MSSQL$SQLEXPRESS' }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$db = "NEXO_IMP_$stamp"
$bakLocal = Join-Path $WorkDir "$db.bak"
$export = Join-Path $WorkDir "export_$stamp"

function Sql($q) { & $sc -S $Server -E -b -Q "SET NOCOUNT ON; $q" }

Write-Host "== 1/6  Copiando y restaurando el respaldo ==" -ForegroundColor Cyan
Copy-Item $Bak $bakLocal -Force
icacls $WorkDir /grant "${svcAcct}:(OI)(CI)(M)" 2>&1 | Out-Null

# Nombres lógicos del .bak (varían por empresa) para el MOVE.
$fl = & $sc -S $Server -E -W -s"|" -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$bakLocal';"
$dataLn = $null; $logLn = $null
foreach ($line in $fl) {
  $p = $line -split '\|'
  if ($p.Count -ge 3) { if ($p[2].Trim() -eq 'D') { $dataLn = $p[0].Trim() } elseif ($p[2].Trim() -eq 'L') { $logLn = $p[0].Trim() } }
}
if (-not $dataLn -or -not $logLn) { throw "No se pudieron leer los nombres lógicos del .bak." }

Sql @"
IF DB_ID('$db') IS NOT NULL BEGIN ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db]; END;
RESTORE DATABASE [$db] FROM DISK = N'$bakLocal'
WITH MOVE '$dataLn' TO N'$WorkDir\$db.mdf', MOVE '$logLn' TO N'$WorkDir\$db._log.ldf', REPLACE, RECOVERY;
"@ | Out-Null

function Limpiar {
  try { Sql "IF DB_ID('$db') IS NOT NULL BEGIN ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db]; END;" | Out-Null } catch {}
  Remove-Item $bakLocal -ErrorAction SilentlyContinue
}

try {
  Write-Host "== 2/6  Extrayendo el paquete ==" -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File (Join-Path $here 'extraer-contpaqi.ps1') -Db $db -Server $Server -Out $export | Out-Null

  Write-Host "== 3/6  PREVIO de lo que se va a importar ==" -ForegroundColor Cyan
  $rd = { param($n) $f = Join-Path $export "$n.json"; if (Test-Path $f) { (Get-Content $f -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json } else { @() } }
  $empresa = & $rd 'empresa'; $cuentas = & $rd 'cuentas'; $pol = & $rd 'polizas'; $mov = & $rd 'movimientos'; $cfdi = & $rd 'cfdi'; $pc = & $rd 'poliza_cfdi'
  $rfcBak = if ($empresa) { $empresa[0].rfc } else { '(desconocido)' }
  $nomBak = if ($empresa) { $empresa[0].nombre } else { '' }
  $car = ($mov | Where-Object { $_.tm -eq 0 } | Measure-Object importe -Sum).Sum
  $ab  = ($mov | Where-Object { $_.tm -eq 1 } | Measure-Object importe -Sum).Sum
  $ejercicios = ($pol | Select-Object -ExpandProperty ejercicio -Unique | Sort-Object) -join ', '
  Write-Host ""
  Write-Host "  Empresa   : $nomBak  ·  RFC $rfcBak" -ForegroundColor Yellow
  Write-Host ("  Ejercicios: {0}" -f $ejercicios)
  Write-Host ("  Cuentas   : {0}" -f $cuentas.Count)
  Write-Host ("  Pólizas   : {0}" -f $pol.Count)
  Write-Host ("  Movimtos  : {0}   (cargos {1:N2} = abonos {2:N2}  dif {3:N2})" -f $mov.Count, $car, $ab, ($car - $ab))
  Write-Host ("  CFDI      : {0}   ·  ligas póliza-UUID: {1}" -f $cfdi.Count, $pc.Count)
  Write-Host ""

  if ($DryRun) { Write-Host "-DryRun: sólo previo, no se subió nada." -ForegroundColor Green; return }

  Write-Host "== 4/6  Entrando a NEXO ==" -ForegroundColor Cyan
  if (-not $Nexo) { throw "Falta -Nexo (URL de tu NEXO). Ej: -Nexo https://mi-nexo.onrender.com" }
  $api = $Nexo.TrimEnd('/') + '/api/v1'
  if (-not $Token) {
    if (-not $Email) { $Email = Read-Host "Correo de NEXO" }
    $sec = Read-Host "Contraseña" -AsSecureString
    $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    $login = Invoke-RestMethod -Uri "$api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = $Email; password = $pass } | ConvertTo-Json)
    $Token = $login.data.token
  }
  $h = @{ Authorization = "Bearer $Token" }

  Write-Host "== 5/6  Buscando la empresa por RFC ==" -ForegroundColor Cyan
  $emps = (Invoke-RestMethod -Uri "$api/auth/companies" -Headers $h -Method Get).data
  $target = $emps | Where-Object { $_.rfc -and ($_.rfc.ToUpper() -eq ("" + $rfcBak).ToUpper()) } | Select-Object -First 1
  if (-not $target) {
    Write-Host "  No hay empresa en NEXO con RFC $rfcBak." -ForegroundColor Red
    Write-Host "  Empresas disponibles:" ; $emps | ForEach-Object { Write-Host ("    {0}  {1}" -f $_.rfc, $_.business_name) }
    throw "Crea primero la empresa con RFC $rfcBak en NEXO (o revisa el RFC capturado)."
  }
  $sw = Invoke-RestMethod -Uri "$api/auth/switch-company" -Headers $h -Method Post -ContentType 'application/json' -Body (@{ companyId = $target.id } | ConvertTo-Json)
  if ($sw.data.token) { $Token = $sw.data.token; $h = @{ Authorization = "Bearer $Token" } }
  Write-Host ("  Empresa activa: {0} ({1})" -f $target.business_name, $target.rfc) -ForegroundColor Green

  Write-Host "== 6/6  Subiendo e importando ==" -ForegroundColor Cyan
  $boundary = [Guid]::NewGuid().ToString(); $LF = "`r`n"; $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("--$boundary$LF"); [void]$sb.Append("Content-Disposition: form-data; name=`"forzar`"$LF$LF"); [void]$sb.Append("$([bool]$Force)".ToLower() + $LF)
  foreach ($n in @('empresa','cuentas','polizas','movimientos','poliza_cfdi','cfdi','saldos')) {
    $fp = Join-Path $export "$n.json"; if (-not (Test-Path $fp)) { continue }
    $content = [IO.File]::ReadAllText($fp)
    [void]$sb.Append("--$boundary$LF")
    [void]$sb.Append("Content-Disposition: form-data; name=`"$n`"; filename=`"$n.json`"$LF")
    [void]$sb.Append("Content-Type: application/json$LF$LF"); [void]$sb.Append($content + $LF)
  }
  [void]$sb.Append("--$boundary--$LF")
  $bytes = [Text.Encoding]::UTF8.GetBytes($sb.ToString())
  $r = Invoke-RestMethod -Uri "$api/accounting/contpaqi/importar" -Method Post -Headers $h -ContentType "multipart/form-data; boundary=$boundary" -Body $bytes -TimeoutSec 1800
  $d = $r.data
  Write-Host ""
  Write-Host "== RESULTADO ==" -ForegroundColor Green
  $match = if ($d.rfc.coincide) { 'coinciden' } else { 'FORZADO' }
  Write-Host ("  RFC: respaldo {0} vs empresa {1} - {2}" -f $d.rfc.respaldo, $d.rfc.empresaActiva, $match)
  Write-Host ("  Cuentas creadas : {0}" -f $d.cuentas.creadas)
  Write-Host ("  Pólizas creadas : {0}  ·  ya existían {1}  ·  omitidas {2}" -f $d.polizas.creadas, $d.polizas.yaExistian, $d.polizas.omitidas)
  Write-Host ("  CFDI creados    : {0}" -f $d.cfdi.creados)
  Write-Host "  Siguiente: en NEXO, Balanza → «Actualizar desde pólizas» y cuadra contra el origen." -ForegroundColor Yellow
}
finally { Limpiar }
