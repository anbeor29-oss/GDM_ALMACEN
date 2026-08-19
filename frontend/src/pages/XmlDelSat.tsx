/**
 * XmlDelSat — la descarga masiva del SAT, con menú propio.
 *
 * POR QUÉ ESTÁ AFUERA DE AUDITORÍA
 * Era la segunda pestaña de Auditoría, y llegar costaba dos clics: entrar al
 * módulo y buscar la pestaña. Para una pantalla que se abre varias veces al día
 * —se pide, se espera, se vuelve a ver si ya llegó— eso es fricción diaria.
 *
 * Adentro de Auditoría sigue estando como pestaña: quien llega por ahí no
 * tiene por qué aprender una ruta nueva. Es el MISMO componente, no una copia:
 * dos copias de una pantalla que habla con el SAT terminan divergiendo justo en
 * el manejo de errores, que es lo último que alguien revisa.
 *
 * LOS DOS SUBMENÚS
 * Recibidos y emitidos son consultas distintas al SAT —el servicio las pide por
 * separado— y responden preguntas distintas: los recibidos sirven para cuadrar
 * lo que hay que pagar y deducir; los emitidos, para comprobar que lo que se
 * timbró llegó completo. Cada uno abre la pantalla en su dirección.
 */
import { useLocation } from 'react-router-dom';
import { Download } from 'lucide-react';
import { XmlRecibidos } from '@/components/XmlRecibidos';

export function XmlDelSatPage() {
  const location = useLocation();
  const direccion: 'recibidos' | 'emitidos' =
    location.pathname.endsWith('/emitidos') ? 'emitidos' : 'recibidos';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Download size={24} className="text-emerald-600" />
          XML {direccion === 'emitidos' ? 'emitidos' : 'recibidos'} del SAT
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {direccion === 'emitidos'
            ? 'Lo que timbramos, traído del propio SAT. Sirve para comprobar que ' +
              'todo lo que se emitió está allá — y que nada se timbró de más.'
            : 'Lo que nos emitieron. Es de donde salen las facturas por pagar y ' +
              'lo que se puede deducir.'}
        </p>
      </div>

      {/* El mismo componente que usa Auditoría, con la dirección puesta. */}
      <XmlRecibidos direccionInicial={direccion} />
    </div>
  );
}

export default XmlDelSatPage;
