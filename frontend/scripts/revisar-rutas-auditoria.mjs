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

/* ── 6. La nómina: el candado y la cortesía ──
 *
 * El servidor la protege con la capacidad `nomina:manage`. La pantalla esconde
 * sus botones con la MISMA regla. Si una de las dos se queda con el rol, pasa
 * una de dos cosas y las dos son malas: Recursos Humanos ve las pantallas sin
 * un solo botón, o ve los botones y cada clic le responde "no tienes permiso".
 */
const utilPerm = readFileSync('src/utils/permissions.ts', 'utf8');
utilPerm.includes('export function puedeMoverNomina')
  ? bien('la regla de quién mueve la nómina vive en un solo lugar')
  : mal('falta puedeMoverNomina en utils/permissions');

/* Y que la regla NOMBRE a Recursos Humanos. Si alguien "simplifica" el ayudante
 * a sólo administradores, RH vuelve a ver sus pantallas sin un botón — y esta
 * vez sin ningún mensaje de error que lo delate, porque el servidor sí los
 * dejaría pasar. */
utilPerm.includes('RECURSOS_HUMANOS') && utilPerm.includes('ADMIN_ALL')
  ? bien('y esa regla incluye a RECURSOS_HUMANOS, que es quien captura la nómina')
  : mal('la regla dejó fuera a RH: sus pantallas quedarían sin botones');

const pantallasNomina = [
  'src/pages/nomina/Empleados.tsx',
  'src/pages/nomina/NominaCFDI.tsx',
  'src/pages/nomina/NominaCalculo.tsx',
  'src/pages/nomina/NominaParametros.tsx',
];
const porRol = pantallasNomina.filter((f) =>
  readFileSync(f, 'utf8').includes("esAdmin = ['ADMIN'"));
porRol.length === 0
  ? bien('las cuatro pantallas de nómina preguntan por la capacidad, no por el rol')
  : mal('estas pantallas siguen escondiendo botones por rol', porRol.join(', '));

console.log(`\n${ok} bien, ${fallos} mal`);
process.exit(fallos ? 1 : 0);
