# CSD y timbrado — error "No se pudo cargar la llave privada" y cómo evitarlo

> Guía para soporte y onboarding. Resume un problema real (2026-10-30) que dejó a
> 4 de 14 empresas sin poder timbrar, y lo que se hizo para que **no vuelva a
> pasar en tiempo real con un cliente esperando**.

---

## El síntoma

Al timbrar (o al pulsar **«Registrar CSD en el PAC (SW)»**) aparece:

```
El PAC no aceptó el CSD (PRODUCCIÓN): No se pudo cargar la llave privada,
asegúrese de que la contraseña sea válida.
```

o, al reintentar el timbrado:

```
No fue posible obtener el Certificado para el Rfc: XXXX… ; El PAC no aceptó el
CSD al registrarlo (No se pudo cargar la llave privada…).
```

## La causa (importante)

**NO es un problema de vigencia.** La vigencia vive en el **.cer**, no en la **.key**.
El mensaje significa literalmente que la **contraseña guardada no abre la `.key`**.
A nivel de OpenSSL/Node el error es `bad decrypt`.

Causas, de más a menos común:

1. **La contraseña guardada es incorrecta.** Típico cuando se **renueva** el CSD
   (por eso "está vigente") y la contraseña nueva no se actualizó, o se tecleó mal.
2. **Autocompletado del navegador.** El navegador mete una contraseña guardada en
   el campo "Contraseña del CSD"; como se ve con puntitos, nadie lo nota.
3. **Se subió la `.key` de la e.firma/FIEL** en vez de la del **CSD**. Son archivos
   y contraseñas distintos; la e.firma **no sirve** para sellar CFDI.
4. **El `.cer` y la `.key` son de juegos de CSD distintos** (no corresponden).
5. **El `.key` del CSD usa un cifrado antiguo (legado).** Si al probar la `.key` da
   `DECODER routines::unsupported` (en vez de `bad decrypt`), el cifrado interno del
   PKCS#8 (p. ej. 3DES/RC2) no lo soporta OpenSSL 3 (Node 18+), **sin importar la
   contraseña**. La e.firma suele traer AES (abre) y un CSD viejo 3DES (no abre).
   Solución: **regenerar el CSD en Certifica** (ver abajo), que sale con AES moderno.

## Cómo diagnosticar (Web Shell de Render, servicio del backend)

Prueba, **empresa por empresa**, si la contraseña abre la `.key` — localmente, sin el PAC.
Parado donde está `dist/` (verifícalo con `ls dist/modules/pac/csd-loader.js`):

```bash
cat > /tmp/diag-csd.js <<'DIAGEOF'
const path = require('path');
const crypto = require('crypto');
const base = process.cwd();
const { query } = require(path.join(base, 'dist/config/database'));
const { obtenerCsdDeEmpresa } = require(path.join(base, 'dist/modules/pac/csd-loader'));
const rfcDe = (s) => (String(s || '').match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/) || [''])[0];
(async () => {
  const r = await query(
    `SELECT id, rfc, COALESCE(timbrado_ambiente,'(sin)') AS amb
       FROM companies
      WHERE csd_key_data IS NOT NULL OR csd_key_encrypted IS NOT NULL OR csd_key_path IS NOT NULL
      ORDER BY rfc`);
  console.log('RFC\tAMB\tLLAVE_ABRE\tCER=KEY\tVENCE\tCERT_RFC\tNOTA');
  let ok = 0, fail = 0;
  for (const c of r.rows) {
    let res;
    try { res = await obtenerCsdDeEmpresa(c.id); }
    catch (e) { console.log(`${c.rfc}\t${c.amb}\tERROR_CARGA\t-\t-\t-\t${e.message}`); fail++; continue; }
    if (!res.csd) { console.log(`${c.rfc}\t${c.amb}\tSIN_CSD\t-\t-\t-\t${res.motivo}`); fail++; continue; }
    let abre = '?', match = '?', vence = '?', certRfc = '?', nota = res.desdeDisco ? 'disco' : 'BD', priv = null;
    try { priv = crypto.createPrivateKey({ key: Buffer.from(res.csd.b64Key, 'base64'), format: 'der', type: 'pkcs8', passphrase: res.csd.password }); abre = 'OK'; ok++; }
    catch (e) { abre = 'FALLA'; nota = (e.message || '').slice(0, 80); fail++; }
    try {
      const x = new crypto.X509Certificate(Buffer.from(res.csd.b64Cer, 'base64'));
      vence = (x.validTo || '').slice(0, 11); certRfc = rfcDe(x.subject);
      if (priv) match = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).equals(x.publicKey.export({ format: 'der', type: 'spki' })) ? 'SI' : 'NO';
    } catch (e) { nota += ' | cer:' + (e.message || '').slice(0, 40); }
    console.log(`${c.rfc}\t${c.amb}\t${abre}\t${match}\t${vence}\t${certRfc}\t${nota}`);
  }
  console.log(`\nTotal: ${r.rows.length} con CSD · ${ok} abren · ${fail} fallan`);
  process.exit(0);
})().catch((e) => { console.error('ERROR FATAL:', e.message); process.exit(1); });
DIAGEOF
node /tmp/diag-csd.js
```

Cómo leer la salida:

| Columna | Qué dice |
|---|---|
| `LLAVE_ABRE = OK` | La contraseña abre la `.key`. Esa empresa timbra. |
| `LLAVE_ABRE = FALLA` (`bad decrypt`) | La contraseña **no** abre la `.key` → contraseña o `.key` equivocada. |
| `CER=KEY = SI/NO` | Si el `.cer` corresponde a la `.key`. `NO` = son de juegos distintos. |
| `SIN_CSD` | El loader no encontró CSD utilizable (ver `NOTA`). |
| `VENCE` / `CERT_RFC` | Vigencia y RFC que trae el `.cer` (debe ser el de la empresa). |

