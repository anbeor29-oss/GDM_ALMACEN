/**
 * Logo de GDM NEXO (99x128), embebido en base64.
 *
 * Va en el PIE de todo reporte (utils/pie-nexo) con la leyenda «Reporte emitido
 * por GDM NEXO», y en el recuadro «Emitido desde» del recibo de nomina
 * detallado, y en el pie de los COMPROBANTES: factura en sus seis formatos,
 * nota de credito y complemento de pago. Es el unico logo de la casa que queda:
 * el oscuro de 44x44 que llevaba antes el pie del CFDI se retiro al unificarlos.
 * Se EMBEBE en vez de leerse de disco para que funcione en cualquier despliegue
 * sin copiar archivos estaticos al build.
 *
 * ES LA VERSION DE TINTA PLANA, no la metalica. La metalica, reducida a los
 * ~16 pt que mide un pie, se leia como una mancha gris: el degradado se pierde
 * y lo que queda es ruido. Un solo tono aguanta cualquier tamano.
 *
 * El original venia en WebP a 1293x1216 con margen blanco: se recorto el margen,
 * se bajo a 128 px de alto —que a 16 pt equivale a mas de 400 dpi— y el fondo
 * se volvio TRANSPARENTE. El fondo se puede quitar limpio justamente por ser de
 * un solo tono: el alfa se interpola entre el fondo y la tinta, asi que los
 * bordes quedan suaves y el hueco interior del chevron deja ver la hoja.
 */
const NEXO_LOGO_MARCA_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGMAAACACAMAAAAoNSeLAAABNVBMVEVMaXGPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GP' +
  'j5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GP' +
  'j5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GP' +
  'j5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GP' +
  'j5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5GPj5H72/8ZAAAAZnRSTlMA9vMMAgcJ/QX4iebx' +
  'ENy17+PsDt/ohIvhYRMaU1+uF5Jas3l0OKlkILDYpb68+iNIMR6NHF2gp9HAWC5KTWiUuSonQ0HVa8WZcs6bfcfDbzyArDp7UZDT' +
  'T8wsbYKeM9pGP1YVonZIUuQ/AAAACXBIWXMAAAPoAAAD6AG1e1JrAAALGUlEQVRo3s2bB3fbug6AKVmDjK3EI25SO07SptnNHi97' +
  '753u3s77Bv7/T3gASS1LdpXEt/fynDaNLfETQACEAJax7IPTX4cXO4xVbPqnjYOzDo8Kq+wCwKWH8+OvjtNxAo6jKRBFA8wVKRaO' +
  'ziMuXeiGqouiTNc7PDW3SS38Zy9ODi4NgMIGY3Vm55zOYXLMeQOFgEGUm31clY4q61NZAEQYrgnl5x2FeNNIMN2oHG4B3MGJDs2P' +
  'Vvrv3uDxYwOmviwz27Of7hP1QQBhihQGSja5SJc8dbW3+0lFhXRB8m7+09NVNRZf6jjCpK+m9x9vrWQyJ741pULUd1AdsOnih3s9' +
  't202tK5nSRfDZwDMTNgsl3uEd7PxIriZGAUwnz/KZBfHDMjH5YAWDBMjQM+DfMW2MXaz2zwYEBk0p5ALU4BUVu95hWVdEY/0enAK' +
  'TYPcAeOJYabojj5BkV8feJnl4M45QLmoLDMqB0n237nhBER+YBZF9XY5axx+203LCIZIMKB3HL/fX/N/jzLocmPm6FeWxCk4LQ/r' +
  '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';

export const NEXO_LOGO_MARCA_PNG: Buffer = Buffer.from(NEXO_LOGO_MARCA_B64, 'base64');

/** Proporcion del archivo: ancho = alto * ESTA razon. */
export const NEXO_LOGO_MARCA_RATIO = 99 / 128;
