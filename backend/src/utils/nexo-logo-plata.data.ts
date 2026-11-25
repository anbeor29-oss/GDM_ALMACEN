/**
 * Logo de GDM NEXO en plata (92x128), embebido en base64.
 *
 * Va en el PIE de todo reporte (utils/reporte-pdf) con la leyenda «Reporte
 * emitido por GDM NEXO». Se EMBEBE en vez de leerse de disco para que funcione
 * en cualquier despliegue sin copiar archivos estaticos al build -es la misma
 * razon por la que nexo-logo.data.ts hace lo mismo con el logo oscuro del pie
 * del CFDI-.
 *
 * El original venia en WebP y a 1293x1217 con margen blanco: se recorto el
 * margen y se bajo a 128 px de alto, que a los ~16 pt que mide en el pie
 * equivale a mas de 400 dpi.
 */
const NEXO_LOGO_PLATA_B64 =
  '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';

export const NEXO_LOGO_PLATA_PNG: Buffer = Buffer.from(NEXO_LOGO_PLATA_B64, 'base64');

/** Proporcion del archivo: ancho = alto * ESTA razon. */
export const NEXO_LOGO_PLATA_RATIO = 92 / 128;
