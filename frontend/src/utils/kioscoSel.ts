/**
 * Qué KIOSCO es ESTE equipo. Se elige una vez en la tableta y se guarda en su
 * localStorage; a partir de ahí cada checada se manda con ese `kioscoId` para que
 * el registro sepa EN QUÉ CENTRO se marcó. Es por-dispositivo (como la
 * auto-entrada del checador), no viaja al servidor ni a otros equipos.
 */
const KEY = 'checador-kiosco-sel';

export interface KioscoSel { id: string; nombre: string; }

export function guardarKioscoSel(id: string, nombre: string): void {
  try { localStorage.setItem(KEY, JSON.stringify({ id, nombre })); } catch { /* sin localStorage: no se recuerda */ }
}

export function leerKioscoSel(): KioscoSel | null {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const o = JSON.parse(s);
    return o && o.id ? o : null;
  } catch { return null; }
}

export function borrarKioscoSel(): void {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}
