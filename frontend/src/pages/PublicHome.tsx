/**
 * Página pública de inicio — se muestra ANTES del login.
 *
 * Contiene:
 *   · Hero con nombre del sistema y CTA "Iniciar sesión"
 *   · Acordeón informativo de módulos ("Todo lo que hace NEXO")
 *   · Cómo funciona (4 pasos) y datos de contacto
 *   · CTA final para entrar al sistema
 *
 * Es 100% informativa: no vende planes de timbrado con precio (NEXO se despliega
 * completo y los módulos se controlan desde el super admin).
 *
 * Ruta: `/` (redirige a `/dashboard` o `/admin/companies` si ya hay sesión).
 */
import { Link } from 'react-router-dom';
import {
  Check,
  FileText, LogIn, Mail, Scale,
  ClipboardCheck, Building2, FileSignature, Send,
  ChevronDown, BookOpen, Truck,
  Receipt, Boxes, ShoppingBag, Banknote,
  Calculator, BadgeDollarSign, FileCheck2,
  Store, Archive, Rocket,
} from 'lucide-react';
import { useState } from 'react';
import { GdmLogo } from '@/components/GdmLogo';

/* Los módulos de NEXO, uno por acordeón.
 *
 * El `tint` NO es decorativo al azar: reproduce el color con el que ese módulo
 * aparece dentro del sistema (acento del menú lateral o color del icono en el
 * panel), para que quien entra reconozca lo que vio aquí. Las clases van
 * completas porque Tailwind no compila strings armados en tiempo de ejecución.
 *
 * Cada módulo trae un `resumen` (visible siempre) y su detalle (`items`) que se
 * despliega al abrir el acordeón: se ve todo lo que hace el ERP sin llenar la
 * pantalla, y quien evalúa abre solo lo que le interesa.
 */
