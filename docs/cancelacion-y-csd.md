# Cancelación de CFDI y manejo del CSD

Lo que costó una tarde entera averiguar, para no volver a recorrerlo. Cubre las
tres cosas que se enredaron entre sí: cómo se cancela ante el SAT, dónde vive el
certificado de sello, y cómo saber qué está bloqueando una cancelación.

## 1. Cómo se cancela

La ruta de SW lleva **todo en la URL** y **no lleva cuerpo**:

```
POST /cfdi33/cancel/{RFC}/{UUID}/{MOTIVO}[/{folioSustitucion}]
```

El segmento de `folioSustitucion` se agrega **sólo con motivo `01`**. Con
cualquier otro se omite — que no es lo mismo que mandarlo vacío.

| Motivo | Significado | Requiere folio sustituto |
|---|---|---|
| `01` | Emitido con errores **con** relación | Sí |
| `02` | Emitido con errores **sin** relación | No |
| `03` | No se llevó a cabo la operación | No |
| `04` | Operación nominativa en factura global | No |

Se intentó primero `POST /cfdi33/cancel/{RFC}` con los datos en JSON, y antes
`/v4/cfdi/cancel/{RFC}`. Las dos devolvieron **404**, que el código traducía a
"el CFDI no está en la bóveda de SW". Era falso: un 404 significa lo mismo cuando
el recurso no existe que cuando **la ruta** no existe. Tres veces se leyó ese 404
como un problema del comprobante.

**Regla que quedó de ahí:** ante un 404 de una API externa, descartar primero que
la ruta esté mal antes de concluir nada sobre los datos.

## 2. Con qué certificado se firma la cancelación

Hay dos maneras, y el sistema prefiere la primera:

| Vía | Ruta | De dónde sale el certificado |
|---|---|---|
| **Con CSD propio** | `/cfdi33/cancel/csd` | Lo manda el sistema en el cuerpo |
| Por UUID | `/cfdi33/cancel/{rfc}/{uuid}/{motivo}` | De la bóveda del PAC |

La segunda exige que el CSD esté cargado **en la cuenta de SW**. Si no lo está,
el SAT responde `CA305 — Certificado Inválido`, y desde el código no hay nada que
corregir: alguien tiene que entrar al panel del PAC.

Por eso se prefiere mandar el certificado: no depende de una configuración
externa, y el certificado con el que se cancela pasa a ser **el mismo con el que
se timbró**, que es justo lo que el SAT valida.

### Dónde vive el CSD

**En la base de datos**, cifrado: `csd_cer_data` y `csd_key_data`, base64 del DER
cifrado con `utils/csd-crypto` (AES-256-GCM), igual que la contraseña.

Antes vivía en el disco (`csd_cer_path`, `csd_key_path`). **En Render el disco es
efímero:** cada despliegue borra los archivos. La fila conservaba la ruta, el
archivo ya no existía, y el sistema caía a la bóveda del PAC en silencio → CA305.
Con eso, cada actualización dejaba a todas las empresas sin poder timbrar hasta
que alguien recargara su certificado a mano.

Las rutas de disco **se conservan como respaldo** mientras haya empresas sin
migrar. Migrar es simplemente volver a cargar el CSD una vez desde
**Sidebar → Emisor**.

### Por qué base64 en TEXT y no bytes en BYTEA

Dos razones concretas: es literalmente lo que la API del PAC pide (`b64Cer`,
`b64Key`), así que no hay conversión al leer; y `csd-crypto` ya trabaja sobre
cadenas, de modo que se reutiliza en vez de escribir una segunda variante para
binario — que es como se acaba con dos formatos que no se entienden entre sí.

> **`ENCRYPTION_KEY` no se rota a la ligera.** Si cambia, ninguna contraseña ni
> certificado guardado se puede descifrar, y hay que volver a cargar el CSD de
> cada empresa. El error lo dice con esas palabras cuando ocurre.

### El fallback avisa

`modules/pac/csd-loader.ts` resuelve la carga en un solo lugar y **siempre
devuelve un motivo legible**, que se escribe en el log y se agrega al mensaje de
error cuando la cancelación falla sin certificado.

| Situación | Qué dice |
|---|---|
| Está en la base | *CSD leído de la base de datos* |
| Sin CSD | *la empresa no tiene CSD cargado* |
| Ruta sin archivo | *el archivo YA NO EXISTE… el disco se borra en cada despliegue* |
| Contraseña ilegible | *no se pudo descifrar… ENCRYPTION_KEY cambió* |
| Empresa inexistente | *la empresa no existe* |

