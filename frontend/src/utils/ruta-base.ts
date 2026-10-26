/**
 * ruta-base.ts — antepone la base del despliegue a una ruta de la app para las
 * navegaciones DURAS (window.location.href).
 *
 * POR QUE EXISTE
 * En hcgm.com.mx la app NO vive en la raiz sino en "/erp/" (Vite base "/erp/", y
 * el Router usa import.meta.env.BASE_URL como basename). Por eso navigate('/x')
 * cae bien en "/erp/x" del lado del cliente, pero un window.location.href = '/x'
 * apunta a la RAIZ del dominio (hcgm.com.mx/x), FUERA de la app, y el servidor
 * responde 404. Pasaba con "Panel fiscal": abria "/contabilidad/panel-fiscal"
 * en vez de "/erp/contabilidad/panel-fiscal".
 *
 * conBase('/contabilidad/panel-fiscal') -> '/erp/contabilidad/panel-fiscal'
 * (o '/contabilidad/panel-fiscal' cuando la base es '/').
 */
export function conBase(ruta: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const p = ruta.startsWith('/') ? ruta : `/${ruta}`;
  return base + p;
}
