/**
 * sat-status.service.ts — consulta al SAT el estado de un CFDI.
 *
 * POR QUÉ EXISTE
 * Para saber si una factura se puede cancelar había que salir del sistema,
 * entrar al portal del SAT y pegar el UUID a mano. Y cuando decía "No
 * cancelable", no decía POR QUÉ: había que ir descubriendo, uno por uno, cuál de
 * sus comprobantes relacionados seguía vigente. Eso costó una tarde entera de
 * diagnóstico a ciegas.
 *
 * Este servicio pregunta directamente y devuelve las cuatro cosas que importan:
 * si el CFDI está vigente o cancelado, si es cancelable, y —cuando hay una
 * cancelación en curso— en qué punto va.
 *
 * ES SOAP, Y ES DEL SAT
 * No es un servicio de SW: en producción se consulta al SAT directamente
 * (consultaqr.facturaelectronica.sat.gob.mx). No hace falta librería de SOAP —
 * el sobre es fijo y se arma como texto—, pero sí hay que respetar tres cosas
 * que el servicio rechaza en silencio si se equivocan:
 *
 *   · la cabecera SOAPAction, que identifica la operación;
 *   · el Content-Type con charset entre comillas, tal cual;
 *   · la expresión impresa dentro de CDATA, porque lleva & y = sin escapar.
 *
 * LA EXPRESIÓN IMPRESA
 *
 *     ?re=<RFC emisor>&rr=<RFC receptor>&tt=<total>&id=<UUID>&fe=<sello>
 *
 * `fe` NO es el sello completo: son sus ÚLTIMOS OCHO caracteres. Es el detalle
 * que más se equivoca, y mandarlo completo devuelve "no encontrado" en vez de un
 * error que explique la causa.
 */
import axios from 'axios';
import logger from '../../middleware/logger';

const URL_PRODUCCION = 'https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc';
const URL_PRUEBAS = 'https://api.test.sw.com.mx/ConsultaCFDIService.svc';

export interface DatosConsulta {
  rfcEmisor: string;
  rfcReceptor: string;
  total: number | string;
  uuid: string;
  /** Sello del CFDI. Se recortan aquí los últimos 8: el llamador manda el completo. */
  sello?: string | null;
}

export interface EstatusSat {
  encontrado: boolean;
  /** 'Vigente' | 'Cancelado' | 'No Encontrado' */
  estado: string;
  /** 'Cancelable sin aceptación' | 'Cancelable con aceptación' | 'No cancelable' */
  esCancelable: string;
  /** 'En proceso' | 'Cancelado sin aceptación' | 'Solicitud rechazada' | '' */
  estatusCancelacion: string;
  codigoEstatus: string;
  validacionEfos: string;
  /** Resumen en una frase, listo para mostrar. */
  resumen: string;
  error?: string;
}

/** Extrae el valor de una etiqueta del XML de respuesta. */
function leer(xml: string, etiqueta: string): string {
  const m = new RegExp(`<a:${etiqueta}[^>]*>([^<]*)</a:${etiqueta}>`, 'i').exec(xml)
        || new RegExp(`<${etiqueta}[^>]*>([^<]*)</${etiqueta}>`, 'i').exec(xml);
  return m ? m[1].trim() : '';
}

/**
 * Traduce la respuesta a una frase que se pueda leer sin conocer el Anexo 20.
 *
 * Importa más de lo que parece: "No cancelable" a secas manda a buscar un
 * problema en el sistema, cuando en realidad significa que hay otro comprobante
 * vivo apuntándole. Decirlo con todas sus letras evita ese rodeo.
 */
