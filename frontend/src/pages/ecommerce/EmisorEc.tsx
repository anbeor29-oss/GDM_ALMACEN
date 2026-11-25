/**
 * Comercio Electrónico → Datos del emisor.
 *
 * Son los datos fiscales con los que se EXPIDE la factura de cada pedido web:
 * identificación fiscal, domicilio (lugar de expedición), contacto, logo,
 * formato del PDF, **CSD**, manifiesto del PAC y correo. Es la misma pantalla
 * «Datos de mi empresa» del resto de NEXO —se reusa `IssuerModal`, no se
 * duplica— y lee el CIF en PDF para autollenar.
 *
 * Por qué hay una ruta propia: el sidebar ofrecía ese bloque a todos MENOS al
 * inquilino de sólo-ecommerce, con esta razón escrita en el código:
 *
 *     «El inquilino de sólo-ecommerce no factura con CSD: no se le ofrece.»
 *
 * La premisa es falsa. `facturarPedido` crea el CFDI del pedido y lo manda
 * timbrar con el CSD de la empresa; cuando no hay sello, la factura se queda en
 * BORRADOR —que es exactamente lo que pasó en la primera prueba completa— y el
 * merchant no tenía ninguna pantalla donde cargarlo.
 */
import { useNavigate } from 'react-router-dom';
import { IssuerModal } from '@/components/IssuerModal';
import { useAuthStore } from '@/store/auth';

export function EmisorEcPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  if (!user?.companyId) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Tu usuario no tiene empresa asignada: no hay datos de emisor que mostrar.
      </div>
    );
  }

  return <IssuerModal companyId={user.companyId} onClose={() => navigate('/ecommerce')} />;
}

export default EmisorEcPage;