Las tres últimas llegaban antes como el mismo `CA305` indistinguible. Un fallback
que no se anuncia no es un fallback: es un error latente.

## 3. Por qué una factura sale "No cancelable"

El SAT **no deja cancelar un CFDI que tiene comprobantes vigentes apuntándole**.
Una factura con complementos de pago o notas de crédito vivos queda bloqueada
hasta que ésos se cancelen. El orden es de abajo hacia arriba:

1. Complementos de pago
2. Notas de crédito
3. La factura

### Los estados que devuelve el SAT

| Campo | Valores | Qué significa |
|---|---|---|
| `Estado` | Vigente / Cancelado / No Encontrado | Si el CFDI sigue vivo |
| `EsCancelable` | Cancelable sin aceptación / con aceptación / No cancelable | Si se puede cancelar hoy |
| `EstatusCancelacion` | En proceso / Cancelado sin aceptación / Solicitud rechazada | En qué punto va una cancelación pedida |

**"En proceso" no es un error.** Significa que el SAT recibió la solicitud, la
aceptó y la está procesando. Mientras dure, el comprobante sigue **Vigente** y su
factura sigue bloqueada. **No hay que reintentar**: una segunda solicitud sobre
algo en curso no acelera nada y puede devolver códigos que manden a diagnosticar
un problema inexistente.

**"Cancelable sin aceptación"** quiere decir que el receptor no tiene que
aprobar, **no** que el efecto sea inmediato.

### Consultarlo desde el sistema

Botón **Consultar** en el modal de cancelación de la factura. Pregunta
directamente al SAT y traduce la respuesta a una frase entendible.

Es un servicio **SOAP del SAT**, no de SW:

```
POST https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc
SOAPAction: http://tempuri.org/IConsultaCFDIService/Consulta
Content-Type: text/xml;charset="utf-8"
```

Con la expresión impresa dentro de `CDATA`:

```
?re=<RFC emisor>&rr=<RFC receptor>&tt=<total>&id=<UUID>&fe=<sello>
```

**`fe` son los ÚLTIMOS OCHO caracteres del sello**, no el sello completo. Es el
detalle que más se equivoca, y mandarlo entero devuelve "no encontrado" en vez de
un error que explique la causa.

La consulta se hace **a petición, no al abrir el modal**: el servicio del SAT es
lento y se cae con frecuencia, y esperar por él antes de dibujar la pantalla
convertiría una caída suya en una cancelación que ni siquiera se puede intentar.

Que la consulta falle **no dice nada del comprobante** — el mensaje lo aclara,
para que nadie concluya que su CFDI tiene un problema cuando el problema es el
servicio.

## 4. Cancelar sólo en el sistema

Los tres endpoints aceptan `soloLocal: true`, que marca el comprobante como
cancelado **sin llamar al PAC**. Existe para un caso legítimo: reflejar aquí algo
que ya se canceló desde el panel del PAC.

**No es el camino normal y no debe ofrecerse como salida fácil.** Si el CFDI
sigue vivo ante el SAT y aquí aparece cancelado, la contabilidad deja de cuadrar
con la declaración y no se nota hasta el cierre.

Hasta hace poco esto ocurría **sin querer**: `cancelPayment` y `cancelCreditNote`
hacían sólo `UPDATE` y nunca llamaban al PAC. El comentario del código lo
admitía: *"en producción con PAC real, aquí también invocaríamos el endpoint de
cancelación. Por ahora solo estado local"* — y ese "por ahora" se quedó. Los tres
módulos mostraban el mismo aviso de éxito, así que desde la pantalla no había
forma de distinguir una cancelación real de una que sólo movía un renglón.

Por eso el botón de cancelar aparece **aunque el comprobante ya figure
cancelado**: hay registros marcados así que siguen vigentes ante el SAT, y
ocultar el botón los dejaría sin reparación posible.

## Archivos

| Qué | Dónde |
|---|---|
| Cifrado del CSD | `backend/src/utils/csd-crypto.ts` |
| Carga del CSD con diagnóstico | `backend/src/modules/pac/csd-loader.ts` |
| Consulta de estatus al SAT | `backend/src/modules/pac/sat-status.service.ts` |
| Cancelación en el PAC | `backend/src/modules/pac/providers/sw-sapien.provider.ts` |
| Cancelación por folio fiscal | `backend/src/modules/pac/pac.service.ts` → `cancelarComprobante` |
| Migración de las columnas | `backend/src/database/migrations/2026-08-04a_csd_en_base_de_datos.sql` |
