# PLD / Antilavado (LFPIORPI) — Análisis y plan de integración a NEXO

> Base documental (archivos del usuario, en `E:\Banco\`):
> 1. **LFPIORPI.pdf** — *Ley Federal para la Prevención e Identificación de Operaciones con Recursos de
>    Procedencia Ilícita*. Última reforma **DOF 16-07-2025**.
> 2. **REGLAS-LFPIORPI-07.08.2026-EBR-2.pdf** — *Reglas de Carácter General* (RCG), vigentes 07-08-2026.
> 3. **CompiladoRLFPIORPI160813y270326.pdf** — *Reglamento* de la LFPIORPI (DOF 16-08-2013, reformas al 27-03-2026).
>
> Jerarquía: **Ley → Reglamento → Reglas de Carácter General**. La Ley dice *qué* se vigila y los umbrales; el
> Reglamento y las Reglas, *cómo* (expediente, alta en el padrón, formato y presentación de Avisos por el Portal).
> La autoridad: **UIF (SHCP)**; el **SAT** administra el padrón y recibe los Avisos por su **Portal** (SPPLD).

---

## 1. ¿A quién le aplica?

Aplica a quien realiza una **Actividad Vulnerable** del **Art. 17** (fuera del sistema financiero, que va por el
Art. 14). GRUPO HCGM presta contabilidad/ERP: **el obligado es cada CLIENTE** que realice una de estas actividades,
no HCGM por sí mismo (salvo que HCGM preste alguno de esos servicios). NEXO debe permitir **marcar por empresa** qué
actividad vulnerable realiza (si alguna) y, con eso, activar el módulo PLD sólo para quien aplica.

De las del Art. 17, las que **probablemente** tocan a clientes de una contabilidad PyME:
**IV** préstamos/mutuo · **V / V Bis** construcción e inmobiliaria · **VI** metales/joyas · **VIII** vehículos ·
**XI** servicios profesionales (por cuenta del cliente) · **XIII** donativos (A.C./S.C.) · **XV** arrendamiento de
inmuebles · **XVI** activos virtuales. Las demás (juegos, tarjetas, fe pública, aduanas, blindaje, traslado de
valores) aplican a giros específicos.

---

## 2. Umbrales por actividad (Art. 17) — en **UMA** (valor diario)

Dos umbrales por actividad: **Identificación** (integrar expediente) y **Aviso** (reportar a la UIF). Por **debajo**
del umbral de la actividad **no hay obligación**. Entre identificación y aviso: sólo expediente. Arriba del de aviso:
expediente **+** Aviso. *(La reforma 2025 pasó muchos montos a UMA.)*

| Art. 17 | Actividad | Identificación ≥ | Aviso ≥ |
|---|---|---|---|
| I | Juegos con apuesta, concursos, sorteos | 325 UMA | 645 UMA |
| II a) | Tarjetas de servicios/crédito (no financieras) | 805 UMA (gasto mensual) | 1,285 UMA |
| II b) | Tarjetas prepagadas | 645 UMA/op | 645 UMA |
| II c) | Monederos / almacenamiento de valor | 645 UMA/op | 645 UMA |
| III | Cheques de viajero | (identif. general) | 645 UMA |
| **IV** | **Mutuo / préstamos / créditos** (no financieras) | siempre | **1,605 UMA** |
| **V** | **Construcción / desarrollo / intermediación inmobiliaria** | siempre | **8,025 UMA** |
| V Bis | Recepción de recursos para un desarrollo inmobiliario | siempre | 8,025 UMA |
| **VI** | **Metales, piedras preciosas, joyas, relojes** | 805 UMA | 1,605 UMA |
| VII | Obras de arte (subasta/comercialización) | 2,410 UMA | 4,815 UMA |
| **VIII** | **Vehículos** (aéreos, marítimos, terrestres; nuevos/usados) | 3,210 UMA | 6,420 UMA |
| IX | Blindaje (vehículos / inmuebles) | 2,410 UMA | 4,815 UMA |
| X | Traslado o custodia de dinero/valores | — | 3,210 UMA (o **siempre** si no se puede determinar) |
| **XI** | **Servicios profesionales** por cuenta del cliente (inmuebles, manejo de recursos/cuentas, constitución de sociedades) | siempre | al realizar la operación **en nombre** del cliente |
| XII | Fe pública (notarios/corredores) | por acto | inmuebles ≥8,000 UMA; fideicomisos ≥4,000; **poderes irrevocables y constitución de sociedades = siempre**; avalúos ≥8,025 |
| **XIII** | **Donativos** (A.C./S.C. sin fines de lucro) | 1,605 UMA | 3,210 UMA |
| XIV | Comercio exterior (agente aduanal) | por tipo de bien (vehículos/máquinas de juego/equipos de tarjetas = cualquier valor; joyas ≥485; arte ≥4,815) | **en todos los casos** |
| **XV** | **Arrendamiento de inmuebles** | 1,605 UMA/mes | 3,210 UMA/mes |
| XVI | Activos virtuales (cripto, no financieras) | — | operación ≥210 UMA; contraprestación ≥4 UMA |

> **Referencia de pesos** (ilustrativa, con UMA 2025 = $113.14): aviso inmobiliario 8,025 UMA ≈ **$907,900**;
> aviso préstamos 1,605 UMA ≈ **$181,600**; aviso vehículos 6,420 UMA ≈ **$726,400**. **NEXO debe multiplicar por
> la UMA vigente** (ya la tiene en `nomina_ejercicios.uma_diaria`, cotejada DOF), no por un valor fijo.

> **Regla de acumulación (Art. 17, último párrafo):** aunque cada operación quede por debajo, si en **6 meses** la
> suma con un mismo cliente rebasa el umbral de Aviso, **se reporta**. El módulo debe acumular por cliente.

---

## 3. Obligaciones (Art. 18, 20, 23 de la Ley · Reglas)

1. **Identificar y conocer al cliente** y armar el **Expediente Único de Identificación** (Reglas Art. 12 + **Anexo 3**
   persona física / **Anexo 2** persona moral). Incluye **Beneficiario Controlador** de las personas morales
   (Art. 18 fr. III; Art. 33 Bis).
2. **Alta/registro en el padrón** ante el SAT, por el **Portal** (RFC + **e.firma/FIEL**). Actualizar cambios ≤6 días
   hábiles (Reglas Art. 7).
3. **Representante Encargado del Cumplimiento** (Art. 20): las **personas morales** lo designan ante la Secretaría y
   lo mantienen vigente (acepta la designación en el Portal con su e.firma).
4. **Presentar Avisos** (Art. 23): **mensuales**, **a más tardar el día 17** del mes inmediato siguiente a la
   operación, por el **Portal**, en el **formato oficial** (archivo electrónico / XML con la herramienta del Portal).
5. **Resguardo 10 años** (Art. 18 fr. IV — **la reforma 2025 lo subió de 5 a 10 años**) de la identificación y de los
   actos/operaciones reportados.
6. **Restricciones de efectivo** (Art. 32): límites para liquidar ciertas operaciones en efectivo (p. ej. inmuebles,
   vehículos, joyas) — útil como alerta.

---

## 4. Plan de integración a NEXO (módulo PLD)

Reaprovecha lo que NEXO ya tiene: **CFDI/operaciones**, **terceros/clientes**, **UMA** (`nomina_ejercicios`),
**e.firma/FIEL**, el patrón de **reportes** y el **gating por módulo**.

1. **Config PLD por empresa** (`pld_config`): ¿realiza actividad vulnerable? + **fracción Art. 17** + umbrales
   (se calculan solos = monto_UMA × UMA vigente) + **Representante de Cumplimiento** + datos de alta en el padrón.
2. **Expediente Único de cliente** (`pld_expediente`, ligado a `customers`/terceros): captura de datos y documentos
   del Anexo 3/2 + **Beneficiario Controlador** (PM). Checklist de completitud.
3. **Detección sobre operaciones**: cruzar CFDI emitidos / contratos contra los umbrales de la fracción activa →
   marca las operaciones que exigen **identificación** y las que exigen **Aviso**; **acumulador de 6 meses** por
   cliente; tablero "por reportar".
4. **Generación del Aviso**: armar el **archivo/XML** del formato oficial del Portal para el periodo (operaciones del
   mes) listo para subir. (La **presentación** se hace en el **Portal del SAT con e.firma**, como la descarga masiva;
   no hay API pública de avisos — SatGo tampoco la expone en su Swagger.)
5. **Calendario y alertas**: recordatorio antes del **día 17**; semáforo de pendientes.
6. **Resguardo 10 años**: conservar expediente + avisos + acuses.

**Lo que NEXO hace vs. lo que el usuario hace en el Portal:** NEXO = expediente + detección + **generar el XML** del
Aviso + calendario + resguardo. Usuario = **alta en el padrón** y **subir el Aviso** en el Portal del SAT con su
e.firma (igual que hoy firma el contrato o baja XML).

---

## 5. Lecturas recomendadas (dónde está cada cosa)

- **Ley (LFPIORPI.pdf):** **Art. 17** (actividades vulnerables y umbrales) · **Art. 18** (obligaciones, expediente,
  resguardo 10 años) · **Art. 20** (Representante de Cumplimiento) · **Art. 23** (Aviso día 17) · **Art. 32**
  (efectivo).
- **Reglas (REGLAS-…2026):** **Art. 12 + Anexos 2/2 Bis/3** (expediente único) · **Arts. 4, 7, 10** (alta/registro y
  actualización en el Portal con e.firma) · definición de **Portal en Internet** (formatos por DOF).
- **Reglamento (Compilado):** procedimiento de Avisos, Informes y detalle operativo.

Fuentes oficiales para la versión vigente: `diputados.gob.mx` (Ley), `dof.gob.mx` (Reglas/Reglamento),
`sppld.sat.gob.mx` (Portal/padrón/avisos).

---

## 6. Pendiente de decisión (para dimensionar el módulo)

**¿Cuáles de las actividades del Art. 17 realizan los clientes de HCGM que entrarían a NEXO?** De eso depende qué
fracciones y formatos de Aviso se implementan primero. Sugerencia de arranque por lo más común en PyME: **IV
(préstamos)**, **V (inmobiliaria)**, **XV (arrendamiento)** y **XI (servicios profesionales)**.
