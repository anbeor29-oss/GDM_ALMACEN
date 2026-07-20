/**
 * Texto del contrato de prestación de servicios y Términos y Condiciones.
 *
 * VERSIÓN 1.0 aprobada por Antonio Bernal el 2026-07-20 con base en la
 * consulta legal registrada en `docs/legal/TERMINOS_Y_CONDICIONES.md`.
 *
 * Reglas al editar:
 *   1. SUBE LA VERSIÓN (`CONTRACT_VERSION`) en cualquier cambio de texto, por
 *      mínimo que parezca. Las firmas ya emitidas quedan atadas al texto que se
 *      firmó (se guarda íntegro), pero los clientes deben firmar la versión
 *      nueva para que el consentimiento corresponda a lo vigente.
 *   2. No metas datos variables fuera de los que inyecta `buildContractText`:
 *      el texto firmado debe ser reproducible byte a byte para verificar la
 *      firma después.
 */

/** Súbela SIEMPRE que cambie el texto. Formato: AAAA-MM-DD.N */
export const CONTRACT_VERSION = '2026-07-20.1';

export interface ContractParty {
  rfc: string;
  businessName: string;
}

/**
 * Arma el texto íntegro que se firmará. Determinista: mismos datos → mismo
 * texto → misma firma verificable. La fecha se pasa explícita (no `new Date()`
 * dentro) para poder reconstruir el documento tal cual se firmó.
 */
