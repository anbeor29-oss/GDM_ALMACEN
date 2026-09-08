/**
 * Reportes ESPECIALES de contabilidad — versiones "de diagnóstico" del estado de
 * situación financiera y de la balanza, agrupadas por CUENTA CONTABLE y por DÍGITO
 * AGRUPADOR del SAT, para ver DÓNDE está el error (una cuenta sin agrupador, o con un
 * agrupador que la manda al rubro equivocado, descuadra el balance sin descuadrar
 * ninguna póliza).
 *
 * No calculan nada nuevo: reusan la balanza del periodo y el contexto NIF; sólo los
 * re-agrupan para exponer la relación cuenta ↔ agrupador ↔ rubro.
 */
import { query } from '../../config/database';
import { balanzaDelPeriodo, contextoDelPeriodo } from './periodos.service';
import { situacionFinanciera, resultadoIntegral } from './estados-financieros.service';
import { enRubro, seccionDe } from './validacion-contable.service';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

/** Le pone nombre a cada agrupador (Anexo 24) para poder leerlo en el reporte. */
async function nombresAgrupadores(codigos: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(codigos.filter(Boolean) as string[])];
  if (!uniq.length) return new Map();
  const r = await query<any>(
    `SELECT codigo, nombre FROM sat_codigos_agrupadores WHERE codigo = ANY($1)`, [uniq]);
  return new Map(r.rows.map((x: any) => [x.codigo, x.nombre]));
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. BALANZA ESPECIAL — cada cuenta con su agrupador, agrupadas por agrupador
   ═══════════════════════════════════════════════════════════════════════════ */
export async function balanzaEspecial(companyId: string, anio: number, mes: number) {
  const bz = await balanzaDelPeriodo(companyId, anio, mes);
  if (!bz) return null;
  const nombres = await nombresAgrupadores(bz.filas.map((f: any) => f.codigo_agrupador));

  const map = new Map<string, any>();
  for (const f of bz.filas) {
    const agr = f.codigo_agrupador || '';
    const key = agr || '(sin agrupador)';
    if (!map.has(key)) {
      map.set(key, {
        agrupador: agr, agrupadorNombre: agr ? (nombres.get(agr) || '') : '',
        sinAgrupador: !agr, cuentas: [],
        saldoInicial: 0, cargos: 0, abonos: 0, saldoFinal: 0,
      });
    }
    const g = map.get(key);
    g.cuentas.push({
      codigo: f.codigo, nombre: f.nombre, naturaleza: f.naturaleza, nivel: f.nivel,
      saldoInicial: r2(f.saldo_inicial), cargos: r2(f.cargos), abonos: r2(f.abonos), saldoFinal: r2(f.saldo_final),
    });
    g.saldoInicial = r2(g.saldoInicial + Number(f.saldo_inicial));
    g.cargos = r2(g.cargos + Number(f.cargos));
    g.abonos = r2(g.abonos + Number(f.abonos));
    g.saldoFinal = r2(g.saldoFinal + Number(f.saldo_final));
  }

  // Los "sin agrupador" primero (es lo que hay que corregir), luego por código.
  const grupos = [...map.values()].sort((a, b) =>
    a.sinAgrupador ? -1 : b.sinAgrupador ? 1
      : String(a.agrupador).localeCompare(String(b.agrupador), 'es', { numeric: true }));

  return {
    anio, mes,
    grupos,
    sumaCargos: r2(bz.sumaCargos), sumaAbonos: r2(bz.sumaAbonos), cuadra: bz.cuadra,
    sinAgrupador: grupos.filter((g) => g.sinAgrupador).reduce((a, g) => a + g.cuentas.length, 0),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. SITUACIÓN FINANCIERA ESPECIAL — por sección → agrupador → cuenta contable
   ═══════════════════════════════════════════════════════════════════════════ */
export async function situacionEspecial(companyId: string, anio: number, mes: number) {
  const ctx = await contextoDelPeriodo(companyId, anio, mes);
  if (!ctx) return null;

  const nombres = await nombresAgrupadores(ctx.saldos.map((s) => s.agrupador));

  // Cifras OFICIALES (las que salen del estado probado), para el encabezado de cuadre.
  const bal = situacionFinanciera(ctx);
  const res = resultadoIntegral(ctx);
  const oficial = {
    activo: r2(bal.activoTotal),
    pasivoMasCapital: r2(bal.pasivoTotal + bal.capitalTotal),
    diferencia: r2(bal.diferencia),
    cuadra: bal.cuadra,
    utilidad: r2(res.utilidadNeta),
  };

  // Cada saldo con su sección (por 1er dígito del agrupador) y si cae en algún rubro.
  const filas = ctx.saldos
    .filter((s) => Math.abs(Number(s.saldo)) >= 0.005)
    .map((s) => ({
      codigo: s.cuenta, nombre: s.nombre, naturaleza: s.naturaleza,
      agrupador: s.agrupador || '', agrupadorNombre: s.agrupador ? (nombres.get(s.agrupador) || '') : '',
      saldo: r2(s.saldo),
      seccion: s.agrupador ? seccionDe(s.agrupador) : 'Otro',
      enRubro: !!s.agrupador && enRubro(s.agrupador),
    }));

  const SECCIONES = ['Activo', 'Pasivo', 'Capital', 'Resultado'];
  const secciones = SECCIONES.map((sec) => {
    const delSec = filas.filter((f) => f.seccion === sec && f.enRubro);
    const gmap = new Map<string, any>();
    for (const f of delSec) {
      if (!gmap.has(f.agrupador)) gmap.set(f.agrupador, { agrupador: f.agrupador, agrupadorNombre: f.agrupadorNombre, cuentas: [], subtotal: 0 });
      const g = gmap.get(f.agrupador);
      g.cuentas.push({ codigo: f.codigo, nombre: f.nombre, naturaleza: f.naturaleza, saldo: f.saldo });
      g.subtotal = r2(g.subtotal + f.saldo);
    }
    const grupos = [...gmap.values()].sort((a, b) =>
      String(a.agrupador).localeCompare(String(b.agrupador), 'es', { numeric: true }));
    return { seccion: sec, grupos, total: r2(grupos.reduce((a, g) => a + g.subtotal, 0)) };
  });

  // Lo que descuadra: cuentas con saldo que no llegan a ningún rubro (sin agrupador,
  // o con un mayor que cae en un hueco de los rangos del estado — 605, 305, etc.).
  const fueraDeRubro = filas
    .filter((f) => !f.enRubro)
    .map((f) => ({ codigo: f.codigo, nombre: f.nombre, agrupador: f.agrupador, agrupadorNombre: f.agrupadorNombre, saldo: f.saldo, seccion: f.seccion }))
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));

  return { anio, mes, oficial, secciones, fueraDeRubro };
}
