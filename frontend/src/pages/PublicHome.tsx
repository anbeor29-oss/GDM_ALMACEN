/**
 * Página pública de inicio — se muestra ANTES del login.
 *
 * Contiene:
 *   · Hero con nombre del sistema y CTA "Iniciar sesión"
 *   · Los 4 planes de timbrado (misma info que /admin/packages)
 *   · Sección de módulos y features (CIF, XML, PDF, timbrado real)
 *   · CTA final para entrar al sistema
 *
 * Ruta: `/` (redirige a `/dashboard` o `/admin/companies` si ya hay sesión).
 */
import { Link } from 'react-router-dom';
import {
  Zap, Star, Rocket, Coins, Check,
  FileText, ShieldCheck, LogIn, Mail, Scale,
  ClipboardCheck, Building2, FileSignature, Send,
  ChevronDown, BookOpen, Stamp,
  Warehouse, ShoppingCart, Landmark, Truck,
} from 'lucide-react';
import { useState } from 'react';
import { GdmLogo } from '@/components/GdmLogo';

const PLANS = [
  {
    code: 'PKG_100', name: 'Esencial',
    price: '$399', stamps: 100, extra: '$2.50',
    color: 'emerald', highlight: false,
    icon: <Zap size={28} className="text-emerald-600" />,
    bullets: [
      '100 timbres CFDI 4.0 al mes',
      'Reportes de cobranza, ventas y fiscal',
      'Notas de crédito y complementos de pago',
      'Multi-usuario (Admin + operativos)',
    ],
  },
  {
    code: 'PKG_200', name: 'Pyme',
    price: '$699', stamps: 200, extra: '$2.25',
    color: 'indigo', highlight: true,
    icon: <Star size={28} className="text-indigo-600" />,
    bullets: [
      '200 timbres CFDI 4.0 al mes',
      'Todo lo del plan Esencial',
      'Importación de XMLs recibidos',
      'Gestión de proveedores',
      'Reporte de cobranza detallado',
    ],
  },
  {
    code: 'PKG_500', name: 'Empresarial',
    price: '$1,399', stamps: 500, extra: '$2.00',
    color: 'violet', highlight: false,
    icon: <Rocket size={28} className="text-violet-600" />,
    bullets: [
      '500 timbres CFDI 4.0 al mes',
      'Todo lo del plan Pyme',
      'Prioridad en soporte',
      'Backup mensual SAT en ZIP',
      'Multi-empresa (multi-tenant)',
    ],
  },
  {
    code: 'PKG_FLEX', name: 'Uso libre',
    price: 'Sin renta', stamps: null, extra: '$4.99',
    color: 'slate', highlight: false,
    icon: <Coins size={28} className="text-slate-600" />,
    bullets: [
      'Sin renta mensual',
      'Timbre a $4.99 MXN + IVA',
      'Ideal para bajo volumen (< 30/mes)',
      'Sin compromiso de permanencia',
    ],
  },
];

/**
 * Módulos de la landing. El `tint` NO es decorativo al azar: reproduce el color
 * con el que ese módulo aparece dentro del sistema (acento del menú lateral o
 * color del icono en el panel de facturas), para que quien entra reconozca lo
 * que vio aquí. Las clases van completas porque Tailwind no compila strings
 * construidos en tiempo de ejecución.
 */
/* Los módulos, agrupados por área.
 *
 * Antes eran doce tarjetas sueltas, cada una con su icono y su color: para
 * saber si el sistema hace lo que uno busca había que leerlas de una en una, y
 * la pantalla parecía un tablero de estampas. Agrupados en seis áreas, el
 * icono señala el área y las líneas se leen de corrido.
 *
 * Y caben los módulos que ya existían sin anunciarse — almacén, compras,
 * tesorería, Carta Porte—: quien evaluaba el sistema no se enteraba de ellos.
 */
