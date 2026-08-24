# BITÁCORA — GDM NEXO

Histórico cronológico de cambios funcionales, decisiones técnicas y deploys.
Formato: cada entrada tiene fecha, contexto, decisión y consecuencia.

> **Sobre el nombre.** Este repositorio es **GDM NEXO**. Las entradas más
> antiguas dicen "GDM_FAC" porque este código nació de ahí, cuando era sólo
> facturación. **Son dos productos distintos** de GRUPO HCGM: GDM Facturación
> sigue existiendo por su cuenta y factura de verdad en `gdmfac-*`. Lo que se
> documenta aquí, de la fase de ERP unificado en adelante, es NEXO.

---

## 2026-08-24 (nómina) — Motor IMSS · IDSE: altas, bajas y modificaciones

### 1 · El archivo se arma, no se teclea
El IDSE del IMSS pide un TXT de **posición fija, 168 caracteres por renglón**.
Tecleado a mano es un rechazo asegurado: un espacio de más en el nombre corre
la fecha, y la fecha corrida es un aviso con fecha equivocada.

Ahora se elige el **tipo de movimiento** (alta/reingreso, baja o modificación de
salario) y los trabajadores, y el servidor arma el archivo con el NSS, el
nombre, el CURP y el salario base que **ya viven en el expediente**. La pantalla
sólo pide lo que el sistema no puede saber: la fecha del acto, la clínica en un
alta, la causa en una baja.

### 2 · Reconstruido desde la guía, no desde el macro
El motor se rehízo desde las **posiciones de la guía del IMSS**, no de la
concatenación del VBA heredado —que incrustaba constantes donde la guía define
campos variables (número de guía, clave del trabajador, CURP, causa de baja)—.
Esas constantes ambiguas quedaron como **parámetros**, no como texto mágico: la
guía por defecto es `01400`, el tipo de salario `2` (variable), pero se cambian
sin tocar código.

### 3 · No genera a medias
El IMSS rechaza el **lote completo** por un solo renglón malo. Por eso, si a
alguien le falta el NSS, o a una baja le falta la causa, el archivo **no se
produce** y la pantalla enumera a todos los que hay que corregir. Enterarse aquí
—no en el portal, con 40 movimientos rebotados— es la razón de ser del módulo.
Cada registro se valida a 168 exactos antes de entrar al archivo.

**Consecuencia.** Nómina → **IMSS · IDSE** en el menú. Ruta `POST
/nomina/imss/idse`, con la misma llave que el resto de lo sensible de nómina
(`nomina:manage`). El SUA y el validador de TXT del documento quedan para la
siguiente fase. Ref: `GDM_NEXO_MOTOR_IMSS_IDSE_SUA.md` §5–§8, §25.

---

## 2026-08-20 (bancos II) — El catálogo del SAT y la rejilla de doce meses

### 1 · El banco se elige, no se teclea
El campo era libre. Tecleado a mano nacen "Bancrea", "BANCREA" y "Banco
Bancrea" como tres bancos distintos — y la **clave**, que es lo que de verdad
importa, no se captura nunca.

Ahora es un combo con los **75 bancos del catálogo SPEI/ABM**, el mismo que ya
usaba nómina. Se expuso también desde tesorería porque el grupo TESORERIA no
alcanza el módulo de nómina, y sin eso el combo habría llegado vacío.

**Y con la clave aparece una comprobación que no existía:** los tres primeros
dígitos de la CLABE **son** la clave del banco. Si no cuadran, uno de los dos
está mal capturado — y el que se entera es el dinero: la transferencia rebota,
o peor, sale a la institución equivocada.

Se avisa en el acto, mientras se teclea, y se rechaza al guardar **diciendo las
dos claves**: quien captura tiene que poder ver cuál de los dos corrigió mal.

### 2 · La rejilla de doce meses
El control mensual vivía en un modal, en forma de lista. Una lista muestra lo
que hay; **una rejilla de doce muestra lo que falta**, y eso es lo que importa:
un año con marzo y mayo pero sin abril tiene un salto de saldo que no se explica
solo, y cada mes por separado se ve perfecto.

El hueco es el dato. Por eso los meses sin cargar ocupan su lugar, en gris, con
el botón para subir su PDF ahí mismo. Y al entrar por una casilla, **el mes y el
año ya van puestos**: volver a pedirlos es donde se carga julio encima de agosto.

Arriba de la rejilla, la conciliación del año: **ingresos, egresos, diferencia y
saldo al último corte**. Es la lectura que se cuadra contra contabilidad.

Cada mes cargado muestra su saldo, sus depósitos y retiros, cuántos movimientos
trae, cuántos fueron inferidos, y si **cuadra** —en verde— o no —en rojo—. Desde
la casilla se baja su CSV, se recarga o se quita.

*Verificado:* 57 comprobaciones. Las nuevas cruzan una CLABE de BBVA (012) con
Bancrea (152) elegido y comprueban que el rechazo **nombre las dos claves**, no
que diga "dato inválido".

---

## 2026-08-20 (bancos) — El salto de hoja, el enlace entre meses y el CSV puente

### 1 · El error del salto de hoja — por qué se perdían movimientos
Cuando el estado de cuenta pasa de una hoja a dos, entre los movimientos
aparecen pies de página, encabezados repetidos y "PÁGINA 2 DE 3". Esas líneas
**no traen fecha**, así que se pegaban al movimiento anterior como si fueran su
referencia.

Y ahí estaba el daño real, que es peor que perder un renglón: si el pie traía un
número con decimales, ese número entraba a la lista de importes del movimiento
— y como los importes se leen de los **últimos tres**, los del pie **ganaban**.
El movimiento pegado al salto salía con las cifras de otro renglón, y el estado
descuadraba sin que se viera por qué.

**Dos arreglos:** el ruido se busca ahora en cualquier parte de la línea, no
sólo al principio; y sobre todo, **los importes salen de la línea de la fecha**,
que es la que trae las columnas. Las de continuación sólo aportan la referencia.
Eso también protege de un concepto que diga "PAGO FACTURA 1,234.00".

### 2 · El orden de las columnas se LEE, no se supone
Bancrea pone RETIROS antes de DEPÓSITOS. Otros bancos al revés — y así los
describió Antonio: *"deposito, retiro y saldo"*. Suponer un orden invierte los
importes de la mitad de los bancos: el retiro entra como depósito.

Ahora se lee del **encabezado del documento**, que lo dice. Sin encabezado
legible se conserva el orden de Bancrea **y se avisa**: es una suposición, y las
suposiciones se dicen.

### 3 · El saldo inicial debe ser el final del mes anterior
Es la comprobación que ata un mes con el siguiente, y ahora corre **al cargar**,
no después. Sin ella cada estado cuadra **consigo mismo** y la serie completa
puede estar rota: basta con que falte un mes para que todos los saldos
posteriores arrastren el hueco, y cada uno por separado se vea perfecto.

Avisa con la diferencia exacta; no bloquea. Bloquear impediría cargar agosto
antes que julio —que es como llegan cuando alguien se pone al corriente— y
dejaría sin manera de corregir el mes que está mal.

### 4 · El CSV puente
Las mismas columnas del banco, ya normalizadas, con el saldo arrastrado al lado
del declarado y el resumen de cuadre al pie. Lleva **BOM**, porque sin él Excel
en español rompe los acentos de cada concepto.

Y lleva una columna **INFERIDO**: un movimiento que dedujo el sistema y que el
banco no reportó no puede llegar a un archivo contable sin decir que lo es.

*Verificado:* 52 comprobaciones. Las nuevas incluyen un estado **de dos hojas**
con un "1,234.00" y un "9,999.99" escondidos en las líneas de concepto —cuadra
sólo si el salto se maneja bien—, un banco con las columnas invertidas, y marzo
abriendo en 9,999 tras cerrar febrero en 1,300.

---

## 2026-08-20 — Bancos: cuentas, estados de cuenta y el saldo al corte

Tesorería programaba pagos **sin saber cuánto hay en el banco**. El saldo vivía
en el portal y en la cabeza de quien lo consultaba; al armar una remesa de
$49,075 nadie podía decir si la cuenta lo aguantaba.

Se portó el `extractor_movimientos.py` que entregó Antonio, con su
documentación. Se conservó lo que importa —los patrones de fecha, el reparto de
importes, el arrastre del saldo y la inferencia de comisiones de Bancrea— y se
cambió lo que no podía sobrevivir al viaje.

### Lo que cambió al portarlo, y por qué

**El original lee PDF; éste lee TEXTO.** El script usa `pdfplumber`, que
conserva la disposición de la página, y `pytesseract` para lo escaneado. En este
servidor no hay ninguno de los dos: el runtime de Render no tiene Python ni
Tesseract, y el único lector disponible —`pdf-parse`— **colapsa los espacios**
(ya estaba documentado en el extractor de CSF). En un estado de cuenta eso es
fatal: "3,500.00 20,000.00" pegado se vuelve un solo número.

Se midió antes de decidir: `pdf-parse` ni siquiera pudo leer un PDF generado
localmente. Así que el extractor trabaja sobre texto y se alimenta de tres
fuentes —texto pegado, CSV del portal, o PDF cuando su texto sale limpio— y
**rechaza el PDF cuando detecta importes pegados**. Entregar cifras que se
partieron mal es peor que no entregar nada.

**La comisión inferida se marca.** El original INSERTA una comisión de $3.00
cuando la diferencia de saldos es exactamente $3.48. La deducción es correcta
—Bancrea a veces omite el renglón— pero un movimiento que el banco no reportó no
puede pasar por uno que sí. Se inserta igual, marcada `inferido`, y se dice
cuántas fueron. Inventar un movimiento y no decirlo es peor que dejar el saldo
descuadrado.

**El reparto por concepto, no por magnitud.** El original suponía que el saldo
siempre es diez veces mayor que el movimiento. Eso falla justo cuando la cuenta
está por vaciarse: un retiro de 900 dejando 100 de saldo se leería al revés. Aquí
manda el concepto —"ENVIADA" sale, "RECIBIDA" entra— y cuando el concepto no dice
nada, **se marca la duda** en vez de adivinar el signo.

**El arrastre se calcula siempre**, no sólo cuando el banco declara el saldo. Es
lo único que delata un movimiento que el documento se comió.

### Las decisiones del módulo

**El saldo es "al corte", y así se dice.** Es el final del último estado
procesado, con el mes escrito al lado. No es el saldo de hoy: entre el corte y
ahora hay cheques y cargos que el banco no ha reportado. Un saldo de hace cuatro
meses sin fecha se lee como si fuera de hoy.

**Volver a cargar un mes REEMPLAZA.** Cargar dos veces julio y acumular daría un
saldo del doble, y nadie lo notaría hasta cuadrar contra el banco. Va en una
transacción: o queda el estado nuevo completo, o el anterior intacto.

**Los meses tienen que encadenar.** El saldo final de uno debe ser el inicial del
siguiente. Cuando no, se señala con las dos cifras — es lo que delata el mes que
falta en medio, y ese hueco descuadra todo lo que viene después.

*Verificado:* 34 comprobaciones. Casi todas de **cuadre**, no de conteo: sacar
"los 4 movimientos" no sirve de nada si los importes están del lado equivocado, y
el conteo saldría igual de bien. Incluye que un estado al que se le quita un
movimiento **no cuadre y lo diga con la diferencia exacta**, y que recargar el
mismo mes deje 4 movimientos y no 8.

---

## 2026-08-18 / 19 — Índice de la jornada

Doce entradas en dos días. Este índice existe porque leídas de corrido cuentan
una sola historia, y esa historia es más útil que cualquiera de las partes.

### El hilo que las une

**Casi todo lo que se arregló no fallaba: mentía.** Un botón gris sin
explicación, una lista vacía que era un error 500, un menú que se veía pero sin
un solo botón dentro, un combo que ofrecía una opción que el servidor rechazaba.
Ninguno rompía la compilación ni aparecía en un log — todos parecían "el sistema
no sirve", que es justo lo que nadie reporta como falla de permisos, de datos o
de configuración.

De ahí salieron los **guardianes** (`scripts/revisar-*` y `probar-*`): siete
scripts que comprueban lo que el compilador no puede, cada uno escrito **después
de** que su falla ocurriera de verdad.

### Por tema

| Tema | Entradas |
|------|----------|
| **Nómina** | formato de la casa en los reportes y cuota patronal · prenómina acumulada · foco perdido, CIF y nómina especial · timbres, uniformes y fechas |
| **Compras y tesorería** | preregistro de proveedores y aviso temprano de faltantes · el 500 disfrazado, las fechas y la hoja de remesa · el botón gris de remesas |
| **Permisos** | grupos que ven sin poder · nómina de rol a capacidad · el frontend dejó de adivinar · dashboard y contrato fuera · reportes fuera |
| **Navegación** | "XML del SAT" con menú propio |

### Los cinco errores que más enseñaron

1. **Un componente definido dentro de otro** borraba el foco a cada letra. No
   rompe nada, no avisa, y sólo se descubre escribiendo. → guardián.
2. **SheetJS libre acepta los estilos y los tira al guardar.** La hoja salía
   perfecta en datos y en blanco y negro. → se cambió a ExcelJS, y la prueba
   **vuelve a abrir** el archivo generado.
3. **`payments.folio` es integer**, y el `ORDER BY` lo trataba como texto: la
   consulta reventaba siempre y la pantalla decía "no hay complementos".
4. **`'\D'` dentro de un template literal** de JavaScript pierde la barra y
   llega a Postgres como `'D'`.
5. **Quitar el dashboard de los grupos** casi deja a seis de siete rebotando
   entre dos negativas: era el destino de todos los rechazos.

### Lo que quedó pendiente y no es código

- `npm run migrate:up` en el **Web Shell de Render** — cinco migraciones.
- `ENABLE_SAT_DESCARGA_CRON=true` en **Render → Environment**, sin la cual la
  descarga masiva no arranca sola.

---

## 2026-08-19 — Los reportes, también sólo para la dirección

Fuera de los seis grupos operativos. Ventas por periodo, saldos y márgenes son
el negocio entero a la vista; quien captura no los necesita para trabajar.

La ruta `/reports` ya iba por `ModuleRoute`, así que quitar el módulo cierra
también la puerta de la URL: no basta con esconder el renglón del menú.

**Lo que NO se fue con ellos:** los reportes **de nómina**. Cuelgan del módulo
`nomina`, no de `reports`, y son el trabajo de Recursos Humanos —la prenómina,
el ISR retenido, la cuota patronal para provisionar—. Habría sido fácil llevarse
los dos por delante, así que hay una comprobación dedicada a que sigan ahí.

Los textos que se muestran bajo el selector de grupo dejaron de prometer
reportes: si el detalle dice "y Reportes" y el menú no los tiene, la primera
sospecha es que algo se rompió.

*Verificado:* 35 comprobaciones de grupos y 30 de rutas y pantallas. La que
importa está escrita para los SEIS a la vez —no grupo por grupo—, porque agregar
uno nuevo y olvidarse de esto le abriría el negocio entero sin que nada fallara.

---

## 2026-08-19 (grupos) — El dashboard sale, y con él casi se va un bucle

### 1 · Tesorería mantiene expedientes de proveedores
Editar un proveedor pedía **rol** de administrador o gerente. Tesorería es
justamente quien descubre lo que falta: al programar una transferencia se topa
con la CLABE vacía, con los días de crédito equivocados o con el RFC que nunca
se capturó. Mandarla a pedirle a un administrador que corrija cada dato es
garantizar que el dato se quede mal — y que la transferencia salga a la cuenta
de ayer.

Ahora es la capacidad `suppliers:manage`, que traen **tesorería y compras**. El
cajero no: no tiene nada que hacer en el padrón de proveedores.

*(Los XML del SAT ya estaban fuera de tesorería desde el cambio anterior: ese
menú depende de `auditoria`, que se le quitó entonces.)*

### 2 · El dashboard y el contrato, sólo para la dirección
El resumen del negocio —ventas, saldos, línea de crédito— no es información de
quien captura. Salió de los seis grupos operativos. El contrato pide ahora rol de
administrador **y** no estar acotado a un grupo: a un administrador limitado a
tesorería se le acotó el trabajo, y las condiciones comerciales con GDM no son
parte de él.

**Y aquí estuvo el riesgo de verdad.** `/dashboard` era el destino de TODOS los
rechazos y del login. Quitarlo de los grupos sin más habría dejado a seis de
siete **rebotando**: piden una pantalla, se les niega, se les manda al
dashboard, que también se les niega, y otra vez. No es un error visible en
ninguna parte — es un usuario que no puede entrar al sistema.

Por eso cada grupo tiene ahora **casa propia**: ventas llega a Facturas, almacén
a Existencias, tesorería a Tesorería, el cajero al Punto de Venta, RH a Nómina.
Que además es mejor que un tablero que no pueden usar. Hay un guardián dedicado
a que ninguna redirección vuelva a apuntar al dashboard a ciegas.

### 3 · Un módulo que existía y al que nadie podía llegar
La pantalla de **Equipo** —donde el administrador de una empresa da de alta a su
propia gente, con su grupo de trabajo— existía desde hacía tiempo: su ruta, su
alta de usuarios, su edición. Lo que no tenía era **entrada en el menú**.

Un módulo al que sólo se llega escribiendo la dirección es un módulo que no
existe. Ya está en el sidebar para el administrador de empresa, y con eso deja de
depender del super admin para cada usuario nuevo.

*Verificado:* 32 comprobaciones de grupos —incluidas que tesorería y compras
mantengan proveedores y el cajero no— y 28 de rutas y pantallas, con el guardián
del bucle entre ellas.

---

## 2026-08-19 (remesas) — Un botón gris que no dice por qué es un botón roto

"Programar pago" no respondía. El mecanismo estaba completo —elegir proveedor,
marcar facturas, poner fecha— pero la pantalla no decía nada de lo que faltaba.

### Tres cosas que juntas lo volvían indescifrable

**La numeración mentía.** Arriba se leía `1 · Proveedor` y `3 · Fecha`, y el
paso 2 vivía en una caja de abajo que **sólo aparecía al elegir proveedor**. Sin
proveedor, la pantalla mostraba los pasos 1 y 3 y ninguno en medio: parecía tener
un paso roto. Ahora el orden de la pantalla es el orden del trabajo —a quién,
qué, cuándo— y el paso 2 se ve siempre, en gris, diciendo qué va ahí.

**El botón callaba.** Deshabilitado, sin una palabra. Ahora dice a su lado
exactamente qué falta: elegir proveedor, o que ese proveedor no tiene nada que
programar, o marcar al menos una factura.

**Y el caso que de verdad atora:** una factura ya metida en una remesa —aunque
esté en BORRADOR— deja de contar como pendiente. Quien creó tres remesas y no
las autorizó se queda sin facturas que programar, y la pantalla decía sólo "no
tiene facturas pendientes sin programar", que suena a que falta capturarlas.

Ahora dice **dónde están**: *"Tiene 2 factura(s) ya incluida(s) en la(s)
remesa(s) #1, #3. Una factura sólo puede estar en una remesa: para moverla,
ábrela abajo y quítala de ahí, o cancela esa remesa."* Es la diferencia entre un
callejón sin salida y una instrucción.

*Verificado contra la base:* dos facturas pendientes, una entra a una remesa, y
queda una pendiente más otra reportada como "ya en remesa #1" con su folio. El
aviso dice la verdad porque sale del mismo dato.

---

## 2026-08-19 (permisos) — El frontend dejó de adivinar

Tesorería tenía el mismo síntoma que nómina: el usuario del grupo TESORERIA veía
su pantalla **sin el botón de pago manual ni el de programar remesas** — justo lo
que viene a hacer. El servidor sí lo dejaba pasar; era la pantalla la que no se
había enterado.

### La causa, que es la misma de las últimas tres veces
Cada pantalla escondía sus botones con **su propia regla sobre el rol**:
`['ADMIN','MANAGER','SUPER_ADMIN'].includes(user.role)`. Adivinar falla de dos
maneras, y las dos ocurrieron aquí:

- **Esconder de más.** Tesorería y Recursos Humanos viendo su pantalla sin un
  solo botón. No parece un problema de permisos —parece que el sistema no
  sirve— y por eso nadie lo reporta como lo que es.
- **Esconder de menos.** Ofrecer un botón que el servidor va a rechazar, y que
  el usuario descubre a clics.

Y hay algo que el frontend **no puede adivinar de ninguna manera**: los
otorgamientos individuales. Son renglones en la base —"a Laura le dieron aprobar
compras"— que sólo el servidor conoce. Cualquier regla escrita de ese lado nace
incompleta.

### La solución: preguntar
Se agregó `GET /auth/mis-capacidades`, que responde el conjunto **efectivo** —lo
que da el rol, más el grupo, más lo otorgado a mano— y el hook `useCapacidades`.
Las cinco pantallas ahora preguntan por la capacidad que su propio API exige:
`CAP.pagar` en tesorería, `CAP.nomina` en las cuatro de nómina.

Los administradores no esperan la respuesta: sin ese atajo, el primer render les
escondería los botones y aparecerían medio segundo después. Un parpadeo así se
lee como una falla, y lo sufriría justo quien más usa el sistema.

**Esto no es el candado.** Es la cortesía de no ofrecer lo que va a ser negado;
cada endpoint sigue verificando por su cuenta.

### Y se retiró el intento anterior
`puedeMoverNomina` —la regla que miraba rol y grupo, de hace dos horas— se fue
completa. Duró poco porque no podía saber de los otorgamientos individuales: era
una cuarta copia de las reglas, y el problema de fondo eran las copias.

El guardián ahora comprueba que **ninguna de las cinco decida por el rol**, que
las cinco pregunten la capacidad correcta, y que no quede la regla vieja dando
vueltas.

*Verificado:* las capacidades efectivas resueltas de verdad contra la base para
los cuatro grupos —TESORERIA sale con `treasury:pay`, RECURSOS_HUMANOS con
`nomina:manage`— más 29 comprobaciones de grupos, 19 de rutas y pantallas, y la
suite completa.

---

## 2026-08-19 (nómina) — De rol a capacidad, sin abrirle la puerta a nadie

La nómina estaba cerrada con `authorize('ADMIN','SUPER_ADMIN')`. Consecuencia:
**Recursos Humanos —el departamento cuyo trabajo ES la nómina— veía las
pantallas en sólo lectura**, y para que capturaran una quincena había que
hacerlos administradores de la empresa entera. Es decir: para darles nómina
había que darles todo.

Ahora es la capacidad **`nomina:manage`**, que trae el grupo RECURSOS_HUMANOS y
que cualquier administrador puede otorgar sin cambiar a nadie de grupo. 25 rutas
de nómina más el alta en bloque desde XML.

### Lo que el cambio pudo abrir sin querer, y no abrió
Un MANAGER hereda **todas** las capacidades operativas. Pasar la nómina de rol a
capacidad la habría abierto de golpe a **todos los gerentes** sin que nadie lo
pidiera: el gerente del almacén viendo sueldos, CURP, cuentas bancarias y
órdenes de pensión alimenticia. Antes no podía —`authorize` lo dejaba fuera—, y
ese candado no se podía perder al mover la cerradura.

Por eso existe `NO_HEREDA_MANAGER`: una lista corta de capacidades que **no se
heredan por rango**. Un MANAGER que sí deba manejar nómina la recibe por su
grupo o por otorgamiento — por decisión, no por jerarquía. Hay una prueba
dedicada a esto, y es la que más vale del lote.

### El candado que se había movido, no quitado
Las cuatro pantallas de nómina escondían sus botones con `role === 'ADMIN'`. Con
el servidor ya dejando pasar a RH, la pantalla les habría seguido sin mostrar un
solo botón: el problema cambiaba de lugar en vez de resolverse.

Ahora preguntan por `puedeMoverNomina`, que aplica la misma regla. **No es el
candado** —quien manda es el servidor, y quien llegue por URL igual recibe un
rechazo—: es la cortesía de no ofrecer lo que va a ser negado.

No se partió en "capturar" y "cerrar" como en compras: aquí no habría a quién
darle una sin la otra —el grupo entero es el departamento de nómina, y una
nómina capturada y sin cerrar no le paga a nadie—. Quien deba revisar antes de
cerrar lo hace mirando la prenómina, que para eso existe.

*Verificado:* 29 comprobaciones de grupos —siete nuevas de nómina, incluidas que
el gerente de almacén NO entre y que el de RH sí— más 17 de rutas y pantallas, y
la suite completa.

---

## 2026-08-19 (super admin) — Grupos que ven sin poder, y uno que ni existía

### 1 · "workGroup inválido" — el grupo existía; la lista no se enteró
El combo ofrecía **Recursos Humanos (sólo nómina)**, el usuario lo elegía, y el
servidor lo rechazaba. El grupo estaba definido, sus permisos escritos, y el
CHECK de la base lo aceptaba. El único que no sabía de él era **un renglón**:

```ts
const VALID_WORK_GROUPS = ['ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA'];
```

Una lista escrita a mano que duplicaba otra que ya existía, y que se quedó en
cinco cuando el mapa llegó a siete. Ahora **se deriva** de `GROUP_MODULES`:
agregar un grupo al mapa lo hace válido aquí solo. Lo mismo le pasaba a Punto de
Venta.

### 2 · Ver la pantalla sin poder hacer nada
Éste es el que de verdad se sufría, y no suena a permisos: **suena a que el
sistema no sirve**.

Un usuario del grupo TESORERIA veía su pantalla y no podía programar un solo
pago. Todos los endpoints de escritura piden `treasury:pay`, y esa capacidad no
está en la base de un USER: había que otorgársela a mano, usuario por usuario, y
nadie lo sabía. La pantalla se abría, los botones estaban ahí, y al oprimirlos
salía "no tienes la capacidad requerida". El cajero igual: grupo PUNTO_VENTA sin
poder cobrar.

La causa de fondo era que **el grupo decidía qué se VE y no qué se PUEDE**. Ahora
cada grupo declara sus capacidades —`GROUP_CAPABILITIES`— y se suman a las
individuales, no las reemplazan: un ADMIN puede seguir elevando a alguien con un
permiso puntual sin cambiarlo de grupo.

El grupo se lee de la **base** y no del token, así que cambiar a alguien de grupo
surte efecto en la siguiente petición y no cuando expire su sesión. Es el mismo
criterio que ya seguían los otorgamientos, y se resuelve en **una sola consulta**
—preguntar por separado sería un viaje más a la base en cada petición
protegida—.

Cada grupo trae lo que su nombre promete y nada más: **Compras captura órdenes
pero no las aprueba**. Aprobar es un segundo par de ojos, y si el mismo que
captura aprueba, deja de serlo.

### 3 · Dos recortes de alcance
- **Compras** ya no ve el módulo de Almacén: pide y recibe, no administra
  existencias. Lo que necesita saber —qué falta— lo tiene en Faltantes, que vive
  en su propio módulo. *Se verificó antes de recortar que no rompiera la
  recepción de mercancía:* `requireModule` sólo protege nómina, POS y el
  súper-importador, así que el mapa gobierna el menú, no el API.
- **Tesorería** ya no ve Auditoría: cotejar lo que el SAT dice de nuestros
  comprobantes es otro trabajo y otra persona.

### 4 · Alta de usuarios desde la empresa
Un botón por renglón en el listado de empresas. Antes había que irse a Usuarios
y buscar la empresa en un combo de cincuenta — que es donde se cuela el usuario
dado de alta en la empresa equivocada. El modal es el **mismo**, exportado y no
copiado; con la empresa **fija y bloqueada**, porque entrando desde el renglón
de una empresa, elegir otra sólo puede ser un error.

*Verificado:* 22 comprobaciones nuevas, incluidas las dos que importan —que
tesorería SÍ pueda programar pagos y que NO pueda aprobar compras— más que
cambiar de grupo surta efecto sin volver a entrar, y que lo otorgado a mano se
sume al grupo en vez de pisarlo. Con las 115 unitarias y el resto de la suite.

---

## 2026-08-19 (cierre) — "XML del SAT" con menú propio

La descarga de XML era la **segunda pestaña** de Auditoría. Para llegar había
que entrar al módulo y buscar la pestaña: dos clics, varias veces al día, para
una pantalla que se abre, se deja pedida y se vuelve a ver si ya llegó.

Ahora tiene **menú propio** con dos entradas —**XML recibidos** y **XML
emitidos**—, porque son consultas distintas al SAT: el servicio las pide por
separado y responden preguntas distintas. Los recibidos son lo que hay que
pagar y deducir; los emitidos, la comprobación de que todo lo timbrado llegó
allá. Cada entrada abre la pantalla en su dirección, y el selector sigue
disponible: a veces se entra por un lado y se termina pidiendo el otro.

