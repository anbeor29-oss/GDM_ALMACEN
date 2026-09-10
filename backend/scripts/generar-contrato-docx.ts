/**
 * Regenera el borrador Word del contrato DESDE la única fuente de verdad:
 * `src/modules/contracts/contract-text.ts`. Así el .docx nunca se desincroniza
 * del texto que realmente se firma.
 *
 *   npm run docs:contrato        (corre en TU PowerShell, no en Render)
 *
 * Produce `docs/CONTRATO_TYC_BORRADOR.docx`. Es un BORRADOR de referencia: los
 * datos del cliente y la fecha van como marcadores (`[RFC DEL CLIENTE]`, etc.).
 * El documento legal real lo arma `buildContractText` con los datos reales y se
 * firma con la e.firma; este .docx solo sirve para revisión/impresión interna.
 *
 * El texto fuente viene envuelto a ~72 columnas. Aquí se RE-FLUYE a párrafos de
 * verdad (se unen las líneas de una misma oración), se justifica el cuerpo y se
 * respetan títulos, etiquetas (RFC:, Domicilio:…) y listas (a), I., 2.1.).
 *
 * Sin dependencias nuevas: empaqueta el OOXML mínimo con `archiver`.
 */
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { buildContractText, CONTRACT_VERSION } from '../src/modules/contracts/contract-text';

// ── 1) Texto con marcadores en vez de datos del cliente ────────────────────
// Fecha centinela: la formateamos IGUAL que la función y luego la sustituimos
// por una línea para llenar a mano, sin depender del texto exacto del locale.
const CENTINELA = new Date(Date.UTC(2000, 0, 1, 18, 0, 0));
const fechaCentinela = CENTINELA.toLocaleDateString('es-MX', {
  timeZone: 'America/Mexico_City',
  year: 'numeric', month: 'long', day: 'numeric',
});

let texto = buildContractText({
  client: {
    businessName: '[Nombre o razón social del CLIENTE]',
    rfc: '[RFC del CLIENTE]',
  },
  signedAt: CENTINELA,
});
texto = texto.split(fechaCentinela).join('_______________________');

// ── 2) Clasificación de líneas ─────────────────────────────────────────────
const RX_SEP_DOBLE = /^═+$/;                        // ════ (doble)
const RX_SEP = /^[─-╿]+$/;                          // cualquier recuadro (── o ══)
// Encabezado de cláusula del contrato: "PRIMERA — OBJETO" (con raya), NO el
// "PRIMERA. El servicio…" del manifiesto (ése es texto corrido).
const RX_CLAUSULA = /^(PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA|D[ÉE]CIMA)\s+—/;
// Inicio de inciso/lista: "a)", "I.", "II.", "2.1.", "4.5."
const RX_LISTA = /^\s*(?:[a-z]\)|[IVX]{1,4}\.|\d+\.\d+\.?)\s/;
// Etiqueta "Clave: valor" con clave corta (RFC:, Domicilio:, Correo de contacto:…).
const RX_ETIQUETA = /^\s*[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚáéíóúñ .]{0,26}:\s/;
const LABELS_H1 = new Set(['PARTES', 'ACEPTACIÓN', 'CLÁUSULAS']);

type Nivel = 'title' | 'h1' | 'normal';
function nivel(linea: string, idx: number): Nivel {
  const t = linea.trim();
  if (idx === 0) return 'title';
  if (t.startsWith('MANIFIESTO PARA EL SERVICIO')) return 'title';
  if (t.startsWith('GDM NEXO —')) return 'title';
  if (
    RX_CLAUSULA.test(t) ||
    LABELS_H1.has(t) ||
    t.startsWith('AUTORIZACIÓN Y MANIFESTACIÓN') ||
    t.startsWith('EL PRESTADOR:') ||
    t.startsWith('EL CLIENTE:')
  ) return 'h1';
  return 'normal';
}

const esArranqueForzado = (t: string) =>
  RX_LISTA.test(t) || RX_ETIQUETA.test(t) || /^En lo sucesivo,/.test(t.trim());
const esMayusculas = (t: string) => !/[a-záéíóúñ]/.test(t) && /[A-ZÁÉÍÓÚÑ]/.test(t);
const sangriaDe = (t: string) => (t.match(/^ */)?.[0].length ?? 0);

// ── 3) Re-flujo: líneas → párrafos lógicos ─────────────────────────────────
interface Bloque { tipo: 'p' | 'sep' | 'sepDoble'; nivel?: Nivel; indent?: number; texto?: string; }
const lineas = texto.replace(/\r\n/g, '\n').split('\n');
const bloques: Bloque[] = [];
let actual: { nivel: Nivel; indent: number; partes: string[] } | null = null;

