/**
 * Login Page
 */

import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, ShoppingBag, Store, Truck, CreditCard, Tag } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { GdmLogo } from '@/components/GdmLogo';
import { guardarKiosco, borrarKiosco, hayKiosco, modoKiosco, type ModoChecador } from '@/utils/kioscoAuto';
import api from '@/services/api';

/** Sitio corporativo al que regresa el botón junto a "Ingresar". */
const CORPORATE_SITE_URL = 'https://hcgm.com.mx';

/**
 * variante 'comercio' = la puerta de entrada de Comercio electrónico (ruta /comercio,
 * liga «Comercio electrónico» del menú Herramientas de hcgm.com.mx): mismo login,
 * con tema de tienda (naranja/fucsia) y al entrar cae en el panel de la tienda.
 */
export function LoginPage({ variante = 'nexo' }: { variante?: 'nexo' | 'comercio' } = {}) {
  const comercio = variante === 'comercio';
  const location = useLocation();
  // Tras el alta de prueba se llega aquí con el correo precargado.
  const correoPrecargado = (location.state as { email?: string } | null)?.email || '';
  const [email, setEmail] = useState(correoPrecargado);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /* Auto-entrada del checador en este equipo (kiosco): guarda la credencial y al
   * reabrir la app entra solo al kiosco. Opt-in; conviene con la cuenta CHECADOR. */
  const [kiosco, setKiosco] = useState(hayKiosco());
  /* Modo del equipo: kiosco = punto fijo (tableta 24/7); campo = móvil (teléfono con GPS). */
  const [modo, setModo] = useState<ModoChecador>(modoKiosco());
  const { login } = useAuthStore();
  const navigate = useNavigate();
  /* La opción del checador se oculta hasta que la empresa FIRME: solo aparece si
   * este equipo ya tuvo un login de empresa activa (marca local que pone el Layout)
   * o si ya es un kiosco configurado. Una empresa en prueba nunca la ve. */
  const mostrarChecador = (() => {
    try { return hayKiosco() || localStorage.getItem('nexo_checador_ok') === '1'; } catch { return hayKiosco(); }
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.login(email, password);

      if (response.success && response.data) {
        login(response.data.user, response.data.token, response.data.refreshToken);
        /* Si marcó "entrar automático en este equipo", se recuerda la credencial y
         * se cae directo en el kiosco. Si NO la marcó, se BORRA cualquier
         * auto-entrada previa de este equipo (así se apaga a propósito). */
        if (kiosco) {
          guardarKiosco(email, password, modo);
          navigate(modo === 'campo' ? '/checador/campo' : '/checador/kiosco');
        } else {
          borrarKiosco();
          navigate(comercio ? '/ecommerce' : '/dashboard');
        }
      } else {
        setError(response.message || 'Login failed');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login error');
    } finally {
      setLoading(false);
    }
  };

  if (comercio) return <LoginComercio {...{ email, setEmail, password, setPassword, error, loading, handleSubmit }} />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <GdmLogo size={64} className="inline-block mb-3 drop-shadow-lg" />
          <h1 className="text-3xl font-bold text-gray-900 mb-1">GDM NEXO</h1>
          <p className="text-gray-500 text-sm">Inicia sesión para continuar</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="usuario@ejemplo.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
              required
            />
          </div>

          {/* Auto-entrada del checador en este equipo. Se muestra SÓLO si la empresa
              ya firmó (equipo habilitado) o ya es kiosco. En prueba no aparece. */}
          {mostrarChecador && (
          <div className="space-y-2">
            <label className="flex items-start justify-between gap-3 text-sm text-gray-600 select-none cursor-pointer">
              <span>
                Entrar automático al <strong>checador</strong> en este equipo
                <span className="block text-xs text-gray-400">
                  Recuerda la credencial en este dispositivo y al abrir la app cae directo en el checador.
                  Úsalo sólo en equipos del checador, con la cuenta «checador».
                </span>
              </span>
              <input type="checkbox" checked={kiosco} onChange={(e) => setKiosco(e.target.checked)} className="mt-0.5 shrink-0" />
            </label>
            {kiosco && (
              <div className="flex gap-2">
                {([['kiosco', 'Kiosco (punto fijo)'], ['campo', 'Campo (móvil)']] as const).map(([k, l]) => (
                  <button type="button" key={k} onClick={() => setModo(k)}
                    className={`flex-1 text-xs rounded-lg border px-2 py-1.5 transition-colors ${
                      modo === k ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Acceso + regreso al sitio corporativo, lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <a
              href={CORPORATE_SITE_URL}
              className="flex items-center justify-center gap-2 border-2 border-gray-300 hover:border-blue-400 text-gray-700 font-semibold py-2 rounded-lg transition-colors"
            >
              <ArrowLeft size={16} /> hcgm.com.mx
            </a>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </div>
        </form>

        {/* Prospecto nuevo: lleva al alta de prueba (Datos Fiscales). */}
        <div className="mt-4 text-center text-sm">
          <span className="text-gray-500">¿Primera vez? </span>
          <Link to="/registro" className="text-emerald-600 font-semibold hover:underline">Prueba gratis 72 h — Crear cuenta</Link>
        </div>

        {/* Footer — el aviso de copyright nombra a la RAZÓN SOCIAL dueña de los
            desarrollos, no al nombre comercial ni al del producto. Debe decir lo
            mismo que las páginas legales; dos titulares distintos en dos
            pantallas públicas se leen como dos empresas distintas. */}
        <div className="mt-6 pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
          <p>© {new Date().getFullYear()} GRUPO HCGM, S.A. DE C.V. · GDM NEXO ERP®</p>
        </div>
      </div>
    </div>
  );
}

/** Login con tema de tienda en línea (Comercio electrónico). */
function LoginComercio(p: {
  email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void;
  error: string; loading: boolean; handleSubmit: (e: React.FormEvent) => void;
}) {
  const rasgos = [
    { icon: Store, t: 'Tu tienda en línea' },
    { icon: Tag, t: 'Catálogo y cupones' },
    { icon: CreditCard, t: 'Cobro con Mercado Pago' },
    { icon: Truck, t: 'Pedidos y envíos' },
  ];
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 via-rose-500 to-fuchsia-700 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 rounded-2xl shadow-2xl overflow-hidden bg-white">
        {/* Panel de bienvenida: referencia al comercio */}
        <div className="hidden md:flex flex-col justify-between p-8 bg-gradient-to-br from-orange-400 to-fuchsia-600 text-white relative overflow-hidden">
          <ShoppingBag size={220} className="absolute -right-10 -bottom-10 opacity-10" />
          <div>
            <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-3 py-1 text-xs font-semibold tracking-wide">
              <ShoppingBag size={14} /> COMERCIO ELECTRÓNICO
            </div>
            <h2 className="mt-6 text-3xl font-extrabold leading-tight">Vende en línea,<br />factura sin esfuerzo.</h2>
            <p className="mt-3 text-white/85 text-sm">Cada pedido pagado genera su CFDI y su póliza en GDM NEXO.</p>
          </div>
          <ul className="space-y-3 relative">
            {rasgos.map(({ icon: I, t }) => (
              <li key={t} className="flex items-center gap-3 text-sm font-medium">
                <span className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center"><I size={16} /></span>{t}
              </li>
            ))}
          </ul>
        </div>

        {/* Acceso */}
        <div className="p-8">
          <div className="text-center mb-8">
            <span className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-fuchsia-600 text-white items-center justify-center shadow-lg mb-3">
              <ShoppingBag size={32} />
            </span>
            <h1 className="text-2xl font-bold text-gray-900">GDM Comercio electrónico</h1>
            <p className="text-gray-500 text-sm">Entra al panel de tu tienda</p>
          </div>
          <form onSubmit={p.handleSubmit} className="space-y-4">
            {p.error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{p.error}</div>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input type="email" value={p.email} onChange={(e) => p.setEmail(e.target.value)} required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                placeholder="usuario@ejemplo.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña</label>
              <input type="password" value={p.password} onChange={(e) => p.setPassword(e.target.value)} required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                placeholder="••••••••" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <a href={CORPORATE_SITE_URL}
                className="flex items-center justify-center gap-2 border-2 border-gray-300 hover:border-orange-400 text-gray-700 font-semibold py-2 rounded-lg transition-colors">
                <ArrowLeft size={16} /> hcgm.com.mx
              </a>
              <button type="submit" disabled={p.loading}
                className="w-full bg-gradient-to-r from-orange-500 to-fuchsia-600 hover:brightness-110 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition">
                {p.loading ? 'Ingresando...' : 'Entrar a mi tienda'}
              </button>
            </div>
          </form>
          <div className="mt-4 text-center text-sm">
            <span className="text-gray-500">¿Quieres vender en línea? </span>
            <a href="https://wa.me/4493677027" target="_blank" rel="noopener" className="text-fuchsia-600 font-semibold hover:underline">Contáctanos</a>
          </div>
          <div className="mt-6 pt-6 border-t border-gray-200 text-center text-xs text-gray-500">
            <p>© {new Date().getFullYear()} GRUPO HCGM, S.A. DE C.V. · GDM NEXO · Comercio electrónico</p>
          </div>
        </div>
      </div>
    </div>
  );
}