const AREAS = [
  {
    icon: <Stamp size={20}/>, tint: 'bg-indigo-50 text-indigo-600',
    title: 'Facturación CFDI 4.0',
    items: [
      'Emisión con retenciones RESICO, honorarios y arrendamiento; timbrado real ante el SAT con PAC autorizado',
      'Notas de crédito tipo E con prorrateo automático de IVA, vinculadas a su factura origen',
      'Complemento de pago tipo P para facturas PPD, descontando pagos previos y NC del saldo insoluto',
      'Cancelación en cascada: primero pagos y NC, después la factura padre',
    ],
  },
  {
    icon: <Warehouse size={20}/>, tint: 'bg-sky-50 text-sky-600',
    title: 'Almacén e inventarios',
    items: [
      'Varios almacenes con kardex por producto y costeo promedio, último o por capas',
      'Timbrar descuenta existencias; cancelar o hacer nota de crédito las devuelve',
      'Inventario físico con conciliación de diferencias y reportes de rotación',
    ],
  },
  {
    icon: <ShoppingCart size={20}/>, tint: 'bg-amber-50 text-amber-600',
    title: 'Compras y proveedores',
    items: [
      'El XML del proveedor da de alta al proveedor, los productos y la entrada al almacén',
      'Cada partida puede entrar a un almacén distinto, y se captura lo recibido de verdad',
      'Órdenes de compra con punto de reorden y proyección a 15 días',
    ],
  },
  {
    icon: <Landmark size={20}/>, tint: 'bg-emerald-50 text-emerald-600',
    title: 'Tesorería y cobranza',
    items: [
      'La factura de compra genera su cuenta por pagar con los días de crédito del proveedor',
      'Programación de pagos y control de línea de crédito',
      'Cobranza por cliente, ventas por período y reportes fiscales auditables',
    ],
  },
  {
    icon: <Truck size={20}/>, tint: 'bg-orange-50 text-orange-600',
    title: 'Carta Porte 3.1',
    items: [
      'Autotransporte, marítimo, aéreo y ferroviario, incluido comercio exterior',
      'Catálogos de vehículos, remolques, operadores, aseguradoras y lugares frecuentes',
      'Validador previo al PAC: los errores se ven antes de gastar el timbre',
    ],
  },
  {
    icon: <ShieldCheck size={20}/>, tint: 'bg-slate-100 text-slate-600',
    title: 'Catálogos y control',
    items: [
      'Lector de la Constancia de Situación Fiscal: autollena RFC, razón social, régimen y CP',
      'Clientes, proveedores y productos con preset fiscal y 52 mil claves SAT indexadas',
      'CSD cifrado, bitácora de 5 años, y un correo puede administrar varias empresas',
    ],
  },
];

