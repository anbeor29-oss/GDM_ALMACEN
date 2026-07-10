/**
 * Modal NO descartable que aparece sobre toda la app cuando el usuario tiene
 * password_change_required=true (cuenta recién creada o reset reciente).
 *
 *  · No se puede cerrar con Esc ni clic afuera.
 *  · La única forma de salir es cambiar la contraseña o hacer logout.
 */
import { useState } from 'react';
import { KeyRound, LogOut, Eye, EyeOff } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const MIN_LEN = 8;

export function ForcePasswordChange() {
  const { user, logout, markPasswordChanged } = useAuthStore();
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const validate = (): string | null => {
    if (newPass.length < MIN_LEN)               return `La contraseña debe tener al menos ${MIN_LEN} caracteres`;
    if (!/[A-Z]/.test(newPass))                 return 'Debe incluir al menos una mayúscula';
    if (!/[a-z]/.test(newPass))                 return 'Debe incluir al menos una minúscula';
    if (!/\d/.test(newPass))                    return 'Debe incluir al menos un dígito';
    if (newPass === oldPass)                    return 'La nueva contraseña no puede ser igual a la anterior';
    if (newPass !== confirm)                    return 'La nueva contraseña y la confirmación no coinciden';
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const err = validate();
    if (err) { setError(err); return; }
    setBusy(true);
    try {
      await api.changePassword(oldPass, newPass);
      markPasswordChanged();
      // No alert: el modal desaparece y deja al usuario en la app.
    } catch (e: any) {
      setError(e.response?.data?.message || e.message || 'No se pudo cambiar la contraseña');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center gap-3 p-5 border-b">
          <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
            <KeyRound className="text-amber-700" size={20} />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">Cambio de contraseña requerido</h2>
            <p className="text-xs text-gray-500">{user?.email}</p>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-600 leading-relaxed">
            Tu cuenta usa una contraseña temporal. Por seguridad, debes cambiarla
            antes de continuar.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          <PasswordField label="Contraseña actual (temporal)" value={oldPass} onChange={setOldPass} show={show} setShow={setShow} />
          <PasswordField label="Nueva contraseña"             value={newPass} onChange={setNewPass} show={show} setShow={setShow} />
          <PasswordField label="Confirmar nueva contraseña"   value={confirm} onChange={setConfirm} show={show} setShow={setShow} />

          <ul className="text-xs text-gray-500 list-disc pl-5 space-y-0.5">
            <li>Mínimo {MIN_LEN} caracteres</li>
            <li>Al menos una mayúscula, una minúscula y un dígito</li>
            <li>Distinta de la temporal</li>
          </ul>
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button type="button" onClick={logout}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <LogOut size={16} /> Salir
          </button>
          <button type="submit" disabled={busy}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg">
            {busy ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordField({
  label, value, onChange, show, setShow,
}: { label: string; value: string; onChange: (v: string) => void; show: boolean; setShow: (b: boolean) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700 block mb-1">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input w-full pr-9"
        />
        <button type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-800"
          title={show ? 'Ocultar' : 'Mostrar'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}
