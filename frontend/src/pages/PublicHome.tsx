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
  FileText, ScanText, FileUp, FileMinus2, Users, Boxes, BarChart3,
  ShieldCheck, LogIn, Wallet, Mail, Ban, QrCode,
  ClipboardCheck, Building2, FileSignature, Send,
  ChevronDown,
} from 'lucide-react';
import { useState } from 'react';


const MODULES = [
  { icon: <ScanText size={22}/>,     title: 'Lector CIF',       desc: 'Sube el PDF de la Constancia de Situación Fiscal SAT y el sistema autollena RFC, razón social, régimen y CP.' },
  { icon: <FileUp size={22}/>,       title: 'Importar XMLs',    desc: 'Al leer un XML recibido, detecta si el emisor es cliente o proveedor y crea el catálogo automáticamente.' },
  { icon: <FileText size={22}/>,     title: 'Facturación CFDI 4.0', desc: 'Emisión con retenciones RESICO, honorarios, arrendamiento; timbrado real ante el SAT con PAC autorizado.' },
  { icon: <FileMinus2 size={22}/>,   title: 'Notas de crédito', desc: 'Aplica descuentos o cancelaciones con prorrateo automático de IVA. CFDI tipo E vinculado a la factura origen.' },
  { icon: <Wallet size={22}/>,       title: 'Complemento de Pago', desc: 'CFDI tipo P para facturas PPD. Descuenta pagos previos y NC en el cálculo del saldo insoluto (Anexo 20).' },
  { icon: <Mail size={22}/>,         title: 'Envío por correo',  desc: 'Manda al cliente PDF + XML de la factura y de cada NC o complemento de pago vinculado. SMTP con dominio propio.' },
  { icon: <Ban size={22}/>,          title: 'Cancelación en cascada', desc: 'Cancela primero pagos y NC desde el modal Historia; después la factura padre. Envío directo al PAC + bypass local.' },
  { icon: <QrCode size={22}/>,       title: 'QR de verificación SAT', desc: 'Los PDFs incluyen QR con la URL oficial del portal SAT. El cliente escanea y valida el CFDI en el momento.' },
  { icon: <Users size={22}/>,        title: 'Clientes y Proveedores', desc: 'Catálogo con dirección fiscal, régimen, uso CFDI por defecto y saldo de cuenta.' },
  { icon: <Boxes size={22}/>,        title: 'Productos',        desc: 'Preset fiscal por producto (IVA 16, 8, 0, exento, RESICO, honorarios, IEPS). 52 mil claves SAT indexadas.' },
  { icon: <BarChart3 size={22}/>,    title: 'Reportes',         desc: 'Cobranza total, cobranza detallada por cliente con saldo > $0.20, ventas por período, fiscal y auditable.' },
  { icon: <ShieldCheck size={22}/>,  title: 'Compliance SAT',   desc: 'CSD cifrado con pgcrypto, bitácora inmutable 5 años, XML timbrado firmado por el SAT, PDF Anexo 20.' },
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
            <img src="/logo-almacen.png" alt="GDM Almacén" className="h-10 w-10 rounded-lg object-cover shadow-md shrink-0" />
            <div>
              <p className="font-bold text-slate-800 tracking-tight leading-tight">GDM Almacén</p>
              <p className="text-xs text-slate-500 leading-tight">Inventarios · HCGM Advisors</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-5 text-sm text-slate-600 font-medium">
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
          Control de <span className="bg-gradient-to-r from-indigo-600 to-blue-500 bg-clip-text text-transparent">almacén e inventarios</span><br/>
          sin complicaciones
        </h1>
        <p className="text-lg text-slate-600 mt-6 max-w-2xl mx-auto">
          Alimenta tu inventario con los XML de tus compras, controla existencias en varios
          almacenes con kardex, órdenes de compra y punto de venta, y factura con timbrado real ante el SAT.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3.5 rounded-lg shadow-lg font-semibold text-base transition-transform hover:scale-105"
          >
            <LogIn size={18} /> Entrar al sistema
          </Link>
        </div>
      </section>

      {/* Módulos */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-slate-900 text-center mb-2">Módulos incluidos</h2>
        <p className="text-slate-600 text-center mb-10">Todo lo que necesita tu empresa en un solo sistema</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {MODULES.map((m) => (
            <div key={m.title} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="w-11 h-11 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mb-3">
                {m.icon}
              </div>
              <h3 className="font-bold text-slate-900 mb-1">{m.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{m.desc}</p>
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
            Escríbenos y con gusto te ayudamos a poner tu inventario en marcha.
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
              href="#faq"
              className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow text-center"
            >
              <div className="w-11 h-11 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mx-auto mb-3">
                <ClipboardCheck size={22}/>
              </div>
              <h3 className="font-bold text-slate-900 mb-1">Preguntas frecuentes</h3>
              <p className="text-sm text-indigo-700 font-medium">Todo lo que debes saber</p>
            </a>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="bg-gradient-to-br from-indigo-600 to-blue-600">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">¿Listo para empezar?</h2>
          <p className="text-indigo-100 text-lg mb-8 max-w-xl mx-auto">
            Ingresa al sistema para controlar tu inventario y facturar. Si aún no tienes cuenta,
            contáctanos y con gusto te damos acceso.
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
          <p>© {new Date().getFullYear()} HCGM · Sistema de facturación CFDI 4.0</p>
          <p>PAC autorizado: SW Sapien · Anexo 20 SAT</p>
        </div>
      </footer>
    </div>
  );
}
