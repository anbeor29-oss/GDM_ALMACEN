<#
  extraer-nomina.ps1 — Extrae una base de NomiPaq (CONTPAQ Nóminas) ya restaurada
  en SQL Server a un paquete de JSON planos, para el importador de nómina de NEXO.

  REUTILIZABLE: sirve para cualquier respaldo de NomiPaq restaurado. Sólo cambia -Db.

  Uso:
    powershell -File extraer-nomina.ps1 -Db NEXO_MIG_NOM -Out E:\ContpaqMig\nom_export

  No toca la base (sólo lee). No depende de npm: usa sqlcmd con Windows Auth (-E)
  y reconstruye el JSON que FOR JSON parte en trozos.

  Mapeo de tablas (identificado por columnas, NO por nombre — ver la memoria de
  migración de nómina): nom10000=empresa, nom10003=departamentos, nom10006=puestos,
  nom10001=empleados, nom10002=periodos, nom10004=conceptos (con clave SAT),
  nom10007=movimientos (importe por empleado×periodo×concepto), nom10043=CFDI.
#>
param(
  [string]$Db = 'NEXO_MIG_NOM',
  [string]$Server = '.\SQLEXPRESS',
  [string]$Out = 'E:\ContpaqMig\nom_export'
)

$ErrorActionPreference = 'Stop'
$sc = 'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE'
if (-not (Test-Path $sc)) { $sc = 'sqlcmd' }
if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Path $Out | Out-Null }

# Guard: ¿es un respaldo de NomiPaq? Si falta nom10001 (empleados) casi seguro se
# eligió el .bak de CONTABILIDAD por error; se avisa claro en vez de dejar un
# paquete de JSON vacíos que la pantalla no puede importar.
$hayNom = & $sc -S $Server -E -d $Db -h -1 -W -Q "SET NOCOUNT ON; SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.tables WHERE name='nom10001') THEN 1 ELSE 0 END"
if (($hayNom -join '') -notmatch '1') {
  throw "Este respaldo NO tiene tablas de NomiPaq (nómina): falta nom10001 (empleados). ¿Elegiste el .bak de CONTABILIDAD por error? Genera el paquete con el .bak de NÓMINA (NomiPaq)."
}

function Export-Json([string]$name, [string]$query) {
  $raw = Join-Path $Out "$name.raw"
  & $sc -S $Server -E -d $Db -y 0 -o $raw -Q "SET NOCOUNT ON; $query" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "sqlcmd falló en '$name' (exit $LASTEXITCODE). Revisa $raw" }
  $txt = Get-Content $raw -Raw
  if ($null -eq $txt) { $txt = '' }
  $joined = (($txt -split "`r?`n")) -join ''
  $k = $joined.IndexOfAny([char[]]@('[', '{'))
  $json = if ($k -ge 0) { $joined.Substring($k).Trim() } else { '[]' }
  $count = ($json | ConvertFrom-Json).Count
  Set-Content -Path (Join-Path $Out "$name.json") -Value $json -Encoding UTF8
  Remove-Item $raw -ErrorAction SilentlyContinue
  Write-Output ("{0,-14} {1,7} registros" -f $name, $count)
}

Write-Output "== Extrayendo nómina $Db -> $Out =="

# NomiPaq guarda el RFC PARTIDO: rfc=iniciales, homoclave=3 finales, y la FECHA
# NO se almacena (va embebida). Se reconstruye: iniciales + yyMMdd + homoclave.
# La fecha de la empresa (persona física) sale de su CURP (pos 5-10); si es moral,
# de fechaconstitucion.
Export-Json 'empresa' @'
SELECT TOP 1
  LTRIM(RTRIM(rfc))
    + CASE WHEN LTRIM(RTRIM(ISNULL(CURP,''))) <> '' THEN SUBSTRING(LTRIM(RTRIM(CURP)),5,6)
           ELSE CONVERT(char(6), fechaconstitucion, 12) END
    + LTRIM(RTRIM(ISNULL(homoclave,''))) AS rfc,
  LTRIM(RTRIM(ISNULL(NombreEmpresaFiscal, nombrecorto))) AS nombre,
  LTRIM(RTRIM(ISNULL(registroimss,''))) AS registroPatronal,
  ejercicio AS ejercicio
FROM nom10000
FOR JSON PATH
'@

Export-Json 'departamentos' @'
SELECT iddepartamento AS id, numerodepartamento AS numero, LTRIM(RTRIM(descripcion)) AS nombre
FROM nom10003 ORDER BY iddepartamento
FOR JSON PATH
'@

Export-Json 'puestos' @'
SELECT idpuesto AS id, numeropuesto AS numero, LTRIM(RTRIM(descripcion)) AS nombre
FROM nom10006 ORDER BY idpuesto
FOR JSON PATH
'@

