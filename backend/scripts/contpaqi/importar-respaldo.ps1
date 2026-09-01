<#
  importar-respaldo.ps1 — De un respaldo .bak de CONTPAQi a NEXO.

  DOS FORMAS:
   · Doble clic (sin parametros)  -> abre una VENTANA: eliges el .bak con un boton,
     y todo corre solo hasta un resumen. Pensado para quien no usa la terminal.
   · Por comando (avanzado):
       .\importar-respaldo.ps1 -Bak "C:\ruta.bak" -Nexo "https://mi-nexo" -Email "yo@correo.com"
     Agrega -DryRun para ver solo el previo.

  Hace todo en la PC (donde si hay SQL Server): restaura -> extrae -> previo ->
  entra a NEXO -> busca la empresa por el RFC del respaldo -> importa. Idempotente.
#>
param(
  [string]$Bak,
  [string]$Nexo = $env:NEXO_URL,
  [string]$Email,
  [string]$Token,
  [string]$Server = '',
  [string]$WorkDir = 'E:\ContpaqMig',
  [switch]$DryRun,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sc = 'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE'
if (-not (Test-Path $sc)) { $sc = 'sqlcmd' }
$CfgPath = Join-Path $env:APPDATA 'nexo-importador.json'

function Get-SvcAcct { try { (Get-CimInstance Win32_Service -Filter "Name='MSSQL`$SQLEXPRESS'").StartName } catch { 'NT SERVICE\MSSQL$SQLEXPRESS' } }

# Encuentra un motor SQL para restaurar el .bak. Prefiere SQLEXPRESS; si no,
# usa LocalDB (gratis, ~45 MB, sin configurar). Devuelve @{ server; localdb }.
function Resolve-Sql {
  $ex = Get-Service 'MSSQL$SQLEXPRESS' -ErrorAction SilentlyContinue
  if ($ex -and $ex.Status -eq 'Running') { return @{ server = '.\SQLEXPRESS'; localdb = $false } }
  $def = Get-Service 'MSSQLSERVER' -ErrorAction SilentlyContinue
  if ($def -and $def.Status -eq 'Running') { return @{ server = '.'; localdb = $false } }
  if (Get-Command SqlLocalDB -ErrorAction SilentlyContinue) {
    $inst = 'NexoImp'
    & SqlLocalDB create $inst 2>$null | Out-Null   # si ya existe, no pasa nada
    & SqlLocalDB start  $inst 2>$null | Out-Null
    return @{ server = "(localdb)\$inst"; localdb = $true }
  }
  throw "No se encontro SQL Server ni LocalDB en esta PC. Instala gratis 'SQL Server Express LocalDB' (~45 MB) y vuelve a intentar. Descarga: https://aka.ms/sqllocaldb"
}

# Orquesta todo el proceso. $Log es un scriptblock que recibe una linea de texto.
# Devuelve un hashtable: @{ preview = @{...}; report = <obj o $null> }
function Invoke-Full {
  param([string]$Bak, [string]$Nexo, [string]$Email, [string]$Pass, [string]$Token, [bool]$DryRun, [bool]$Force, [scriptblock]$Log)
  if (-not (Test-Path $Bak)) { throw "No existe el respaldo: $Bak" }
  if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir | Out-Null }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $db = "NEXO_IMP_$stamp"; $bakLocal = Join-Path $WorkDir "$db.bak"; $export = Join-Path $WorkDir "export_$stamp"

  $srv = $Server; $useLocalDb = $false
  if (-not $srv) { $eng = Resolve-Sql; $srv = $eng.server; $useLocalDb = $eng.localdb } elseif ($srv -like '(localdb)*') { $useLocalDb = $true }

  try {
    & $Log ("1/6  Restaurando el respaldo ({0})..." -f $(if ($useLocalDb) { 'LocalDB' } else { $srv }))
    Copy-Item $Bak $bakLocal -Force
    if (-not $useLocalDb) { icacls $WorkDir /grant "$(Get-SvcAcct):(OI)(CI)(M)" 2>&1 | Out-Null }  # LocalDB corre como el usuario, no necesita permisos extra
    $fl = & $sc -S $srv -E -W -s"|" -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$bakLocal';"
    $dataLn = $null; $logLn = $null
    foreach ($line in $fl) { $p = $line -split '\|'; if ($p.Count -ge 3) { if ($p[2].Trim() -eq 'D') { $dataLn = $p[0].Trim() } elseif ($p[2].Trim() -eq 'L') { $logLn = $p[0].Trim() } } }
    if (-not $dataLn -or -not $logLn) { throw "No se pudieron leer los nombres logicos del .bak." }
    $rout = & $sc -S $srv -E -b -Q "SET NOCOUNT ON; IF DB_ID('$db') IS NOT NULL BEGIN ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db]; END; RESTORE DATABASE [$db] FROM DISK = N'$bakLocal' WITH MOVE '$dataLn' TO N'$WorkDir\$db.mdf', MOVE '$logLn' TO N'$WorkDir\$db._log.ldf', REPLACE, RECOVERY;" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      if ($rout -match 'incompatible|is running version|backed up on') { throw ("El respaldo es de una version de SQL Server mas NUEVA que el motor de esta PC. Instala SQL Server 2022 Express o LocalDB 2022+ (gratis) y reintenta. Detalle: " + $rout.Trim()) }
      throw ("Fallo la restauracion del respaldo. Detalle: " + $rout.Trim())
    }

    & $Log "2/6  Leyendo la informacion..."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $here 'extraer-contpaqi.ps1') -Db $db -Server $srv -Out $export | Out-Null

    & $Log "3/6  Leyendo el previo..."
    $rd = { param($n) $f = Join-Path $export "$n.json"; if (Test-Path $f) { (Get-Content $f -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json } else { @() } }
    $empresa = & $rd 'empresa'; $cuentas = & $rd 'cuentas'; $pol = & $rd 'polizas'; $mov = & $rd 'movimientos'; $cfdi = & $rd 'cfdi'; $pc = & $rd 'poliza_cfdi'
    $rfcBak = ''; if ($empresa) { $rfcBak = "" + $empresa[0].rfc }
    $nomEmp = ''; if ($empresa) { $nomEmp = "" + $empresa[0].nombre }
    $car = ($mov | Where-Object { $_.tm -eq 0 } | Measure-Object importe -Sum).Sum
    $ab = ($mov | Where-Object { $_.tm -eq 1 } | Measure-Object importe -Sum).Sum
    $ejer = ($pol | Select-Object -ExpandProperty ejercicio -Unique | Sort-Object) -join ', '
    $cuadra = [math]::Abs($car - $ab) -lt 0.01
    $eq = '<>'; if ($cuadra) { $eq = '=' }
    $preview = @{ empresa = $nomEmp; rfc = $rfcBak; ejercicios = $ejer; cuentas = $cuentas.Count; polizas = $pol.Count; movimientos = $mov.Count; cfdi = $cfdi.Count; ligas = $pc.Count; cargos = $car; abonos = $ab; cuadra = $cuadra }
    & $Log ""
    & $Log ("  Empresa   : {0}  -  RFC {1}" -f $nomEmp, $rfcBak)
    & $Log ("  Ejercicios: {0}" -f $ejer)
    & $Log ("  Cuentas {0}   Polizas {1}   Movimientos {2}" -f $cuentas.Count, $pol.Count, $mov.Count)
    & $Log ("  Cargos {0:N2} {1} Abonos {2:N2}" -f $car, $eq, $ab)
    & $Log ("  CFDI {0}   ligas poliza-UUID {1}" -f $cfdi.Count, $pc.Count)
    & $Log ""
    if ($DryRun) { & $Log "Solo previo (-DryRun): no se subio nada."; return @{ preview = $preview; report = $null } }

    & $Log "4/6  Entrando a NEXO..."
    if (-not $Nexo) { throw "Falta la URL de NEXO." }
    $api = $Nexo.TrimEnd('/') + '/api/v1'
    if (-not $Token) {
      if (-not $Email -or -not $Pass) { throw "Falta correo o contrasena de NEXO." }
      $login = Invoke-RestMethod -Uri "$api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = $Email; password = $Pass } | ConvertTo-Json)
      $Token = $login.data.token
    }
    $h = @{ Authorization = "Bearer $Token" }

    & $Log "5/6  Buscando la empresa por RFC $rfcBak..."
    $emps = (Invoke-RestMethod -Uri "$api/auth/companies" -Headers $h -Method Get).data
    $target = $emps | Where-Object { $_.rfc -and ($_.rfc.ToUpper() -eq $rfcBak.ToUpper()) } | Select-Object -First 1
    if (-not $target) {
      $lst = ($emps | ForEach-Object { "$($_.rfc) $($_.business_name)" }) -join "; "
      throw "No hay empresa en NEXO con RFC $rfcBak. Creala primero. Empresas disponibles: $lst"
    }
    $sw = Invoke-RestMethod -Uri "$api/auth/switch-company" -Headers $h -Method Post -ContentType 'application/json' -Body (@{ companyId = $target.id } | ConvertTo-Json)
    if ($sw.data.token) { $Token = $sw.data.token; $h = @{ Authorization = "Bearer $Token" } }
    & $Log ("  Empresa activa: {0} ({1})" -f $target.business_name, $target.rfc)

    & $Log "6/6  Subiendo e importando (puede tardar)..."
    $boundary = [Guid]::NewGuid().ToString(); $LF = "`r`n"; $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("--$boundary$LF"); [void]$sb.Append("Content-Disposition: form-data; name=`"forzar`"$LF$LF"); [void]$sb.Append(("" + $Force).ToLower() + $LF)
    foreach ($n in @('empresa', 'cuentas', 'polizas', 'movimientos', 'poliza_cfdi', 'cfdi', 'saldos')) {
      $fp = Join-Path $export "$n.json"; if (-not (Test-Path $fp)) { continue }
      [void]$sb.Append("--$boundary$LF"); [void]$sb.Append("Content-Disposition: form-data; name=`"$n`"; filename=`"$n.json`"$LF"); [void]$sb.Append("Content-Type: application/json$LF$LF"); [void]$sb.Append([IO.File]::ReadAllText($fp) + $LF)
    }
    [void]$sb.Append("--$boundary--$LF")
    $bytes = [Text.Encoding]::UTF8.GetBytes($sb.ToString())
    $r = Invoke-RestMethod -Uri "$api/accounting/contpaqi/importar" -Method Post -Headers $h -ContentType "multipart/form-data; boundary=$boundary" -Body $bytes -TimeoutSec 1800
    return @{ preview = $preview; report = $r.data }
  }
  finally {
    try { & $sc -S $srv -E -Q "IF DB_ID('$db') IS NOT NULL BEGIN ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db]; END;" | Out-Null } catch {}
    Remove-Item $bakLocal -ErrorAction SilentlyContinue
  }
}

