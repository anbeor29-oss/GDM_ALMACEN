/**
 * Aviso de Privacidad Integral — texto oficial servido por la plataforma para
 * cumplimiento de la LFPDPPP.
 *
 * VERSIÓN 1.0 aprobada por Antonio Bernal el 2026-07-20 con base en la
 * consulta legal registrada en `docs/legal/AVISO_DE_PRIVACIDAD.md`.
 *
 * Reglas al editar:
 *   1. SUBE LA VERSIÓN (`PRIVACY_VERSION`) en cualquier cambio de texto.
 *   2. NO metas fechas dinámicas ni datos variables — el texto es determinista
 *      para que se pueda hashear y auditar la versión que un cliente aceptó.
 */

export const PRIVACY_VERSION = '2026-07-20.1';

export function buildPrivacyNoticeText(): string {
  return `AVISO DE PRIVACIDAD INTEGRAL
GDM FACTURACIÓN — GRUPO HCGM, S.A. DE C.V.
Versión: ${PRIVACY_VERSION}

────────────────────────────────────────────────────────────────────────

RESPONSABLE

GRUPO HCGM, S.A. DE C.V. ("HCGM"), RFC GHC1707275Y0, con domicilio en
Adoratrices número 116, Fraccionamiento Villa Teresa, Código Postal 20126,
Aguascalientes, Aguascalientes, es el responsable del tratamiento de sus
datos personales en términos de la Ley Federal de Protección de Datos
Personales en Posesión de los Particulares (LFPDPPP), su Reglamento y los
Lineamientos aplicables.

Contacto ARCO: info@hcgm.com.mx

────────────────────────────────────────────────────────────────────────

DATOS PERSONALES QUE SE RECABAN

A. Identificación y contacto: nombre completo o razón social, RFC, correo
   electrónico, teléfono, domicilio fiscal, régimen fiscal.

B. Fiscales y comerciales: Certificado de Sello Digital (.cer), llave privada
   (.key) y su contraseña — almacenados cifrados; datos de facturación de los
   clientes de EL CLIENTE (nombre, RFC, dirección); conceptos, importes y
   complementos de los CFDI emitidos.

C. Autenticación y trazabilidad: usuario y contraseña (esta última con hash
   bcrypt; HCGM no puede leerla en claro), dirección IP, fecha, hora y
   navegador de acceso.

D. Pago: datos bancarios o de tarjeta que EL CLIENTE proporcione para pagar
   los servicios de HCGM, referencia y comprobantes de pago.

HCGM NO recaba datos personales sensibles en términos del artículo 3,
fracción VI de la LFPDPPP.

────────────────────────────────────────────────────────────────────────

FINALIDADES

Primarias (necesarias para prestar el Servicio):

  1. Crear, mantener y administrar la cuenta de EL CLIENTE.
  2. Autenticar a EL CLIENTE y a sus usuarios operativos.
  3. Emitir CFDI 4.0 y sus complementos por cuenta y a nombre de EL CLIENTE,
     mediante comunicación con un PAC autorizado.
  4. Almacenar, consultar, descargar y auditar los CFDI emitidos.
  5. Emitir facturas a EL CLIENTE por los servicios de HCGM y llevar el
     registro contable correspondiente.
  6. Cumplir con obligaciones fiscales, legales o regulatorias.
  7. Atender consultas, quejas y soporte técnico.
  8. Realizar respaldos operativos y garantizar la seguridad de los datos.

Secundarias (opcionales; puede oponerse sin afectación al Servicio):

  9. Enviar novedades del producto o comunicaciones comerciales de HCGM.
 10. Encuestas de satisfacción y estudios estadísticos internos.

Para oponerse a las finalidades secundarias: correo a info@hcgm.com.mx con
el asunto "Oposición a finalidades secundarias".

────────────────────────────────────────────────────────────────────────

TRANSFERENCIAS

HCGM transfiere datos personales exclusivamente a los siguientes terceros:

  · PAC autorizado por el SAT (actualmente SW Sapien Nube, S.A.P.I. de C.V.)
    — para timbrado fiscal de los CFDI. Necesario para el Servicio.
  · Servicio de Administración Tributaria (SAT) — obligación legal.
  · Proveedor de hosting en la nube (Render.com, Oregon, EE.UU.) —
    alojamiento del Servicio. Necesario para el Servicio.
  · Proveedor de correo transaccional — envío de correos operativos.
    Necesario para el Servicio.
  · Autoridades competentes cuando lo requieran por ley o resolución fundada
    — obligación legal.

Cualquier transferencia distinta requerirá consentimiento expreso de EL
CLIENTE.

────────────────────────────────────────────────────────────────────────

DERECHOS ARCO

EL CLIENTE tiene derecho de Acceso, Rectificación, Cancelación y Oposición
(ARCO), así como de revocar el consentimiento, mediante solicitud a
info@hcgm.com.mx con:

  · Nombre y correo del titular.
  · Identificación (o representación acreditada).
  · Descripción clara del derecho ejercido y los datos personales sobre los
    que recae.
  · Cualquier documento que facilite la localización.

HCGM responderá en 20 días hábiles y ejecutará la resolución procedente en
15 días hábiles adicionales.

Limitaciones: la cancelación o revocación no procede cuando los datos deban
conservarse por obligación legal. Los CFDI y sus complementos deben
conservarse cinco (5) años conforme al artículo 30 del Código Fiscal de la
Federación.

────────────────────────────────────────────────────────────────────────

MEDIDAS DE SEGURIDAD

  · Cifrado en tránsito (TLS 1.2+).
  · Cifrado en reposo de credenciales sensibles (CSD, llave privada,
    contraseñas).
  · Hash bcrypt para contraseñas de usuario.
  · Control de acceso por rol y grupo de trabajo.
  · Registro de auditoría de accesos y operaciones críticas.
  · Respaldos periódicos.
  · Actualizaciones de seguridad de la infraestructura.

Ninguna medida técnica es infalible; HCGM se compromete a atender y notificar
cualquier incidente conforme a la ley aplicable.

────────────────────────────────────────────────────────────────────────

COOKIES

La plataforma utiliza cookies estrictamente necesarias para mantener la
sesión del usuario autenticado. No se utilizan cookies de rastreo publicitario
ni de terceros con fines de perfilamiento.

────────────────────────────────────────────────────────────────────────

CAMBIOS

Este Aviso puede modificarse. Los cambios serán notificados en la plataforma
con quince (15) días naturales de anticipación mediante aviso destacado y
actualización de la versión. La versión más reciente está siempre disponible
en el sitio del Servicio.

────────────────────────────────────────────────────────────────────────

CONSENTIMIENTO

Al aceptar los Términos y Condiciones y utilizar el Servicio, EL CLIENTE
manifiesta haber leído, comprendido y aceptado el presente Aviso de Privacidad.

────────────────────────────────────────────────────────────────────────

GRUPO HCGM, S.A. DE C.V.
Departamento de Privacidad: info@hcgm.com.mx
Versión ${PRIVACY_VERSION}
`;
}
