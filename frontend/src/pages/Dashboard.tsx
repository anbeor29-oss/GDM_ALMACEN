/**
 * Dashboard — KPIs reales calculados desde la BD.
 *  · Facturas timbradas (sin DRAFT/CANCELLED)
 *  · Total facturado, cobrado, acreditado por NC, saldo por cobrar
 *  · Listado de facturas recientes con saldo remanente real (no total)
 *  · Clientes con su saldo agregado
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { FileText, Wallet, TrendingDown, AlertCircle, Stamp, Boxes } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import api from '@/services/api';

function fmt(n: any) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DashboardPage() {
  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => api.getDashboardSummary(),
    refetchOnWindowFocus: true,
  });

  /* Se retiraron las consultas de facturas y clientes recientes: sus listas
   * repetían lo que ya está a un clic en sus propias pantallas. */

  const { data: usage } = useQuery({
    queryKey: ['monthly-usage'],
    queryFn: () => api.getMonthlyUsage(),
    refetchOnWindowFocus: true,
  });

  const { data: invValue } = useQuery({
    queryKey: ['inventory-value'],
    queryFn: () => api.getInventoryValue(),
    refetchOnWindowFocus: true,
  });

  const { data: invHistory } = useQuery({
    queryKey: ['inventory-value-history'],
    queryFn: () => api.getInventoryValueHistory(12),
  });

  const qc = useQueryClient();
  const { user, setToken, setUser } = useAuthStore();

  const s = summary?.data || {};
  const u = usage?.data;

  /* EMPRESAS DE ESTE CORREO.
   *
   * La empresa activa dejó de ser un atributo del usuario para volverse una
   * elección de la sesión, así que la pantalla tiene que decir en cuál se está
   * trabajando. Sin eso, alguien con dos RFC no tiene forma de saber a cuál va a
   * timbrar — y enterarse después de emitir no se arregla, se cancela. */
  const misEmpresas = useQuery({
    queryKey: ['auth', 'companies'],
    queryFn: () => api.misEmpresas(),
  });
  const empresas: any[] = (misEmpresas.data as any)?.data || [];
  const empresaActiva = empresas.find((e) => e.id === user?.companyId) || empresas[0];

  const [cambiando, setCambiando] = useState('');

  const cambiarEmpresa = async (companyId: string) => {
    if (companyId === user?.companyId) return;
    setCambiando(companyId);
    try {
      const r: any = await api.cambiarEmpresa(companyId);

      /* SE ACTUALIZA EL TOKEN **Y** EL USUARIO GUARDADO.
       *
       * Aquí estaba el bloqueo: sólo se reemplazaba el token, pero el store
       * PERSISTE el usuario, y `user.companyId` seguía siendo el de la empresa
       * anterior. Con eso, el selector volvía a marcar la vieja —su value sale
       * de ahí— y el guard de arriba, que compara contra ese mismo campo,
       * impedía regresar: parecía atorado en una empresa.
       *
       * El token llevaba la empresa nueva, así que los datos SÍ cambiaban por
       * debajo. Era peor que un error visible: la pantalla decía una cosa y el
       * servidor respondía otra. */
      if (r?.data?.token) setToken(r.data.token);
      if (user) {
        setUser({
          ...user,
          companyId: r?.data?.company?.id || companyId,
          workGroup: r?.data?.workGroup || user.workGroup,
        });
      }

      /* Se limpia TODA la caché antes de recargar: si se conservara, la pantalla
       * mostraría facturas de la empresa anterior mientras el token ya apunta a
       * otra. */
      qc.clear();
      window.location.reload();
    } catch (e: any) {
      alert(`No se pudo cambiar de empresa.\n\n${e.response?.data?.message || e.message}`);
      setCambiando('');
    }
  };
  const inv = invValue?.data;
  const histRows: any[] = invHistory?.data?.history || [];
  const chartData = histRows.map((h) => ({
    mes: new Date(h.snapshot_month).toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
    valor: Number(h.total_value),
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Dashboard</h1>
          {empresaActiva ? (
            <p className="text-gray-600 mt-2">
              Trabajando en{' '}
              <b className="text-gray-900">{empresaActiva.business_name}</b>
              <span className="text-gray-400"> · {empresaActiva.rfc}</span>
            </p>
          ) : (
            <p className="text-gray-600 mt-2">Resumen de tu cartera al día de hoy</p>
          )}
        </div>

        {/* El selector sólo aparece con más de una empresa: con una sola no hay
            nada que elegir y sería un control que nunca se usa. */}
        {empresas.length > 1 && (
          <label className="block">
            <span className="text-xs text-gray-500 block mb-1">Cambiar de empresa</span>
            <select
              className="input min-w-[16rem]"
              value={user?.companyId || ''}
              disabled={!!cambiando}
              onChange={(e) => cambiarEmpresa(e.target.value)}
            >
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.business_name} — {e.rfc}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* KPIs reales (Ingresos timbrados, no borradores ni cancelados) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          icon={<FileText size={24} />}
          title="Facturas emitidas"
          value={s.facturas ?? 0}
          color="indigo"
        />
        <MetricCard
          icon={<TrendingDown size={24} />}
          title="Total facturado"
          value={`$ ${fmt(s.total_facturado)}`}
          color="sky"
        />
        <MetricCard
          icon={<Wallet size={24} />}
          title="Cobrado + NC"
          value={`$ ${fmt(Number(s.total_cobrado || 0) + Number(s.total_acreditado || 0))}`}
          color="emerald"
          hint={`Pagos $ ${fmt(s.total_cobrado)} · NC $ ${fmt(s.total_acreditado)}`}
        />
        <MetricCard
          icon={<AlertCircle size={24} />}
          title="Saldo por cobrar"
          value={`$ ${fmt(s.saldo_por_cobrar)}`}
          color="amber"
          hint={`${s.facturas_con_saldo ?? 0} facturas con saldo pendiente`}
        />
      </div>


      {/* Valor del inventario — actual + histórico mensual (snapshots) */}
      {inv && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-fuchsia-50 text-fuchsia-600 ring-1 ring-fuchsia-100 p-2 rounded-lg">
                <Boxes size={20} />
              </div>
              <div>
                <h3 className="text-gray-900 font-semibold">Valor del inventario</h3>
                <p className="text-xs text-gray-500">
                  {inv.consolidated.productsCount} productos con existencia ·{' '}
                  {Number(inv.consolidated.totalUnits).toLocaleString('es-MX')} unidades
                </p>
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900">$ {fmt(inv.consolidated.totalValue)}</p>
          </div>

          {/* Desglose por almacén */}
          {inv.warehouses.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {inv.warehouses.map((w: any) => (
                <div key={w.warehouse_id} className="border border-gray-200 rounded-lg p-3">
                  <p className="text-xs font-mono text-sky-700">{w.code}</p>
                  <p className="text-sm text-gray-600 truncate">{w.name}</p>
                  <p className="font-semibold text-gray-900">$ {fmt(w.total_value)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Histórico mes a mes */}
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                  <defs>
                    <linearGradient id="invValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} width={55} />
                  <Tooltip formatter={(v: any) => [`$ ${fmt(v)}`, 'Valuación']} />
                  <Area type="monotone" dataKey="valor" stroke="#3B82F6" strokeWidth={2}
                    fill="url(#invValue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">
              El histórico mensual se llena con el snapshot automático del día 1 (o manual desde
              Inventario → Reportes).
            </p>
          )}
        </div>
      )}

      {/* EMPRESAS QUE ADMINISTRA ESTE CORREO.
          Sustituye a las listas de facturas y clientes recientes, que repetían
          lo que ya está a un clic en sus propias pantallas. Aquí, en cambio, se
          responde algo que no se puede ver en ningún otro lado: qué RFC maneja
          esta cuenta y en cuál se está trabajando. */}
      {empresas.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">
            {empresas.length > 1 ? 'Empresas que administras' : 'Tu empresa'}
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            {empresas.length > 1
              ? 'Haz clic en una para trabajar en ella.'
              : 'Datos fiscales del emisor con el que timbras.'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {empresas.map((e) => {
              const activa = e.id === user?.companyId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => cambiarEmpresa(e.id)}
                  disabled={!!cambiando || activa}
                  className={`text-left border rounded-lg p-4 transition-colors ${
                    activa
                      ? 'border-indigo-400 bg-indigo-50 cursor-default'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-gray-900 leading-tight">
                      {e.business_name}
                    </span>
                    {activa && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded shrink-0">
                        Activa
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-mono text-gray-500 mt-1">{e.rfc}</p>
                  {cambiando === e.id && (
                    <p className="text-xs text-indigo-600 mt-2">Cambiando…</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Consumo de timbres del mes — relevante para plan iguala (100 timbres) */}
      {u && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 p-2 rounded-lg">
                <Stamp size={20} />
              </div>
              <div>
                <h3 className="text-gray-900 font-semibold">Timbres del mes</h3>
                <p className="text-xs text-gray-500">Periodo {u.period} · plan iguala</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">
                {u.usage.total}<span className="text-base text-gray-400"> / {u.plan.cap_timbres}</span>
              </p>
              <p className={`text-xs font-medium ${u.plan.over ? 'text-rose-700' : 'text-emerald-700'}`}>
                {u.plan.over ? `+${u.usage.total - u.plan.cap_timbres} excedente` : `${u.plan.remaining} disponibles`}
              </p>
            </div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 ${u.plan.over ? 'bg-rose-500' : u.plan.consumed_pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, u.plan.consumed_pct)}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-gray-500">
            <span>Facturas: <b className="text-gray-800">{u.usage.facturas}</b></span>
            <span>NC: <b className="text-gray-800">{u.usage.notas_credito}</b></span>
            <span>Pagos: <b className="text-gray-800">{u.usage.pagos}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  color: 'indigo' | 'sky' | 'emerald' | 'amber';
  hint?: string;
}

function MetricCard({ icon, title, value, color, hint }: MetricCardProps) {
  const palette = {
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  ring: 'ring-indigo-100' },
    sky:     { bg: 'bg-sky-50',     text: 'text-sky-600',     ring: 'ring-sky-100' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-100' },
  }[color];
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className={`${palette.bg} ${palette.text} ${palette.ring} ring-1 p-3 rounded-lg w-fit mb-4`}>
        {icon}
      </div>
      <h3 className="text-gray-600 text-sm font-medium mb-1">{title}</h3>
      <p className="text-3xl font-bold text-gray-900 truncate">{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-2">{hint}</p>}
    </div>
  );
}
