/**
 * Hubs de reportes de contabilidad — TODO en una sola pantalla con pestañas
 * arriba (como Tesorería), para no andar de un menú a otro:
 *
 *   NIF               → los estados financieros normados (Balanza, Situación B-6,
 *                       Resultado integral B-3, Estado de resultados, Flujos B-2,
 *                       Cambios en el capital B-4, Razones).
 *   Estados financieros → los CONTABLES (no NIF): Balance general, Estado de
 *                       resultados por cuenta, y los Especiales de diagnóstico.
 *
 * Cada pestaña monta la pantalla que ya existía (con su propio selector de
 * periodo y descargas); aquí sólo se agrupan. Las rutas sueltas de cada reporte
 * siguen existiendo para los enlaces directos (p. ej. volver desde el auxiliar).
 */
import { useState, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Calculator, ClipboardList, Loader2 } from 'lucide-react';
import { claseOpcion } from '@/utils/coloresOpciones';
import { api } from '@/services/api';
import { usePeriodoTrabajo } from '@/utils/periodoActivo';
import {
  BalanzaPage, SituacionFinancieraPage, ResultadoIntegralPage, EstadoResultadosPage,
  FlujoEfectivoPage, CambiosCapitalPage, RazonesPage,
} from './Estados';
import { BalanceGeneralPage } from './BalanceGeneral';
import { EstadoResultadosContablePage } from './EstadoResultadosContable';
import { ReportesEspecialesPage } from './ReportesEspeciales';

export type Pestana = [clave: string, etiqueta: string, render: () => ReactElement];

export function Hub({ titulo, subtitulo, icono, pestanas }: {
  titulo: string; subtitulo: string; icono: ReactElement; pestanas: Pestana[];
}) {
  const [tab, setTab] = useState(pestanas[0][0]);
  const activa = pestanas.find(([k]) => k === tab) || pestanas[0];
  return (
    <div>
      <div className="px-6 pt-5">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">{icono} {titulo}</h1>
        <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {pestanas.map(([k, label], i) => (
            <button key={k} onClick={() => setTab(k)} className={claseOpcion(i, tab === k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* La pantalla elegida trae su propio encabezado, selector de periodo y descargas. */}
      {activa[2]()}
    </div>
  );
}

/**
 * Envoltorio que, AL ENTRAR a un hub de reportes, actualiza la balanza del periodo
 * de trabajo DESDE LAS PÓLIZAS (una sola vez) mostrando un aviso de espera; al
 * terminar, libera y pinta los reportes. Así quien entra directo a NIF / Estados
 * Financieros ve cifras frescas sin dar «Actualizar desde pólizas» a mano. La
 * pantalla de Balanza conserva su botón (actualización manual) tal cual.
 */
function HubConActualizacion({ children }: { children: ReactNode }) {
  const { anio, mes } = usePeriodoTrabajo();
  const qc = useQueryClient();
  const [listo, setListo] = useState(false);
  const corrido = useRef(false);
  useEffect(() => {
    if (corrido.current) return;
    corrido.current = true;
    (async () => {
      try { await api.actualizarBalanzaDesdePolizas(anio, mes); } catch { /* si falla, igual se muestran */ }
      qc.invalidateQueries({ queryKey: ['balanza-periodo'] });
      setListo(true);
    })();
  }, [anio, mes, qc]);

  if (!listo) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center gap-3 min-h-[40vh]">
        <Loader2 className="animate-spin text-primary" size={30} />
        <p className="text-gray-800 font-medium">Estoy actualizando los reportes en base a las pólizas…</p>
        <p className="text-sm text-gray-500">Espera un momento, enseguida se liberan.</p>
      </div>
    );
  }
  return <>{children}</>;
}

export function NifReportesPage() {
  return (
    <HubConActualizacion>
      <Hub
        titulo="NIF" subtitulo="Estados financieros normados (NIF) y la balanza que los alimenta."
        icono={<Calculator size={20} className="text-primary" />}
        pestanas={[
          ['balanza', 'Balanza de comprobación', () => <BalanzaPage />],
          ['situacion', 'Situación financiera', () => <SituacionFinancieraPage />],
          ['resultado-integral', 'Resultado integral', () => <ResultadoIntegralPage />],
          ['estado-resultados', 'Estado de resultados', () => <EstadoResultadosPage />],
          ['flujo', 'Flujos de efectivo', () => <FlujoEfectivoPage />],
          ['capital', 'Cambios en el capital', () => <CambiosCapitalPage />],
          ['razones', 'Razones y análisis', () => <RazonesPage />],
        ]}
      />
    </HubConActualizacion>
  );
}

export function EstadosFinancierosPage() {
  return (
    <HubConActualizacion>
      <Hub
        titulo="Estados financieros" subtitulo="Los documentos contables (no NIF): por cuenta del catálogo, como los entrega el despacho."
        icono={<ClipboardList size={20} className="text-primary" />}
        pestanas={[
          ['balance', 'Balance general', () => <BalanceGeneralPage />],
          ['resultados', 'Estado de resultados', () => <EstadoResultadosContablePage />],
          ['especiales', 'Especiales', () => <ReportesEspecialesPage />],
        ]}
      />
    </HubConActualizacion>
  );
}
