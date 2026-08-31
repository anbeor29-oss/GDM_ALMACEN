<#
  extraer-contpaqi.ps1 — Extrae una base de CONTPAQi (contabilidad, "ct*") ya
  restaurada en SQL Server a un paquete de JSON planos, para el importador de NEXO.

  REUTILIZABLE: sirve para cualquier respaldo CONTPAQi restaurado. Sólo cambia -Db.

  Uso:
    powershell -File extraer-contpaqi.ps1 -Db NEXO_MIG_CONT -Out E:\ContpaqMig\export

  No toca la base (sólo lee). No depende de npm: usa sqlcmd con Windows Auth (-E),
  y reconstruye el JSON que FOR JSON parte en trozos de 2 KB.
#>
param(
  [string]$Db = 'NEXO_MIG_CONT',
  [string]$Server = '.\SQLEXPRESS',
  [string]$Out = 'E:\ContpaqMig\export'
)

$ErrorActionPreference = 'Stop'
$sc = 'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE'
if (-not (Test-Path $sc)) { $sc = 'sqlcmd' }
if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Path $Out | Out-Null }

# Corre una consulta FOR JSON y guarda JSON limpio. FOR JSON parte la salida en
# renglones de ~2033 chars; se concatenan SIN separador (FOR JSON no emite saltos
# de línea literales: los de dentro de un string van escapados como \n).
function Export-Json([string]$name, [string]$query) {
  $raw = Join-Path $Out "$name.raw"
  & $sc -S $Server -E -d $Db -y 0 -o $raw -Q "SET NOCOUNT ON; $query" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "sqlcmd falló en '$name' (exit $LASTEXITCODE). Revisa $raw" }
  $txt = Get-Content $raw -Raw
  if ($null -eq $txt) { $txt = '' }
  # FOR JSON no emite saltos de línea literales; los únicos vienen de sqlcmd
  # (encabezado + trozos). Se juntan todos y se toma desde el primer [ o {.
  $joined = (($txt -split "`r?`n")) -join ''
  $k = $joined.IndexOfAny([char[]]@('[', '{'))
  $json = if ($k -ge 0) { $joined.Substring($k).Trim() } else { '[]' }
  $count = ($json | ConvertFrom-Json).Count   # valida que sea JSON bien formado
  Set-Content -Path (Join-Path $Out "$name.json") -Value $json -Encoding UTF8
  Remove-Item $raw -ErrorAction SilentlyContinue
  Write-Output ("{0,-14} {1,7} registros" -f $name, $count)
}

Write-Output "== Extrayendo $Db -> $Out =="

Export-Json 'cuentas' @'
SELECT c.Codigo AS codigo, c.Nombre AS nombre, a.Codigo AS agrupador,
       CAST(c.Afectable AS int) AS afectable, c.CtaMayor AS ctaMayor,
       CAST(c.EsBaja AS int) AS baja
FROM Cuentas c LEFT JOIN AgrupadoresSAT a ON a.Id = c.IdAgrupadorSAT
ORDER BY c.Codigo
FOR JSON PATH
'@

Export-Json 'polizas' @'
SELECT p.Id AS id, p.Ejercicio AS ejercicio, p.Periodo AS periodo, p.TipoPol AS tipoPol,
       p.Folio AS folio, CONVERT(varchar(10), p.Fecha, 23) AS fecha, p.Concepto AS concepto,
       p.Guid AS guid, CAST(p.Cargos AS decimal(18,2)) AS cargos, CAST(p.Abonos AS decimal(18,2)) AS abonos
FROM Polizas p
ORDER BY p.Ejercicio, p.Periodo, p.TipoPol, p.Folio
FOR JSON PATH
'@

Export-Json 'movimientos' @'
SELECT m.IdPoliza AS idPoliza, m.NumMovto AS num, c.Codigo AS cuenta,
       CAST(m.TipoMovto AS int) AS tm, CAST(m.Importe AS decimal(18,2)) AS importe,
       m.Concepto AS concepto, m.Referencia AS referencia
FROM MovimientosPoliza m JOIN Cuentas c ON c.Id = m.IdCuenta
ORDER BY m.IdPoliza, m.NumMovto
FOR JSON PATH
'@

Export-Json 'asoccfdi' @'
SELECT GuidRef AS guidRef, UUID AS uuid, AppType AS appType
FROM AsocCFDIs
WHERE UUID IS NOT NULL AND UUID <> ''''
FOR JSON PATH
'@

Export-Json 'cfdi' @'
SELECT UUID AS uuid, RFC_Emisor AS rfcEmisor, LEFT(Nombre_Emisor,60) AS nombreEmisor,
       RFC_Receptor AS rfcReceptor, LEFT(Nombre_Receptor,60) AS nombreReceptor,
       CveTipoDeComprobante AS tipoComprobante, Serie AS serie, Folio AS folio,
       FecEmi AS fecEmi, CAST(ImpTot AS decimal(18,2)) AS total,
       CAST(ImpSubT AS decimal(18,2)) AS subtotal, CAST(ImpDscto AS decimal(18,2)) AS descuento,
       CveUsoCFDI AS usoCfdi, CveMetodoPago AS metodoPago, CveFormaPago AS formaPago, CveMoneda AS moneda
FROM ais.XMLDocsEnca
FOR JSON PATH
'@

Export-Json 'saldos' @'
SELECT c.Codigo AS cuenta, s.Ejercicio AS ejercicio, s.Tipo AS tipo,
       CAST(s.SaldoIni AS decimal(18,2)) AS saldoIni
FROM SaldosCuentas s JOIN Cuentas c ON c.Id = s.IdCuenta
ORDER BY c.Codigo, s.Ejercicio, s.Tipo
FOR JSON PATH
'@

Write-Output "== Listo. Paquete en $Out =="