function resumir(e: Omit<EstatusSat, 'resumen' | 'encontrado'>): string {
  if (e.estado === 'Cancelado') return 'Cancelado ante el SAT.';
  if (e.estado === 'No Encontrado') {
    return 'El SAT no encuentra este comprobante. Verifica el folio fiscal, el RFC y el total.';
  }
  if (e.estatusCancelacion === 'En proceso') {
    return 'Vigente, con una cancelación EN PROCESO. El SAT ya recibió la solicitud; ' +
           'no hay que reintentar, sólo esperar a que la termine.';
  }
  if (e.estatusCancelacion === 'Solicitud rechazada') {
    return 'Vigente. El SAT RECHAZÓ una solicitud de cancelación anterior.';
  }
  if (e.esCancelable === 'No cancelable') {
    return 'Vigente y NO cancelable. Casi siempre significa que tiene comprobantes ' +
           'relacionados vigentes —complementos de pago o notas de crédito— que hay ' +
           'que cancelar primero.';
  }
  if (e.esCancelable.startsWith('Cancelable con')) {
    return 'Vigente y cancelable, pero el receptor debe aceptar la cancelación ' +
           '(tiene 72 horas para responder).';
  }
  if (e.esCancelable.startsWith('Cancelable sin')) {
    return 'Vigente y cancelable de inmediato, sin necesidad de que el receptor acepte.';
  }
  return `Estado: ${e.estado || 'desconocido'}.`;
}

export async function consultarEstatusSat(d: DatosConsulta): Promise<EstatusSat> {
  const vacio = (extra: Partial<EstatusSat> = {}): EstatusSat => ({
    encontrado: false, estado: '', esCancelable: '', estatusCancelacion: '',
    codigoEstatus: '', validacionEfos: '', resumen: '', ...extra,
  });

  if (!d.uuid) return vacio({ error: 'Falta el folio fiscal (UUID).', resumen: 'Sin folio fiscal que consultar.' });

  /* Los últimos OCHO del sello. Si no hay sello se manda vacío: el SAT responde
   * igual, aunque con menos certeza sobre la identidad del comprobante. */
  const fe = (d.sello || '').slice(-8);
  const tt = typeof d.total === 'number' ? d.total.toFixed(2) : String(d.total);
  const expresion =
    `?re=${d.rfcEmisor}&rr=${d.rfcReceptor}&tt=${tt}&id=${d.uuid}&fe=${fe}`;

  const sobre =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">` +
    `<soapenv:Header/><soapenv:Body><tem:Consulta>` +
    `<tem:expresionImpresa><![CDATA[${expresion}]]></tem:expresionImpresa>` +
    `</tem:Consulta></soapenv:Body></soapenv:Envelope>`;

  const url = (process.env.SW_SAPIEN_ENV || 'sandbox') === 'production'
    ? URL_PRODUCCION
    : URL_PRUEBAS;

  try {
    logger.info(`[SAT] consultando estatus de ${d.uuid}`);
    const r = await axios.post(url, sobre, {
      timeout: 20_000,
      headers: {
        'Content-Type': 'text/xml;charset="utf-8"',
        SOAPAction: 'http://tempuri.org/IConsultaCFDIService/Consulta',
        Accept: 'text/xml',
      },
    });
    const xml = String(r.data || '');
    const e = {
      estado: leer(xml, 'Estado'),
      esCancelable: leer(xml, 'EsCancelable'),
      estatusCancelacion: leer(xml, 'EstatusCancelacion'),
      codigoEstatus: leer(xml, 'CodigoEstatus'),
      validacionEfos: leer(xml, 'ValidacionEFOS'),
    };
    logger.info(
      `[SAT] ${d.uuid} → estado=${e.estado} cancelable=${e.esCancelable} ` +
      `cancelacion=${e.estatusCancelacion || '—'}`
    );
    return { encontrado: !!e.estado, ...e, resumen: resumir(e) };
  } catch (err: any) {
    /* Que la consulta falle NO significa que el CFDI esté mal: el servicio del
     * SAT se cae con cierta frecuencia. Se dice así, para que nadie concluya
     * que su comprobante tiene un problema cuando el problema es la consulta. */
    const detalle = err?.response?.status
      ? `HTTP ${err.response.status}`
      : err?.message || 'error desconocido';
    logger.warn(`[SAT] no se pudo consultar ${d.uuid}: ${detalle}`);
    return vacio({
      error: detalle,
      resumen:
        `No se pudo consultar al SAT (${detalle}). Esto no dice nada sobre el ` +
        `comprobante: el servicio de consulta del SAT no respondió. Intenta más tarde.`,
    });
  }
}
