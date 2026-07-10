# Análisis técnico — Endpoints de timbrado SW Sapien

**Fecha**: 2026-07-04
**Autor**: análisis para GDM_FAC v1
**Decisión**: usar **Endpoint 2 (`/v3/cfdi33/issue/json/v4`)** — Emisión + Timbrado por JSON.

---

## 1. Endpoints evaluados

| # | Nombre | URL sandbox | Formato entrada |
|---|--------|-------------|-----------------|
| 1 | Servicio de timbrado (clásico) | `POST /cfdi33/stamp/v4/` | XML CFDI 4.0 **ya sellado** por el emisor (multipart o JSON con XML embebido) |
| 2 | Emisión + Timbrado JSON | `POST /v3/cfdi33/issue/json/v4` | JSON con los datos del CFDI (SW arma el XML, lo firma y lo timbra) |

Ambos devuelven **la misma respuesta** con `uuid`, `cadenaOriginalSAT`, `selloSAT`, `selloCFDI`, `fechaTimbrado`, `qrCode` y el XML timbrado.

---

## 2. Comparación funcional

| Aspecto | Endpoint 1 (XML pre-sellado) | Endpoint 2 (JSON → SW arma + sella) ✅ |
|---------|------------------------------|-----------------------------------------|
| Yo tengo que armar el XML CFDI 4.0 | ✅ Sí | ❌ No, mando JSON |
| Yo tengo que **calcular la cadena original** con XSLT SAT | ✅ Sí (`cadenaoriginal_4_0.xslt`) | ❌ No, SW lo hace |
| Yo tengo que **firmar el XML** con la .key privada del emisor (RSA-SHA256 + Base64) | ✅ Sí | ❌ No, SW lo hace |
| Yo tengo que **manejar la .key del emisor** en mi backend | ✅ Sí (cifrada en BD, descifrar por request) | ❌ No, la .key vive **cifrada en swpanel.mx** |
| Yo tengo que **incluir el .cer en base64** en el XML | ✅ Sí (atributo `Certificado`) | ❌ No, SW lo inyecta al vuelo |
| Complejidad de implementación | 🔴 Alta (2-3 semanas) | 🟢 Baja (2-3 días) |
| Superficie de riesgo criptográfico | 🔴 Manejo de claves privadas SAT | 🟢 Ninguno propio |
| Compliance SAT | Igual | Igual (SW es PAC autorizado) |
| Costo por timbre | Igual | Igual |

---

## 3. ¿Por qué el Endpoint 2 es la mejor decisión?

### Ahorro de implementación

El endpoint 1 requiere **implementar el sellado XML CFDI 4.0 completo**, que involucra:

1. **Cadena original**: aplicar la transformación XSLT oficial `cadenaoriginal_4_0.xslt` que el SAT publica.
   Ejemplo del resultado esperado:
   ```
   ||4.0|A|000123|2026-07-04T10:00:00|03|PUE|64000|20000|EKU9003173C9|Escuela Kemper Urgate|601|XAXX010101000|...
   ```
2. **Firma digital**: aplicar `RSA-SHA256` sobre esa cadena original usando la `.key` privada del emisor (descifrada de BD).
3. **Base64**: codificar la firma resultante y ponerla como atributo `Sello` del XML.
4. **Cargar `.cer`**: leerlo en DER, convertir a base64 sin cabeceras y ponerlo como atributo `Certificado`.
5. **Cargar `NoCertificado`**: extraerlo del `.cer`.

Esto implica dependencias criptográficas nativas (`node-forge` o `crypto` de Node con OpenSSL), riesgo de bugs de firma que rechaza el SAT, y **manejar en runtime la clave privada del emisor** — un riesgo de seguridad significativo.

### Ventajas del endpoint 2

1. **Yo mando JSON con los datos ya calculados** (que ya sé armar bien en `invoices.service.ts`).
2. **SW arma el XML, lo firma con la .key del emisor** (que subimos una vez a swpanel.mx), y lo timbra.
3. **Recibo el XML timbrado completo** con UUID SAT + sellos, listo para guardar y generar PDF.
4. **La .key nunca vive en mi backend Render** — solo en el vault cifrado de SW Sapien. Menor superficie de compromiso.

### Contrato de respuesta (idéntico en ambos endpoints)

```json
{
  "data": {
    "cadenaOriginalSAT": "||1.1|<uuid>|<fechaTimbrado>|<rfcPAC>|...",
    "noCertificadoSAT": "30001000000400002495",
    "noCertificadoCFDI": "30001000000400002434",
    "uuid": "283278da-b743-48bc-8001-62ce33471607",
    "selloSAT": "Bki4iHQhSKHi...",
    "selloCFDI": "jJhgoSOG0p09...",
    "fechaTimbrado": "2026-07-04T10:00:00",
    "qrCode": "iVBORw0KGgoAAAANSUhE... (PNG base64)",
    "cfdi": "<?xml version=\"1.0\"?><cfdi:Comprobante ...>"
  },
  "status": "success"
}
```

