/**
 * revisar-componentes-anidados — que ningún componente se defina dentro de otro.
 *
 * QUÉ BUG ESTÁ CUIDANDO
 * En el alta de trabajador no se podía escribir una palabra completa: el cursor
 * se salía del campo a cada letra y había que hacer clic para cada una.
 *
 * La causa era ésta: `Campo` y `Selector` estaban definidos DENTRO de
 * `EmpleadoModal`. Cada render creaba un tipo de componente nuevo, así que
 * React no podía saber que el <input> de este render era el mismo del anterior
 * —lo desmontaba y lo volvía a montar— y un input recién montado no tiene el
 * foco.
 *
 * Es un error que no rompe la compilación, no lanza ningún aviso en consola y
 * sólo se descubre escribiendo. Por eso hay un guardián y no sólo un comentario.
 *
 *   node scripts/revisar-componentes-anidados.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(RAIZ, 'src');

function archivos(dir) {
  const salida = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) salida.push(...archivos(p));
    else if (/\.(tsx|jsx)$/.test(n)) salida.push(p);
  }
  return salida;
}

/* Un componente se reconoce por dos cosas juntas: nombre en Mayúscula y que
 * devuelva JSX. Buscar sólo el nombre marcaría cualquier constante; buscar sólo
 * el JSX marcaría los helpers que devuelven un fragmento y se llaman con
 * paréntesis, que no tienen este problema porque no son un tipo de componente.
 *
 * La indentación es lo que dice "está dentro de algo": a nivel de módulo, una
 * declaración empieza en la columna cero. */
const ANIDADO = /^[ \t]+(?:const|let)\s+([A-Z][A-Za-z0-9]*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]+)?=>\s*(?:\(|<)/;
const ANIDADO_FN = /^[ \t]+function\s+([A-Z][A-Za-z0-9]*)\s*\(/;

let hallazgos = 0;

for (const f of archivos(SRC)) {
  const texto = readFileSync(f, 'utf8');
  const lineas = texto.split('\n');
  lineas.forEach((linea, i) => {
    const m = ANIDADO.exec(linea) || ANIDADO_FN.exec(linea);
    if (!m) return;

    /* El daño lo hace usarlo COMO ETIQUETA —`<F />`—: ahí React lo trata como
     * un tipo de componente y lo remonta en cada render. Llamarlo como función
     * —`{F('RFC','rfc')}`— inserta el JSX en el árbol del padre sin crear tipo
     * nuevo: eso NO tiene el problema, y marcarlo sería mandar a "arreglar"
     * algo que ya está bien. */
    const comoEtiqueta = new RegExp('<' + m[1] + '[\\s/>]').test(texto);
    if (!comoEtiqueta) return;

    hallazgos++;
    console.log(
      `  MAL ${relative(RAIZ, f)}:${i + 1} — "${m[1]}" está definido dentro de otro ` +
      'componente: React lo remonta en cada render y los campos pierden el foco.'
    );
  });
}

if (hallazgos === 0) {
  console.log('  OK  ningún componente definido dentro de otro');
  process.exit(0);
}
console.log(
  `\n${hallazgos} componente(s) anidado(s). Sácalos al nivel del módulo y pásales ` +
  'por props lo que tomaban del cierre.'
);
process.exit(1);
