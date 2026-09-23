/**
 * Auto-asignar cuentas «de un tirón» — el motor asigna solo lo CLARO y deja lo
 * dudoso para que el usuario lo revise.
 *
 * «Claro» = la ClaveProdServ del producto casa por PREFIJO (≥ 4 dígitos = misma
 * familia del SAT) con una ya asignada → misma cuenta. Si la empresa siempre usa
 * UNA sola cuenta (un único código en las asignadas), se aplica esa. Lo que no
 * tiene match claro queda PENDIENTE (dudoso), nunca se inventa.
 *
 * Es la versión servidor del match que hacía el frontend, pero recorriendo TODOS
 * los productos del periodo de un jalón (ventas y compras), y de paso genera las
 * subcuentas de terceros (clientes/proveedores).
 */
import {
  clavesProdServDeEmitidos, asignarCuentaProducto, sugerenciasCuenta,
} from './ventas-cuentas.service';
import { clavesProdServDeRecibidos, asignarCuentaProductoCompra } from './compras-cuentas.service';
import { generarSubcuentasDeComprobantes } from './catalogo-terceros.service';

export interface AutoAsignarResultado {
  asignadas: number;
  pendientes: Array<{ clave: string; descripcion: string; importe: number }>;
  total: number;
}

/** Longitud del prefijo común más largo entre dos ClaveProdServ. */
function prefijoComun(a: string, b: string): number {
  const x = String(a), y = String(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

/**
 * Asigna la cuenta a los productos del periodo cuyo match es CLARO. Devuelve
 * cuántas asignó y la lista de PENDIENTES (dudosos) para revisar a mano.
 */
export async function autoAsignarCuentasProducto(
  companyId: string, direccion: 'ventas' | 'compras', anio: number, mes: number,
): Promise<AutoAsignarResultado> {
  const productos = direccion === 'compras'
    ? await clavesProdServDeRecibidos(companyId, anio, mes)
    : await clavesProdServDeEmitidos(companyId, anio, mes);

  const { asignadas, dominante } = await sugerenciasCuenta(companyId, direccion);
  const distintas = new Set(asignadas.map((a) => a.cuenta));
  const guardar = direccion === 'compras' ? asignarCuentaProductoCompra : asignarCuentaProducto;

  let n = 0;
  const pendientes: AutoAsignarResultado['pendientes'] = [];
  for (const p of productos) {
    if (p.cuenta) continue;                    // ya tiene cuenta: no se toca

    // Mejor cuenta por prefijo de familia SAT.
    let best: string | null = null, bestLen = -1;
    for (const a of asignadas) {
      const l = prefijoComun(p.clave, a.clave);
      if (l > bestLen) { bestLen = l; best = a.cuenta; }
    }

    let cuenta: string | null = null;
    if (best && bestLen >= 4) cuenta = best;                 // misma familia SAT → claro
    else if (distintas.size === 1 && dominante) cuenta = dominante;  // empresa de una sola cuenta

    if (cuenta) { await guardar(companyId, p.clave, p.descripcion || null, cuenta); n++; }
    else pendientes.push({ clave: p.clave, descripcion: p.descripcion || '', importe: p.importe });
  }
  return { asignadas: n, pendientes, total: productos.length };
}

/**
 * «De un tirón» completo: auto-asigna cuentas de VENTAS y COMPRAS del periodo y
 * genera las subcuentas de terceros (clientes + proveedores). Deja listo el
 * terreno para «Generar pólizas»; sólo quedan por revisar los productos dudosos.
 */
export async function autoAsignarTodo(companyId: string, anio: number, mes: number) {
  const ventas = await autoAsignarCuentasProducto(companyId, 'ventas', anio, mes);
  const compras = await autoAsignarCuentasProducto(companyId, 'compras', anio, mes);
  let subClientes = { creadas: 0, existentes: 0 };
  let subProveedores = { creadas: 0, existentes: 0 };
  try { const c = await generarSubcuentasDeComprobantes(companyId, 'emitidos'); subClientes = { creadas: c.creadas, existentes: c.existentes }; } catch { /* sin cuenta de control: no crítico */ }
  try { const p = await generarSubcuentasDeComprobantes(companyId, 'recibidos'); subProveedores = { creadas: p.creadas, existentes: p.existentes }; } catch { /* idem */ }
  return { ventas, compras, subClientes, subProveedores };
}
