# De NEXO al SUA — mapeo y layouts

NEXO **alimenta** al SUA: genera los archivos de texto que el SUA importa, para no
recapturar a mano el padrón ni los movimientos. El flujo es en dos tiempos, y ese orden
no es negociable:

1. **Altas** → `Aseg.txt` (y opcionalmente `Afil.txt`). Hasta que el trabajador existe
   en el SUA, cualquier movimiento suyo se rechaza.
2. **Movimientos** → `Movt.txt` (bajas, modificaciones de salario, reingresos) y
   `Cred.txt` (créditos INFONAVIT).

## De dónde salen estos layouts

No de un manual: de la base del SUA en producción (`C:\Cobranza\SUA\SUA.MDB`, SUA 3.7.1)
cotejada contra los archivos que ese mismo SUA exporta. Cada posición de abajo se
verificó leyendo el `.txt` real y comparándolo con el renglón correspondiente de la
tabla. Los créditos cuadraron **21 de 21**. El mapeo completo de la base está en
`D:\Obsidian\GDM_FAC\SUA\SUA_MAPEO_BD.md`.

Dos convenciones generales:

- Alfanuméricos a la izquierda con espacios a la derecha; numéricos a la derecha con
  ceros a la izquierda. Nada lleva punto decimal: los decimales son implícitos.
- Fechas en **DDMMAAAA**. Renglones terminados en **CRLF**.

### `Aseg.txt` — 168 posiciones (alta del trabajador)

| Pos | Largo | Campo | Tabla SUA |
|---|---|---|---|
| 1–11 | 11 | Registro patronal | `Asegura.REG_PATR` |
| 12–22 | 11 | NSS | `NUM_AFIL` |
| 23–35 | 13 | RFC | `RFC_CURP` |
| 36–53 | 18 | CURP | `CURP` |
| 54–103 | 50 | `PATERNO$MATERNO$NOMBRES` | `NOM_ASEG` |
| 104 | 1 | Tipo de trabajador (1 permanente, 2 eventual, 3 construcción, 4 eventual del campo) | `TIP_TRA` |
| 105 | 1 | Semana / jornada reducida (0–6) | `SEM_JORD` |
| 106–113 | 8 | Fecha de alta | `FEC_ALT` |
| 114–120 | 7 | Salario base de cotización, 2 decimales | `SAL_IMSS` |
| 121–137 | 17 | Clave de ubicación | `CVE_UBC` |
| 138–147 | 10 | Número de crédito INFONAVIT | `PAG_INFO` |
| 148–155 | 8 | Fecha de inicio del descuento | `FEC_DSC` |
| 156 | 1 | Tipo de descuento (1 porcentaje, 2 cuota fija, 3 factor/VSM) | `TIP_DSC` |
| 157–164 | 8 | Valor del descuento | `VAL_DSC` |
| 165 | 1 | Trabajador pensionado (0/1) | `TRA_PENIV` |
| 166–168 | 3 | Clave de municipio IMSS | `CVE_MUN` |

Las posiciones 165 a 168 explican por qué los manuales viejos dicen 164: el SUA 3.7.1
agregó pensionado y municipio al final del registro.

### `Afil.txt` — 80 posiciones (datos afiliatorios, complementa el alta)

| Pos | Largo | Campo | Tabla SUA |
|---|---|---|---|
| 1–11 | 11 | Registro patronal | `Afiliacion.REG_PATR` |
| 12–22 | 11 | NSS | `NUM_AFIL` |
| 23–27 | 5 | Código postal | `CPP_TRAB` |
| 28–35 | 8 | Fecha de nacimiento | `FEC_NAC` |
| 36–60 | 25 | Lugar de nacimiento (entidad, texto) | `LUG_NAC` |
| 61–62 | 2 | Clave IMSS de la entidad | `ENT_TRAB` |
| 63–65 | 3 | UMF / clínica | `UMF_TRAB` |
| 66–77 | 12 | Ocupación | `OCUPA` |
| 78 | 1 | Sexo (M/F) | `SEXO` |
| 79 | 1 | Tipo de salario (0 fijo, 1 variable, 2 mixto) | `TIP_SAL` |
| 80 | 1 | Jornada / horas | `JOR_HOR` |

### `Movt.txt` — 49 posiciones (movimientos afiliatorios)

