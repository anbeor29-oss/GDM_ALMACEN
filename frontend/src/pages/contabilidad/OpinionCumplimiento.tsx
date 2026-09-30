/**
 * Opinión de Cumplimiento — SAT (32-D), IMSS e INFONAVIT.
 *
 * Registra y da seguimiento a las tres opiniones (sentido, fecha, folio y PDF). La
 * más reciente por tipo es la vigente; se guarda el histórico. La descarga en vivo
 * (Buzón/e.firma) es una fase posterior: por ahora se captura lo que se obtiene del
 * portal de cada dependencia.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, Trash2, FileText, X, Save, AlertTriangle, Settings, DownloadCloud, ExternalLink, Download } from 'lucide-react';
import api from '@/services/api';
import { CampoFecha, aTextoMx } from '@/components/CampoFecha';
import { claseOpcion } from '@/utils/coloresOpciones';

const TIPOS: Array<[string, string, string]> = [
  ['SAT', 'SAT (32-D)', 'Opinión del cumplimiento de obligaciones fiscales (Art. 32-D CFF).'],
  ['CSF', 'CIF/CSF', 'Constancia de Situación Fiscal (CIF) — la identidad fiscal de la empresa (RFC, régimen, domicilio).'],
  ['IMSS', 'IMSS', 'Opinión de cumplimiento de obligaciones en materia de seguridad social.'],
  ['INFONAVIT', 'INFONAVIT', 'Cumplimiento en materia de aportaciones de vivienda (INFONAVIT) — captura manual.'],
];
const SENTIDOS: Array<[string, string]> = [
  ['POSITIVA', 'Positiva (al corriente)'],
  ['SIN_ADEUDOS', 'Sin adeudos'],
  ['VIGENTE', 'Vigente'],
  ['NEGATIVA', 'Negativa (con adeudos)'],
  ['SUSPENDIDA', 'Suspendida'],
  ['OTRO', 'Otro'],
];
const badgeSentido = (s: string) =>
  s === 'POSITIVA' || s === 'SIN_ADEUDOS' ? 'bg-emerald-100 text-emerald-700'
    : s === 'NEGATIVA' ? 'bg-rose-100 text-rose-700'
    : s === 'SUSPENDIDA' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
const etiquetaSentido = (s: string) => (SENTIDOS.find(([k]) => k === s)?.[1] || s);

export function OpinionCumplimientoPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('SAT');
  const [form, setForm] = useState<boolean>(false);
  const [msg, setMsg] = useState('');

  const histQ = useQuery({ queryKey: ['opinion-hist', tab], queryFn: () => api.getOpinionHistorial(tab) });
  const historial: any[] = histQ.data?.data || [];
  const [cfgModal, setCfgModal] = useState(false);
  const [asistenteImss, setAsistenteImss] = useState(false);
  const [asistenteSat, setAsistenteSat] = useState(false);
  const configQ = useQuery({ queryKey: ['cumpl-config'], queryFn: () => api.getConfigCumplimiento() });
  const cfgActual: any = configQ.data?.data?.configs?.[tab];

  const descargar = async () => {
    setMsg('');
    if (tab === 'INFONAVIT') {
      // Manual: se abre el portal del INFONAVIT; el usuario baja la constancia y la sube con «Registrar».
      window.open('https://portalmx.infonavit.org.mx/wps/portal/infonavitmx/mx2/patrones/tramites_adicionales/constancia_situacion_fiscal/', '_blank', 'noopener,noreferrer');
      setMsg('Se abrió el portal del INFONAVIT. Descarga tu constancia/opinión y súbela con «Registrar» (NEXO la lee sola).');
      return;
    }
    // SAT (32-D), CIF/CSF e IMSS → un clic: el MOTOR lo baja por SatGo y lo registra solo
    // (IMSS por RFC; SAT/CSF con la clave CIEC de «Configurar», o la opinión pública si no hay).
    // Si el motor no puede (no configurado / requiere acción), se abre el ASISTENTE guiado que
    // abre el sitio oficial EN TU NAVEGADOR y deja subir el PDF.
    const abrirAsistente = () => (tab === 'IMSS' ? setAsistenteImss(true) : setAsistenteSat(true));
    try {
      const r: any = await api.descargarCumplimiento(tab);
      const d = r?.data;
      if (d?.estado === 'SUCCESS') {
        setMsg(String(d?.mensaje || '').includes('pública')
          ? 'Descargado y registrado (SatGo · opinión pública).'
          : 'Descargado y registrado (SatGo).');
        qc.invalidateQueries({ queryKey: ['opinion-hist', tab] });
        qc.invalidateQueries({ queryKey: ['opinion-resumen'] });
      } else {
        if (d?.mensaje) setMsg(d.mensaje);
        abrirAsistente();
      }
    } catch (e: any) {
      setMsg(e?.response?.data?.message || 'No se pudo por SatGo; usa el asistente.');
      abrirAsistente();
    }
  };

  const borrar = async (id: string) => {
    if (!window.confirm('¿Borrar este registro de opinión?')) return;
    try { await api.borrarOpinion(id); qc.invalidateQueries({ queryKey: ['opinion-hist', tab] }); qc.invalidateQueries({ queryKey: ['opinion-resumen'] }); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo borrar.'); }
  };

  const tipoActual = TIPOS.find(([k]) => k === tab)!;

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={22} className="text-primary" /> Opinión de Cumplimiento
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          SAT (32-D), IMSS e INFONAVIT — el estado de cumplimiento de la empresa. Registra la opinión que
          obtienes de cada portal; la más reciente es la vigente.
        </p>
      </div>

      {/* Pestañas por tipo */}
      <div className="flex gap-1.5 flex-wrap">
        {TIPOS.map(([k, nombre], i) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === k)}`}>{nombre}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600 flex-1 min-w-[14rem]">{tipoActual[2]}</p>
        <div className="flex items-center gap-1.5">
          <button onClick={descargar}
            title={tab === 'INFONAVIT'
              ? 'Abre el portal del INFONAVIT; descarga tu constancia/opinión y súbela con Registrar (captura manual)'
              : 'Un clic: la baja por SatGo y la registra sola. Si no puede, abre el sitio oficial en tu navegador para descargarla'}
            className="flex items-center gap-1.5 border border-primary/40 text-primary px-3 py-1.5 rounded-lg hover:bg-primary/5 text-sm">
            <DownloadCloud size={15} /> {tab === 'INFONAVIT' ? 'Portal INFONAVIT' : 'Descargar'}
          </button>
          {tab !== 'INFONAVIT' && (
            <button onClick={() => setCfgModal(true)}
              title="Refresco automático los domingos y, para SAT/CIF, la clave CIEC (se guarda cifrada)"
              className="flex items-center gap-1.5 border px-3 py-1.5 rounded-lg hover:bg-gray-50 text-sm text-gray-600">
              <Settings size={15} /> Configurar
              {cfgActual?.activo && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="refresco automático activo" />}
            </button>
          )}
          <button onClick={() => setForm(true)}
            className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90 text-sm">
            <Plus size={15} /> Registrar
          </button>
        </div>
      </div>
      {msg && <p className="text-sm text-gray-700 bg-gray-50 border rounded px-3 py-2">{msg}</p>}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Sentido</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Observaciones</th>
              <th className="px-4 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!histQ.isLoading && historial.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">Sin registros de {tipoActual[1]}. Registra la primera opinión.</td></tr>
            )}
            {historial.map((h) => (
              <tr key={h.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm">{aTextoMx(h.fecha_opinion)}</td>
                <td className="px-4 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeSentido(h.sentido)}`}>{etiquetaSentido(h.sentido)}</span></td>
                <td className="px-4 py-2 text-xs font-mono text-gray-600">{h.folio || '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-500"><p className="truncate max-w-xs">{h.observaciones || ''}</p></td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {h.tiene_pdf && (
                    <button onClick={() => api.verOpinionPdf(h.id).catch(() => setMsg('No se pudo abrir el PDF.'))}
                      className="text-gray-400 hover:text-sky-600 mr-2" title="Ver PDF"><FileText size={15} /></button>
                  )}
                  <button onClick={() => borrar(h.id)} className="text-gray-400 hover:text-rose-500" title="Borrar"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <ModalRegistrar tipo={tab} tipoNombre={tipoActual[1]}
          onCerrar={() => setForm(false)}
          onHecho={() => { setForm(false); qc.invalidateQueries({ queryKey: ['opinion-hist', tab] }); qc.invalidateQueries({ queryKey: ['opinion-resumen'] }); }} />
      )}
      {cfgModal && (
        <ModalConfig tipo={tab} tipoNombre={tipoActual[1]} actual={cfgActual}
          onCerrar={() => setCfgModal(false)}
          onHecho={() => { setCfgModal(false); qc.invalidateQueries({ queryKey: ['cumpl-config'] }); }} />
      )}
      {asistenteImss && (
        <ModalAsistenteImss
          onCerrar={() => setAsistenteImss(false)}
          onRegistrar={() => { setAsistenteImss(false); setForm(true); }} />
      )}
      {asistenteSat && (
        <ModalAsistenteSat tipo={tab}
          onCerrar={() => setAsistenteSat(false)}
          onRegistrar={() => { setAsistenteSat(false); setForm(true); }} />
      )}
    </div>
  );
}

