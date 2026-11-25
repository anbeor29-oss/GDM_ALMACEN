/**
 * Los formatos de PDF que OFRECE la pantalla tienen que ser los que SABE pintar
 * el backend.
 *
 * Por qué existe esta prueba: la lista vive en dos lados —FORMATOS_PDF aquí y
 * una lista escrita a mano en frontend/src/components/IssuerModal.tsx—. Ya
 * pasó con el módulo del checador: una lista copiada a mano se quedó corta y el
 * módulo existía pero nadie podía contratarlo, sin un solo error en ninguna
 * parte. Aquí el fallo sería del mismo tipo y igual de silencioso:
 *
 *   · si al frontend le FALTA una clave → el formato existe y nadie lo elige;
 *   · si le SOBRA una → se guarda en companies.pdf_formato una clave que el
 *     backend no conoce y getTema cae al tema por omisión, así que el usuario
 *     escoge un formato y le sale otro.
 *
 * Se lee el .tsx como TEXTO a propósito: el backend no compila el frontend, y
 * una prueba que importara React aquí no correría.
 */
import fs from 'fs';
import path from 'path';
import { FORMATOS_PDF, getTema } from './pdf-temas';

const MODAL = path.resolve(__dirname, '../../../../frontend/src/components/IssuerModal.tsx');

/** Claves del bloque de botones de formato del modal del emisor. */
function clavesDelFrontend(): string[] {
  const src = fs.readFileSync(MODAL, 'utf8');
  const i = src.indexOf('Formato de impresión (PDF)');
  expect(i).toBeGreaterThan(-1);                       // si cambió el título, hay que ajustar la prueba
  const bloque = src.slice(i, i + 2500);
  const fin = bloque.indexOf('].map((f)');
  expect(fin).toBeGreaterThan(-1);
  return Array.from(bloque.slice(0, fin).matchAll(/\{\s*key:\s*'([a-z]+)'/g)).map((m) => m[1]);
}

describe('formatos de PDF: pantalla y backend', () => {
  it('la pantalla ofrece exactamente los del catálogo', () => {
    const front = clavesDelFrontend();
    const back = FORMATOS_PDF.map((f) => f.key);
    expect(front.sort()).toEqual([...back].sort());
  });

  it('ninguna clave del catálogo cae al tema por omisión', () => {
    const porOmision = getTema('no-existe-esta-clave');
    for (const f of FORMATOS_PDF) {
      expect(getTema(f.key)).not.toBe(porOmision);
    }
  });

  it('cada formato trae nombre y color de muestra', () => {
    for (const f of FORMATOS_PDF) {
      expect(f.nombre.trim().length).toBeGreaterThan(0);
      expect(f.muestra).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('los seis formatos son distintos entre sí', () => {
    const claves = FORMATOS_PDF.map((f) => f.key);
    expect(new Set(claves).size).toBe(claves.length);
  });
});