**Auditoría quedó como estaba**, con sus tres pestañas. La descarga sigue ahí
adentro para quien llegue por ese camino — y es el **mismo componente**, no una
copia. Dos copias de una pantalla que habla con el SAT terminan divergiendo
justo en el manejo de errores, que es lo último que alguien revisa.

El acceso duplicado desde **Tesorería** se quitó: con la entrada de primer nivel
ya no aportaba nada, y dos renglones del menú que llevan al mismo lado obligan a
preguntarse si son lo mismo. Con él se fue la maquinaria de "atajos" del
`NavGroup` —quince líneas para un caso que dejó de existir—.

**Y el guardián.** Son cuatro piezas en cuatro archivos —la ruta, la lectura de
la dirección en la página, el prop que la recibe en el componente, y el destino
de los enlaces— unidas por cadenas de texto. Si una se mueve sin las otras, el
submenú abre la pantalla equivocada sin que nada falle.
`revisar-rutas-auditoria.mjs` lo detecta.

*Verificado:* 14 comprobaciones de rutas, enlaces y dirección, más las 115
unitarias. La revisión visual del sidebar queda pendiente: la aplicación pide
credenciales y no las tengo.

---

## 2026-08-19 (tarde-noche) — El 500 disfrazado, las fechas, y la hoja de remesa

### 1 · Los complementos de pago "no existían" — y sí existían
La pantalla decía **"Todavía no hay complementos de pago"**. No era cierto: la
consulta **reventaba en el servidor** y la lista salía vacía.

El `ORDER BY` sacaba los dígitos del folio con `regexp_replace` para ordenarlo
como número, dando por hecho que `folio` era texto tipo "P-000005". No lo es:
`payments.folio` es **integer**. Con eso, `COALESCE(p.folio, '')` obligaba a
Postgres a convertir `''` a entero y la consulta fallaba **siempre**, hubiera o
no complementos. Siendo entero, ordenarlo es ordenarlo: sin conversiones.

**Lo más grave no era el error, era el disfraz.** Un 500 que se ve como "no hay
nada" no lo reporta nadie, porque parece la verdad. La pantalla ahora distingue
las dos cosas y lo dice con todas sus letras: *"esto NO significa que no haya
complementos: significa que no se pudieron leer"*.

De paso apareció un segundo defecto latente en la misma línea: `'\D'` dentro de
un template literal de JavaScript pierde la barra y llega a Postgres como `'D'`
—habría borrado las letras D en vez de los no-dígitos—.

### 2 · Todas las fechas del sistema en DD/MM/AAAA
Había tres formatos conviviendo: `toLocaleDateString('es-MX')` → "19/8/2026" sin
ceros, el ISO crudo → "2026-08-19", y `<input type="date">` que lo dibuja el
**navegador** con el formato del sistema operativo. Tres formatos en la misma
pantalla obligan a leer cada fecha dos veces para saber cuál es el día.

Se hizo `utils/fecha.ts` con un solo formato, y se barrió todo: **27 lugares
donde se muestran** en 20 archivos, y **18 campos de captura** convertidos a
`CampoFecha`. Quedan cero `<input type="date">` sueltos.

**El detalle que importa:** una fecha de calendario como "2026-08-19" se parte a
mano y NO se pasa por `new Date()`. Ese constructor la lee como medianoche UTC,
y en México la convierte en el 18. Un vencimiento o una fecha de ingreso se
recorrerían un día entero.

### 3 · Por qué la descarga del SAT no avanza
Dos cosas, y sólo una es de código:

**La de configuración:** el motor corre solo cada 15 minutos **únicamente si
existe `ENABLE_SAT_DESCARGA_CRON=true`**. Sin esa variable en el entorno, los
trabajos se quedan en "en proceso" para siempre. No es un error; es un
interruptor que nunca se encendió.

**La de código:** un trabajo con 0 de 3 solicitudes puede ser "nadie lo ha
empujado" o "el SAT lo está rechazando", y la pantalla los mostraba igual. El
`mensaje_sat` de cada partición se guardaba desde el primer día y **nunca salía
de la base**. Ahora sale, junto con los intentos y la hora del próximo.

### 4 · La remesa, en una hoja
Quien autoriza firma un papel, no una pantalla. Y quien captura las
transferencias necesita **la CLABE junto al importe**: separarlos obliga a
cruzar la vista entre dos columnas lejanas, y ahí es donde se transfiere el
monto de un proveedor a la cuenta de otro.

Lleva el total por proveedor y el de la remesa, marca las vencidas, avisa de los
proveedores **sin datos bancarios** —esos no se pueden transferir— y trae las
tres firmas. Y dice que **no es un comprobante fiscal**: un papel que se parece
a un CFDI sin serlo termina archivado como si lo fuera.

### 5 · Correo: marcar todo de un clic
Con dos notas de crédito y tres complementos son diez casillas. El atajo marca
todo lo que se puede mandar: los PDF siempre, y los XML **sólo de lo timbrado**
—un XML sin timbrar no ampara nada y mandarlo invita a registrarlo—.

Y se dice algo que faltaba: la **Carta Porte no es un adjunto aparte**. Es un
complemento dentro del CFDI, así que ya viaja en el XML y en el PDF. Sin decirlo,
alguien la busca en la lista y cree que falta.

### 6 · Carta Porte: dos arreglos de forma
El botón **Guardar** también al final. Arriba sigue estando —en un formulario
corto es el que se usa— pero éste tiene diez secciones, y quien termina de
capturar el último contenedor marítimo está a una pantalla de distancia del
botón. Subir a buscarlo es donde se pierde la captura. Es el MISMO `save`, no
una segunda ruta.

Y la **plantilla de aseguradora**, junto a su rótulo en vez de en la otra orilla:
con la fila completa de por medio, la vista salta de un extremo al otro para
relacionar "aseguradora" con "cargar plantilla".

*Verificado:* el PDF de remesa generado de verdad y abierto (12.8 KB, cabecera
%PDF-), `listPayments` devolviendo el complemento que antes reventaba, y las
217 comprobaciones de nómina y compras más las 115 unitarias.

---

## 2026-08-19 (compras) — La deuda que se perdía, el aviso temprano

### 1 · La mercancía entraba y la deuda no
Al recibir sin capturar la factura, el sistema avisaba y seguía. Pero había un
caso peor y silencioso: **el proveedor no está dado de alta**. Darlo de alta
completo pide RFC, régimen fiscal y domicilio —datos que no trae el repartidor
que está esperando— así que en la práctica se recibía sin factura y la cuenta
por pagar no se capturaba nunca. Nadie la reclama hasta que el proveedor llama,
y para entonces ya venció.

Ahora existe el **preregistro**: nombre y días de crédito, nada más. Alcanza
para lo único que urge, que es que la deuda exista, tenga acreedor y tenga
vencimiento. Se completa después, sin prisa.

**El precio, dicho en voz alta:** un preregistro no sirve para nada fiscal. Le
falta el RFC, así que no se le puede timbrar un complemento de pago. Va marcado
con `es_preregistro` y hay un endpoint para perseguirlos —"qué proveedores
están a medias"— porque si no, uno se queda así un año.

**Por qué el RFC lleva "SINRFC-".** La columna es NOT NULL y su índice único lo
usa el `ON CONFLICT` de la descarga masiva del SAT; aflojarlo rompería aquello.
El marcador no se puede confundir con un RFC, es único, y cualquier validación
lo rechaza — que es justo lo que debe pasar si alguien intenta timbrar con él.

**Y lo que se cuidó al hacerlo:** capturar "Aceros del Norte" en dos recepciones
distintas crearía dos proveedores con la deuda repartida, y el saldo de ninguno
sería el real. Se busca por nombre antes de crear —sin acentos ni mayúsculas—
y entre TODOS los proveedores, no sólo los preregistros: si el de la factura ya
estaba dado de alta completo, se usa ése.

*Un detalle que sólo apareció al probar:* la comparación sin acentos usaba
`unaccent`, con un `catch` para cuando la extensión no está. Pero una consulta
que falla DENTRO de una transacción la aborta entera — no hay "intentar y si no,
la otra". La recepción se caía por un detalle de comparación de texto. Se
cambió a `translate`, que siempre está.

### 2 · Se captura el TOTAL, no el subtotal
Quien tiene la factura en la mano lee la cifra grande, no la base. Ahora se
captura el total y el subtotal se deriva con la tasa. Y los **días de crédito
van por factura**: el mismo proveedor da 30 días en la mercancía de siempre y
contado en un pedido especial.

### 3 · Faltantes: dos unidades de aviso
Enterarse al TOCAR el mínimo es enterarse tarde — el proveedor no entrega el
mismo día, y entre que se pide y llega, el producto ya se agotó.

Se agregó un cuarto escalón, **"llegando al mínimo"**, para lo que anda hasta 2
unidades arriba. Va en amarillo claro y no en ámbar: si el aviso se ve igual que
el faltante real, deja de avisar. El margen se puede mover con `?margen=`, y con
0 se comporta exactamente como antes.

De paso, esas sesenta líneas de SQL salieron del handler a `faltantes.service`:
adentro de la ruta no había forma de probar la regla del margen con números.

### 4 · Cambiar de proveedor sin salirse de la orden
Cambiar a media orden es normal —el que surtió la vez pasada no tiene
existencia, tarda tres semanas o subió el precio—. Si el nuevo no estaba en el
catálogo, la única salida era irse a darlo de alta completo y volver, perdiendo
lo capturado. Ahora se da de alta y se asigna **en un solo gesto**: separarlo en
dos pasos es donde se pierde el hilo — se crea, se olvida asignarlo, y la orden
sigue sin proveedor.

*Verificado:* 18 comprobaciones nuevas —incluidas que el mismo nombre no
duplique proveedor, que la línea de crédito se consuma, que una factura genere
una sola deuda, y los cuatro escalones del margen— más las 185 de nómina y las
115 unitarias.

---

## 2026-08-19 (tarde) — Los timbres que faltaban, el uniforme que se cobra, y las fechas

### 1 · El contador de timbres ignoraba la nómina
Contaba facturas, notas de crédito y pagos. Un recibo de nómina timbrado gasta
un timbre igual, y no estaba: el tablero decía **0 / 200** mientras el mes se
llevaba ochenta recibos, y el tope se descubría al rebotar el timbrado.

Se cuentan por `timbrado_at` y no por la fecha del periodo: el timbre se gasta
el día que se manda al PAC. Una nómina de julio timbrada en agosto la paga
agosto.

### 2 · El uniforme con costo se descuenta solo
Antes `costo` era un dato suelto "para poder descontarlo", con la nota de que
había que capturar la deducción a mano. En la práctica eso es acordarse de
hacerlo **y acordarse de no volver a hacerlo** el periodo siguiente. Lo segundo
es lo que falla.

Ahora: costo mayor que cero → se descuenta una vez, en el primer periodo que
cierre a partir de la fecha desde la que aplica, con la clave **017** del Anexo
20 (adquisición de artículos de la empresa; no la 016, que es para daños).
Costo cero → no hay descuento, que es el caso normal.

**Lo que hace que no se cobre dos veces** es guardar EN QUÉ periodo se cobró, no
un "ya se cobró". Un booleano no dice dónde, y cuando alguien reclama no hay qué
enseñarle; con el periodo se sabe, y si ese periodo se reabre el descuento
vuelve a quedar pendiente solo. El marcado va dentro de la misma transacción del
cierre, por el mismo motivo que los abonos de préstamos.

Y hubo un detalle que sólo apareció al probarlo: el origen del descuento se
perdía en el motor, que reconstruye cada deducción con sólo clave, concepto e
importe. La prueba lo atrapó —cobraba dos veces— antes que cualquier usuario.

### 3 · Desde cuándo aplican la pensión y el INFONAVIT
Los dos se guardaban como una regla sin fecha, así que aplicaban desde siempre.
Un oficio de pensión notificado el 10 de septiembre alcanzaba a la quincena que
corrió del 1 al 15 de agosto: eso es retener sin orden que lo respalde, y
devolverlo después ya no es un ajuste de nómina.

Se compara contra el FIN del periodo: si la orden llegó a media quincena, esa
quincena ya se retiene. Sin fecha capturada aplica desde siempre — los
expedientes que ya existen no cambian de comportamiento de un día para otro.

### 4 · Todas las fechas en DD/MM/AAAA
`<input type="date">` lo dibuja el **navegador** con el formato del sistema
operativo, no el de la página: en una máquina en inglés pide `mm/dd/yyyy` y no
hay CSS ni atributo que lo cambie. En nómina eso no es estético — capturar 03/07
como "3 de julio" cuando el control lee "7 de marzo" mueve una fecha de ingreso,
y con ella la antigüedad, las vacaciones y el finiquito.

Se hizo `CampoFecha`: campo de texto con máscara, siempre dd/mm/aaaa, que hacia
afuera habla ISO. Valida que la fecha **exista** —"31/02/2026" son ocho dígitos
correctos y una fecha que no existe—. Doce capturas y ocho lugares donde se
muestran quedaron convertidos.

### 5 · Relación laboral, rediseñada
Era una rejilla de tres columnas donde casi todo ocupaba las tres: once combos
idénticos, del mismo ancho y del mismo color, sin nada que dijera dónde termina
un asunto y empieza otro. Para encontrar la CLABE había que leerlos todos.

Ahora son cinco bloques con la pregunta que responde cada uno, en el orden de
una contratación real: qué hace, cómo está contratado, cada cuándo se le paga,
cuánto gana, dónde se le deposita. Los combos de texto largo siguen a todo lo
ancho porque su contenido lo pide; los cortos van de a dos o tres.

### 6 · El tablero, con los cuatro descuentos
FONACOT y préstamos muestran saldo; el INFONAVIT y la pensión **no llevan
saldo** —no se acaban cuando se paga cierta cantidad, siguen hasta que el
instituto o el juzgado digan otra cosa— así que muestran la regla. Y sólo se
suma la parte de cuota fija: el porcentaje sale del SDI y los VSM del valor de
la UMI por los días, dos cosas que dependen del periodo.

*Verificado:* 15 comprobaciones nuevas del cobro de entregas y las fechas de
descuento —incluido que en el SEGUNDO periodo no se vuelva a cobrar—, 185 de
nómina en total y las 115 unitarias.

---

## 2026-08-19 — El foco que se perdía, la CIF, y a quién alcanza un especial

### 1 · No se podía escribir una palabra completa
`Campo` y `Selector` estaban definidos **dentro** de `EmpleadoModal`. Cada
render creaba un **tipo de componente nuevo**, así que React no tenía forma de
saber que el `<input>` de este render era el mismo del anterior: lo desmontaba
y lo volvía a montar. Un input recién montado no tiene el foco. Se escribía una
letra, el estado cambiaba, y el cursor se salía del campo.

Sacados al nivel del módulo, el tipo es siempre el mismo, React reutiliza el
nodo y el foco se queda donde está. El orden del tabulador ya era el de la
pantalla —lo da el orden del DOM—; lo que lo rompía era el remonte.

**Y había un segundo caso, en otra pantalla.** El guardián nuevo
—`revisar-componentes-anidados.mjs`— encontró el mismo defecto en el alta de
empresas. Lo interesante es lo que NO marcó: en `CompanyProfile` hay un helper
igualito, pero se llama como función (`{F('RFC','rfc')}`) en vez de como
etiqueta (`<F />`), y así el JSX se inserta en el árbol del padre sin crear tipo
nuevo. No tiene el problema. El guardián distingue los dos usos, porque mandar
a "arreglar" lo que ya está bien es su propia forma de hacer daño.

Existe como script y no sólo como comentario porque este error **no rompe la
compilación, no avisa en consola y sólo se descubre escribiendo**.

### 2 · Leer la CIF en el alta de trabajador
Se reusó el extractor que ya tenían los clientes (`/csf/extract`), en su rama de
**persona física**: RFC, CURP, nombre, apellidos y domicilio completo, doce
campos de un jalón. Si alguien sube la constancia de la empresa se le dice que
es una moral en vez de llenar el expediente con la razón social.

Lo leído queda marcado en ámbar, igual que lo que deduce el importador de XML:
el SAT genera el PDF con los valores como un solo bloque de texto
—"PROLONGACIONADORATRICES"— y hay campos que salen sin espacios. Marcados se
ven de un vistazo; sin marcar se guardan así.

### 3 · Quiénes entran a una nómina especial
Los especiales se pensaron para el aguinaldo y la PTU, que alcanzan a todos. Un
bono a un turno también es un especial, y ahí la rejilla traía a los ochenta:
quien lo cerrara generaba setenta y siete recibos de más, y deshacer eso es
borrar CFDI.

Ahora se eligen al crearlo, en un segundo paso —después del concepto, porque el
concepto es lo que dice a quién marcar—. **Sin lista, alcanza a todos**: es la
misma convención de antes, así que los especiales que ya existen no cambian, y
es lo que debe seguir haciendo el aguinaldo. Si están todos marcados se guarda
la lista *vacía* y no los ochenta ids: quien entre mañana debe caer en el
aguinaldo, y con la lista fija se quedaría fuera sin que nadie lo notara.

Cerrado el periodo ya no se puede cambiar: dejaría recibos sin dueño.

### 4 · Tres cosas más
- **El tablero** dice cuánto se descuenta por fuera del ISR y el IMSS: FONACOT y
  préstamos con su saldo y su abono por periodo, y la pensión alimenticia
  separando la de cuota fija de la de porcentaje —esta última se calcula sobre
  el neto de cada periodo, así que sumarla aquí sería inventar un número—.
- **Seleccionar todos para timbrar**, en el icono del sello del encabezado.
  "Todos" son los que NO tienen folio: uno ya timbrado no se vuelve a mandar.
- **El pie de la prenómina**, desahogado. Gravado, exento y subsidio eran parte
  de un renglón corrido junto a tres consejos de uso; ahora son tres cifras con
  su rótulo, y los consejos son pistas cortas aparte.

*Verificado:* 11 comprobaciones nuevas de participantes —incluida que un id de
otra empresa no se cuele—, 170 en total de nómina y las 115 unitarias.

---

## 2026-08-18 — La prenómina acumulada por trabajador

Pedir "de la semana 32 a la 34" y recibir **tres renglones de cada quien**
obliga a sumar a mano lo que el reporte ya sabe. El detalle por periodo estaba
bien —y sigue estando, a un clic—, pero no es lo que se ocupa cuando se cuadra
contra el banco o se revisa en la junta.

Ahora la prenómina abre **acumulada**: un renglón por trabajador con sus
periodos sumados, y un interruptor **Acumulado / Detalle** cuando el rango
abarca más de uno. Baja igual a Excel, con su columna PERIODOS y el título
diciendo de qué modo salió.

**Lo que acumular esconde, y por eso va marcado.** Si a alguien le falta una
semana —un alta a media quincena, una baja, una ausencia—, su acumulado sale
más chico y *parece* correcto. El renglón trae el conteo de periodos y se marca
en ámbar a quien no los trae todos, con un aviso arriba para que no dependa de
que alguien vea la marca.

Se agrupa por `num_empleado`, `nombre` y `rfc`, no sólo por el número: el
número es un dato capturado, y si dos personas compartieran uno, agrupar por él
solo las fundiría en un renglón sin que nadie lo notara.

*Verificado:* que cada trabajador sume **campo por campo** lo de sus recibos,
que el gran total sea idéntico por los dos caminos —si cambiara, uno de los dos
reportes estaría mintiendo— y que a quien le falta un periodo se le marque.
29 comprobaciones de reportes, 25 de estilo, 115 unitarias.

---

## 2026-08-18 — El formato de la casa en todos los reportes, y la cuota patronal

### 1 · Los reportes salían en blanco y negro
La prenómina ya usaba el formato "Lista de Raya" —el que la gente sabe leer— y
los cuatro reportes salían con la hoja pelona de SheetJS. Se leyeron las celdas
del archivo que entregó Antonio (`FORMATO A USAR PARA PRENOMINA.xlsx`) una por
una —fondos, tipografía, tamaños y formato de número— y se pusieron en un solo
lugar: `estilo-excel.ts`. Los colores no son adorno: en una tabla de veinte
columnas separan de un vistazo lo que entra, lo que se descuenta y el neto.

**Y el detalle que casi cuesta el trabajo dos veces:** SheetJS en su versión
libre *acepta* los estilos, no marca error y los **tira al guardar**. La hoja
salía perfecta en datos y en blanco y negro. Por eso se cambió a **ExcelJS** y
por eso `probar-estilo-reportes.ts` vuelve a **abrir** el archivo generado y
comprueba el color celda por celda: un estilo que se ignora en silencio no lo
detecta ningún `tsc`.

### 2 · La cuota patronal, para provisionar
El reporte del IMSS traía sólo la cuota **obrera** —la que se le retiene al
trabajador— y decía que la patronal "no la calcula este sistema". Contabilidad
provisionaba a ojo. Ahora se calcula rama por rama, que es como se captura la
provisión: una cuenta por rama y no un solo importe.

  Cuota fija (106-I) · Excedente de 3 UMA (106-II) · Prestaciones en dinero
  (107) · Pensionados (25) · Invalidez y vida (147) · Riesgos de trabajo
  (71-73) · Guarderías (211) · Retiro (168-I) · Cesantía y vejez (168-II)
  · INFONAVIT 5%

Tres decisiones que valen más que el código:

- **Cesantía y vejez no es una tasa: es una escala.** Depende de cuántas UMA
  gana cada quien y **sube cada año hasta 2030** por la reforma de pensiones
  (Art. Décimo Noveno Transitorio, DOF 16/12/2020). 2026 es el cuarto escalón:
  3.150% al mínimo, 7.513% arriba de 4 UMA. Está en tabla, con su fuente.
- **Sin prima de riesgo capturada, esa rama va en CERO y se avisa.** No se
  inventa una prima "típica": la autoriza el IMSS con la siniestralidad de
  *esta* empresa. Una provisión corta a sabiendas es mejor que una corta sin
  saberlo.
- **Quien está exento de cuota obrera SÍ genera patronal.** El Art. 36 LSS no
  perdona la cuota: se la **traslada al patrón**. Por eso esa columna nunca
  dice "exento".

Y va dicho en la pantalla y en el Excel: **es una estimación**. El IMSS liquida
con SUS registros y SU prima autorizada. Lo que se paga es lo que emita el SUA.

*Verificado:* 23 comprobaciones de estilo leyendo los archivos de vuelta, 22 de
reportes —incluidas las que checan que las nueve ramas sumen el total y que
IMSS + INFONAVIT sea el total a provisionar—, 127 de nómina en total y las 115
unitarias.

---

## 2026-08-13 — Seis correcciones: moneda, saldo, complemento, 69-B, filas y contrato

### 1 · El importe con letra decía "M.N." en euros
Había **dos** copias de `montoEnLetra`: una en `pdf.service` (facturas) y otra en
`pdf-helpers` (notas de crédito y complementos de pago). Al corregir el sufijo de
moneda se arregló una sola, así que las facturas en euros quedaron bien y los
complementos siguieron diciendo "M.N.". Ahora hay **una**, en `pdf-helpers`, que
usan los tres; se borraron 76 líneas duplicadas. *Una función duplicada no se
arregla dos veces: se arregla una y se olvida la otra.*

### 2 · El saldo del cliente no se actualizaba
El listado leía `customers.balance`, columna que sólo cambia si alguien llama
`updateCustomerBalance()`. Basta un pago o una nota de crédito que no la llame
para que muestre un saldo viejo. Ahora se **calcula** en la consulta, restando
pagos (desde `payment_invoices`) y notas de crédito timbradas. Se aliasa como
`saldo_calculado` y no como `balance`, porque `c.*` ya trae la columna vieja y
dos columnas con el mismo nombre dejan al driver decidir cuál gana.

**Verificado con datos reales**: la columna decía 14,566.00 y el saldo real era
14,616.00.

### 3 · El complemento de pago con varias facturas reportaba una
El XML timbrado ya declaraba todos los `DoctoRelacionado`; el **PDF** leía
`payments.invoice_id` —una sola— y se imprimía como si el depósito cubriera una
factura. El comprobante estaba bien y el papel mentía: el cliente no podía
cuadrar su estado de cuenta con lo que recibió.

Ahora el PDF lee `payment_invoices` y pinta una fila por documento, con renglón
de total cuando son varias. Los saldos y la parcialidad se toman **tal como se
timbraron**, no se recalculan: hacerlo hoy daría cifras distintas a las del XML
que el cliente ya tiene.

**Verificado** generando el PDF de verdad y leyendo su texto: con dos facturas
aparecen los dos folios, el renglón "2 facturas" y la suma de importes.

### 4 · Tercera pestaña: listas del 69-B del CFF
Padrón nacional en `sat_69b` (global, no por empresa: el mismo RFC está en la
lista para todos) y bitácora de cargas, para que "la lista está al día" sea una
fecha y no una creencia.

**Las cuatro situaciones no significan lo mismo** y la pantalla las separa:
DEFINITIVO quita efectos fiscales a los comprobantes —30 días para corregir o
acreditar materialidad—; PRESUNTO sigue en plazo de aclarar; DESVIRTUADO y
SENTENCIA FAVORABLE ya salieron. Pintar todo de rojo "por si acaso" habría hecho
inservible la pantalla.

**La lista se carga, no se adivina**: del archivo que publica el SAT. Las
columnas se localizan por NOMBRE de encabezado y no por posición —el SAT ha
cambiado el orden entre publicaciones y un importador atado a la posición carga
los datos corridos sin avisar—. Se lee en latin1 porque el SAT publica en
Windows-1252 y los acentos llegaban con rombos.

El cruce muestra cuánto se ha operado con cada uno: saber que un proveedor está
en la lista no dice si el problema son mil pesos o un millón.

**Verificado** con un archivo que imita el real —títulos antes del encabezado,
nombres con comas entre comillas, situaciones escritas de varias formas y
renglones basura—: 4 válidos, 3 ignorados, el nombre con coma íntegro,
reimportar no duplica, el cruce encuentra al tercero sembrado, y un archivo
ajeno se rechaza con su motivo.

### 5 · Filas más delgadas
`py-4`/`py-3` → `py-2` en las celdas de Facturas, Notas de Crédito, Complementos
y Productos. Sólo dentro de `<td>`/`<th>`: los mensajes de "no hay registros"
conservan su altura, porque un aviso centrado en un renglón delgado se ve como
un error de maquetación.

### 6 · El contrato, sólo para el ADMIN
El menú ya lo escondía, pero esconder no es impedir: cualquiera llegaba
tecleando `/contract`. Firmarlo ya estaba cerrado en el backend
(`requireCompanyAdmin`); ahora también verlo. Se reutilizó el guard
`CompanyAdminRoute` que ya existía para Equipo — al escribir uno nuevo me di
cuenta de que estaba duplicando el que ya había.

Los puntos 1, 5 y 6 se aplicaron también a GDM Facturación.

---

## 2026-08-12 (tarde) — Control de edición: el segundo ya no borra al primero

### Contexto
La presencia (2026-08-11e) avisa que alguien más tiene el documento abierto.
Sirve para que se pongan de acuerdo, pero es un letrero: si los dos guardan, el
segundo sigue pisando al primero y nadie se entera. **Avisar del riesgo no es lo
mismo que impedir el daño.**

### Cómo funciona
Cada documento lleva un contador. El formulario lo recibe al abrirlo y lo
devuelve al guardar; si ya no coincide, alguien guardó en medio y el guardado se
rechaza con un 409 en vez de sobrescribir.

**El contador se sube y se compara en la MISMA sentencia**
(`UPDATE … SET edicion = edicion + 1 WHERE id = $1 AND edicion = $2`). Hacerlo
en dos pasos —leer, comparar, escribir— dejaría una rendija entre la lectura y
la escritura por la que se cuela justo lo que se quiere evitar.

**Y va dentro de la transacción del guardado.** Si el UPDATE de los datos falla
después, el contador vuelve atrás con él; un contador que sube por un guardado
que no ocurrió obligaría a recargar sin motivo.

### Decisiones

**Se llama `edicion`, no `version`.** `carta_porte.version` ya existe y guarda
"3.1", la versión del complemento del SAT. Reusar el nombre habría mezclado dos
cosas sin relación, y un día alguien habría incrementado la versión del
complemento creyendo que llevaba la cuenta de las ediciones.