/**
 * Asistente guiado del Buzón IMSS (proceso interno-externo). No automatiza el login
 * con e.firma (es un portal de gobierno: la autenticación la hace el usuario en el
 * sitio oficial), pero abre el portal y desglosa los pasos exactos para bajar la
 * 32-D, y deja registrar el PDF descargado de un clic.
 */
const PORTAL_IMSS_LOGIN = 'https://buzon.imss.gob.mx/buzonimss/login';
const PORTAL_IMSS_32D = 'https://buzon.imss.gob.mx/buzonimss/opinionCumplimiento/consultaMiOpinion';

const PASOS_IMSS: Array<{ t: string; d?: string }> = [
  { t: 'Entra con tu e.firma', d: 'En el botón «Abrir Buzón IMSS» captura tu RFC, sube tu .cer y tu .key, la contraseña de la e.firma y «Validar». (Es el sitio oficial del IMSS.)' },
  { t: 'Abre «32D Consultar Mi Opinión»', d: 'En la barra superior, el ÚLTIMO ícono (hoja con ✓) → 3.ª opción. O usa el enlace directo de abajo (ya con sesión iniciada).' },
  { t: 'Descarga la opinión', d: 'Clic en el ícono de descarga (↓) junto a «Consultar Mi Opinión del Cumplimiento» y espera «Procesando…».' },
  { t: 'Regístrala aquí', d: 'El PDF se guarda en Descargas como «MiOpinion_[tu RFC].pdf». Regresa, súbelo con el botón de abajo y cierra el portal del IMSS.' },
];

