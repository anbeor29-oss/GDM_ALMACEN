/**
 * revisar-rutas-auditoria — que cada pestaña de Auditoría tenga su dirección.
 *
 * QUÉ CUIDA
 * La pestaña de Auditoría dejó de ser estado local para vivir en la URL. Eso es
 * lo que permite enlazar "XML del SAT" desde el menú —y desde Tesorería— sin
 * obligar a entrar a Auditoría y buscar la pestaña.
 *
 * Son tres piezas que tienen que coincidir, y están en tres archivos distintos:
 * la ruta en App.tsx, la lectura de la URL en la página, y el destino de los
 * enlaces del sidebar. Si una se mueve sin las otras, el enlace lleva a la
 * pestaña equivocada o a una página en blanco — y eso no lo detecta el
 * compilador, porque son cadenas de texto.
 *
 *   node scripts/revisar-rutas-auditoria.mjs
 */
import { readFileSync } from 'node:fs';

let ok = 0, fallos = 0;
const bien = (q) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q, d) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };

const app      = readFileSync('src/App.tsx', 'utf8');
const pagina   = readFileSync('src/pages/Auditoria.tsx', 'utf8');
const sidebar  = readFileSync('src/components/Layout.tsx', 'utf8');

const RUTAS = [
  ['auditoria',          'emitidos'],
  ['auditoria/xml-sat',  'recibidos'],
  ['auditoria/69b',      'lista69b'],
];

/* ── 1. Las tres rutas existen ── */
for (const [ruta] of RUTAS) {
  app.includes(`path="${ruta}"`)
    ? bien(`la ruta /${ruta} está registrada`)
    : mal(`falta la ruta /${ruta} en App.tsx`);
}

/* ── 2. Las tres apuntan a la MISMA página ──
 * Si alguien duplicara el componente, las pestañas se irían separando y un día
 * dirían cosas distintas. */
const conAuditoria = (app.match(/path="auditoria[^"]*"[^>]*element=\{[^}]*AuditoriaPage/g) || []).length;
conAuditoria === 3
  ? bien('las tres rutas usan la misma AuditoriaPage: una pantalla, tres direcciones')
  : mal('alguna ruta de auditoría no apunta a AuditoriaPage', conAuditoria);

/* ── 3. La página sabe leer las tres ── */
pagina.includes("endsWith('/xml-sat')")
  ? bien('la página reconoce /xml-sat y abre la pestaña de descarga')
  : mal('la página no lee /xml-sat de la URL');

pagina.includes("endsWith('/69b')")
  ? bien('la página reconoce /69b')
  : mal('la página no lee /69b de la URL');

/* Y que el clic en la pestaña CAMBIE la URL: si no, la dirección se queda
 * atrás y compartir el enlace lleva a otra pestaña. */
pagina.includes("navigate('/auditoria/xml-sat')") ||
pagina.includes("'/auditoria/xml-sat'")
  ? bien('cambiar de pestaña cambia la dirección — el enlace se puede compartir')
  : mal('las pestañas no navegan: la URL se quedaría atrás');

/* ── 4. El sidebar apunta a donde debe ── */
sidebar.includes("to: '/auditoria/xml-sat'")
  ? bien('el sidebar enlaza los XML del SAT directo')
  : mal('el sidebar no tiene el enlace a /auditoria/xml-sat');

const veces = (sidebar.match(/to: '\/auditoria\/xml-sat'/g) || []).length;
veces === 2
  ? bien('está en los DOS menús: Auditoría (su casa) y Tesorería (atajo)')
  : mal('no está en los dos menús', `${veces} enlace(s)`);

/* ── 5. El de Tesorería va marcado como atajo ──
 * Sin eso, estando en esa pantalla se resaltarían dos renglones del menú a la
 * vez y ninguno diría dónde está uno. */
/atajo:\s*true/.test(sidebar)
  ? bien('el de Tesorería va marcado como atajo: no roba el resaltado de activo')
  : mal('el enlace de Tesorería no está marcado como atajo');

console.log(`\n${ok} bien, ${fallos} mal`);
process.exit(fallos ? 1 : 0);
