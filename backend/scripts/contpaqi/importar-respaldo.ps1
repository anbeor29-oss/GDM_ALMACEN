<#
  importar-respaldo.ps1 — De un respaldo .bak de CONTPAQi (contabilidad) a un
  PAQUETE .zip listo para subir en NEXO -> Contabilidad -> Importar respaldo.

  Corre en TU PC (aquí sí hay SQL Server para leer el .bak). NO sube nada: sólo
  CONFIRMA tu identidad con NEXO (tu contraseña) y deja un ARCHIVO .zip. Ese .zip
  lo subes en la pantalla de NEXO, que lo descomprime y carga con tu sesión.
  La dirección y el correo vienen ya puestos (nexo.txt, que NEXO deja al bajarla).

  DOS FORMAS:
   · Doble clic (sin parámetros) -> abre una VENTANA: eliges el .bak y sale el .zip.
   · Por comando:  .\importar-respaldo.ps1 -Bak "C:\ruta.bak"
#>
param(
  [string]$Bak,
  [string]$Server = '',
  [string]$WorkDir = "$env:TEMP\NexoContImp",
  [string]$OutDir = "$([Environment]::GetFolderPath('Desktop'))"
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sc = 'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE'
if (-not (Test-Path $sc)) { $sc = 'sqlcmd' }

function Get-SvcAcct { try { (Get-CimInstance Win32_Service -Filter "Name='MSSQL`$SQLEXPRESS'").StartName } catch { 'NT SERVICE\MSSQL$SQLEXPRESS' } }

# Encuentra un motor SQL para restaurar el .bak. Prefiere SQLEXPRESS; si no, LocalDB.
function Resolve-Sql {
  $ex = Get-Service 'MSSQL$SQLEXPRESS' -ErrorAction SilentlyContinue
  if ($ex -and $ex.Status -eq 'Running') { return @{ server = '.\SQLEXPRESS'; localdb = $false } }
  $def = Get-Service 'MSSQLSERVER' -ErrorAction SilentlyContinue
  if ($def -and $def.Status -eq 'Running') { return @{ server = '.'; localdb = $false } }
  if (Get-Command SqlLocalDB -ErrorAction SilentlyContinue) {
    $inst = 'NexoImp'
    & SqlLocalDB create $inst 2>$null | Out-Null
    & SqlLocalDB start  $inst 2>$null | Out-Null
    return @{ server = "(localdb)\$inst"; localdb = $true }
  }
  throw "No se encontró SQL Server ni LocalDB en esta PC. Instala gratis 'SQL Server Express LocalDB' (~45 MB). Descarga: https://aka.ms/sqllocaldb"
}

# Restaura el .bak, extrae a JSON y comprime en un .zip. Devuelve la ruta del .zip.
function Invoke-Paquete {
  param([string]$Bak, [scriptblock]$Log, [switch]$PreviewOnly)
  if (-not (Test-Path $Bak)) { throw "No existe el respaldo: $Bak" }
  $ext = [IO.Path]::GetExtension($Bak)
  if ($ext -and $ext -ne '.bak') { throw ("El archivo que elegiste termina en '$ext', no en '.bak'. Esta herramienta necesita el respaldo .bak que genera CONTPAQi Contabilidad (un backup de SQL Server), NO una descarga de XML del SAT ni un .zip. Elegiste: " + (Split-Path $Bak -Leaf)) }
  if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir | Out-Null }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $db = "NEXO_CONT_$stamp"; $bakLocal = Join-Path $WorkDir "$db.bak"; $export = Join-Path $WorkDir "export_$stamp"

  $srv = $Server; $useLocalDb = $false
  if (-not $srv) { $eng = Resolve-Sql; $srv = $eng.server; $useLocalDb = $eng.localdb } elseif ($srv -like '(localdb)*') { $useLocalDb = $true }

  try {
    & $Log ("1/4  Restaurando el respaldo ({0})..." -f $(if ($useLocalDb) { 'LocalDB' } else { $srv }))
    Copy-Item $Bak $bakLocal -Force
    if (-not $useLocalDb) { icacls $WorkDir /grant "$(Get-SvcAcct):(OI)(CI)(M)" 2>&1 | Out-Null }
    $fl = & $sc -S $srv -E -W -s"|" -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$bakLocal';"
    $dataLn = $null; $logLn = $null
    foreach ($line in $fl) { $p = $line -split '\|'; if ($p.Count -ge 3) { if ($p[2].Trim() -eq 'D') { $dataLn = $p[0].Trim() } elseif ($p[2].Trim() -eq 'L') { $logLn = $p[0].Trim() } } }
    if (-not $dataLn -or -not $logLn) { throw ("El archivo no es un respaldo .bak válido de SQL Server. Elige el .bak de CONTPAQi Contabilidad (no una descarga de XML del SAT ni un .zip). Detalle de SQL: " + (($fl | Out-String).Trim())) }
    $rout = & $sc -S $srv -E -b -Q "SET NOCOUNT ON; IF DB_ID('$db') IS NOT NULL BEGIN ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db]; END; RESTORE DATABASE [$db] FROM DISK = N'$bakLocal' WITH MOVE '$dataLn' TO N'$WorkDir\$db.mdf', MOVE '$logLn' TO N'$WorkDir\$db._log.ldf', REPLACE, RECOVERY;" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      if ($rout -match 'incompatible|is running version|backed up on') { throw ("El respaldo es de una versión de SQL Server más NUEVA que el motor de esta PC. Instala SQL Server 2022 Express o LocalDB 2022+ (gratis) y reintenta. Detalle: " + $rout.Trim()) }
      throw ("Falló la restauración del respaldo. Detalle: " + $rout.Trim())
    }

    & $Log "2/4  Leyendo la contabilidad (cuentas, pólizas, movimientos, CFDI)..."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $here 'extraer-contpaqi.ps1') -Db $db -Server $srv -Out $export | Out-Null
    $empresa = @(); $pol = @(); $mov = @()
    try { $empresa = (Get-Content (Join-Path $export 'empresa.json') -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json } catch {}
    try { $pol = (Get-Content (Join-Path $export 'polizas.json') -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json } catch {}
    try { $mov = (Get-Content (Join-Path $export 'movimientos.json') -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json } catch {}

    $rfc = ''; if ($empresa) { $rfc = "" + $empresa[0].rfc }
    if ($PreviewOnly) {
      & $Log "3/3  Previo (no se generó ningún archivo)."
      & $Log ""
      & $Log ("  Empresa RFC: {0}   Pólizas: {1}   Movimientos: {2}" -f $rfc, @($pol).Count, @($mov).Count)
      return $null
    }
    & $Log "3/4  Empaquetando..."
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
    $zip = Join-Path $OutDir ("CONTABILIDAD_" + $stamp + ".zip")
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $export '*.json') -DestinationPath $zip -Force

    & $Log "4/4  Listo."
    & $Log ""
    & $Log ("  Empresa RFC: {0}   Pólizas: {1}   Movimientos: {2}" -f $rfc, @($pol).Count, @($mov).Count)
    & $Log ("  Paquete:  {0}" -f $zip)
    return $zip
  }
  finally {
    try { & $sc -S $srv -E -Q "IF DB_ID('$db') IS NOT NULL BEGIN ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db]; END;" | Out-Null } catch {}
    Remove-Item $bakLocal -ErrorAction SilentlyContinue
    Remove-Item $export -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Lee nexo.txt (lo deja NEXO al descargar la herramienta): url y correo del usuario.
function Read-NexoConfig {
  $cfg = @{ url = ''; email = '' }
  $p = Join-Path $here 'nexo.txt'
  if (Test-Path $p) {
    foreach ($ln in (Get-Content $p)) {
      if ($ln -match '^\s*url\s*=\s*(.+)$') { $cfg.url = $matches[1].Trim() }
      elseif ($ln -match '^\s*email\s*=\s*(.+)$') { $cfg.email = $matches[1].Trim() }
      elseif ($ln -match '^https?://' -and -not $cfg.url) { $cfg.url = $ln.Trim() }
    }
  }
  return $cfg
}

# Confirma tu identidad contra NEXO (login). Si la contraseña es válida devuelve
# $true; si no, lanza un error claro. No sube nada: sólo verifica antes de generar.
function Test-NexoLogin {
  param([string]$Url, [string]$Email, [string]$Pwd)
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  $u = $Url.Trim()
  try { $uri = [Uri]$u; $u = ('{0}://{1}' -f $uri.Scheme, $uri.Authority) } catch { $u = $u.TrimEnd('/') }
  $body = @{ email = $Email; password = $Pwd } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri "$u/api/v1/auth/login" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 45 | Out-Null
    return $true
  } catch {
    $msg = $_.Exception.Message
    try { $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $d = $sr.ReadToEnd(); if ($d) { $msg = $d } } catch {}
    throw ("No pude confirmar tu identidad en NEXO. Revisa el correo y la contraseña (y que la dirección sea la de NEXO). Detalle: " + $msg)
  }
}

# ─────────────────────────── MODO COMANDO ───────────────────────────
if ($Bak) {
  $log = { param($m) Write-Host $m }
  $zip = Invoke-Paquete -Bak $Bak -Log $log
  Write-Host "`nSube este archivo en NEXO -> Contabilidad -> Importar respaldo:`n  $zip"
  return
}

# ─────────────────────────── MODO VENTANA ───────────────────────────
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$cfg = Read-NexoConfig

$f = New-Object System.Windows.Forms.Form
$f.Text = 'Importar respaldo de contabilidad a NEXO'; $f.Size = New-Object Drawing.Size(720, 560); $f.StartPosition = 'CenterScreen'

$lbl = New-Object Windows.Forms.Label; $lbl.Text = 'Paso 1 — Elige el respaldo de contabilidad (.bak):'; $lbl.Location = New-Object Drawing.Point(15, 15); $lbl.AutoSize = $true; $f.Controls.Add($lbl)
$tbBak = New-Object Windows.Forms.TextBox; $tbBak.Location = New-Object Drawing.Point(15, 38); $tbBak.Width = 540; $tbBak.ReadOnly = $true; $f.Controls.Add($tbBak)
$btnBak = New-Object Windows.Forms.Button; $btnBak.Text = 'Elegir...'; $btnBak.Location = New-Object Drawing.Point(565, 36); $btnBak.Width = 120; $f.Controls.Add($btnBak)

$lbl2 = New-Object Windows.Forms.Label; $lbl2.Text = 'Paso 2 — Confirma con tu contraseña de NEXO y genera el paquete .zip:'; $lbl2.Location = New-Object Drawing.Point(15, 72); $lbl2.AutoSize = $true; $f.Controls.Add($lbl2)
$lblUrl = New-Object Windows.Forms.Label; $lblUrl.Text = 'Dirección (URL):'; $lblUrl.Location = New-Object Drawing.Point(15, 104); $lblUrl.AutoSize = $true; $f.Controls.Add($lblUrl)
$tbUrl = New-Object Windows.Forms.TextBox; $tbUrl.Location = New-Object Drawing.Point(140, 101); $tbUrl.Width = 545; $tbUrl.Text = $cfg.url; $f.Controls.Add($tbUrl)
$lblMail = New-Object Windows.Forms.Label; $lblMail.Text = 'Correo:'; $lblMail.Location = New-Object Drawing.Point(15, 134); $lblMail.AutoSize = $true; $f.Controls.Add($lblMail)
$tbEmail = New-Object Windows.Forms.TextBox; $tbEmail.Location = New-Object Drawing.Point(140, 131); $tbEmail.Width = 545; $tbEmail.Text = $cfg.email; $f.Controls.Add($tbEmail)
$lblPwd = New-Object Windows.Forms.Label; $lblPwd.Text = 'Contraseña:'; $lblPwd.Location = New-Object Drawing.Point(15, 164); $lblPwd.AutoSize = $true; $f.Controls.Add($lblPwd)
$tbPwd = New-Object Windows.Forms.TextBox; $tbPwd.Location = New-Object Drawing.Point(140, 161); $tbPwd.Width = 545; $tbPwd.PasswordChar = '*'; $f.Controls.Add($tbPwd)

$btnPrev = New-Object Windows.Forms.Button; $btnPrev.Text = 'Ver previo'; $btnPrev.Location = New-Object Drawing.Point(15, 197); $btnPrev.Width = 140; $f.Controls.Add($btnPrev)
$btnGen = New-Object Windows.Forms.Button; $btnGen.Text = 'Generar el .zip'; $btnGen.Location = New-Object Drawing.Point(165, 197); $btnGen.Width = 190; $btnGen.BackColor = [Drawing.Color]::FromArgb(4, 120, 87); $btnGen.ForeColor = 'White'; $f.Controls.Add($btnGen)
$btnSalir = New-Object Windows.Forms.Button; $btnSalir.Text = 'Salir'; $btnSalir.Location = New-Object Drawing.Point(585, 197); $btnSalir.Width = 100; $f.Controls.Add($btnSalir)

$txtLog = New-Object Windows.Forms.TextBox; $txtLog.Multiline = $true; $txtLog.ScrollBars = 'Vertical'; $txtLog.ReadOnly = $true; $txtLog.Location = New-Object Drawing.Point(15, 234); $txtLog.Size = New-Object Drawing.Size(670, 273); $txtLog.Font = New-Object Drawing.Font('Consolas', 9); $f.Controls.Add($txtLog)
$logFn = { param($m) $txtLog.AppendText("$m`r`n"); [Windows.Forms.Application]::DoEvents() }.GetNewClosure()
$setBusy = { param($b) $btnGen.Enabled = -not $b; $btnPrev.Enabled = -not $b; $btnBak.Enabled = -not $b }.GetNewClosure()

$btnBak.Add_Click({
    $dlg = New-Object Windows.Forms.OpenFileDialog; $dlg.Filter = 'Respaldos de CONTPAQi (*.bak)|*.bak|Todos|*.*'
    if ($dlg.ShowDialog() -eq 'OK') { $tbBak.Text = $dlg.FileName }
  })
$btnSalir.Add_Click({ $f.Close() })
$btnPrev.Add_Click({
    if (-not $tbBak.Text) { [Windows.Forms.MessageBox]::Show('Primero elige el respaldo .bak.'); return }
    & $setBusy $true; $txtLog.Clear()
    try { Invoke-Paquete -Bak $tbBak.Text -Log $logFn -PreviewOnly | Out-Null }
    catch { & $logFn ("ERROR: " + $_.Exception.Message); [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Error') }
    finally { & $setBusy $false }
  })
$btnGen.Add_Click({
    if (-not $tbBak.Text) { [Windows.Forms.MessageBox]::Show('Primero elige el respaldo .bak.'); return }
    if (-not $tbUrl.Text -or -not $tbEmail.Text -or -not $tbPwd.Text) { [Windows.Forms.MessageBox]::Show('Escribe la dirección, tu correo y tu contraseña de NEXO para confirmar.'); return }
    & $setBusy $true; $txtLog.Clear()
    try {
      & $logFn 'Confirmando tu identidad en NEXO...'
      Test-NexoLogin -Url $tbUrl.Text -Email $tbEmail.Text -Pwd $tbPwd.Text | Out-Null
      & $logFn 'Identidad confirmada.'
      $zip = Invoke-Paquete -Bak $tbBak.Text -Log $logFn
      [Windows.Forms.MessageBox]::Show(("Paquete listo:`n$zip`n`nAhora regresa a NEXO (Contabilidad -> Importar respaldo) y sube este .zip (paso 2)."), 'Paquete generado')
      try { Start-Process (Split-Path $zip -Parent) } catch {}
    }
    catch { & $logFn ("ERROR: " + $_.Exception.Message); [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Error') }
    finally { & $setBusy $false }
  })
[void]$f.ShowDialog()
