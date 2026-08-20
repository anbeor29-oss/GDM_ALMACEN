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

/* Una sola puerta.
 *
 * El acceso duplicado desde Tesorería se quitó al darle menú propio a los XML
 * del SAT: con la entrada de primer nivel ya no aportaba, y dos renglones que
 * llevan al mismo lado obligan a preguntarse si son lo mismo. */
const puertas = (sidebar.match(/to: '\/xml-sat\/recibidos'/g) || []).length;
puertas === 1
  ? bien('hay UNA sola entrada a los XML recibidos, sin caminos duplicados')
  : mal('el enlace está repetido en el menú', `${puertas} veces`);

!/atajo/.test(sidebar)
  ? bien('y no quedó maquinaria de atajos sin usar')
  : mal('el soporte de atajos sigue ahí sin nadie que lo use');

/* ── 6. Los permisos de pantalla se PREGUNTAN, no se adivinan ──
 *
 * Las pantallas escondían sus botones con reglas propias sobre el rol. Eso
 * falla de dos maneras y las dos ocurrieron: Tesorería y Recursos Humanos
 * viendo su pantalla sin un solo botón, o botones que el servidor rechaza.
 *
 * Y hay algo que el frontend NO puede adivinar: los otorgamientos individuales,
 * que son renglones en la base. Por eso se pregunta al servidor.
 */
const apiSrc = readFileSync('src/services/api.ts', 'utf8');
apiSrc.includes('mis-capacidades')
  ? bien('el frontend pregunta sus capacidades al servidor')
  : mal('nadie pregunta las capacidades: se estarían adivinando');

const pantallasConPermisos = [
  ['src/pages/nomina/Empleados.tsx',        'CAP.nomina'],
  ['src/pages/nomina/NominaCFDI.tsx',       'CAP.nomina'],
  ['src/pages/nomina/NominaCalculo.tsx',    'CAP.nomina'],
  ['src/pages/nomina/NominaParametros.tsx', 'CAP.nomina'],
  ['src/pages/Treasury.tsx',                'CAP.pagar'],
];

const adivinando = pantallasConPermisos.filter(([f]) =>
  readFileSync(f, 'utf8').includes("].includes(user?.role"));
adivinando.length === 0
  ? bien('ninguna de las cinco pantallas decide por el rol')
  : mal('estas pantallas siguen adivinando por rol', adivinando.map((x) => x[0]).join(', '));

const sinPreguntar = pantallasConPermisos.filter(([f, cap]) => {
  const t = readFileSync(f, 'utf8');
  return !(t.includes('useCapacidades') && t.includes(cap));
});
sinPreguntar.length === 0
  ? bien('las cinco preguntan por la capacidad que de verdad exige su API')
  : mal('estas no preguntan su capacidad', sinPreguntar.map((x) => x[0]).join(', '));

/* Que no quede la regla adivinada anterior dando vueltas sin usuarios. */
!readFileSync('src/utils/permissions.ts', 'utf8').includes('export function puedeMoverNomina')
  ? bien('la regla adivinada anterior se retiró, no quedó dando vueltas')
  : mal('puedeMoverNomina sigue ahí sin nadie que la use');

console.log(`\n${ok} bien, ${fallos} mal`);
process.exit(fallos ? 1 : 0);
