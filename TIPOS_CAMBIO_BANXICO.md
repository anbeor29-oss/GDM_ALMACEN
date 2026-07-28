# TIPOS_CAMBIO_BANXICO.MD

# Servicio Central de Tipos de Cambio
## ERP HCGM Advisors

**Versión:** 1.0  
**Módulo:** Facturación CFDI 4.0  
**Estado:** Diseño Base  
**Prioridad:** Alta

---

# Objetivo

Desarrollar un servicio centralizado encargado de administrar los tipos de cambio utilizados por el ERP para la emisión de CFDI en moneda extranjera.

Inicialmente el sistema soportará únicamente:

- Peso Mexicano (MXN)
- Dólar Americano (USD)
- Euro (EUR)
- Libra Esterlina (GBP)

Este servicio será utilizado por todos los módulos del ERP que requieran convertir importes entre monedas.

Posteriormente será consumido por el módulo de Timbrado CFDI.

---

# Objetivos específicos

- Consultar diariamente el tipo de cambio oficial.
- Guardar histórico diario.
- Evitar consultar Banxico cada vez que se facture.
- Permitir actualizar manualmente.
- Utilizar siempre el tipo de cambio vigente al momento de emitir el CFDI.
- Tener una sola fuente de información para todo el ERP.

---

# Monedas soportadas

| Moneda | Código SAT | Código ISO |
|----------|------------|------------|
| Peso Mexicano | MXN | MXN |
| Dólar Americano | USD | USD |
| Euro | EUR | EUR |
| Libra Esterlina | GBP | GBP |

---

# Fuente Oficial

## Banco de México (BANXICO)

Fuente principal del sistema.

Se utilizará el servicio oficial SIE REST API.

La información obtenida será almacenada localmente.

No se consultará Banxico durante el proceso de facturación.

---

# Fuentes por prioridad

## USD

Banco de México

---

## EUR

Banco de México

---

## GBP

Banco de México (si está disponible)

En caso contrario:

Banco Central Europeo

---

# Arquitectura

```
Servidor
      │
      │
      ▼

ExchangeRateService

      │
      ├──────────────► Consulta Banxico

      │
      ├──────────────► Consulta ECB (si aplica)

      │
      ▼

Base de Datos

      │
      ▼

ERP

      │
      ├── Facturación

      ├── Compras

      ├── Inventarios

      ├── Cuentas por Cobrar

      └── Reportes
```

---

# Base de Datos

Tabla:

```
exchange_rates
```

Campos

| Campo | Tipo |
|---------|---------|
| id | bigint |
| fecha | date |
| moneda | varchar(5) |
| valor | decimal(18,6) |
| fuente | varchar(50) |
| hora_actualizacion | datetime |
| usuario_actualizacion | varchar(50) |
| activo | bit |

---

## Ejemplo

|Fecha|Moneda|Valor|
|---------|---------|---------|
|2026-07-24|USD|17.523100|
|2026-07-24|EUR|20.482700|
|2026-07-24|GBP|23.814500|

---

# Servicio

Nombre

```
ExchangeRateService
```

Responsabilidades

- Descargar tipos de cambio.
- Validar respuesta.
- Guardar histórico.
- Actualizar monedas.
- Consultar tipo de cambio vigente.
- Devolver tipo de cambio solicitado.
- Registrar errores.

---

# Métodos

## Obtener tipo de cambio

```
GetExchangeRate(moneda)
```

Ejemplo

```
GetExchangeRate("USD")
```

Respuesta

```
17.523100
```

---

## Obtener por fecha

```
GetExchangeRate(moneda, fecha)
```

Ejemplo

```
GetExchangeRate("EUR","2026-07-24")
```

---

## Actualizar todos

```
UpdateExchangeRates()
```

Actualiza

- USD
- EUR
- GBP

---

## Actualizar una moneda

```
UpdateExchangeRate(moneda)
```

Ejemplo

```
UpdateExchangeRate("USD")
```

---

# Proceso Automático

Cada día

12:05 PM

```
Cron
```

↓

Consultar Banxico

↓

Actualizar monedas

↓

Guardar en Base de Datos

↓

Registrar Log

---

# Flujo

```
Cron Diario

      │

Consultar Banxico

      │

¿Respuesta correcta?

      │

Sí

      │

Guardar Histórico

      │

Actualizar Monedas

      │

Registrar Log

      │

Fin
```

---

# Manejo de Errores

Si Banxico no responde

↓

Utilizar último tipo de cambio vigente

↓

Registrar advertencia

↓

Intentar nuevamente 30 minutos después

---

# Uso en Facturación

Al crear una factura

```
Nueva Factura
```

↓

Seleccionar moneda

```
MXN

USD

EUR

GBP
```

↓

Consultar

```
ExchangeRateService
```

↓

Obtener

```
TipoCambio
```

↓

Llenar automáticamente el campo

```
TipoCambio
```

↓

Usuario puede visualizarlo

↓

Continuar captura

---

# Regla de Negocio

Si la moneda es

```
MXN
```

Entonces

```
TipoCambio = 1
```

No se consulta Banxico.

---

Si la moneda es

```
USD
```

Consultar

```
ExchangeRateService
```

---

Si la moneda es

```
EUR
```

Consultar

```
ExchangeRateService
```

---

Si la moneda es

```
GBP
```

Consultar

```
ExchangeRateService
```

---

# Preparación para Timbrado

Este módulo únicamente dejará preparado el tipo de cambio.

Antes del timbrado se realizará una segunda validación para garantizar que:

- Existe un tipo de cambio.
- Corresponde a la fecha de emisión.
- Cumple con el estándar del SAT.
- Se encuentra almacenado en la base de datos.

El módulo de Timbrado NO consultará Banxico directamente.

Siempre utilizará el tipo de cambio proporcionado por:

```
ExchangeRateService
```

---

# Ventajas

- Un solo punto de administración.
- Evita múltiples consultas a Banxico.
- Histórico completo.
- Mayor velocidad al facturar.
- Compatible con CFDI 4.0.
- Escalable para nuevas monedas.
- Fácil integración con Compras, Inventarios y Comercio Exterior.

---

# Fases Futuras

## Fase 2

Agregar soporte para:

- CAD
- JPY
- CHF
- AUD
- CNY

---

## Fase 3

Generar API interna

```
GET /api/exchange-rate/USD

GET /api/exchange-rate/EUR

GET /api/exchange-rate/GBP
```

---

## Fase 4

Panel administrativo

Permitir:

- Consultar histórico.
- Forzar actualización.
- Cambiar proveedor.
- Ver bitácora.
- Consultar errores.
- Exportar histórico.

---

# Integración con el ERP

Este módulo será utilizado por:

✅ Facturación CFDI

✅ Cotizaciones

✅ Pedidos

✅ Compras

✅ Inventarios

✅ Comercio Exterior

✅ Cuentas por Cobrar

✅ Cuentas por Pagar

✅ Reportes Financieros

---

# Observación Técnica

El diseño se basa en una arquitectura de servicios desacoplados. El `ExchangeRateService` será el único componente autorizado para consultar fuentes externas (Banxico y, en su caso, el Banco Central Europeo), mientras que el resto de los módulos del ERP consumirán únicamente la información almacenada localmente. Esta estrategia mejora el rendimiento, facilita las auditorías y garantiza la consistencia del tipo de cambio utilizado en todos los procesos del sistema.