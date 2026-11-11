/**
 * avisos.ts — diálogos CENTRADOS propios que reemplazan los nativos del navegador
 * (el `alert`/`confirm` que muestran «JavaScript de "https://…" dice»).
 *
 * Al IMPORTAR este módulo se sustituye `window.alert` por un aviso centrado (sólo
 * «Aceptar»), en toda la app y desde el arranque (no depende de montar ningún
 * componente). Para los «¿sí/no?» se usa `confirmar()` (asíncrono, «Aceptar»/«Cancelar»),
 * que reemplaza a `window.confirm` en los llamados —`confirm` es síncrono y no se puede
 * interceptar con un modal de React, por eso los llamados usan `await confirmar(...)`—.
 *
 * El componente `AvisoGlobal` (montado una vez en App) pinta el modal leyendo esta cola.
 */
export type Aviso =
  | { tipo: 'alert'; msg: string }
  | { tipo: 'confirm'; msg: string; resolve: (v: boolean) => void };

let cola: Aviso[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function encolar(a: Aviso) { cola = [...cola, a]; emit(); }

/** Para el componente AvisoGlobal: suscribirse, leer la cola y cerrar el de enfrente. */
export function _suscribir(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function _frente(): Aviso | undefined { return cola[0]; }
export function _cerrar(val: boolean): void {
  const a = cola[0];
  if (!a) return;
  cola = cola.slice(1);
  if (a.tipo === 'confirm') a.resolve(val);
  emit();
}

/** Aviso (reemplaza a alert): recuadro centrado con sólo «Aceptar». Fire-and-forget. */
export function avisar(msg: unknown): void { encolar({ tipo: 'alert', msg: msg == null ? '' : String(msg) }); }

/** Confirmación (reemplaza a confirm): recuadro centrado «Aceptar»/«Cancelar».
 *  Devuelve Promise<boolean>; úsalo como `if (await confirmar('¿…?')) { … }`. */
export function confirmar(msg: unknown): Promise<boolean> {
  return new Promise((resolve) => encolar({ tipo: 'confirm', msg: msg == null ? '' : String(msg), resolve }));
}

// Sustituye el `alert` NATIVO del navegador en TODA la app, desde este import (antes de
// que React pinte). Así cualquier `alert(...)` del código sale como modal centrado sin
// el encabezado «JavaScript de "https://…"». Se envuelve en try por entornos sin window.
try {
  if (typeof window !== 'undefined') {
    (window as any).alert = (msg?: unknown) => encolar({ tipo: 'alert', msg: msg == null ? '' : String(msg) });
  }
} catch { /* no-op */ }
