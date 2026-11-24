/**
 * El montaje de rutas tiene una regla que no se ve leyendo un archivo solo, y
 * que ya costó un módulo entero: EL STOREFRONT PÚBLICO.
 *
 * En Express, un router montado en la RAÍZ de la API (`app.use('/api/v1', r)`)
 * recibe TODO lo que entra a `/api/v1`, no sólo sus propias rutas. Si ese
 * router hace `router.use(authenticateToken)`, el middleware corre para cada
 * petición de la API —exista o no la ruta ahí dentro— y responde 401 ANTES de
 * que la cadena llegue a los routers montados después.
 *
 * Síntoma real: `/api/v1/storefront/*` —la tienda del comprador, que es
 * pública por diseño— contestaba `{"success":false,"message":"No token
 * provided"}`, hasta en las <img> de los productos. El router del storefront
 * estaba bien escrito y bien montado; moría antes de que lo llamaran.
 *
 * Efecto colateral: cualquier ruta inexistente devolvía 401 en vez de 404, con
 * lo que al diagnosticar no se podía distinguir "no está desplegado" de "está
 * protegido".
 *
 * Esta prueba es ESTRUCTURAL —lee el código, no levanta el servidor— porque la
 * suite no toca base de datos. Vale igual: la regla es de montaje, no de
 * ejecución.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname);
const APP = fs.readFileSync(path.join(SRC, 'app.ts'), 'utf8');

/** Nombre de cada router montado en la RAÍZ `/api/v1`, sin sub-ruta. */
function routersEnLaRaiz(): string[] {
  const re = /app\.use\(\s*`\/api\/\$\{config\.apiVersion\}`\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(APP)) !== null) out.push(m[1]);
  return out;
}

/** El código sin comentarios: las notas de este repo CITAN
 *  `router.use(authenticateToken)` para explicar por qué no se usa, y un
 *  detector que lee comentarios acusa justo a quien documentó el arreglo. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Ruta en disco del módulo del que se importa `nombre` en app.ts. */
function archivoDe(nombre: string): string | null {
  const re = new RegExp(`import\\s+${nombre}\\s+from\\s+'\\.\\/([^']+)'`);
  const m = APP.match(re);
  return m ? path.join(SRC, `${m[1]}.ts`) : null;
}

describe('montaje de rutas en la raíz de la API', () => {
  const enLaRaiz = routersEnLaRaiz();

  it('encuentra los routers montados en la raíz', () => {
    // Si esto queda vacío es que cambió la forma de montar y la prueba dejó de
    // mirar lo que cree mirar: entonces no protege nada y hay que arreglarla.
    expect(enLaRaiz.length).toBeGreaterThan(0);
  });

  it.each(enLaRaiz)(
    '%s no exige token para TODA la API con router.use(authenticateToken)',
    (nombre) => {
      const archivo = archivoDe(nombre);
      if (!archivo || !fs.existsSync(archivo)) return; // no es un router propio
      const src = sinComentarios(fs.readFileSync(archivo, 'utf8'));
      const culpable = /router\.use\(\s*authenticateToken\s*\)/.test(src);
      expect({ router: nombre, autenticaTodaLaApi: culpable })
        .toEqual({ router: nombre, autenticaTodaLaApi: false });
    },
  );
});

describe('storefront público', () => {
  const ARCHIVO = path.join(SRC, 'modules/ecommerce/ecommerce-storefront.routes.ts');

  it('no exige login: es la tienda que ve el comprador', () => {
    const src = sinComentarios(fs.readFileSync(ARCHIVO, 'utf8'));
    expect(/router\.use\(\s*authenticateToken\s*\)/.test(src)).toBe(false);
  });

  it('sirve la imagen del producto sin sesión (va en un <img src>)', () => {
    const src = fs.readFileSync(ARCHIVO, 'utf8');
    // La ruta existe y su handler no pide comprador: un <img> no manda headers.
    const m = src.match(/router\.get\('\/img\/:mediaId',([\s\S]*?)\n\}\)\);/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/requiereComprador/);
  });
});