**Arranca en 1, no en 0.** Un contador en cero se confunde con "no tiene
contador" en cuanto pasa por un JSON o un COALESCE.

**Sin número no se compara.** Los procesos internos —el importador de XML dando
de alta un cliente, el cierre del POS— no vienen de un formulario y no tienen
nada que devolver. Exigírselo sólo los rompería sin proteger a nadie: la
protección es para la edición humana, que es donde alguien pierde media hora.

**La Carta Porte lleva el contador de la FACTURA.** Guardarla es un reemplazo
total —se borra y se inserta de nuevo—, así que el renglón cambia de id en cada
guardado y no hay nada estable a lo que colgarle un contador. La factura sí es
estable, y además es el documento del que la Carta Porte forma parte.

**Documento borrado ≠ conflicto.** Cuando el UPDATE no toca nada se relee para
distinguir: decirle "hubo un conflicto" a quien abrió un documento que alguien
borró lo mandaría a buscar un choque que nunca pasó.

### Dónde quedó cableado
Clientes, productos y Carta Porte. La columna ya existe también en `invoices` y
`purchase_orders`, así que extenderlo a esas pantallas es cablear el parámetro,
no volver a diseñarlo.

### Verificación
Seis casos contra Postgres local: guardar con el número correcto sube el
contador; guardar con uno viejo se rechaza **y los datos del primero quedan
intactos**; tras recargar, el mismo guardado sí entra; sin número guarda (proceso
interno); **dos guardados simultáneos con el mismo número → uno gana, el otro
recibe el aviso**; y un documento borrado responde "no encontrado".

### Hallazgo al pasar
En el formulario de Carta Porte, el encabezado leía `invoice.folio` sobre la
respuesta envuelta de la API, así que el folio nunca se mostraba y siempre caía
al respaldo de mostrar los primeros ocho caracteres del id. Corregido.

---

## 2026-08-12 — Motor de descarga masiva del SAT (sólo NEXO)

Base: `DESCARGA_MASIVA_SAT_Y_SERVICIOS.md`. Va **sólo en NEXO** por decisión de
Antonio: facturación ya quedó funcional con lo que tiene, y NEXO es el que va a
cargar nómina y contabilidad, que es donde estos XML hacen falta.

### Qué resuelve, y por qué no bastaba Auditoría
Auditoría pregunta por comprobante: "este UUID, ¿sigue vigente?". Sirve para lo
NUESTRO, que ya está en la base. De lo que nos emitieron no sabemos ni siquiera
qué existe, y eso sólo se trae con el servicio de descarga masiva: e.firma,
lotes asíncronos, se pide, se espera, se recoge.

### Decisiones

**e.firma cifrada con llave maestra aparte (`SAT_VAULT_KEY`).** No se reutilizó
`ENCRYPTION_KEY` —la de los CSD— porque ata dos secretos de gravedad distinta:
una contraseña de sello se reemplaza pidiendo otro CSD; la llave privada de la
e.firma tiene efectos de firma autógrafa. Si falta la variable, el módulo NO
arranca: una bóveda con llave por omisión da la impresión de proteger algo.
**No existe ninguna ruta que devuelva el .cer, el .key ni la contraseña.**

**Se valida antes de mandar nada.** El SAT responde 300/305 —"revisar
identidad", "tipo de certificado"— sin distinguir entre archivo corrupto,
contraseña mala, certificado vencido y **haber subido el CSD en vez de la
e.firma**, que es el error más común porque están en la misma carpeta. Se
separan las cuatro leyendo el certificado: la e.firma declara cifrado de datos
en su uso de llave; el CSD sólo firma y no repudia.

**Sin librería de SOAP, a propósito.** Lo difícil no es el sobre sino la firma:
el SAT valida XML-DSig con canonicalización exclusiva, y las bibliotecas
genéricas re-serializan el documento —reordenan atributos, mueven espacios— y la
firma deja de cuadrar por un carácter. Construyendo la cadena a mano, lo que se
firma es exactamente lo que viaja.

**Los endpoints son configurables por variable de entorno**, como pide §24 del
documento: las URL de los ejemplos del SAT cambian.

