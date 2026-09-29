/**
 * Consentimiento informado para datos biométricos — reloj checador NEXO.
 *
 * ÚNICA fuente del texto: se usa en pantalla (al enrolar el rostro, el trabajador
 * lo lee y lo acepta) y en la VERSIÓN IMPRESA (para firma autógrafa por duplicado).
 *
 * Alcance acotado a propósito: los datos biométricos se tratan **única y
 * exclusivamente** para el control de asistencia del reloj checador NEXO.
 *
 * RESPONSABILIDAD: el **Responsable** del tratamiento es **la Empresa** (el patrón
 * que da de alta y administra a su personal). **GDM NEXO / GDM High Consulting /
 * GRUPO HCGM es sólo el PROVEEDOR de la tecnología (encargado):** opera el software,
 * NO decide sobre los datos ni es responsable de los rostros que el usuario final
 * (la Empresa) administra en el sistema.
 */

/** Una cláusula: título + párrafos. */
type Clausula = { titulo: string; parrafos: string[] };

export function clausulasConsentimiento(empresa?: string): Clausula[] {
  const laEmpresa = empresa && empresa.trim() ? empresa.trim() : 'la Empresa (mi patrón)';
  return [
    {
      titulo: '1. Responsable del tratamiento y proveedor de la tecnología',
      parrafos: [
        `El Responsable del tratamiento de mis datos personales biométricos es ${laEmpresa} (en adelante, «la Empresa»), quien decide sobre su uso y es la única responsable de ellos.`,
        'GDM NEXO —desarrollado por GDM High Consulting / GRUPO HCGM, S.A. de C.V.— actúa únicamente como PROVEEDOR de la tecnología (encargado): opera el software por cuenta de la Empresa, NO decide sobre los datos ni es responsable de los rostros que la Empresa administra en el sistema.',
      ],
    },
    {
      titulo: '2. Datos que se recaban (dato personal sensible)',
      parrafos: [
        'Reconozco que los datos biométricos son datos personales SENSIBLES (art. 3, fr. VI de la LFPDPPP) y que su tratamiento requiere mi consentimiento expreso.',
        'Se recaba la imagen de mi rostro y su representación matemática (plantilla o embedding facial). La fotografía original NO se conserva una vez generada la plantilla; la plantilla se almacena cifrada.',
      ],
    },
    {
      titulo: '3. Finalidad ÚNICA Y EXCLUSIVA',
      parrafos: [
        'Mis datos biométricos se tratan única y exclusivamente para el CONTROL DE ASISTENCIA del reloj checador NEXO: registrar mis entradas y salidas y determinar retardos, faltas y horas trabajadas para el cálculo de mi nómina.',
        'La Empresa no usará estos datos para ninguna finalidad distinta a la aquí descrita, ni elaborará perfiles ajenos al control de asistencia.',
      ],
    },
    {
      titulo: '4. Carácter voluntario y método alterno',
      parrafos: [
        'El registro por reconocimiento facial es VOLUNTARIO. Si no otorgo mi consentimiento, la Empresa pondrá a mi disposición un método alterno de registro de asistencia (tarjeta, NIP o firma en lista), sin que ello implique represalia alguna.',
      ],
    },
    {
      titulo: '5. Conservación y seguridad',
      parrafos: [
        'La plantilla se conserva mientras dure mi relación laboral y se aplican medidas de seguridad para protegerla. Al causar baja, se elimina, salvo obligación legal de conservación.',
        'Mis datos biométricos no se transfieren a terceros ajenos a esta finalidad.',
      ],
    },
    {
      titulo: '6. Derechos ARCO y revocación',
      parrafos: [
        'Puedo ejercer mis derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO) y revocar este consentimiento en cualquier momento, mediante solicitud dirigida a la Empresa. La revocación no tiene efectos retroactivos sobre los tratamientos ya realizados.',
      ],
    },
  ];
}

