/**
 * Login Page
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { GdmLogo } from '@/components/GdmLogo';
import api from '@/services/api';

/** Sitio corporativo al que regresa el botón junto a "Ingresar". */
const CORPORATE_SITE_URL = 'https://hcgm.com.mx';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
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
        navigate('/dashboard');
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
          <h1 className="text-3xl font-bold text-gray-900 mb-1">GDM ALMACÉN</h1>
          <p className="text-gray-500 text-sm">Inventarios y Facturación · GDM High Consulting México</p>
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

        {/* Footer */}
        <div className="mt-6 pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
          <p>© {new Date().getFullYear()} GDM High Consulting México · GDM ALMACÉN — Inventarios y Facturación CFDI 4.0</p>
        </div>
      </div>
    </div>
  );
}