const cerrar = () => {
  if (!actual) return;
  bloques.push({ tipo: 'p', nivel: actual.nivel, indent: actual.indent, texto: actual.partes.join(' ') });
  actual = null;
};

lineas.forEach((linea, idx) => {
  if (linea.trim() === '') { cerrar(); return; }
  if (RX_SEP.test(linea)) {
    cerrar();
    bloques.push({ tipo: RX_SEP_DOBLE.test(linea) ? 'sepDoble' : 'sep' });
    return;
  }

  const lvl = nivel(linea, idx);
  const t = linea.trim();
  const arranca =
    actual === null ||
    lvl !== 'normal' ||                                   // esta línea es un encabezado
    esArranqueForzado(t) ||                               // lista o etiqueta
    (actual.nivel !== 'normal' && !esMayusculas(t));      // no colgar texto normal de un encabezado

  if (arranca) {
    cerrar();
    actual = { nivel: lvl, indent: sangriaDe(linea), partes: [t] };
  } else {
    actual!.partes.push(t); // arranca es false ⇒ actual ≠ null
  }
});
cerrar();

// ── 4) Render OOXML ────────────────────────────────────────────────────────
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** sz en medios de punto (22 = 11 pt). */
function parrafo(txt: string, o: {
  bold?: boolean; sz?: number; jc?: 'both' | 'center' | 'left';
  indent?: number; before?: number; after?: number; line?: number; keepNext?: boolean;
} = {}) {
  const { bold, sz = 22, jc = 'left', indent = 0, before = 0, after = 120, line = 276, keepNext } = o;
  const pPr =
    `<w:pPr>` +
    `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/>` +
    (indent > 0 ? `<w:ind w:left="${indent}"/>` : '') +
    (jc !== 'left' ? `<w:jc w:val="${jc}"/>` : '') +
    (keepNext ? '<w:keepNext/>' : '') +
    `</w:pPr>`;
  const rPr =
    `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>` +
    (bold ? '<w:b/>' : '') +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(txt)}</w:t></w:r></w:p>`;
}

const regla = (doble: boolean) =>
  `<w:p><w:pPr><w:spacing w:before="80" w:after="160"/>` +
  `<w:pBdr><w:bottom w:val="${doble ? 'double' : 'single'}" w:sz="6" w:space="1" w:color="9AA0A6"/></w:pBdr>` +
  `</w:pPr></w:p>`;

const cuerpo = bloques.map((b) => {
  if (b.tipo === 'sep') return regla(false);
  if (b.tipo === 'sepDoble') return regla(true);
  const txt = b.texto ?? '';
  if (b.nivel === 'title') {
    const sz = txt.startsWith('CONTRATO DE PRESTACIÓN') ? 32 : txt.startsWith('GDM NEXO') ? 24 : 26;
    return parrafo(txt, { bold: true, sz, jc: 'center', after: 140, before: 60, keepNext: true });
  }
  if (b.nivel === 'h1') {
    return parrafo(txt, { bold: true, sz: 23, before: 240, after: 100, keepNext: true });
  }
  const jc = /^Versión\b/.test(txt) ? 'center' : 'both';
  return parrafo(txt, { jc, indent: (b.indent ?? 0) * 115 });
}).join('');

const documentXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:body>${cuerpo}` +
  `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
  `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
  `</w:sectPr></w:body></w:document>`;

const contentTypes =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const rels =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

// ── 5) Empaquetar el .docx (ZIP) ───────────────────────────────────────────
const salida = path.resolve(__dirname, '../../docs/CONTRATO_TYC_BORRADOR.docx');
const stream = fs.createWriteStream(salida);
// archiver exporta CJS; su default namespace no es callable bajo este tsconfig.
const zip = (archiver as unknown as (f: string, o?: any) => import('archiver').Archiver)(
  'zip', { zlib: { level: 9 } }
);

stream.on('close', () => {
  console.log(`✔ Borrador regenerado desde contract-text.ts (v${CONTRACT_VERSION})`);
  console.log(`  ${salida}  (${zip.pointer()} bytes, ${bloques.length} párrafos)`);
});
zip.on('warning', (e: Error) => { throw e; });
zip.on('error', (e: Error) => { throw e; });

zip.pipe(stream);
zip.append(contentTypes, { name: '[Content_Types].xml' });
zip.append(rels, { name: '_rels/.rels' });
zip.append(documentXml, { name: 'word/document.xml' });
zip.finalize();
