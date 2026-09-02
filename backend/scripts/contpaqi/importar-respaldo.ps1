<#
  importar-respaldo.ps1 — De un respaldo .bak de CONTPAQi (contabilidad) a un
  PAQUETE .zip listo para subir en NEXO -> Contabilidad -> Importar respaldo.

  Esta herramienta NO sube nada: sólo LEE el .bak en la PC (donde sí hay SQL
  Server) y deja un ARCHIVO .zip. Ese .zip se sube en la pantalla de NEXO, que lo
  descomprime y carga con tu sesión ya abierta. Así no tecleas direcciones ni
  contraseñas aquí (mismo flujo que el importador de nómina).

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
  param([string]$Bak, [scriptblock]$Log)
  if (-not (Test-Path $Bak)) { throw "No existe el respaldo: $Bak" }
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
    if (-not $dataLn -or -not $logLn) { throw "No se pudieron leer los nombres lógicos del .bak." }
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

    & $Log "3/4  Empaquetando..."
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
    $zip = Join-Path $OutDir ("CONTABILIDAD_" + $stamp + ".zip")
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $export '*.json') -DestinationPath $zip -Force

    & $Log "4/4  Listo."
    & $Log ""
    $rfc = ''; if ($empresa) { $rfc = "" + $empresa[0].rfc }
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

$f = New-Object System.Windows.Forms.Form
$f.Text = 'Respaldo de contabilidad -> paquete para NEXO'; $f.Size = New-Object Drawing.Size(720, 470); $f.StartPosition = 'CenterScreen'
$lbl = New-Object Windows.Forms.Label; $lbl.Text = 'Paso 1 — Elige el respaldo de contabilidad (.bak):'; $lbl.Location = New-Object Drawing.Point(15, 15); $lbl.AutoSize = $true; $f.Controls.Add($lbl)
$tbBak = New-Object Windows.Forms.TextBox; $tbBak.Location = New-Object Drawing.Point(15, 38); $tbBak.Width = 540; $tbBak.ReadOnly = $true; $f.Controls.Add($tbBak)
$btnBak = New-Object Windows.Forms.Button; $btnBak.Text = 'Elegir...'; $btnBak.Location = New-Object Drawing.Point(565, 36); $btnBak.Width = 120; $f.Controls.Add($btnBak)
$lbl2 = New-Object Windows.Forms.Label; $lbl2.Text = 'Paso 2 — Genera el paquete .zip y súbelo en NEXO -> Contabilidad -> Importar respaldo.'; $lbl2.Location = New-Object Drawing.Point(15, 74); $lbl2.AutoSize = $true; $f.Controls.Add($lbl2)
$btnGen = New-Object Windows.Forms.Button; $btnGen.Text = 'Generar paquete (.zip)'; $btnGen.Location = New-Object Drawing.Point(15, 100); $btnGen.Width = 230; $btnGen.BackColor = [Drawing.Color]::FromArgb(4, 120, 87); $btnGen.ForeColor = 'White'; $f.Controls.Add($btnGen)
$txtLog = New-Object Windows.Forms.TextBox; $txtLog.Multiline = $true; $txtLog.ScrollBars = 'Vertical'; $txtLog.ReadOnly = $true; $txtLog.Location = New-Object Drawing.Point(15, 140); $txtLog.Size = New-Object Drawing.Size(670, 275); $txtLog.Font = New-Object Drawing.Font('Consolas', 9); $f.Controls.Add($txtLog)
$logFn = { param($m) $txtLog.AppendText("$m`r`n"); [Windows.Forms.Application]::DoEvents() }.GetNewClosure()

$btnBak.Add_Click({
    $dlg = New-Object Windows.Forms.OpenFileDialog; $dlg.Filter = 'Respaldos de CONTPAQi (*.bak)|*.bak|Todos|*.*'
    if ($dlg.ShowDialog() -eq 'OK') { $tbBak.Text = $dlg.FileName }
  })
$btnGen.Add_Click({
    if (-not $tbBak.Text) { [Windows.Forms.MessageBox]::Show('Primero elige el respaldo .bak.'); return }
    $btnGen.Enabled = $false; $btnBak.Enabled = $false; $txtLog.Clear()
    try {
      $zip = Invoke-Paquete -Bak $tbBak.Text -Log $logFn
      [Windows.Forms.MessageBox]::Show(("Paquete listo:`n$zip`n`nSúbelo en NEXO -> Contabilidad -> Importar respaldo."), 'Paquete generado')
      try { Start-Process (Split-Path $zip -Parent) } catch {}
    }
    catch { & $logFn ("ERROR: " + $_.Exception.Message); [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Error') }
    finally { $btnGen.Enabled = $true; $btnBak.Enabled = $true }
  })
[void]$f.ShowDialog()