Export-Json 'empleados' @'
SELECT e.idempleado AS id, e.codigoempleado AS codigo,
       LTRIM(RTRIM(e.nombre)) AS nombre, LTRIM(RTRIM(e.apellidopaterno)) AS apPaterno,
       LTRIM(RTRIM(ISNULL(e.apellidomaterno,''))) AS apMaterno,
       LTRIM(RTRIM(e.rfc)) + CONVERT(char(6), e.fechanacimiento, 12) + LTRIM(RTRIM(ISNULL(e.homoclave,''))) AS rfc,
       LTRIM(RTRIM(e.curpi)) + CONVERT(char(6), e.fechanacimiento, 12) + LTRIM(RTRIM(ISNULL(e.curpf,''))) AS curp,
       LTRIM(RTRIM(ISNULL(e.numerosegurosocial,''))) AS nss,
       CONVERT(varchar(10), e.fechanacimiento, 23) AS fechaNacimiento,
       CONVERT(varchar(10), e.fechaalta, 23) AS fechaAlta,
       CASE WHEN e.fechabaja > '1900-01-01' THEN CONVERT(varchar(10), e.fechabaja, 23) END AS fechaBaja,
       CASE WHEN e.fechareingreso > '1900-01-01' THEN CONVERT(varchar(10), e.fechareingreso, 23) END AS fechaReingreso,
       e.iddepartamento AS idDepartamento, e.idpuesto AS idPuesto, e.idtipoperiodo AS idTipoPeriodo,
       CAST(e.sueldodiario AS decimal(18,2)) AS sueldoDiario,
       CAST(e.sueldointegrado AS decimal(18,2)) AS sueldoIntegrado,
       e.tipocontrato AS tipoContrato, e.tipoempleado AS tipoEmpleado, e.zonasalario AS zonaSalario,
       e.TipoRegimen AS tipoRegimen, e.EntidadFederativa AS entidad,
       LTRIM(RTRIM(ISNULL(e.bancopagoelectronico,''))) AS banco,
       LTRIM(RTRIM(ISNULL(e.cuentapagoelectronico,''))) AS cuenta,
       LTRIM(RTRIM(ISNULL(e.ClabeInterbancaria,''))) AS clabe,
       LTRIM(RTRIM(ISNULL(e.CorreoElectronico,''))) AS correo,
       LTRIM(RTRIM(ISNULL(e.codigopostal,''))) AS cp,
       LTRIM(RTRIM(ISNULL(e.NumeroFonacot,''))) AS fonacot,
       e.estadoempleado AS estado
FROM nom10001 e ORDER BY e.idempleado
FOR JSON PATH
'@

Export-Json 'periodos' @'
SELECT idperiodo AS id, idtipoperiodo AS idTipoPeriodo, numeroperiodo AS numero,
       ejercicio AS ejercicio, mes AS mes, CAST(diasdepago AS decimal(9,2)) AS dias,
       CONVERT(varchar(10), fechainicio, 23) AS fechaInicio,
       CONVERT(varchar(10), fechafin, 23) AS fechaFin,
       CASE WHEN fechaPago > '1900-01-01' THEN CONVERT(varchar(10), fechaPago, 23) END AS fechaPago
FROM nom10002 ORDER BY ejercicio, idtipoperiodo, numeroperiodo
FOR JSON PATH
'@

Export-Json 'conceptos' @'
SELECT idconcepto AS id, numeroconcepto AS numero, tipoconcepto AS tipo,
       LTRIM(RTRIM(descripcion)) AS descripcion,
       LTRIM(RTRIM(ISNULL(ClaveAgrupadoraSAT,''))) AS claveSat,
       LTRIM(RTRIM(ISNULL(TipoClaveSAT,''))) AS tipoClaveSat,
       LTRIM(RTRIM(ISNULL(leyendaimporte1,''))) AS ley1,
       LTRIM(RTRIM(ISNULL(leyendaimporte2,''))) AS ley2,
       LTRIM(RTRIM(ISNULL(leyendaimporte3,''))) AS ley3,
       LTRIM(RTRIM(ISNULL(leyendaimporte4,''))) AS ley4
FROM nom10004 ORDER BY numeroconcepto
FOR JSON PATH
'@

Export-Json 'movimientos' @'
SELECT idempleado AS idEmpleado, idperiodo AS idPeriodo, idconcepto AS idConcepto,
       CAST(importetotal AS decimal(18,2)) AS importe,
       CAST(importe1 AS decimal(18,2)) AS imp1, CAST(importe2 AS decimal(18,2)) AS imp2,
       CAST(importe3 AS decimal(18,2)) AS imp3, CAST(importe4 AS decimal(18,2)) AS imp4
FROM nom10007 WHERE importetotal <> 0
ORDER BY idperiodo, idempleado, idconcepto
FOR JSON PATH
'@

Export-Json 'cfdi' @'
SELECT IdEmpleado AS idEmpleado, IdPeriodo AS idPeriodo, LTRIM(RTRIM(UUID)) AS uuid,
       Estado AS estado, CONVERT(varchar(10), FechaEmision, 23) AS fechaEmision,
       CONVERT(varchar(10), FechaPago, 23) AS fechaPago,
       CAST(SBC AS decimal(18,2)) AS sbc, CAST(NumDiasPagados AS decimal(9,3)) AS diasPagados
FROM nom10043 WHERE UUID IS NOT NULL AND LTRIM(RTRIM(UUID)) <> ''
FOR JSON PATH
'@

Write-Output "== Listo. Paquete de nómina en $Out =="
