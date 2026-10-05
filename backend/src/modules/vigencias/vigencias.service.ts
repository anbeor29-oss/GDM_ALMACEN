/**
 * vigencias.service — control de vencimiento del SELLO (CSD) y la e.firma (FIEL).
 *
 * Niveles (días restantes al que vence primero):
 *   AVISO   ≤ 30  → mensaje informativo al entrar (se cierra al aceptar).
 *   DIARIO  ≤ 15  → aviso una vez al día («faltan X días para renovar»).
 *   BLOQUEO ≤  5  → no se puede trabajar hasta cargar el nuevo CSD/e.firma.
 *
 * El CSD se parsea del .cer guardado; la e.firma trae su vigencia en sat_credenciales.
 */
import * as crypto from 'crypto';
import { query } from '../../config/database';
import { obtenerCsdDeEmpresa } from '../pac/csd-loader';

export type NivelVigencia = 'OK' | 'AVISO' | 'DIARIO' | 'BLOQUEO';
export interface SelloVigencia {
  tipo: 'CSD' | 'EFIRMA';
  etiqueta: string;
  cargado: boolean;
  vigenciaHasta: string | null;   // AAAA-MM-DD
  dias: number | null;            // días restantes (negativo = vencido)
}

const diasHasta = (f: Date) => Math.floor((f.getTime() - Date.now()) / 86_400_000);

export async function estadoVigencias(companyId: string): Promise<{ sellos: SelloVigencia[]; minDias: number | null; nivel: NivelVigencia }> {
  const sellos: SelloVigencia[] = [];

  // ── Sello digital (CSD): se parsea el .cer guardado de la empresa ──
  try {
    const r = await obtenerCsdDeEmpresa(companyId);
    if (r.csd?.b64Cer) {
      const cert = new crypto.X509Certificate(Buffer.from(r.csd.b64Cer, 'base64'));
      const hasta = new Date(cert.validTo);
      sellos.push({ tipo: 'CSD', etiqueta: 'Sello digital (CSD)', cargado: true, vigenciaHasta: hasta.toISOString().slice(0, 10), dias: diasHasta(hasta) });
    } else {
      sellos.push({ tipo: 'CSD', etiqueta: 'Sello digital (CSD)', cargado: false, vigenciaHasta: null, dias: null });
    }
  } catch { sellos.push({ tipo: 'CSD', etiqueta: 'Sello digital (CSD)', cargado: false, vigenciaHasta: null, dias: null }); }

  // ── e.firma (FIEL): vigencia guardada en sat_credenciales ──
  try {
    const r = await query<any>(
      `SELECT vigencia_hasta FROM sat_credenciales WHERE company_id = $1 ORDER BY vigencia_hasta DESC NULLS LAST LIMIT 1`, [companyId]);
    const h = r.rows[0]?.vigencia_hasta;
    if (h) {
      const hasta = new Date(h);
      sellos.push({ tipo: 'EFIRMA', etiqueta: 'e.firma (FIEL)', cargado: true, vigenciaHasta: hasta.toISOString().slice(0, 10), dias: diasHasta(hasta) });
    } else {
      sellos.push({ tipo: 'EFIRMA', etiqueta: 'e.firma (FIEL)', cargado: false, vigenciaHasta: null, dias: null });
    }
  } catch { sellos.push({ tipo: 'EFIRMA', etiqueta: 'e.firma (FIEL)', cargado: false, vigenciaHasta: null, dias: null }); }

  const dias = sellos.filter((s) => s.cargado && s.dias != null).map((s) => s.dias as number);
  const minDias = dias.length ? Math.min(...dias) : null;
  let nivel: NivelVigencia = 'OK';
  if (minDias != null) {
    if (minDias <= 5) nivel = 'BLOQUEO';
    else if (minDias <= 15) nivel = 'DIARIO';
    else if (minDias <= 30) nivel = 'AVISO';
  }
  return { sellos, minDias, nivel };
}