- **Solo algunas fallan** → es la **contraseña de esas empresas** (dato), no el sistema.
- **Fallan todas** → problema **sistémico** (código/entorno) — revisar `ENCRYPTION_KEY`, formato, etc.

## La solución

Recargar el CSD de cada empresa en **FALLA** con la **contraseña correcta**:

- Pantalla **Emisor** (barra lateral → «Datos de mi empresa / Emisor»): sube `.cer`,
  `.key` y contraseña del **CSD**. Desde 2026-10-30 **se valida antes de guardar**:
  si la contraseña no abre la `.key`, o `.cer`/`.key` no corresponden, **se rechaza**
  con mensaje claro — ya no se guarda un CSD que no sirve.
- Súper Admin → Empresas → (empresa) → CSD: el inspector muestra `key_error` /
  `key_matches` al elegir los archivos, y el guardado también valida.

La **contraseña correcta** es la que se fijó al **generar el CSD en Certifica (SAT)**.
Si nadie la tiene, lo más rápido es **regenerar el CSD en Certifica** con una
contraseña conocida y subir ese.

Después de corregir, **vuelve a correr el diagnóstico**: debe decir `… · N abren · 0 fallan`.

### Regenerar un CSD en Certifica (cuando no hay contraseña o es cifrado viejo)

Es gratis y toma ~5 min. Un CSD nuevo sale con **cifrado AES (moderno)** y la
**contraseña que tú eliges** → abre en NEXO y en el PAC sin problemas.

**A. Generar el requerimiento — app de escritorio `Certifica` del SAT:**
1. Descarga **Certifica** (portal del SAT, "Certifica"). Es una app Java.
2. Abre → **«Solicitud de Certificados de Sello Digital (CSD)»**.
3. Carga tu **e.firma (FIEL)**: `.cer` + `.key` + contraseña de la e.firma.
4. Captura una **sucursal/unidad** (nombre libre, p. ej. "Matriz") y define una
   **contraseña NUEVA para el CSD** (anótala; será la del sello).
5. Genera → crea un **`.req`** (requerimiento) y un **`.key`** (llave del CSD). Guárdalos.

**B. Enviar y descargar el certificado — `CertiSAT Web` (con e.firma):**
6. Entra a **CertiSAT Web** (SAT → trámites de CSD) con tu e.firma.
7. **«Envío de solicitud de CSD»** → sube el `.req`. SAT lo procesa casi al instante.
8. **«Recuperación de certificados»** → descarga el **`.cer`** nuevo (serie de 20 dígitos).

**C. Subir a NEXO:**
9. Ya tienes el trío: **`.cer`** (paso 8) + **`.key`** (paso 5) + **contraseña nueva** (paso 4).
10. Pantalla **Emisor** de la empresa → sube `.cer` y `.key`, escribe la contraseña **a
    mano** (ojo con el autocompletado) → **Guardar CSD** (valida al instante).
11. **«Registrar CSD en el PAC (SW)»** y timbra una factura de prueba.

## Prevención implementada (para que no pase en vivo con usuarios nuevos)

1. **Validación en la carga** (ambas pantallas): abrir la `.key` con la contraseña y
   comprobar `.cer`↔`.key` **antes de guardar**. Un CSD malo ya **no se guarda** en
   silencio; el error sale en el onboarding, no al timbrar con un cliente esperando.
   - `backend/.../companies/companies-uploads.routes.ts` (pantalla Emisor).
   - `backend/.../admin/admin-companies.routes.ts` (Súper Admin → Empresas).
2. **Aviso en la UI** (Emisor): recuerda subir el **CSD, no la e.firma**, y cuidar el
   **autocompletado** del navegador.
3. **Divergencia de columnas arreglada**: el guardado del Súper Admin escribía el CSD
   en columnas (`csd_key_encrypted`/`csd_key_password_enc`, pgcrypto) que el timbrado
   **no lee**. Ahora escribe **también** `csd_cer_data`/`csd_key_data`/`csd_password_encrypted`
   (AES-256-GCM), que es lo que lee el `csd-loader`, y el borrado las limpia.

## Checklist de onboarding de un emisor nuevo

- [ ] Subir el **CSD** (`.cer` + `.key` del **sello digital**, no la e.firma).
- [ ] Escribir la **contraseña del CSD** a mano (ojo con el autocompletado) y verificarla con «Ver».
- [ ] Que al **Guardar** no salga error de validación (si sale: contraseña/.key mal).
- [ ] Pulsar **«Registrar CSD en el PAC (SW)»** según el ambiente (PRUEBAS/PRODUCCIÓN).
- [ ] Timbrar una factura de prueba antes de operar.

## Dónde vive cada cosa

- Lectura del CSD para timbrar/cancelar: `backend/src/modules/pac/csd-loader.ts`
  (lee `csd_cer_data`/`csd_key_data`/`csd_password_encrypted`, AES-256-GCM).
- Cifrado: `backend/src/utils/csd-crypto.ts` (`encrypt/decryptCsdPassword`, clave `ENCRYPTION_KEY`).
- Lectura de certificados SAT (`.cer`/`.key`): `backend/src/modules/manifest/manifest.service.ts`
  (`parseCertificate`, `openPrivateKey`).
- Registro del CSD en la bóveda del PAC: `backend/src/modules/pac/providers/sw-sapien.provider.ts`
  (`registrarCsd` → `POST /certificates/save`).
