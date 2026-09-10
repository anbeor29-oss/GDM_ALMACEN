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
 * Sin dependencias nuevas: usa `archiver` (ya instalado) para empaquetar el
 * OOXML mínimo (Content_Types + rels + word/document.xml).
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

// ── 2) Utilidades OOXML ────────────────────────────────────────────────────
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const RX_SEP = /^[─-╿]+$/;    // líneas de recuadro ──── / ════
const RX_CLAUSULA = /^(PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA|D[ÉE]CIMA)\b/;
const LABELS_H1 = new Set(['PARTES', 'ACEPTACIÓN', 'CLÁUSULAS']);

function nivel(linea: string, idx: number): 'title' | 'h1' | 'normal' {
  const t = linea.trim();
  if (idx === 0) return 'title';
  if (t.startsWith('MANIFIESTO PARA EL SERVICIO')) return 'title';
  if (
    RX_CLAUSULA.test(t) ||
    LABELS_H1.has(t) ||
    t.startsWith('GDM NEXO —') ||
    t.startsWith('AUTORIZACIÓN Y MANIFESTACIÓN') ||
    t.startsWith('EL PRESTADOR:') ||
    t.startsWith('EL CLIENTE:')
  ) return 'h1';
  return 'normal';
}

/** Párrafo con formato. sz en medios puntos (21 = 10.5 pt). */
function parrafo(texto: string, opts: { bold?: boolean; sz?: number; indent?: number } = {}) {
  const { bold, sz = 21, indent = 0 } = opts;
  const pPr = indent > 0 ? `<w:pPr><w:ind w:left="${indent}"/></w:pPr>` : '';
  const rPr =
    `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>` +
    (bold ? '<w:b/>' : '') +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p>`;
}

const parrafoVacio = () =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr></w:p>`;

const reglaHorizontal = () =>
  `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>` +
  `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="9AA0A6"/></w:pBdr></w:pPr></w:p>`;

// ── 3) Cada línea del texto → un párrafo (fiel a la fuente) ─────────────────
const lineas = texto.replace(/\r\n/g, '\n').split('\n');
const cuerpo: string[] = [];

lineas.forEach((linea, idx) => {
  if (linea.trim() === '') { cuerpo.push(parrafoVacio()); return; }
  if (RX_SEP.test(linea)) { cuerpo.push(reglaHorizontal()); return; }

  const lvl = nivel(linea, idx);
  const indent = (linea.match(/^ */)?.[0].length ?? 0) * 100; // sangría por espacios
  const contenido = linea.replace(/^ +/, '');

  if (lvl === 'title') {
    cuerpo.push(parrafo(contenido, { bold: true, sz: idx === 0 ? 30 : 26 }));
  } else if (lvl === 'h1') {
    cuerpo.push(parrafo(contenido, { bold: true, sz: 23 }));
  } else {
    cuerpo.push(parrafo(contenido, { indent }));
  }
});

const documentXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:body>${cuerpo.join('')}` +
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

// ── 4) Empaquetar el .docx (ZIP) ───────────────────────────────────────────
const salida = path.resolve(__dirname, '../../docs/CONTRATO_TYC_BORRADOR.docx');
const stream = fs.createWriteStream(salida);
// archiver exporta CJS; su default namespace no es callable bajo este tsconfig.
const zip = (archiver as unknown as (f: string, o?: any) => import('archiver').Archiver)(
  'zip', { zlib: { level: 9 } }
);

stream.on('close', () => {
  console.log(`✔ Borrador regenerado desde contract-text.ts (v${CONTRACT_VERSION})`);
  console.log(`  ${salida}  (${zip.pointer()} bytes, ${lineas.length} líneas)`);
});
zip.on('warning', (e: Error) => { throw e; });
zip.on('error', (e: Error) => { throw e; });

zip.pipe(stream);
zip.append(contentTypes, { name: '[Content_Types].xml' });
zip.append(rels, { name: '_rels/.rels' });
zip.append(documentXml, { name: 'word/document.xml' });
zip.finalize();
