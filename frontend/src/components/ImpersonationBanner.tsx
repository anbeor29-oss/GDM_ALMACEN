/**
 * Banner sticky que aparece arriba de la app cuando el SUPER_ADMIN está
 * actuando en nombre de otro usuario (impersonación para soporte).
 *
 *  · No descartable: la única forma de salir es "Volver a mi cuenta".
 *  · Cualquier acción que el suplantador haga en este modo queda registrada
 *    en audit_log con `__impersonated_by` en el payload.
 */
import { useNavigate } from 'react-router-dom';
import { UserCog, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/auth';

export function ImpersonationBanner() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  if (!user?.impersonatedBy) return null;

  const stop = () => {
    // Salir de la suplantación = logout total. El super-admin debe re-login.
    // Es lo más seguro: invalida el JWT impersonado y obliga a re-autenticación.
    logout();
    navigate('/login');
  };

  return (
    <div className="bg-amber-50 border-b-2 border-amber-400 text-amber-900 px-4 py-2 flex items-center justify-between gap-3 sticky top-0 z-50">
      <div className="flex items-center gap-2 min-w-0">
        <UserCog size={18} className="shrink-0"/>
        <p className="text-sm truncate">
          <b>Modo soporte activo</b> · estás operando como{' '}
          <span className="font-mono">{user.email}</span>{' '}
          (suplantado por <span className="font-mono">{user.impersonatedBy.email}</span>)
        </p>
      </div>
      <button onClick={stop}
        className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1 rounded">
        <LogOut size={14}/> Volver a mi cuenta
      </button>
    </div>
  );
}
