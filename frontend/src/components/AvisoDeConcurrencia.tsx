/**
 * AvisoDeConcurrencia — "Antonio también tiene esto abierto".
 *
 * POR QUÉ UN AVISO Y NO UN CANDADO
 * Los dos tienen que poder trabajar: un candado congelaría el documento de quien
 * se fue a comer con la pantalla abierta. Lo que faltaba no era impedir la
 * concurrencia sino verla, porque el daño real es guardar encima del trabajo de
 * alguien sin enterarse.
 *
 * DICE QUIÉN LLEGÓ PRIMERO
 * No como jerarquía —nadie manda sobre nadie— sino porque es el dato que
 * resuelve la conversación: el que llegó después sabe que hay algo previo que
 * puede pisar, y con nombre y hora sabe a quién preguntarle.
 */
import { Users } from 'lucide-react';
import type { Presente } from '@/hooks/usePresencia';

export function AvisoDeConcurrencia({ otros, soyElPrimero }: {
  otros: Presente[];
  soyElPrimero: boolean;
}) {
  if (otros.length === 0) return null;

  const nombres = otros.map((o) => o.nombre || o.email).join(', ');
  const tiempo = otros[0]?.minutos ?? 0;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
      soyElPrimero
        ? 'bg-sky-50 border-sky-200 text-sky-900'
        : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
      <Users size={18} className="shrink-0 mt-0.5" />
      <div>
        {soyElPrimero ? (
          <p>
            <strong>{nombres}</strong> {otros.length === 1 ? 'acaba de abrir' : 'abrieron'} esta
            misma pantalla. Tú llegaste primero; los dos pueden capturar, pero el
            último en guardar deja su versión.
          </p>
        ) : (
          <p>
            <strong>{nombres}</strong> está aquí desde hace{' '}
            {tiempo < 1 ? 'menos de un minuto' : `${tiempo} minuto(s)`} y llegó antes que tú.
            Puedes trabajar igual, pero si guardas encima se pierde lo que lleve capturado
            — vale la pena preguntarle.
          </p>
        )}
      </div>
    </div>
  );
}