const MODULOS = [
  {
    icon: <Receipt size={20}/>, tint: 'bg-indigo-50 text-indigo-600',
    title: 'Facturación CFDI 4.0',
    resumen: 'Emisión y timbrado real ante el SAT, con todo el ciclo del comprobante.',
    items: [
      'Emisión con retenciones RESICO, honorarios y arrendamiento; timbrado real con PAC autorizado (SW Sapien)',
      'Notas de crédito tipo E con prorrateo automático de IVA, ligadas a su factura origen',
      'Complemento de pago tipo P para PPD, descontando pagos previos y NC del saldo insoluto',
      'Cancelación en cascada: primero pagos y NC, después la factura padre',
      'QR de verificación SAT en el PDF y envío de PDF + XML por correo con dominio propio',
      'Autofacturación (Anexo 20) para enajenantes registrados',
    ],
  },
  {
    icon: <Boxes size={20}/>, tint: 'bg-sky-50 text-sky-600',
    title: 'Almacén e inventarios',
    resumen: 'Varios almacenes conectados con la factura y la compra.',
    items: [
      'Kardex por producto con costeo promedio, último o por capas',
      'Timbrar descuenta existencias; cancelar o hacer nota de crédito las devuelve',
      'Inventario físico con conciliación de diferencias y reportes de rotación',
    ],
  },
  {
    icon: <ShoppingBag size={20}/>, tint: 'bg-amber-50 text-amber-600',
    title: 'Compras y proveedores',
    resumen: 'El XML del proveedor da de alta al proveedor, los productos y la entrada.',
    items: [
      'El XML recibido da de alta al proveedor, los productos y la entrada al almacén',
      'Cada partida puede entrar a un almacén distinto, capturando lo recibido de verdad',
      'Órdenes de compra con punto de reorden y proyección a 15 días',
    ],
  },
  {
    icon: <Banknote size={20}/>, tint: 'bg-emerald-50 text-emerald-600',
    title: 'Tesorería y cobranza',
    resumen: 'Cuentas por pagar y por cobrar, con conciliación bancaria.',
    items: [
      'La factura de compra genera su cuenta por pagar con los días de crédito del proveedor',
      'Programación de pagos y control de línea de crédito',
      'Cobranza por cliente, ventas por período y conciliación bancaria contra el estado de cuenta',
    ],
  },
  {
    icon: <Calculator size={20}/>, tint: 'bg-rose-50 text-rose-600',
    title: 'Contabilidad electrónica',
    resumen: 'Pólizas automáticas desde el CFDI y todos los reportes del SAT.',
    items: [
      'Pólizas de ingreso, egreso y diario generadas desde los CFDI, cuadradas por diseño',
      'Catálogo con agrupador SAT, balanza, y estados financieros (Balance y Resultados)',
      'DIOT, contabilidad electrónica (Anexo 24), cédulas fiscales y cédula de IVA',
      'Activo fijo con depreciación, conciliación bancaria, cierre y traspaso de ejercicio',
    ],
  },
  {
    icon: <BadgeDollarSign size={20}/>, tint: 'bg-violet-50 text-violet-600',
    title: 'Nómina CFDI 4.0',
    resumen: 'Recibos timbrados, cálculo de ISR y control de asistencia.',
    items: [
      'Cálculo de ISR con tarifa y subsidio del año, cuotas IMSS y recibos timbrados',
      'Prenómina desde incidencias y checador biométrico facial (kiosco PWA)',
      'Finiquitos y documentos legales de baja fundados en la LFT',
    ],
  },
  {
    icon: <Truck size={20}/>, tint: 'bg-orange-50 text-orange-600',
    title: 'Carta Porte 3.1',
    resumen: 'Traslado multimodal con validación previa al timbre.',
    items: [
      'Autotransporte, marítimo, aéreo y ferroviario, incluido comercio exterior',
      'Catálogos de vehículos, remolques, operadores, aseguradoras y lugares frecuentes',
      'Validador previo al PAC: los errores se ven antes de gastar el timbre',
    ],
  },
  {
    icon: <FileCheck2 size={20}/>, tint: 'bg-slate-100 text-slate-600',
    title: 'Catálogos y cumplimiento',
    resumen: 'Lector CIF, claves SAT, CSD cifrado y opinión 32-D.',
    items: [
      'Lector de la Constancia de Situación Fiscal: autollena RFC, razón social, régimen y CP',
      'Clientes, proveedores y productos con preset fiscal y 52 mil claves SAT indexadas',
      'CSD cifrado, bitácora de 5 años, y un correo puede administrar varias empresas',
      'Opinión de cumplimiento 32-D (SAT, IMSS, INFONAVIT) y descarga masiva de XML del SAT',
    ],
  },
  {
    icon: <Store size={20}/>, tint: 'bg-teal-50 text-teal-600',
    title: 'Punto de venta (POS)',
    resumen: 'Venta de mostrador con ticket, corte de caja y factura global.',
    items: [
      'Cobro rápido con búsqueda de productos, descuentos y varias formas de pago',
      'Corte de caja por turno y arqueo, con la venta ligada al almacén',
      'Factura global del periodo timbrada ante el SAT, o factura al cliente que la pida',
    ],
  },
  {
    icon: <Archive size={20}/>, tint: 'bg-cyan-50 text-cyan-600',
    title: 'XML del SAT · Bóveda',
    resumen: 'Descarga masiva de tus CFDI directo del SAT, con bóveda de 5 años.',
    items: [
      'Descarga de emitidos y recibidos con tu e.firma, y calendario de cobertura',
      'Bóveda de todos los XML como fuente de verdad, con respaldo en ZIP',
      'Base para las pólizas, la DIOT y la contabilidad electrónica (Anexo 24)',
    ],
  },
];

const HOW_STEPS = [
  {
    n: 1,
    icon: <Building2 size={24}/>,
    title: 'Registra tu empresa',
    desc: 'Sube la Constancia de Situación Fiscal en PDF. El sistema lee RFC, razón social, régimen y CP automáticamente, y tu empresa queda lista para operar.',
  },
  {
    n: 2,
    icon: <FileSignature size={24}/>,
    title: 'Carga tu CSD',
    desc: 'Agrega el Certificado de Sello Digital (.cer + .key) y su contraseña. Se cifra con pgcrypto y solo se descifra al momento de timbrar.',
  },
  {
    n: 3,
    icon: <FileText size={24}/>,
    title: 'Emite y timbra',
    desc: 'Captura conceptos con el catálogo SAT, elige forma y método de pago. Un clic en Timbrar envía al PAC y regresas con UUID real del SAT.',
  },
  {
    n: 4,
    icon: <Send size={24}/>,
    title: 'Envía y cobra',
    desc: 'Manda PDF + XML por correo al cliente con un clic. Registra pagos y notas de crédito. Consulta saldo y estado en tiempo real.',
  },
];