const HOW_STEPS = [
  {
    n: 1,
    icon: <Building2 size={24}/>,
    title: 'Registra tu empresa',
    desc: 'Sube la Constancia de Situación Fiscal en PDF. El sistema lee RFC, razón social, régimen y CP automáticamente. Elige tu plan de timbrado.',
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

const FAQ_ITEMS = [
  {
    q: '¿El sistema timbra realmente ante el SAT?',
    a: 'Sí. Estamos integrados con SW Sapien, PAC autorizado por el SAT. Cada factura recibe un UUID (Folio Fiscal) oficial, sellos SAT y CFD, y un QR de verificación que el receptor puede validar en verificacfdi.facturaelectronica.sat.gob.mx.',
  },
  {
    q: '¿Qué pasa con mi CSD (certificado)?',
    a: 'Tu .cer y .key se guardan cifrados en la base de datos con pgcrypto usando una master key rotable. Solo se descifran en memoria al momento de sellar, nunca se envían en texto plano ni se muestran por API.',
  },
  {
    q: '¿Puedo cancelar facturas?',
    a: 'Sí, con los 4 motivos SAT (01–04). Si la factura tiene notas de crédito o complementos de pago vigentes, el sistema pide cancelarlos primero desde el modal Historia. Todo se propaga al PAC y al SAT automáticamente.',
  },
  {
    q: '¿El plan incluye los timbres reales del SAT?',
    a: 'Sí. La renta mensual cubre el volumen indicado. Si superas el cupo, cada timbre extra se cobra al precio adicional del plan. El plan Uso libre no tiene renta — pagas solo por lo que timbras.',
  },
  {
    q: '¿Puedo administrar más de una empresa?',
    a: 'Sí. El sistema es multi-tenant. Como SUPER_ADMIN puedes agregar varias empresas con RFCs distintos, cada una con su plan, sus usuarios operativos y sus CSDs. Los datos están aislados por empresa.',
  },
  {
    q: '¿Cómo respaldo mis XMLs mensualmente?',
    a: 'Desde SUPER_ADMIN → Paquetes fiscales puedes descargar un ZIP con todos los XMLs timbrados del mes por empresa. Ideal para envío a contabilidad o auditorías SAT.',
  },
  {
    q: '¿Qué pasa si el correo no llega al cliente?',
    a: 'El sistema devuelve un reporte de adjuntos enviados y omitidos. Si algún XML no está listo o falla, el correo se manda con los que sí — nunca se cancela todo el envío por un solo problema.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <span className="font-semibold text-slate-900">{q}</span>
        <ChevronDown
          size={18}
          className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-3">
          {a}
        </div>
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
              <a href="#planes" className="hover:text-indigo-600 transition-colors">Planes</a>
              <a href="#faq" className="hover:text-indigo-600 transition-colors">FAQ</a>
              <a href="#contacto" className="hover:text-indigo-600 transition-colors">Contacto</a>
            </nav>
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
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3.5 rounded-lg shadow-lg font-semibold text-base transition-transform hover:scale-105"
          >
            <LogIn size={18} /> Entrar al sistema
          </Link>
          <a
            href="#planes"
            className="inline-flex items-center gap-2 border-2 border-slate-300 hover:border-indigo-400 text-slate-700 px-8 py-3.5 rounded-lg font-semibold text-base transition-colors"
          >
            Ver planes
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

      {/* Módulos */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-slate-900 text-center mb-2">Módulos incluidos</h2>
        <p className="text-slate-600 text-center mb-10">Facturación, almacén, compras y tesorería, conectados entre sí</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8 max-w-5xl mx-auto">
          {AREAS.map((a) => (
            <div key={a.title}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-9 h-9 ${a.tint} rounded-lg flex items-center justify-center shrink-0`}>
                  {a.icon}
                </div>
                <h3 className="font-bold text-slate-900">{a.title}</h3>
              </div>
              <ul className="space-y-2 pl-1">
                {a.items.map((t) => (
                  <li key={t} className="flex gap-2.5 text-sm text-slate-600 leading-relaxed">
                    <Check size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="bg-slate-50 border-y border-slate-200">
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

      {/* Planes */}
      <section id="planes" className="max-w-6xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-slate-900 text-center mb-2">Planes de timbrado</h2>
        <p className="text-slate-600 text-center mb-10">Elige el plan que se adapta al volumen de tu operación</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((p) => (
            <div
              key={p.code}
              className={`bg-white rounded-xl border-2 p-5 flex flex-col relative overflow-hidden ${
                p.highlight
                  ? 'border-indigo-400 shadow-xl'
                  : 'border-slate-200 shadow-sm hover:shadow-md transition-shadow'
              }`}
            >
              {p.highlight && (
                <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-lg">
                  Recomendado
                </div>
              )}
              <div className={`w-14 h-14 bg-${p.color}-50 rounded-xl flex items-center justify-center mb-3`}>
                {p.icon}
              </div>
              <h3 className={`text-xl font-bold text-${p.color}-700`}>{p.name}</h3>
              <p className="text-xs text-slate-500 font-mono mb-3">{p.code}</p>
              <div className="mb-1">
                <span className="text-3xl font-bold text-slate-900">{p.price}</span>
                {' '}
                <span className="text-sm text-slate-500">
                  {/* En Uso libre el precio grande dice "Sin renta", así que
                      pegarle "MXN pay-per-stamp" salía como "Sin renta MXN
                      pay-per-stamp" y el renglón se partía a media palabra. */}
                  {p.stamps !== null ? 'MXN / mes' : 'pagas solo lo que timbras'}
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-4">Precios más IVA</p>

              {p.stamps !== null && (
                <div className={`bg-${p.color}-50 rounded-lg px-3 py-2 mb-4 flex items-center justify-between`}>
                  <span className="text-xs text-slate-600">Timbres/mes</span>
                  <span className={`font-bold text-${p.color}-700`}>{p.stamps}</span>
                </div>
              )}

              <ul className="space-y-1.5 flex-1 text-sm text-slate-700">
                {p.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <Check size={16} className={`text-${p.color}-600 shrink-0 mt-0.5`} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 pt-4 border-t border-slate-100 text-[11px] text-slate-500">
                Timbre extra: <b>{p.extra} MXN</b> <span className="text-slate-400">(+ IVA)</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-4xl mx-auto px-6 py-14">
        <h2 className="text-3xl font-bold text-slate-900 text-center mb-2">Preguntas frecuentes</h2>
        <p className="text-slate-600 text-center mb-8">Lo que suelen preguntarnos antes de empezar</p>
        <div className="space-y-3">
          {FAQ_ITEMS.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </section>

      {/* Contacto */}
      <section id="contacto" className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-14">
          <h2 className="text-3xl font-bold text-slate-900 text-center mb-2">¿Necesitas más información?</h2>
          <p className="text-slate-600 text-center mb-8">
            Escríbenos y te ayudamos a elegir el plan ideal para tu operación.
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
              href="#planes"
              className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow text-center"
            >
              <div className="w-11 h-11 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mx-auto mb-3">
                <ClipboardCheck size={22}/>
              </div>
              <h3 className="font-bold text-slate-900 mb-1">Ver planes</h3>
              <p className="text-sm text-indigo-700 font-medium">Comparativa completa</p>
            </a>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="bg-gradient-to-br from-indigo-600 to-blue-600">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">¿Listo para empezar?</h2>
          <p className="text-indigo-100 text-lg mb-8 max-w-xl mx-auto">
            Ingresa al sistema para comenzar a emitir tus facturas. Si aún no tienes cuenta,
            contáctanos para elegir el plan que mejor te acomode.
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