/** Texto en pantalla (al enrolar). El trabajador lo lee antes de aceptar. */
export function ConsentimientoTexto({ empresa }: { empresa?: string }) {
  return (
    <div className="space-y-3">
      {clausulasConsentimiento(empresa).map((c) => (
        <div key={c.titulo}>
          <p className="text-sm font-semibold text-gray-800">{c.titulo}</p>
          {c.parrafos.map((p, i) => (
            <p key={i} className="text-xs text-gray-600 leading-relaxed mt-0.5">{p}</p>
          ))}
        </div>
      ))}
      <p className="text-xs text-gray-700 bg-gray-50 border rounded px-3 py-2 leading-relaxed">
        <b>Manifestación:</b> He leído y comprendo este documento y otorgo mi consentimiento
        expreso para que la Empresa trate mis datos personales biométricos únicamente para el
        control de asistencia del reloj checador NEXO.
      </p>
    </div>
  );
}

/** HTML autocontenido para la VERSIÓN IMPRESA (se abre en ventana y se imprime).
 *  Incluye los campos para firma autógrafa (por duplicado). */
export function htmlConsentimientoImprimir(opts: { empresa?: string; empleado?: string; rfc?: string; puesto?: string }): string {
  const esc = (s?: string) => String(s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
  const hoy = new Date();
  const clausulas = clausulasConsentimiento(opts.empresa)
    .map((c) => `<h3>${esc(c.titulo)}</h3>${c.parrafos.map((p) => `<p>${esc(p)}</p>`).join('')}`)
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Consentimiento biométrico — Checador NEXO</title>
<style>
  @page { margin: 22mm 18mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; font-size: 11px; line-height: 1.5; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  h2 { font-size: 12px; color: #4b5563; font-weight: 600; margin: 0 0 14px; }
  h3 { font-size: 11.5px; margin: 12px 0 2px; }
  p { margin: 2px 0; text-align: justify; }
  .manif { border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 12px; background: #f9fafb; margin-top: 14px; }
  table.firma { width: 100%; border-collapse: collapse; margin-top: 22px; }
  table.firma td { padding: 10px 6px; vertical-align: bottom; }
  .linea { border-bottom: 1px solid #111827; height: 26px; }
  .lbl { font-size: 9.5px; color: #6b7280; }
  .pie { margin-top: 10px; font-size: 9px; color: #6b7280; }
  .dup { margin-top: 6px; font-size: 9px; color: #6b7280; font-style: italic; }
</style></head><body onload="window.print()">
  <h1>Consentimiento informado para el tratamiento de datos biométricos</h1>
  <h2>Control de asistencia — Reloj checador GDM NEXO</h2>
  ${clausulas}
  <div class="manif">
    <b>Manifestación de consentimiento.</b> He leído y comprendo el presente documento y otorgo mi
    <b>consentimiento expreso y por escrito</b> para que la Empresa trate mis datos personales
    biométricos, única y exclusivamente para el control de asistencia del reloj checador NEXO.
  </div>
  <table class="firma">
    <tr>
      <td style="width:60%"><div class="linea">${esc(opts.empleado)}</div><div class="lbl">Nombre y firma del trabajador</div></td>
      <td style="width:40%"><div class="linea"></div><div class="lbl">Fecha</div></td>
    </tr>
    <tr>
      <td><div class="linea">${esc(opts.rfc)}</div><div class="lbl">RFC / CURP</div></td>
      <td><div class="linea">${esc(opts.puesto)}</div><div class="lbl">Puesto / Centro de trabajo</div></td>
    </tr>
  </table>
  <p class="dup">Se firma por duplicado: un ejemplar para el trabajador y otro para la Empresa.</p>
  <p class="pie">Responsable: ${esc(opts.empresa) || 'la Empresa (patrón)'} · GDM NEXO es el proveedor de la tecnología (encargado), no el responsable de los datos ·
  Impreso el ${hoy.toLocaleDateString('es-MX')}.</p>
</body></html>`;
}