/* Acordeón de un módulo: icono + título + resumen siempre visibles; el detalle
 * (lista de features) se despliega al pulsar el encabezado. */
function ModuloItem({
  icon, tint, title, resumen, items, defaultOpen,
}: {
  icon: JSX.Element; tint: string; title: string; resumen: string; items: string[]; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 text-left px-4 py-3.5 hover:bg-slate-50 transition-colors"
      >
        <div className={`w-10 h-10 ${tint} rounded-lg flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900 leading-tight">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{resumen}</p>
        </div>
        <ChevronDown
          size={18}
          className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul className="px-4 pb-4 pt-1 space-y-2 border-t border-slate-100">
          {items.map((t) => (
            <li key={t} className="flex gap-2.5 text-sm text-slate-600 leading-relaxed">
              <Check size={15} className="text-emerald-500 shrink-0 mt-0.5" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PublicHomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GdmLogo size={40} className="shadow-md rounded-full shrink-0" />
            <div>
              <p className="font-bold text-slate-800 tracking-tight leading-tight">GDM NEXO</p>
              {/* En mayúsculas ocupa más ancho que en mixto: se deja corto a
                  propósito para que no se parta en varias líneas en móvil. */}
              <p className="text-xs text-slate-500 leading-tight">ERP CFDI 4.0 · GDM HIGH CONSULTING</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-5 text-sm text-slate-600 font-medium">
              <a href="#modulos" className="hover:text-indigo-600 transition-colors">Módulos</a>
              <a href="#como" className="hover:text-indigo-600 transition-colors">Cómo funciona</a>
              <a href="#contacto" className="hover:text-indigo-600 transition-colors">Contacto</a>
            </nav>
            <Link
              to="/registro"
              className="hidden sm:flex items-center gap-2 bg-gradient-to-r from-sky-500 to-emerald-500 hover:opacity-95 text-white px-5 py-2.5 rounded-lg shadow font-medium transition-colors"
            >
              <Rocket size={16} /> Prueba gratis
            </Link>
            <Link
              to="/login"
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg shadow font-medium transition-colors"
            >
              <LogIn size={16} /> Iniciar sesión
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-12 md:py-20 text-center">
        <h1 className="text-4xl md:text-6xl font-bold text-slate-900 tracking-tight leading-tight">
          <span className="bg-gradient-to-r from-indigo-600 to-blue-500 bg-clip-text text-transparent">GDM NEXO</span><br/>
          Tu empresa en un solo sistema
        </h1>
        <p className="text-lg text-slate-600 mt-6 max-w-2xl mx-auto">
          Factura ante el SAT, controla tu inventario, recibe compras desde el XML de
          tu proveedor y programa tus pagos. Todo conectado: lo que se factura sale del
          almacén, y lo que se compra entra con su cuenta por pagar.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/registro"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-sky-500 to-emerald-500 hover:opacity-95 text-white px-8 py-3.5 rounded-lg shadow-lg font-semibold text-base transition-transform hover:scale-105"
          >
            <Rocket size={18} /> Prueba gratis 72 h
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3.5 rounded-lg shadow-lg font-semibold text-base transition-transform hover:scale-105"
          >
            <LogIn size={18} /> Entrar al sistema
          </Link>
          <a
            href="#modulos"
            className="inline-flex items-center gap-2 border-2 border-slate-300 hover:border-indigo-400 text-slate-700 px-8 py-3.5 rounded-lg font-semibold text-base transition-colors"
          >
            Ver módulos
          </a>
          <a
            href={`${import.meta.env.BASE_URL}manual-usuario.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir el manual de usuario en PDF"
            className="inline-flex items-center gap-2 border-2 border-slate-300 hover:border-indigo-400 text-slate-700 px-4 py-3.5 rounded-lg font-semibold text-sm transition-colors"
          >
            <BookOpen size={16} /> Manual
          </a>
          <LegalDropdown />
        </div>
      </section>

      {/* Módulos — un acordeón desplegable por módulo */}
      <section id="modulos" className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-slate-900 text-center mb-2">Todo lo que hace NEXO</h2>
        <p className="text-slate-600 text-center mb-10">Un ERP completo — abre cada módulo para ver el detalle</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          {MODULOS.map((m, i) => (
            <ModuloItem key={m.title} {...m} defaultOpen={i === 0} />
          ))}
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como" className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-14">
          <h2 className="text-3xl font-bold text-slate-900 text-center mb-2">Cómo funciona</h2>
          <p className="text-slate-600 text-center mb-10">De cero a factura timbrada en 4 pasos</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {HOW_STEPS.map((s) => (
              <div key={s.n} className="bg-white rounded-xl p-5 border border-slate-200 relative">
                <div className="absolute -top-3 -left-3 w-9 h-9 rounded-full bg-gradient-to-br from-indigo-600 to-blue-500 text-white font-bold flex items-center justify-center shadow-md">
                  {s.n}
                </div>
                <div className="w-11 h-11 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mb-3 ml-6">
                  {s.icon}
                </div>
                <h3 className="font-bold text-slate-900 mb-1">{s.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contacto */}
      <section id="contacto" className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-14">
          <h2 className="text-3xl font-bold text-slate-900 text-center mb-2">¿Necesitas más información?</h2>
          <p className="text-slate-600 text-center mb-8">
            Escríbenos y con gusto te mostramos el sistema y resolvemos tus dudas.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <a
              href="mailto:facturas@hcgm.com.mx"
              className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow text-center"
            >
              <div className="w-11 h-11 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mx-auto mb-3">
                <Mail size={22}/>
              </div>
              <h3 className="font-bold text-slate-900 mb-1">Correo</h3>
              <p className="text-sm text-indigo-700 font-medium">facturas@hcgm.com.mx</p>
            </a>
            <a
              href="https://hcgm.com.mx"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow text-center"
            >
              <div className="w-11 h-11 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mx-auto mb-3">
                <Building2 size={22}/>
              </div>
              <h3 className="font-bold text-slate-900 mb-1">Sitio corporativo</h3>
              <p className="text-sm text-indigo-700 font-medium">hcgm.com.mx</p>
            </a>
            <a
              href="#modulos"
              className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow text-center"
            >
              <div className="w-11 h-11 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mx-auto mb-3">
                <ClipboardCheck size={22}/>
              </div>
              <h3 className="font-bold text-slate-900 mb-1">Ver módulos</h3>
              <p className="text-sm text-indigo-700 font-medium">Todo lo que hace NEXO</p>
            </a>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="bg-gradient-to-br from-indigo-600 to-blue-600">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">¿Listo para empezar?</h2>
          <p className="text-indigo-100 text-lg mb-8 max-w-xl mx-auto">
            Ingresa al sistema para comenzar a operar. Si aún no tienes cuenta,
            contáctanos y te damos acceso.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-white text-indigo-700 hover:bg-slate-50 px-10 py-4 rounded-lg shadow-lg font-bold text-lg transition-transform hover:scale-105"
          >
            <LogIn size={20} /> Entrar al sistema
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-sm">
          <p>© {new Date().getFullYear()} GRUPO HCGM, S.A. DE C.V. · ERP CFDI 4.0</p>
          <p>PAC autorizado: SW Sapien · Anexo 20 SAT</p>
        </div>
      </footer>
    </div>
  );
}


function LegalDropdown() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title="Documentos legales"
        className="inline-flex items-center gap-2 border-2 border-slate-300 hover:border-indigo-400 text-slate-700 px-4 py-3.5 rounded-lg font-semibold text-sm transition-colors"
      >
        <Scale size={16} /> Legal <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden z-20">
          <Link
            to="/terminos"
            className="block px-4 py-3 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 border-b border-slate-100"
          >
            <div className="font-semibold">Términos y Condiciones</div>
            <div className="text-xs text-slate-500 mt-0.5">Contrato de prestación de servicios</div>
          </Link>
          <Link
            to="/privacidad"
            className="block px-4 py-3 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
          >
            <div className="font-semibold">Aviso de Privacidad</div>
            <div className="text-xs text-slate-500 mt-0.5">Tratamiento de datos (LFPDPPP)</div>
          </Link>
        </div>
      )}
    </div>
  );
}
