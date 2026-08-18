/**
 * FotoDelTrabajador — la foto del expediente.
 *
 * POR QUÉ SE GUARDA DENTRO DEL EXPEDIENTE Y NO EN UN ALMACÉN DE ARCHIVOS
 * Son unas decenas de KB por persona. Un almacén externo mete una dependencia
 * más —y un servidor efímero como el de Render pierde lo que se escriba en su
 * disco al reiniciar—. Como data URI viaja con el expediente y no se puede
 * perder por separado.
 *
 * SE REDUCE ANTES DE SUBIRLA
 * Una foto de celular pesa 4 MB y aquí se ve a 128 px. Subirla entera haría que
 * cada consulta del expediente arrastrara ese peso, y el listado de cincuenta
 * trabajadores serían 200 MB. Se recorta a un cuadrado y se baja a 320 px en el
 * navegador, antes de mandarla: llega pesando unos 30 KB.
 */
import { useRef, useState } from 'react';
import { Camera, Trash2, User } from 'lucide-react';

/** Lado del cuadrado que se guarda. 320 px alcanza para cualquier uso en pantalla. */
const LADO = 320;
const CALIDAD = 0.82;

interface Props {
  valor?: string | null;
  onChange: (dataUri: string | null) => void;
  disabled?: boolean;
}

export function FotoDelTrabajador({ valor, onChange, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [procesando, setProcesando] = useState(false);

  const elegir = async (f: File) => {
    setError(''); setProcesando(true);
    try {
      if (!/^image\//.test(f.type)) {
        setError('Tiene que ser una imagen');
        return;
      }
      const dataUri = await reducir(f);
      onChange(dataUri);
    } catch (e: any) {
      setError('No se pudo leer la imagen');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative w-32 h-32 rounded-lg overflow-hidden border-2 border-dashed
          ${valor ? 'border-transparent' : 'border-gray-300'}
          bg-slate-50 flex items-center justify-center
          ${disabled ? '' : 'cursor-pointer hover:border-primary'}`}
        onClick={() => !disabled && input.current?.click()}
        title={disabled ? '' : 'Clic para elegir una foto'}
      >
        {valor ? (
          <img src={valor} alt="Foto del trabajador" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center text-gray-400 px-2">
            <User size={32} className="mx-auto" />
            <p className="text-[11px] mt-1">{procesando ? 'Procesando…' : 'Sin foto'}</p>
          </div>
        )}
      </div>

      {!disabled && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Camera size={13} /> {valor ? 'Cambiar' : 'Agregar foto'}
          </button>
          {valor && (
            <button
              type="button"
              onClick={() => { onChange(null); setError(''); }}
              className="text-xs text-rose-600 hover:underline flex items-center gap-1"
            >
              <Trash2 size={13} /> Quitar
            </button>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-rose-600 mt-1 text-center">{error}</p>}

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) elegir(f); e.target.value = ''; }}
      />
    </div>
  );
}

/**
 * Recorta al cuadrado central y reduce a 320 px.
 *
 * El recorte va al centro y no al borde: una foto de credencial suele traer la
 * cara al medio, y recortar desde arriba a la izquierda deja media frente.
 */
function reducir(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('lectura'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('imagen'));
      img.onload = () => {
        const lienzo = document.createElement('canvas');
        lienzo.width = LADO;
        lienzo.height = LADO;
        const ctx = lienzo.getContext('2d');
        if (!ctx) return reject(new Error('canvas'));

        const lado = Math.min(img.width, img.height);
        const x = (img.width - lado) / 2;
        const y = (img.height - lado) / 2;
        ctx.drawImage(img, x, y, lado, lado, 0, 0, LADO, LADO);

        /* JPEG y no PNG: una foto en PNG pesa cuatro veces más sin verse mejor.
         * El expediente valida que sea PNG, JPG o WEBP. */
        resolve(lienzo.toDataURL('image/jpeg', CALIDAD));
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(f);
  });
}

export default FotoDelTrabajador;