| Pos | Largo | Campo | Tabla SUA |
|---|---|---|---|
| 1–11 | 11 | Registro patronal | `Movtos.REG_PATR` |
| 12–22 | 11 | NSS | `NUM_AFIL` |
| 23–24 | 2 | Tipo de movimiento | `TIP_MOVS` |
| 25–32 | 8 | Fecha del movimiento | `FEC_INIC` |
| 33–40 | 8 | Folio de incapacidad (blancos si no aplica) | `FOL_INC` |
| 41–49 | 9 | Salario, 2 decimales (`000018591` = 185.91) | `SAL_MOVT` |

Tipos que NEXO genera: **02** baja, **07** modificación de salario, **08** reingreso.
El alta (01) **no va aquí**: viene en `Aseg.txt`. Los tipos 11 ausentismo y 12
incapacidad usan el mismo archivo pero se capturan en el SUA; quedan fuera por ahora.

A diferencia del IDSE, la baja del SUA **no lleva causa**: no existe el campo.

### `Cred.txt` — 52 posiciones (créditos INFONAVIT)

| Pos | Largo | Campo | Tabla SUA |
|---|---|---|---|
| 1–11 | 11 | Registro patronal | `Movtos.REG_PATR` |
| 12–22 | 11 | NSS | `NUM_AFIL` |
| 23–32 | 10 | Número de crédito | `Num_Cre` |
| 33–34 | 2 | Tipo de movimiento (15 inicio, 16 suspensión, 17 reinicio, 19 modificación de valor) | `TIP_MOVS` |
| 35–42 | 8 | Fecha del movimiento | `FEC_INIC` |
| 43 | 1 | Tipo de descuento (1 porcentaje, 2 cuota fija, 3 factor/VSM) | `Tip_Des` |
| 44–51 | 8 | Valor del descuento | `Val_Des` |
| 52 | 1 | Tabla de disminución (N/S) | `Tab_Dism` |

**La escala del valor depende del tipo de descuento**, y eso es lo único raro del
formato. Verificado en los 21 renglones de `SuaMovCr.txt`:

| Tipo | Decimales implícitos | Ejemplo |
|---|---|---|
| 2 cuota fija (pesos) | 3 | `01424910` = 1,424.91 |
| 3 factor / VSM | 4 | `00085100` = 8.5100 |
| 1 porcentaje | 4 **por confirmar** | `00200000` = 20.0000 |

No hay un solo crédito por porcentaje en esta base, así que esa escala es inferencia por
analogía con el factor. El generador avisa cuando emite uno.

## Mapeo campo por campo

De `nomina_empleados` y `companies` a los cuatro archivos:

| Campo SUA | De dónde sale en NEXO |
|---|---|
| Registro patronal | `companies.registro_patronal` |
| NSS | `nomina_empleados.nss` — obligatorio, 11 dígitos |
| RFC / CURP | `rfc`, `curp` |
| Nombre | `apellido_pat$apellido_mat$nombre` (el SUA separa con `$`) |
| Fecha de alta | `fecha_reingreso` si existe, si no `fecha_ingreso` |
| SBC | `sbc`, y si está vacío `salario_diario_integrado` |
| Código postal, fecha de nacimiento | `codigo_postal`, `fecha_nacimiento` |
| Sexo | se deduce de la **posición 11 del CURP**: `H` → `M`, `M` → `F` |
| Entidad y lugar de nacimiento | se deducen de las **posiciones 12–13 del CURP** contra el catálogo `Estados` del propio SUA (`CveCurp` → `IdClave` + `Descripcion`) |
| Número de crédito, tipo y valor del descuento, fecha | `infonavit_num_credito`, `infonavit_tipo_descuento` (`porcentaje`/`cuota_fija`/`vsm` → 1/2/3), `infonavit_descuento`, `infonavit_desde` |
| Tipo de trabajador, semana/jornada, tipo de salario, UMF, ocupación, clave de ubicación, municipio, pensionado | **no están en el expediente**: son parámetros del generador, con los valores que predominan en la base real (1, 0, 0, `000`, blancos, blancos, blancos, 0) |

El municipio IMSS (`CVE_MUN`, del catálogo `Canamu`: `A01`, `Y45`…) sale en blanco por
omisión, que es como están 607 de los 1,222 registros de esa base. Si algún día hace
falta, se captura por empresa; deducirlo del texto libre de `municipio` sería adivinar.

