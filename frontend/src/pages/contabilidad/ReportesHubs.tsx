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
import { useState, type ReactElement } from 'react';
import { Calculator, ClipboardList } from 'lucide-react';
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
        <div className="flex gap-1 border-b mt-3 overflow-x-auto">
          {pestanas.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                tab === k
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
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

export function NifReportesPage() {
  return (
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
  );
}

export function EstadosFinancierosPage() {
  return (
    <Hub
      titulo="Estados financieros" subtitulo="Los documentos contables (no NIF): por cuenta del catálogo, como los entrega el despacho."
      icono={<ClipboardList size={20} className="text-primary" />}
      pestanas={[
        ['balance', 'Balance general', () => <BalanceGeneralPage />],
        ['resultados', 'Estado de resultados', () => <EstadoResultadosContablePage />],
        ['especiales', 'Especiales', () => <ReportesEspecialesPage />],
      ]}
    />
  );
}