Con este payload podemos:
- **Guardar el XML validado** (`cfdi` completo) en `invoices.xml_content`
- **Guardar el UUID** en `invoices.cfdi_uuid`
- **Guardar los sellos y fecha** en `pac_stamps` para trazabilidad
- **Generar el PDF** con los datos ya en BD + el QR code que devuelve SW
- **Anexo 20 §17.1** cumple: representación impresa con UUID, sellos, cadena original y QR

---

## 4. Contrato de request del endpoint 2

`POST https://services.test.sw.com.mx/v3/cfdi33/issue/json/v4`

Headers:
```
Authorization: bearer <SW_SAPIEN_TOKEN>
Content-Type: application/jsontoxml
```

Body (ejemplo simplificado del CFDI 4.0 que YA armamos hoy):

```json
{
  "Version": "4.0",
  "Serie": "A",
  "Folio": "42",
  "Fecha": "2026-07-04T10:00:00",
  "FormaPago": "99",
  "MetodoPago": "PPD",
  "SubTotal": "1000.00",
  "Total": "1160.00",
  "Moneda": "MXN",
  "TipoDeComprobante": "I",
  "Exportacion": "01",
  "LugarExpedicion": "64000",
  "Emisor": {
    "Rfc": "EKU9003173C9",
    "Nombre": "ESCUELA KEMPER URGATE",
    "RegimenFiscal": "601"
  },
  "Receptor": {
    "Rfc": "XAXX010101000",
    "Nombre": "PUBLICO EN GENERAL",
    "DomicilioFiscalReceptor": "20000",
    "RegimenFiscalReceptor": "616",
    "UsoCFDI": "S01"
  },
  "Conceptos": [
    {
      "ClaveProdServ": "01010101",
      "Cantidad": "1",
      "ClaveUnidad": "ACT",
      "Descripcion": "Servicio de prueba",
      "ValorUnitario": "1000.00",
      "Importe": "1000.00",
      "ObjetoImp": "02",
      "Impuestos": {
        "Traslados": [
          {
            "Base": "1000.00",
            "Impuesto": "002",
            "TipoFactor": "Tasa",
            "TasaOCuota": "0.160000",
            "Importe": "160.00"
          }
        ]
      }
    }
  ],
  "Impuestos": {
    "TotalImpuestosTrasladados": "160.00",
    "Traslados": [
      {
        "Base": "1000.00",
        "Impuesto": "002",
        "TipoFactor": "Tasa",
        "TasaOCuota": "0.160000",
        "Importe": "160.00"
      }
    ]
  }
}
```

Los campos `Sello`, `NoCertificado` y `Certificado` **NO se envían** — los inyecta SW con el CSD que tenemos cargado.

---

## 5. Cambios necesarios en el código

### Ya existe

- `backend/src/modules/pac/providers/sw-sapien.provider.ts` con método `stamp(xml, ...)` (para endpoint 1)
- `backend/src/modules/invoices/invoices.service.ts` arma el modelo del CFDI completo con Emisor, Receptor, Conceptos, Impuestos, retenciones
- `backend/src/modules/cfdi/pdf.service.ts` genera el PDF completo con los datos + UUID + sellos

### Pendientes de implementar

1. **Nuevo método** `stampFromJSON(payload, credentials)` en el provider SW que:
   - POST al endpoint `/v3/cfdi33/issue/json/v4`
   - Content-Type: `application/jsontoxml`
   - Recibe la respuesta con XML timbrado + UUID + sellos
2. **Serializer** en `cfdi.service.ts` que convierte el modelo interno del CFDI al JSON shape que espera SW (equivalencia 1:1 con Anexo 20).
3. **Cambio en el flujo de timbrado** (`pac.service.ts → stampInvoice`):
   - Antes: `generateCFDIXML()` → `provider.stamp(xml)`
   - Después: `buildCFDIJson()` → `provider.stampFromJSON(json)`
4. **Guardado en BD** del XML timbrado devuelto (columna `xml_content` ya existe).
5. **QR code** — SW devuelve el QR como PNG base64. Guardar en `pac_stamps.qr_code` (columna ya existe) y usarlo en el PDF.

### Estimación