## La bitácora: qué se mandó y cómo le fue

Cada generación queda apuntada en `nomina_sua_lotes` con la **foto** de sus renglones
(`nomina_sua_lote_renglones`): el NSS, la fecha y el importe **como se mandaron**, no una
referencia al expediente. Si el expediente cambia después, la bitácora sigue diciendo lo
que se envió ese día, que es lo único que sirve para cotejar contra el SUA.

No se parece a la del IDSE en una cosa: el IDSE devuelve un acuse en PDF y **el SUA no
devuelve nada** — deja sus rechazos en los `ErrImp*.txt` de su propia carpeta. Así que el
lote se cierra con un **resultado** que captura quien importó:

| Resultado | Qué significa |
|---|---|
| `PENDIENTE` | se generó el archivo, nadie ha dicho si entró |
| `IMPORTADO` | el SUA lo aceptó |
| `CON_ERRORES` | el SUA rechazó; se pega el `ErrImp*.txt` tal cual en `errores_txt` |

**Un lote `CON_ERRORES` deja de contar como enviado** y sus movimientos vuelven a
aparecer como pendientes. Es lo que se quiere: no entraron.

Con eso, `GET /nomina/sua/candidatos` marca cada renglón con `enviado`, `enviado_en` y
`enviado_detalle`, y el generador avisa antes de repetir:

- un **alta** ya mandada → «el SUA la rechazará con *Ya existe*». El alta se compara **sin
  ver la fecha**: se manda una vez y la fecha pudo corregirse al generarla.
- una **baja, modificación o crédito** con la misma fecha → ya se mandó. Esos sí se
  comparan con fecha, porque se repiten a lo largo de los años.
- un **movimiento de crédito anterior** al último enviado → el SUA no lo acepta («Ya
  existe un Movimiento de Crédito en esta fecha o posterior»).
- un **movimiento de alguien sin alta anotada**, pero sólo si la bitácora ya trae altas:
  el padrón del SUA casi siempre viene de antes, y entonces la ausencia no prueba nada.

Si el apunte falla, el archivo **se entrega igual** y el aviso lo dice. Perder el registro
es malo; no entregar el archivo ya generado es peor.

Rutas: `GET /nomina/sua/lotes`, `POST /nomina/sua/lotes/:id/resultado`,
`GET /nomina/sua/lotes/:id/errores` y `DELETE /nomina/sua/lotes/:id` (borrar hace falta:
un archivo que se generó y nunca se importó deja un apunte que miente).

## La pantalla

**Nómina → SUA · Importación** (`/nomina/sua`), junto a IMSS · IDSE. Cuatro pestañas en el
orden del proceso: **1 · Altas**, **2 · Movimientos**, **3 · Créditos** y **Bitácora**.

Arranca en el **mes en curso** y propone lo que hay en ese rango: quién ingresó (altas),
quién se dio de baja o reingresó, y quién trae crédito INFONAVIT. Cada renglón se marca
con su casilla y dice su estado — *listo*, lo que le **falta** (sin NSS, sin salario), o
*ya se mandó* con la fecha. Lo que le falta un dato no se puede marcar.

La **modificación de salario** no sale de un rango: se agrega buscando al trabajador, con
su fecha y el nuevo SBC.

### El botón automático

**«Generar todo lo pendiente»** (morado, junto al rango) arma los tres pasos de un golpe
con lo que NEXO ya sabe, en el orden que el SUA necesita, sin marcar renglón por renglón.
Entra lo que está **completo y no se ha mandado**; los créditos van como **inicio de
descuento** con la fecha del expediente, porque es el único movimiento que el SUA acepta
primero — suspensiones, reinicios y cambios de valor siguen eligiéndose a mano, que es
donde hace falta la carta del INFONAVIT.

Lo que le falta un dato **se omite y se nombra**, no detiene la corrida. En el modo a mano
frenar tiene sentido —alguien marcó ese renglón a propósito—; aquí nadie eligió al que
viene sin NSS, y parar por él dejaría sin mandar a los otros treinta que sí están bien. Si
las **altas** truenan sí se detiene todo: mandar movimientos de gente que el SUA no conoce
es garantizar su rechazo.