**Partición adaptativa**: bloques de 7 días; ante el código 5003 ("pasa del
tope") el rango se parte a la mitad, hasta 4 niveles —de 7 días a ~10 horas—.
Más abajo el problema deja de ser el tamaño y se pide revisión humana en vez de
inundar al SAT con cientos de solicitudes diminutas. Cada partición lleva una
**huella** de sus parámetros: el SAT rechaza solicitudes duplicadas.

**Prioridad al recoger, no al pedir** (§8): primero los paquetes listos —vencen
a las 72 h—, luego verificar lo viejo, y sólo al final mandar solicitudes
nuevas. Crear más trabajo cuando hay paquetes por vencer es la forma más fácil
de perderlos.

**Lector de ZIP propio, con topes.** Un paquete del SAT es un ZIP simple y leer
su índice son cuarenta líneas con `zlib`; traer una dependencia nueva a
producción para eso cuesta más de lo que ahorra. Tres topes —por archivo, por
paquete y en número de archivos— revisados ANTES de descomprimir, leyendo el
tamaño declarado en el índice. Y la defensa más fuerte contra Zip Slip es que
**los XML nunca tocan el disco**: se leen a memoria y se guardan en la base.

**El cron NO viene encendido**, al revés que el de auditoría. Aquél sólo
pregunta; éste **actúa ante el SAT firmando con la e.firma de una empresa**. Un
motor que empieza a firmar solicitudes porque alguien desplegó una versión nueva
no es una comodidad, es una sorpresa. Se enciende con
`ENABLE_SAT_DESCARGA_CRON=true`.

### Verificación
Todo lo que se puede probar sin la e.firma real, contra Postgres local:

- **Bóveda**: ida y vuelta idéntica sobre datos binarios, y manipulación del
  registro detectada (falla en vez de devolver basura).
- **e.firma**: la extensión keyUsage leída del DER coincide byte a byte con lo
  que dice `openssl`; el CSD real del repo se **rechaza** con su motivo; una
  e.firma legítima se acepta; contraseña equivocada y .cer/.key de trámites
  distintos se rechazan por separado.
- **ZIP**: extrae los XML e ignora lo que no lo es; rechaza `../../../etc/...`
  y las rutas absolutas —con un ZIP malicioso fabricado a nivel de bytes,
  porque `archiver` sanea los nombres y no dejaba ejercer el guard—; y rechaza
  lo que no es un ZIP.
- **Indexado**: leyó un CFDI timbrado real de la base (tipo, emisor, receptor,
  total, moneda, fecha) y al repetirlo devolvió `false` — no duplica.
- **Particionador**: enero → 5 bloques de 7 días, con 5 huellas distintas.

### Lo que NO está verificado, y hay que saberlo
**El viaje al SAT.** Autenticación, solicitud, verificación y descarga están
implementadas conforme al documento, pero no se han ejecutado contra el servicio
real: eso exige la e.firma de la empresa, que no está cargada. La primera
corrida de verdad puede tropezar con detalles del sobre o con endpoints que
cambiaron, y para eso el sistema guarda el código y el mensaje del SAT en cada
partición.

---

## 2026-08-11 (noche, 4) — El estado de la ubicación se puede corregir

### El error que se reportó
Una ubicación de destino con **país USA y código postal 92231** —Calexico,
California— aparecía en **Veracruz**, con su "Clave SAT: VER" en verde, y el
campo Estado no dejaba cambiarse. Dos fallas encadenadas:

**1. El código postal se leía siempre con la tabla mexicana.** En México el 92
es Veracruz; en Estados Unidos el 92231 es California. `CPGeoBlock` llamaba a
`/carta-porte/cp/:cp` sin mirar el país de la ubicación, así que un domicilio
extranjero se resolvía como si fuera nacional. El dato no sólo estaba mal:
estaba mal **con aire de autoridad**, porque venía con la clave del SAT al lado.

**2. El campo era de sólo lectura.** En cuanto el CP resolvía un estado, el
input pasaba a `readOnly` "porque ya estaba inferido". Pero un CP se teclea mal,
o llega de una plantilla vieja, y entonces no había forma de corregirlo salvo
borrar la ubicación completa y capturarla otra vez. **Un dato deducido es una
propuesta, no una verdad**: se propone y se deja tocar.

### Lo que se cambió
- **Estado siempre editable**, y ahora es un combo con los estados del país:
  32 mexicanos, 52 de la Unión Americana, 13 provincias canadienses. Se elige
  por nombre y la clave del SAT viaja sola al XML — antes había que saberse que
  Texas es TX.
- **El CP se lee con la tabla del país**: México por el catálogo del SAT
  (colonias, municipio, localidad); el resto por los rangos de prefijo de
  `sat_cp_zip_estado`. 92231 con país USA ahora da **California**.
- **El autocompletado ya no pisa lo capturado**: sólo rellena el estado cuando
  está vacío. Antes se reescribía en cada resolución, que es la otra mitad de
  por qué no se podía corregir.
- **País pasa a ser combo.** Es lo que decide con qué catálogo se lee el código
  postal; tecleado a mano, un "EUA" en vez de "USA" dejaba la ubicación sin
  estados que elegir y sin ninguna explicación. Cambiar de país limpia el estado.
- El código postal admite letras y espacio fuera de México, y el rótulo
  "Municipio" se vuelve "Ciudad": el nodo del XML es el mismo, pero nadie en
  Laredo captura un municipio.

### Verificación
Contra la base: 92231 con país USA → **CA / California**; el mismo 92231 con
país MEX sigue dando **VER / Veracruz**, así que la ruta nacional quedó intacta.
Catálogos completos: MEX 32, USA 52, CAN 13.

Aplicado en **los dos productos**. El archivo no se copió: la versión de
facturación tiene el filtro de permisos SCT por modalidad y la de NEXO tiene el
aviso de concurrencia, así que el bloque se trasplantó y el resto se dejó como
estaba en cada uno.

---

## 2026-08-11 (noche, 3) — Concurrencia visible y mensajería interna

### #15 · Dos personas en la misma pantalla

**Lo primero fue comprobar, no construir.** Nada impedía ya que dos personas
trabajaran en el mismo módulo: los `FOR UPDATE` que hay viven dentro de
transacciones de milisegundos —descontar existencias, marcar un pago—, no
mientras alguien tiene un formulario abierto. No había ningún candado que
quitar.

El problema real era otro: dos personas abren la misma Carta Porte, cada una
captura veinte minutos y la segunda en guardar borra el trabajo de la primera
sin que ninguna se entere. **El daño no lo hace la concurrencia, lo hace no
verla.**

**Aviso, no candado.** Nueva tabla `presencia_edicion` con latido: cada pantalla
avisa que está abierta cada 30 segundos y caduca a los 90 sin latir —nadie
cierra sesión con el botón, se cierra la laptop—. Un candado real congelaría el
documento de quien se fue a comer, y acabaría necesitando un botón de "forzar"
que devuelve el problema al inicio.

`entro_at` define quién llegó primero y **no se toca al recargar**: si se
actualizara, la prioridad sería de quien más le da F5.

El nombre del remitente se resuelve dentro del mismo INSERT contra `users`,
porque el JWT sólo trae correo y el aviso tiene que decir "Antonio Bernal", no
"admin@gdmfac2.local" — y hacerlo con un SELECT aparte costaría una consulta
extra en cada latido de cada pantalla abierta.

Cableado en el formulario de Carta Porte (media hora de captura que otro puede
pisar) y en el detalle de órdenes de compra (uno aprueba mientras el otro
recibe).

**Verificación**: seis pruebas, todas correctas — los dos entran sin bloqueo,
cada uno ve al otro por su nombre, tres recargas del segundo no le quitan la
prioridad al primero, un latido viejo lo hace desaparecer, salir libera de
inmediato, y dos escrituras simultáneas al mismo registro terminan las dos sin
error de base: gana la última. **Eso último es exactamente lo que el aviso
advierte antes de que ocurra** — y es la limitación honesta de esta entrega: se
avisa, no se impide.

### #16 · Mensajería interna

**El análisis previo que se pidió.** `users` ya tiene todo: correo, nombre,
`company_id`, grupo y si está activo. El "mismo dominio" es, en los datos, el
mismo `company_id` — el alta hace que los usuarios de una empresa compartan
dominio porque el cajero hereda el de quien lo dio de alta. Filtrar por el texto
del correo dejaría fuera al contador externo que entra con su Gmail, que es
justo alguien a quien hay que poder mandarle un recado. La frontera es la
empresa, que además es la que ya respeta todo el sistema.

**No es chat ni correo**: sin adjuntos, sin grupos, sin borradores. Es el recado
que hoy se grita entre el almacén y la oficina o se manda por WhatsApp y se
pierde. Cada pieza extra trae su propia pantalla y su propia forma de fallar, y
ninguna hace que el recado llegue mejor.

El remitente se **congela** en el renglón (`de_nombre`, `de_email`): si esa
persona se da de baja, el mensaje sigue diciendo quién lo mandó, que es cuando
más falta hace saberlo.

`leido_at` se escribe **una sola vez** (`WHERE leido_at IS NULL`): volver a abrir
el mensaje no mueve la hora, que es el dato que alguien va a reclamar. Y se
marca al ABRIRLO, no al verlo en la lista — donde sólo se ve el asunto.

Está disponible para todos los grupos, incluido PUNTO_VENTA: "se acabó el rollo
de la impresora" tiene que poder salir de la caja. El contador del menú se
refresca cada minuto y al volver a la pestaña; no hay websocket, porque un
recado interno no es una notificación de chat.

**Verificación**: seis pruebas — enviar y recibir con el nombre congelado, el
contador, la hora de lectura que no se mueve al releer, y los tres rechazos que
importan: a otra empresa, a uno mismo, y mensaje vacío.

---

## 2026-08-11 (noche, 2) — Destinos internacionales: el ZIP dice el estado

### Contexto
En un domicilio mexicano basta teclear el CP y salen colonia, municipio y
estado. En uno de Laredo había que saberse que Texas es TX y teclearlo en un
campo de tres letras que estaba hasta abajo del formulario, junto a
"Referencia". Quien equivoca esa clave timbra un CFDI con un domicilio que no
existe.

### Decisiones

**Rangos de prefijo, no la tabla completa de ZIPs.** Los ~41,000 códigos
postales de Estados Unidos cambian cada mes; para saber el ESTADO basta el
prefijo, porque la USPS asigna los bloques por estado y esa asignación lleva
décadas estable. 63 renglones en vez de 41,000, sin mantenimiento.

**No se resuelve la ciudad, y se dice.** Saber que 78045 es Texas sale del
prefijo; saber que es Laredo exige la tabla completa. La pantalla lo anuncia
—"la ciudad se captura a mano"— en vez de dejar el campo vacío como si se
hubiera olvidado.

**Canadá entra incompleto a propósito.** La primera letra identifica la
provincia, salvo la X, que se reparte entre Territorios del Noroeste y Nunavut.
No se siembra: un autocompletado que acierta la mitad de las veces es peor que
ninguno, porque nadie revisa lo que el sistema ya llenó.

**El país subió al principio del bloque.** Estaba al final, y con él ahí quien
mandaba a Laredo llenaba el domicilio como si fuera mexicano; al llegar abajo ya
no había nada que corregir. Ahora es lo primero y cambia la forma del bloque:
con MEX, colonias del SAT; con cualquier otro, código postal alfanumérico,
estado en combo del país y ciudad libre. Cambiar de país limpia estado y
colonia — una clave mexicana en un domicilio de Texas es justo lo que el PAC
rechaza.

**El autocompletado no pisa lo capturado**: si alguien ya eligió el estado a
mano, la respuesta del resolvedor no lo sobreescribe.

`cp_lugares.codigo_postal` se ensanchó a 12 caracteres: 'SW1A 1AA' y 'K1A 0B1'
llevan letras y espacio.

### Verificación
18 casos contra la base, todos correctos: Laredo→TX, Beverly Hills→CA, el ZIP
00501 que empieza en cero→NY, Austin 73301→TX (la excepción dentro del bloque de
Oklahoma) contra Oklahoma City 73101→OK, El Paso 885→TX, Ottawa con espacio→ON,
Montreal con guion→QC; y los tres casos donde debe callar: correo militar,
Canadá con X y un país sin tabla.

### Hallazgo al portar
GDM Facturación filtra los permisos SCT por modalidad (backend y pickers) y NEXO
**no**: allá el selector de una Carta Porte marítima ofrece también los permisos
de autotransporte federal, y elegir uno produce un CFDI que el SAT rechaza. No
se tocó en esta entrega —es otro cambio— pero queda anotado.

---

## 2026-08-11 (noche) — Auditoría: lo que el SAT dice de nuestros comprobantes

### Contexto
Timbrar dejaba el CFDI marcado como timbrado aquí dentro, y ahí terminaba la
historia. Lo que pasara después en el SAT —una cancelación que solicitó el
receptor, un plazo vencido, un comprobante que allá está cancelado y aquí se
sigue cobrando— se descubría en la revisión anual, con el contador enfrente.

### Qué servicio se usa, y por qué ése
El `ConsultaCFDIService` del SAT: público, sin e.firma, sin cuota conocida.
Necesita RFC emisor, RFC receptor, total, UUID y los últimos ocho caracteres del
sello — que se sacan del `xml_content` timbrado. Es exactamente la pregunta que
hay que hacer y no obliga a custodiar la llave privada de nadie.

El motor de descarga masiva de `DESCARGA_MASIVA_SAT_Y_SERVICIOS.md` resuelve
otra cosa: traerse los XML que NOS emitieron. Eso sí necesita e.firma, cola de
paquetes, partición adaptativa y bóveda de credenciales. Se construye aparte;
mezclarlo habría metido el manejo de llaves privadas en una tarea que no lo
necesita.

### Decisiones

**Una tabla `auditoria_cfdi`, no columnas en cada tabla.** Se auditan tres
documentos —facturas, notas de crédito y complementos— y mañana los XML
recibidos. El comprobante se identifica por su UUID, que es como lo identifica
el SAT. Guarda el ÚLTIMO estado, no el histórico: un CFDI cambia de estado dos o
tres veces en su vida, y 200 revisiones idénticas por comprobante harían lenta
la única consulta que importa, "¿qué está mal hoy?".

**El cron corre a diario y toma los de más de 72 h.** Un cron de calendario
"cada 3 días" se desfasa en los meses de 31 y, si el servidor está caído ese
día, la revisión se pierde tres días. Así cada CFDI lleva su propio reloj, la
carga se reparte y un día perdido se recupera solo. A las 04:00: el servicio del
SAT es compartido con todo el país y de madrugada responde.

**Viene encendido, al revés que los demás crones.** Los otros son opt-in porque
mueven datos; éste sólo pregunta y anota. Apagado por omisión, la auditoría no
correría hasta que alguien recordara encender una variable, y la única señal
sería una pantalla en ceros idéntica a "todo está bien".

**Nunca escribe sobre el documento.** Si el SAT dice "Cancelado" y aquí está
vigente, se marca la DISCREPANCIA; no se cancela la factura. Cancelar mueve
inventario, saldos y CFDI relacionados: es decisión de alguien, no de un proceso
de madrugada.

**"No Encontrado" no es discrepancia.** El SAT tarda en publicar lo recién
timbrado y un CFDI de pruebas nunca aparecerá. En rojo llenaría la pantalla de
alarmas vacías y enterraría las dos que sí importan; se cuenta en su propia
columna del resumen.

**Complemento de pago con total 0.00.** El Anexo 20 obliga a que un tipo P lleve
Total en cero y el SAT compara contra eso; mandar el importe pagado devuelve "no
encontrado" y parece un CFDI perdido cuando sólo está mal la pregunta.

**Menú Auditoría** en la barra lateral (🛡️), visible para ADMIN_ALL y TESORERIA.
Es la casa del módulo: ahí vivirá la verificación de proveedores contra las
listas del 69-B del CFF. La respuesta `ValidacionEFOS` del SAT ya se guarda y la
pantalla avisa cuando es distinta de 100.

### Verificación
Contra el servicio real del SAT con los 5 comprobantes de GHC1707275Y0 (3
facturas, 1 nota de crédito, 1 complemento): las 5 consultas SOAP salieron y se
guardaron, el resumen pasó de 0 a 5 revisados, y la segunda corrida en modo
"sólo pendientes" devolvió 0 revisados — la ventana de 72 horas se respeta. Los
5 volvieron "No Encontrado" porque son timbres de sandbox: el SAT real no los
conoce, que es la respuesta correcta.

En GDM Facturación se portó el módulo completo y se comprobó columna por columna
que las cinco tablas que consulta la auditoría existen con esos nombres; ese
checkout no tiene base local, así que ahí la verificación fue de esquema y
compilación, no de ejecución.

### Pendiente que deja abierto
La descarga masiva (XML recibidos de proveedores) y con ella la pantalla de
comprobantes recibidos del mes. Es el motor completo del documento: e.firma,
particionador adaptativo, cola de paquetes y descompresión segura.

---

## 2026-08-11 (tarde) — Remesas de pago: la lista del viernes para el lunes

### Contexto
Tesorería sabía qué se debe y cuándo vence, pero no la decisión intermedia: de
todo lo que se debe, esto es lo que se paga el lunes. Esa decisión se toma el
viernes, se autoriza, se imprime y se ejecuta — y vivía en una hoja de cálculo
aparte o en la cabeza de quien paga.

### Decisiones

**Tabla `payment_runs` + `supplier_payments_schedule.payment_run_id`.** No bastaba
con mover `due_date`: el vencimiento es del proveedor, pactado con sus días de
crédito; la fecha en que decidimos pagar es nuestra y suele ser otra. Meterlas en
la misma columna borraría el vencimiento real y con él la posibilidad de saber
qué se pagó tarde. Y una etiqueta de fecha por renglón no puede llevar quién
autorizó ni impedir que se agreguen facturas después de firmada.

**Una factura, una remesa.** Al agregar se verifica que el renglón no esté ya en
otra corrida viva. Sin ese candado la misma factura entra en la lista del lunes
y en la del martes, y se paga dos veces — el error más caro de este módulo. El
filtro `sinRemesa` de la pantalla contempla que una remesa cancelada suelta sus
facturas pero deja el apuntador puesto, así que no basta con `IS NULL`.

**Autorizar es requisito para pagar.** La corrida se arma un día y se ejecuta
otro; ese paso intermedio es donde alguien la revisa. Permitir "pagar" un
borrador convertiría la autorización en un adorno. Autorizada, ya no admite
altas ni bajas de renglones.

**Cancelar una remesa NO cancela las deudas**: las suelta y vuelven a estar
disponibles para la siguiente corrida. `ON DELETE SET NULL` en la FK por lo
mismo — perder la deuda porque se canceló la lista sería el peor error posible.

**El reporte se imprime en ventana aparte**, agrupado por proveedor y con banco,
CLABE y beneficiario, más renglones de firma "Elaboró / Autorizó". Sin los datos
bancarios la lista no sirve para transferir y alguien tendría que ir a buscarlos
proveedor por proveedor.

Pagar la remesa marca PAID todas sus facturas y libera la línea de crédito de
cada proveedor con `GREATEST(credit_used - amount, 0)`, en una sola transacción
— la misma regla del pago individual.

### Verificación
Ciclo completo contra Postgres local: armar con 3 facturas de 2 proveedores
($4,000); segunda remesa rechaza las 3 con "Ya está en otra remesa"; las
pendientes sin programar dejan de listarlas; pagar sin autorizar se rechaza;
autorizada no deja quitar renglones; pagar deja las 3 en PAID y devuelve
`credit_used` a su valor original; cancelar una remesa vacía no rompe nada.

De paso salió un `42P08` (`$1` deducido como varchar y como text en el mismo
UPDATE) — el mismo choque de tipos que ya se había resuelto en el ciclo de
órdenes de compra; se corrigió con `$1::varchar` en cada aparición.

---

## 2026-08-11 — La orden de compra cierra el círculo: factura, deuda y archivo

### Contexto
Recibir mercancía de una orden de compra sólo movía existencias. La deuda con
el proveedor no nacía en ningún lado: quien pagaba se enteraba cuando llegaba
la factura por correo. Las compras por XML sí generaban su cuenta por pagar
desde el día uno — era la misma compra tratada distinto según por dónde entró.

Además, el proveedor de la orden era inamovible (el que propuso el análisis de
mínimos), la recepción rechazaba cualquier pieza de más, y las órdenes surtidas
se quedaban en la lista de pendientes para siempre.

### Decisiones

**1. El proveedor sugerido pasa a ser un combo.** `PUT /purchase-orders/:id/supplier`.
El análisis propone el del último precio de compra, pero ese puede no tener
existencia o haber subido. Se puede cambiar hasta RECEIVED_PARTIAL — el cambio
a media entrega ocurre. En orden surtida o cancelada se bloquea: ahí el
proveedor ya es parte de la deuda generada.

**2. Al recibir se captura la factura y nace el pasivo.** Dos columnas nuevas en
`supplier_payments_schedule` (`invoice_number`, `purchase_order_id`) — la misma
tabla que ya usan el XML y el alta manual, no una nueva: tesorería ya la lista,
la marca pagada y libera línea de crédito. El vencimiento sale de
`customers.credit_days` contados desde la fecha de la factura, igual que en el
XML. Sin folio de factura la mercancía entra igual, pero se pide confirmación
explícita: la remisión que llega antes que la factura es un caso legítimo, un
descuido no.

**3. Índice único parcial contra la deuda duplicada.**
`(company_id, supplier_id, UPPER(invoice_number)) WHERE status <> 'CANCELLED'`.
El caso real no es el fraude sino el doble clic, y la recepción en dos partidas
amparadas por una sola factura: la segunda entrega mueve existencias pero no
vuelve a deber. En `UPPER` porque "A-123" y "a-123" son la misma factura.

**4. Se admite recibir más de lo pedido.** Antes lanzaba ConflictError. La caja
completa llega aunque se hayan pedido 47 piezas; negarse a registrarla no la
devuelve, sólo obliga a meterla por ajuste manual y ahí se pierde de qué compra
vino y a qué costo. El excedente queda anotado en el kardex y se devuelve a la
pantalla para que quien recibe lo vea.

**4-bis. La factura que llega DESPUÉS.** `POST /purchase-orders/:id/invoice`.
Lo normal es que el camión traiga la remisión, se reciba para que el almacén
pueda vender, y la factura aparezca tres días más tarde — y quedaban órdenes
surtidas sin deuda, con el proveedor mostrando línea de crédito libre como si
no se le debiera nada. Ahora se captura desde la misma orden, con botón
**Registrar factura**, y no vuelve a mover existencias: la mercancía ya entró.
Si la orden se cerró sin proveedor, ahí mismo se elige (es llenar un dato que
faltaba, no reescribir historia: si ya tenía uno, se le debe a ese). El detalle
de la orden lista las facturas ya registradas con su estado en tesorería, para
que nadie la capture dos veces "por si acaso".

La generación del pasivo quedó extraída en `generarDeudaProveedor()`: nace por
dos caminos y tenerlo duplicado garantizaba que un día uno de los dos dejara de
consumir la línea de crédito o de respetar los días de vencimiento.

**5. La orden surtida se archiva, no se borra.** La lista trae por omisión sólo
las vivas (`status NOT IN ('RECEIVED','CANCELLED')`), con casilla para ver las
cerradas. Borrarlas perdería el historial de a quién se le compró y con qué
factura. En pantalla RECEIVED se llama **Surtida**.

### Verificación
Prueba directa contra Postgres local con una orden creada al vuelo: recibir 13
de 10 pedidas dejó `stock +13`, `status RECEIVED`, deuda de $1,508 y un
excedente reportado; repetir la misma factura en minúsculas devolvió
`yaExistia: true` con **una sola** fila en tesorería; el cambio de proveedor
funcionó y la orden cerrada lo rechazó. `tsc --noEmit` limpio en los dos lados.

**6. El IVA se calcula, no se advierte.** Primera versión: el campo pedía el
total con impuestos y avisaba que el costo de la mercancía no los trae. Un
aviso no es un cálculo — quien recibe con prisa deja el campo vacío y el pago
queda 16% corto. Ahora se captura el **subtotal** (propuesto con el costo de lo
recibido) y se elige la tasa entre **16%, 8% y 0%**; el total sale solo y se
muestra desglosado antes de guardar.

Las tres cifras se guardan (`subtotal`, `tax_rate`, `amount`) porque el IVA de
compras es acreditable: reconstruirlo dividiendo totales entre 1.16 falla en
cuanto una factura viene al 8% de frontera. La lista de tasas es cerrada en dos
lugares explícitos —`TASAS_IVA` y un CHECK en la tabla—: con campo libre alguien
captura 15 o 1.6 y el pago sale mal sin que nada lo detecte. Una tasa fuera de
lista se rechaza en vez de convertirse calladamente en 16.

### Consecuencia
Tesorería ve la deuda el día que entra la mercancía, no cuando alguien la
captura, y por el importe que el proveedor va a cobrar de verdad.

---

## 2026-07-27 (mañana) — Iconos vectoriales en el manual de usuario

### Contexto
El manual mostraba `[casa]`, `[recibo]`, `[camión]` — texto entre corchetes en
lugar de iconos.

### Causa
PDFKit no puede incrustar **Segoe UI Emoji**: es una fuente COLR/CPAL, con los
glifos a color, y fontkit falla al decodificarla
(`TypeError: glyph._decode is not a function`). Se comprobó antes de buscar
alternativa, no se supuso.

### Solución
Dibujarlos con primitivas de PDFKit. Nuevo `scripts/manual-icons.js` con 22
iconos line-art de trazo 1.5, equivalentes a los que el usuario ve en pantalla
y con el mismo color de acento, para que los reconozca por forma y color.
`table()` acepta ahora celdas `{ icon, color }` además de texto.

Se aplicó a las cuatro tablas de referencia: 9 módulos del menú, 11 botones de
acción de facturas, 5 catálogos de Carta Porte y 5 botones de plantilla.

### Consecuencia
El PDF creció 3 KB (155 → 158 KB) porque son trazos vectoriales, no imágenes,
y escalan sin pixelarse. Commit `8ca5352`.

---

## 2026-07-27 (noche) — Puntos de entrada/salida por modalidad y servicio de tipos de cambio

### 1. El punto por donde cruza la mercancía depende del medio

El campo se llamó `cruce_fronterizo` porque nació pensando solo en camiones.
Pero un barco sale por un puerto y un avión por un aeropuerto:

| Medio | Punto | De dónde sale |
|---|---|---|
| 01 Autotransporte | Cruce carretero | `cp_cruce_fronterizo` (8, catálogo propio) |
| 04 Ferroviario | El mismo cruce carretero | el tren cruza por Nuevo Laredo igual que el camión |
| 02 Marítimo | Puerto | `sat_cp_estaciones` — 123 |
| 03 Aéreo | Aeropuerto | `sat_cp_estaciones` — 2 346 |

Los puertos y aeropuertos ya estaban sembrados desde el seed del SAT; solo
faltaba consultarlos con el filtro correcto. `cruce_fronterizo` pasó de
VARCHAR(10) a 16 porque las claves ferroviarias llegan a 12 caracteres.

También se expusieron `TipoEstacion`, `NumEstacion` y `NombreEstacion` en cada
Ubicación cuando el medio no es autotransporte: eso es lo que realmente viaja
en el XML, y el puerto de origen no es el mismo que el de destino, por eso va
por ubicación y no en el encabezado. Con 2 346 aeropuertos un desplegable es
inservible, así que se usa buscador con typeahead.

### Bug de búsqueda: los acentos

Buscar "lazaro" no encontraba **Lázaro Cárdenas**, ni "juarez" a Ciudad Juárez.
Medio catálogo del SAT trae acentos y nadie los teclea. Se resolvió con
`translate()` en lugar de la extensión `unaccent`, porque `CREATE EXTENSION`
puede no estar permitido en el Postgres administrado de Render y `translate()`
es SQL estándar. Aplica a los tres buscadores de catálogo.

---

### 2. Servicio central de tipos de cambio

Base: `TIPOS_CAMBIO_BANXICO.MD` (HCGM Advisors v1.0). Monedas: MXN, USD, EUR, GBP.

**Qué valor se guarda.** El del DOF, que es lo que el Art. 20 del CFF pide:
el FIX que Banxico determinó el día hábil ANTERIOR. Banxico publica la serie
por fecha de determinación; el servicio la desplaza al siguiente día hábil,
que es cuando ese valor rige. Se guardan las dos fechas para que una auditoría
pueda rehacer el cálculo sin adivinar cuál se usó.

**Lo facturado contra lo pagado.** Éste era el hueco real: `payments` tenía
`currency` pero no `exchange_rate`, así que no había con qué comparar. Ahora
el tipo de cambio se congela en dos momentos distintos:

```
invoices.exchange_rate  → el del día que se timbró (nunca se recalcula)
payments.exchange_rate  → el del día que entró el dinero
```

Se facturan 1 000 USD a 17.50 → 17 500 pesos. Cobran 15 días después a 18.00
→ entran 18 000. Llegaron los mismos dólares pero 500 pesos más: eso es
utilidad cambiaria y queda registrado aparte. En pagos parciales se compara
solo la porción cobrada — lo que no se ha cobrado todavía no se ha valuado.
La cuenta vive en la vista `v_diferencia_cambiaria` para que el reporte, la
pantalla de factura y cualquier consulta futura den el mismo número.

**Por qué nunca bloquea la facturación.** Si Banxico no responde, el servicio
devuelve el último tipo de cambio vigente, lo marca `vigente: false` y deja la
advertencia en la bitácora. Reintenta una sola vez a los 30 minutos. Detener
una emisión porque un servicio externo está caído sería peor que emitirla con
un valor que el usuario puede corregir antes de timbrar. La captura manual es
camino de primera clase, no parche.

**Series de Banxico configurables.** Viven en `exchange_rate_sources`, no en
el código: si Banxico renumera una serie se corrige con un UPDATE y no con un
deploy. Se sembró USD con `SF43718` (FIX, alta confianza); EUR y GBP quedaron
con serie tentativa y su nota dice que hay que verificarla contra el catálogo
SIE antes de confiar en el automático.

### Bug de zona horaria

El servicio calculaba "hoy" con `toISOString()`, que da UTC. En México son las
21:20 del 27 pero en UTC ya es 28, así que **toda factura emitida después de
las 6 de la tarde buscaba el tipo de cambio del día siguiente** — que no
existe todavía. Se detectó porque un valor capturado para hoy salía marcado
como no vigente. Corregido con `Intl.DateTimeFormat` en `America/Mexico_City`:
el CFDI es un documento fiscal mexicano y su fecha es la local.

### Qué se agregó

- Migraciones `2026-07-27b` (puntos de entrada/salida) y `2026-07-27c`
  (tipos de cambio): `exchange_rates`, `exchange_rate_sources`,
  `exchange_rate_log`, columnas de TC en `invoices` y `payments`, vista
  `v_diferencia_cambiaria`.
- `ExchangeRateService` + cron lunes a viernes 12:05 (hora de México).
- API `/exchange-rates` y `/fx-difference`.
- Pantallas **Tipos de cambio** (cuadro, captura manual, histórico, bitácora)
  y **Diferencia cambiaria** (detalle, totales por moneda, exportación CSV).
- Selector de moneda en Nueva Factura con el TC del día a la vista.
- PDF: renglón de equivalente en MXN con el TC y su fecha.

### Verificado

Escenario completo del documento: 1 000 USD facturados el 13 a 17.50 y
cobrados el 28 a 18.00 → +500 de utilidad. Pago parcial de 400 USD a 17.20 →
−120 de pérdida. Neto de la factura 380, que cuadra a mano. Casos límite
probados contra la API viva: moneda no soportada, TC negativo, consulta de
fecha sin dato exacto (devuelve el anterior marcado como no vigente).

### Pendiente

- Confirmar las series SIE de EUR y GBP contra el catálogo de Banxico.
- `BANXICO_TOKEN` se configura en Render; mientras no exista, el cron se
  registra pero no corre y todo funciona con captura manual.

---

## 2026-07-27 — Carta Porte internacional y multimodal (CP 3.1)

### Contexto
Hasta hoy la Carta Porte solo sabía de autotransporte nacional. El documento
`CARTA_PORTE_INTERNACIONAL.md` (HCGM Advisors v1.0) define cómo ampliarla a
operaciones México–EUA por carretera, ferrocarril, barco y avión.

### Bug encontrado antes de empezar: 34 claves perdidas en los catálogos

`apply-cp-seed.js` partía el seed por `;\n` y descartaba toda sentencia que
empezara con `--`. Como el comentario que encabeza cada catálogo queda pegado
al primer INSERT de su bloque, ese INSERT se iba con el comentario:
**una fila perdida por catálogo, 34 en total**. Las bajas eran justo las claves
de uso diario:

| Catálogo | Clave perdida |
|---|---|
| `sat_cp_documento_aduanero` | `01` Pedimento |
| `sat_cp_figura_transporte` | `01` Operador |
| `sat_cp_cve_transporte` | `01` Autotransporte |
| `sat_cp_tipo_estacion` | `01` Origen Nacional |
| `sat_cp_tipo_materia` | `01` Materia prima |
| `sat_cp_tipo_permiso` | `TPAF01` |
| `sat_cp_sub_tipo_rem` | `CTR001` |
| …y 27 más | la primera clave de cada uno |

Sin `01 Pedimento` la documentación aduanera era imposible de capturar. El
parser quedó corregido (recorta el comentario en vez de tirar el bloque) y se
agregó `fix-cp-catalogos-faltantes.js`, idempotente, al `start:prod` — las
bases ya sembradas no se repararían solas porque `apply-cp-seed` se salta el
trabajo cuando `catalog_versions` tiene fila.

### Decisiones de diseño

1. **Un solo módulo, no dos.** Se conserva la estructura nacional y se le
   cuelgan las capas que faltan (§2 del documento). No hay "Carta Porte
   internacional" separada.

2. **La modalidad es exclusiva.** `carta_porte.medio_transporte` (01–04) manda,
   y tanto el validador de guardado como el pre-PAC rechazan que venga más de
   un bloque modal. El SAT admite un solo nodo dentro de `<Mercancias>`.

3. **La vía no se pregunta dos veces.** `ViaEntradaSalida` se toma del medio
   elegido. Declarar una vía y capturar otra es rechazo seguro del PAC.

4. **Los regímenes son colección, no un valor.** Tabla `cp_regimenes_aduaneros`;
   la columna vieja `carta_porte.regimen_aduanero` se conserva y se migró su
   contenido para no romper lo ya capturado.

5. **La documentación aduanera cuelga de la mercancía, no de la carta porte**
   (§6.3). Un mismo embarque lleva mercancías con pedimentos distintos y
   mercancías nacionales junto a extranjeras.

6. **El domicilio extranjero no se valida contra el catálogo mexicano** (§5.2).
   Antes se exigía RFC con formato mexicano y CP de 5 dígitos a toda ubicación;
   ahora, si el país no es MEX, se pide el RFC genérico `XEXX010101000` más el
   registro tributario y la residencia fiscal. `municipio` pasó de VARCHAR(4)
   a 60 — "Los Angeles County" no cabía.

7. **Estados por país en tabla propia.** `sat_catalogs.c_Estado` es una lista
   plana sin país que usa el CFDI; meterle Texas ensuciaría el catálogo fiscal.
   Se creó `sat_cp_estado` con PK (clave, pais), mismo patrón que
   `sat_cp_municipio`.

8. **El cruce fronterizo es ayuda de captura, no catálogo del SAT.**
   `cp_cruce_fronterizo` con los 8 cruces del §8.1; el XML sigue viajando con
   las claves oficiales.

### Qué se agregó

- Migración `2026-07-27_carta_porte_internacional.sql`: 9 tablas nuevas
  (regímenes, doc. aduanera, ferroviario + derechos de paso + carros +
  contenedores, marítimo + contenedores, aéreo, cruces), `sat_cp_pais` (66),
  `sat_cp_estado` (97: 32 MEX + 65 USA/CAN).
- Validadores y persistencia de las tres modalidades nuevas.
- Builder de XML: `<RegimenesAduaneros>`, `<DocumentacionAduanera>` y los nodos
  `TransporteMaritimo`, `TransporteAereo`, `TransporteFerroviario`.
- Validador pre-PAC con capa internacional (§15.3) y capa modal (§15.4).
- UI: bloque de comercio exterior, captura completa de las tres modalidades,
  documentación aduanera por mercancía.

### Verificado

XML generado para las cuatro modalidades con exactamente un nodo modal cada
una; guardado y relectura de una carta porte marítima internacional
México–EUA con el validador pre-PAC en cero violaciones; borrado en cascada
limpio. Ocho reglas de rechazo probadas contra la API viva (vía que no coincide
con el medio, dos bloques modales, país = MEX, internacional sin régimen,
pedimento en documento que no es pedimento, figura extranjera sin Tax ID, OMI
mal formado, régimen repetido) y la regla de sentido del régimen en el pre-PAC
(`ITR` de importación declarado en una Salida).

### Pendiente

- **Multimodal por tramos (§13 del documento)**: expediente logístico con
  varios tramos encadenados (Shanghái → Manzanillo por barco → San Luis Potosí
  por tren → planta por camión), cada tramo con su CFDI e IdCCP. No entra en
  esta capa: requiere su propia tabla `carta_porte_tramos` y una pantalla de
  expediente. Hoy cada tramo se captura como una carta porte independiente.
- `sat_cp_pais` trae 66 países (socios comerciales de México) con claves
  ISO 3166-1 alfa-3, que es lo que el SAT adopta. Si hace falta el catálogo
  completo se reemplaza por el CSV oficial con el mismo `ON CONFLICT`.

---

## 2026-07-02 (tarde) — Stabilización post-deploy y correcciones de UI

### Contexto
Después del deploy exitoso a Render, aparecieron múltiples bugs derivados de:
1. Cambios manuales en la BD local que nunca se migraron a git
2. Recursos que Render no maneja igual que un servidor tradicional (sin disco persistente, sin devDeps en runtime, CORS estricto)
3. Bugs de UI que en dev no eran visibles por el proxy Vite

### Bugs enfrentados y soluciones

| # | Bug | Causa raíz | Solución |
|---|-----|------------|----------|
| 1 | CORS bloqueaba login desde frontend Render | `CORS_ORIGIN=gdmfac-frontend.onrender.com` (sin protocolo); Express CORS compara literal con Origin del navegador (`https://...`) | Hardcodear `value: "https://gdmfac-frontend.onrender.com"` en render.yaml |
| 2 | Login falla para admin.demo/usuario.demo | Hash bcrypt del seed no correspondía a "Cap4citAcion!" | Regenerar hash de "Demo123!" y UPDATE en Render Shell |
| 3 | Menús Importar XML, Proveedores, Paquetes visibles para todos | Sin guard de rol | Restringir a SUPER_ADMIN en Layout + `SuperAdminRoute` en App.tsx |
| 4 | Modal AdminPackages decía "requiere ADMIN" con SUPER_ADMIN | Guard hardcoded `role === 'ADMIN'` | Cambiar a SUPER_ADMIN + rehacer página con 4 cards de planes |
| 5 | Dropdown Régimen fiscal y Estado vacíos en Emisor | Catálogos SAT (c_RegimenFiscal, c_Estado, c_Moneda...) no seedeados | Migración `2026-06-16_sat_catalogs_seed.sql` con 200+ entries idempotentes |
| 6 | Producto no se guarda: `column "tax_preset_id" does not exist` | Columna creada manualmente en dev, nunca migrada | Migración `2026-06-17_products_tax_preset.sql` con IF NOT EXISTS + backfill |
| 7 | Logo no se sube en Render | Render Starter sin disco persistente — `fs.writeFileSync` funciona pero se pierde | Guardado dual: BYTEA en BD + FS como fallback dev; migración `2026-06-18_company_logo_bytea.sql` |
| 8 | Botón borrar producto no funciona | `fetch('/api/products/...')` con path relativo iba al static site del frontend en prod | Usar `api.deleteProduct(id)` con axios |
| 9 | Buscador SAT ClaveProdServ solo devolvía 7 claves | `src/data/c_ClaveProdServ.json.gz` (52,513 claves) no se copiaba a `dist/` con `tsc` | Script `scripts/copy-assets.js` que copia binarios post-tsc |
| 10 | Editar producto pierde el preset | Frontend siempre infería `taxPresetId` desde tax_rate, ignorando `p.tax_preset_id` guardado | Priorizar `p.tax_preset_id`; solo fallback si viene NULL |
| 11 | Solo 10 unidades en c_ClaveUnidad | Seed subset chico | Migración `2026-06-19_clave_unidad_full.sql` con ~115 claves (peso, longitud, tiempo, digital, energía) |
| 12 | Columna Impuesto en lista de productos inconsistente | Etiquetas variaban por preset ("Autotransporte", "Honorarios PF→PM", "IVA 16%") | Nomenclatura homogénea "IVA X%" o "IVA X% +Ret" con detalle en tooltip |
| 13 | Logo relativa `/api/public/companies/...` fallaba en prod | Path sin protocolo iba al static site; también faltaba `/v1` | Usar `client.defaults.baseURL` para construir la URL con protocol |

### Nuevas features en la misma sesión

- **Página Paquetes fiscales** rehecha con 4 cards visuales (PKG_100/200/500/FLEX) + sección descarga ZIP SAT.
- **Modal Nueva empresa** con:
  - Botón "Leer CIF" (SDK PDF SAT) — autollena RFC + razón + régimen + CP
  - Dropdown de plan de timbres (reemplaza 4 campos manuales)
  - Timbre extra default $2.00 editable
- **Migración catálogos SAT** completa (moneda, régimen, estado, uso CFDI, forma de pago, método de pago, tipo relación, motivos cancelación).
- **Migración c_ClaveUnidad** con 115 unidades (piezas, kg, m, m², m³, litros, tiempo, digital, energía, textiles).
- **Migración credit_notes** que faltaba en schema base (idempotente).
- **Migración products tax_preset_id + currency + no_identificacion** con backfill inteligente.
- **Migración logo BYTEA** para persistencia en Render sin disco.
- **Script copy-assets** para binarios que `tsc` ignora.

### Aprendizajes clave

1. **Render Starter NO tiene disco persistente** — cualquier archivo escrito a filesystem se pierde en cada deploy. Persistencia = BD (BYTEA) o storage externo (S3, B2).
2. **CORS con `fromService` de Render inyecta host sin protocolo** — para APIs autenticadas mejor hardcodear la URL completa.
3. **`tsc` solo copia .ts** — cualquier asset (JSON, .gz, .cer, .xls) necesita script propio.
4. **Cambios manuales en BD local sin migración = deploy roto** — regla estricta: cualquier `ALTER TABLE` o `CREATE TABLE` debe existir como archivo `.sql` en `migrations/` antes de merge.
5. **Frontend con fetch relativo funciona por accidente en dev** por el proxy Vite, pero rompe en prod cuando front y back están en dominios distintos.

### Consecuencia
- 🟢 Sistema 100% funcional en producción
- 🟢 Los 3 usuarios de capacitación validados con curl
- 🟢 SW Sapien Sandbox conectado con 501 timbres disponibles
- 🟢 Módulos SUPER_ADMIN operativos: crear empresa (con CIF), asignar plan, crear usuarios, gestionar CSDs
- 🟡 **Pendiente**: primer timbrado real con CSD de prueba SW Sapien + RFC EKU9003173C9

---

## 2026-07-02 — Deploy productivo en Render

### Contexto
Necesidad de un ambiente estable donde el servicio no dependa de que la máquina local esté prendida. El desarrollo local se caía intermitentemente (tsx watch, Vite server, y PG).

### Decisión
- **Plataforma**: Render.com con Blueprint (`render.yaml`)
- **Repo**: GitHub público `anbeor29-oss/GDM_FACT`
- **Plan**: Backend Starter ($7 USD), Frontend Static (Free), Postgres Free (90 días)

### Bugs enfrentados y resueltos durante deploy

| # | Error | Causa raíz | Solución |
|---|-------|------------|----------|
| 1 | `no such plan free for service type web` | Render descontinuó `free` para web services vía Blueprint | Cambiar `plan: free` → `plan: starter` en backend; quitar `plan` en static site |
| 2 | `TS5107: 'moduleResolution=node10' is deprecated` en TS 6.x | Render usaba TypeScript global 6.x en lugar del pinneado 5.9 | `build: "./node_modules/.bin/tsc"` (fuerza binario local) |
| 3 | `sh: ./node_modules/.bin/tsc: not found` | Render omite devDependencies con `NODE_ENV=production` | `buildCommand: "npm ci --include=dev && npm run build"` |
| 4 | `Node.js v26.4.0` demasiado nuevo | Render eligió última versión inestable | Pin `engines.node: "20.x"` + `.nvmrc` con `20` |
| 5 | `[migrate] FALLÓ: relation "credit_notes" does not exist` | Tabla `credit_notes` creada manualmente en dev, nunca en git | Nueva migración `2026-06-15_credit_notes.sql` con la definición completa |
| 6 | `Missing required environment variables: DB_HOST, ...` | Validación exigía vars sueltas, Render usa `DATABASE_URL` | Config acepta ambos: `DATABASE_URL` (parseada) o vars discretas |
| 7 | `$PORT` no respetado | Código usaba `APP_PORT` hardcode | Preferir `PORT` (Render) sobre `APP_PORT` (self-hosted) |

### Consecuencia
- 🟢 Backend live: https://gdmfac-backend.onrender.com
- 🟢 Frontend live: https://gdmfac-frontend.onrender.com
- 🟢 Postgres available: `gdmfac-postgres` (uso interno)
- Auto-deploy en cada `git push` a `main`
- Rollback con 1 clic desde el dashboard

### Aprendizaje
Render tiene 3 pitfalls no obvios que deberían estar mejor documentados:
1. Free tier YA NO aplica para web services vía Blueprint (sí manual)
2. `npm ci` con `NODE_ENV=production` omite devDeps por default
3. Node runtime pica versión bleeding-edge si no se pinnea

---

## 2026-07-01 — PDF paginación X/Y a la derecha inferior

### Contexto
Los PDFs generaban 4-6 páginas fantasma con contenido vacío. La paginación aparecía en el pie izquierdo pero con números incorrectos.

### Decisión
- Cambiar posición de "Página X/Y" al pie **derecho** (`x = PAGE_RIGHT - 120`)
- Workaround anti-auto-page en PDFKit: anular `doc.page.margins` temporalmente antes de escribir en zonas cerca del margen inferior
- Comprimir sellos base64 del timbre fiscal a 1 línea con ellipsis para evitar overflow

### Resultado
- Factura simple: 1 sola página con `Página 1/1`
- NC: 1 página `Página 1/1`
- Reporte cobranza (multi-cliente): 3 páginas `1/3, 2/3, 3/3`
- Cero páginas fantasma

### Archivos afectados
- `backend/src/modules/cfdi/pdf-helpers.ts`
- `backend/src/modules/cfdi/pdf.service.ts`
- `backend/src/modules/cfdi/pdf-credit-note.service.ts`
- `backend/src/modules/cfdi/pdf-payment.service.ts`

---

## 2026-07-01 — Integración SW Sapien PAC

### Contexto
El sistema estaba en modo MOCK PAC. Para producción real necesitamos timbrado ante SAT.

### Decisión
- **PAC elegido**: SW Sapien (`services.test.sw.com.mx` sandbox / `services.sw.com.mx` prod)
- **Modelo**: token JWT del panel `swpanel.mx` en `.env` cifrado, nunca password personal
- **Provider registrado**: `SW_SAPIEN` en el registry, seleccionado por env `PAC_PROVIDER=SW_SAPIEN`
- **Fallback**: MOCK cuando no hay token — permite dev sin dependencia externa

### Endpoints implementados
- `POST /cfdi33/stamp/v4` → timbrado CFDI 4.0
- `POST /cfdi33/cancel/{rfc}` → cancelación
- `GET /account/balance` → saldo de timbres

### Estado actual
- ✅ Sandbox conectado con **501 timbres disponibles**
- ✅ Balance leído correctamente por el ERP (`GET /pac/account-status`)
- ✅ Cuenta dedicada para el proyecto (separada del usuario personal)
- 🟡 Primer timbrado real pendiente
- 🟡 CSD de prueba de SW pendiente cargar en la empresa demo

### Archivos afectados
- `backend/src/modules/pac/providers/sw-sapien.provider.ts` (nuevo)
- `backend/src/modules/pac/pac.service.ts` (registry + selección dinámica)
- `backend/.env` (variable `SW_SAPIEN_TOKEN`)

---

## 2026-07-01 — Reporte de Cobranza detallado

### Contexto
El reporte de cobranza existente solo mostraba totales por cliente. Se pidió un reporte detallado que:
1. Filtre por cliente (o mostrar todos)
2. Liste facturas con saldo pendiente **> $0.20** (umbral anti-redondeo)
3. Muestre abonos (payments) y notas de crédito por factura
4. Exportable a PDF con paginación correcta

### Decisión
- Nueva pestaña **"Cobranza detallada"** en `/reports`
- Endpoint `GET /api/v1/reports/receivables?customerId=…` → JSON
- Endpoint `GET /api/v1/reports/receivables/pdf` → PDF descargable
- Saldo = `total - pagos - créditos`, filtro en memoria (2 decimales)

### Archivos afectados
- `backend/src/modules/reports/reports.service.ts` — nueva función `getReceivablesReport`
- `backend/src/modules/reports/receivables-pdf.service.ts` (nuevo)
- `frontend/src/pages/Reports.tsx` — pestaña nueva
- `frontend/src/services/api.ts` — métodos `getReceivablesReport` + `receivablesPDFUrl`

---

## 2026-06-30 — Importar XML: distinguir Cliente / Proveedor

### Contexto
Al importar un XML CFDI 4.0 externo, el sistema debe:
- Distinguir si la contraparte es CLIENTE (yo emito) o PROVEEDOR (yo recibo)
- Guardar CP y régimen reales del XML (no `'00000'` / `'616'` hardcoded)
- Los proveedores viven en `/suppliers` como vista read-only

### Decisión
**Single-Table Inheritance** con columna `party_type VARCHAR(16)` en `customers`:
- `CUSTOMER` (default) o `SUPPLIER`
- Constraint CHECK + índice parcial en `(company_id, party_type)`
- Sidebar: nuevo menú "Proveedores" con icono `Truck` color ámbar

**Auto-detección server-side**:
- Comparar RFC emisor/receptor del XML contra `companies.rfc` del JWT
- Si yo=emisor → sugerencia `receptor → CUSTOMER`
- Si yo=receptor → sugerencia `emisor → SUPPLIER`
- Si RFC coincide con la propia empresa → guard "no se puede crear como cliente ni proveedor"

**Parser XML actualizado** para extraer:
- `LugarExpedicion` (CP del emisor)
- `DomicilioFiscalReceptor` (CP del receptor)
- `RegimenFiscalReceptor`
- `UsoCFDI`

### Archivos afectados
- `backend/src/database/migrations/2026-06-23_party_type.sql`
- `backend/src/modules/cfdi-import/cfdi-import.service.ts`
- `backend/src/modules/cfdi-import/cfdi-import.types.ts`
- `backend/src/modules/suppliers/suppliers.routes.ts` (nuevo)
- `frontend/src/pages/Suppliers.tsx` (nuevo)
- `frontend/src/pages/ImportXMLWizard.tsx`
- `frontend/src/components/Layout.tsx`

---

## 2026-06-23 — Auto-memoria: registro de sesión

### Contexto
Necesidad de tener un rastro persistente de las decisiones tomadas entre sesiones del asistente.

### Decisión
Guardar auto-memoria en `C:\Users\EQ-7\.claude\projects\D--Obsidian-GDM-FAC\memory\`:
- `MEMORY.md` (índice)
- `gdm-fac-project.md` (contexto del proyecto)

Regla: no memorizar código o estructura (se puede leer del repo), sí memorizar **decisiones de negocio** y preferencias del usuario.

---

## 2026-06-22 — Paquetes de facturación (100/200/500 timbres)

### Contexto
Modelo comercial SaaS: cobrar renta mensual + cap de timbres. Necesidad de 3 planes con precios competitivos vs Facturama, Bind ERP, Contpaqi.

### Decisión

| Código | Timbres/mes | Renta MXN | Extra c/u |
|--------|-------------|-----------|-----------|
| `PKG_100` | 100 | $399 | $2.50 |
| `PKG_200` | 200 | $699 | $2.25 |
| `PKG_500` | 500 | $1,399 | $2.00 |
| `PKG_FLEX` | 0 (pay-per-stamp) | $0 | $2.00 |

**Margen bruto**: 40-57% (costo interno PAC + infra ~$1.72/timbre).

### Archivos afectados
- `backend/src/database/migrations/2026-07-01_stamp_packages.sql`
- `backend/src/database/migrations/2026-06-22_company_billing_plan.sql`
- `backend/src/database/migrations/2026-06-22_super_admin_module.sql`

---

## Decisiones acumuladas — resumen

- **Redondeo**: bancario (half-even) para centavos; nunca `toFixed(2)` sin verificar
- **Multi-tenant**: `company_id` en JWT, jamás en request body
- **Passwords**: bcrypt cost 12; force-change en primer login
- **CSD**: cifrado en BD con pgp_sym_encrypt + master key en env
- **XML**: parser tolerante para import; estricto para emisión
- **PDFs**: sellos abreviados (60+ellipsis+20) para caber en 1 página
- **API path**: `/api/v1/...` consistente en dev y prod
- **Auto-deploy**: cada push a `main` dispara build en Render (no manual)
- **Migrations**: idempotentes (`IF NOT EXISTS`, `ON CONFLICT DO`)
- **PAC**: switcheable entre MOCK y SW_SAPIEN vía env — cero recompilación

---

## Próximos pasos identificados

- 🟡 Migrar `CSD_MASTER_KEY` de env efímero a AWS KMS / Vault
- 🟡 Cerrar contrato PAC producción con SW Sapien (mayorista)
- 🟡 Cambiar dominio de `.onrender.com` a `.gdmfac.mx` custom
- 🟡 Job diario de reconciliación ERP ↔ SW (detectar desincronizaciones tras bypass local)
- 🟡 Timbrar NC y complementos de pago contra SW real (hoy XML se genera localmente y solo la factura pasa por PAC)
- 🟡 Envío automático por correo tras timbrar (checkbox "enviar al cliente")

---

## 2026-07-07 — Timbrado real, cancelación, correo y cierre pre-producción

### Contexto
Ronda intensiva para dejar el sistema listo para producción con dos empresas reales.
Cubrió el ciclo completo: emitir → NC → pago → cancelar → enviar por correo.

### Bloques principales

**Timbrado real con SW Sapien**
- Nuevo serializer `buildCFDIJson()` que arma el JSON CFDI 4.0 desde BD.
- `SWSapienProvider.stampFromJson()` sobre `/v3/cfdi33/issue/json/v4` (`application/jsontoxml`) — el CSD/`.key` vive en el vault SW, nuestro backend no maneja privadas.
- Guardrail: en sandbox solo se acepta RFC `EKU9003173C9`.
- Migración de fecha a `America/Mexico_City` (SAT valida contra hora local, no UTC).
- Provider real (MOCK vs SW_SAPIEN) expuesto al cliente para que los mensajes reflejen realidad.

**PDFs con datos y QR reales**
- `extractTimbreData(xml)` lee UUID, sellos, No. Certificado, RFCs y total del XML timbrado.
- `buildQrSatContent()` + `buildQrSatPng()` generan el QR de verificación SAT (Anexo 20).
- `drawTimbreFiscal` renderiza QR 90×90pt a la derecha del bloque timbre y usa sellos reales (no fabricados por regex).
- Aplicado a los 3 PDFs (factura, NC, complemento de pago).
- XML de NC y pago (generación local) ahora incluyen `NoCertificado`, `Emisor` y `Receptor` completos.

**Cálculos de saldo y status**
- Migración `2026-07-07_payments_missing_columns.sql` para columnas que el código esperaba.
- Migración one-shot `2026-07-08_recompute_invoice_paid_status.sql` corrige facturas con saldo real 0 atoradas en PARTIAL_PAYMENT.
- Regla `cubierto = pagos + NC` para status PAID.
- `ImpSaldoAnt`/`ImpSaldoInsoluto` del complemento de pago descuentan NC.
- Filtro `document_status != 'CANCELLED'` en 8 subqueries que sumaban pagos (lista, dashboard, reports, PDF, etc.).

**Envío por correo (SMTP)**
- Módulo mailer con nodemailer + variables env (`MAIL_HOST/PORT/USER/PASS/FROM`).
- `SendMailModal` con selección PDF+XML por factura, cada NC y cada pago.
- Backend tolerante: fallo de un adjunto no aborta el correo entero; se devuelve `{attached, skipped}`.
- Recomendación producción: SMTP del dominio propio (`facturas@hcgm.com.mx`).

**Cancelación**
- Fix RFC emisor real (antes hardcoded `ABC010101ABC` → 404).
- Endpoint correcto `/v4/cfdi/cancel/{rfc}` (no la mezcla `/v4/cfdi33/`).
- Parseo `data.uuid = { "<UUID>": "201"/"202"/"205"/... }` para leer códigos SAT.
- Cancelación en cascada desde el modal Historia (botones cancelar por NC y por pago con recálculo del padre).
- Validación anti-huérfanos: no se permite cancelar factura con dependientes vigentes.
- Bypass local para MOCK antiguo (pac_id='MOCK' salta el PAC).
- `forceLocal=true` desde UI cuando SW rebota (bug de vault sandbox) — panel amarillo con "Cancelar solo localmente".
- Resend a PAC de facturas ya canceladas localmente (mismo ícono, tooltip diferente).

**Editar factura DRAFT**
- Ruta `/invoices/:id/edit` reusando `NewInvoicePage`.
- Backend `updateInvoice` amplió a reemplazar cliente + items + totales en transacción.
- Botón sky ✏ en la lista, solo visible en DRAFT + no timbrada.

### Bugs enfrentados y soluciones

Detalle completo con síntoma/causa/fix/commit en [docs/BUGS_RESUELTOS.md](docs/BUGS_RESUELTOS.md).
Resumen: 22 bugs corregidos, 7 features nuevas. Todos los commits `ab3bd70…1a40cf3`.

### Archivos afectados (destacados)
- `backend/src/modules/cfdi/build-cfdi-json.service.ts` (nuevo)
- `backend/src/modules/cfdi/pdf-helpers.ts` (extractTimbreData, buildQrSatPng, drawTimbreFiscal con QR)
- `backend/src/modules/pac/providers/sw-sapien.provider.ts` (stampFromJson + endpoint v4 cancel)
- `backend/src/modules/pac/pac.service.ts` (cancelInvoice con bypass local + resend)
- `backend/src/modules/mailer/mailer.service.ts` (nuevo — SMTP con tolerancia)
- `backend/src/modules/invoices/invoices.service.ts` (updateInvoice completo + filtros cancelados)
- `backend/src/modules/payments/payments.service.ts` (cancelPayment + status con NC)
- `backend/src/modules/credit-notes/credit-notes.service.ts` (cancelCreditNote + XML completo)
- `backend/src/database/migrations/2026-07-07_payments_missing_columns.sql` (nuevo)
- `backend/src/database/migrations/2026-07-08_recompute_invoice_paid_status.sql` (nuevo)
- `backend/scripts/reset-company.ts` (nuevo — `npm run reset:company -- <RFC>`)
- `backend/scripts/generate-icons-guide.ts` (nuevo — `npm run docs:icons`)
- `docs/BUGS_RESUELTOS.md` (nuevo)
- `docs/GUIA_ICONOS_FACTURAS.pdf` (nuevo — generado)
- `frontend/src/pages/NewInvoice.tsx` (modo edición)
- `frontend/src/pages/Invoices.tsx` (SendMailModal, TimbresModal con cancelar, CancelModal con bypass)
- `frontend/src/pages/PublicHome.tsx` (nuevo — landing pública)
- `frontend/src/App.tsx` (guardas + ruta edición)

### Aprendizajes clave
1. **Placeholder es enemigo público**: dejar `'ABC010101ABC'` en el código costó dos horas de diagnóstico. Todo placeholder debe ser removido o tener test que lo detecte.
2. **Zonas horarias en fechas fiscales**: SAT valida contra hora local México (UTC-6/-5 con DST). Nunca usar `getHours()` en servidor UTC.
3. **Un mismo cálculo en 8 lugares**: al agregar `document_status != 'CANCELLED'` había que replicarlo en cada subquery. Vale la pena centralizar en una función helper.
4. **Sandbox del PAC no es fiel al prod**: 404 falsos, timbres que "desaparecen" del vault, etc. En prod hay que tener botón "reintentar" y logging fino.
5. **XML localmente generado ≠ XML del PAC**: hasta que NC y pago se timbren realmente, hay que mantener los atributos Anexo 20 (`NoCertificado`, `Emisor`, `Receptor`) coherentes en el XML de generación local, o el PDF los verá "pendientes".

---

## 2026-07-08/09 — Módulo de Facturación completo, marca GDM y despliegue en hcgm.com.mx

### Contexto
Con el timbrado real estable, esta ronda convirtió el ERP en un negocio
auto-administrado: el sistema mide el consumo, cierra el mes, emite sus
propios CFDIs de cobro y avisa por correo — más la integración visual y de
navegación con el sitio corporativo hcgm.com.mx.

### Bloque 1 — Módulo Facturación y Consumo (5 fases, diseño → producción)

Diseño completo en `docs/DISENO_FACTURACION_PLANES.md` con **10 decisiones
de negocio cerradas** (corte día 30/31, emisión día 1, prorrateo por días al
cambiar de plan con cap redondeado ↑, rollover que se conserva, extras al
precio del plan vigente al timbrar, CFDI de cobro emitido por el propio ERP,
prepago $4.99 fijo, umbral de aviso 5, bloqueo total con saldo 0, cancelar
no devuelve timbre).

| Fase | Entregable | Commit |
|------|-----------|--------|
| 1 | Migración `2026-07-09_billing_module.sql` (rollover en companies, `monthly_invoicing`, `prepaid_stamp_balance/purchases`, vista con cap efectivo) + `billing.service` (assertCanStamp, recordStampUsed dentro de la TX de timbrado) | `e5a6e47` |
| 2 | UI "Facturación y consumo": KPIs, tabla mes en curso (refresh 60 s), histórico anual, marcar pagado, botón cerrar mes; `close-month.service` idempotente | `56730cb` |
| 3 | UI "Compras prepago": saldos semaforizados (verde/ámbar/rojo BLOQUEADO), modal recarga 30/60/90 con desglose IVA, histórico de compras; endpoints `/admin/prepaid/*` | `7f4cec4` |
| 4 | **Dogfooding**: `issue-invoice.service` — HCGM (env `PLATFORM_COMPANY_RFC`) emite/timbra el CFDI de cobro contra cada cliente (upsert customer+producto SERV-TIMBRADO 81112000, PPD, IVA 16%), lo envía por correo y guarda folio+UUID; cron `node-cron` día 1 00:15 (`ENABLE_BILLING_CRON`); reintento por fila en la UI | `7473c6e` |
| 5 | Correos automáticos: `billing-alerts.service` (prepaid_low/prepaid_zero con flags anti-spam que se limpian al recargar + recordatorio de cobranza día 10); `sendPlainMail` en el mailer; trigger post-timbrado fire-and-forget + cron horario como red de seguridad | `6ca71f5` |

### Bloque 2 — Gestión de empresas (SUPER_ADMIN)

- **Editar empresa completa**: modal con Datos generales / Domicilio / Contacto + panel de sellos con acceso directo a actualizar CSD. El domicilio y `contact_email` alimentan el CFDI de cobro y los correos automáticos.
- **Reset operacional**: `POST /admin/companies/:id/reset-operations` (confirmRfc + dryRun) — para limpiar la escuela de pruebas sin PowerShell contra la BD.
- **Eliminar empresa (2 pasos)**: borrado total (14 tablas en cascada, usuarios, CSD, la empresa misma) con doble confirmación server-side (RFC exacto → palabra ELIMINAR), preview de conteos, protección anti-auto-eliminación y audit log.

### Bloque 3 — Manifiesto PAC con e.firma (firma criptográfica real)

- Tabla `sw_manifests` + `manifest.service`: parsea el `.cer` (X509Certificate — RFC del subject, CN, serial SAT decodificado, vigencia), abre la `.key` PKCS#8 DER cifrada con passphrase, **valida que la pública derivada coincida con la del certificado**, firma RSA-SHA256 el texto legal y verifica antes de persistir. La `.key` jamás se guarda.
- Pantalla en el modal Emisor (`ManifestSigner`): texto colapsable, carga de e.firma, badge verde al firmar y **constancia PDF** descargable (texto íntegro + serial + firma base64).
- SW no expone endpoint público de manifiesto → la constancia es el documento del expediente (status SIGNED; SENT/ACCEPTED manuales al tramitar en su panel).

### Bloque 4 — hcgm.com.mx: hosting, menú y marca

- **`npm run build:hosting`**: genera `gdmfac-erp-hosting.zip` con base `/erp/`, `VITE_API_BASE` al backend Render y `.htaccess` (SPA fallback + cache immutable). Guía completa en `docs/DEPLOY_HOSTING_ZIP.md` (Parte A hosting + Parte B checklist PAC producción).
- **Parche del menú corporativo**: se descargó el `index.html` real del sitio, se insertó "Facturas" en el nav (entre Nómina y Nosotros) y "📄 Facturación Electrónica" en el footer Herramientas — verificado byte a byte; entregado como `hcgm-menu-facturas.zip`.
- **Botón de regreso** en el login del ERP (`← hcgm.com.mx` junto a Ingresar) — ciclo completo sitio ↔ ERP.
- **Logo oficial GDM**: primero se recreó como SVG (feedback: "quedó feo") → se reemplazó por la **imagen real** de `hcgm.com.mx/assets/logo.png` (mockup 4000×2667, 7 MB) recortada al círculo con sharp y optimizada a 256×256 (104 KB). Aplicada en login, sidebar, landing y favicon; theme-color al azul marino del logo.

### Bugs de la ronda

| Bug | Causa | Fix |
|-----|-------|-----|
| **Failed deploy en Render** (backend caído) | `CREATE OR REPLACE VIEW v_stamp_usage_current` insertaba columnas en medio — Postgres solo permite agregar al final; migrate-up aborta con exit 1 | `DROP VIEW IF EXISTS` antes del CREATE (la migración es transaccional: el fallo hizo rollback y no quedó registrada) — `947cb99` |
| PDF guía de íconos con caracteres corruptos (Ø=Ý) | Helvetica no tiene glifos emoji | Íconos dibujados con los SVG paths reales de Lucide (`doc.path()` + `doc.circle()`) |
| Logo 7 MB en el bundle | `assets/logo.png` del sitio es el mockup completo | Recorte con sharp `extract` + `resize(256)` — verificación visual iterativa |

### Aprendizajes clave
1. **`CREATE OR REPLACE VIEW` no reordena columnas** — para vistas que evolucionan, `DROP VIEW IF EXISTS` + `CREATE` (si nada SQL depende de ellas) evita el deploy roto.
2. **Dogfooding cierra el círculo**: HCGM factura con su propio producto — cada mejora al ERP mejora también la operación del negocio, y los reportes de cobranza sirven de inmediato.
3. **Registrar consumo DENTRO de la TX de timbrado** garantiza que nunca haya CFDI timbrado sin contabilizar (ni al revés).
4. **Los flags anti-spam de correos** (low/zero_notified_at) deben marcarse solo si el envío tuvo éxito, y limpiarse al recargar — así los fallos de SMTP se reintentan sin duplicar avisos.
5. **Assets de sitios en producción pueden ser gigantes** — siempre verificar dimensiones/peso antes de meterlos al bundle; sharp del backend sirve para procesarlos sin dependencias nuevas.

---

## Estado para producción (checklist vivo)

- [x] Timbrado real SW sandbox verificado end-to-end
- [x] Módulo de facturación/cobro automático completo
- [x] ERP servido desde hcgm.com.mx/erp (ZIP) con marca GDM
- [ ] `git push` + deploy Live con el fix de la vista
- [ ] Subir ZIPs a cPanel (menú + ERP con logo)
- [ ] `CORS_ORIGIN` con hcgm.com.mx
- [ ] Pruebas finales con las 2 empresas reales
- [ ] Switch a SW producción (token + CSDs al vault + `SW_SAPIEN_ENV=production`)
- [ ] `PLATFORM_COMPANY_RFC` + `ENABLE_BILLING_CRON=true` en Render

---

## 2026-07-09 — Mudanza del repositorio a E: (consolidación de copias)

### Contexto
C: se estaba llenando y existían 3 copias del proyecto (C: repo real, D: y E:
copias obsoletas de Obsidian). Se consolidó todo en UNA copia local + GitHub.

### Procedimiento (seguro, con verificación antes de borrar)
1. Verificado: 0 commits sin pushear (GitHub como doble respaldo) y solo un
   archivo untracked (`docs/SW_TIMBRADO_ANALISIS.md`, viaja con la copia).
2. `robocopy /MIR /MT:16` de C:\Users\EQ-7\GDM_FAC → E:\Obsidian\GDM_FAC_new
   (484 MB, incluye `.git` y `node_modules`).
3. Verificación de integridad: mismo HEAD (`a4c1369`), mismo status, y
   **36,931 = 36,931 archivos**.
4. Swap: eliminada la copia vieja de E: (18,308 archivos obsoletos) y
   renombrado `GDM_FAC_new` → `GDM_FAC`. Re-verificado git + remote.
5. Eliminado `C:\Users\EQ-7\GDM_FAC` por completo (el directorio raíz requirió
   sacar primero el cwd de los shells de la sesión).
6. `D:\Obsidian\GDM_FAC` (copia obsoleta, 145 MB): su único archivo no
   presente en E: (`.claude/launch.json`) fue preservado; el borrado del
   contenido quedó **bloqueado por el guard de la sesión de Claude** (es su
   working directory — protección anti auto-borrado). Comando manual para el
   usuario al cerrar la sesión: `Remove-Item D:\Obsidian\GDM_FAC -Recurse -Force`.

### Resultado
```
E:\Obsidian\GDM_FAC   ← ÚNICA copia local (repo git íntegro)
GitHub                ← respaldo remoto + fuente del auto-deploy
Render                ← producción
```

### Aprendizajes
1. **Verificar antes de borrar**: conteo de archivos origen vs destino +
   `git log`/`status` en la copia ANTES de tocar el original.
2. **"Está en uso"** al borrar una carpeta = algún shell tiene su cwd dentro;
   mover el cwd y reintentar (el contenido puede borrarse aunque el raíz
   resista).
3. Los guards del entorno que impiden a una herramienta borrar su propio
   directorio de trabajo son deliberados: no rodearlos, documentar el paso
   manual.

---

# 📕 COMPENDIO MAESTRO — de cero a producción

> Resumen ejecutivo de TODO el proyecto para usarlo como plantilla del
> siguiente. Complementa: README §Lecciones, docs/BUGS_RESUELTOS.md (detalle
> bug-por-bug con commits) y las entradas cronológicas de arriba.

## 1. Línea de tiempo (10 etapas)

| # | Etapa | Qué se construyó |
|---|-------|------------------|
| 1 | **Fundación local** | Backend Node 20/Express/TS + frontend React 18/Vite + PostgreSQL. Módulos core: auth JWT multi-tenant (4 roles, force-password, impersonación), facturas CFDI 4.0 con retenciones, clientes (+ lector CIF PDF), productos (52k claves SAT), NC, complementos de pago, reportes, PDFs pdfkit |
| 2 | **Deploy a Render** | Blueprint render.yaml, backend Starter + PG Free + static site. Bugs de arranque: CORS, devDeps, versión de Node, TS 6 |
| 3 | **Estabilización post-deploy** | 13 bugs (tabla 2026-07-02): catálogos SAT no seedeados, columnas sin migrar, logo sin disco → BYTEA, assets que tsc no copia, fetch relativo |
| 4 | **Plataforma SUPER_ADMIN** | Paquetes fiscales, usuarios, empresas con CSD cifrado (pgcrypto), guards por rol y por URL |
| 5 | **Timbrado real (SW Sapien sandbox)** | Análisis JSON vs XML → ruta JSON `/v3/cfdi33/issue/json/v4` (el CSD vive en el vault del PAC). Bugs: token corrupto, fecha UTC vs México, "MODO SIMULACIÓN" hardcodeado |
| 6 | **Ciclo completo de documentos** | QR SAT real, NoCertificado desde el XML, cancelación en cascada (NC/REP → factura) con endpoint v4 + bypass local + resend, edición de DRAFT, envío SMTP con selección de adjuntos, marca de agua CANCELADO |
| 7 | **Módulo Facturación y Consumo** (5 fases) | Rollover de timbres, prepago FLEX con bloqueo, cierre mensual idempotente, **dogfooding** (HCGM emite sus CFDIs de cobro con su propio motor), correos automáticos con flags anti-spam, 3 crons |
| 8 | **Expediente del emisor** | Edición completa de empresas (domicilio/contacto), manifiesto PAC firmado con **e.firma real** (X509 + RSA-SHA256 + constancia PDF), full-delete con doble confirmación |
| 9 | **Integración hcgm.com.mx** | `build:hosting` (ZIP con base `/erp/` + .htaccess SPA), parche del menú del sitio, botón de regreso, logo oficial (recorte con sharp del asset real) |
| 10 | **Consolidación** | Mudanza del repo a E:, documentación integral, checklist de producción |

## 2. Catálogo maestro de errores (consolidado por categoría)

### Infraestructura / Render
| Error | Causa | Fix |
|---|---|---|
| CORS bloquea login | `CORS_ORIGIN` sin `https://` (fromService inyecta host pelón) | Hardcodear URL completa; múltiples orígenes separados por coma sin espacios |
| Build sin devDependencies | `npm ci` en prod las omite | `npm ci --include=dev && npm run build` |
| Node 26 rompe el build | Render usa la última si no se pinnea | `engines.node: "20.x"` + `.nvmrc` |
| tsc no copia binarios | `.gz`/assets no son TS | `scripts/copy-assets.js` post-build |
| Archivos suben pero desaparecen | Starter sin disco persistente | BYTEA en BD (logo, CSD); FS solo como cache |
| **Failed deploy** por migración | `CREATE OR REPLACE VIEW` reordenando columnas | `DROP VIEW IF EXISTS` + `CREATE` (migración transaccional → el fallo no dejó registro) |
| Modal eterno "Cargando…" | Código SELECT de columnas inexistentes (42703) | Migración `ADD COLUMN IF NOT EXISTS`; nunca evolucionar código sin su migración |

### PAC / SAT
| Error | Causa | Fix |
|---|---|---|
| "El token debe contener 3 partes" | JWT pegado con prefijo/`...`/saltos | Validar 2 puntos exactos; re-pegar limpio |
| "Fecha fuera del rango permitido" | `getHours()` en server UTC (6 h adelante) | `toLocaleString('sv-SE',{timeZone:'America/Mexico_City'})` |
| "XmlCFDI no proporcionado" | Flujo XML esperaba xml_content inexistente | Serializer `buildCFDIJson` + `stampFromJson` (ruta JSON) |
| Toast "MODO SIMULACIÓN" con timbre real | provider hardcodeado en controller y UI | Devolver `provider`/`is_mock` reales; endpoint diagnóstico `/pac/providers` con flags de env |
| Cancelación 404 (siempre) | `rfcEmisor='ABC010101ABC'` placeholder | Leer `companies.rfc`; regla: placeholders deben tronar |
| Cancelación 404 (sandbox intermitente) | Bug de vault sandbox + endpoint legacy | Endpoint v4 `/v4/cfdi/cancel/{rfc}`, parseo códigos 201/202/205, bypass `forceLocal` + resend |
| Factura MOCK no cancela en SW | SW nunca conoció ese UUID | Detectar `pac_id='MOCK'` → cancelar solo local |

### Datos / cálculos
| Error | Causa | Fix |
|---|---|---|
| Factura pagada seguía "Pago parcial" | Status ignoraba NC (`pagos >= total`) | `cubierto = pagos + NC`; migración one-shot que recalculó histórico |
| Saldo insoluto = monto de la NC | `ImpSaldoAnt` sin restar NC | Restar NC vigentes en XML del REP y en su PDF |
| Cancelar pago no liberaba la factura | 8 subqueries sumaban pagos cancelados | `AND document_status != 'CANCELLED'` en todas; lección: centralizar |
| Checkbox XML del pago siempre gris | Endpoint devolvía `uuid AS payment_uuid`, UI leía `p.uuid` | Quitar el alias (contrato de API consistente) |
| PDF "No. Certificado — pendiente" | XML local de NC/REP sin atributos Anexo 20 | Incluir `NoCertificado` + `Emisor`/`Receptor` en el XML generado localmente |

### PDF / UI
| Error | Causa | Fix |
|---|---|---|
| Emojis como `Ø=Ý` en PDF | Helvetica sin glifos emoji | Íconos con SVG paths de Lucide via `doc.path()`/`doc.circle()` |
| "−" renderizaba como coma | U+2212 no está en la fuente | ASCII `-` |
| Botón borrar/editar "no hace nada" en prod | `fetch('/api/…')` relativo o método inexistente en el api client | Siempre el cliente axios con baseURL; TS habría detectado el método faltante sin `as any` |
| Botón Cancelar invisible (círculo vicioso) | Acción dentro de `{r.uuid && …}` | Acciones de estado nunca condicionadas a datos opcionales |
| Logo de 7 MB | Asset del sitio era el mockup 4000×2667 | sharp `extract` + `resize(256)` con verificación visual |

## 3. Recetas y atajos (copiar/pegar)

### SQL de emergencia (Render Shell)
```bash
# Reset contraseña super-admin
psql $DATABASE_URL -c "UPDATE users SET password_hash = crypt('NuevaPass1!', gen_salt('bf',12)), password_change_required=false WHERE email='superadmin@plataforma.local';"
```

### Diagnóstico PAC end-to-end (PowerShell, sin DevTools)
```powershell
$b="https://gdmfac-backend.onrender.com"
$t=(Invoke-RestMethod -Method Post -Uri "$b/api/v1/auth/login" -ContentType application/json -Body (@{email="…";password="…"}|ConvertTo-Json)).data.token
Invoke-RestMethod -Uri "$b/api/v1/pac/providers" -Headers @{Authorization="Bearer $t"} | ConvertTo-Json -Depth 5
# → active/is_mock/env_sw_token_present dicen exactamente qué está mal
```

### Scripts npm del repo
```
backend:  reset:company -- <RFC>   · docs:icons   · migrate:up (auto en start:prod)
frontend: build:hosting            · build        · dev
```

### Flujo de trabajo diario
```powershell
cd E:\Obsidian\GDM_FAC ; git pull        # empezar
# …cambios…  (tsc --noEmit en backend/frontend antes de commitear)
git add … ; git commit -m "feat/fix: …" ; git push   # Render deploya solo
```

## 4. Checklist para replicar en un proyecto nuevo

1. [ ] Monorepo `backend/ + frontend/` + `render.yaml`; pinnear Node y TS
2. [ ] `schema.sql` base + `migrations/` idempotentes + runner que aborta el boot
3. [ ] Auth JWT con tenant en el token; guards por rol Y por URL
4. [ ] Binarios en BYTEA desde el día 1 (no filesystem)
5. [ ] Integraciones externas tras interfaz provider (MOCK primero)
6. [ ] Cliente API único en frontend (nada de fetch suelto); sin `as any`
7. [ ] Cálculos de dinero en UN helper/vista; probar con el caso "cancelado"
8. [ ] Fechas fiscales SIEMPRE con timeZone explícita
9. [ ] Scripts npm para toda operación repetible + endpoint de diagnóstico
10. [ ] Documentar al cerrar cada ronda: BITACORA (qué/por qué) + BUGS (síntoma/causa/fix)

---

## 2026-07-13 — Punto de Venta, grupos de trabajo y entorno GDM_ALMACEN

### Contexto
Se pidió: (1) Punto de Venta con mayoreo configurable, (2) grupos de trabajo que
restrinjan módulos por usuario, y (3) levantar un **segundo entorno en Render
(`GDM_ALMACEN`)** ya funcionando, con su admin y datos de ejemplo, sin tocar la
producción `gdmfac`.

### Qué se hizo

**POS + mayoreo + grupos (commit `0e9bd24`)**
- Migración `2026-07-11_pos_and_groups.sql` (idempotente): `users.work_group`
  (ADMIN_ALL/VENTAS/ALMACEN/COMPRAS/TESORERIA, default ADMIN_ALL),
  `products.wholesale_price`, `companies.pos_mayoreo_min_qty` (default 4) y
  `next_pos_folio`, tablas `pos_sales` / `pos_sale_items`.
- Backend POS (`modules/pos`): catálogo, venta contado (EFECTIVO con cambio /
  TARJETA), mayoreo automático cuando `qty >= min_qty`, descuento de stock en
  transacción, folio consecutivo.
- Permisos: middleware `requireModule` + mapa `GROUP_MODULES`; el JWT lleva
  `workGroup` y se recupera de BD si falta. Frontend filtra menú y rutas por
  grupo (`canAccess`) y placeholders (`ComingSoon`) para módulos aún no hechos.
- Productos: `wholesale_price` y `stock` ahora se capturan/editan en la UI
  (columnas Mayoreo/Stock en la tabla). Se arregló un bug latente en
  `updateProduct`: normaliza camelCase→snake_case, así que precio, claves SAT,
  impuestos, mayoreo y existencias **sí** persisten al editar.

**Entorno GDM_ALMACEN**
- Bootstrap de despliegue en **JS plano** (no ts-node — en Render no hay devDeps
  en runtime): `scripts/example-data.js` (fuente única de datos), `seed-examples.js`
  (CLI) y `bootstrap-env.js` (idempotente: crea empresa + admin ADMIN_ALL +
  ejemplos según variables `BOOTSTRAP_*`; no-op si faltan; nunca tumba el boot).
- Blueprint propio en la **rama `almacen`** (`render.yaml` con
  `gdm-almacen-postgres/-backend/-frontend`), independiente de `gdmfac`. El
  `startCommand` corre `migrate:up` → `bootstrap:env` → `node dist/index.js`.

### Decisiones / gotchas
- **ts-node no está en runtime de Render** (BITÁCORA 07-02). Todo script que deba
  correr en el arranque o en Render Shell debe ser JS plano con deps de runtime
  (`pg`, `bcryptjs`). Por eso el seed pasó de `.ts` a `.js`.
- `work_group` NO se fija al crear usuario → toma el default de BD `ADMIN_ALL`.
- Secretos del Blueprint (`BOOTSTRAP_ADMIN_PASSWORD`, `SW_SAPIEN_TOKEN`) van con
  `sync: false` (se piden al hacer Apply); nunca en git.
- Render permite 1 Postgres free por cuenta: si `gdmfac` ya lo usa, el de
  `gdm-almacen` debe ser de pago o liberar el otro. El backend web ya cuesta
  ~$7/mes (sin tier free vía Blueprint).

### Consecuencia
POS operativo con mayoreo; permisos por grupo demostrables; `GDM_ALMACEN`
desplegable en 1 clic (Apply del Blueprint) y auto-inicializado con admin
ADMIN_ALL + ejemplos.

---

## 2026-07-16 — GDM_FAC se queda SOLO con facturación + el CORS que tumbó todos los accesos

### Contexto
El usuario entró a facturación y se encontró un menú con 14 módulos: Punto de
Venta, Inventarios, Almacenes, Inventario físico, Compras, Órdenes de compra,
Proveedores y Tesorería. Su reclamo fue directo: *"una cosa es GDM_FACT, el otro
es el GDM_Almacen… no mezcles las cosas, porque no lo podré administrar
correctamente"*. En paralelo reportó que **ningún usuario podía entrar**.

Investigado: no había mezcla de repos. Esos módulos eran de GDM_FAC mismo —
seis de ellos eran pantallas `ComingSoon` ("Próximamente") introducidas por el
commit `0e9bd24`, es decir, **el sistema anunciaba módulos que no tenía**. Se
decidió que GDM_FAC es solo facturación y que POS/inventarios/compras/tesorería/
proveedores pertenecen al producto ALMACEN.

### Qué se hizo

**Manual y reporte (commit `4adec5f`)**
- Botón "Manual" en la landing, junto a "Entrar al sistema", que abre
  `manual-usuario.pdf` en pestaña nueva. Usa `import.meta.env.BASE_URL`, así
  resuelve igual en Render (`/`) y en el hosting de México (`/erp/`).
- Reportes → Ventas: detalle por mes/año con fecha, cliente, factura, importe,
  pagado y no pagado, totalizando ventas totales / cobradas / no cobradas.
  Backend `getSalesDetailReport` + `GET /reports/sales-detail?year&month`.
  **Criterio**: "pagado" = pagos timbrados **+ notas de crédito**, para que
  `importe = pagado + no pagado` siempre cuadre y los totales reconcilien.

**Solo facturación (commits `1acc91a`, `61f046b`)**
- Se retiran del mapa de módulos, del menú y de **sus rutas** (no solo ocultos:
  tampoco se alcanzan por URL directa): `inventory`, `warehouses`,
  `physical_inventory`, `purchases`, `purchase_orders`, `treasury` (los seis
  `ComingSoon`), más `suppliers` y `pos`, que sí funcionaban pero son de ALMACEN.
- Menú de empresa final: **dashboard, facturas, notas de crédito, clientes,
  reportes, productos**.
- `modules/pos` (backend) se conserva para migrarlo a ALMACEN, pero **no se
  concede a ningún grupo**: sus endpoints responden 403 y la UI no lo expone.
  `'pos'` sigue en `ModuleKey` solo porque `pos.routes.ts` usa `requireModule('pos')`.
- `SuppliersPage` se conserva: la usa el SUPER_ADMIN en `/suppliers`, que
  acompaña a Importar XML (facturas recibidas).

**CORS — la causa real de "ningún usuario funciona" (commit `248a8f2`)**
- `render.yaml` solo listaba `https://gdmfac-frontend.onrender.com`. El navegador
  **bloqueaba toda petición desde `https://hcgm.com.mx/erp`** antes de que
  saliera, login incluido. Las contraseñas nunca estuvieron mal.
- Fix: `CORS_ORIGIN` con los tres orígenes (Render + `hcgm.com.mx` +
  `www.hcgm.com.mx`; con y sin www son orígenes distintos para el navegador).
  `parseArray` ya separaba por coma.

**Manual: 9 iconos (commit `63dff68`)**
- La tabla de iconos estaba incompleta **y con dos etiquetas equivocadas**:
  la cartera verde decía "Abonos/saldo" cuando es **Complemento de Pago**; el
  naranja en borrador decía "Descartar" cuando es **Cancelar factura**; y faltaba
  por completo el **ámbar `coins` "Ver saldo y aplicaciones"**.
- Se corrigió contra la fuente canónica del repo (`scripts/generate-icons-guide.ts`)
  y contra `Invoices.tsx`. La tabla dibuja los 9 iconos con los mismos paths
  Lucide que usa la app.

**Landing (commit `61f046b`)**
- Las 12 tarjetas de "Módulos incluidos" pintaban su icono con el mismo índigo
  plano. Ahora cada una usa el color con el que ese módulo aparece **dentro del
  sistema** (acento del menú o color del icono en facturas), para que quien entra
  reconozca lo que vio. "Facturación CFDI 4.0" pasa de `FileText` al sello morado
  (`Stamp`), que es el icono real con el que se timbra.

### Decisiones / gotchas

- **La lección de CORS ya estaba escrita en el README** (§ "10 errores", punto 1,
  desde el 07-02) pero el `render.yaml` nunca la siguió al agregar el hosting de
  México. Documentar un gotcha no lo previene: hay que verificarlo por origen.
- **Un 401 NO prueba que una ruta exista.** Al validar el endpoint nuevo, dio
  `401` y pareció confirmar el deploy; una ruta inventada (`/reports/ruta-inventada`)
  daba **el mismo 401**, porque `router.use(authenticateToken)` corre antes del
  match de ruta. La prueba concluyente fue otra (hash del bundle, bytes del PDF).
  Regla: verificar con un control negativo, no con el happy path.
- **`canAccess` es fail-open**: `GROUP_MODULES[g] || GROUP_MODULES.ADMIN_ALL`. Si
  se borra un grupo del mapa y algún usuario lo tiene en BD, **vería TODO**. Por
  eso ALMACEN/COMPRAS/TESORERIA se conservan aunque ya casi no tengan módulos.
  Combinado con el default `ADMIN_ALL` de la columna `work_group` (07-13), un
  usuario sin grupo ve todo lo que exista en el mapa.
- **La rama `almacen` NO se debe sincronizar a ciegas con `main`**: conserva los
  14 módulos a propósito. Un `merge main → almacen` le borraría POS e inventarios.
- Vite **no empaqueta** un módulo sin referencias: al quitar la ruta y el import,
  `PointOfSale.tsx` desapareció del bundle (verificado buscando "venta de
  mostrador" en el JS servido).

### Consecuencia
GDM_FAC quedó como sistema de facturación puro, sin anunciar nada que no opere.
Accesos restaurados desde `hcgm.com.mx`. Manual publicado y consultable desde la
landing. Todo verificado en producción por evidencia (hash de bundle, bytes del
PDF, cabecera CORS por origen), no por "responde 200".

**Pendiente para facturar de verdad: dar de alta los clientes reales.** Además,
Productos aún muestra campos de **mayoreo y existencias (stock)** con textos que
citan el Punto de Venta — son de ALMACEN y siguen visibles en facturación.

---

## 2026-07-16 (tarde) — Reportes PDF, Usuarios por ADMIN, contrato con e.firma y bitácora

### Contexto
Cuatro pedidos encadenados: (1) reportes de resumen mensual y de facturas no
pagadas, en PDF dentro del navegador; (2) que el ADMIN de empresa pudiera dar de
alta a sus USER; (3) un contrato de prestación de servicios anclado en T&C y
firmado con la e.firma del contratante; (4) una bitácora confidencial del USER
con reporte mensual por correo.

El punto (2) reveló que **la premisa no se sostenía**: `/admin/users` era
exclusivo del SUPER_ADMIN (`requireSuperAdmin`), así que un ADMIN de empresa no
podía crear usuarios — dependía de HCGM para cada alta. Hubo que construirlo.

### Qué se hizo

**Reportes PDF (commit `a3b7e7c`)**
- `GET /reports/sales-summary/pdf`: por mes y año — venta, cobrada, no cobrada y
  **adeudo acumulado** (suma corrida), con subtotal por año y total general.
- `GET /reports/unpaid/pdf`: TODAS las facturas con saldo, lista plana
  cronológica. A diferencia de Cobranza detallada (agrupa por cliente y filtra
  saldos > $0.20), aquí solo se descarta el redondeo (>= $0.01). Columna de días
  de antigüedad, ámbar > 30, rojo > 90.
- Se sirven `inline` y se muestran DENTRO de la página en un `<iframe>` con blob
  (mismo patrón que la vista previa de facturas), no se descargan.
- "Cobrada"/"pagado" = pagos timbrados + NC, el MISMO criterio de
  `getSalesDetailReport`, para que los tres reportes reconcilien.

**Módulo Usuarios — `/team` (commit `bbe3e38`)**
- El ADMIN da de alta/baja a los USER de SU empresa; contraseña temporal que se
  muestra UNA vez.
- Tres reglas sostienen el aislamiento: `company_id` SIEMPRE del JWT (nunca del
  body), todo query lleva `AND company_id = <mía>` (un id ajeno → 404, no opera),
  y el rol va **fijo a USER** (un ADMIN no crea otro ADMIN).
- Gateado por ROL en el frontend (`CompanyAdminRoute`), no por grupo de trabajo:
  gestionar usuarios es autoridad, no un módulo más.

**Contrato con e.firma (commit `7d7c1ea`)**
- Tabla `service_contracts` + `/contract`, `/contract/sign`, `/contract/verify`.
- Se REUSAN las primitivas de e.firma de `modules/manifest` (`parseCertificate`,
  `openPrivateKey`) exportándolas, en vez de copiarlas.
- Se guarda el **texto íntegro + SHA-256**, no solo un "acepté": la firma es
  sobre el texto exacto; sin él no se puede verificar después y no vale como
  prueba.
- La `.key` nunca se persiste; la contraseña tampoco entra al `audit_log`.
- ⚠️ **El texto legal está PENDIENTE**: 8 cláusulas con bloques
  `[PENDIENTE — texto legal]`. Exportado a `docs/CONTRATO_TYC_BORRADOR.docx`,
  generado desde el MISMO archivo que firma el sistema para que no diverjan.

**Bitácora + reporte mensual (commit `2761c4d`)**
- `user_activity_log` + `users.monitoring_enabled/_email`. **Se registra a TODOS;
  el interruptor solo controla el ENVÍO del reporte** — así lo dice la cláusula
  SEXTA, y además si el monitoreo se activa después, el historial ya está.
- Registro por **middleware global**, no llamadas por módulo: si dependiera de
  recordar `log()` en cada ruta nueva, la bitácora tendría huecos justo donde
  importa. Registra en `res.on('finish')`, cuando `req.user` ya está poblado.
- Cron día 1 06:00 (tras el cierre de facturación de las 00:15, para no competir
  por el pool ni el SMTP). El reporte va SOLO a `monitoring_email`.

### Decisiones / gotchas

- **El control negativo por fin se aplicó bien**: `/reports/ruta-inventada/pdf`
  → 404 (con token), mientras los reportes reales dan 200 con magic `%PDF-`.
  Comparar contra una ruta inventada es lo que distingue "existe" de "responde".
- **Se probó la firma REAL sin e.firma del SAT**: se generó una de prueba con
  openssl (RFC en `x500UniqueIdentifier`, `.key` PKCS#8 cifrada). El primer
  intento dio 400 — el error era del que probaba, no del código: se usó el RFC
  de un CLIENTE en vez del de la empresa contratante. O sea, la validación que
  impide que un tercero firme por la empresa **funciona**.
- **`day` es palabra reservada en Postgres**: `TO_CHAR(...) day` como alias sin
  `AS` es error de sintaxis. Habría explotado el día 1 a las 6 AM dentro del
  cron, en silencio. Lo atrapó la prueba del reporte, no el typecheck.
- **`last_login_at` no existe; la columna es `last_login`** (error nº5 del
  README otra vez). Lo atrapó el smoke, no el compilador.
- Chromium headless **no trae visor de PDF**: el `<iframe>` sale en blanco en las
  capturas automatizadas. No es bug — se verificó que el iframe recibe el blob y
  no hay errores de consola; el mismo patrón ya opera en la vista previa de
  facturas.

### Consecuencia
GDM_FAC cierra la etapa con: reportes de cobranza completos, autonomía del ADMIN
para gestionar su equipo, base legal firmable con e.firma y bitácora de auditoría
con reporte mensual opt-in.

**Bloqueantes antes de operar de verdad:** el texto legal del contrato,
`PLATFORM_COMPANY_RFC` (hoy el contrato saldría con el RFC del prestador en
blanco), `ENABLE_BILLING_CRON=true` (sin eso el reporte mensual NO se envía) y
SMTP configurado.

---

## 2026-07-17 — 🟢 Primer timbre real. GDM_FAC operando en producción con GRUPO HCGM

### Contexto
Día completo: arreglos y ajustes previos, paso al ambiente productivo del SAT
(vía SW Sapien PRODUCTION), y el **primer CFDI 4.0 real timbrado y validado en
el portal SAT** — UUID `a2a39f86-5fa7-4855-88d9-23a351da1383`, folio B-000001,
GRUPO HCGM → cliente CEMJ7902287G3.

### Lo que se puso en producción durante el día

**Timbrado idempotente y a prueba de carreras (`12f6651`)** — el requisito
bloqueante de la Fase 4 móvil, y que también protege a la web:
- El reintento tras respuesta perdida devuelve el resultado (con `already_stamped`)
  en vez del error confuso "ya está timbrada". El operador recibe su PDF y XML.
- Reclamo atómico contra el doble timbrado por doble toque simultáneo:
  `UPDATE ... WHERE stamping_started_at IS NULL`. Postgres decide el ganador,
  no un `if`. Verificado con 2 peticiones EN PARALELO: 1 éxito + 1 conflicto,
  1 solo timbre consumido.
- Decisión de diseño: se usó una columna TIMESTAMP y no un status `STAMPING`
  porque medio sistema filtra con `status NOT IN ('CANCELLED','DRAFT')` y un
  estado nuevo contaría como venta real en todos los reportes.
- No se creó tabla `idempotency_keys` (patrón Stripe): el `invoiceId` YA es
  clave de idempotencia natural (existe como DRAFT antes de timbrarse).

**Autollenado del CSD desde el .cer (`632491e`)** — evita teclear el
No. Certificado (20 dígitos) a mano. Reusa `parseCertificate` del manifiesto:
lee serial, RFC, razón social y vigencia; opcionalmente verifica que la `.key`
corresponda al `.cer` y que la contraseña abra. Avisa ANTES de guardar si el
RFC no coincide con la empresa, si el certificado vencido, o si la .key no
corresponde. **Confirmado con el CSD real de HCGM: cert `00001000000717077906`
vence 2029-07-04**, autollenado correctamente.

**Correción del pedido original**: el usuario pidió leer la vigencia "al poner
el .key"; se aclaró que **la vigencia NO está en el .key** (es solo llave
privada cifrada, sin metadatos), vive en el .cer.

**Foco arreglado en Editar empresa (`d630b28`)** — bug clásico de React: se
definía un componente `F` DENTRO del modal; cada tecla remontaba el input y se
perdía el foco tras un carácter. Se sacó `Field` a nivel de módulo. Verificado
tecleando `PROLONGACION` letra por letra: se capturó completo, foco retenido,
Tab avanza al siguiente campo. Se dejó comentario prominente para que nadie
vuelva a meter el componente adentro.

**Editar rol/grupo/nombre + borrado protegido (`a9db09b`)** — el SUPER_ADMIN ya
podía cambiar rol via API pero faltaba UI, y no existía borrado definitivo.
La base de datos dio una lección: **8 tablas apuntan a users(id) con ON DELETE
NO ACTION** (companies.csd_uploaded_by_user_id, service_contracts.signed_by_user,
sw_manifests, pos_sales, monthly_invoicing, prepaid_stamp_purchases,
users.created_by_user_id, users.monitoring_set_by). Un DELETE ciego reventaría
con FK violation; pero además esas FK guardan **evidencia fiscal de 5 años**.
Decisión: se cuenta el historial ANTES de borrar y se responde 409 con la
explicación útil: *"No se puede borrar a X: creó otros usuarios: 1. Dalo de
baja en vez de borrarlo."* — no un mensaje opaco de constraint.

**Nuevo endpoint `wipe-operations` (`1370097`)** — reemplaza `reset:company`
que estaba roto. Ese script y su gemelo `reset-operations` olvidaban 4 tablas
(stamp_usage, pos_sales, pos_sale_items, cfdi_validations) y fallaban con
"current transaction is aborted" sin decir por qué. El nuevo:
- Orden derivado del **mapa REAL de FKs**, no de la memoria
- Usa `transaction()` del proyecto (BEGIN/COMMIT/ROLLBACK/release)
- Si algo falla: rollback total + mensaje CONCRETO (qué tabla, qué FK)
- Confirmación server-side de RFC + `dryRun`
- Bug atrapado por la prueba: `pos_sale_items.pos_sale_id` no existe; la
  columna real es `sale_id`. El mensaje del endpoint lo dijo textual y hubo
  que corregir solo un nombre.
- Verificado end-to-end contra BD con datos "sucios" (2 facturas timbradas,
  stamp_usage, pac_stamps): todo a 0, usuarios intactos, folio reseteado.

**Vaciado de la BD productiva de GRUPO HCGM (SQL directo, no endpoint)** — el
usuario prefirió correr el SQL desde Shell de Render con BEGIN/COMMIT manual y
verificación de RFC en un DO block. Se guardaron **empresa + usuarios + CSD +
contrato + datos de emisor**. Se borraron 6 facturas capturadas, 4 clientes,
7 productos. Folio reseteado a 1. Sin errores.

**Corrección: extractor de CIF partía las palabras concatenadas (`1ce0c09`)** —
en la PRIMERA factura real timbrada aparecieron `PROLONGACIONADORATRICES`,
`VILLATERESA`, `RINCONDEROMOS` — datos pegados en la BD. Verificado que NO era
bug del PDF (concatena bien con `join(' ')`, `join(', ')`) sino del extractor
de CIF: el PDF del SAT no trae espacios reales entre tokens de vialidad y
pdfjs los devuelve pegados. Solución con post-procesamiento **conservador**:
- Diccionario de prefijos de vialidad (PROLONGACION, AVENIDA, BOULEVARD…) y
  localidad (RINCON, VILLA, SAN, SANTA, LOMAS…) + preposiciones (DEL, DE, LA…)
- Solo actúa cuando la cadena empieza con prefijo del diccionario
- Preposiciones LARGAS primero (DEL antes que DE), o `DELCASTILLO` se parte
  como `DE + LCASTILLO` sin alcanzar DEL
- NO busca preposiciones EN MEDIO del resto: `RETORNOMORELOS` se partiría
  como `MOR + EL + OS` con `EL`. Perdemos `LOMASDELCASTILLO` al 100% pero
  salvamos `RETORNOMORELOS`. Trade-off consciente
- 22 casos probados incluidos GUADALAJARA, AGUASCALIENTES, TEPATITLAN,
  MONTERREY — TODOS intactos. Las 3 cadenas reales del incidente — SEPARADAS
- **LIMITACIÓN documentada**: solo arregla cargas NUEVAS. Los datos ya en BD
  y la factura B-000001 timbrada quedan como están (CFDI timbrado es
  inmutable ante el SAT). Se corrigen a mano en el modal o con UPDATE.

### Configuración de producción aplicada por el usuario

Variables de Render en `gdmfac-backend`:
- `PAC_PROVIDER=SW_SAPIEN` (antes: MOCK)
- `SW_SAPIEN_ENV=production` (antes: sandbox)
- `SW_SAPIEN_TOKEN` productivo cargado
- `PLATFORM_COMPANY_RFC=GHC1707275Y0`

**Arquitectura A + B para operar** (acordada):
- **Producción real** en `hcgm.com.mx/erp` + backend `gdmfac-backend` con
  RFC `GHC1707275Y0` y `SW_SAPIEN_ENV=production` → timbres del paquete real
- **Ambiente de pruebas** en `gdm-almacen-backend` con `SW_SAPIEN_ENV=sandbox`
  y RFC `EKU9003173C9` (ESCUELA KEMPER URGATE) → timbres sandbox gratis
- El código YA protege contra RFC equivocado (`pac.service.ts:238`): en
  sandbox rechaza cualquier RFC que no sea EKU; en production nunca se
  llamaría al PAC con EKU porque el CSD no correspondería

### El bug del reset:company que se dejó vivo

`reset:company` original (`backend/scripts/reset-company.ts`) y su endpoint
`reset-operations` siguen rotos. Se agregó `wipe-operations` como reemplazo
en vez de tocar el viejo, para no romper llamadas existentes. Convendría
alinearlos en una sesión futura.

### Lo que quedó pendiente y quiénes son las prioridades

**Bugs conocidos con la solución escrita:**
- Punto 4 documento: respaldo `RFC_DDMMAA_DDMMAA` en Paquetes fiscales — la
  infraestructura (`/archive/invoices.zip`) ya existe, falta la UI y el
  nombre partido a 100k XML
- Punto 5-6 documento: leyenda "emitido desde Grupo HCGM" + logo miniatura
  en el PDF — cuidado con `PDFKit + emojis` (error nº7 del README)
- Orden de campos en Cargar CSD: número entre password y vigencia
- Datos ya pegados en BD de GRUPOHCGM: se corrigen con UPDATE directo

**Aplicación móvil (Android/iOS)** — `READMEAPIFAC.md` y `bitacoraapifac.md`
mantienen el estado: **cero código**, decisiones tomadas (Capacitor 8.4.2,
solo facturación, caché de lectura). La Fase 4 móvil ya está desbloqueada
porque el timbrado idempotente se subió hoy. **El usuario pidió expresamente
retomar esto** después de operar en real y estabilizar. iOS/Mac exige App
Store o TestFlight (no sideload como Android).

### Consecuencia

**GDM_FAC operando en producción real ante el SAT con GRUPO HCGM.** Todo el
código del día pasó por prueba real, no solo compilación. Los bugs que
salieron —datos pegados del CIF, foco perdido en edición— eran reales pero
localizados, con arreglos verificados. La base de HCGM quedó limpia para
recibir clientes reales.

**Cierre del día 2026-07-17: 11 commits, 1 CFDI timbrado y validado en el
portal SAT.** Descanso hasta mañana con lista clara de prioridades.

---

## 2026-07-21 · 2026-07-22 — V2 nace: Carta Porte 3.1 + Super Lector XML

**Rama nueva**: `v2-carta-porte` (basada en `origin/main`), directorio de
trabajo `E:\Obsidian\GDM_FAC_2`. V1 (`origin/main` + `hcgm.com.mx/erp`) NO
se toca durante todo el trabajo — sigue timbrando en producción.

### Contexto
El usuario tenía dos productos divergentes en Render:
- **GDM_FAC** (gdmfac-*) — el bueno, facturando real, ordinal `origin/main`
- **GDM_ALMACEN** (gdm-almacen-*) — sandbox con Inventarios + Carta Porte 3.1 + Super Lector construido a lo largo de las semanas anteriores, rama `gdmalmacen-main` del mismo directorio E:\Obsidian\GDM_FAC.

Después de afinar el complemento CP en gdmalmacen, decisión: **crear V2 de
GDM_FAC** trayendo SÓLO los módulos de CP + Super Lector + Mercancías (NO
inventario ni POS). Base de trabajo aislada para probar todo local antes de
tocar Render.

### Preparación (día 1)

- **Clone limpio** de `origin/main` a `E:\Obsidian\GDM_FAC_2\`.
- **Nueva rama** `v2-carta-porte`.
- **Copia selectiva** desde `gdmalmacen-main` (dir `E:\Obsidian\GDM_FAC`):
  - Backend: `modules/carta-porte/` completo (17 archivos: services, routes, catalogs, builder XML, validator), `modules/xml-super-import/` (2 archivos), migraciones `2026-07-18_carta_porte.sql` + `2026-07-18b_cp_lugares.sql` + `2026-07-18c_cp_mas_catalogos.sql` + `2026-07-20_nomina_imports.sql` + `2026-07-21_cp_mercancias.sql`.
  - Frontend: 9 pages (`CartaPorte*.tsx`, `SuperXMLImport.tsx`, `CartaPorteMercancias.tsx`), componentes `LugarPicker.tsx` y `CatalogPicker.tsx`.
  - PDF service completo desde gdmalmacen (con hoja de CP + contrato).
  - `api.ts` completo (superset — métodos huérfanos = dead code inofensivo).
- **App.tsx**: agregadas rutas `/carta-porte`, `/carta-porte/*`, `/xml-super-import`, `/invoices/:invoiceId/carta-porte`.
- **app.ts backend**: montadas 7 rutas nuevas + monta xml-super-import.
- **Layout.tsx**: agregados items en sidebar.
- **Package.json**: agregada dep `xmllint-wasm@^5.2.0`.
- **Migration guard**: `2026-06-20_pkg_flex_price.sql` fallaba en fresh install porque UPDATE sobre `stamp_packages` antes de que la tabla exista. Envuelto en `DO $$ IF EXISTS ... END $$` idempotente.
- **Ajuste api.ts**: bug de sessionStorage vs localStorage — token guardado en session pero interceptor axios leía de local → 401 loop. Fix: interceptor lee de `sessionStorage.getItem('token') || localStorage.getItem('token')`.
- **Ajuste Team.tsx / AdminUsers.tsx / AdminCompanies.tsx / Reports.tsx**: se copiaron de gdmalmacen porque usan nuevos métodos del api.ts.
- **Eliminado PointOfSale.tsx** — fuera de scope V2.

Commit inicial: 47 archivos, 1 commit en rama local, sin remoto ni deploy.

### Setup local (Windows, día 1 tarde)

Requisitos verificados:
- Intel i3-9100 4C/4T · 64 GB RAM · 927 GB libres en E: · Node v24.16.0 · npm 11.13 · PostgreSQL 16 corriendo como servicio Windows.

**Reset de password postgres** (usuario olvidó la que puso al instalar) —
edición de `pg_hba.conf` con `trust` temporal + `ALTER USER postgres WITH
PASSWORD 'gdmfac2local'` + restore. Ejecutado por el usuario en PowerShell
admin (Claude bloqueado por classifier para tocar servicios de sistema).

**Creación BD** `gdmfac_v2` + extensión `pgcrypto`. **Migraciones**: 25
aplicadas sin errores incluida la migración guard del pkg_flex_price.
**Bootstrap** creó empresa `GRUPO HCGM S.A. DE C.V.` (RFC GHC1707275Y0) +
admin `admin@gdmfac2.local` + 16 productos + 6 clientes de ejemplo.

**Arranque**:
- Backend en `localhost:3001` (background bash task) — Redis no disponible, corre en modo degradado.
- Frontend Vite HMR en `localhost:5173` — `.env` con `VITE_API_BASE=http://localhost:3001` (bug: primero puse `VITE_API_URL` que no existe, error HTTP 500 en login).

### Iteración 1 — UX del formulario CP

- **Pickers de plantilla** agregados a Mercancías, Vehículo, Aseguradora, Figura de transporte (además del Lugar que ya tenía). TemplatePicker genérico inline (rose/amber/sky).
- **Fix picker de Figura**: mapping usaba `nombre_figura`/`rfc_figura` pero backend regresa `nombre`/`rfc`. Se llenaban solo tipo y licencia; ahora los 4 campos.
- **Verde suave** (`bg-emerald-50`) en campos vacíos del modal Lugares (Calle, No. exterior, Localidad, Municipio) para señalar "el XML no lo trajo, captura manual". Leyenda "Verde = falta capturar" arriba del bloque Domicilio.

### Iteración 2 — Bug del precio del producto

- Editar un producto y cambiar `basePrice` a 0.01 no persistía. **Causa**: controller pasaba `req.body` tal cual a `productsService.updateProduct`, pero el service busca `data.base_price` (snake_case). Frontend siempre mandó `basePrice`. Silenciosamente ignorado.
- **Fix**: normalizar 12 campos camelCase → snake_case en el controller antes de llamar al service.

### Iteración 3 — Super Lector modo lote

- Frontend acepta hasta 5 archivos en el drop-zone / input.
- Al procesar, se **detectan todos**, se **dedup client-side** por clave natural entre archivos, y se hace 1 sola llamada `POST /xml-super-import/check-existing` al backend para saber cuáles ya están en BD.
- Preview consolidado con 7 secciones (parties · productos · mercancías · lugares · vehículos · aseguradoras · operadores) con checkbox por ítem. Los que ya existen aparecen verdes y desmarcados.
- Un click "Importar lo seleccionado" → `POST /xml-super-import/apply-selected` con listas explícitas → backend crea cada ítem con dedup guard.

### Iteración 4 — PDF de Carta Porte

Copiado el formato SAT que muestra el usuario (imagen de otro sistema
comercial). Layout resultante:
- **Hoja 1**: CFDI normal (emisor, receptor, conceptos, totales, timbre) — sin cambios.
- **Hoja 2**: *Complemento Carta Porte 3.1* — título con barra celeste + QR (esquina superior izq.) + info block a la derecha (Versión, Núm. documento en rojo, IdCCP, Folio fiscal, RFC PAC, No. cert. SAT, Fecha timbrado, Lugar expedición). Barras oscuras 2-col con Transporte Internac / Distancia. Secciones Iformación Autotransporte, Aseguradora Resp. Civil, Vehículo (tabla), Figuras (tabla), Ubicaciones (tabla + domicilio expandido debajo), Mercancías (una tabla por cada).
- **Hoja 3**: `CONDICIONES DEL CONTRATO DE TRANSPORTE QUE AMPARA ESTA CARTA PORTE` con las 14 cláusulas completas (PRIMERA a DÉCIMA CUARTA).

**Lookup automático clave→nombre** en el PDF: `sat_cp_colonia` (por CP + clave), `sat_cp_municipio` (por estado + clave), `sat_cp_localidad`, `sat_catalogs` c_Estado. Formato `(clave) Nombre` — así por ejemplo `(NLE) Nuevo León`, `(2954) Ciénega de Flores Centro`.

### Iteración 5 — Módulo Mercancías separado de Productos

Regla del usuario: "las mercancías son solo lo que se transporta, no le
pertenece a la empresa. Los productos sí, por separado. Ya que en determinado
momento se deben de especificar las mercancías para las inspecciones, ya que
tal vez por falta de alguna medida o dato, pueden enfrentar multas".

- **Migración `2026-07-21_cp_mercancias.sql`**:
  - `cp_mercancias_catalog` — plantilla reusable, uniq por (company, claveSat, desc_normalizada, cliente_rfc). Contador `veces_transportada` + `ultima_vez`.
  - `cp_mercancias_movimiento` — bitácora por viaje. FK a `invoices`; guarda remitente/destinatario/fecha para rastro fiscal.
- **Backend**: `mercancias.service.ts` con `saveMercancia()` upsert + insert, `mercancias.routes.ts` con GET catálogo/bitácora + DELETE.
- **Frontend**: nueva página `/carta-porte/mercancias` con tabs Catálogo | Bitácora. Card 📦 en Super Lector con checkbox y listado.
- **Preset fiscal `auto_carga`** — Super Lector marca conceptos con SAT `78101xxx` o retIva>0 con preset IVA 16% + Ret. IVA 4% automático.

### Iteración 6 — Sidebar V2 con iconos 3D

Orden solicitado y aplicado:
1. 🏠 Dashboard · 2. 🧾 Facturas · 3. 🚚 Carta Porte (colapsable con 📍🚛🛡️👨‍✈️📦) · 4. 📉 Notas de Crédito · 5. 📦 Productos · 6. 👥 Clientes · 7. 📥 Lector de XML · 8. 📊 Reportes · 9. 📜 Contrato.

Iconos emoji con CSS `drop-shadow` para efecto 3D. `Usuarios` OCULTO en V2. `Datos de la empresa` NO va en sidebar — vive en el modal top bar `DATOS DE MI EMPRESA` (usuario pidió quitar la duplicidad después de haberlo agregado).

### Iteración 7 — Formulario CP autofill total

- **Fecha/hora salida-llegada** split en 2 inputs (date + time) porque `datetime-local` se cortaba visualmente en Chrome (usuario reportó screenshot con "07/21/2026 , -").
- **CP autofill total**: al escribir CP 5 dígitos, colonia/municipio/localidad se convierten en **comboboxes** con opciones del catálogo SAT. Estado auto-set por rango de CP (2 primeros dígitos → tabla oficial 32 estados). Debajo de cada combo aparece `Clave SAT: XXX` en **rojo pequeño** (tipografía monospace).
- **Estado read-only**: usuario dijo "aquí no hace falta combobox" — se muestra el nombre completo del estado inferido (ej. "Nuevo León") en read-only y la clave `NLE` en rojo debajo.
- **Opción "Otra no especificada"** en cada combo por si no está en catálogo.

### 🚨 Bug crítico corregido — seed CP con columnas invertidas

Descubierto al probar CP 66645 (Nuevo León): el combo de colonia decía "0 opciones" a pesar de que el seed cargó 144,718 filas. Investigación:

```sql
SELECT clave, codigo_postal, descripcion FROM sat_cp_colonia LIMIT 3;
-- clave | codigo_postal          | descripcion
-- 0001  | Tetitla la Gallera     | 16514
-- 0001  | Zona Centro            | 20000
```

Las columnas `codigo_postal` ↔ `descripcion` estaban intercambiadas — los CPs vivían en `descripcion`, los nombres en `codigo_postal`. Bug del script Python `generate-carta-porte-seed.py` heredado de gdmalmacen.

Verificado con `SELECT COUNT(*) FILTER (WHERE descripcion ~ '^\d{5}$')` = 144,718 (todos). Mismo patrón en `sat_cp_municipio` y `sat_cp_localidad` (estado ↔ descripcion swap).

**Fix aplicado**: SWAP en las 3 tablas (script en `scratchpad/fix_colonia.sql` y `fix_muni_loc.sql`). Después del fix:
- CP 66645 → 5 colonias (Padilla, Jardines Del Virrey, Parque Industrial Huinalá, Bosques de Huinalá, Hacienda Del Carmen).
- CP 66600 → colonias reales de Nuevo León (Apodaca).
- Municipio 006 en NLE → "Apodaca" (antes daba 0 filas).

**⚠️ IMPORTANTE**: este mismo bug existe en la BD de producción de Render (mismo seed original). Cuando se despliegue V2 a Render, se debe correr el mismo SWAP allá antes de que la UI funcione.

### Iteración 8 — Ampliación de columnas geo

Migración `2026-07-21b_cp_ubicaciones_widen.sql`: amplió `colonia / municipio / localidad` de `VARCHAR(4)` a `VARCHAR(60)` en `cp_ubicaciones`, `cp_lugares` y `cp_figuras`. El schema original asumía siempre clave (4 chars). Ahora acepta clave o nombre libre sin truncar.

### Iteración 9 — Datos de la empresa (emisor)

- Nueva página `/company` (`CompanyProfile.tsx`) con formulario editable de datos fiscales + domicilio fiscal + `ManifestSigner` incrustado.
- **Retirada del sidebar después** cuando el usuario notó que duplicaba el modal del top bar. El componente `ManifestSigner` ya vivía en `IssuerModal` — no se duplica el flujo del manifiesto.

### Iteración 10 — Timbre fiscal con sellos íntegros

Bug en `pdf-helpers.ts`:
- `abbrev()` cortaba sello a `first60…last20` (perdía firma completa).
- `lineBreak: false + ellipsis: true` cortaba a 1 renglón.
- Cadena original NO incluía `SelloCFD` como exige Anexo 20 §III.B.

Fix:
- Nueva opción `wrap: true` en helper `kv()` — permite multilínea con `doc.y` para calcular altura real.
- Sellos mostrados ÍNTEGROS.
- Cadena original con formato correcto `||1.1|UUID|Fecha|PAC||SelloCFD|NoCertSAT||`.
- Placeholder honesto `— pendiente: PAC en modo MOCK devuelve XML sin sellos —` cuando el sello viene vacío (evita confusión).
- `BLOCK_H` ajustado de 100pt a 180pt para reservar espacio del wrap.

### Iteración 11 — Ancho de columnas del PDF

- Columna "Datos" de Figuras tenía `w: W - 490` = 25pt → rompía "Licencia: LFD01120038" letra por letra. Ajustado a `w: W - 85 - 105 - 175 - 55` = ~95pt.

### Estado final V2 (2026-07-22)

- **Rama**: `v2-carta-porte` local, sin remoto.
- **BD local**: `gdmfac_v2` con 25 migraciones + seed CP con SWAP aplicado + 144K colonias + 2,453 municipios + 661 localidades + 33 configs vehiculares + bootstrap admin.
- **Backend** corriendo en localhost:3001 (background task, MOCK PAC).
- **Frontend** corriendo en localhost:5173 (Vite HMR).
- **Sin timbrado real**: `.env` con `PAC_PROVIDER=MOCK`. Cuando se quiera timbrar contra SW Sapien sandbox/prod, cambiar a `SW_SAPIEN` + token.

### Pendientes para llevar V2 a producción

1. **Deploy en Render** — 3 servicios nuevos (`gdmfac2-backend`, `gdmfac2-frontend`, `gdmfac2-postgres`) o rama del repo GDM_FACT existente. Decisión del usuario pendiente.
2. **Correr SWAP fix en Postgres de producción V2** (mismo bug del seed CP).
3. **Manifiesto SW Sapien** — HCGM ya firmó, solo falta el token en env vars del deploy.
4. **PAC real** — cambiar `PAC_PROVIDER=SW_SAPIEN` + `SW_SAPIEN_ENV=sandbox` (o `production`) + `SW_SAPIEN_TOKEN` en el env de Render.
5. **Actualizar manual de usuario** — refleja el nuevo sidebar, CP, mercancías, super lector.
6. **Marco legal del contrato para factura** — pendiente decisión de si se genera al inicio o se anexa al PDF.

### Consecuencia

**GDM_FAC V2** listo para pruebas finales locales con datos reales del contribuyente (subir XMLs reales de HCGM al Super Lector, generar CP, timbrar sandbox, descargar PDF). V1 sigue intacta en producción. Cero riesgo para la operación actual.

**Commits notables del período** (todos en rama local, sin remoto todavía):
- Feat inicial: port CP + Super Lector + Mercancías desde gdmalmacen (47 files)
- Fix update product basePrice (camelCase → snake_case)
- Fix pdf.service integrar CP + contrato (2 hojas)
- Fix sidebar 3D emojis + orden V2 + oculto Usuarios
- Feat CP autofill total con combos + clave rojo bajo cada campo
- Fix seed CP swap columnas (SQL directo BD, no versionado)
- Feat sellos íntegros wrap + cadena original Anexo 20
- Feat Datos empresa + ManifestSigner (luego retirado del sidebar por duplicidad)

---

## 2026-07-29 — Un catálogo que no siembra ya no tumba la facturación

### Contexto
`gdmfac-backend` llevaba ~14 horas sin desplegar. Render solo decía:

    Exited with status 1 while running your code

No es fallo de compilación: es el arranque. `start:prod` encadenaba seis pasos
con `&&` y los cinco scripts de datos hacen `process.exit(1)` ante cualquier
error, así que **un catálogo del SAT que no cargara dejaba el servidor sin
escuchar** — y sin decir cuál de los cinco había fallado.

Detrás de ese bloqueo venían atorados el saldo de clientes, el filtro de
permisos por modalidad y el aviso de timbrado simulado. También explicaba por
qué el sistema seguía en MOCK pese a tener bien las variables: el proceso vivo
era anterior a haberlas puesto.

### Dos intentos que no bastaron
1. **Migración `2026-07-28b` con guardas.** Llevaba doce `ALTER TABLE` sin
   comprobar que la tabla existiera. La había probado en base virgen —donde las
   migraciones de CP corren antes y crean todo—, y eso no probaba el caso real:
   una base con 27 días de historia y despliegues de CP a medias. Corregido con
   un bucle sobre `information_schema`; probado contra una base sin ninguna
   tabla `sat_cp_*`. **Era un error real, pero no era el único.**
2. Seguí buscando *cuál* script fallaba. Era la pregunta equivocada.

### Decisión
La pregunta correcta era **por qué un catálogo de apoyo puede tumbar la
facturación**. `scripts/arranque-produccion.js` separa lo que es requisito de lo
que no:

* **Migraciones → fatales.** Si el esquema no aplica, el código habla con una
  base que no le corresponde y puede corromper datos fiscales.
* **Catálogos y bootstrap → avisan y siguen.** Que falten deja un combo vacío
  en captura; no impide emitir ni timbrar. Tirar el servicio por eso es peor
  que el problema que evita.

Al final imprime qué pasos quedaron pendientes, qué significa en la práctica y
que se reintentan solos —todos son idempotentes—. Ese resumen es el diagnóstico
que no existía: el servicio se caía sin dejar rastro.

### Verificación
Se sustituyó `apply-cp-seed` por un stub que sale con código 1 —el fallo exacto
que teníamos— y el servidor **arrancó igual**: `/health` respondió con 441 s de
uptime. Con la cadena anterior, ese mismo fallo dejaba el servicio muerto.

### Consecuencia
Aplicado a los DOS productos: `beb229f` en GDM NEXO y `5d69e08` en GDM
Facturación. No cambia qué hacen los scripts ni su orden — cambia qué pasa
cuando uno falla.

**Pendiente:** no sabemos todavía cuál script fallaba en la base de producción.
Este cambio no lo adivina; hace que deje de importar para el servicio y que
quede escrito en el log del próximo arranque.

### Lección
Probar en base virgen no prueba producción. Una migración que corre sobre bases
en estados desconocidos no puede dar por hecho lo que hay — y un arranque no
debería tratar un dato de apoyo con la misma severidad que el esquema.

---

## 2026-08-17 — Nómina, primera capa: expediente del personal

### De dónde viene
El sistema de nómina que se integra (`D:\Obsidian\NOM_COM_1\nom_com_v2`) es
Express 5 + **sql.js** —SQLite compilado a WebAssembly— con las pantallas en
HTML sueltos de JavaScript plano. ~17,700 líneas, 16 tablas, una sola empresa.
Nada de eso se pudo portar tal cual.

Dos hallazgos que decidieron el alcance:

1. **El motor de cálculo vive en el navegador.** `calcISPT`, `calcIMSS`,
   `calcINFONAVIT` y la tarifa del Art. 96 están dentro de `nomina.html`,
   no en el servidor. En un sistema multiempresa eso es a la vez un problema
   de corrección y de seguridad: cualquiera puede cambiar su propio ISR desde
   la consola del navegador.
2. **El timbrado es simulado.** `POST /api/cfdi/:id/timbrar` dice, textual,
   "simula timbre PAC". Genera CFDI 4.0 + Nómina 1.2 pre-timbre, sin sello.

### Qué se hizo
La capa que el resto necesita para existir y que no dependía de ninguna
decisión pendiente:

* **`companies` NO se duplicó.** El sistema anterior traía su propia tabla de
  empresas con RFC, régimen, domicilio y CSD en base64. Todo eso ya existe en
  NEXO. Se le agregaron a `companies` los tres datos que sólo nómina necesita:
  `registro_patronal`, `prima_riesgo` y el factor de integración
  (`fi_aguinaldo_dias`, `fi_prima_vac_pct`), con los CHECK de los Arts. 72 LSS,
  87 y 80 LFT. Se dejan NULL a propósito: los mínimos se PROPONEN en pantalla,
  no se guardan solos — una empresa que da 30 días de aguinaldo con el mínimo
  puesto por omisión calcularía mal el SDI sin que nada se viera roto.
* **`nomina_empleados`** — expediente completo con los campos del CFDI 4.0.
  Un trabajador NO es un usuario del sistema: el 90 % de la plantilla nunca
  entra al ERP. Número de empleado y RFC únicos POR EMPRESA (en el sistema
  anterior eran globales porque atendía a una sola).
* **Lo que falta no bloquea el alta.** El trabajador entra el lunes y ese día
  muchas veces no se tiene el NSS. El expediente se guarda incompleto y el
  servicio dice qué le falta (`faltantes`), porque cada hueco es un timbrado
  rechazado el día de la primera nómina.
* **Del recibo timbrado al expediente.** El super lector de XML ahora saca el
  `nomina12:Receptor` completo, percepciones, deducciones y otros pagos.
  `POST /xml-super-import/nomina/proponer-empleado` **sólo lee**: devuelve lo
  rescatado, de dónde salió cada dato y qué falta. El alta va por el endpoint
  de siempre, con lo que la persona confirmó.
* **El nombre se parte con la CURP, no a ojo.** El CFDI trae "MARIA DE LOS
  ANGELES DE LA TORRE GARCIA" en una sola cadena. RENAPO construye las cuatro
  primeras posiciones de la CURP con reglas fijas, así que se prueban todos los
  cortes y gana el que las reproduce. Si ninguno cuadra, se marca `incierto` y
  la pantalla lo pide confirmar.
* **Nómina sólo la ve ADMIN_ALL.** Sueldos, CURP, cuentas bancarias y órdenes
  de pensión alimenticia. Abrirlo después a un grupo de RH es un renglón;
  recoger sueldos que ya se vieron, no.
* **Cero datos importados**, como se pidió.

### Verificación
* `npm test` — 17 pruebas del reparto de nombre contra la CURP, verde.
* `scripts/probar-nomina.ts` contra Postgres real — 19/19: duplicados, RFC de
  moral rechazado, CURP incompleta, NSS que no trae 11 dígitos, clave fuera del
  catálogo del SAT, INFONAVIT sin forma de descuento, candado de edición
  concurrente (409), baja anterior al ingreso, aislamiento entre empresas y los
  cuatro límites legales de los parámetros patronales.
* `tsc --noEmit` limpio en los dos lados; `vite build` OK.
* Endpoints en vivo: `/nomina/catalogos`, `/nomina/parametros` y
  `/nomina/empleados` responden; un usuario de VENTAS recibe **403**.

### Lo que se encontró probando
`fecha_baja` volvía como `2026-08-15T06:00:00.000Z`. Una DATE de Postgres llega
al driver como Date a medianoche local y al serializarse a JSON se convierte a
UTC — con el servidor en otro huso, la baja del 15 se vuelve el 14. Aquí no hay
instantes: son fechas de calendario, y el día en que alguien causó baja ante el
IMSS no puede depender de dónde corre el proceso. Las fechas salen con `TO_CHAR`
como texto `AAAA-MM-DD`, que además es lo que espera el `<input type="date">`.

### Pendiente, y por qué no se inventó
El cálculo (periodos, ISR, cuotas, subsidio) y los reportes están en blanco a
propósito. Dependen de cuatro decisiones que no me tocaba tomar solo: de dónde
salen las tarifas y la UMA, si el recibo se timbra con el PAC que ya usa la
facturación, qué periodicidades hacen falta el primer día y qué reportes se usan
de verdad. Un cálculo de nómina equivocado no se ve roto: se ve como un número.

---

## 2026-08-17 — Nómina, fase 2: parámetros por ejercicio, motor y calendario

### Las cuatro decisiones que faltaban, ya tomadas
1. Las tarifas **cambian cada año** → salen del código y entran a la base.
2. El timbrado **se queda en pre-timbre simulado**, para ver los errores del
   comprobante sin gastar timbres.
3. **Las tres periodicidades** conviven: semanal, quincenal y mensual.
4. **Todo entra** — préstamos, FONACOT, vacaciones, movimientos IMSS y
   acumulados — porque un mismo trabajador puede tener varios a la vez.

### El motor salió del navegador
En el sistema anterior `calcISPT`, `calcIMSS` y `calcINFONAVIT` vivían dentro de
`nomina.html`. Eso significa que cualquiera puede cambiar su propio ISR desde la
consola del navegador, y que dos personas con distinta versión del archivo en
caché calculan distinto. Ahora está en `backend/src/modules/nomina/motor.ts`,
sin tocar la base: recibe los parámetros del ejercicio y devuelve el recibo, de
modo que se puede probar contra casos derivados a mano.

### Las tarifas se versionan por año
`nomina_ejercicios`, `nomina_tarifa_isr` y `nomina_subsidio`. Son **globales**:
la UMA y la tarifa del Art. 96 son del país, no de la empresa — si cada empresa
tuviera la suya, dos empresas del mismo NEXO calcularían distinto el mismo
impuesto. Las edita SUPER_ADMIN.

La semilla de 2026 se copió tal cual del sistema anterior y nace
**`confirmado = false`**. Copiar no es verificar, y estos números deciden cuánto
se le retiene a cada persona: hasta que alguien los coteje contra el DOF y firme
—queda escrito quién y cuándo— la pantalla lo advierte.

`revisar()` detecta huecos entre renglones: una tarifa con un salto no truena,
simplemente deja de subir de renglón, y por eso hay que verlo antes.

### El calendario
`nomina_periodos` por (empresa, año, tipo, número). Semanal 1–53 —hay años con
53 semanas y truncar en 52 dejaría una sin poder pagarse—, quincenal 1–24,
mensual 1–12. Los días son los **del calendario**: la segunda quincena de
febrero tiene 13, no 15. Regenerar respeta los periodos ya cerrados.

### Grupo RECURSOS_HUMANOS
Ve nómina, el lector de XML —de ahí se rescata el expediente—, reportes y
mensajes. No ve facturación, clientes, almacén ni tesorería.

### El candado del registro patronal
Ya no basta con que el RFC del emisor sea el de la empresa: también tiene que
coincidir el **registro patronal** del complemento. Una misma razón social puede
tener varios registros ante el IMSS y el trabajador pertenece a uno; importarlo
bajo otro lo pondría a cotizar donde no está dado de alta. Si la empresa aún no
capturó el suyo, no hay contra qué comparar y la importación se detiene pidiendo
ese dato — que de todas formas se necesita para timbrar.

### Verificación
`npm test` — **73 pruebas verdes**. Las del ISR están derivadas a mano renglón
por renglón, no copiadas de la salida del código:

* base semanal 3,000 → mensualizada 13,028.571429 → renglón 5 →
  1,182.88 + 92.741429 × 17.92 % = 1,199.499264 → al periodo **276.20**
* base semanal 400 → el subsidio (407.02) se come el impuesto (77.749943) →
  ISR **0** y subsidio aplicado **17.90**, no los 407.02 completos

Contra el servidor en vivo: el ejercicio 2026 carga con 11+11 renglones y sin
avisos de coherencia; el calendario quincenal da 24 periodos con la segunda
quincena de febrero en 13 días; y los tres caminos del registro patronal —sin
capturar, distinto y coincidente— responden lo que deben. En el caso bueno, el
nombre "JUAN PEREZ LOPEZ" se partió contrastado contra la CURP (origen `xml`,
no `deducido`) y salieron los cuatro avisos correctos.

### Lo que encontró una prueba
`new Date('2026-02-30')` **no falla**: JavaScript lo desborda al 2 de marzo sin
decir nada. Un arranque de nómina capturado con un día inexistente se habría
corrido dos días y con él el corte de toda la plantilla. Ahora `aFecha()`
comprueba de ida y vuelta que la fecha reconstruida sea la que entró.

### Pendiente
Las pantallas: rejilla de prenómina, vista previa del CFDI, pre-timbre simulado,
cierre de periodo y los cuatro reportes (prenómina, vista previa de CFDI, ISR
por nómina, IMSS por nómina) con rango de periodos. Más préstamos, FONACOT,
vacaciones, movimientos IMSS y acumulados.

---

## 2026-08-17 (noche) — Nómina, fase 3: prenómina, cierre, CFDI y las tarifas del DOF

Cierra el ciclo que la fase 2 dejó abierto: ya se puede calcular un periodo,
revisarlo, cerrarlo y quedarse con los XML. Y los números por fin salen de
tarifas cotejadas, no copiadas.

### 1 · La rejilla dejó de resumir de más

Tenía cuatro columnas —días, ingresos, egresos, a cobrar— y con eso no se revisa
una nómina: para saber por qué a alguien le tocaron $2,096.65 había que abrir su
recibo. Ahora hay **columna permanente** para días, ingresos, otros ingresos,
total de percepciones, IMSS, ISR, préstamos, otras deducciones y neto.

El gravado y el exento se anotan **antes de sumarlos**, tanto en cada renglón
del desglose como en el pie. No es decoración: el CFDI los reporta por separado
y es contra eso que se cuadra la declaración.

Los cuatro botones de tipo de nómina pasaron de cajas altas a una línea. Cuatro
botones que sólo eligen un modo no necesitan un tercio de la pantalla.

### 2 · La prenómina se revisa en Excel

Dos hojas: la rejilla y los conceptos. Va con **lo capturado en pantalla**, no
con un recálculo que ignore lo que se acaba de teclear. Es como se revisa de
verdad: se ordena por departamento, se filtra a quien tuvo faltas, se compara
contra la semana pasada.

### 3 · El cierre, todo o nada

Congela los recibos con sus importes, abona préstamos y FONACOT, genera el XML
pre-timbre y marca el periodo — **en una sola transacción**. Un cierre a medias
es el peor estado posible: recibos guardados sin abonar los créditos, y el
trabajador pagando dos veces el periodo siguiente.

Los importes quedan **congelados**. Recalcularlos con los datos de hoy daría
otro número y dejaría sin explicación lo ya pagado.

Un índice único `(periodo, empleado)` impide dos recibos del mismo periodo: para
el SAT serían dos CFDI por el mismo pago, o sea ingreso duplicado.

### 4 · Pantalla CFDI

Los XML del cierre aterrizan ahí. Filtro por estatus, vista previa, descarga y
check de envío por correo, con los iconos del panel de facturas. **Sin timbrar**:
el PAC es un paso aparte porque cuesta timbres y deshacerlo exige cancelación
ante el SAT.

### 5 · El salario diario y el integrado venían al revés

Se mapeaba `SalarioBaseCotApor` al salario diario. Está mal **por definición**:
el SBC *es* el integrado (Art. 27 LSS). Mapear por nombre de atributo nunca iba
a salir bien. Ahora se asigna por el menor y el mayor, que es lo único que no se
puede confundir, y en la lista de empleados los dos importes van juntos y
rotulados, con aviso si el integrado quedó por debajo del diario —imposible: el
factor de integración nunca baja de 1—.

*Lo detectó el usuario mirando la pantalla, no una prueba.*

### 6 · Un ON CONFLICT sin índice detrás

El abono de créditos al cerrar usaba `ON CONFLICT (credito_id, periodo_id) DO
NOTHING` para que reintentar un cierre caído no descontara dos veces. **Ese
índice no existía.** Postgres rechazaba la sentencia con 42P10 y, peor, la
protección que el comentario prometía era ficción.

Migración `2026-08-17g`: índice único **parcial** —`WHERE periodo_id IS NOT
NULL`— para no estorbar a los abonos capturados a mano desde la pantalla de
créditos, que no cuelgan de ningún periodo y sí pueden ser varios.

*Un comentario que describe una garantía no es la garantía. Lo encontró la
primera prueba que ejecutó el cierre de verdad.*

### 7 · Las tarifas de 2026, cotejadas contra el DOF

Lo sembrado venía del sistema anterior marcado "PENDIENTE de cotejar", y **no
eran las de 2026**: la tabla mensual empezaba en `0.01 a 746.04` con cuota
`14.32` —la del ejercicio 2023— y la UMA venía revuelta, diaria `113.14` (2025)
con mensual `3,300.72` (2024). Como `113.14 x 30.4` no daba la mensual guardada,
las exenciones del Art. 93 y el tope de 25 UMA del Art. 28 LSS salían de dos
años distintos al mismo tiempo.

Se bajó el PDF oficial del SAT y se leyó. Ahora, con su fuente:

| Parámetro | Valor | Fuente |
|---|---|---|
| Tarifa Art. 96 — mensual, semanal (7 d), quincenal (15 d) | 11 renglones c/u | Anexo 8 RMF 2026, **DOF 28/12/2025**, apartado B fracc. II, IV y V (factor 1.1321) |
| Subsidio al empleo | **15.02%** de la UMA mensual, tope **$11,492.66** | **DOF 31/12/2025** |
| UMA | $117.31 diaria · $3,566.22 mensual | INEGI, **DOF 09/01/2026** |
| Salario mínimo | general **$315.04** · frontera norte **$440.87** | CONASAMI, 01/01/2026 |

**El subsidio ya no es una escalera.** Desde el decreto de 2024 es un importe
único hasta un tope; la revisión de coherencia seguía tratándolo como tabla de
once renglones, le exigía terminar sin techo —cuando el techo **es** el tope de
ingresos— y levantaba un aviso falso.

**Enero de 2026 no calcula igual.** El transitorio segundo manda **15.59%**
durante enero, porque la UMA se actualiza hasta febrero. Un renglón por año no
puede representar eso: el subsidio ganó vigencia por fechas y `cargar()` toma el
último día del periodo para elegir el renglón. Sin esto, un finiquito de enero
se calcularía con el subsidio de febrero. La revisión ahora agrupa por vigencia
—antes leía las dos como escalones consecutivos y reportaba un salto de
−11,492.65—.

**$535.65, no $536.22.** Los considerandos del decreto dicen 536.22, pero se
publicaron el 31 de diciembre, antes de que el INEGI diera la UMA el 9 de enero:
ese número sale de una UMA estimada de 117.43 y la real quedó en 117.31. Lo que
obliga el artículo es el **porcentaje** —"la cantidad que resulte de multiplicar
el valor mensual de la UMA por 15.02%"—, no la cifra de la exposición de
motivos. Se guarda el porcentaje junto al importe para poder rederivarlo cuando
la UMA se mueva, en vez de dejarlo congelado.

**Confirmado por el usuario el 2026-08-17**: se queda **$535.65**, "el que marca
la ley". Los 57 centavos de diferencia contra los considerandos no se adoptan.

**Consecuencia real**: para los 10 trabajadores de la prueba el ISR bajó de
**$1,796.20 a $466.32**. No es redondeo: con el tope del subsidio en $11,492.66
los diez caen dentro y les toca subsidio, cosa que con la tabla de 2023 casi
nadie alcanzaba.

### Verificación

Todo contra Postgres real, dejando la base como estaba.

* `npm test` — **108 unitarias**
* `scripts/probar-nomina.ts` — **19** (expediente, índices, concurrencia)
* `scripts/probar-cierre.ts` — **25** (el préstamo baja una sola vez, no se
  cierra dos veces, el XML declara CFDI 4.0 + nomina12 1.2 sin
  `TimbreFiscalDigital`, `Total` = neto y `Descuento` = deducciones)
* `scripts/probar-tarifas-2026.ts` — **15**

De esas 15, la que importa: **cada cuota fija debe ser el impuesto acumulado del
renglón anterior**. Es la prueba que caza un dígito volteado al transcribir 33
renglones a mano. Y el ISR se compara contra la aritmética del Art. 96 hecha
aparte:

```
420.95 + (10,223.22 - 7,168.52) x 10.88% = 753.30 mensual
menos subsidio 535.65 = 217.65 ; entre 4.342857 = 50.12 semanal
motor: 50.12  OK
```

La exención del salario mínimo se prueba por los **dos** lados: al mínimo no
retiene, y con cualquier otro ingreso gravado la pierde (Art. 93 Fr. XIV exime
al trabajador, no al concepto). La primera versión de esa prueba llamaba a
`calcularIsr` —aritmética pura del Art. 96— y por eso "fallaba": la exención
vive en `calcularRecibo`.

### Lo que costó una vuelta completa

El usuario reportó tres veces "no veo los cambios" con la pantalla vieja
enfrente. Ninguna era del código:

1. **El backend local llevaba una hora corriendo** y no tenía las rutas nuevas.
2. **`.claude/launch.json` decía puerto 5174** y `vite.config.ts` usa 5173.
3. **Se empujó a `origin/erp-unificado`, y Render construye `GDM_ALMACEN/main`.**
   Producción llevaba tres commits de retraso. El push de despliegue es
   `git push gdmalmacen erp-unificado:main` y **corre en la PC, no en el shell
   de Render** —allá el checkout sólo tiene `main` y responde
   `src refspec erp-unificado does not match any`—.

*Antes de dudar del código, comprobar que lo que el usuario mira sea el código.*

### Pendiente

**Reportes** es lo único del menú de Nómina sin construir: prenómina, vista
previa de CFDI, ISR por nómina e IMSS por nómina, con rango 1 a 53 / 1 a 24.

Y dos cosas que bloquean operar de verdad: la empresa **no tiene capturado su
registro patronal del IMSS** —sin él se calcula pero no se timbra— y el
**timbrado ante el PAC** sigue desconectado por decisión.

## 2026-08-20 — Plan de Contabilidad (diseño, sin código)

Se analizaron `GDM_NEXO_ana_contable.md` y `Catalogo_cTAS.md` (Anexo 24 RMF 2026).
Resultado: [PLAN_CONTABILIDAD.md](PLAN_CONTABILIDAD.md) — plan de 9 fases y bosquejo
de pólizas, depreciaciones y estados financieros.

**Correcciones al análisis** (se hizo sobre un ZIP anterior):
- Nómina NO está pendiente: `nomina_recibos` y el motor ya existen completos.
- Tesorería NO hay que reconstruirla: `bancos_cuentas/estados_cuenta/movimientos`
  ya son las `bank_accounts/bank_statement_*` que el análisis proponía crear.
- `nomina_imports` es ingesta de CFDI de terceros, no la nómina propia.

**Cambio de orden respecto al análisis:** catálogo y pólizas manuales ANTES del
motor de eventos. Una póliza automática no se valida sin poder leer una balanza.

Pendiente: 4 decisiones (buzón vs interna, numeración, saldos iniciales,
EDOSFINANCIEROS) antes de codificar la Fase 1.

## 2026-08-20 — Contabilidad FASE 1: catálogo de cuentas

**Migraciones:** `2026-08-20a_accounting_core.sql`, `2026-08-20b_grupo_contabilidad.sql`

Tablas nuevas: `nif_normas`, `sat_codigos_agrupadores`, `accounting_fiscal_years`,
`accounting_periods`, `accounting_accounts`, `accounting_account_equivalences`,
`company_accounting_settings`.

**679 códigos del Anexo 24 sembrados** (136 mayores + 543 subcuentas), con su
clasificación NIF. Se reportan ~347 subcuentas que el resumen NO detalla nombre
por nombre: NO se inventaron. Para completarlas hace falta el archivo oficial del SAT.

**Decisiones aplicadas:**
- `codigo` y `codigo_agrupador` son DOS columnas aunque hoy valgan lo mismo.
  Probado: re-numerar a `1102-001` deja el agrupador en `102.01`.
- `accounting_account_equivalences` permite empatar VARIOS catálogos externos.
- `es_complementaria` para contra-cuentas (171, 108, 116, 402, 503).

**Bugs encontrados y corregidos durante el desarrollo:**
- El fin de ejercicio salía ANTES del inicio cuando arrancaba en enero.
  Lo cazó el CHECK `fy_fechas` de la migración.
- El CHECK de `users.work_group` no conocía CONTABILIDAD: dar de alta al
  contador habría fallado. Lo cazó `probar-grupos-de-trabajo`.
- 402 y 503 no estaban marcadas como complementarias. Lo cazó la propia
  pantalla de revisión del catálogo.

Grupo de trabajo CONTABILIDAD + capacidades `contabilidad:catalogo|capturar|
asentar|cerrar`. `contabilidad:cerrar` NO se hereda por ser MANAGER.

Pruebas: `probar-contabilidad` 49/49, `probar-grupos-de-trabajo` 35/35.

Siguiente: FASE 2 — pólizas manuales y carga de la balanza anterior
(pendiente el archivo: viene en Excel y PDF).

## 2026-08-20 — Lector de balanzas (Excel y PDF)

`balanza-lector.service.ts` + `probar-balanza` (30/30).

Ruta `POST /accounting/balanza/analizar`: lee y revisa SIN guardar. Una balanza
que no cuadra no puede ser el saldo inicial de nada, y enterarse después
significa deshacer una póliza de apertura de cientos de renglones.

**Lo que enseñó el archivo real (PROKINESPORT, 343 cuentas):**

1. La fórmula del saldo final DEPENDE de la naturaleza:
   deudora `si+debe-haber`, acreedora `si-debe+haber`. Con una sola fórmula,
   110 renglones perfectos parecen mal capturados.
2. Una cuenta es HOJA si nadie cuelga de ella — NO por su código. `5-05-10-000`
   termina en -000 y es hoja: con la heurística del sufijo se pierden
   $7,517,589.43 de costos y la balanza parece descuadrada por 7 millones
   en vez de por 20 pesos.
3. Las sumarias no se suman: el archivo trae los dos niveles mezclados.

**El PDF sale sin separadores** (`-382.000.000.00-382.00` son 4 importes) y con
nombres partidos en 3 líneas. Se resuelve por los 2 decimales fijos + acumular
hasta juntar 4 importes.

**Ambigüedad real:** si el nombre acaba en dígitos se pegan al primer importe
(`...2024` + `1,653,827.35` → `20241,653,827.35`). El formato admite varias
lecturas válidas; NO se adivina. Se resuelve con la propia aritmética del
renglón, y si ninguna o varias cuadran, se avisa.

**Verificación:** los dos archivos son la MISMA balanza en dos formatos.
Los 343 renglones coinciden centavo por centavo entre PDF y Excel.

Los archivos de ejemplo NO están en el repositorio: son contabilidad real de
un tercero. La prueba se salta sola si no están.

## 2026-08-20 — Mapeador: acomodar catálogos ajenos sobre la base del SAT

`mapeador-sat.service.ts` + `probar-mapeo-sat` (20/20). Conectado a
`POST /accounting/balanza/analizar`: la misma respuesta dice si cuadra Y dónde
cae cada cuenta.

**La idea, en una línea:** el nombre de una cuenta HOJA dice quién es el
tercero; el de su cuenta PADRE dice qué es la cuenta. Sólo el segundo mapea.

El caso que lo demuestra está en la balanza real: `AFIRME` aparece DOS VECES —
bajo BANCOS (102.01, activo) y bajo ACREEDORES DIVERSOS (205, pasivo). Un mapeo
por nombre manda el pasivo al activo, y la balanza sigue cuadrando: sólo que del
lado que no era. Igual `BANCO DEL BAJÍO S.A.` que es un PROVEEDOR → 201.01.

Excepción: en los grupos 601-604 la hoja SÍ es un concepto (UNIFORMES → 601.77).

**Resultado sobre la balanza real:** 340 de 343 cuentas acomodadas, 0 conflictos,
y ninguna cuenta cambió de lado del balance. Las 3 sin mapear son encabezados
puros sin saldo propio (CIRCULANTE, DIFERIDO, PASIVO A CORTO PLAZO).

**Propone, no aplica.** Cada cuenta lleva confianza (ALTA/MEDIA/BAJA/CONFLICTO)
y su razón. Un mapeo equivocado no se ve: la balanza cuadra igual.

**Bugs corregidos:** el padre se elegía por longitud de código y no por
especificidad (AFIRME colgaba de CIRCULANTE en vez de BANCOS); el comodín de
ventas estaba antes del bloque de costos y se llevaba `COSTO DE VENTA` al 401;
y un heredoc de Python metió bytes 0x08 literales donde debía ir `\b` en los
regex — se añadió barrido de caracteres de control al repo.

## 2026-08-20 — Un tercero puede tener VARIOS roles

**Migración:** `2026-08-20c_tercero_varios_roles.sql`

Un banco es activo y pasivo a la vez: mi dinero depositado, y el crédito que él
me dio. Un cliente puede venderme algo. En la balanza real, `AFIRME` está en
102 Bancos Y en 205 Acreedores diversos — es el mismo banco.

**Era imposible de representar**, y no por descuido:
```
CHECK (party_type IN (CUSTOMER, SUPPLIER))   ← un solo rol
UNIQUE (company_id, rfc)                      ← un solo registro por RFC
```
Las dos juntas cerraban la puerta: ni marcar los dos roles, ni crear otro
registro. `cfdi-import` ya chocaba con esto y reventaba con "El RFC ya está
registrado como SUPPLIER", sin salida.

**Ahora:** banderas `es_cliente`, `es_proveedor`, `es_acreedor`, `es_deudor`.
`party_type` queda como columna DERIVADA que mantiene un trigger (CUSTOMER /
SUPPLIER / BOTH / OTHER), para el código que aún la lee.

**No se quitó el UNIQUE del RFC, a propósito.** Duplicar al tercero es la salida
fácil y la peor: dos expedientes del mismo banco editados por separado, sin
forma de saber cuál manda. Un tercero, un registro, varios roles.

**Cambio de comportamiento:** dar de alta como cliente a un RFC que ya existe
como proveedor le AGREGA el rol y devuelve el mismo tercero. Antes era error.
Dar de alta el MISMO rol dos veces sigue siendo conflicto.

Se cambiaron 10 archivos: los filtros `party_type = SUPPLIER` pasaron a
`es_proveedor`. Guarda en `probar-tercero-varios-roles` que barre las 200
fuentes y falla si alguien vuelve a filtrar por party_type (distingue filtrar
de leer).

**Regla contable que esto NO cambia:** un solo tercero no significa un solo
saldo. Lo que el banco me debe va en el activo y lo que le debo en el pasivo,
sin restarse. Compensar está prohibido salvo derecho legal (NIF A-7 y C-19), y
esconde a la vez la liquidez y la deuda.

Pruebas: roles 15/15 · mapeo 20/20 · balanza 30/30 · contabilidad 49/49 ·
grupos 35/35 · nómina 19/19 · reportes 29/29 · bancos 57/57 · preregistro 18/18
· jest 115/115

## 2026-08-20 — Motor NIF funcionando

**Migración:** `2026-08-20d_motor_nif.sql` · `nif_reglas`, `nif_evaluaciones`,
`nif_hallazgos` + columna `nif_aplica` en el catálogo del SAT y en las cuentas.

**El aviso de "50 cuentas sin norma NIF" era el síntoma de un modelo de dos
estados.** Hacen falta tres:

- `ESPECIFICA` — le toca una NIF concreta. 115 Inventario → C-4. (399)
- `NO_APLICA` — correctamente no tiene ninguna. IVA, IEPS y retenciones no son
  instrumentos financieros (esos nacen de un contrato; el impuesto de la ley)
  ni impuestos a la utilidad (D-4 cubre ISR y PTU). (260)
- `DEPENDE` — no se sabe sin ver qué hay dentro: "otros activos". (20)

Marcar el IVA como C-3 para vaciar la lista habría hecho que el motor le
exigiera estimación de pérdida crediticia a un saldo que se compensa contra el
propio impuesto. El aviso pasó de 50 cuentas irresolubles a 9 reales.

**13 reglas, versionadas.** Cada hallazgo guarda con qué versión se emitió.
Corren sobre la balanza —que ya existe— y no esperan a las pólizas: un motor
que sólo funciona con datos que no existen no se puede probar.

Sobre la balanza real encuentra: $2,490,817 de cartera sin estimación de
incobrables (C-3), $2,911,788 de bancos sobregirados presentados como activo
negativo en vez de pasivo (C-1), y 63 cuentas con saldo contrario a su
naturaleza (A-7).

**Bug de fondo corregido:** el 703 del Anexo 24 guarda gastos financieros
(703.01-11) Y productos financieros (703.12-21). La regla de la ecuación
trataba todo el 703 como gasto, así que un ingreso por intereses se restaba en
vez de sumarse — el error entraba dos veces. Ahora el resultado se arma por
NATURALEZA, no por el dígito del agrupador.

Verificación fuerte: el motor NIF y el analizador de balanza calculan la
diferencia de la ecuación por caminos distintos y dan lo mismo ($20.14).

Otras correcciones: C-3 mide la EXPOSICIÓN (suma de saldos deudores) y no el
neto — con el neto pedía estimar una cartera negativa. C-6 excluye terrenos.
Una regla que revienta se reporta y las demás siguen.

Pruebas: nif 28/28 · mapeo 20/20 · balanza 30/30 · contabilidad 49/49 ·
roles 15/15 · grupos 35/35 · nómina 19/19 · reportes 29/29 · bancos 57/57 ·
preregistro 18/18 · jest 115/115

## 2026-08-20 — Estados financieros en submenú de Contabilidad

**Cambio de decisión:** en el plan se eligió "NEXO alimenta, EDOSFINANCIEROS
presenta". Ahora los estados van DENTRO de NEXO. Ésta es la decisión vigente.

### Paso 1 · Catálogo SAT + NIF, cerrado

405 con NIF específica · 260 sin NIF aplicable · 14 que dependen del contenido.
37 normas (se agregaron A-3 y B-4, que pide el documento de estados).

**Bug corregido:** `160 Otros activos fijos`, `169 Otra maquinaria` y `182 Otros
activos diferidos` SÍ tenían norma (C-6, C-6, C-8) y la clasificación se la
borraba al mandarlas a DEPENDE. La palabra "otros" en el nombre no vuelve
ambigua a una cuenta cuyo rubro es inequívoco. Se agregó una red de seguridad
que avisa si una cuenta pierde su clasificación.

### Estados financieros (§2 del documento)

`estados-financieros.service.ts` + `probar-estados-financieros` (23/23).
Ruta `POST /accounting/estados-financieros`, pantalla en Contabilidad →
Estados financieros.

- Situación financiera (B-6) con el mapeo por código agrupador del §2.1
- Resultado integral (B-3) con la fórmula del §2.2
- 13 razones, cada una con fórmula, cifras base e interpretación
- Análisis vertical y horizontal comparando dos balanzas
- Los hallazgos NIF, en la misma pantalla

**Tres defectos corregidos antes de darlo por bueno:**
1. `Margen bruto 38%` cuando es `37.86%` — el helper de división redondeaba a
   2 decimales ANTES de multiplicar por 100. El redondeo va al presentar.
2. `DSO −16 días` con cartera negativa. "Se tarda −16 días en cobrar" no
   significa nada; ahora dice que un saldo de clientes negativo son anticipos.
3. El ciclo de efectivo se armaba con las piezas que sí había, y el resultado
   se veía como un dato bueno.

El 703 se parte por NATURALEZA, igual que en el motor NIF: por código, un
producto financiero se restaría como gasto.

Verificación: el activo del estado y la diferencia de la ecuación coinciden con
las del analizador de balanza, que llega por otro camino.

Pruebas: estados 23/23 · nif 28/28 · mapeo 20/20 · balanza 30/30 ·
contabilidad 49/49 · roles 15/15 · grupos 35/35 · nómina 19/19 ·
reportes 29/29 · bancos 57/57 · preregistro 18/18 · jest 115/115

## 2026-08-20 — Cascarones: cada estado su menú, alimentados por periodo

**Migración:** `2026-08-20e_saldos_por_periodo.sql`

La pantalla anterior estaba mal planteada: "sube un archivo → mira un reporte"
es un visor, no una contabilidad. Se cierra y no queda nada.

**Ahora los estados leen EL PERIODO**, y el periodo se alimenta de varias
fuentes en momentos distintos:
```
balanza de otro sistema ─┐
CFDI emitidos           ─┤
CFDI recibidos          ─┼─► saldos del periodo ─► todos los estados
nómina timbrada         ─┤
pólizas capturadas      ─┘
```
El día que los XML generen pólizas, escriben ahí y las mismas pantallas se
llenan solas. No hay que tocar ningún estado.

### Ocho menús en Contabilidad

Catálogo de cuentas · Periodos y cierre · Balanza de comprobación ·
Situación financiera (B-6) · Resultado integral (B-3) · Flujos de efectivo
(B-2) · Cambios en el capital (B-4) · Razones y análisis.

Cada estado EXISTE siempre, tenga datos o no. Un mes vacío muestra qué falta
y de dónde puede venir — NO ceros. Un estado en ceros parece una empresa
quieta, y eso es una afirmación que nadie hizo.

**B-2 y B-4 son nuevos** y exigen dos periodos: el flujo se lee de variaciones,
no de saldos. Cuando falta el mes anterior lo dicen en vez de devolver ceros.

### El corte mensual

Cerrar congela los saldos. Cuatro candados:
- No se cierra un mes que no cuadra (congelaría el descuadre para siempre).
- No se cierra un mes vacío.
- No se cierra con meses anteriores abiertos y cargados.
- No se reabre con meses posteriores cerrados.

Y el candado vive en la BASE, no en el servicio: probado con un UPDATE directo
por SQL, que también se rechaza.

**Recargar reemplaza, no acumula.** Probado: los cargos siguen en la misma
cifra tras cargar dos veces.

**Un hueco es un mes vacío ENTRE dos meses con datos.** Los anteriores al
primero cargado no son huecos, son antes de empezar — marcarlos llenaba el
aviso de cinco falsos positivos.

Se retiró la pantalla y la ruta de "sube y mira": dos caminos que calculan lo
mismo terminan diciendo cosas distintas.

Pruebas: periodos 20/20 · estados 23/23 · nif 28/28 · mapeo 20/20 ·
balanza 30/30 · contabilidad 49/49 · roles 15/15 · grupos 35/35 ·
nómina 19/19 · reportes 29/29 · bancos 57/57 · jest 115/115

## 2026-08-20 — Descarga del SAT: diaria automática, ejercicios y cupo

**Migración:** `2026-08-20f_descarga_programada.sql`

### Tres problemas encontrados al revisar el motor

**1. NADA creaba trabajos.** El cron corría cada 15 min pero sólo AVANZA
trabajos existentes. Nunca creaba el del día. "Descargar a diario" dependía de
que alguien entrara y pulsara el botón; los días que nadie entra no había CFDI,
y ese hueco se descubre meses después.

**2. Pedir dos veces el mismo rango.** `crearTrabajo` no miraba si ya había un
trabajo vivo sobre esas fechas. Dos clics = dos trabajos = solicitudes
duplicadas al SAT. En la captura de pantalla se ven dos renglones idénticos de
`01/08 → 19/08 recibidos`. Gastar cupo dos veces en el mismo rango deja sin
cupo a un rango que sí falta.

**3. "Sin datos" y "rechazada" se veían igual.** `particiones_listas` sumaba
TERMINADA + SIN_DATOS + DIVIDIDA + RECHAZADA + FALLIDA en un solo número. La
pantalla decía "4/5" y no había forma de saber si el SAT contestó bien sin
comprobantes o si rechazó — que es lo único que importa con una e.firma de
prueba.

### Lo que se construyó

- **Cron diario a las 6:00 (CDMX)** que crea el trabajo del día. A las 6 y no a
  medianoche: el SAT tarda en publicar lo del día que acaba de cerrar.
- **Ventana de 3 días atrás**, no sólo ayer. Un CFDI timbrado el 30 a las 23:50
  no está disponible el 1 a las 6. El traslape cuesta poco (se descarta por UUID)
  y cierra el hueco.
- **Ejercicio completo, mes por mes.** Un rango de 12 meses topa el límite del
  SAT y obliga a partir, quemando el triple de cupo. Mes por mes además deja ver
  cuál falta.
- **Presupuesto diario:** 2,000 XML y 40 solicitudes. Frena las solicitudes
  NUEVAS, no lo que está en vuelo — un paquete caduca a las 72 h.
- **Índice único sobre trabajos VIVOS** + detección de traslape con mensaje claro.
- **Panel nuevo** que separa resueltas / en vuelo / atoradas, con el motivo
  textual de cada rechazo y el cupo del día.

Pruebas: descarga 22/22 · periodos 20/20 · estados 23/23 · nif 28/28 ·
mapeo 20/20 · balanza 30/30 · contabilidad 49/49 · roles 15/15 ·
grupos 35/35 · nómina 19/19 · reportes 29/29 · bancos 57/57 · jest 115/115

## 2026-08-20 — Migraciones que sobreviven a los datos que ya existen

El despliegue en Render abortó: las migraciones fallaron. Pasaban en local y
fallaban allá, y la diferencia no era el código — era que Render TIENE datos.

**Una migración probada sólo contra una base limpia no está probada.**

### Los dos puntos de fallo

**1. `ux_trabajo_vivo_por_rango` (2026-08-20f).** Crear un índice ÚNICO sobre
una tabla que ya tiene duplicados falla. Y duplicados había: el bug que ese
índice viene a impedir llevaba tiempo creándolos — se ven dos renglones
idénticos de `01/08 → 19/08 recibidos` en la captura de pantalla.

Ahora la migración cancela los duplicados ANTES de crear el índice. Conserva el
que más avanzado va (más particiones resueltas) y a igualdad el más antiguo: es
el que ya tiene solicitudes en vuelo ante el SAT. No los borra — los marca
CANCELADO con el motivo.

**2. `chk_tercero_con_rol` (2026-08-20c).** El relleno cubre a quien traía
party_type CUSTOMER o SUPPLIER, pero la columna admitía NULL (un CHECK no
rechaza NULL, sólo FALSE). Las filas viejas sin party_type quedaban sin rol, y
un CHECK normal recorre TODA la tabla al crearse.

Ahora es `NOT VALID`: aplica a todo lo nuevo, no escanea lo viejo. La
alternativa era adivinar —marcar como cliente a quien no tuviera rol— y un
proveedor mal marcado se cuela en la lista de clientes sin que nadie lo note.

### Un tercer fallo que casi introduzco arreglando el segundo

`UPDATE customers SET es_cliente = es_cliente` (sincronización de party_type)
tocaba TODAS las filas. `NOT VALID` exime del escaneo inicial pero NO de los
UPDATE posteriores: esa línea habría estrellado las filas sin rol contra el
CHECK recién creado, tumbando la migración por el arreglo que la iba a salvar.
Ahora está filtrado.

Prueba nueva `probar-migraciones-tolerantes` (13/13): reproduce a propósito las
dos condiciones que rompen, comprueba que el SQL a secas FALLA, y que el
corregido pasa.

## 2026-08-20 — La descarga diaria, a prueba de reinicios

Un cron con una sola oportunidad al día es frágil: si el servicio reinicia a
las 6:00 —un despliegue, un reinicio de Render— ese día se pierde entero y
nadie se entera hasta que alguien note el hueco meses después.

**`crearTrabajoDiario` ahora es idempotente POR DÍA.** Antes miraba si había un
trabajo VIVO sobre el rango, y eso tiene un agujero: en cuanto el trabajo del
día TERMINA, la comprobación pasa y se crearía otro. Llamándolo cada 15 minutos
serían decenas al día.

Mirando si ya se creó uno HOY, se puede llamar desde cualquier reloj sin miedo.
Por eso ahora se llama desde tres lados:
- El cron de las 6:00 (hora predecible).
- El cron de cada 15 minutos (la red).
- Al arrancar el servicio, 20 s después (por si reinició a media mañana).

El primer tick que encuentre el día sin trabajo lo crea; los 95 restantes no
hacen nada. Y "ya se creó hoy" NO se registra en la bitácora: en 95 de 96 ticks
es lo normal, y escribirlo taparía los avisos reales.

**Bug propio corregido:** metí `*/15 * * * *` dentro de un comentario `/* */`.
El `*/` de la expresión cron cierra el comentario. La expresión vive en el
código y el comentario la describe con palabras.

Pruebas: descarga 24/24 · migraciones 13/13 · periodos 20/20 ·
contabilidad 49/49 · jest 115/115
