/**
 * revisar-rutas-auditoria — que "XML del SAT" y sus dos submenús lleven a algo.
 *
 * QUÉ CUIDA
 * La descarga de XML del SAT tiene menú propio, con dos entradas —recibidos y
 * emitidos— porque son consultas distintas al SAT y responden preguntas
 * distintas.
 *
 * Son piezas en archivos distintos: la ruta en App.tsx, la lectura de la
 * dirección en la página, el prop que la recibe en el componente, y el destino
 * de los enlaces del sidebar. Todas unidas por CADENAS DE TEXTO. Si una se
 * mueve sin las otras, el enlace lleva a la pantalla equivocada o a una página
 * en blanco — y eso no lo detecta el compilador.
 *
 *   node scripts/revisar-rutas-auditoria.mjs
 */
import { readFileSync } from 'node:fs';

let ok = 0, fallos = 0;
const bien = (q) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q, d) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };

const app       = readFileSync('src/App.tsx', 'utf8');
const pagina    = readFileSync('src/pages/XmlDelSat.tsx', 'utf8');
const componente= readFileSync('src/components/XmlRecibidos.tsx', 'utf8');
const auditoria = readFileSync('src/pages/Auditoria.tsx', 'utf8');
const sidebar   = readFileSync('src/components/Layout.tsx', 'utf8');

/* ── 1. Las tres rutas ── */
for (const ruta of ['xml-sat', 'xml-sat/recibidos', 'xml-sat/emitidos']) {
  app.includes(`path="${ruta}"`)
    ? bien(`la ruta /${ruta} está registrada`)
    : mal(`falta la ruta /${ruta} en App.tsx`);
}

const conXml = (app.match(/path="xml-sat[^"]*"[^>]*element=\{[^}]*XmlDelSatPage/g) || []).length;
conXml === 3
  ? bien('las tres usan la misma XmlDelSatPage: una pantalla, tres direcciones')
  : mal('alguna ruta de xml-sat no apunta a XmlDelSatPage', conXml);

/* ── 2. La página distingue emitidos de recibidos ──
 * Si no lo hiciera, los dos submenús abrirían lo mismo y uno de los dos
 * sobraría — sin que nada fallara. */
pagina.includes("endsWith('/emitidos')")
  ? bien('la página lee la dirección de la URL')
  : mal('la página no distingue emitidos de recibidos');

pagina.includes('direccionInicial={direccion}')
  ? bien('y se la pasa al componente')
  : mal('la dirección no llega al componente');

componente.includes('direccionInicial')
  ? bien('el componente acepta la dirección inicial')
  : mal('XmlRecibidos no recibe direccionInicial');

componente.includes("useState<'recibidos' | 'emitidos' | 'ambos'>(direccionInicial || 'recibidos')")
  ? bien('y arranca con ella — entrar por "emitidos" abre en emitidos')
  : mal('el estado inicial ignora la dirección recibida');

/* ── 3. Una sola implementación ──
 * Dos copias de una pantalla que habla con el SAT terminan divergiendo justo en
 * el manejo de errores, que es lo último que alguien revisa. */
pagina.includes("from '@/components/XmlRecibidos'") &&
auditoria.includes('XmlRecibidos')
  ? bien('Auditoría y el menú propio usan el MISMO componente, no una copia')
  : mal('la pantalla está duplicada entre Auditoría y XML del SAT');

/* ── 4. Auditoría quedó como estaba ── */
auditoria.includes("useState<'emitidos' | 'recibidos' | 'lista69b'>('emitidos')")
  ? bien('Auditoría conserva sus tres pestañas en estado local, como antes')
  : mal('Auditoría no volvió a su versión anterior');

!app.includes('path="auditoria/xml-sat"')
  ? bien('y ya no tiene rutas por pestaña')
  : mal('quedaron rutas de pestaña en Auditoría');

/* ── 5. El sidebar ── */
sidebar.includes("label=\"XML del SAT\"")
  ? bien('el sidebar tiene el menú "XML del SAT"')
  : mal('falta el menú XML del SAT en el sidebar');

sidebar.includes("label: 'XML recibidos'") && sidebar.includes("label: 'XML emitidos'")
  ? bien('con sus dos submenús: recibidos y emitidos')
  : mal('faltan los submenús de recibidos/emitidos');

/* El de Tesorería sigue siendo un ATAJO: si tomara el resaltado de activo, se
 * marcarían dos renglones del menú a la vez y ninguno diría dónde está uno. */
/atajo:\s*true/.test(sidebar)
  ? bien('el acceso desde Tesorería sigue marcado como atajo')
  : mal('el atajo de Tesorería perdió su marca');

console.log(`\n${ok} bien, ${fallos} mal`);
process.exit(fallos ? 1 : 0);