Los archivos se guardan en «Descargas» con su nombre del SUA (`Aseg.txt`, `Afil.txt`,
`Movt.txt`, `Cred.txt`) y arriba aparecen los **avisos** que hay que leer antes de
importar. En la bitácora se cierra cada lote con **«Entró al SUA»** o **«Lo rechazó»**,
y en el segundo caso se pega el `ErrImp*.txt` que el SUA dejó en su carpeta.

Los **parámetros del SUA** (tipo de trabajador, jornada, UMF, ocupación, clave de
ubicación, municipio, pensionado, tabla de disminución) están en un panel plegado, con
los valores que predominan en la base real ya puestos.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Motor de formato (no toca la base) | `backend/src/modules/nomina/sua-export.ts` |
| Puente con la base y reglas de selección | `backend/src/modules/nomina/sua-export.service.ts` |
| Pruebas del formato (24) | `backend/src/modules/nomina/sua-export.test.ts` |
| Rutas | `backend/src/modules/nomina/nomina.routes.ts` (bloque «SUA») |
| Bitácora | `backend/src/database/migrations/2026-11-26b_sua_lotes.sql` |
| Pantalla | `frontend/src/pages/nomina/SuaImportacion.tsx` (ruta `/nomina/sua`) |
| Mapeo de la base del SUA | `D:\Obsidian\GDM_FAC\SUA\SUA_MAPEO_BD.md` (fuera de este repo) |

El motor reutiliza los ayudantes de relleno del IDSE (`txtIzq`, `ceros`, `fechaDDMMAAAA`
de `imss-idse.ts`): los dos formatos son de longitud fija y las reglas de relleno son las
mismas, así que tener dos copias sólo garantizaría que se despeguen.

### Endpoints

Todos bajo `/api/v1/nomina`, con la misma llave que el resto de lo sensible de nómina
(`soloAdmin`).

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/sua/candidatos?desde=&hasta=` | qué hay para mandar, con lo ya enviado marcado |
| POST | `/sua/altas` | `Aseg.txt` (+ `Afil.txt`) |
| POST | `/sua/movimientos` | `Movt.txt` |
| POST | `/sua/creditos` | `Cred.txt` |
| POST | `/sua/automatico` | los tres pasos de un golpe con lo pendiente del rango |
| POST | `/sua/validar` | revisa un `.txt` del SUA antes de importarlo |
| GET | `/sua/lotes` | la bitácora |
| POST | `/sua/lotes/:id/resultado` | cerrar el lote (y pegar el `ErrImp`) |
| GET | `/sua/lotes/:id/errores` | el `ErrImp` guardado |
| DELETE | `/sua/lotes/:id` | borrar un lote que nunca se importó |

Las tres de generación devuelven `{ archivos: [{ nombre, contenido, renglones }], avisos,
loteId }`: JSON y no el archivo pelado como el IDSE, porque las altas son **dos** archivos
y los avisos hay que leerlos antes de importar.

## Cómo volver a verificar los layouts

Si el SUA se actualiza y algo deja de entrar, el método que sirvió —y que no depende de
ningún manual— es cotejar contra la base del propio SUA:

1. Copiar `C:\Cobranza\SUA\SUA.MDB` (nunca abrir el vivo: `SUA.exe` lo toma en exclusiva).
2. Abrir la copia con ACE OLEDB de 64 bits —el driver ODBC de `.mdb` sólo existe en 32—
   pasando la clave en la cadena: `Jet OLEDB:Database Password=…`.
3. En el SUA, **Utilerías → Exportar Datos a Txt's**: genera `Aseg`, `Afil`, `Movt`,
   `Incap` y `Cred` con los datos que ya tiene dentro.
4. Comparar cada renglón del `.txt` con su renglón de las tablas `Asegura`, `Afiliacion` y
   `Movtos`. Ahí salen las posiciones, y salen de verdad: así se descubrió que el valor del
   descuento cambia de escala según el tipo.

## Lo que NEXO no manda

- **Incapacidades** (`Incap.txt`) y ausentismos: el layout de 57 posiciones no quedó
  verificado campo por campo y no estaban en el alcance.
- **El descuento por porcentaje** sigue sin confirmarse contra el SUA: no hay un solo caso
  en la base real. Se escribe con 4 decimales y el generador avisa cada vez.
