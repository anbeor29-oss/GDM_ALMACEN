/**
 * Un módulo que el backend sabe cobrar pero que nadie puede ENCENDER no existe.
 *
 * Eso le pasó al **checador**. `requireModule('checador')` bloqueaba sus rutas
 * con «Esta empresa no tiene habilitado este módulo», y la clave faltaba en
 * CUATRO listas escritas a mano, en dos repos:
 *
 *   1. `MODULOS_VALIDOS` (admin-companies.routes) — filtraba la clave AL
 *      GUARDAR, así que la empresa nunca podía contratarlo y el guardado
 *      contestaba éxito. Ésta era la decisiva.
 *   2. `MODS_TOGGLE` (AdminCompanies.tsx) — la casilla no existía en la tabla.
 *   3. `MODULE_LABELS` (permissions.ts del front) — tampoco en el modal de
 *      «Editar empresa», que construye sus casillas de ahí.
 *   4. `ModuleKey`/`ALL_MODULES` del front — la clave no existía en el
 *      vocabulario de la interfaz.
 *
 * (1) ya no se puede repetir: se deriva de `ALL_MODULES`. Las del frontend sí,
 * porque son otro archivo y otra compilación — y esta prueba las vigila.
 *
 * Es ESTRUCTURAL: lee los archivos, no levanta nada. La regla es de catálogo,
 * no de ejecución.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ALL_MODULES } from './middleware/permissions';

const FRONT = path.join(__dirname, '..', '..', 'frontend', 'src');
const PERMISOS_FRONT = path.join(FRONT, 'utils', 'permissions.ts');
const ADMIN_EMPRESAS = path.join(FRONT, 'pages', 'AdminCompanies.tsx');

/** Las claves de un arreglo literal `const <nombre> ... = [ 'a', 'b' ];` */
function clavesDeArreglo(src: string, nombre: string): string[] {
  const m = src.match(new RegExp(`${nombre}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

/** Las claves `k: 'valor'` de MODS_TOGGLE. */
function clavesDeTabla(src: string): string[] {
  const m = src.match(/MODS_TOGGLE:[^=]*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  return [...m[1].matchAll(/\{\s*k:\s*'([a-z_]+)'/g)].map((x) => x[1]);
}

/** Las claves de MODULE_LABELS. */
function clavesDeEtiquetas(src: string): string[] {
  const m = src.match(/MODULE_LABELS[^=]*=\s*\{([\s\S]*?)\};/);
  if (!m) return [];
  return [...m[1].matchAll(/([a-z_]+)\s*:/g)].map((x) => x[1]);
}

/* 'dashboard' y 'xml_reader' NUNCA se restringen por empresa (la lista SIEMPRE
 * de requireModule), así que no tienen por qué ser contratables. */
const NO_CONTRATABLES = ['dashboard', 'xml_reader'];
const CONTRATABLES = ALL_MODULES.filter((m) => !NO_CONTRATABLES.includes(m));

describe('todo módulo con gate se puede contratar', () => {
  const srcPermisos = fs.readFileSync(PERMISOS_FRONT, 'utf8');
  const srcAdmin = fs.readFileSync(ADMIN_EMPRESAS, 'utf8');

  const enFront = clavesDeArreglo(srcPermisos, 'ALL_MODULES');
  const enEtiquetas = clavesDeEtiquetas(srcPermisos);
  const enTabla = clavesDeTabla(srcAdmin);

  it('las tres listas del frontend se leyeron', () => {
    // Si alguna sale vacía, cambió la forma del archivo y la prueba dejó de
    // mirar lo que cree mirar: entonces no protege nada.
    expect(enFront.length).toBeGreaterThan(0);
    expect(enEtiquetas.length).toBeGreaterThan(0);
    expect(enTabla.length).toBeGreaterThan(0);
  });

  it.each(CONTRATABLES)('«%s» existe en el vocabulario del frontend', (mod) => {
    expect({ modulo: mod, enALL_MODULES: enFront.includes(mod) })
      .toEqual({ modulo: mod, enALL_MODULES: true });
  });

  it.each(CONTRATABLES)('«%s» tiene etiqueta legible (modal Editar empresa)', (mod) => {
    expect({ modulo: mod, enMODULE_LABELS: enEtiquetas.includes(mod) })
      .toEqual({ modulo: mod, enMODULE_LABELS: true });
  });

  it.each(CONTRATABLES)('«%s» tiene casilla en la tabla de empresas', (mod) => {
    expect({ modulo: mod, enMODS_TOGGLE: enTabla.includes(mod) })
      .toEqual({ modulo: mod, enMODS_TOGGLE: true });
  });
});
