# Documentación legal — GDM Facturación / GDM Almacén

Borradores versionables de los documentos legales que rigen la relación con
los clientes del Servicio.

## Estado

🟡 **BORRADOR** — requiere revisión de abogado especialista en:
- Contratos SaaS mexicanos
- Materia fiscal (CFF, Anexo 20 SAT, LFDPPPP)

## Documentos

| Archivo | Alcance | Publicación |
|---|---|---|
| [`TERMINOS_Y_CONDICIONES.md`](TERMINOS_Y_CONDICIONES.md) | Contrato de uso del Servicio (obligaciones, precios, responsabilidad, propiedad intelectual, terminación) | Página `/terminos` + PDF descargable versionado |
| [`AVISO_DE_PRIVACIDAD.md`](AVISO_DE_PRIVACIDAD.md) | Cumplimiento LFPDPPP (datos que se recaban, finalidades, transferencias, ARCO) | Página `/privacidad` + PDF descargable versionado |

## Placeholders pendientes de llenar

Buscar `[[…]]` en cada documento. Los principales:

- `[[RFC HCGM]]` — RFC de GRUPO HCGM, S.A. DE C.V.
- `[[DOMICILIO FISCAL, Aguascalientes, Ags.]]` — dirección completa
- `[[correo@gdmhcgm.mx]]` — correo de contacto general
- `[[privacidad@gdmhcgm.mx]]` — correo de derechos ARCO
- `[[DÍA]] de [[MES]] de 2026` — fecha de vigencia inicial
- `[[N]] días` — plazos de mora, RTO/RPO, indisponibilidad, etc. (5 lugares en Términos)

## Decisiones de negocio que impactan al contrato

Registradas al 2026-07-19:

- **Modelo**: solo software; timbres se cobran por plan o por consumo.
  Timbrado real vía PAC (SW Sapien).
- **Jurisdicción**: tribunales de Aguascalientes, Ags.
- **Ley aplicable**: leyes federales mexicanas.
- **Retención post-terminación**: 90 días para descarga; 5 años para CFDI
  (obligación fiscal del cliente, no de HCGM).
- **Tope de responsabilidad**: importe pagado en los 12 meses anteriores.

## Flujo de publicación propuesto

1. Abogado revisa y ajusta.
2. Se genera PDF de la versión final (con encabezado, pie, número de versión).
3. Se sube el PDF a `frontend/public/legal/terminos-vX.pdf` y `frontend/public/legal/privacidad-vX.pdf`.
4. Se crean páginas React `/terminos` y `/privacidad` que renderizan el contenido y ofrecen descarga del PDF.
5. En el flujo de registro se agrega checkbox **obligatorio**: "He leído y acepto los [Términos] y el [Aviso de Privacidad]" con enlaces a las páginas.
6. Se registra la aceptación (fecha, hora, IP, versión aceptada) en tabla `user_consents` para efectos probatorios (art. 89 Código de Comercio).

## Cambios de versión

Cada modificación con impacto material:
- Incrementa la versión (v1.0 → v1.1 minor, v2.0 major).
- Publica aviso destacado en la plataforma 15 días antes de vigencia.
- Se guarda el PDF anterior en `frontend/public/legal/archivo/` para consulta histórica.
- Notificar por correo a los usuarios activos.