export function buildContractText(opts: {
  client: ContractParty;
  signedAt: Date;
}): string {
  const { client, signedAt } = opts;
  // Fecha en hora de México: el contrato es un acto jurídico local y el
  // servidor corre en UTC.
  const fecha = signedAt.toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return `CONTRATO DE PRESTACIÓN DE SERVICIOS
GDM FACTURACIÓN — FACTURACIÓN ELECTRÓNICA CFDI 4.0
Versión de los Términos y Condiciones: ${CONTRACT_VERSION}

PARTES

EL PRESTADOR: GRUPO HCGM, S.A. DE C.V.
  RFC: ${PROVIDER.rfc}
  Domicilio: Adoratrices número 116, Fraccionamiento Villa Teresa,
  Código Postal 20126, Aguascalientes, Aguascalientes.
  Correo de contacto: info@hcgm.com.mx
  En lo sucesivo, "HCGM".

EL CLIENTE: ${client.businessName.toUpperCase()}
  RFC: ${client.rfc.toUpperCase()}
  En lo sucesivo, "EL CLIENTE".

Fecha de aceptación: ${fecha}

Ambas partes reconocen mutuamente capacidad legal para obligarse.

────────────────────────────────────────────────────────────────────────

PRIMERA — OBJETO

HCGM otorga a EL CLIENTE el uso, en modalidad de Software como Servicio (SaaS),
de la plataforma web denominada GDM Facturación para:

  a) Emitir Comprobantes Fiscales Digitales por Internet CFDI 4.0 conforme al
     Anexo 20 del SAT.
  b) Emitir los complementos soportados por la plataforma, incluyendo
     Complemento para Recepción de Pagos 2.0, Complemento Carta Porte 3.1 y
     Notas de Crédito.
  c) Gestionar clientes, productos, catálogos y consultas de comprobantes.
  d) Consultar, descargar y auditar los CFDI emitidos.

HCGM comercializa exclusivamente el uso del software. Los timbres fiscales se
contratan por plan o por consumo, conforme a la cláusula SEGUNDA.

HCGM NO es Proveedor Autorizado de Certificación (PAC) ante el SAT. HCGM actúa
como intermediario técnico entre EL CLIENTE y un PAC autorizado — actualmente
SW Sapien Nube, S.A.P.I. de C.V., o el PAC que HCGM designe. El acto de
timbrado fiscal es ejecutado por el PAC bajo su propia autorización SAT.

SEGUNDA — CONTRAPRESTACIÓN Y PLAN FISCAL

2.1. El catálogo de planes vigentes, sus precios y timbres incluidos están
publicados en la plataforma y forman parte integrante de este contrato.

2.2. La vigencia comercial inicia en la fecha de aceptación indicada arriba.

2.3. Primer periodo — proporcional. Cuando el alta ocurra a mitad de mes
calendario: el primer mes se cobra proporcional por los días naturales que
resten desde la fecha de alta hasta el último día del mes en curso. El corte se
emite el último día natural del mes y se factura a EL CLIENTE. El mismo
esquema aplica a los timbres: durante el primer mes EL CLIENTE puede consumir
timbres libremente; el corte al final del mes factura los timbres efectivamente
consumidos.

2.4. Periodos subsecuentes — cobro por adelantado. A partir del segundo mes,
tanto la renta mensual del plan como los timbres incluidos en el plan se cobran
por adelantado al inicio de cada mes calendario. El consumo de timbres por
encima del plan se factura al corte del mes en curso.

2.5. HCGM emitirá el CFDI correspondiente a EL CLIENTE por los servicios
prestados en los plazos que el SAT establezca.

2.6. Los precios publicados no incluyen IVA salvo indicación expresa. Todos los
impuestos aplicables corren por cuenta de EL CLIENTE.

2.7. Mora. El impago mayor a quince (15) días naturales posteriores a la fecha
de emisión de la factura de HCGM faculta a este último a suspender el Servicio
de inmediato, sin necesidad de declaración judicial y previa notificación por
correo electrónico. La reactivación queda sujeta al pago de lo adeudado.

2.8. Modificación de precios. HCGM podrá modificar precios notificando a EL
CLIENTE por correo electrónico con treinta (30) días naturales de anticipación.
Los cambios no aplican a periodos ya pagados por adelantado.

TERCERA — VIGENCIA Y TERMINACIÓN

3.1. El contrato entra en vigor al momento de la aceptación electrónica y
permanece vigente mientras EL CLIENTE conserve cuenta activa.

3.2. Terminación por EL CLIENTE:

  a) EL CLIENTE puede cancelar en cualquier momento notificando por escrito a
     HCGM o desde la plataforma, con al menos quince (15) días naturales de
     anticipación al final del mes de facturación en curso.
  b) Alternativamente, EL CLIENTE puede optar por no renovar y agotar los
     timbres pendientes: mantendrá acceso hasta que consuma los timbres del
     plan o hasta el término del mes ya pagado, lo que ocurra primero.

3.3. Los timbres NO son reembolsables, en ningún caso, ni siquiera por
terminación anticipada. Los pagos mensuales anticipados tampoco se reembolsan
por terminación voluntaria de EL CLIENTE.

3.4. Terminación por HCGM. Previo aviso con treinta (30) días naturales, salvo
casos de incumplimiento grave de EL CLIENTE (fraude fiscal, impago mayor a
15 días, actividad ilícita), donde la terminación es inmediata.

3.5. Portabilidad de datos. Al terminar, EL CLIENTE conserva el derecho de
descargar sus datos (CFDI, XMLs, PDFs, catálogos) por noventa (90) días
naturales posteriores a la terminación. Pasado ese plazo, HCGM podrá eliminarlos
definitivamente.

3.6. Obligación fiscal post-terminación. La obligación de conservar los CFDI
por cinco (5) años ante el SAT (artículo 30 del Código Fiscal de la Federación)
permanece con EL CLIENTE.

CUARTA — OBLIGACIONES DE EL CLIENTE

4.1. Custodia y confidencialidad de sus credenciales de acceso.

4.2. Actos realizados desde su cuenta, aun por terceros con acceso autorizado
por él.

4.3. Veracidad y actualización de los datos capturados.

4.4. Cargar y mantener actualizado su Certificado de Sello Digital (CSD), su
llave privada y su contraseña. El CSD es propiedad exclusiva de EL CLIENTE.
HCGM almacena estos elementos cifrados exclusivamente para sellar los CFDI de
EL CLIENTE, sin facultades para emitir CFDI fuera de sus instrucciones ni
para transferir el CSD a terceros.

4.5. Responsabilidad fiscal única ante el SAT por:
  a) Veracidad e integridad de los datos del CFDI (importes, conceptos,
     receptor, régimen, uso, complementos).
  b) Correcta aplicación de tasas, retenciones, forma y método de pago.
  c) Cancelación oportuna, sustitución y corrección de CFDI mal emitidos.
  d) Cumplimiento de obligaciones fiscales derivadas (declaraciones, pagos,
     contabilidad).
  e) Datos del Complemento Carta Porte 3.1 (ubicaciones, mercancías,
     autotransporte, figuras, distancias, permisos SCT).

4.6. HCGM no tiene facultades ni obligación de revisar, validar o corregir el
contenido fiscal de los CFDI de EL CLIENTE más allá de las validaciones
técnicas automatizadas (formato RFC, cruces contra catálogos SAT, XSD del
complemento).

4.7. Uso permitido. EL CLIENTE se obliga a usar el Servicio conforme a la
legislación mexicana aplicable, en particular la fiscal (CFF, LISR, LIVA y
Anexo 20 del SAT). Queda prohibido:

  a) Emitir comprobantes falsos, apócrifos o que amparen operaciones
     inexistentes o simuladas.
  b) Reproducir, revender, sublicenciar, redistribuir u ofrecer el Servicio
     a terceros sin autorización escrita de HCGM.
  c) Realizar ingeniería inversa, decompilación o intento de acceso no
     autorizado.
  d) Usar bots, crawlers u otras técnicas automatizadas que degraden el
     Servicio.
  e) Emplear el Servicio para almacenar o transmitir contenido ilícito.

QUINTA — TRATAMIENTO DE DATOS Y CONFIDENCIALIDAD

5.1. El tratamiento de datos personales se rige por el Aviso de Privacidad
Integral publicado por separado en la plataforma, elaborado conforme a la Ley
Federal de Protección de Datos Personales en Posesión de los Particulares
(LFPDPPP), su Reglamento y los Lineamientos aplicables. La aceptación del
presente contrato implica el conocimiento y consentimiento de dicho Aviso.

5.2. Confidencialidad mutua. Las partes se obligan a mantener bajo estricta
confidencialidad la información no pública a la que tengan acceso con motivo
de este contrato, salvo información de dominio público, requerimiento legal de
autoridad competente o consentimiento expreso de la contraparte. La obligación
subsiste por cinco (5) años después de la terminación.

SEXTA — AUDITORÍA Y BITÁCORA DE USO

EL CLIENTE reconoce y acepta que el sistema registra la actividad realizada por
cada uno de los usuarios que EL CLIENTE dé de alta, incluyendo la emisión,
timbrado, cancelación y consulta de comprobantes, con fecha, hora y usuario que
la ejecutó. Dicha bitácora tiene fines de auditoría, seguridad y cumplimiento
fiscal, y su resguardo es obligación de HCGM conforme a la cláusula QUINTA.

EL CLIENTE, en su carácter de responsable de sus propios usuarios, podrá activar
el envío de reportes periódicos de dicha bitácora al correo que designe. EL
CLIENTE se obliga a informar a sus usuarios de esta circunstancia y a que dicho
tratamiento cumpla la normatividad laboral y de datos personales que le resulte
aplicable, liberando a HCGM de cualquier responsabilidad al respecto.

SÉPTIMA — DISPONIBILIDAD Y LIMITACIÓN DE RESPONSABILIDAD

7.1. HCGM proporciona el Servicio "tal cual" y "según disponibilidad", sin
garantías implícitas de comerciabilidad o idoneidad para un propósito
particular más allá de las que la ley imponga imperativamente.

7.2. HCGM realiza esfuerzos razonables para mantener el Servicio disponible
7 × 24, sin garantizar disponibilidad ininterrumpida. El Servicio puede sufrir
interrupciones por mantenimiento programado, actualizaciones, causa fortuita o
fuerza mayor, indisponibilidad de servicios de terceros (SAT, PAC, proveedor
de hosting) o incidentes de seguridad.

7.3. El timbrado depende de un Proveedor Autorizado de Certificación (PAC) y
de la disponibilidad de los servicios del SAT, ajenos al control de HCGM. Éste
último no asume responsabilidad por indisponibilidad de dichos terceros;
reintentará conforme sus rutinas técnicas y notificará a EL CLIENTE cuando
corresponda.

7.4. En ningún caso HCGM será responsable por:

  a) Multas, recargos o sanciones fiscales impuestas a EL CLIENTE por el SAT
     o cualquier autoridad, derivadas de la operación de EL CLIENTE o de la
     información que este capture.
  b) Daños indirectos, incidentales, consecuenciales, lucro cesante o pérdida
     de oportunidad.
  c) Interrupciones causadas por el SAT, el PAC, el proveedor de hosting,
     servicios de red, actos de gobierno o cualquier tercero.
  d) Uso indebido del Servicio por EL CLIENTE o sus usuarios.
  e) Pérdida de datos por eliminación intencional de EL CLIENTE o por
     vulneración de sus credenciales.

7.5. Tope de responsabilidad. En cualquier caso en que HCGM resultare
responsable, el monto máximo de indemnización se limita al importe efectivamente
pagado por EL CLIENTE a HCGM durante los doce (12) meses inmediatos anteriores
al hecho generador.

7.6. Las limitaciones anteriores no aplican en caso de dolo o culpa grave de
HCGM debidamente acreditados en sentencia firme.

7.7. Fuerza mayor. Ninguna parte será responsable por incumplimiento derivado
de caso fortuito o fuerza mayor: fallas de infraestructura pública,
indisponibilidad del SAT o del PAC, catástrofes naturales, guerra, actos de
gobierno, pandemias o cualquier evento fuera de su control razonable.

OCTAVA — PROPIEDAD INTELECTUAL

8.1. El software, diseño, código, marcas, logotipos y documentación del
Servicio son propiedad exclusiva de HCGM o de sus licenciantes.

8.2. HCGM otorga a EL CLIENTE una licencia no exclusiva, no transferible y
revocable de uso del Servicio, limitada a la vigencia del contrato y a los
usuarios y volúmenes contratados.

8.3. Los datos fiscales y operativos de EL CLIENTE son propiedad de EL
CLIENTE. HCGM los custodia como encargado y EL CLIENTE podrá exportarlos en
cualquier momento desde la plataforma o solicitarlos por escrito a HCGM.

NOVENA — MODIFICACIONES

HCGM podrá modificar estos Términos notificando a EL CLIENTE por correo
electrónico y mediante aviso destacado en la plataforma, con al menos quince
(15) días naturales de anticipación. El uso continuado del Servicio después
de la fecha de vigencia constituye aceptación. Si EL CLIENTE no está de
acuerdo, podrá terminar conforme a la cláusula TERCERA. Cada versión queda
archivada por HCGM con su número y fecha.

DÉCIMA — LEY APLICABLE Y JURISDICCIÓN

Este contrato se rige por las leyes federales de los Estados Unidos Mexicanos.

Para toda interpretación, cumplimiento y ejecución, las partes se someten
expresamente a la jurisdicción de los tribunales competentes en el Estado de
Aguascalientes, Aguascalientes, México, renunciando a cualquier otro fuero
que por razón de su domicilio presente o futuro pudiera corresponderles.

────────────────────────────────────────────────────────────────────────

ACEPTACIÓN

EL CLIENTE manifiesta que leyó y acepta el presente contrato y los Términos y
Condiciones en su versión ${CONTRACT_VERSION}, y lo firma con la Firma
Electrónica Avanzada (e.firma) del contribuyente ${client.rfc.toUpperCase()},
con los efectos jurídicos que le reconocen el Código de Comercio y el Código
Fiscal de la Federación.

La firma se realiza sobre el texto íntegro de este documento. Cualquier
alteración posterior invalida la firma.
`;
}

/** Datos de HCGM como prestador. RFC confirmado por área legal el 2026-07-20. */
export const PROVIDER: ContractParty = {
  rfc: 'GHC1707275Y0',
  businessName: 'GRUPO HCGM, S.A. DE C.V.',
};
