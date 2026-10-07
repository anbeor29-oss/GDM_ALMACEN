/**
 * Panel fiscal — expediente de cumplimiento de la empresa, de un vistazo.
 *
 * Es la vista de ENTRADA (se abre desde «Tu empresa» en el Dashboard) y resume lo
 * que el hub «Cumplimiento fiscal» maneja al detalle:
 *   · DOCUMENTOS PERMANENTES: 32-D/Opinión SAT, CIF, Opinión IMSS, Opinión INFONAVIT
 *     — su estado vigente, la fecha y la condición de actualización (automática/manual).
 *   · DOCUMENTOS ANUALES / HISTÓRICO: ejercicio seleccionable con Declaraciones,
 *     Notificaciones e Información fiscal (conteo + estado + última actualización).
 *
 * No duplica motores: reusa los MISMOS endpoints y claves de caché (`['opinion-hist',
 * tipo]`, `['cumpl-config']`, `['cumpl-dec-resumen']`, …). Cada tarjeta/fila abre su
 * sección en una VENTANA EMERGENTE (modal) aquí mismo —el hub «Cumplimiento fiscal» se
 * RETIRÓ—: opiniones con `PanelOpinion`, y Notificaciones/Declaraciones/Info fiscal/
 * Validar CFDI con los paneles de `CumplimientoPaneles`. Encabezado claro (tarjeta de
 * empresa) + tablero oscuro con la paleta NEXO (#0B1220/#111D30/#244A78, estados verde/
 * ámbar/rojo). Botón «Salir» vuelve al Dashboard.
 */
import { useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck, Landmark, HardHat, Home, ArrowRight,
  Receipt, Bell, FileSearch, X, BadgeCheck,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { aTextoMx } from '@/components/CampoFecha';
import { PanelOpinion, DESC_TIPO } from './PanelOpinion';
import { PanelNotificaciones, PanelDeclaraciones, PanelInfoFiscal, PanelValidarCfdi } from './CumplimientoPaneles';

/* Horario del refresco automático de las opiniones (compliance-cron): lunes 01:50
 * CDMX, para que las tarjetas estén frescas a primera hora del lunes. Se refleja en
 * la condición de actualización de cada documento permanente. */
const HORARIO_REFRESCO = 'lunes 01:50';

/* Paleta NEXO (del documento de diseño). Se escriben como literales completos para
 * que Tailwind (JIT) los compile. */
const C = {
  bg: 'bg-[#0B1220]', panel: 'bg-[#111D30]', panel2: 'bg-[#15243A]',
  borde: 'border-[#1b2d48]', bordeHover: 'hover:border-[#244A78]',
  txt: 'text-[#F3F6FB]', txt2: 'text-[#8FA1BA]', link: 'text-[#8FB4F0]',
};
const TONE: Record<string, { text: string; dot: string }> = {
  ok:    { text: 'text-[#62D6A4]', dot: 'bg-[#62D6A4]' },
  warn:  { text: 'text-[#F4C56B]', dot: 'bg-[#F4C56B]' },
  bad:   { text: 'text-[#E56B6F]', dot: 'bg-[#E56B6F]' },
  muted: { text: 'text-[#8FA1BA]', dot: 'bg-[#8FA1BA]' },
};

const SENT_LABEL: Record<string, string> = {
  POSITIVA: 'Positiva', SIN_ADEUDOS: 'Sin adeudos', VIGENTE: 'Vigente',
  NEGATIVA: 'Negativa', SUSPENDIDA: 'Suspendida', OTRO: 'Otro',
};

/* Título de cada modal de consulta (reusa los paneles de CumplimientoPaneles). */
const PANEL_TITULO: Record<string, string> = {
  NOTIF: 'Notificaciones', DEC: 'Declaraciones', INFO: 'Información fiscal', CFDI: 'Validar CFDI',
};

type Permanente = { key: string; titulo: string; sub: string; icon: any };
const PERMANENTES: Permanente[] = [
  { key: 'SAT',       titulo: '32-D / Opinión SAT', sub: 'Opinión de cumplimiento (Art. 32-D CFF)', icon: ShieldCheck },
  { key: 'CSF',       titulo: 'CIF',                sub: 'Constancia de Situación Fiscal',           icon: Landmark },
  { key: 'IMSS',      titulo: 'Opinión IMSS',       sub: 'Cumplimiento de seguridad social',         icon: HardHat },
  { key: 'INFONAVIT', titulo: 'Opinión INFONAVIT',  sub: 'Aportaciones de vivienda',                 icon: Home },
];

/** Estado vigente (más reciente) de una opinión → etiqueta + tono de color. */
function estadoDoc(latest: any): { label: string; tone: keyof typeof TONE } {
  if (!latest) return { label: 'Sin registro', tone: 'muted' };
  const s = String(latest.sentido || '');
  if (['POSITIVA', 'SIN_ADEUDOS', 'VIGENTE'].includes(s)) return { label: 'Vigente', tone: 'ok' };
  if (s === 'NEGATIVA') return { label: 'Negativa', tone: 'bad' };
  if (s === 'SUSPENDIDA') return { label: 'Suspendida', tone: 'warn' };
  return { label: SENT_LABEL[s] || 'Registrado', tone: 'muted' };
}

export function PanelFiscalPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const salir = () => navigate('/dashboard');   // «Salir» del panel → vuelve al inicio
  /* Consolidación del cumplimiento DENTRO del Panel: las opiniones (32-D/CIF/IMSS/INFONAVIT)
   * abren un MODAL (reusa PanelOpinion); las consultas (Notificaciones/Declaraciones/Info
   * fiscal/Validar CFDI) también abren en modal (reusan los paneles de CumplimientoPaneles).
   * Al actuar, el panel se refresca solo (comparten las claves de react-query). */
  const [modalTipo, setModalTipo] = useState<string | null>(null);
  const [modalPanel, setModalPanel] = useState<string | null>(null);

  /* Empresa activa — misma caché que el Dashboard. */
  const misEmpresas = useQuery({ queryKey: ['auth', 'companies'], queryFn: () => api.misEmpresas() });
  const empresas: any[] = (misEmpresas.data as any)?.data || [];
  const empresa = empresas.find((e) => e.id === user?.companyId) || empresas[0];
  const iniciales = String(empresa?.business_name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase();

  /* Config (condiciones de actualización) + histórico por tipo — claves del hub. */
  const configQ = useQuery({ queryKey: ['cumpl-config'], queryFn: () => api.getConfigCumplimiento() });
  const cfgs: any = (configQ.data as any)?.data?.configs || {};
  const histResults = useQueries({
    queries: PERMANENTES.map((t) => ({
      queryKey: ['opinion-hist', t.key],
      queryFn: () => api.getOpinionHistorial(t.key),
    })),
  });
  const latestByTipo: Record<string, any> = {};
  PERMANENTES.forEach((t, i) => { latestByTipo[t.key] = ((histResults[i].data as any)?.data || [])[0]; });

  /* Declaraciones respaldadas (conteo por año) — sin tocar SatGo. */
  const decQ = useQuery({ queryKey: ['cumpl-dec-resumen'], queryFn: () => api.satgoDeclaracionesResumen() });
  const aniosDec: any[] = (decQ.data as any)?.data?.anios || [];
  const decDeAnio = (y: number) => {
    const a = aniosDec.find((x) => Number(x.ejercicio) === y);
    if (!a) return null;
    const total = Object.values(a.porMes || {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
    return { total, descargadoAt: a.descargadoAt as string | undefined };
  };

  /* Notificaciones: consulta en vivo (buzón) que vive en su ventana; aquí sólo se LEE
   * de caché si ya se consultó en esta sesión (no se dispara). */
  const notifQ = useQuery({ queryKey: ['buzon-notif'], queryFn: () => api.getBuzonNotificaciones(), enabled: false, staleTime: Infinity, gcTime: Infinity });
  const notif: any = (notifQ.data as any)?.data;
  /* Información fiscal GUARDADA: lectura barata de la BD (sin SatGo); se enciende para
   * que la fila muestre si ya está y cuándo se actualizó. */
  const infoQ = useQuery({ queryKey: ['cumpl-info-fiscal'], queryFn: () => api.satgoInfoFiscal(), staleTime: Infinity, gcTime: Infinity });
  const infoSaved: any = (infoQ.data as any)?.data;
  const infoData: any = infoSaved?.info ?? null;

  /* Años para el histórico. */
  const nowY = new Date().getFullYear();
  const [verMas, setVerMas] = useState(false);
  const [anio, setAnio] = useState(nowY);
  const anioMin = verMas ? 2018 : nowY - 5;
  const years: number[] = [];
  for (let y = nowY; y >= anioMin; y--) years.push(y);

  /* Filas del histórico para el año seleccionado. */
  const dec = decDeAnio(anio);
  const notifTotal = notif ? ((notif.comunicados || []).length + (notif.avisos || []).length) : null;
  const notifPend = notif ? [...(notif.comunicados || []), ...(notif.avisos || [])].filter((n: any) => !n.leido).length : 0;
  const infoCount = infoData ? Object.keys(infoData).length : null;

  type Fila = { tipo: string; tab: string; docs: number | null; estado: string; tone: keyof typeof TONE; ultima: string; icon: any };
  const filas: Fila[] = [
    {
      tipo: 'Declaraciones', tab: 'DEC', icon: Receipt,
      docs: dec ? dec.total : null,
      estado: dec ? (dec.total > 0 ? 'Completo' : 'Sin respaldo') : 'Sin respaldo',
      tone: dec && dec.total > 0 ? 'ok' : 'muted',
      ultima: dec?.descargadoAt ? (aTextoMx(dec.descargadoAt) || '—') : '—',
    },
    {
      tipo: 'Notificaciones', tab: 'NOTIF', icon: Bell,
      docs: notifTotal,
      estado: notifTotal == null ? 'Consultar' : notifPend > 0 ? `${notifPend} pendientes` : 'Al día',
      tone: notifTotal == null ? 'muted' : notifPend > 0 ? 'warn' : 'ok',
      ultima: '—',
    },
    {
      tipo: 'Información fiscal', tab: 'INFO', icon: FileSearch,
      docs: infoCount,
      estado: infoCount == null ? 'Consultar' : 'Guardada',
      tone: infoCount == null ? 'muted' : 'ok',
      ultima: infoSaved?.actualizado_at ? (aTextoMx(infoSaved.actualizado_at) || '—') : '—',
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* ── Encabezado claro (imagen 1): Panel fiscal + tarjeta de empresa ── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={22} className="text-primary" /> Panel fiscal
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Expediente de cumplimiento de la empresa: documentos permanentes e histórico, en un vistazo.
        </p>
      </div>

      {empresa && (
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white ring-1 ring-indigo-100 p-4 max-w-md">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tu empresa</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
              {iniciales}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900 leading-tight truncate">{empresa.business_name}</p>
              <p className="text-xs font-mono text-gray-500 mt-0.5">{empresa.rfc}</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full shrink-0">
              Activa
            </span>
          </div>
        </div>
      )}

      {/* ── Tablero oscuro (imagen 2) ── */}
      <div className={`relative ${C.bg} ${C.txt} rounded-2xl p-5 sm:p-7 shadow-xl ring-1 ring-black/20 space-y-7`}>
        {/* X para salir del Panel y volver al inicio (Dashboard). */}
        <button onClick={salir} title="Salir y volver al inicio" aria-label="Salir"
          className="absolute top-3 right-3 z-10 inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#8FA1BA] hover:text-white hover:bg-white/10 transition">
          <X size={20} />
        </button>
        {/* Documentos permanentes */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold tracking-wide">DOCUMENTOS PERMANENTES</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PERMANENTES.map((t) => {
              const latest = latestByTipo[t.key];
              const est = estadoDoc(latest);
              const tone = TONE[est.tone];
              const cfg = cfgs[t.key] || {};
              const esInfonavit = t.key === 'INFONAVIT';
              const cond = esInfonavit
                ? 'Manual (captura)'
                : cfg.activo ? `Automática · ${HORARIO_REFRESCO}` : 'Manual';
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={() => setModalTipo(t.key)}
                  className={`text-left ${C.panel} border ${C.borde} ${C.bordeHover} rounded-xl p-4 transition group`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{t.titulo}</p>
                      <p className={`text-xs ${C.txt2} mt-0.5`}>{t.sub}</p>
                    </div>
                    <Icon size={18} className={`${C.txt2} shrink-0`} />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${tone.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} /> {est.label}
                    </span>
                    <span className={`text-xs ${C.txt2}`}>
                      {latest?.fecha_opinion ? (aTextoMx(latest.fecha_opinion) || '') : ''}
                    </span>
                  </div>
                  <div className={`flex items-center justify-between mt-3 pt-2.5 border-t ${C.borde}`}>
                    <span className={`text-[11px] ${C.txt2}`}>
                      Actualiz.: {cond}
                      {!esInfonavit && cfg.ultima_ejecucion ? ` · ${aTextoMx(cfg.ultima_ejecucion) || cfg.ultima_ejecucion}` : ''}
                    </span>
                    <span className={`text-[11px] ${C.link} inline-flex items-center gap-1 opacity-80 group-hover:opacity-100`}>
                      Gestionar <ArrowRight size={11} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Documentos anuales / histórico */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold tracking-wide">DOCUMENTOS ANUALES / HISTÓRICO</h2>
            <p className={`text-sm ${C.txt2} mt-0.5`}>Seleccione un ejercicio para consultar declaraciones, notificaciones e información fiscal.</p>
          </div>

          {/* Pestañas de año */}
          <div className="flex flex-wrap gap-2">
            {years.map((y) => (
              <button key={y} onClick={() => setAnio(y)}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium border transition ${
                  anio === y
                    ? 'bg-[#244A78] border-[#2f5f99] text-white'
                    : `${C.panel2} ${C.borde} ${C.txt2} hover:text-white ${C.bordeHover}`}`}>
                {y}
              </button>
            ))}
            {!verMas && anioMin > 2018 && (
              <button onClick={() => setVerMas(true)}
                className={`px-4 py-2.5 rounded-lg text-sm ${C.txt2} hover:text-white border border-transparent`}>
                + años anteriores
              </button>
            )}
          </div>

          {/* Tabla */}
          <div className={`${C.panel} border ${C.borde} rounded-xl overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${C.borde}`}>
                  {['Tipo', 'Periodo', 'Documentos', 'Estado', 'Última act.'].map((h) => (
                    <th key={h} className={`px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide ${C.txt2}`}>{h}</th>
                  ))}
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const tone = TONE[f.tone];
                  const Icon = f.icon;
                  return (
                    <tr key={f.tipo} onClick={() => setModalPanel(f.tab)}
                      className={`border-t ${C.borde} hover:bg-white/5 cursor-pointer`}>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <Icon size={15} className={C.txt2} /> {f.tipo}
                        </span>
                      </td>
                      <td className={`px-4 py-3 ${C.txt2}`}>{anio}</td>
                      <td className="px-4 py-3 tabular-nums">{f.docs == null ? '—' : f.docs}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 ${tone.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} /> {f.estado}
                        </span>
                      </td>
                      <td className={`px-4 py-3 ${C.txt2}`}>{f.ultima}</td>
                      <td className="px-4 py-3 text-right"><ArrowRight size={14} className={C.txt2} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-[11px] ${C.txt2} flex-1 min-w-[16rem]`}>
              Notificaciones e Información fiscal se consultan en vivo (e.firma / CIEC) en su ventana; aquí se
              muestran si ya las consultaste en esta sesión. Las declaraciones respaldadas se cuentan por año.
            </p>
            <button onClick={() => setModalPanel('CFDI')}
              className={`inline-flex items-center gap-1.5 ${C.panel2} border ${C.borde} ${C.bordeHover} ${C.txt} rounded-lg px-3 py-2 text-sm shrink-0`}>
              <BadgeCheck size={15} /> Validar un CFDI
            </button>
          </div>
        </section>
      </div>

      {/* Modal de la opinión (Fase 1 de la consolidación): reusa PanelOpinion con todo
          (Descargar/Configurar/Registrar/histórico). Al cerrar, el panel ya está
          refrescado porque las acciones invalidan las mismas claves de react-query. */}
      {modalTipo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setModalTipo(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white rounded-t-xl">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <ShieldCheck size={18} className="text-primary" /> {DESC_TIPO[modalTipo]?.nombre || modalTipo}
              </h3>
              <button onClick={() => setModalTipo(null)}
                className="inline-flex items-center gap-1.5 text-sm text-gray-600 border px-3 py-1.5 rounded-lg hover:bg-gray-50">
                <X size={16} /> Salir
              </button>
            </div>
            <div className="p-5">
              <PanelOpinion tipo={modalTipo} />
            </div>
          </div>
        </div>
      )}

      {/* Modal de consulta (Notificaciones/Declaraciones/Info fiscal/Validar CFDI):
          reusa los paneles de CumplimientoPaneles. Botón «Salir» para cerrar; al cerrar,
          las filas del histórico ya reflejan lo consultado (comparten caché). */}
      {modalPanel && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setModalPanel(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white rounded-t-xl z-10">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <ShieldCheck size={18} className="text-primary" /> {PANEL_TITULO[modalPanel] || modalPanel}
              </h3>
              <button onClick={() => setModalPanel(null)}
                className="inline-flex items-center gap-1.5 text-sm text-gray-600 border px-3 py-1.5 rounded-lg hover:bg-gray-50">
                <X size={16} /> Salir
              </button>
            </div>
            <div className="p-5">
              {modalPanel === 'NOTIF' && <PanelNotificaciones />}
              {modalPanel === 'DEC' && <PanelDeclaraciones />}
              {modalPanel === 'INFO' && <PanelInfoFiscal />}
              {modalPanel === 'CFDI' && <PanelValidarCfdi />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PanelFiscalPage;
