/**
 * transporte.ts — selector del TRANSPORTE de la descarga masiva.
 *
 *   SAT_DESCARGA_VIA=satgo → SatGo (satgo-transport, REST, medido por cuota)
 *   (cualquier otro valor)  → soap.ts (WS OFICIAL del SAT con e.firma, gratis)
 *
 * Se eligió por bandera para poder volver al motor propio de NEXO sin redesplegar.
 * El resto del motor (partición, reanudable, dedupe, bóveda, calendario) es idéntico
 * en ambos: sólo cambian las cuatro llamadas de transporte. Ver [[respaldo-xml-fuente-verdad]].
 */
import * as soap from './soap';
import * as satgo from './satgo-transport';

const viaSatgo = process.env.SAT_DESCARGA_VIA === 'satgo';

export const autenticar = viaSatgo ? satgo.autenticar : soap.autenticar;
export const solicitar  = viaSatgo ? satgo.solicitar  : soap.solicitar;
export const verificar  = viaSatgo ? satgo.verificar  : soap.verificar;
export const descargar  = viaSatgo ? satgo.descargar  : soap.descargar;

export { ESTADO_SOLICITUD } from './soap';
export type { Credencial, Token, DatosSolicitud, RespuestaSat, Verificacion } from './soap';
