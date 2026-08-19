/**
 * Mensajes — recados entre la gente de la misma empresa.
 *
 * Dos buzones y un botón para escribir. Nada más: esto no compite con el correo,
 * resuelve el "ya salió el camión" que hoy se grita o se manda por WhatsApp y se
 * pierde.
 *
 * SE MARCA LEÍDO AL ABRIRLO, NO AL VERLO EN LA LISTA
 * En la lista sólo se ve el asunto; que eso contara como leído dejaría la
 * bandeja en cero sin que nadie hubiera leído nada, y la hora de lectura —que es
 * el dato que alguien va a reclamar— sería falsa.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Inbox, CheckCheck, Reply, X } from 'lucide-react';
import api from '@/services/api';
import { fechaHoraMx } from '@/utils/fecha';

const cuando = (d: any) => {
  if (!d) return '';
  const f = new Date(d);
  const hoy = new Date();
  const mismoDia = f.toDateString() === hoy.toDateString();
  return mismoDia
    ? f.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : f.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) +
      ' ' + f.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
};

export function MensajesPage() {
  const qc = useQueryClient();
  const [buzon, setBuzon] = useState<'recibidos' | 'enviados'>('recibidos');
  const [abierto, setAbierto] = useState<any>(null);
  const [escribiendo, setEscribiendo] = useState<{ paraUserId?: string; asunto?: string; respondeA?: string } | null>(null);
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['mensajes', buzon],
    queryFn: () => api.getMensajes(buzon),
  });
  const mensajes: any[] = q.data?.data?.mensajes || [];

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['mensajes'] });
    qc.invalidateQueries({ queryKey: ['mensajes-no-leidos'] });
  };

  const abrir = async (m: any) => {
    setAbierto(m);
    if (buzon === 'recibidos' && !m.leido_at) {
      try { await api.marcarMensajeLeido(m.id); refrescar(); } catch { /* que no estorbe la lectura */ }
    }
  };

  const leerTodo = async () => {
    try { await api.marcarTodosLosMensajes(); refrescar(); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo marcar'); }
  };

  const noLeidos = mensajes.filter((m) => !m.leido_at).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <MessageSquare className="text-emerald-600" size={36} /> Mensajes
          </h1>
          <p className="text-gray-600 mt-1">
            Recados entre la gente de esta empresa · quedan escritos y con hora
          </p>
        </div>
        <button onClick={() => setEscribiendo({})}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600">
          <Send size={18} /> Escribir
        </button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="bg-white rounded-lg shadow border p-3 flex items-center gap-2">
        {([['recibidos', 'Recibidos'], ['enviados', 'Enviados']] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setBuzon(k); setAbierto(null); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              buzon === k ? 'bg-emerald-100 text-emerald-800' : 'text-gray-500 hover:bg-gray-100'}`}>
            {label}
            {k === 'recibidos' && noLeidos > 0 && buzon === 'recibidos' && (
              <span className="ml-2 bg-rose-600 text-white text-xs px-1.5 py-0.5 rounded-full">{noLeidos}</span>
            )}
          </button>
        ))}
        {buzon === 'recibidos' && noLeidos > 0 && (
          <button onClick={leerTodo}
            className="ml-auto flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
            <CheckCheck size={16} /> Marcar todo como leído
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow divide-y lg:col-span-1 max-h-[70vh] overflow-y-auto">
          {q.isLoading && <p className="p-4 text-sm text-gray-500">Cargando…</p>}
          {!q.isLoading && mensajes.length === 0 && (
            <p className="p-6 text-sm text-gray-500 italic text-center">
              {buzon === 'recibidos' ? 'No tienes mensajes.' : 'No has mandado ninguno.'}
            </p>
          )}
          {mensajes.map((m) => (
            <button key={m.id} onClick={() => abrir(m)}
              className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                abierto?.id === m.id ? 'bg-emerald-50/60' : ''} ${
                !m.leido_at && buzon === 'recibidos' ? 'border-l-4 border-emerald-500' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-sm truncate ${!m.leido_at && buzon === 'recibidos' ? 'font-bold' : 'font-medium'}`}>
                  {buzon === 'recibidos' ? m.de_nombre || m.de_email : m.para_nombre || m.para_email}
                </span>
                <span className="text-[11px] text-gray-400 shrink-0">{cuando(m.created_at)}</span>
              </div>
              <p className="text-xs text-gray-600 truncate">{m.asunto || '(sin asunto)'}</p>
              <p className="text-xs text-gray-400 truncate">{m.cuerpo}</p>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow p-5 lg:col-span-2">
          {!abierto ? (
            <p className="text-sm text-gray-500 italic text-center py-12">
              Elige un mensaje para leerlo.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 border-b pb-3">
                <div>
                  <h2 className="font-semibold">{abierto.asunto || '(sin asunto)'}</h2>
                  <p className="text-xs text-gray-500">
                    De <strong>{abierto.de_nombre || abierto.de_email}</strong> para{' '}
                    <strong>{abierto.para_nombre || abierto.para_email}</strong> ·{' '}
                    {fechaHoraMx(abierto.created_at)}
                    {abierto.leido_at && ` · leído ${fechaHoraMx(abierto.leido_at)}`}
                  </p>
                </div>
                <button onClick={() => setAbierto(null)} className="p-1 hover:bg-gray-100 rounded">
                  <X size={16} />
                </button>
              </div>
              <p className="text-sm whitespace-pre-wrap">{abierto.cuerpo}</p>
              {buzon === 'recibidos' && abierto.de_user_id && (
                <button
                  onClick={() => setEscribiendo({
                    paraUserId: abierto.de_user_id,
                    asunto: abierto.asunto ? `Re: ${abierto.asunto}` : '',
                    respondeA: abierto.id,
                  })}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm">
                  <Reply size={16} /> Responder
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {escribiendo && (
        <ModalEscribir inicial={escribiendo}
          onClose={() => setEscribiendo(null)}
          onEnviado={() => { setEscribiendo(null); setBuzon('enviados'); refrescar(); }} />
      )}
    </div>
  );
}

function ModalEscribir({ inicial, onClose, onEnviado }: {
  inicial: { paraUserId?: string; asunto?: string; respondeA?: string };
  onClose: () => void; onEnviado: () => void;
}) {
  const [para, setPara] = useState(inicial.paraUserId || '');
  const [asunto, setAsunto] = useState(inicial.asunto || '');
  const [cuerpo, setCuerpo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['mensajes-destinatarios'],
    queryFn: () => api.getDestinatarios(),
  });
  const usuarios: any[] = q.data?.data?.usuarios || [];

  const enviar = async () => {
    if (!para) { setError('Elige a quién se lo mandas'); return; }
    if (!cuerpo.trim()) { setError('El mensaje viene vacío'); return; }
    setEnviando(true); setError('');
    try {
      await api.enviarMensaje({
        paraUserId: para, asunto: asunto || undefined,
        cuerpo, respondeA: inicial.respondeA,
      });
      onEnviado();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo enviar');
    } finally { setEnviando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold flex items-center gap-2"><Inbox size={18} /> Nuevo mensaje</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
          <div>
            <label className="block text-xs text-gray-600 mb-1">Para</label>
            <select value={para} onChange={(e) => setPara(e.target.value)} className="input w-full">
              <option value="">— elige a quién —</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}{u.work_group ? ` · ${u.work_group}` : ''}
                </option>
              ))}
            </select>
            {usuarios.length === 0 && !q.isLoading && (
              <p className="text-xs text-amber-700 mt-1">
                No hay nadie más dado de alta en esta empresa todavía.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Asunto (opcional)</label>
            <input value={asunto} onChange={(e) => setAsunto(e.target.value)}
              maxLength={150} className="input w-full" placeholder="Salida del camión" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Mensaje</label>
            <textarea value={cuerpo} onChange={(e) => setCuerpo(e.target.value)}
              rows={6} className="input w-full" placeholder="Escribe el recado…" />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">
            Cancelar
          </button>
          <button onClick={enviar} disabled={enviando}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
            <Send size={16} /> {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
