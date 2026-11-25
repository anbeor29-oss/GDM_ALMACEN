/**
 * Comercio Electrónico → Clientes.
 *
 * Es el MISMO catálogo de clientes de NEXO (receptores del CFDI conforme al CFF
 * Art. 29-A), no una copia: se reusa `CustomersPage`, con lectura de CIF en PDF,
 * lectura de un XML de factura y captura a mano en una ventana.
 *
 * Existe esta ruta porque el inquilino de sólo-ecommerce **factura igual que
 * cualquiera** —cada pedido web genera su CFDI— pero su sidebar es únicamente
 * la tienda: nunca pudo llegar a /customers para dar de alta a quien le compra
 * con RFC.
 *
 * Va en modo `contable={false}`: la cuenta contable y los botones que la
 * generan pertenecen a Contabilidad, un módulo que este inquilino no tiene
 * contratado —esas llamadas le contestarían 403— y que además no significa nada
 * para quien sólo vende en línea.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomersPage } from '@/pages/Customers';

export function ClientesEcPage() {
  return (
    <div className="p-6 max-w-6xl space-y-4">
      <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft size={15} /> Comercio Electrónico
      </Link>
      <CustomersPage contable={false} />
    </div>
  );
}

export default ClientesEcPage;
