/**
 * leerCfdiXml — lee una FACTURA (CFDI) en XML del lado del navegador y saca los
 * datos fiscales del emisor y del receptor, para autollenar un cliente/proveedor
 * sin recapturar (evita errores de dedo y duplicidad).
 *
 * De un CFDI se obtiene, por parte:
 *   · Emisor   → Rfc, Nombre, RegimenFiscal; su CP es el LugarExpedicion del comprobante.
 *   · Receptor → Rfc, Nombre, RegimenFiscalReceptor, DomicilioFiscalReceptor (CP), UsoCFDI.
 * (En CFDI 3.3 el receptor NO trae régimen ni CP: sólo Rfc/Nombre/UsoCFDI.)
 *
 * No hay domicilio (calle/colonia/…) en un CFDI: sólo el CP. Eso basta para los
 * datos obligatorios del Receptor en CFDI 4.0 (RFC, Nombre, Régimen, CP, Uso).
 */

export interface DatosFiscalesCfdi {
  rfc: string;
  nombre: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCfdi?: string;            // sólo del receptor
  lado: 'emisor' | 'receptor';
}

export interface CfdiPartes {
  emisor: DatosFiscalesCfdi;
  receptor: DatosFiscalesCfdi;
  version: string;
}

/** Lee el File XML y devuelve las dos partes (emisor y receptor). */
export async function leerCfdiXml(file: File): Promise<CfdiPartes> {
  const texto = await file.text();
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('El archivo no es un XML válido.');

  // El CFDI usa prefijo `cfdi:`; se busca por localName para no depender del prefijo.
  const porLocal = (name: string): Element | null => {
    const todos = doc.getElementsByTagName('*');
    for (let i = 0; i < todos.length; i++) if (todos[i].localName === name) return todos[i];
    return null;
  };
  const comprobante = porLocal('Comprobante');
  const emisorEl = porLocal('Emisor');
  const receptorEl = porLocal('Receptor');
  if (!comprobante || !emisorEl || !receptorEl) {
    throw new Error('El XML no parece un CFDI (no trae Comprobante/Emisor/Receptor).');
  }
  const attr = (el: Element | null, a: string) => (el?.getAttribute(a) || '').trim();
  const lugarExp = attr(comprobante, 'LugarExpedicion');

  const emisor: DatosFiscalesCfdi = {
    rfc: attr(emisorEl, 'Rfc').toUpperCase(),
    nombre: attr(emisorEl, 'Nombre'),
    regimenFiscal: attr(emisorEl, 'RegimenFiscal'),
    codigoPostal: lugarExp,                       // el CP del emisor es el LugarExpedicion
    lado: 'emisor',
  };
  const receptor: DatosFiscalesCfdi = {
    rfc: attr(receptorEl, 'Rfc').toUpperCase(),
    nombre: attr(receptorEl, 'Nombre'),
    regimenFiscal: attr(receptorEl, 'RegimenFiscalReceptor'),
    codigoPostal: attr(receptorEl, 'DomicilioFiscalReceptor'),
    usoCfdi: attr(receptorEl, 'UsoCFDI'),
    lado: 'receptor',
  };
  return { emisor, receptor, version: attr(comprobante, 'Version') || attr(comprobante, 'version') };
}

/**
 * Elige el lado del CFDI que corresponde al RFC buscado. Si hay un RFC objetivo y NO
 * coincide con el emisor ni con el receptor, devuelve null (NO se actualiza nada — así
 * no se mezclan datos de otra empresa). Sin RFC objetivo (alta nueva) usa el lado
 * preferido de la pantalla (receptor en clientes, emisor en proveedores).
 */
export function ladoParaRfc(
  partes: CfdiPartes, rfcObjetivo: string, ladoPreferido: 'emisor' | 'receptor',
): DatosFiscalesCfdi | null {
  const rfc = (rfcObjetivo || '').toUpperCase().trim();
  if (rfc) {
    if (partes.receptor.rfc === rfc) return partes.receptor;
    if (partes.emisor.rfc === rfc) return partes.emisor;
    return null;
  }
  return ladoPreferido === 'emisor' ? partes.emisor : partes.receptor;
}
