/**
 * manual-icons.js — iconos vectoriales para el manual en PDF.
 *
 * PDFKit no puede incrustar fuentes de emoji: Segoe UI Emoji es COLR/CPAL
 * (glifos a color) y fontkit falla al decodificarlos. Tampoco queremos
 * depender de PNGs sueltos. La salida son trazos vectoriales, que escalan
 * sin pixelarse y pesan casi nada.
 *
 * Cada función dibuja dentro de una caja de `s` puntos con esquina superior
 * izquierda en (x, y). El estilo es line-art de trazo 1.5, equivalente al
 * de los iconos que ve el usuario en pantalla.
 */

/** Ejecuta el trazo con el color y grosor estándar del manual. */
function stroke(doc, color, w = 1.5) {
  doc.strokeColor(color).lineWidth(w).lineJoin('round').lineCap('round').stroke();
}

const icons = {
  /* ─── Módulos del menú lateral ─── */

  /** Casa — Dashboard */
  home(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 2 * u, y + 7 * u)
       .lineTo(x + 8 * u, y + 2 * u)
       .lineTo(x + 14 * u, y + 7 * u);
    stroke(doc, c);
    doc.moveTo(x + 3.5 * u, y + 7 * u).lineTo(x + 3.5 * u, y + 13.5 * u)
       .lineTo(x + 12.5 * u, y + 13.5 * u).lineTo(x + 12.5 * u, y + 7 * u);
    stroke(doc, c);
    doc.rect(x + 6.5 * u, y + 9 * u, 3 * u, 4.5 * u);
    stroke(doc, c, 1.2);
  },

  /** Recibo con líneas y borde dentado — Facturas */
  receipt(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 3.5 * u, y + 2 * u)
       .lineTo(x + 12.5 * u, y + 2 * u)
       .lineTo(x + 12.5 * u, y + 14 * u)
       .lineTo(x + 10.7 * u, y + 12.8 * u)
       .lineTo(x + 8.9 * u, y + 14 * u)
       .lineTo(x + 7.1 * u, y + 12.8 * u)
       .lineTo(x + 5.3 * u, y + 14 * u)
       .lineTo(x + 3.5 * u, y + 12.8 * u)
       .closePath();
    stroke(doc, c);
    [5.5, 7.5, 9.5].forEach(ly => {
      doc.moveTo(x + 5.5 * u, y + ly * u).lineTo(x + 10.5 * u, y + ly * u);
      stroke(doc, c, 1.1);
    });
  },

  /** Camión de carga — Carta Porte */
  truck(doc, x, y, s, c) {
    const u = s / 16;
    doc.rect(x + 1 * u, y + 4.5 * u, 8 * u, 6.5 * u);
    stroke(doc, c);
    doc.moveTo(x + 9 * u, y + 6.8 * u)
       .lineTo(x + 12 * u, y + 6.8 * u)
       .lineTo(x + 14.5 * u, y + 9 * u)
       .lineTo(x + 14.5 * u, y + 11 * u)
       .lineTo(x + 9 * u, y + 11 * u);
    stroke(doc, c);
    doc.circle(x + 4.5 * u, y + 12.4 * u, 1.6 * u);
    stroke(doc, c, 1.3);
    doc.circle(x + 12 * u, y + 12.4 * u, 1.6 * u);
    stroke(doc, c, 1.3);
  },

  /** Documento con flecha abajo — Notas de Crédito */
  fileDown(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 4 * u, y + 2 * u).lineTo(x + 9.5 * u, y + 2 * u)
       .lineTo(x + 12.5 * u, y + 5 * u).lineTo(x + 12.5 * u, y + 14 * u)
       .lineTo(x + 4 * u, y + 14 * u).closePath();
    stroke(doc, c);
    doc.moveTo(x + 9.5 * u, y + 2 * u).lineTo(x + 9.5 * u, y + 5 * u)
       .lineTo(x + 12.5 * u, y + 5 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 8.2 * u, y + 7.5 * u).lineTo(x + 8.2 * u, y + 11.5 * u);
    stroke(doc, c, 1.3);
    doc.moveTo(x + 6.4 * u, y + 9.8 * u).lineTo(x + 8.2 * u, y + 11.6 * u)
       .lineTo(x + 10 * u, y + 9.8 * u);
    stroke(doc, c, 1.3);
  },

  /** Caja / paquete — Productos */
  box(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 8 * u, y + 2 * u).lineTo(x + 14 * u, y + 5 * u)
       .lineTo(x + 14 * u, y + 11.5 * u).lineTo(x + 8 * u, y + 14.5 * u)
       .lineTo(x + 2 * u, y + 11.5 * u).lineTo(x + 2 * u, y + 5 * u).closePath();
    stroke(doc, c);
    doc.moveTo(x + 2 * u, y + 5 * u).lineTo(x + 8 * u, y + 8 * u)
       .lineTo(x + 14 * u, y + 5 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 8 * u, y + 8 * u).lineTo(x + 8 * u, y + 14.5 * u);
    stroke(doc, c, 1.2);
  },

  /** Dos personas — Clientes */
  users(doc, x, y, s, c) {
    const u = s / 16;
    doc.circle(x + 6 * u, y + 5.5 * u, 2.5 * u);
    stroke(doc, c);
    doc.moveTo(x + 1.8 * u, y + 13.5 * u)
       .bezierCurveTo(x + 1.8 * u, y + 10 * u, x + 10.2 * u, y + 10 * u, x + 10.2 * u, y + 13.5 * u);
    stroke(doc, c);
    doc.circle(x + 11.8 * u, y + 6 * u, 2 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 11 * u, y + 10 * u)
       .bezierCurveTo(x + 14.5 * u, y + 10.2 * u, x + 14.6 * u, y + 11.6 * u, x + 14.6 * u, y + 13.5 * u);
    stroke(doc, c, 1.2);
  },

  /** Bandeja con flecha entrando — Lector de XML */
  inbox(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 2 * u, y + 9 * u).lineTo(x + 2 * u, y + 13.5 * u)
       .lineTo(x + 14 * u, y + 13.5 * u).lineTo(x + 14 * u, y + 9 * u);
    stroke(doc, c);
    doc.moveTo(x + 2 * u, y + 9 * u).lineTo(x + 5.5 * u, y + 9 * u)
       .lineTo(x + 6.5 * u, y + 10.8 * u).lineTo(x + 9.5 * u, y + 10.8 * u)
       .lineTo(x + 10.5 * u, y + 9 * u).lineTo(x + 14 * u, y + 9 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 8 * u, y + 2 * u).lineTo(x + 8 * u, y + 7 * u);
    stroke(doc, c, 1.3);
    doc.moveTo(x + 6 * u, y + 5 * u).lineTo(x + 8 * u, y + 7.2 * u)
       .lineTo(x + 10 * u, y + 5 * u);
    stroke(doc, c, 1.3);
  },

  /** Barras — Reportes */
  chart(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 2 * u, y + 2.5 * u).lineTo(x + 2 * u, y + 13.5 * u)
       .lineTo(x + 14 * u, y + 13.5 * u);
    stroke(doc, c);
    doc.rect(x + 4.2 * u, y + 8.5 * u, 2.2 * u, 5 * u);
    stroke(doc, c, 1.2);
    doc.rect(x + 7.4 * u, y + 5 * u, 2.2 * u, 8.5 * u);
    stroke(doc, c, 1.2);
    doc.rect(x + 10.6 * u, y + 10 * u, 2.2 * u, 3.5 * u);
    stroke(doc, c, 1.2);
  },

  /** Documento con sello — Contrato */
  contract(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 3.5 * u, y + 1.8 * u).lineTo(x + 9 * u, y + 1.8 * u)
       .lineTo(x + 12 * u, y + 4.8 * u).lineTo(x + 12 * u, y + 14.2 * u)
       .lineTo(x + 3.5 * u, y + 14.2 * u).closePath();
    stroke(doc, c);
    doc.moveTo(x + 9 * u, y + 1.8 * u).lineTo(x + 9 * u, y + 4.8 * u)
       .lineTo(x + 12 * u, y + 4.8 * u);
    stroke(doc, c, 1.2);
    [7, 9].forEach(ly => {
      doc.moveTo(x + 5.4 * u, y + ly * u).lineTo(x + 10 * u, y + ly * u);
      stroke(doc, c, 1);
    });
    // Rúbrica
    doc.moveTo(x + 5.4 * u, y + 11.8 * u)
       .bezierCurveTo(x + 6.6 * u, y + 10.4 * u, x + 7.4 * u, y + 12.6 * u, x + 8.6 * u, y + 11.2 * u)
       .bezierCurveTo(x + 9.2 * u, y + 10.6 * u, x + 9.6 * u, y + 11.4 * u, x + 10.2 * u, y + 10.8 * u);
    stroke(doc, c, 1.2);
  },

  /* ─── Botones de acción de facturas ─── */

  /** Documento PDF con flecha */
  pdf(doc, x, y, s, c) { icons.fileDown(doc, x, y, s, c); },

  /** Flecha de descarga sobre línea — XML */
  download(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 8 * u, y + 2.5 * u).lineTo(x + 8 * u, y + 10 * u);
    stroke(doc, c);
    doc.moveTo(x + 4.8 * u, y + 6.8 * u).lineTo(x + 8 * u, y + 10.2 * u)
       .lineTo(x + 11.2 * u, y + 6.8 * u);
    stroke(doc, c);
    doc.moveTo(x + 3 * u, y + 13 * u).lineTo(x + 13 * u, y + 13 * u);
    stroke(doc, c);
  },

  /** Ojo — Vista previa */
  eye(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 1.5 * u, y + 8 * u)
       .bezierCurveTo(x + 4 * u, y + 3.5 * u, x + 12 * u, y + 3.5 * u, x + 14.5 * u, y + 8 * u)
       .bezierCurveTo(x + 12 * u, y + 12.5 * u, x + 4 * u, y + 12.5 * u, x + 1.5 * u, y + 8 * u)
       .closePath();
    stroke(doc, c);
    doc.circle(x + 8 * u, y + 8 * u, 2.2 * u);
    stroke(doc, c, 1.2);
  },

  /** Barco — Carta Porte (botón de tabla) */
  ship(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 2 * u, y + 10 * u)
       .lineTo(x + 14 * u, y + 10 * u)
       .lineTo(x + 12 * u, y + 13.8 * u)
       .lineTo(x + 4 * u, y + 13.8 * u)
       .closePath();
    stroke(doc, c);
    doc.moveTo(x + 4.5 * u, y + 10 * u).lineTo(x + 4.5 * u, y + 7 * u)
       .lineTo(x + 11.5 * u, y + 7 * u).lineTo(x + 11.5 * u, y + 10 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 8 * u, y + 7 * u).lineTo(x + 8 * u, y + 2.5 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 8 * u, y + 3 * u).lineTo(x + 11.5 * u, y + 5.5 * u)
       .lineTo(x + 8 * u, y + 5.5 * u);
    stroke(doc, c, 1.1);
  },

  /** Lápiz — Editar */
  pencil(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 2.5 * u, y + 13.5 * u).lineTo(x + 3.6 * u, y + 10.2 * u)
       .lineTo(x + 10.8 * u, y + 3 * u).lineTo(x + 13 * u, y + 5.2 * u)
       .lineTo(x + 5.8 * u, y + 12.4 * u).closePath();
    stroke(doc, c);
    doc.moveTo(x + 9.6 * u, y + 4.2 * u).lineTo(x + 11.8 * u, y + 6.4 * u);
    stroke(doc, c, 1.1);
  },

  /** Sello — Timbrar */
  stamp(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 5 * u, y + 9 * u)
       .lineTo(x + 5 * u, y + 6.5 * u)
       .bezierCurveTo(x + 5 * u, y + 3.5 * u, x + 11 * u, y + 3.5 * u, x + 11 * u, y + 6.5 * u)
       .lineTo(x + 11 * u, y + 9 * u);
    stroke(doc, c);
    doc.rect(x + 2.5 * u, y + 9 * u, 11 * u, 2.6 * u);
    stroke(doc, c);
    doc.moveTo(x + 3.5 * u, y + 13.5 * u).lineTo(x + 12.5 * u, y + 13.5 * u);
    stroke(doc, c, 1.3);
  },

  /** Cartera — Complemento de pago */
  wallet(doc, x, y, s, c) {
    const u = s / 16;
    doc.roundedRect(x + 2 * u, y + 4 * u, 12 * u, 9 * u, 1.5 * u);
    stroke(doc, c);
    doc.moveTo(x + 2 * u, y + 7.5 * u).lineTo(x + 14 * u, y + 7.5 * u);
    stroke(doc, c, 1.1);
    doc.circle(x + 11 * u, y + 10.2 * u, 1.1 * u);
    stroke(doc, c, 1.2);
  },

  /** Monedas apiladas — Ver saldo */
  coins(doc, x, y, s, c) {
    const u = s / 16;
    doc.ellipse(x + 8 * u, y + 4.5 * u, 5 * u, 2.2 * u);
    stroke(doc, c);
    doc.moveTo(x + 3 * u, y + 4.5 * u).lineTo(x + 3 * u, y + 8 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 13 * u, y + 4.5 * u).lineTo(x + 13 * u, y + 8 * u);
    stroke(doc, c, 1.2);
    doc.ellipse(x + 8 * u, y + 8 * u, 5 * u, 2.2 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 3 * u, y + 8 * u).lineTo(x + 3 * u, y + 11.5 * u);
    stroke(doc, c, 1.2);
    doc.moveTo(x + 13 * u, y + 8 * u).lineTo(x + 13 * u, y + 11.5 * u);
    stroke(doc, c, 1.2);
    doc.ellipse(x + 8 * u, y + 11.5 * u, 5 * u, 2.2 * u);
    stroke(doc, c, 1.2);
  },

  /** Sobre — Enviar por correo */
  mail(doc, x, y, s, c) {
    const u = s / 16;
    doc.rect(x + 1.5 * u, y + 4 * u, 13 * u, 9 * u);
    stroke(doc, c);
    doc.moveTo(x + 1.5 * u, y + 4.6 * u).lineTo(x + 8 * u, y + 9.4 * u)
       .lineTo(x + 14.5 * u, y + 4.6 * u);
    stroke(doc, c, 1.2);
  },

  /** Reloj con flecha atrás — Historial */
  history(doc, x, y, s, c) {
    const u = s / 16;
    doc.circle(x + 8.4 * u, y + 8.4 * u, 5.4 * u);
    stroke(doc, c);
    doc.moveTo(x + 8.4 * u, y + 5.4 * u).lineTo(x + 8.4 * u, y + 8.4 * u)
       .lineTo(x + 10.8 * u, y + 9.8 * u);
    stroke(doc, c, 1.3);
    doc.moveTo(x + 3.2 * u, y + 4.6 * u).lineTo(x + 2.6 * u, y + 7.4 * u)
       .lineTo(x + 5.4 * u, y + 6.8 * u);
    stroke(doc, c, 1.2);
  },

  /** Círculo tachado — Cancelar */
  ban(doc, x, y, s, c) {
    const u = s / 16;
    doc.circle(x + 8 * u, y + 8 * u, 6 * u);
    stroke(doc, c);
    doc.moveTo(x + 3.8 * u, y + 3.8 * u).lineTo(x + 12.2 * u, y + 12.2 * u);
    stroke(doc, c);
  },

  /* ─── Iconos de apoyo ─── */

  /** Marcador de mapa — Lugares */
  pin(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 8 * u, y + 14 * u)
       .bezierCurveTo(x + 3 * u, y + 8.5 * u, x + 3 * u, y + 6 * u, x + 3 * u, y + 6 * u)
       .bezierCurveTo(x + 3 * u, y + 2.7 * u, x + 13 * u, y + 2.7 * u, x + 13 * u, y + 6 * u)
       .bezierCurveTo(x + 13 * u, y + 6 * u, x + 13 * u, y + 8.5 * u, x + 8 * u, y + 14 * u)
       .closePath();
    stroke(doc, c);
    doc.circle(x + 8 * u, y + 6.2 * u, 1.9 * u);
    stroke(doc, c, 1.2);
  },

  /** Escudo — Aseguradoras / Usuarios admin */
  shield(doc, x, y, s, c) {
    const u = s / 16;
    doc.moveTo(x + 8 * u, y + 2 * u).lineTo(x + 13.5 * u, y + 4.2 * u)
       .lineTo(x + 13.5 * u, y + 8.5 * u)
       .bezierCurveTo(x + 13.5 * u, y + 11.5 * u, x + 11 * u, y + 13.4 * u, x + 8 * u, y + 14.2 * u)
       .bezierCurveTo(x + 5 * u, y + 13.4 * u, x + 2.5 * u, y + 11.5 * u, x + 2.5 * u, y + 8.5 * u)
       .lineTo(x + 2.5 * u, y + 4.2 * u).closePath();
    stroke(doc, c);
  },

  /** Persona con gorra — Operadores */
  driver(doc, x, y, s, c) {
    const u = s / 16;
    doc.circle(x + 8 * u, y + 6.5 * u, 2.6 * u);
    stroke(doc, c);
    doc.moveTo(x + 4.6 * u, y + 5 * u).lineTo(x + 11.4 * u, y + 5 * u);
    stroke(doc, c, 1.3);
    doc.moveTo(x + 3 * u, y + 14 * u)
       .bezierCurveTo(x + 3 * u, y + 10.2 * u, x + 13 * u, y + 10.2 * u, x + 13 * u, y + 14 * u);
    stroke(doc, c);
  },

  /** Edificio — Empresas */
  building(doc, x, y, s, c) {
    const u = s / 16;
    doc.rect(x + 3 * u, y + 2.5 * u, 10 * u, 11.5 * u);
    stroke(doc, c);
    [5.5, 8, 10.5].forEach(ry => {
      [5.2, 8, 10.8].forEach(cx => {
        doc.rect(x + (cx - 0.7) * u, y + (ry - 0.7) * u, 1.5 * u, 1.5 * u);
        stroke(doc, c, 0.9);
      });
    });
  },
};

module.exports = { icons };
