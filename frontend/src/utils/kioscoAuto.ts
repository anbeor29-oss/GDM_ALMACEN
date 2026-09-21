/**
 * Auto-entrada del CHECADOR en un equipo (kiosco/tableta/celular).
 *
 * OPT-IN y APARTE de la sesión normal —que vive en sessionStorage y se cierra al
 * cerrar la app, a propósito (requisito de negocio)—. Aquí se guardan las
 * credenciales del equipo en localStorage para volver a entrar SOLO al reabrir la
 * app y caer directo en el kiosco a checar.
 *
 * PENSADO PARA LA CUENTA «CHECADOR» (permisos mínimos: sólo registrar su
 * entrada/salida), en un equipo que la empresa controla. NO conviene activarlo
 * con una cuenta que alcance el ERP: quien tenga el equipo entraría a todo.
 *
 * El guardado va ofuscado en base64 —no es cifrado—: reduce el vistazo casual,
 * no protege de un ataque. Por eso importa que la cuenta sea la limitada.
 */
const KEY = 'checador-auto';

export function guardarKiosco(email: string, password: string): void {
  try {
    localStorage.setItem(KEY, btoa(unescape(encodeURIComponent(JSON.stringify({ email, password })))));
  } catch { /* sin localStorage: no se recuerda, y ya */ }
}

export function leerKiosco(): { email: string; password: string } | null {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const o = JSON.parse(decodeURIComponent(escape(atob(s))));
    return o && o.email && o.password ? o : null;
  } catch { return null; }
}

export function borrarKiosco(): void {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}

export function hayKiosco(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}
