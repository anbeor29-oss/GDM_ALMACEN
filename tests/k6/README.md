# Tests de carga (k6)

Solo se ejecutan cuando el equipo decida. No bloquean el CI normal.

## Instalación

```bash
# Windows
choco install k6
# Mac
brew install k6
# Linux
sudo apt-get install k6
```

## Correr

```bash
cd C:/Users/EQ-7/GDM_FAC
k6 run -e EMAIL=manager@demo.com -e PASS=admin123 tests/k6/load-folio.js
```

## Qué valida

| Script | Pregunta de negocio | SLO |
|---|---|---|
| `load-folio.js` | ¿Se duplican folios cuando 50 usuarios facturan a la vez? | 0 duplicados |
| `load-folio.js` | ¿Cuánto tarda crear factura bajo carga? | p95 < 1.5 s |

## Cuándo correrlo

- Antes de releases grandes
- Después de cambios al servicio de folios (`getAndIncrementInvoiceFolio`)
- Antes de aceptar un cliente con > 1000 facturas/día
