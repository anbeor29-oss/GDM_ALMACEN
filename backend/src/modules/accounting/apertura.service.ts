/**
 * Póliza de APERTURA — los saldos iniciales de la contabilidad, tomados de la
 * balanza del sistema anterior.
 *
 * De la balanza leída se toman las HOJAS (cuentas de detalle con saldo propio) y
 * se arma UN asiento: cada cuenta deudora al CARGO y cada acreedora al ABONO, por
 * su `saldoFinal` (el saldo de cierre del sistema viejo = saldo inicial del nuevo).
 * Una balanza que cuadra da una póliza que cuadra.
 *
 * El código de cada cuenta de la balanza se liga a la cuenta REAL del catálogo por
 * su `codigo` (exacto, o comparando sólo los dígitos si el formato difiere). Lo que
 * no exista en el catálogo se reporta como FALTANTE —no se inventa ni se omite en
 * silencio—: el usuario lo ve en la previsualización antes de asentar.
 *
 * Idempotente por `origen_uuid = APERTURA:<fecha>`: reasentar la misma fecha no
 * duplica.
 */
import { query } from '../../config/database';
import { crearPoliza, LineaPoliza } from './polizas.service';
import { marcarHojas, type LecturaBalanza } from './balanza-lector.service';
import { ValidationError } from '../../middleware/errorHandler';

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const soloDigitos = (s: any) => String(s ?? '').replace(/[^0-9]/g, '');
const PREFIJO = 'APERTURA:';

interface LineaApertura extends LineaPoliza { codigo: string; nombre: string; }

/** Arma (sin escribir) la póliza de apertura desde una balanza ya leída. */
export async function armarApertura(companyId: string, lectura: LecturaBalanza, fecha: string) {
  const filas = marcarHojas(lectura.filas);
  const hojas = filas.filter((f) => f.hoja && Math.abs(Number(f.saldoFinal) || 0) > 0.005);

  // Catálogo de cuentas de movimiento, indexado por código exacto y por dígitos.
  const acc = await query<any>(
    `SELECT id, codigo, nombre FROM accounting_accounts
      WHERE company_id=$1 AND activa=true AND permite_movimientos=true`, [companyId]);
  const exacto = new Map<string, any>();
  const porDigitos = new Map<string, any>();
  for (const a of acc.rows) {
    exacto.set(String(a.codigo), a);
    const d = soloDigitos(a.codigo);
    if (d && !porDigitos.has(d)) porDigitos.set(d, a);
  }
  const resolver = (cuenta: string) => exacto.get(String(cuenta)) || porDigitos.get(soloDigitos(cuenta)) || null;

  const lineas: LineaApertura[] = [];
  const faltantes: Array<{ cuenta: string; nombre: string; saldo: number }> = [];
  for (const f of hojas) {
    const saldo = round2(f.saldoFinal);
    const cta = resolver(f.cuenta);
    if (!cta) { faltantes.push({ cuenta: f.cuenta, nombre: f.nombre, saldo }); continue; }
    // Deudora → cargo; acreedora → abono. Un saldo NEGATIVO va al lado contrario.
    const alCargo = (f.naturaleza === 'D') === (saldo >= 0);
    const imp = Math.abs(saldo);
    lineas.push({
      account_id: cta.id, codigo: cta.codigo, nombre: cta.nombre,
      concepto: 'Saldo inicial',
      ...(alCargo ? { cargo: imp } : { abono: imp }),
    });
  }

  const sumaCargo = round2(lineas.reduce((a, l) => a + (l.cargo || 0), 0));
  const sumaAbono = round2(lineas.reduce((a, l) => a + (l.abono || 0), 0));
  const diferencia = round2(sumaCargo - sumaAbono);
  return {
    fecha,
    encabezado: lectura.encabezado,
    lineas, faltantes,
    sumaCargo, sumaAbono, diferencia,
    hojas: hojas.length,
    cuadra: faltantes.length === 0 && Math.abs(diferencia) <= 0.02 && lineas.length > 0,
    yaGenerada: await existeApertura(companyId, fecha),
  };
}

async function existeApertura(companyId: string, fecha: string): Promise<boolean> {
  const q = await query(
    `SELECT 1 FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 LIMIT 1`,
    [companyId, PREFIJO + fecha]);
  return (q.rowCount || 0) > 0;
}

/** Crea la póliza de apertura. Idempotente por APERTURA:<fecha>. */
export async function generarApertura(companyId: string, lectura: LecturaBalanza, fecha: string, userId?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ValidationError('Fecha de apertura inválida (AAAA-MM-DD).');
  const armado = await armarApertura(companyId, lectura, fecha);
  if (armado.yaGenerada) return { creada: false, motivo: `Ya existía una póliza de apertura al ${fecha}.` };
  if (armado.faltantes.length > 0) {
    throw new ValidationError(
      `${armado.faltantes.length} cuenta(s) de la balanza no están en el catálogo. ` +
      `Impórtalo o créalas antes de asentar la apertura: ` +
      armado.faltantes.slice(0, 5).map((f) => f.cuenta).join(', ') + (armado.faltantes.length > 5 ? '…' : ''));
  }
  if (!armado.cuadra) {
    throw new ValidationError(`La apertura no cuadra: cargo ${armado.sumaCargo} vs abono ${armado.sumaAbono} (diferencia ${armado.diferencia}).`);
  }
  const poliza = await crearPoliza(companyId, {
    tipo: 'DIARIO', fecha,
    concepto: 'Póliza de apertura — saldos iniciales (balanza anterior)',
    origen: 'APERTURA', origen_uuid: PREFIJO + fecha, regla: 'apertura_v1',
    lineas: armado.lineas.map(({ account_id, cargo, abono, concepto }) => ({ account_id, cargo, abono, concepto })),
  }, userId);
  return { creada: true, poliza, asentadas: armado.lineas.length };
}