function ModalAsistenteImss({ onCerrar, onRegistrar }: { onCerrar: () => void; onRegistrar: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><ShieldCheck size={18} className="text-primary" /> Asistente · Opinión IMSS (32-D)</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <a href={PORTAL_IMSS_LOGIN} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-primary text-white px-3 py-2.5 rounded-lg hover:opacity-90 text-sm font-medium">
              <ExternalLink size={16} /> Abrir Buzón IMSS
            </a>
            <a href={PORTAL_IMSS_32D} target="_blank" rel="noopener noreferrer"
              title="Atajo directo a la pantalla 32-D (funciona una vez que ya iniciaste sesión con tu e.firma)"
              className="inline-flex items-center justify-center gap-2 border border-primary/40 text-primary px-3 py-2.5 rounded-lg hover:bg-primary/5 text-sm font-medium">
              <ExternalLink size={16} /> Ir directo a la 32-D
            </a>
          </div>
          <ol className="space-y-2.5">
            {PASOS_IMSS.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.t}</p>
                  {p.d && <p className="text-xs text-gray-500 leading-relaxed">{p.d}</p>}
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Por seguridad, la e.firma se captura <b>en el sitio del IMSS</b>, no aquí. Además, una página web no puede tomar sola el archivo de tu carpeta de Descargas: por eso el PDF se adjunta con un clic (la toma automática la haría una app nativa).
          </p>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <button onClick={onCerrar} className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">Cerrar</button>
            <button onClick={onRegistrar} className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-1.5 rounded-lg hover:opacity-90 text-sm">
              <Download size={15} /> Ya lo descargué — Registrar el PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Asistente guiado del SAT (32-D y CSF). Como la app del 32-D bloquea el navegador
 * automatizado (sale en blanco), NO se automatiza: se abre el sitio oficial EN TU
 * NAVEGADOR (ahí sí renderiza), bajas el PDF y lo subes aquí — NEXO lo lee y llena
 * sentido/fecha/folio solo. La e.firma se captura en el sitio del SAT, no aquí.
 */
const APP_SAT_32D = 'https://ptsc32d.clouda.sat.gob.mx/';
const PORTAL_SAT_HOME = 'https://www.sat.gob.mx/home';

function ModalAsistenteSat({ tipo, onCerrar, onRegistrar }: { tipo: string; onCerrar: () => void; onRegistrar: () => void }) {
  const es32d = tipo === 'SAT';
  const url = es32d ? APP_SAT_32D : PORTAL_SAT_HOME;
  const titulo = es32d ? 'Opinión de Cumplimiento (32-D)' : 'Constancia de Situación Fiscal (CIF/CSF)';
  const pasos: Array<{ t: string; d?: string }> = es32d ? [
    { t: 'Abre la app de la Opinión 32-D', d: 'Con el botón de abajo (se abre en tu navegador). Elige e.firma —no CIEC, el CIEC pide CAPTCHA—, sube tu .cer y .key y tu contraseña.' },
    { t: 'Revisa tu opinión', d: 'La app muestra el sentido (Positiva/Negativa). Descarga el PDF con el botón de descargar/imprimir.' },
    { t: 'Regístrala aquí', d: 'Regresa y súbela con «Ya lo descargué — Registrar»; NEXO lee el PDF y llena sentido, fecha y folio solo (los puedes corregir).' },
  ] : [
    { t: 'Abre el portal del SAT', d: 'Con el botón de abajo. Ve a «Otros trámites y servicios» → «Genera tu Constancia de Situación Fiscal» → entra con tu e.firma.' },
    { t: 'Descarga tu CSF', d: 'Genera y descarga el PDF de la Constancia de Situación Fiscal.' },
    { t: 'Regístrala aquí', d: 'Regresa y súbela con «Ya lo descargué — Registrar»; NEXO la lee sola.' },
  ];
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><ShieldCheck size={18} className="text-primary" /> Asistente · {titulo}</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-primary text-white px-3 py-2.5 rounded-lg hover:opacity-90 text-sm font-medium w-full">
            <ExternalLink size={16} /> {es32d ? 'Abrir la app de la Opinión 32-D' : 'Abrir el portal del SAT'}
          </a>
          <ol className="space-y-2.5">
            {pasos.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.t}</p>
                  {p.d && <p className="text-xs text-gray-500 leading-relaxed">{p.d}</p>}
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Por seguridad, la e.firma se captura <b>en el sitio del SAT</b>, no aquí. El sitio del SAT no funciona dentro de un navegador automatizado, por eso se abre en el tuyo y el PDF se sube con un clic.
          </p>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <button onClick={onCerrar} className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">Cerrar</button>
            <button onClick={onRegistrar} className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-1.5 rounded-lg hover:opacity-90 text-sm">
              <Download size={15} /> Ya lo descargué — Registrar el PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Configurar — versión mínima. Ya no se capturan endpoint/usuario/token por empresa
 * (SatGo vive en Súper Admin y el RFC se toma de la empresa). Sólo queda:
 *   · SAT / CIF-CSF: la clave CIEC (SatGo la usa para bajar la 32-D `oc` y la CSF).
 *   · IMSS: nada — se baja por RFC, sin CIEC.
 *   · Refresco automático los domingos (marca la config como «Activa» para el barrido).
 */
function ModalConfig({ tipo, tipoNombre, actual, onCerrar, onHecho }: any) {
  const [credencial, setCredencial] = useState('');   // vacío = conservar el guardado
  const [activo, setActivo] = useState(!!actual?.activo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const usaCiec = tipo === 'SAT' || tipo === 'CSF';

  const guardar = async () => {
    setBusy(true); setError('');
    try {
      const payload: any = { metodo: 'API', modo: activo ? 'AUTOMATICO' : 'MANUAL', activo };
      if (usaCiec && credencial !== '') payload.credencial = credencial;   // sólo si se teclea
      await api.setConfigCumplimiento(tipo, payload);
      onHecho();
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Configurar · {tipoNombre}</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-600 bg-gray-50 border rounded px-3 py-2">
            {usaCiec
              ? <>SatGo baja la {tipo === 'CSF' ? 'Constancia de Situación Fiscal' : 'Opinión 32-D'} con la <b>clave CIEC</b> de la empresa (el RFC se toma solo). Sin CIEC, el 32-D intenta la <b>opinión pública</b> por RFC (si la activaste en el SAT).</>
              : <>La opinión del <b>IMSS</b> se baja por <b>RFC</b> con SatGo — no necesita CIEC. Sólo decide si quieres el refresco automático.</>}
          </p>
          {usaCiec && (
            <label className="block"><span className="text-xs text-gray-600">Clave CIEC {actual?.tiene_credencial && <span className="text-emerald-600">· guardada</span>}</span>
              <input type="password" value={credencial} onChange={(e) => setCredencial(e.target.value)}
                placeholder={actual?.tiene_credencial ? '•••• (sin cambio)' : 'clave CIEC del SAT'} className="input w-full" />
              <span className="text-[11px] text-gray-400">Se guarda <b>cifrada</b>; déjala vacía para conservar la actual.</span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Refrescar automáticamente los <b>domingos</b> por la noche (sustituye la vigente)
          </label>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCerrar} className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={guardar} disabled={busy} className="flex items-center gap-1.5 bg-primary text-white px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
              <Save size={15} /> {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalRegistrar({ tipo, tipoNombre, onCerrar, onHecho }: any) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [sentido, setSentido] = useState('POSITIVA');
  const [folio, setFolio] = useState('');
  const [observaciones, setObs] = useState('');
  const [pdf, setPdf] = useState<string>('');
  const [pdfNombre, setPdfNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detectando, setDetectando] = useState(false);
  const [detectado, setDetectado] = useState('');

  const leerPdf = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_600_000) { setError('El PDF es muy grande (máximo ~1.5 MB).'); return; }
    const rd = new FileReader();
    rd.onload = async () => {
      const dataUrl = String(rd.result || '');
      setPdf(dataUrl); setPdfNombre(f.name); setError('');
      // NEXO lee el PDF y autollena sentido/fecha/folio (se pueden corregir).
      setDetectando(true); setDetectado('');
      try {
        const r: any = await api.leerOpinionPdf(dataUrl);
        const d = r?.data || {};
        const partes: string[] = [];
        if (d.sentido) { setSentido(d.sentido); partes.push('sentido'); }
        if (d.fecha_opinion) { setFecha(d.fecha_opinion); partes.push('fecha'); }
        if (d.folio) { setFolio(d.folio); partes.push('folio'); }
        setDetectado(
          partes.length ? `NEXO detectó: ${partes.join(', ')}. Verifica y registra.`
            : d.texto_ok ? 'No pude detectar los datos; captúralos a mano.'
            : 'El PDF parece escaneado (sin texto); captura los datos a mano.',
        );
      } catch { setDetectado('No se pudo leer el PDF automáticamente; captura los datos a mano.'); }
      finally { setDetectando(false); }
    };
    rd.readAsDataURL(f);
  };

  const guardar = async () => {
    setBusy(true); setError('');
    try {
      await api.registrarOpinion({ tipo, sentido, fecha_opinion: fecha, folio: folio.trim() || null, observaciones: observaciones.trim() || null, pdf: pdf || null });
      onHecho();
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo registrar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Registrar opinión · {tipoNombre}</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-gray-600">Fecha de la opinión</span>
              <CampoFecha value={fecha} onChange={setFecha} className="input w-full" /></label>
            <label className="block"><span className="text-xs text-gray-600">Sentido</span>
              <select value={sentido} onChange={(e) => setSentido(e.target.value)} className="input w-full">
                {SENTIDOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
          </div>
          <label className="block"><span className="text-xs text-gray-600">Folio (opcional)</span>
            <input value={folio} onChange={(e) => setFolio(e.target.value)} className="input w-full font-mono" /></label>
          <label className="block"><span className="text-xs text-gray-600">Observaciones (opcional)</span>
            <textarea value={observaciones} onChange={(e) => setObs(e.target.value)} className="input w-full" rows={2} /></label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => leerPdf(e.target.files?.[0])} />
            <span className="inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 hover:bg-gray-50"><FileText size={14} /> Subir PDF (NEXO lo lee)</span>
            <span className="text-xs text-gray-400 truncate">{pdfNombre || '.pdf ≤ 1.5 MB'}</span>
          </label>
          {detectando && <p className="text-xs text-gray-500">Leyendo el PDF…</p>}
          {detectado && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">{detectado}</p>}
          {error && <p className="text-sm text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCerrar} className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={guardar} disabled={busy}
              className="flex items-center gap-1.5 bg-primary text-white px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
              <Save size={15} /> {busy ? 'Guardando…' : 'Registrar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OpinionCumplimientoPage;
