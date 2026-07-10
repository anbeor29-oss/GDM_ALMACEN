# Contract tests — PAC

Tests que validan el **contrato** que cumple cualquier proveedor PAC (Mock,
Finkok, Facturama, SW Sapien). Cada PAC implementa la interfaz
`pac-adapter.interface.ts` y la misma batería de tests aplica.

## Hoy (Mock PAC)
```bash
cd tests
npx playwright test contracts/pac-mock.contract.spec.ts
```

## Cuando se integre PAC real

```bash
# Bash / WSL
export PAC_BASE_URL=https://apisandbox.facturama.mx
export PAC_USER=qa-user
export PAC_PASS=...

# PowerShell
$env:PAC_BASE_URL = "https://apisandbox.facturama.mx"
$env:PAC_USER = "qa-user"
$env:PAC_PASS = "..."

npx playwright test contracts/
```

Si los asserts `PAC-C01..C05` (mock) y `PAC-R01..R05` (Facturama) **ambos
pasan**, el adapter es correcto. Si diverge: corregir el adapter ANTES de
liberar a producción.

## Patrón aplicado

Adapter + Substitution Principle (Liskov). Cada implementación del PAC es
intercambiable mientras cumpla `PacAdapter`.