function Format-Report($d, [scriptblock]$Log) {
  & $Log ""
  & $Log "== RESUMEN =="
  $match = if ($d.rfc.coincide) { 'coinciden' } else { 'FORZADO' }
  & $Log ("  RFC: respaldo {0} vs empresa {1} - {2}" -f $d.rfc.respaldo, $d.rfc.empresaActiva, $match)
  & $Log ("  Cuentas creadas : {0}" -f $d.cuentas.creadas)
  & $Log ("  Polizas creadas : {0}  ·  ya existian {1}  ·  omitidas {2}" -f $d.polizas.creadas, $d.polizas.yaExistian, $d.polizas.omitidas)
  & $Log ("  CFDI creados    : {0}" -f $d.cfdi.creados)
  if ($d.polizas.conTemporal -and $d.polizas.conTemporal.Count -gt 0) {
    & $Log ("  *** {0} poliza(s) usaron la CUENTA TEMPORAL (MIG-TEMPORAL): hay que reasignarles la cuenta en NEXO -> Polizas." -f $d.polizas.conTemporal.Count)
  }
  & $Log "  Siguiente: en NEXO, Balanza -> Actualizar desde polizas, y cuadra contra el origen."
}

# ─────────────────────────── MODO COMANDO ───────────────────────────
if ($Bak) {
  $log = { param($m) Write-Host $m }
  $pass = $null
  if (-not $DryRun -and -not $Token) {
    if (-not $Email) { $Email = Read-Host "Correo de NEXO" }
    $sec = Read-Host "Contrasena" -AsSecureString
    $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  $res = Invoke-Full -Bak $Bak -Nexo $Nexo -Email $Email -Pass $pass -Token $Token -DryRun:$DryRun -Force:$Force -Log $log
  if ($res.report) { Format-Report $res.report $log }
  return
}

# ─────────────────────────── MODO VENTANA ───────────────────────────
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$cfg = @{ nexo = ''; email = '' }
if (Test-Path $CfgPath) { try { $cfg = Get-Content $CfgPath -Raw | ConvertFrom-Json } catch {} }

$f = New-Object System.Windows.Forms.Form
$f.Text = 'Importar respaldo a NEXO'; $f.Size = New-Object Drawing.Size(760, 620); $f.StartPosition = 'CenterScreen'
$mk = { param($t, $x, $y, $w) $l = New-Object Windows.Forms.Label; $l.Text = $t; $l.Location = New-Object Drawing.Point($x, $y); $l.AutoSize = $true; $f.Controls.Add($l); $l }
$mktb = { param($x, $y, $w, $val, $pw) $t = New-Object Windows.Forms.TextBox; $t.Location = New-Object Drawing.Point($x, $y); $t.Width = $w; $t.Text = "$val"; if ($pw) { $t.UseSystemPasswordChar = $true }; $f.Controls.Add($t); $t }

[void](& $mk 'Paso 1 — Elige el respaldo (.bak):' 15 15 400)
$tbBak = & $mktb 15 38 560 '' $false; $tbBak.ReadOnly = $true
$btnBak = New-Object Windows.Forms.Button; $btnBak.Text = 'Elegir...'; $btnBak.Location = New-Object Drawing.Point(585, 36); $btnBak.Width = 140; $f.Controls.Add($btnBak)
[void](& $mk 'Paso 2 — Datos de NEXO (se recuerdan):' 15 78 400)
[void](& $mk 'Direccion (URL):' 15 104 120); $tbNexo = & $mktb 140 101 435 $cfg.nexo $false
[void](& $mk 'Correo:' 15 134 120); $tbEmail = & $mktb 140 131 300 $cfg.email $false
[void](& $mk 'Contrasena:' 15 164 120); $tbPass = & $mktb 140 161 300 '' $true
$chkForce = New-Object Windows.Forms.CheckBox; $chkForce.Text = 'Importar aunque el RFC no coincida'; $chkForce.Location = New-Object Drawing.Point(140, 190); $chkForce.AutoSize = $true; $f.Controls.Add($chkForce)

$btnPrev = New-Object Windows.Forms.Button; $btnPrev.Text = 'Ver previo'; $btnPrev.Location = New-Object Drawing.Point(15, 220); $btnPrev.Width = 150; $f.Controls.Add($btnPrev)
$btnImp = New-Object Windows.Forms.Button; $btnImp.Text = 'Importar a NEXO'; $btnImp.Location = New-Object Drawing.Point(175, 220); $btnImp.Width = 200; $btnImp.BackColor = [Drawing.Color]::FromArgb(4, 120, 87); $btnImp.ForeColor = 'White'; $f.Controls.Add($btnImp)

$log = New-Object Windows.Forms.TextBox; $log.Multiline = $true; $log.ScrollBars = 'Vertical'; $log.ReadOnly = $true
$log.Location = New-Object Drawing.Point(15, 258); $log.Size = New-Object Drawing.Size(710, 305); $log.Font = New-Object Drawing.Font('Consolas', 9); $f.Controls.Add($log)
$logFn = { param($m) $log.AppendText("$m`r`n"); [Windows.Forms.Application]::DoEvents() }

$btnBak.Add_Click({
    $dlg = New-Object Windows.Forms.OpenFileDialog; $dlg.Filter = 'Respaldos de CONTPAQi (*.bak)|*.bak|Todos|*.*'
    if ($dlg.ShowDialog() -eq 'OK') { $tbBak.Text = $dlg.FileName }
  })

$run = {
  param($dry)
  if (-not $tbBak.Text) { [Windows.Forms.MessageBox]::Show('Primero elige el respaldo .bak.'); return }
  $btnPrev.Enabled = $false; $btnImp.Enabled = $false; $btnBak.Enabled = $false; $log.Clear()
  try {
    $res = Invoke-Full -Bak $tbBak.Text -Nexo $tbNexo.Text -Email $tbEmail.Text -Pass $tbPass.Text -Token '' -DryRun:$dry -Force:($chkForce.Checked) -Log $logFn
    if ($res.report) {
      Format-Report $res.report $logFn
      try { @{ nexo = $tbNexo.Text; email = $tbEmail.Text } | ConvertTo-Json | Set-Content $CfgPath -Encoding UTF8 } catch {}
      $extra = ''
      if ($res.report.polizas.conTemporal -and $res.report.polizas.conTemporal.Count -gt 0) { $extra = "`n`nOJO: $($res.report.polizas.conTemporal.Count) poliza(s) quedaron con la cuenta TEMPORAL. Reasignales la cuenta en NEXO." }
      [Windows.Forms.MessageBox]::Show(("Listo.`nPolizas creadas: {0}`nCuentas: {1}`nCFDI: {2}{3}" -f $res.report.polizas.creadas, $res.report.cuentas.creadas, $res.report.cfdi.creados, $extra), 'Importacion terminada')
    }
    else { [Windows.Forms.MessageBox]::Show('Previo listo. Revisa los numeros y, si estan bien, dale "Importar a NEXO".', 'Previo') }
  }
  catch { & $logFn ("ERROR: " + $_.Exception.Message); [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Error') }
  finally { $btnPrev.Enabled = $true; $btnImp.Enabled = $true; $btnBak.Enabled = $true }
}
$btnPrev.Add_Click({ & $run $true })
$btnImp.Add_Click({ & $run $false })
[void]$f.ShowDialog()