- **Provider `stampFromJSON`**: ~50 líneas (extensión del provider actual)
- **Serializer JSON CFDI 4.0**: ~200 líneas (mapea `invoice + items + taxes` al JSON de SW)
- **Ajustes en pac.service + tests**: ~50 líneas
- **Total**: 1-2 días de desarrollo + 1 día de pruebas contra sandbox

---

## 6. Pre-requisitos antes de las pruebas

### 6.1 Cuenta SW Sapien
- ✅ Ya tenemos cuenta en `swpanel.mx` con `facturas@hcgm.com.mx`
- ✅ Token de sandbox configurado en `SW_SAPIEN_TOKEN`
- ✅ 501 timbres disponibles en sandbox

### 6.2 CSD del emisor cargado en SW
Este es el paso NUEVO que aún no hicimos:

1. Descargar el **CSD de pruebas de SW Sapien** desde https://developers.sw.com.mx/ → sección "CSD de Pruebas"
   - RFC: `EKU9003173C9` (Escuela Kemper Urgate) — el que ya tenemos cargado en nuestra BD
   - Archivos: `.cer`, `.key`, contraseña (SW la publica)
2. Entrar al panel: https://portal.test.sw.com.mx → sección **Emisores** o **CSDs**
3. Subir los 3 archivos y guardar
4. SW guarda la `.key` cifrada; a partir de ese momento cualquier request al endpoint 2 con `Emisor.Rfc = EKU9003173C9` se firmará automáticamente

### 6.3 Datos del CFDI de prueba

- Emisor: RFC `EKU9003173C9`, Régimen `601`
- Receptor: RFC público `XAXX010101000`, régimen `616`, uso CFDI `S01` (sin efectos fiscales)
- 1 concepto: clave SAT `01010101`, cantidad 1, valor unitario $100
- IVA 16% trasladado
- Método `PPD`, forma `99` (defaults nuevos del ERP)

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| El JSON que envío no cumple con Anexo 20 estricto | Media | Validar contra el ejemplo oficial de SW; probar en sandbox antes de prod |
| SW no reconoce el CSD del emisor (mal cargado en panel) | Baja | Verificar antes del primer timbrado con `/account/balance` y `Emisores` |
| Fallo de red durante timbrado | Baja | Guardar payload en BD antes de llamar; reintento con idempotencia por serie+folio |
| SW cambia el shape del endpoint | Muy baja | Version `v3` en la URL — cambios rompientes serían en `v4` con aviso previo |
| Timbres se agotan | Baja | El ERP ya lee `getAccountStatus`; UI muestra alerta cuando quedan < 20 |

---

## 8. Plan de pruebas (después de la implementación)

1. **T1 — Test de sellado del payload**: verificar que el JSON generado por el serializer es válido según el ejemplo oficial de SW.
2. **T2 — Timbrado sandbox exitoso**: emitir un CFDI con receptor `XAXX010101000` → recibir UUID + sellos.
3. **T3 — Guardado del XML timbrado**: verificar que `invoices.xml_content` contiene el XML con `<tfd:TimbreFiscalDigital>`.
4. **T4 — PDF con datos reales**: generar PDF de la factura timbrada → verificar UUID, sellos y QR reales visibles.
5. **T5 — Consumo de balance**: verificar que `pac/account-status` refleja 500 timbres (uno consumido).
6. **T6 — Cancelación**: cancelar el CFDI de prueba con motivo `02` (error sin relación).
7. **T7 — Rechazo por datos inválidos**: intentar timbrar con RFC inválido → verificar que el error 301 se propaga limpio al usuario.

---

## 9. Decisión final

✅ **Usar Endpoint 2 (`/v3/cfdi33/issue/json/v4`)**.

Razones:
1. Evita implementar sellado XML criptográfico (2-3 semanas de trabajo + auditoría de seguridad).
2. Mantiene la clave privada SAT fuera del backend (menor riesgo).
3. Contrato JSON encaja bien con el modelo interno del ERP.
4. Rendimiento y compliance idénticos al endpoint 1.
5. El cambio a endpoint 1 en el futuro (por si algún día migramos de PAC) sigue siendo posible porque el modelo interno está desacoplado.

---

## 10. Próximos pasos

**Antes de empezar la implementación, esperar la indicación explícita del cliente.**

Cuando se dé luz verde:

1. Cargar CSD de pruebas SW en `portal.test.sw.com.mx` (~10 min)
2. Implementar `stampFromJSON` en el provider SW (~4 horas)
3. Implementar `buildCFDIJson` serializer (~1 día)
4. Ajustar `pac.service → stampInvoice` (~2 horas)
5. Correr T1-T7 en sandbox (~1 día)
6. Documentar y hacer PR

**Total estimado: 2-3 días laborales para tener la primera factura timbrada real en sandbox.**
