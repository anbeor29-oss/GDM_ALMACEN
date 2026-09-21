/**
 * Login Page
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { GdmLogo } from '@/components/GdmLogo';
import { guardarKiosco, borrarKiosco, hayKiosco } from '@/utils/kioscoAuto';
import api from '@/services/api';

/** Sitio corporativo al que regresa el botón junto a "Ingresar". */
const CORPORATE_SITE_URL = 'https://hcgm.com.mx';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /* Auto-entrada del checador en este equipo (kiosco): guarda la credencial y al
   * reabrir la app entra solo al kiosco. Opt-in; conviene con la cuenta CHECADOR. */
  const [kiosco, setKiosco] = useState(hayKiosco());
  const { login } = useAuthStore();
  const navigate = useNavigate();

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
          guardarKiosco(email, password);
          navigate('/checador/kiosco');
        } else {
          borrarKiosco();
          navigate('/dashboard');
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <GdmLogo size={64} className="inline-block mb-3 drop-shadow-lg" />
          <h1 className="text-3xl font-bold text-gray-900 mb-1">GDM NEXO</h1>
          <p className="text-gray-500 text-sm">GDM HIGH CONSULTING MÉXICO · Inicia sesión para continuar</p>
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

          {/* Auto-entrada del checador en este equipo (kiosco/tableta). */}
          <label className="flex items-start gap-2 text-sm text-gray-600 select-none cursor-pointer">
            <input type="checkbox" checked={kiosco} onChange={(e) => setKiosco(e.target.checked)} className="mt-0.5" />
            <span>
              Entrar automático al <strong>checador</strong> en este equipo
              <span className="block text-xs text-gray-400">
                Recuerda la credencial en este dispositivo y al abrir la app cae directo en el kiosco.
                Úsalo sólo en equipos del checador, con la cuenta «checador».
              </span>
            </span>
          </label>

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

        {/* Footer — el aviso de copyright nombra a la RAZÓN SOCIAL dueña de los
            desarrollos, no al nombre comercial ni al del producto. Debe decir lo
            mismo que las páginas legales; dos titulares distintos en dos
            pantallas públicas se leen como dos empresas distintas. */}
        <div className="mt-6 pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
          <p>© {new Date().getFullYear()} GRUPO HCGM, S.A. DE C.V. · ERP CFDI 4.0</p>
        </div>
      </div>
    </div>
  );
}
