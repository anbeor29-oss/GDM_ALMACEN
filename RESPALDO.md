# RESPALDO — referencia técnica consolidada (GDM NEXO)

> Archivo único de respaldo. Consolida las notas técnicas que antes vivían en archivos sueltos. La documentación viva está en **README.md** (panorama) y **BITACORA.md** (histórico cronológico). Todo lo borrado sigue recuperable por el historial de git. Consolidado el 2026-09-09.


## Índice

1. Arquitectura
2. Motores de contabilidad
3. Códigos del SAT (contabilidad)
4. Bugs resueltos
5. Cancelación y CSD
6. Complemento de pago (formas)
7. Diseño de planes de facturación
8. Deploy — Render
9. Deploy — hosting (ZIP)
10. Deploy — dominio HCGM



---

# ═══ Arquitectura ═══

_(origen: `ARCHITECTURE.md`)_

# 🏗️ Arquitectura Técnica - ERP CFDI 4.0

## 1. Visión General de Sistemas

```
┌──────────────────────────────────────────────────────────────────┐
│                    CLIENTE (Navegador Web)                        │
│                 React 18 + TypeScript + Tailwind                 │
│         (Dashboard, Facturación, Reportes, Pagos, Cobranza)      │
└────────────────────┬─────────────────────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         │   TLS 1.3 │ HTTPS    │
         │ Mutations │ Queries  │
         │           │          │
┌────────▼───────────▼──────────▼────────────────────────────────┐
│               API GATEWAY (Node.js Express)                    │
│  ├── Rate Limiting                                             │
│  ├── Request/Response Logging                                 │
│  ├── CORS Policy                                              │
│  ├── Auth Middleware (JWT)                                    │
│  └── Error Handling Centralizado                              │
└────┬────────────────────┬────────────────────┬────────────────┘
     │                    │                    │
┌────▼─────────┐  ┌───────▼──────┐  ┌────────▼──────────┐
│ AUTH SERVICE │  │ CORE SERVICES│  │ SPECIALIZED MODULES
├──────────────┤  ├──────────────┤  ├──────────────────┤
│• Login/JWT   │  │• Customers   │  │• CFDI Parser     │
│• Refresh     │  │• Products    │  │• CFDI Generator  │
│• Revoke      │  │• Invoices    │  │• Validator       │
│• Permissions │  │• Payments    │  │• PDF Generator   │
│• Roles       │  │• Reports     │  │• PAC Connector   │
│• Audit       │  │• Cobranza    │  │• CIF/OCR         │
└──────────────┘  └──────────────┘  └──────────────────┘
         │                │                   │
         └────────┬───────┴─────────┬─────────┘
                  │                 │
          ┌───────▼─────┐   ┌──────▼──────────┐
          │ DATA LAYER  │   │ STORAGE LAYER  │
          ├─────────────┤   ├────────────────┤
          │ PostgreSQL  │   │ AWS S3 / Blob  │
          │ - Companies │   │ - XMLs         │
          │ - Users     │   │ - PDFs         │
          │ - Customers │   │ - Backups      │
          │ - Products  │   │ - Logs         │
          │ - Invoices  │   └────────────────┘
          │ - Payments  │
          │ - Audit Log │
          │ - SAT Cache │
          └─────────────┘
                  │
          ┌───────▼──────────────┐
          │ EXTERNAL SERVICES    │
          ├──────────────────────┤
          │• Finkok (PAC)        │
          │• Facturama (PAC)     │
          │• SW Sapien (PAC)     │
          │• SendGrid (Email)    │
          │• Twilio (SMS)        │
          │• SAT (Catálogos)     │
          └──────────────────────┘
```

---

## 2. Estructura de Módulos Backend

### 2.1 Módulo de Autenticación

```typescript
// Flujo de autenticación
┌─ POST /auth/login ────────────┐
│ 1. Validar email + password  │
│ 2. Generar JWT + Refresh     │
│ 3. Crear sesión en Redis     │
│ 4. Log de auditoría          │
└─────────────────────────────┘

Endpoints:
├── POST /auth/login              (email, password)
├── POST /auth/refresh            (refresh_token)
├── POST /auth/logout             (invalidar sesión)
├── POST /auth/change-password    (old_pwd, new_pwd)
└── GET  /auth/me                 (datos usuario actual)

Tablas:
├── users (id, email, password_hash, role, created_at)
├── sessions (user_id, refresh_token, expires_at)
├── audit_logs (user_id, action, table_name, details, timestamp)
└── permissions (role_id, resource, action)
```

### 2.2 Módulo de Empresas (Companies)

```typescript
Endpoints:
├── POST   /companies             (crear empresa)
├── GET    /companies/:id         (obtener empresa)
├── PUT    /companies/:id         (actualizar empresa)
├── DELETE /companies/:id         (eliminar empresa)
└── GET    /companies/:id/config  (obtener configuración)

Tablas:
├── companies
│   ├── id (UUID)
│   ├── rfc (VARCHAR 13, único)
│   ├── business_name (VARCHAR)
│   ├── fiscal_regime (FK c_RegimenFiscal)
│   ├── postal_code (FK c_CodigoPostal)
│   ├── email
│   ├── phone
│   ├── logo_url
│   ├── pfx_certificate (URL a cloud storage)
│   ├── pfx_password_hash
│   ├── bank_account
│   ├── bank_name
│   ├── swift_code
│   ├── created_at
│   ├── updated_at
│   └── is_active

Datos Importantes (Guardados):
✓ RFC (identidad única)
✓ Razón social
✓ Régimen fiscal (válido en SAT)
✓ Código postal
✓ Certificado .pfx (encriptado)
✓ Datos bancarios para complemento pago

Datos NO Guardados (Obtenidos de SAT):
✗ Catálogos (obtenidos dinámicamente)
```

### 2.3 Módulo de Clientes (Customers)

```typescript
Endpoints:
├── POST   /customers             (crear cliente)
├── GET    /customers             (listar con paginación)
├── GET    /customers/:id         (obtener cliente)
├── PUT    /customers/:id         (actualizar cliente)
├── DELETE /customers/:id         (soft delete)
├── GET    /customers/:id/invoices (facturas del cliente)
└── GET    /customers/:id/balance  (estado de cuenta)

Tablas:
├── customers
│   ├── id (UUID)
│   ├── company_id (FK)
│   ├── rfc (VARCHAR 13)
│   ├── business_name (VARCHAR)
│   ├── fiscal_regime (FK c_RegimenFiscal)
│   ├── postal_code (FK c_CodigoPostal)
│   ├── state (FK c_Estado)
│   ├── city (FK c_Localidad)
│   ├── address (VARCHAR)
│   ├── email (VARCHAR)
│   ├── phone (VARCHAR)
│   ├── credit_limit (DECIMAL)
│   ├── credit_days (INT)
│   ├── balance (DECIMAL, calculado)
│   ├── last_invoice_date
│   ├── total_invoiced (suma todas facturas)
│   ├── payment_average_days
│   ├── created_at
│   ├── updated_at
│   └── is_active

Inteligencia Automática:
• Calcular balance automáticamente
• Sugerir alertas si vencimiento próximo
• Agrupar por régimen fiscal para reportes
• Histórico de cambios
```

### 2.4 Módulo de Productos

```typescript
Endpoints:
├── POST   /products              (crear producto)
├── GET    /products              (listar)
├── GET    /products/:id          (obtener)
├── PUT    /products/:id          (actualizar)
├── DELETE /products/:id          (eliminar)
└── GET    /products/search?q=    (búsqueda)

Tablas:
├── products
│   ├── id (UUID)
│   ├── company_id (FK)
│   ├── sku (VARCHAR, único por empresa)
│   ├── name (VARCHAR)
│   ├── description (TEXT)
│   ├── clave_sat (FK c_ClaveProdServ, obligatorio)
│   ├── unit_code (FK c_ClaveUnidad, obligatorio)
│   ├── unit_name (VARCHAR, cache de c_ClaveUnidad)
│   ├── base_price (DECIMAL)
│   ├── tax_type (FK c_Impuesto)
│   ├── tax_rate (FK c_TasaOCuota)
│   ├── is_deductible (BOOLEAN)
│   ├── is_exempt (BOOLEAN)
│   ├── applies_ieps (BOOLEAN)
│   ├── stock_quantity (INT)
│   ├── stock_minimum (INT)
│   ├── stock_maximum (INT)
│   ├── last_cost (DECIMAL)
│   ├── created_at
│   ├── updated_at
│   └── is_active

Validaciones Automáticas:
• Verificar clave_sat existe en catálogo
• Verificar unit_code es válido
• Calcular tax automáticamente según tasa
• Alertas si stock < mínimo
```

### 2.5 Módulo de Facturas (Invoices)

```typescript
Endpoints:
├── POST   /invoices              (crear factura)
├── GET    /invoices              (listar)
├── GET    /invoices/:id          (obtener)
├── GET    /invoices/:id/xml      (descargar XML)
├── GET    /invoices/:id/pdf      (descargar PDF)
├── PUT    /invoices/:id/send     (enviar por email)
├── PUT    /invoices/:folio/cancel (cancelar factura)
└── POST   /invoices/:id/send-pac (enviar a PAC para timbrado)

Tablas:
├── invoices
│   ├── id (UUID)
│   ├── company_id (FK)
│   ├── customer_id (FK)
│   ├── folio (INT, secuencial por empresa)
│   ├── serie (VARCHAR, ej: "F")
│   ├── cfdi_type (FK c_TipoComprobante)
│   ├── date_issued (TIMESTAMP, debe ser hoy o anterior)
│   ├── date_expired (TIMESTAMP, opcional)
│   ├── currency (FK c_Moneda)
│   ├── exchange_rate (DECIMAL, si no es MXN)
│   ├── subtotal (DECIMAL, suma items sin impuesto)
│   ├── tax_transferred (DECIMAL, IVA trasladado)
│   ├── tax_retained (DECIMAL, retenciones)
│   ├── tax_ieps (DECIMAL, IEPS si aplica)
│   ├── total (DECIMAL, subtotal + impuestos - retenciones)
│   ├── payment_form (FK c_FormaPago)
│   ├── payment_method (FK c_MetodoPago)
│   ├── cfdi_use (FK c_UsoCFDI)
│   ├── payment_terms (VARCHAR, ej: "Crédito 30 días")
│   ├── notes (TEXT)
│   ├── xml_content (TEXT, el XML completo, LARGE)
│   ├── xml_url (VARCHAR, URL en S3)
│   ├── pdf_url (VARCHAR, URL en S3)
│   ├── status (ENUM: draft, ready, stamped, sent, paid, cancelled)
│   ├── cfdi_uuid (VARCHAR 36, asignado por SAT al timbrar)
│   ├── pac_id (VARCHAR, identif PAC que timbró)
│   ├── pac_timestamp (TIMESTAMP, cuándo timbró PAC)
│   ├── is_stamped (BOOLEAN)
│   ├── sent_at (TIMESTAMP)
│   ├── created_at
│   ├── updated_at
│   └── deleted_at (soft delete)

├── invoice_items
│   ├── id (UUID)
│   ├── invoice_id (FK)
│   ├── product_id (FK)
│   ├── quantity (DECIMAL)
│   ├── unit_price (DECIMAL)
│   ├── subtotal (DECIMAL, qty * unit_price)
│   ├── tax_amount (DECIMAL)
│   ├── total (DECIMAL, subtotal + tax)
│   ├── description (TEXT, puede diferir del producto)
│   ├── clave_sat (VARCHAR, snapshot del catálogo)
│   ├── unit_code (VARCHAR, snapshot del catálogo)
│   └── tax_rate (DECIMAL, snapshot del catálogo)

Inteligencia Automática:
• Auto-validar RFC cliente vs SAT
• Auto-detectar régimen fiscal cliente
• Auto-sugerir productos frecuentes
• Auto-calcular impuestos según producto + cliente
• Auto-generar folio secuencial
• Auto-generar XML CFDI válido
• Auto-generar PDF profesional
• Validar todas las claves contra catálogos SAT
```

### 2.6 Módulo de Pagos (Payments)

```typescript
Endpoints:
├── POST   /invoices/:id/payments (crear pago)
├── GET    /invoices/:id/payments (listar pagos)
├── GET    /payments/:id          (obtener pago)
└── PUT    /payments/:id/void     (anular pago)

Tablas:
├── payments
│   ├── id (UUID)
│   ├── invoice_id (FK)
│   ├── payment_amount (DECIMAL)
│   ├── payment_date (TIMESTAMP)
│   ├── payment_method (FK c_MetodoPago)
│   ├── payment_form (FK c_FormaPago)
│   ├── reference_number (VARCHAR, ej cheque, transferencia)
│   ├── bank_account (VARCHAR)
│   ├── document_status (ENUM: pending_stamping, stamped, void)
│   ├── cfdi_complement_xml (TEXT, complemento de pago)
│   ├── cfdi_complement_url (VARCHAR, S3)
│   ├── cfdi_uuid (VARCHAR 36, asignado por SAT)
│   ├── balance_remaining (DECIMAL, saldo pendiente factura)
│   ├── created_at
│   └── updated_at

Inteligencia Automática:
• Auto-generar complemento de pago CFDI válido
• Auto-actualizar balance de factura
• Auto-cambiar status factura si paid_in_full
• Auto-enviar notificación email
• Calcular antigüedad de saldo automáticamente
```

### 2.7 Módulo de Reportes (Reports)

```typescript
Endpoints:
├── GET    /reports/invoices      (por período, cliente, estado)
├── GET    /reports/collections   (cobranza)
├── GET    /reports/taxes         (IVA, retenciones)
├── GET    /reports/cash-flow     (flujo de caja)
├── GET    /reports/aging         (antigüedad de saldos)
├── GET    /reports/products      (ventas por producto)
├── GET    /reports/export?format=(pdf|xlsx|csv)
└── GET    /reports/dashboard     (KPIs principales)

Cálculos en Tiempo Real:
• Total facturas por período
• Total cobrado
• Total pendiente
• Promedio días para pago
• Clientes morosos (vencimiento > fecha_hoy)
• Flujo de caja proyectado (próximos 30/60/90 días)
• IVA trasladado vs acreditable
• Retenciones por período
• Productos más vendidos
• Clientes más importantes

Ejemplo - Reporte de Cobranza:
{
  "periodo": "2026-06-01 a 2026-06-30",
  "total_invoiced": 150000,
  "total_collected": 120000,
  "pending": 30000,
  "overdue": [
    {
      "customer": "ABC Corp",
      "invoice_folio": "F-001",
      "amount": 5000,
      "due_date": "2026-05-15",
      "days_overdue": 23,
      "status": "VENCIDA"
    },
    ...
  ],
  "aging_summary": {
    "0-30_days": 10000,
    "31-60_days": 15000,
    "61-90_days": 5000,
    "90+_days": 0
  }
}
```

### 2.8 Módulo CFDI (Core - Parseo y Generación)

#### 2.8.1 Parser CFDI (Lectura de XML)

```typescript
Archivo: backend/src/modules/cfdi/parser.ts

Funcionalidad:
• Recibe XML CFDI válido
• Extrae todos los datos
• Valida estructura XML
• Valida contra catálogos SAT
• Retorna objeto JSON estructurado

Entrada: XML String
Salida: {
  emisor: {
    rfc: "AAA010101AAA",
    nombre: "Razón Social",
    regimen_fiscal: "601" (FK c_RegimenFiscal)
  },
  receptor: {
    rfc: "BBB010101BBB",
    nombre: "Cliente",
    regimen_fiscal: "601"
  },
  comprobante: {
    tipo: "I" (Ingreso)
    serie: "A",
    folio: "1",
    fecha: "2026-06-07T10:30:00",
    subtotal: 1000.00,
    descuento: 0,
    impuestos: {
      totales_impuestos_trasladados: {
        "IVA": 160.00
      },
      totales_impuestos_retenidos: {
        "ISR": 0,
        "IVA": 0
      }
    },
    total: 1160.00
  },
  conceptos: [
    {
      clave_sat: "01010101",
      descripcion: "Producto A",
      cantidad: 1,
      unidad: "H87",
      precio_unitario: 1000,
      importe: 1000,
      impuestos: [
        {
          tipo: "Traslado",
          impuesto: "002",
          tasa: "0.16",
          importe: 160
        }
      ]
    }
  ]
}

Validaciones:
✓ XML bien formado
✓ Todos los RFCs válidos
✓ Todas las claves SAT existen
✓ Todas las tasas válidas
✓ Sumas correctas (subtotal, impuestos, total)
```

#### 2.8.2 Generador CFDI (Creación de XML)

```typescript
Archivo: backend/src/modules/cfdi/generator.ts

Entrada: {
  emisor: { rfc, nombre, regimen }
  receptor: { rfc, nombre, regimen }
  conceptos: [{ producto_id, cantidad, precio }]
  metodo_pago, forma_pago, uso_cfdi
  // etc
}

Proceso:
1. Validar todos los datos (RFCs, catálogos, cliente)
2. Crear estructura XML válida CFDI 4.0
3. Calcular impuestos automáticamente
4. Generar folio secuencial
5. Validar contra SAT schemas locales
6. Guardar XML en S3
7. Retornar XML para firma digital

Salida: {
  xml_content: "<cfdi:Comprobante>...",
  xml_url: "s3://bucket/2026/06/ABC010101AAA-F-0001.xml",
  folio: "F-0001",
  total: 1160.00,
  requires_stamping: true
}

Características:
✓ Soporte para múltiples impuestos (IVA, IEPS, ISR, etc)
✓ Cálculo automático de retenciones si aplica
✓ Complemento de pago para facturas
✓ Almacenaje automático en cloud
```

#### 2.8.3 Validador SAT

```typescript
Archivo: backend/src/modules/cfdi/validator.ts

Validaciones:
✓ RFC correcto (estructura y validación SAT)
✓ Claves de productos válidas (c_ClaveProdServ)
✓ Unidades válidas (c_ClaveUnidad)
✓ Regímenes fiscales válidos (c_RegimenFiscal)
✓ Métodos de pago válidos (c_MetodoPago)
✓ Formas de pago válidas (c_FormaPago)
✓ Usos CFDI válidos (c_UsoCFDI)
✓ Impuestos válidos (c_Impuesto)
✓ Tasas válidas (c_TasaOCuota)
✓ Monedas válidas (c_Moneda)
✓ Países válidos (c_Pais)
✓ Estados/municipios/códigos postales válidos

Resultado:
{
  is_valid: true,
  errors: [],
  warnings: ["No uses combinación de tax + tax rate poco frecuente"]
}
```

### 2.9 Módulo de Catálogos SAT

```typescript
Endpoints:
├── GET /catalogs/list             (lista de catálogos disponibles)
├── GET /catalogs/:catalog_name    (búsqueda en catálogo)
└── GET /catalogs/:catalog_name/:key (obtener un elemento)

Tablas:
├── sat_catalogs
│   ├── id (UUID)
│   ├── catalog_name (VARCHAR: "c_ClaveProdServ", etc)
│   ├── catalog_key (VARCHAR: "01010101", "H87", etc)
│   ├── description (VARCHAR)
│   ├── parent_code (VARCHAR, para jerarquías)
│   ├── vigence_start (TIMESTAMP)
│   ├── vigence_end (TIMESTAMP, NULL = vigente)
│   ├── attributes (JSONB, datos adicionales)
│   ├── last_updated (TIMESTAMP)
│   └── source (VARCHAR: "SAT" o URL oficial)

Sincronización Automática:
• Cada 1º de mes: descargar catálogos del SAT
• Comparar con versión local
• Actualizar vigencias
• Log de cambios
• Sin downtime (caché disponible siempre)

Catálogos Principales (16 core):
✓ c_ClaveProdServ (20,000+ claves)
✓ c_ClaveUnidad (190 unidades)
✓ c_FormaPago (17 formas)
✓ c_MetodoPago (23 métodos)
✓ c_RegimenFiscal (23 regímenes)
✓ c_UsoCFDI (23 usos)
✓ c_Impuesto (3 tipos)
✓ c_TasaOCuota (100+ tasas)
✓ c_Moneda (100+ monedas)
✓ c_Pais (250+ países)
✓ c_Estado (32 estados)
✓ c_Localidad (2,600+ ciudades)
✓ c_Colonia (80,000+ colonias)
✓ c_CodigoPostal (57,000+ CPs)
✓ c_TipoComprobante (tipos CFDI)
✓ c_Exportacion (regímenes export)
```

### 2.10 Módulo PAC Connector (Abstracto)

```typescript
Archivo: backend/src/modules/pac/pac-connector.ts

Interfaz Abstracta:
interface IPACConnector {
  authenticate(): Promise<void>
  stamp(xml: string): Promise<{
    uuid: string,
    xml_stamped: string,
    timestamp: Date,
    pac_id: string
  }>
  cancel(uuid: string, rfc: string): Promise<boolean>
  getStatus(uuid: string): Promise<"valid" | "cancelled" | "error">
}

Implementaciones (Fase 2):
├── FinkoKConnector extends IPACConnector
├── FacturamaConnector extends IPACConnector
└── SWSapienConnector extends IPACConnector

Flujo de Timbrado:
1. Usuario crea factura (status: "ready")
2. Usuario elige "Send to PAC"
3. Sistema valida XML completo
4. Selecciona PAC configurado en empresa
5. Envía XML a PAC vía API PAC
6. PAC retorna UUID + XML timbrado
7. Sistema guarda UUID en BD
8. Sistema actualiza status a "stamped"
9. Usuario recibe notificación
10. Genera PDF con sello digital

Error Handling:
• Reintentos automáticos (máx 3)
• Log completo de intentos
• Notificación al usuario
• Sin bloqueo - usuario puede reintentar manualmente
```

### 2.11 Módulo de Auditoría

```typescript
Tablas:
├── audit_logs
│   ├── id (UUID)
│   ├── user_id (FK)
│   ├── action (VARCHAR: "CREATE", "UPDATE", "DELETE", "VIEW")
│   ├── table_name (VARCHAR: "invoices", "customers", etc)
│   ├── record_id (VARCHAR, ID del registro modificado)
│   ├── old_values (JSONB, valores anteriores si UPDATE)
│   ├── new_values (JSONB, valores nuevos)
│   ├── ip_address (VARCHAR)
│   ├── user_agent (VARCHAR)
│   ├── timestamp (TIMESTAMP)
│   └── status (VARCHAR: "success", "error")

Auditoría Fiscal (Extra importante):
├── stamping_logs (cada timbrado)
├── cancellation_logs (cada cancelación)
├── payment_logs (cada pago registrado)
└── export_logs (qué reportes se descargó y cuándo)

Requisito SAT:
Capacidad de demonstrar quién hizo qué y cuándo.
```

---

## 3. Arquitectura Frontend

```typescript
Frontend Structure:
frontend/src/
├── components/
│   ├── common/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   └── Table.tsx
│   ├── forms/
│   │   ├── InvoiceForm.tsx
│   │   ├── CustomerForm.tsx
│   │   ├── ProductForm.tsx
│   │   ├── PaymentForm.tsx
│   │   └── LoginForm.tsx
│   ├── invoices/
│   │   ├── InvoiceList.tsx
│   │   ├── InvoiceDetail.tsx
│   │   ├── InvoicePreview.tsx (PDF preview)
│   │   └── InvoiceGenerator.tsx
│   ├── reports/
│   │   ├── CollectionsReport.tsx
│   │   ├── TaxReport.tsx
│   │   ├── CashFlowReport.tsx
│   │   ├── Dashboard.tsx
│   │   └── ChartComponents.tsx
│   └── customers/
│       ├── CustomerList.tsx
│       ├── CustomerDetail.tsx
│       └── CustomerForm.tsx
├── pages/
│   ├── Dashboard.tsx
│   ├── Invoices.tsx
│   ├── Customers.tsx
│   ├── Products.tsx
│   ├── Reports.tsx
│   ├── Settings.tsx
│   ├── Login.tsx
│   └── NotFound.tsx
├── services/
│   ├── api.ts (cliente HTTP, axios)
│   ├── authService.ts
│   ├── invoiceService.ts
│   ├── customerService.ts
│   ├── reportService.ts
│   └── cfdiService.ts
├── store/ (Redux Toolkit)
│   ├── slices/
│   │   ├── authSlice.ts
│   │   ├── invoiceSlice.ts
│   │   ├── customerSlice.ts
│   │   ├── uiSlice.ts
│   │   └── catalogSlice.ts
│   └── store.ts
├── hooks/
│   ├── useAuth.ts
│   ├── useInvoice.ts
│   ├── useForm.ts
│   └── useAsync.ts
├── types/
│   ├── index.ts (TypeScript interfaces)
│   ├── invoice.ts
│   ├── customer.ts
│   ├── product.ts
│   └── report.ts
├── utils/
│   ├── formatters.ts
│   ├── validators.ts
│   ├── permissions.ts
│   └── constants.ts
├── styles/
│   └── globals.css (Tailwind)
├── App.tsx
├── index.tsx
└── config/
    └── config.ts (URLs, constantes)

Key Pages Flow:
Dashboard
├── KPI Cards (total facturas, pendiente, vencidas)
├── Quick Actions (nueva factura, nuevo pago)
├── Recent Invoices
├── Collections Chart
├── Cash Flow Projection
└── Alerts (vencimientos próximos)

Invoices Page
├── Table de facturas (filtros, búsqueda, paginación)
├── Botones: New, View, Edit, Download PDF, Send Email, Mark as Paid
└── Sidebar: Filtros (estado, cliente, período)

New Invoice Flow
├── Step 1: Select Customer (con búsqueda RFC/nombre)
├── Step 2: Select Products (drag-drop, multiple selection)
├── Step 3: Review Taxes (auto-calculated)
├── Step 4: PDF Preview
├── Step 5: Confirm & Create
└── Post-Creation: Option to Send to PAC

Reports Page
├── Report Type Selector
├── Date Range Picker
├── Customer/Product Filters
├── Export Options (PDF, Excel, CSV)
└── Interactive Charts (Recharts)

Settings Page
├── Company Configuration
│   ├── RFC, Razón Social
│   ├── Upload Certificado .pfx
│   ├── Bancos (para complemento pago)
│   └── Email (para notificaciones)
├── PAC Configuration (Fase 2)
│   ├── PAC Selector (Finkok, Facturama, SW)
│   ├── API Keys (encriptados)
│   └── Test Connection
└── User Management
    ├── Users list
    ├── Add user
    ├── Role assignment
    └── Permissions
```

---

## 4. Base de Datos Completa

Ver archivo separado `DATABASE.sql`

Principios:
- ✅ Normalización hasta 3NF
- ✅ Índices en claves frecuentes (RFC, folio, fecha)
- ✅ Particionamiento por empresa_id
- ✅ Constraints para integridad referencial
- ✅ Soft delete en tablas auditables
- ✅ Timestamps automáticos (created_at, updated_at)

---

## 5. Flujos Críticos de Negocio

### Flujo 1: Crear Factura (El más importante)

```
Usuario → Frontend (New Invoice)
           ↓
         Form: Seleccionar Cliente
           ↓
         Validar RFC cliente vs SAT (API Backend)
           ↓
         Frontend obtiene régimen fiscal cliente automáticamente
           ↓
         Form: Agregar Productos
           ↓
         Para cada producto: Validar clave SAT, unidad, impuesto
           ↓
         Frontend calcula: Subtotal + Impuestos automáticamente
           ↓
         Form: Review (PDF preview)
           ↓
         Usuario confirma
           ↓
         Backend: Generar CFDI XML válido
           ↓
         Backend: Validar XML contra esquemas SAT locales
           ↓
         Backend: Guardar XML en S3
           ↓
         Backend: Guardar factura en BD (status: "ready")
           ↓
         Frontend: Mostrar opciones
           ├─ Descargar PDF
           ├─ Descargar XML
           ├─ Ver preview
           ├─ Enviar por email
           └─ Enviar a PAC para timbrado
           ↓
         Auditoría: Log de creación con usuario, timestamp, IP
```

### Flujo 2: Recibir Pago

```
Cliente paga (por cualquier medio: transferencia, cheque, efectivo)
           ↓
Usuario accede a "Payments" → "New Payment"
           ↓
Selecciona factura (o busca por RFC cliente)
           ↓
Ingresa:
  - Monto pagado
  - Fecha de pago
  - Método de pago (transferencia, cheque, etc)
  - Referencia (número transferencia, cheque, etc)
           ↓
Backend: Crear complemento de pago CFDI
           ↓
Backend: Calcular balance restante automáticamente
           ↓
Si balance = 0: Cambiar status factura a "PAGADA"
Si balance > 0: Status "PAGO PARCIAL"
           ↓
Backend: Generar PDF comprobante de pago
           ↓
Backend: Enviar email a cliente (notificación)
           ↓
Frontend: Mostrar "Pago registrado exitosamente"
           ↓
Auditoría: Log de pago con detalles
```

### Flujo 3: Generar Reporte de Cobranza

```
Usuario → Reports > Collections Report
           ↓
Selecciona período (de/hasta fecha)
           ↓
Backend: Calcula
  ├─ Total facturas emitidas en período
  ├─ Total pagado
  ├─ Pendiente de pago
  ├─ Vencidas (due_date < hoy)
  ├─ Antigüedad de saldos (0-30, 31-60, 61-90, 90+)
  ├─ Clientes morosos
  ├─ Promedio días para cobro
  └─ Proyección de flujo (próximos 30/60/90 días)
           ↓
Frontend: Muestra tabla + gráficos interactivos
           ↓
Usuario puede:
  ├─ Exportar PDF
  ├─ Exportar Excel
  ├─ Enviar por email
  └─ Ver detalle por cliente
           ↓
Auditoría: Log de "Reporte de Cobranza descargado"
```

---

## 6. Integración con PAC (Fase 2)

### Arquitectura de Integración

```
Frontend → Backend → PAC Connector → PAC API → SAT
           ↑                              ↓
           └──────────────────────────────┘
              (Response: UUID + Timestamp)

Pasos:
1. Usuario elige "Send to PAC"
2. Backend llama a PAC Connector
3. PAC Connector autentica con API PAC
4. Envía XML + certificado
5. PAC valida con SAT
6. SAT valida y devuelve UUID (folio SAT)
7. PAC retorna UUID al Connector
8. Connector guarda UUID en BD
9. Frontend notifica usuario
10. Sistema está listo para complemento de pago

Error Scenarios:
- PAC no disponible → Reintentar automáticamente
- Certificado inválido → Error al usuario
- XML rechazado → Mostrar error específico
- Timeout → Reintentar
- Sin conexión SAT en PAC → Esperar y reintentar

Almacenamiento:
- UUID SAT en tabla invoices
- XML timbrado en S3
- Logs de timbrado en audit_logs
- Error logs si falla
```

---

## 7. Seguridad (En Profundidad)

```
CAPA 1: Network Security
├── TLS 1.3 obligatorio (HTTPS)
├── HSTS headers
├── Certificate Pinning (opcional)
└── WAF (Web Application Firewall)

CAPA 2: Application Security
├── Rate Limiting (100 req/min por IP)
├── CORS restringido (solo dominios permitidos)
├── CSRF Protection (tokens)
├── Input Validation (sanitización)
├── SQL Injection prevention (ORM + prepared statements)
├── XSS prevention (React escapa por defecto)
└── Session Management (JWT expirable)

CAPA 3: Data Security
├── Passwords: bcrypt (cost 12)
├── PFX Certificate: encriptado en reposo
├── PAC API Keys: encriptados en variables de entorno
├── Sensitive data: nunca en logs
├── Database: encriptación en reposo (AWS KMS / Azure Key Vault)
├── Backups: encriptados, 30 días retenidos
└── Audit logs: inmutables

CAPA 4: Access Control
├── Role-Based Access Control (RBAC)
│   ├── ADMIN (crear usuarios, ver todo)
│   ├── MANAGER (crear facturas, ver reportes)
│   ├── USER (crear facturas, ver propias)
│   └── VIEW_ONLY (solo consulta)
├── Company Isolation (multi-tenant)
├── User-level permissions (qué puede hacer)
├── Data-level permissions (qué datos ve)
└── Audit trail (quién accedió qué)

CAPA 5: Third-Party Security
├── PAC API Keys: en variables env, nunca en código
├── Email service credentials: secretos
├── S3 credentials: restricted IAM roles
├── Database password: en secret manager
└── No hardcoded credentials anywhere
```

---

## 8. Infraestructura & Deployment

### Local Development

```bash
# Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Docker + Docker Compose
- Git

# Setup
git clone <repo>
cd ERP_CFDI_Mexico
npm install (backend + frontend)
docker-compose up -d (PostgreSQL + Redis)
npm run migrate (ejecutar migraciones SQL)
npm run seed:catalogs (cargar catálogos SAT)
npm run dev (backend + frontend en paralelo)

# Access
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- PostgreSQL: localhost:5432
```

### Production Deployment

```yaml
Cloud Provider: AWS / Azure / GCP (agnóstico)

Architecture:
├── Load Balancer
│   ├── SSL Termination
│   ├── Auto-scaling
│   └── Geolocation routing
├── Kubernetes Cluster (3+ nodes)
│   ├── Backend Pods (auto-scaled)
│   ├── Frontend Pods (CDN)
│   ├── Redis Cache
│   └── Job Queue (background tasks)
├── Managed Database (RDS PostgreSQL)
│   ├── Multi-AZ replication
│   ├── Automated backups
│   ├── Read replicas for reports
│   └── Encryption at rest
├── Object Storage (S3)
│   ├── XMLs
│   ├── PDFs
│   ├── Backups
│   └── Logs
├── Monitoring & Logging
│   ├── CloudWatch / Azure Monitor
│   ├── DataDog (APM)
│   ├── ELK Stack (logs centralizados)
│   └── PagerDuty (alertas)
└── CDN (CloudFlare)
    ├── Static assets
    ├── DDoS protection
    └── Certificate management

Deployment Steps:
1. Code to GitHub
2. GitHub Actions: test + lint + build
3. Build Docker images
4. Push to ECR/ACR
5. Deploy to Kubernetes (rolling update)
6. Run database migrations
7. Health checks + smoke tests
8. Traffic switchover

Zero-Downtime Deployments:
- Rolling updates (10% at a time)
- Database migrations (backward compatible)
- API versioning if needed
- Circuit breakers for external APIs
```

---

## 9. Performance & Scaling

```
Optimizations:
├── Database
│   ├── Índices en RFC, folio, fecha
│   ├── Query optimization (explain analyze)
│   ├── Particionamiento por empresa (si es necesario)
│   ├── Archive old data (>2 años offline)
│   └── Read replicas para reports
├── API
│   ├── Pagination (no más de 100 items)
│   ├── Lazy loading
│   ├── Response compression (gzip)
│   ├── Caching (Redis)
│   └── Async jobs para operaciones pesadas
├── Frontend
│   ├── Code splitting (lazy load routes)
│   ├── Image optimization
│   ├── Bundle analysis
│   ├── Virtual scrolling (tablas grandes)
│   └── Service Workers (offline capability)
└── Infra
    ├── Auto-scaling basado en CPU/memoria
    ├── CDN para assets estáticos
    ├── Database connection pooling
    └── Load balancing

Scaling Strategy:
1-1000 users: Single server (t3.medium)
1000-10k users: Kubernetes (3+ nodes)
10k+ users: Multi-region, sharding por empresa
```

---

## 10. Testing Strategy

```
Unit Tests (Jest):
├── Utilities & helpers (100% coverage)
├── Validators (100%)
├── CFDI generator (95%+)
└── Calculations (100%)

Integration Tests:
├── API endpoints (happy path + error cases)
├── Database transactions
├── External API mocks (PAC, SAT)
└── Authentication flows

E2E Tests (Cypress):
├── Login flow
├── Create invoice
├── View report
├── Download PDF
└── Send email

Performance Tests (k6):
├── 1000 concurrent users
├── Invoice creation under load
├── Report generation at scale
└── PDF generation throughput

Security Tests:
├── OWASP Top 10 scanning
├── SQL injection tests
├── XSS tests
├── CSRF tests
└── Encryption validation

Test Coverage Target: 80%+ overall
Critical paths: 95%+
```

---

## Resumen de Arquitectura

✅ **Cloud-First:** SaaS completamente en internet
✅ **Lightweight:** Minimal storage, maximal automation
✅ **SAT-Compliant:** Validación contra catálogos oficiales
✅ **PAC-Ready:** Integración limpia y sin acoplamiento
✅ **Scalable:** De 1 a 100,000 usuarios sin cambios arquitectónicos
✅ **Secure:** Múltiples capas de seguridad
✅ **Auditable:** Completo trail para requerimientos fiscales
✅ **Maintainable:** Código modular, bien documentado

---

**Última actualización:** Junio 7, 2026
**Versión:** 0.1.0
**Próximo paso:** Ver DATABASE.sql


---

# ═══ Motores de contabilidad ═══

_(origen: `docs/MOTORES_CONTABILIDAD.md`)_

# Motores de contabilidad — GDM NEXO

Inventario de los "motores" (servicios) del módulo contable y de lo que hace cada uno.
Ruta: `backend/src/modules/accounting/` salvo donde se indique. Actualizado 2026-09-08.

## 1. Catálogo y terceros
- **catalogo.service** — El catálogo de cuentas: siembra con el Anexo 24, alta/edición
  (número, nombre, moneda, agrupador), árbol, borrar/tombstone, `asignarAgrupadorFaltante`
  (hereda del padre), `proponerAgrupadoresDelCatalogo`/`aplicarAgrupadoresPropuestos`
  (por nombre vs Anexo 24, a confirmar), **importar/exportar Excel del catálogo**,
  `revisarCatalogo` (errores de estructura). **Subcuentas de arranque** (`SUBCUENTAS_ARRANQUE`
  en catalogo-sat.data): detalle de trabajo para rubros que el SAT deja como cuenta mayor —703
  «Gastos y Productos Financieros»: 703.01 Comisiones bancarias, .02 Intereses a cargo, .03
  Pérdida cambiaria, .04 Intereses a favor, .05 Utilidad cambiaria—. NO son códigos del
  agrupador (no entran en `sat_codigos_agrupadores`): se siembran por empresa con
  `codigo_agrupador = 703` (el mayor REAL), nunca su propio número, para que el Anexo 24 reporte
  703. Habilitan la cuenta de comisiones de la conciliación de Tesorería.
- **catalogo-terceros.service** — Subcuentas de cliente/proveedor (terceros):
  `resolverOCrearSubcuentaTercero`, `cuentaControl` (105.01/201.01 o su padre 105/201),
  numeración `1-10-25-0XX`, `generarSubcuentasDeComprobantes`. Respeta el número del
  respaldo; rellena agrupador en vez de renumerar.
- **mapeador-sat.service** — Empata un catálogo AJENO con el Anexo 24 **por nombre +
  herencia del padre**, con grado de confianza (`proponerMapeo`). Lo usan "Proponer
  agrupador" y el análisis de respaldo.

## 2. Pólizas (el libro diario)
- **polizas.service** — Motor de pólizas (journal): listar, póliza manual, **editar**,
  borrar, y **generar** ventas/compras/cobros-pagos del mes. El **cuadre lo garantiza un
  trigger de BD** (`poliza_cuadra`, DEFERRABLE): no se guarda una póliza descuadrada.
- **ventas-cuentas.service** / **compras-cuentas.service** — Asignación de cuenta por
  producto/clave SAT y armado de las pólizas de venta/compra (ventas→401, compras→115/601,
  IVA 119.01/208/209).
- **activos-fijos.service** — Activo fijo y depreciación (línea recta, LISR 33-35), póliza
  mensual idempotente (gasto 701/702, acumulada 171/183).

## 3. Periodos, balanza y estados
- **periodos.service** — Ejercicios y periodos: activar (12 meses), `contextoDelPeriodo`,
  `balanzaDelPeriodo`, `auxiliarDeCuenta`, **`alimentarDesdeBalanza`** (carga la balanza del
  respaldo → saldos iniciales/apertura), **`alimentarDesdePolizas`** (deriva la balanza del
  mes desde las pólizas, **arrastrando** las cuentas sin movimiento), cerrar/reabrir.
- **estados-financieros.service** — Estados NIF a partir de los saldos ya agrupados:
  situación financiera (B-6), resultado integral (B-3), **flujo de efectivo** (B-2,
  indirecto), cambios en el capital (B-4), razones, análisis horizontal, `juegoCompleto`.
- **balanza-lector.service** — Lee una balanza EXTERNA (Excel/PDF), marca hojas y analiza
  el cuadre (paso previo a cargar apertura).

## 4. Diagnóstico y mantenimiento
- **validacion-contable.service** — **Cuadre contable**: valida póliza por póliza
  (cargos=abonos), la balanza, el balance ↔ estado de resultados, y el **localizador** de
  descuadre (secciones + cuentas fuera de rubro). Exporta `enRubro`/`seccionDe`.
- **reportes-especiales.service** — **Balanza especial** y **situación especial**:
  agrupadas por dígito agrupador del SAT y por cuenta, con "fuera de rubro", para hallar el
  error.
- **nif-motor.service** + **nif-reglas.data** — Motor de **reglas NIF** (C-3 estimación de
  incobrables, C-4 inventarios, C-6 depreciación, A-5 ecuación contable, B-6 sin clasificar,
  etc.): evalúa una balanza y devuelve hallazgos (cumple/no cumple/revisar).
- **cambio-cuenta.service** — Reasignar partidas (MIG-TEMPORAL → cuenta real, por rango de
  fechas), **fusionar** cuentas (mueve partidas, reengancha hijos, borra la origen),
  `candidatasDuplicadas`, `auxiliarDeCuentaRango`, `partidasDeCuenta`.

## 5. Importación y reportes
- **contpaqi-import.service** — Importa el **respaldo CONTPAQi** (catálogo, pólizas,
  terceros, CFDI); **exige e.firma** (salvo "sólo catálogo"); al terminar dispara la
  descarga masiva de XML del SAT.
- **contpaqi-txt.service** — Importa los **TXT de ancho fijo de CONTPAQi** (latin1): el
  **catálogo** (crea cuentas ligando por el padre explícito, naturaleza por la letra y
  agrupador SAT validado contra el Anexo 24) y las **pólizas** (mapea por código, idempotente
  por UUID, cuadra por el trigger de BD). Camino de arranque cuando NO se tiene el respaldo
  completo. Importa DE `catalogo.service`, nunca al revés.
- **reportes-export.service** — **Excel y PDF** de balanza, auxiliar, situación, resultados,
  flujo, capital, razones, el **reporte anual** (12 columnas) y el **catálogo**.

## 6. Relacionados (otros módulos)
- **treasury/conciliacion-contable.service** — Conciliación **banco ↔ contabilidad**:
  sugerir por importe/fecha, cotejar contra la 102 asentada, contabilizar/descontabilizar.
- **sat-descarga/** — Descarga masiva de XML del SAT: credencial e.firma (bóveda cifrada),
  trabajos, calendario de cobertura. (Enciende con `ENABLE_SAT_DESCARGA_CRON=true`.)
- **nomina/nomina-import.service** — Importa la nómina del respaldo NomiPaq y arma su
  contabilización.

---
*Cómo se conectan:* respaldo → catálogo + terceros + pólizas → `alimentarDesdePolizas`
deriva la balanza del periodo → `estados-financieros` arma los estados → `validacion` y
`reportes-especiales` diagnostican → `cambio-cuenta` corrige → `reportes-export` entrega.


---

# ═══ Códigos del SAT (contabilidad) ═══

_(origen: `docs/CODIGOS_SAT_CONTABILIDAD.md`)_

# Códigos del SAT que deben coincidir (motores de Contabilidad)

Los motores contables **no adivinan** la cuenta: la buscan por su **agrupador del
Anexo 24** (`codigo_agrupador`) o por su **código** con esa máscara. Si la cuenta con
ese agrupador no existe en el catálogo de la empresa, el motor **omite** la partida y
lo dice (no inventa la cuenta). Por eso, para que "se activen" las cédulas y las
pólizas automáticas, el catálogo debe tener cuentas con estos agrupadores.

> La cuenta se localiza por el agrupador (3 dígitos antes del punto). Da igual la
> numeración interna de la empresa: lo que importa es el `codigo_agrupador`.

---

## 1. Activo fijo y depreciación / amortización (LISR 33–35, NIF C-6/C-8)

La **cédula de activo fijo** se activa cuando la cuenta de activo tiene un agrupador
**151–182**. La regla (tasa, gasto y acumulada) sale de `depreciacion.data.ts`:

| Agrupador activo | Rubro | Tasa máx. | Gasto | Acumulada |
|---|---|---|---|---|
| 151 | Terrenos | — (no se deprecia) | — | — |
| 152 | Edificios y construcciones | 5% | 701.01 | 171.01 |
| 153 | Maquinaria y equipo | 10% | 701.02 | 171.02 |
| 154 | Automóviles, camiones, transporte | 25% | 701.03 | 171.03 |
| 155 | Mobiliario y equipo de oficina | 10% | 701.04 | 171.04 |
| 156 | Equipo de cómputo | 30% | 701.05 | 171.05 |
| 157 | Equipo de comunicación | 10% | 701.06 | 171.06 |
| 158 | Activos biológicos | 25% | 701.07 | 171.07 |
| 159 | Obras en proceso | — (no se deprecia) | — | — |
| 160 | Otros activos fijos | 10% | 701.08 | 171.08 |
| 161–169 | Ferrocarriles, embarcaciones, aviones, troqueles, energía renovable, etc. | 6–100% | 701.09–701.11 / 701.02 | 171.x |
| 170 | Adaptaciones y mejoras | 5% | 701.01 | 171.01 |
| 173–182 | **Diferidos/intangibles** (se AMORTIZAN) | 5–15% | **702.0x** | **183.0x** |

- **Cargo** al gasto **701.x** (depreciación) / **702.x** (amortización).
- **Abono** a la **acumulada** complementaria: subcuenta bajo **171** (tangibles) /
  **183** (intangibles). Si la subcuenta por rubro no existe, se **crea al vuelo**
  bajo su mayor 171/183.
- Terrenos (151), obra en proceso (159) y crédito mercantil (180) **se registran
  pero no generan póliza**.
- Póliza mensual **idempotente** (una por mes y activo).

---

## 2. Pólizas de VENTA (CFDI emitido, tipo I)

Una por factura, **partida por producto**. Reglas (`generarVentasDelMes`):

| Concepto | Cuenta (agrupador) | Lado |
|---|---|---|
| Cliente | **105.01** (subcuenta del tercero, al vuelo) | cargo TOTAL |
| Ingreso por producto | **401.xx** (mapa producto→cuenta) | abono NETO (importe − descuento) |
| IVA trasladado | **208.01** si PUE · **209.01** si PPD | abono IVA |
| ISR que te retiene el cliente | **113.02** (ISR a favor) | cargo |
| IVA que te retiene el cliente | **113.01** (IVA a favor) | cargo |

- Cada **ClaveProdServ** necesita su cuenta **401** asignada (mapa producto→cuenta);
  sin ella, esa factura se **omite** con aviso.
- **208 vs 209** = flujo del IVA: se causa al **cobrar**. PUE va directo a 208; PPD
  entra en 209 y pasa a 208 con el complemento de pago.

## Complementos de pago (venta)
Al cobrar un PPD: **cargo 209.01** (IVA no cobrado) → **abono 208.01** (IVA cobrado);
**cargo 102.01** (banco) → **abono 105** (cliente).

---

## 3. Pólizas de COMPRA (CFDI recibido) — y el motor de PASIVOS

Una por factura recibida, **partida por producto** (`generarComprasDelMes`). Aquí es
donde **nace el pasivo**: el abono al proveedor es la cuenta por pagar.

| Concepto | Cuenta (agrupador) | Lado |
|---|---|---|
| Gasto / inventario por producto | **115** (inventario) / **601** (gasto) según mapa | cargo NETO |
| IVA acreditable | **119.01** (IVA acreditable por pagar) | cargo IVA |
| **Proveedor (PASIVO)** | **201.xx** (subcuenta del tercero, al vuelo) | **abono TOTAL** |
| ISR que retienes al proveedor | **216.05/04/03/01/216** | abono (por enterar) |
| IVA que retienes al proveedor | **216.10 / 216** | abono (por enterar) |

- El **pasivo por CFDI** = el abono a la subcuenta de **201** (cuentas por pagar), más
  las **retenciones por enterar** en **216** (también pasivo). El IVA acreditable
  vive en **119** hasta que se paga (pasa a **118** con el complemento de pago).
- Sin cuenta **119.01** / **201** / **216** el motor **omite** la partida y lo avisa.

## Complementos de pago (compra)
Al pagar un PPD: **cargo 118.01** (IVA acreditable pagado) → **abono 119.01**;
**cargo 201** (proveedor) → **abono 102.01** (banco).

---

## 4. Tarjeta de crédito (pasivo) — ver también BITÁCORA 2026-09-09
Compra con CFDI → gasto + **119.01** IVA acreditable / **abono a la tarjeta** (201/205);
intereses → cuenta de intereses configurada; el pago sale del banco.

---

## 5. Balanza de comprobación desde pólizas

`alimentarDesdePolizas(empresa, año, mes)` (botón **«Actualizar desde pólizas»** /
**«Reconstruir año»**) hace exactamente lo que esperas:

1. **Revisa TODAS las pólizas del mes calendario** (`journal_entries.fecha` entre el
   1º y el último día del periodo), agrupando por cuenta la suma de cargos y abonos.
2. **Saldo inicial** de cada cuenta = **saldo final del mes anterior** (enlaza la serie).
3. **Saldo final** = inicial + cargos − abonos, **según la naturaleza** (deudora suma
   cargos − abonos; acreedora al revés).
4. El **trigger de BD** garantiza que cada póliza cuadre (Σcargos = Σabonos), así que
   la balanza siempre cuadra; si el **balance** no cuadra es por cuentas sin agrupador
   que no llegan a un rubro del estado (lo detecta `/contabilidad/validacion`).
5. Un periodo **CERRADO** no se recalcula sin reabrirlo (base del cierre mensual/anual).

**Requisito para el 100%:** que el catálogo tenga las cuentas con los agrupadores de
arriba (401, 105, 208/209, 113 · 115/601, 119, 201, 216, 118 · 151–182, 701/702,
171/183 · 102). Si falta alguno, esa partida no se contabiliza y el motor lo dice.


---

# ═══ Bugs resueltos ═══

_(origen: `docs/BUGS_RESUELTOS.md`)_

# Bitácora de bugs resueltos — pruebas pre-producción

Documento de referencia para futuros desarrolladores o para diagnóstico de
regresiones. Cada entrada tiene:

- **Síntoma** — qué veía el usuario
- **Causa** — por qué pasaba
- **Fix** — qué cambió
- **Commit** — hash para localizar el diff

Orden cronológico inverso (más reciente arriba).

---

## Administración — borrado de empresa

### 🐛 «Eliminar empresa completa» revienta con FK de `stamp_usage`
- **Síntoma**: al borrar una empresa de pruebas: `update or delete on table "invoices" violates foreign key constraint "stamp_usage_invoice_id_fkey" on table "stamp_usage"`.
- **Causa**: la rutina de **borrado total** (`admin-companies.routes` `full-delete`) borraba `invoices` sin limpiar antes sus hijos con FK RESTRICT `stamp_usage` y `cfdi_validations`. El `wipe-operations v2` ya lo hacía bien, pero el full-delete (y el viejo `reset-operations`) se quedaron con el orden incompleto.
- **Fix**: antes de `DELETE FROM invoices`, borrar `stamp_usage` y `cfdi_validations` (por `invoice_id`), más `pos_sale_items`/`pos_sales` en el full-delete. Aplicado en las dos rutinas.
- **Commit**: `55876c2` (2026-09-08)

## Contabilidad — numeración, cuadre y fechas

### 🐛 La balanza «desde pólizas» pierde las cuentas SIN movimiento del mes (capital, acumulados) → el balance no cuadra
- **Síntoma**: en el estado de situación financiera y en la balanza de un mes derivado de pólizas (p.ej. Nov-2017) NO aparecían las cuentas de capital (capital social 301, resultados de ejercicios anteriores 304, etc.) que sí salían en el mes cargado del respaldo de balanza (Oct-2017). El balance quedaba descuadrado (C = A − P daba −4,739.54 pero el capital listado era −5,500.21; dif. 760.67).
- **Causa**: `alimentarDesdePolizas` (periodos.service) sólo insertaba en `accounting_period_balances` las cuentas **con movimiento del mes** (`HAVING SUM(cargo)<>0 OR SUM(abono)<>0`). Las que traen saldo de apertura/arrastre pero no se mueven cada mes (capital, acumulados) quedaban en el mapa de saldos iniciales pero nunca se insertaban → desaparecían de la balanza y del estado.
- **Fix**: tras insertar las cuentas con movimiento, se **arrastran** las que traen saldo del mes anterior (`ini`) y no tuvieron movimiento, con `saldo_final = saldo_inicial`. Hay que re-derivar los meses afectados en ORDEN (cada mes arrastra del anterior).
- **Commit**: `d8bf31f` (2026-09-08)

### 🐛 El flujo de efectivo no concilia aunque el balance cuadre
- **Síntoma**: «El flujo de efectivo no concilia por X: los tres flujos suman A y el efectivo se movió B». No se veía "la partida que falta".
- **Causa**: el método indirecto (`flujoEfectivo`) enumeraba sólo un subconjunto de cuentas de capital de trabajo (105-107, 115, 201/202/205, 207-209/213/216…) y dejaba fuera otras que sí variaron (110-114, 203/206, 217/218, etc.).
- **Fix**: se agrega la línea **«Variación de otras cuentas de operación»** = el resto (cambio del efectivo − los tres flujos), para conciliar por construcción. Con el balance cuadrado es clasificación faltante, no error.
- **Commit**: `769599e` (2026-09-08)

### 🐛 En «Cambio de cuenta» el botón Reasignar «no funcionaba»
- **Síntoma**: al reasignar partidas, parecía que no pasaba nada.
- **Causa**: el backend sí movía las partidas, pero la **lista de partidas en pantalla no se refrescaba** (seguía mostrando las ya movidas). Además no filtraba por el rango de fechas.
- **Fix**: la lista se recarga tras reasignar (prop `recarga`) y **filtra por Desde/Hasta** (backend `partidasDeCuenta` con fechas). El `#folio` abre el editor y al guardar regresa a Cambio de cuenta.
- **Commit**: `858644c`, `990c163` (2026-09-08)

### 🐛 Los calendarios se ven MM/DD/AAAA en equipos en inglés
- **Síntoma**: los controles de fecha mostraban `11/01/2017` (1-nov) en formato de EE.UU., confundiendo.
- **Causa**: `<input type="date">` nativo se dibuja con el formato del navegador; no hay atributo que lo fuerce.
- **Fix**: se usan el componente `CampoFecha` (siempre DD/MM/AAAA, valor interno ISO) en Auxiliar y Cambio de cuenta.
- **Commit**: `2b8c202` (2026-09-08)



### 🐛 Los clientes caían en `1-10-02-###` en vez de `1-10-25-###` (una cuenta suelta "se hacía de mayor")
- **Síntoma**: al generar subcuentas de terceros, los clientes se colgaban de una cuenta suelta `1-10-02-074` que acumulaba movimientos como si fuera el control, en lugar del mayor real de clientes `1-10-25-000`.
- **Causa**: el mayor de clientes `1-10-25-000` trae el agrupador **padre `105`**, y sus terceros el específico `105.01`. `cuentaControl` buscaba **sólo** `105.01`, así que no veía el mayor y tomaba como "control" la primera hoja que tuviera `105.01`.
- **Fix**: buscar el control por `105.01` **O** su padre `105` (`agrupador.split('.')[0]`), igual proveedores `201.01`/`201`; preferir el mayor «redondo» (`…-000`) y el que ya tiene más terceros. Las cuentas mal ubicadas ya creadas se corrigen con fusión manual (Cambio de cuenta → «Fusionar (borra la origen)», commit `b906ad0`).
- **Commit**: `e5460a1`

### 🐛 Se inventaban códigos de tercero (`11002074-001`) en vez de ligar la cuenta del respaldo
- **Síntoma**: aparecían subcuentas duplicadas con un segmento de más (`1-10-25-001-076`) junto a la real del respaldo (`1-10-25-076`).
- **Causa**: cuando una cuenta del respaldo no se reconocía como tercero **porque le faltaba el agrupador del SAT**, el sistema inventaba un código nuevo en vez de ligar la cuenta existente.
- **Fix**: «Generar subcuentas» ahora rellena el agrupador faltante heredándolo del padre (`asignarAgrupadorFaltante`) en vez de renumerar; con el agrupador puesto, el enlace encuentra la cuenta real del respaldo y la liga por su número. No se deduce el agrupador por el número de cuenta (los catálogos difieren del SAT): sólo se señalan las que les falta. `MASCARA_DEFAULT='#-##-##-###'` cuando la empresa no fijó máscara.
- **Commit**: `a0718a3` (máscara por defecto en `6fa73bb`)

### 🐛 `non-integer constant in ORDER BY` → se omitían TODAS las pólizas de venta/compra
- **Síntoma**: no se generaba ninguna póliza de venta ni de compra en empresas sin máscara de cuenta.
- **Causa**: `cuentaControl` construía un `ORDER BY` con una constante booleana suelta (`ORDER BY (FALSE)`) cuando el ancho de máscara era 0; Postgres lo rechaza.
- **Fix**: armar el `ORDER BY` por partes (sólo columnas/expresiones válidas) y usar `MASCARA_DEFAULT`.
- **Commit**: `c58dffe`

### 🐛 Calendario de descarga SAT todo gris (ningún día marcado)
- **Síntoma**: el calendario de cobertura de XML salía completamente gris aunque había XML descargados.
- **Causa**: una columna `::date` de node-postgres regresa un objeto **Date** de JS, no un string. `String(date).slice(0,10)` daba `"Wed Jan 02"`, que nunca casa con las claves `YYYY-MM-DD` del calendario.
- **Fix**: `TO_CHAR(COALESCE(fecha_emision,fecha_timbrado),'YYYY-MM-DD')` en las tres queries de cobertura. Además calendario combinado (emitidos+recibidos) con conteo por día.
- **Commit**: `7a5e1cc` (combinado en `6fa73bb`)

### 🐛 Conciliación: `invalid input syntax for type date: 'Tue Jan 02'`
- **Síntoma**: «Contabilizar» un movimiento del estado de cuenta reventaba con ese error.
- **Causa**: mismo origen que el calendario — `contabilizar` usaba `String(m.fecha)` sobre un objeto Date de node-postgres.
- **Fix**: `TO_CHAR(bm.fecha,'YYYY-MM-DD') AS fecha_ymd` y usar ese string para la póliza.
- **Commit**: `78bfd30`

### 🐛 Nómina: sólo 3 expedientes de 6 trabajadores
- **Síntoma**: al importar el respaldo de nómina, la mitad de los trabajadores no generaba expediente.
- **Causa**: la zona se importaba como `'frontera'`, que viola el `CHECK` `nomina_empleados_zona_ck` (el valor válido es `'frontera_norte'`) → los empleados de esa zona se rechazaban.
- **Fix**: mapear a `'frontera_norte'`. Aparte: percepciones/deducciones negativas violaban el `CHECK` de montos (totales ≥ 0); se voltean al lado correcto.
- **Commit**: `78bfd30`

---

## Cancelación

### 🐛 `SW no encuentra el CFDI en su vault (404)` al reintentar cancelar
- **Síntoma**: cancelar factura timbrada con SW real rebotaba con 404 incluso después de haber cancelado NC y pagos vigentes.
- **Causa**: endpoint incorrecto. Se estaba llamando a `/v4/cfdi33/cancel/{rfc}` — una mezcla mal formada. Los válidos son `/cfdi33/cancel/{rfc}` (legacy) y `/v4/cfdi/cancel/{rfc}` (recomendado, sin "33").
- **Fix**: corregir a `/v4/cfdi/cancel/{rfc}` + parsear `data.uuid = { "<UUID>": "<código>" }` para distinguir aceptación (201/202) de rechazo (205) + logging detallado.
- **Commit**: `1a40cf3`

### 🐛 Cancelación local exitosa pero SW seguía reportando vigente
- **Síntoma**: después de "Cancelar solo localmente", el ERP marcaba `CANCELLED` pero swpanel.mx seguía mostrando la factura vigente.
- **Causa**: el bypass local intencionalmente NO llamaba al PAC. No había forma de re-enviar la cancelación al PAC sin tocar la BD manualmente.
- **Fix**: `pac.service.cancelInvoice` detecta `isResendToPAC` cuando la factura ya está `CANCELLED` con `pac_id=SW_SAPIEN` y `forceLocal=false`. Salta validación de dependientes y solo notifica al PAC. Frontend: el ícono naranja aparece también para facturas canceladas (tooltip "Reintentar en el PAC").
- **Commit**: `1a40cf3`

### 🐛 `Cancelación fallida: Request failed with status code 404`
- **Síntoma**: al cancelar cualquier factura desde el ERP, SW rebotaba con 404.
- **Causa**: `pac.service.cancelInvoice` mandaba `rfcEmisor = 'ABC010101ABC'` (comentado como *placeholder*). SW buscaba ese RFC inexistente en su vault.
- **Fix**: leer `companies.rfc` real desde la BD antes de invocar al PAC.
- **Commit**: `7c7edae`

### 🐛 Botón "Cancelar" oculto para pagos sin UUID
- **Síntoma**: complementos de pago que quedaron en estado sin UUID (MOCK antiguo) no mostraban botón Cancelar en el modal Historia → factura padre imposible de cancelar por círculo vicioso.
- **Causa**: el botón vivía dentro de `{r.uuid && (...)}`. Sin UUID no aparecía.
- **Fix**: mover Cancelar fuera del bloque condicional del UUID. PDF y XML siguen requiriendo UUID, pero Cancelar aplica siempre.
- **Commit**: `09c56cc`

### 🐛 Panel de facturas no se actualiza tras cancelar pago/NC
- **Síntoma**: cancelar un pago actualizaba el status de la factura padre en BD, pero la lista seguía mostrando saldo cero.
- **Causa**: los subqueries de `paid_total` y `balance` en `listInvoices` (y otros 7 lugares del código) no filtraban `document_status = 'CANCELLED'`. El monto de un pago cancelado seguía descontándose del saldo.
- **Fix**: `AND document_status != 'CANCELLED'` en:
  - `invoices.service.listInvoices`
  - `invoices.routes /dashboard/summary`
  - `credit-notes.service.getInvoiceBalance` (reduce)
  - `credit-notes.service.createCreditNote` (validación)
  - `payments.service.sumPaidForInvoice`
  - `payments.service` update customer balance
  - `reports.service.getReceivables`
  - `pdf-payment.service` (saldo anterior)
- **Commit**: `ac9c04e`

---

## Cálculos de saldo y status

### 🐛 Factura no pasaba a PAID cuando pago + NC cubrían el total
- **Síntoma**: FAC-000006 (total $5,204.16) con NC $260.21 + pago $4,943.95 (saldo real $0) seguía en `PARTIAL_PAYMENT`.
- **Causa**: `payments.service.createPayment` calculaba `nuevoStatus = pagos_acum >= total ? PAID : PARTIAL_PAYMENT`. Ignoraba las NC.
- **Fix**: `cubierto = pagos_acum + NC_aplicadas`. Si `cubierto >= total - 0.01` → `PAID`. Además migración one-shot `2026-07-08_recompute_invoice_paid_status.sql` que corrige facturas afectadas.
- **Commit**: `2b80226`

### 🐛 `ImpSaldoAnt`/`ImpSaldoInsoluto` del complemento de pago no descontaban NC
- **Síntoma**: PDF y XML del complemento de pago mostraban insoluto igual al monto de la NC ya aplicada.
- **Causa**: `saldoAnterior = total − pagos_previos` — sin NC.
- **Fix**: `saldoAnterior = max(0, total − pagos_previos − NC_aplicadas)`. XML y PDF alineados.
- **Commit**: `58034b2`

---

## PDF, XML y timbrado

### 🐛 `NO. CERTIFICADO — pendiente —` en NC y complemento de pago
- **Síntoma**: la factura mostraba el certificado real, pero NC y pago decían "pendiente".
- **Causa**: el XML de NC y pago se genera **localmente** (no viene de SW real), y no incluía el atributo `NoCertificado` del root `<cfdi:Comprobante>` ni los nodos `<cfdi:Emisor>` / `<cfdi:Receptor>`. El helper `extractTimbreData(xml)` no encontraba nada.
- **Fix**: ambos servicios cargan `companies` y `customers` en la misma transacción y arman el XML con esos atributos. Fallback al cert sandbox `00001000000506430009` si el CSD del emisor no está en BD.
- **Commit**: `266a916`

### 🐛 QR SAT ausente y sellos falsos en el bloque timbre
- **Síntoma**: los PDFs mostraban sellos generados por regex (no reales) y no incluían el QR de verificación SAT.
- **Causa**: `drawTimbreFiscal` fabricaba las cadenas Base64 a partir del UUID. Nunca se leían los sellos reales del XML timbrado ni se generaba QR.
- **Fix**: nuevos helpers `extractTimbreData(xml)` y `buildQrSatPng()`. `drawTimbreFiscal` acepta `xml` + `qrPng` y renderiza el QR (90×90pt) a la derecha con leyenda "Verificar en portal SAT". URL Anexo 20: `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=<UUID>&re=<RFC_E>&rr=<RFC_R>&tt=<TOTAL_padded>&fe=<8ULTIMOS_SELLOCFD>`.
- **Commit**: `b93e597`

### 🐛 `La fecha de emisión no se encuentra en el rango permitido`
- **Síntoma**: SW rechazaba el timbrado con fecha ~6h adelantada.
- **Causa**: `fmtFechaSAT` usaba `d.getHours()` que devuelve la hora local del proceso. En Render eso es UTC. SW valida contra hora de México (UTC-6/-5 con DST).
- **Fix**: `d.toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })` que devuelve `YYYY-MM-DD HH:MM:SS` en la zona correcta. Reemplazar espacio por 'T' para el formato ISO del Anexo 20.
- **Commit**: `dd436e9`

### 🐛 Cliente veía "MODO SIMULACIÓN" aunque el backend timbraba con SW real
- **Síntoma**: la factura recibía UUID real pero el toast decía "PAC MOCK".
- **Causa**: el controller y el frontend hardcodeaban `provider: 'MOCK'` y el mensaje "MODO SIMULACIÓN".
- **Fix**: `pac.controller.stamp` devuelve `provider` real y `is_mock` boolean via `pacService.listProviders()`. Frontend renderiza mensaje distinto según `is_mock`. Endpoint `/pac/providers` incluye `env_pac_provider`, `env_sw_env`, `env_sw_token_present` para diagnóstico.
- **Commit**: `0f67969`

### 🐛 `XmlCFDI no proporcionado o viene vacío` al timbrar por primera vez
- **Síntoma**: SW rebotaba con XML vacío.
- **Causa**: el flujo XML clásico esperaba `invoice.xml_content`, pero nunca se generaba antes. Además el token JWT pegado en Render tenía saltos de línea/prefijo/`...` porque se copió del ejemplo tal cual.
- **Fix**: nuevo serializer `buildCFDIJson()` que arma el JSON CFDI 4.0 desde BD y `SWSapienProvider.stampFromJson()` que POSTea a `/v3/cfdi33/issue/json/v4`. Además guía de setup para pegar el JWT sin corrupción.
- **Commit**: `ab3bd70`

---

## Persistencia y schema

### 🐛 Modal "Saldo" atorado en `Cargando…`
- **Síntoma**: modal Balance y complemento de pago no cargaban, quedaban en estado infinito.
- **Causa**: la query de `getInvoiceBalance` seleccionaba `folio, serie, payment_method, pac_timestamp, xml_content` de `payments`, pero esas columnas no existían en el schema base. La query truena con `42703 column does not exist` y el frontend se queda esperando.
- **Fix**: migración `2026-07-07_payments_missing_columns.sql` con 5 `ADD COLUMN IF NOT EXISTS`.
- **Commit**: `d22be5d`

### 🐛 Checkbox "XML" del complemento de pago siempre deshabilitado
- **Síntoma**: en el SendMailModal, el XML del pago aparecía en gris.
- **Causa**: el endpoint `/balance` devolvía `uuid AS payment_uuid` (con alias) — el frontend buscaba `p.uuid` y siempre veía `undefined`.
- **Fix**: quitar el alias. `SELECT uuid FROM payments` directo.
- **Commit**: `266a916`

---

## Otras correcciones

### 🐛 Cliente MOCK cancelado en producción da 404
- **Síntoma**: cancelar una factura antigua (timbrada con MOCK antes de conectar SW) rebotaba con 404.
- **Causa**: SW busca el UUID en su vault. Como la factura fue timbrada localmente con MOCK, SW no la conoce.
- **Fix**: `pac.service.cancelInvoice` detecta `invoice.pac_id === 'MOCK'` y salta el PAC — solo marca `CANCELLED` en BD.
- **Commit**: `ac9c04e`

### 🐛 Mailer aborta el correo entero si un adjunto falla
- **Síntoma**: si el XML de una NC no estaba timbrado, `sendInvoiceMail` cancelaba todo. Usuario recibía 0 adjuntos.
- **Causa**: `buildAttachments` hacía `throw` al primer error y no capturaba individualmente.
- **Fix**: cada adjunto se procesa en `try/catch`. Errores se acumulan en `skipped`. Backend devuelve `{ attached, skipped }`. Frontend muestra en el toast.
- **Commit**: `b93e597`

---

## Notas para futuro

- Muchos de estos bugs comparten un mismo patrón: **campos calculados que no consideran comprobantes cancelados**. Al agregar nuevas subqueries de `paid`/`credited`, siempre incluir `AND document_status != 'CANCELLED'` (pagos) y `AND status != 'CANCELLED'` (NC).
- El **XML de NC y pago se genera localmente** (no viaja al PAC en este momento). Cualquier cambio a los atributos del Anexo 20 debe hacerse en `credit-notes.service.createCreditNote` y `payments.service.createPayment`. Si en el futuro se conectan al PAC real, migrar a la ruta JSON de SW como se hizo para la factura.
- SW sandbox tiene bugs conocidos de propagación al vault. Ante un 404 real en producción, verificar primero en swpanel.mx si el UUID existe. El bypass local es útil pero deja desincronización.


---

# ═══ Cancelación y CSD ═══

_(origen: `docs/cancelacion-y-csd.md`)_

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


---

# ═══ Complemento de pago (formas) ═══

_(origen: `docs/complemento-pago-formas.md`)_

# Complemento de Pago 2.0 — las tres formas del nodo de impuestos

Cómo se arma el JSON que va a SW Sapien (`/v3/cfdi33/issue/json/v4`) según los
impuestos de la factura que se está pagando. La estructura del comprobante es
idéntica en los tres casos; **lo único que cambia es `ObjetoImpDR`, el nodo
`ImpuestosDR`/`ImpuestosP` y los campos de `Totales`.**

## La envoltura, que es igual siempre

```json
"Complemento": { "Any": [ { "pago20:Pagos": { "Version": "2.0", ... } } ] }
```

Dos detalles que no se deducen de la documentación pública del SAT, porque son
del convertidor de SW:

- el arreglo intermedio se llama **`Any`** — se traduce a `<cfdi:Complemento>`
  con hijos arbitrarios, igual que el `xs:any` del XSD;
- la llave del complemento va **con el prefijo del namespace**: `pago20:Pagos`,
  no `Pagos` a secas.

Sin el prefijo, SW no identifica el complemento y **lo descarta en silencio**: el
comprobante sale tipo `P` sin complemento, SW responde 200 y el rechazo llega del
SAT como `CFDI140230`. Es un error engañoso, porque parece que el complemento no
se envió cuando en realidad se envió mal nombrado.

El comprobante que lo envuelve, en los tres casos:

| Campo | Valor | Por qué |
|---|---|---|
| `TipoDeComprobante` | `P` | |
| `Moneda` | `XXX` | En un tipo P los importes viven en el complemento, no en el comprobante |
| `SubTotal` / `Total` | `"0"` | Misma razón |
| `Exportacion` | `01` | No es exportación |
| `ClaveProdServ` | `84111506` | Clave fija del SAT para "pago" |
| `ClaveUnidad` | `ACT` | Idem |
| `ObjetoImp` (concepto) | `01` | El **concepto** nunca es objeto de impuesto, aunque el documento relacionado sí lo sea |
| `UsoCFDI` | `CP01` | Único válido para tipo P |

No lleva `FormaPago` ni `MetodoPago` ni nodo `Impuestos`.

### La fecha

`Fecha` es la de **emisión**, en hora del lugar de expedición
(`America/Mexico_City`), nunca UTC — el SAT sólo acepta una ventana de 72 horas
hacia atrás y unos minutos hacia adelante. `FechaPago`, dentro del complemento,
es cuándo pagó el cliente y **sí** puede ser pasada. Son campos distintos; usar
la misma fecha para los dos produce comprobantes con fecha vieja.

Se formatean con `fmtFechaSAT()` de `backend/src/modules/cfdi/build-cfdi-json.service.ts`.

---

## Caso A — traslado de IVA 16% (lo que emitimos hoy)

Factura normal con IVA trasladado. El monto cobrado **viene con IVA incluido**, así
que hay que despejar la base.

```json
"pago20:Pagos": {
  "Version": "2.0",
  "Totales": {
    "MontoTotalPagos": "116.00",
    "TotalTrasladosBaseIVA16": "100.00",
    "TotalTrasladosImpuestoIVA16": "16.00"
  },
  "Pago": [{
    "FechaPago": "2026-07-29T12:00:00",
    "FormaDePagoP": "03",
    "MonedaP": "MXN",
    "TipoCambioP": "1",
    "Monto": "116.00",
    "DoctoRelacionado": [{
      "IdDocumento": "daca5d85-b8cd-463b-a056-b021fe33c2f9",
      "Serie": "B", "Folio": "2",
      "MonedaDR": "MXN",
      "MetodoDePagoDR": "PPD",
      "NumParcialidad": "1",
      "ImpSaldoAnt": "1624.00",
      "ImpPagado": "116.00",
      "ImpSaldoInsoluto": "1508.00",
      "EquivalenciaDR": "1",
      "ObjetoImpDR": "02",
      "ImpuestosDR": {
        "TrasladosDR": [{
          "BaseDR": "100.00", "ImpuestoDR": "002",
          "TipoFactorDR": "Tasa", "TasaOCuotaDR": "0.160000",
          "ImporteDR": "16.00"
        }]
      }
    }],
    "ImpuestosP": {
      "TrasladosP": [{
        "BaseP": "100.00", "ImpuestoP": "002",
        "TipoFactorP": "Tasa", "TasaOCuotaP": "0.160000",
        "ImporteP": "16.00"
      }]
    }
  }]
}
```

**El redondeo importa.** El SAT valida `BaseDR × 0.16 == ImporteDR` a dos
decimales. Hay que calcular el impuesto **sobre la base ya redondeada**:

```js
const baseIVA = Math.round((montoPago / 1.16) * 100) / 100;
const ivaPago = Math.round(baseIVA * 0.16 * 100) / 100;
```

Calcularlo sobre la base sin redondear desajusta un centavo en muchos montos y el
comprobante se rechaza.

---

## Caso B — sin impuestos

Factura exenta o no objeto de impuesto. `ObjetoImpDR` es `01` y **no va ningún
nodo de impuestos** — ni `ImpuestosDR` ni `ImpuestosP`. `Totales` lleva sólo
`MontoTotalPagos`.

```json
"pago20:Pagos": {
  "Version": "2.0",
  "Totales": { "MontoTotalPagos": "1.00" },
  "Pago": [{
    "FechaPago": "2026-07-29T00:00:00",
    "FormaDePagoP": "03",
    "MonedaP": "MXN",
    "TipoCambioP": "1",
    "Monto": "1.00",
    "DoctoRelacionado": [{
      "IdDocumento": "daca5d85-b8cd-463b-a056-b021fe33c2f9",
      "Serie": "SW N8N Examples", "Folio": "087",
      "MonedaDR": "MXN",
      "MetodoDePagoDR": "PUE",
      "NumParcialidad": "1",
      "ImpSaldoAnt": "500.00",
      "ImpPagado": "1.00",
      "ImpSaldoInsoluto": "499.00",
      "EquivalenciaDR": "1",
      "ObjetoImpDR": "01"
    }]
  }]
}
```

Poner `ObjetoImpDR: "01"` **y** un nodo `ImpuestosDR` es inválido: se contradicen.
Ese era el defecto que traíamos antes de corregir el caso A.

---

## Caso C — puras retenciones

Servicios donde el cliente retiene el impuesto y no hay traslado: honorarios con
IVA retenido, arrendamiento, fletes con retención. El pago que **entra a caja es
el neto**, ya descontada la retención, pero el complemento declara la **base
completa**.

```json
"pago20:Pagos": {
  "Version": "2.0",
  "Totales": {
    "MontoTotalPagos": "100.00",
    "TotalRetencionesIVA": "10.67"
  },
  "Pago": [{
    "FechaPago": "2026-07-29T12:00:00",
    "FormaDePagoP": "03",
    "MonedaP": "MXN",
    "TipoCambioP": "1",
    "Monto": "100.00",
    "DoctoRelacionado": [{
      "IdDocumento": "daca5d85-b8cd-463b-a056-b021fe33c2f9",
      "Serie": "B", "Folio": "3",
      "MonedaDR": "MXN",
      "MetodoDePagoDR": "PPD",
      "NumParcialidad": "1",
      "ImpSaldoAnt": "300.00",
      "ImpPagado": "100.00",
      "ImpSaldoInsoluto": "200.00",
      "EquivalenciaDR": "1",
      "ObjetoImpDR": "02",
      "ImpuestosDR": {
        "RetencionesDR": [{
          "BaseDR": "100.00",
          "ImpuestoDR": "002",
          "TipoFactorDR": "Tasa",
          "TasaOCuotaDR": "0.106667",
          "ImporteDR": "10.67"
        }]
      }
    }],
    "ImpuestosP": {
      "RetencionesP": [{
        "ImpuestoP": "002",
        "ImporteP": "10.67"
      }]
    }
  }]
}
```

Puntos que distinguen este caso:

- `ObjetoImpDR` es **`02`** (sí objeto de impuesto), como en el caso A. Sólo el
  caso B usa `01`.
- El nodo es **`RetencionesDR`**, sin `TrasladosDR`.
- **`RetencionesP` sólo lleva `ImpuestoP` e `ImporteP`.** No lleva `BaseP`,
  `TipoFactorP` ni `TasaOCuotaP` — a diferencia de `TrasladosP`, que sí los pide.
  Es una asimetría del esquema, no un descuido.
- En `Totales` va `TotalRetencionesIVA` (o `TotalRetencionesISR` /
  `TotalRetencionesIEPS`). **Estos campos no tienen contraparte de base**: no
  existe `TotalRetencionesBaseIVA`, sólo el importe.
- `Monto` y `ImpPagado` son la **base**, no el neto depositado. Si el cliente
  depositó $89.33 tras retener $10.67, el complemento sigue diciendo `100.00`.

### Claves de impuesto

| Clave | Impuesto |
|---|---|
| `001` | ISR |
| `002` | IVA |
| `003` | IEPS |

### Tasas de retención usuales

| Supuesto | Impuesto | Tasa |
|---|---|---|
| IVA retenido a persona física por servicios profesionales | `002` | `0.106667` (dos terceras partes del 16%) |
| ISR retenido por servicios profesionales | `001` | `0.100000` |
| IVA retenido en autotransporte terrestre de carga | `002` | `0.040000` |
| ISR retenido por arrendamiento | `001` | `0.100000` |

La tasa se escribe con **seis decimales**. `0.106667` es la retención de dos
terceras partes del IVA; ponerla como `0.106700` o `0.11` hace que la validación
`BaseDR × TasaOCuotaDR == ImporteDR` no cuadre.

---

## Puede haber traslados y retenciones a la vez

Los casos A y C no son excluyentes: una misma factura puede trasladar IVA 16% y
tener IVA retenido. En ese caso `ImpuestosDR` lleva **los dos arreglos**,
`TrasladosDR` y `RetencionesDR`, y `Totales` lleva tanto
`TotalTrasladosBaseIVA16`/`TotalTrasladosImpuestoIVA16` como
`TotalRetencionesIVA`.

## Estado actual del código

`backend/src/modules/payments/payments.service.ts` implementa **sólo el caso A**,
con la tasa 16% fija, porque así son todas nuestras facturas hoy. Para cubrir B y
C hay que leer los impuestos reales de los conceptos de la factura y elegir la
forma correspondiente. No está hecho: es un cambio de comportamiento que conviene
meter cuando aparezca la primera factura que lo necesite, no antes.

---

## Caso D — pago al RFC genérico (público en general)

Cuando la factura se emitió al público en general, el complemento se emite al
mismo receptor genérico. La estructura del complemento no cambia; lo que cambia
son los datos del `Receptor`.

```json
"Receptor": {
  "Rfc": "XAXX010101000",
  "Nombre": "PUBLICO GENERAL",
  "DomicilioFiscalReceptor": "75700",
  "RegimenFiscalReceptor": "616",
  "UsoCFDI": "CP01"
}
```

Cuatro reglas que el SAT valida en conjunto y que se rompen fácil por separado:

| Campo | Valor obligado | Nota |
|---|---|---|
| `Rfc` | `XAXX010101000` | Nacional. Extranjero es `XEXX010101000` |
| `Nombre` | `PUBLICO GENERAL` | Exacto, en mayúsculas y **sin acento** en "PUBLICO" |
| `RegimenFiscalReceptor` | `616` | "Sin obligaciones fiscales". Es el único que admite el genérico |
| `DomicilioFiscalReceptor` | el del **emisor** | No hay domicilio del receptor: se repite `LugarExpedicion` |

`UsoCFDI` sigue siendo `CP01`, como en cualquier tipo P.

Que `DomicilioFiscalReceptor` sea el código postal del emisor es
contraintuitivo pero es lo correcto: al público en general no se le conoce
domicilio, y el SAT pide que ese campo coincida con el lugar de expedición.

**Nuestro validador de RFC lo rechaza a propósito como proveedor**
(`validarRfcSat()` en `backend/src/utils/validators.ts`), porque un genérico no
sirve para registrar a quién le compramos. Como **receptor** de venta sí es
válido: son dos usos distintos del mismo dato y no hay que unificar esa
validación.

---

## Un pago puede liquidar varias facturas

`DoctoRelacionado` es un arreglo, y el caso normal en cobranza es que un depósito
cubra varias facturas. Cada elemento lleva su propio `IdDocumento`,
`NumParcialidad`, saldos e `ImpuestosDR`:

```json
"Monto": "6778.00",
"DoctoRelacionado": [
  { "IdDocumento": "b7c8d2bf-...", "Serie": "FA", "Folio": "N0000216349",
    "NumParcialidad": "2", "ImpSaldoAnt": "6777.41",
    "ImpPagado": "6777.41", "ImpSaldoInsoluto": "0.00", ... },
  { "IdDocumento": "94f4e541-...", "Serie": "FA", "Folio": "SI000032690",
    "NumParcialidad": "1", "ImpSaldoAnt": "9610.81",
    "ImpPagado": "0.59",    "ImpSaldoInsoluto": "9610.22", ... }
]
```

Dos cosas que se derivan de ahí:

- **`NumParcialidad` es por factura, no por pago.** En el ejemplo, un mismo pago
  es la parcialidad 2 de una factura y la 1 de otra.
- **`Monto` del pago debe cuadrar con la suma de los `ImpPagado`.** Aquí
  `6777.41 + 0.59 = 6778.00`.

Y `ImpuestosP` / `Totales` son la **suma de todos los documentos** del pago, no
los de uno: `5842.60 + 0.51 = 5843.11` de base.

### Los decimales de ImpuestosDR

El ejemplo escribe `BaseDR: "5842.600000"` e `ImporteDR: "934.816000"` — **seis
decimales**, no dos. Es válido y a veces necesario: el SAT valida
`BaseDR × TasaOCuotaDR == ImporteDR`, y con importes que no son múltiplos
redondos la igualdad sólo cuadra si se conserva la precisión. Nótese que
`934.816` redondeado a dos decimales sería `934.82`, pero `Totales` declara
`934.90` porque suma las dos facturas antes de redondear.

En cambio `MontoTotalPagos`, `Monto`, `ImpPagado`, `ImpSaldoAnt` e
`ImpSaldoInsoluto` van con **dos decimales**: son dinero, no bases de cálculo.

## Estado actual del código, ampliado

`payments.service.ts` emite hoy **un solo `DoctoRelacionado`**, porque la pantalla
registra el pago contra una factura a la vez. Para cobrar un depósito que cubre
varias hay que cambiar también la interfaz, no sólo el XML: es un cambio de
alcance mayor que el resto de los casos de este documento.


---

# ═══ Diseño de planes de facturación ═══

_(origen: `docs/DISENO_FACTURACION_PLANES.md`)_

# Módulo Facturación y Consumo — diseño

> **ESTADO: ✅ IMPLEMENTADO (las 5 fases)** — commits `e5a6e47` (F1),
> `56730cb` (F2), `7f4cec4` (F3), `7473c6e` (F4), F5 en el commit que
> acompaña esta edición.
>
> Para activar en producción, configurar en Render → Backend → Environment:
> `PLATFORM_COMPANY_RFC=<RFC de HCGM>` y `ENABLE_BILLING_CRON=true`.

Propuesta del nuevo módulo SUPER_ADMIN que se agrega después de
**Paquetes fiscales**. Cubre 3 escenarios:

1. Plan **iguala** — renta mensual + cap de timbres, **rollover** del sobrante.
2. Plan **renta** — sin cap, se factura el consumo real.
3. Plan **FLEX** — **prepago** por bloques de 30 timbres con recompra automática.

## 1. Estado actual (lo que ya existe)

| Objeto | Función |
|---|---|
| `stamp_packages` | Catálogo de planes (PKG_100/200/500/FLEX) con `monthly_stamps`, `monthly_fee_mxn`, `extra_stamp_mxn`. |
| `companies.stamp_package_code` | Paquete asignado a cada empresa. |
| `companies.billing_period_start` | Fecha del ciclo actual (día 1 del mes en curso). |
| `stamp_usage` | Bitácora inmutable — 1 fila por CFDI timbrado con `billing_period`, `was_extra` y `extra_charge_mxn`. |
| `v_stamp_usage_current` | Vista con `used_current_month`, `remaining`, `percent_used`. |

Lo que **falta** para cerrar el modelo de facturación:

- Contador de **timbres acumulados** (rollover) para plan iguala.
- Registro de **facturación mensual** (una fila por mes por empresa) con el desglose renta + extras.
- **Bolsa prepago** para plan FLEX con recompra.
- **Alertas por correo** al agotarse el saldo prepago o cerca del cap.
- **Job** que corre el día 1 de cada mes y genera los cargos.

---

## 2. Reglas de negocio por plan

### 2.1 Plan iguala (con cap + rollover)

Empresa contrata PKG_100 ($399 con 100 timbres/mes).

```
Mes 1:  timbra 70    → factura $399 · rollover 30 al mes 2
Mes 2:  cap efectivo = 100 + 30 = 130. Timbra 90 → factura $399 · rollover 40
Mes 3:  cap efectivo = 100 + 40 = 140. Timbra 150 → factura $399 + 10 × $2.50 = $424
```

**Política**:
- Rollover **infinito** (no expira) mientras el plan esté activo.
- Al cambiar de plan, el saldo acumulado se **cancela** (o se conserva? — decisión de negocio).
- Cancelar un CFDI **no** devuelve el timbre (SAT ya lo cobró al PAC).

### 2.2 Plan renta (sin cap, pago por uso)

Empresa contrata plan renta ($0 fijo, $2.50/timbre por ejemplo).

```
Mes 1:  timbra 70  → factura 70 × $2.50 = $175
Mes 2:  timbra 200 → factura 200 × $2.50 = $500
```

**Política**:
- No hay rollover, no hay cap.
- La renta base es $0 (o mínima, según convenio).
- Se cobra el consumo mensual exacto.

### 2.3 Plan FLEX (prepago, recompra por bloques de 30)

Empresa compra prepago sin renta.

```
Compra bloque #1 de 30 timbres   → saldo prepago = 30
Timbra 25                        → saldo = 5   → correo automático "quedan 5"
Timbra 3                         → saldo = 2   → correo "quedan 2, recarga urgente"
Timbra 2                         → saldo = 0   → BLOQUEA timbrado hasta recarga
Compra bloque #2 de 30           → saldo = 30
```

**Política**:
- El sistema **bloquea** el timbrado cuando el saldo llega a 0 (con mensaje "Sin timbres — contacta al administrador").
- Correo automático cuando saldo < N (configurable, default 5).
- Precio por bloque: 30 × $4.99 + IVA = ~$174 MXN.
- El pago **debe estar registrado** antes de acreditar el bloque (evita fraude).

---

## 3. Modelo de datos (migraciones nuevas)

### 3.1 Rollover del plan iguala

Nueva columna en `companies` (o tabla `company_stamp_balance` si se prefiere separar).
Opción simple: columna directa.

```sql
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS carried_over_stamps INT DEFAULT 0;
```

Fórmula del cap efectivo del mes en curso:
```
cap_efectivo = stamp_packages.monthly_stamps + companies.carried_over_stamps
```

Al cierre de mes: `carried_over_stamps += max(0, monthly_stamps - used_current_month)`.

### 3.2 Facturación mensual

Nueva tabla `monthly_invoicing`:

```sql
CREATE TABLE monthly_invoicing (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    billing_period     DATE NOT NULL,               -- YYYY-MM-01
    package_code       VARCHAR(16) NOT NULL,
    stamps_included    INT NOT NULL,
    stamps_used        INT NOT NULL,
    stamps_extra       INT NOT NULL DEFAULT 0,
    stamps_rolled_over_from_prev INT DEFAULT 0,
    stamps_rolling_to_next       INT DEFAULT 0,
    monthly_fee_mxn    NUMERIC(8,2) NOT NULL,
    extra_charge_mxn   NUMERIC(8,2) NOT NULL DEFAULT 0,
    total_mxn          NUMERIC(8,2) NOT NULL,
    status             VARCHAR(16) NOT NULL DEFAULT 'PENDING',
                                                    -- PENDING | INVOICED | PAID | CANCELLED
    invoice_folio      VARCHAR(32),                 -- folio de la CFDI que emitimos al cliente
    generated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    paid_at            TIMESTAMP,
    UNIQUE (company_id, billing_period)
);
CREATE INDEX ON monthly_invoicing (billing_period);
CREATE INDEX ON monthly_invoicing (company_id, status);
```

Una fila por empresa por mes. Sirve para:
- Reporte histórico de facturación.
- Origen del CFDI que HCGM emite al cliente (self-billing).
- Auditoría de rollover.

### 3.3 Bolsa prepago del plan FLEX

Nueva tabla `prepaid_stamp_balance`:

```sql
CREATE TABLE prepaid_stamp_balance (
    company_id       UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    balance          INT NOT NULL DEFAULT 0,
    low_threshold    INT NOT NULL DEFAULT 5,        -- correo al llegar aquí
    zero_notified_at TIMESTAMP,                     -- para no spamear
    low_notified_at  TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Y bitácora de compras:

```sql
CREATE TABLE prepaid_stamp_purchases (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    stamps_bought     INT NOT NULL,                 -- típico 30
    unit_price_mxn    NUMERIC(6,2) NOT NULL,        -- $4.99 default
    total_mxn         NUMERIC(8,2) NOT NULL,
    payment_method    VARCHAR(20),                  -- transferencia | efectivo | tarjeta
    payment_reference VARCHAR(64),
    granted_by        UUID REFERENCES users(id),
    granted_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## 4. Endpoints nuevos (SUPER_ADMIN)

### Consumo y facturación

```
GET  /admin/billing/current-month          → lista de empresas con estado del mes en curso
GET  /admin/billing/history?year=2026      → matriz por mes por empresa
POST /admin/billing/close-month            → cierra el mes: calcula rollover + genera monthly_invoicing
                                            (idempotente, solo la primera vez del mes)
GET  /admin/billing/company/:id/history    → detalle histórico de una empresa
PATCH /admin/billing/:id/mark-paid         → marca un cargo como PAID
```

### Prepago FLEX

```
GET  /admin/prepaid/balances               → todas las empresas FLEX con saldo actual
POST /admin/prepaid/:companyId/recharge    → suma un bloque al saldo (registra compra)
                                            body: { stamps_bought, unit_price_mxn, payment_reference }
PATCH /admin/prepaid/:companyId/threshold  → ajusta low_threshold
```

### Validación de timbrado

En `stampInvoice` del `pac.service`, ANTES de llamar al PAC:

```
if (company.plan === FLEX) {
  if (prepaid_balance < 1) throw ValidationError('Sin timbres prepago');
}
// después de timbrar exitoso:
if (company.plan === FLEX) {
  UPDATE prepaid_stamp_balance SET balance = balance - 1
  if (balance <= low_threshold && !low_notified_at) → mail alerta
  if (balance == 0) → mail bloqueo + notified_at
}
```

---

## 5. UI SUPER_ADMIN

### Nuevo menú (después de "Paquetes fiscales")

```
🧾 Paquetes fiscales           (ya existe)
💰 Facturación y consumo       ← NUEVO
🛒 Compras prepago             ← NUEVO (subitem o vista aparte)
```

### 5.1 Facturación y consumo — vista principal

Tabla con filtro por mes:

| RFC | Empresa | Plan | Cap+Roll | Usados | Extras | Renta | Extra $ | Total | Estado |
|---|---|---|---|---|---|---|---|---|---|
| EKU… | Escuela Kemper | PKG_200 | 200+40=240 | 180 | 0 | $699 | $0 | $699 | PENDING |
| GHC… | Grupo HCGM | PKG_100 | 100+15=115 | 130 | 15 | $399 | $37.50 | $436.50 | INVOICED |
| SAJ… | Servicios Jomar | FLEX | prepago 27 | 3 | — | — | — | — | (prepago) |

Botones:
- **Cerrar mes** (naranja, big) — corre el job manualmente (o esperar al día 1).
- **Ver histórico** por empresa — modal con tabla mes por mes.
- **Marcar pagado** por fila — cambia estado a PAID.
- **Descargar CFDI** que HCGM emitió al cliente (link al invoice_folio).

### 5.2 Compras prepago

Tabla:

| RFC | Empresa | Saldo | Umbral aviso | Última recarga | Compras totales | Acciones |
|---|---|---|---|---|---|---|
| SAJ… | Servicios Jomar | **3** ⚠ | 5 | 2026-06-15 (30) | 90 | [+ Recargar] |

Botón **Recargar** abre modal:
```
Timbres a agregar: [ 30  ]
Precio unitario:   [ $4.99 ]
Total:             $149.70 + IVA
Referencia pago:   [                   ]  (folio SPEI, etc.)
Método:            [ ▼ Transferencia   ]

[ Cancelar ]  [ Registrar recarga ]
```

Historial: link "Ver compras" abre lista de `prepaid_stamp_purchases`.

---

## 6. Jobs automáticos

### Job 1 — Cierre mensual (`monthly-close.job.ts`)

Corre el **día 1 de cada mes a las 03:00** (cron o Render Cron Jobs).

Para cada empresa NO FLEX:
1. Cuenta timbres usados en el mes anterior.
2. Calcula `stamps_extra = max(0, used - (cap + roll_previo))`.
3. Calcula `roll_nuevo = max(0, (cap + roll_previo) - used)`.
4. Inserta `monthly_invoicing` con desglose.
5. Actualiza `companies.carried_over_stamps = roll_nuevo`.
6. Envía correo al cliente con el CFDI de cobro (opcional en fase 2).

Es **idempotente**: usa `ON CONFLICT (company_id, billing_period) DO NOTHING`.

### Job 2 — Alerta prepago (`prepaid-alert.job.ts`)

Corre cada **hora**. Para cada empresa FLEX:
- Si `balance == 0` y `zero_notified_at IS NULL` → correo urgente + set flag.
- Si `balance <= low_threshold` y `low_notified_at IS NULL` → correo aviso + set flag.
- Al recargar (balance > threshold+5) → limpiar los flags para volver a poder notificar.

### Job 3 — Recordatorio de mensualidad (opcional)

Cada día 10 del mes, correos automáticos a empresas con `monthly_invoicing.status='INVOICED'` y sin `paid_at`.

---

## 7. Correos automáticos (templates)

Usan el módulo `mailer.service` existente. Tres tipos:

### `prepaid_low`
```
Asunto: Timbres prepago casi agotados — {rfc}
Cuerpo: Actualmente te quedan {balance} timbres del bloque de {last_purchase}.
        Para no interrumpir tu operación, comunícate con nosotros para recargar.
        Facturación: facturas@hcgm.com.mx · WhatsApp: [número]
```

### `prepaid_zero`
```
Asunto: URGENTE — Timbrado detenido, sin saldo prepago
Cuerpo: El timbrado ha sido bloqueado. Recarga para continuar operando.
```

### `monthly_bill`
```
Asunto: Cargo del mes {YYYY-MM} — {business_name}
Cuerpo: Renta plan {PKG_XXX}: ${monthly_fee}
        Extras ({stamps_extra} × ${extra_stamp_mxn}): ${extra_charge_mxn}
        ─────────────────────────
        TOTAL: ${total_mxn}
        (Adjunto: CFDI emitida por HCGM)
```

---

## 8. Fases de implementación

**Fase 1 — Datos y contadores** (foundational, 1 día)
- 2 migraciones: rollover en `companies` + tabla `prepaid_stamp_balance`.
- Ampliar `v_stamp_usage_current` para incluir `carried_over_stamps` y `cap_efectivo`.
- Backend: helper `getCompanyEffectiveCap(companyId)` reutilizable.

**Fase 2 — UI SUPER_ADMIN de consumo** (½ día)
- Página "Facturación y consumo" (read-only + botón cerrar mes).
- Modal "Ver histórico".

**Fase 3 — Prepago FLEX** (1 día)
- Migración `prepaid_stamp_balance` + `prepaid_stamp_purchases`.
- Endpoint recarga.
- Validación en `stampInvoice` (bloqueo si saldo = 0).
- Página "Compras prepago" con modal de recarga.

**Fase 4 — Job cierre mensual** (½ día)
- Script `monthly-close.job.ts` + Cron en Render.
- Endpoint `POST /admin/billing/close-month` para dispararlo manualmente.
- Tabla `monthly_invoicing` con historia.

**Fase 5 — Correos** (½ día)
- Job `prepaid-alert.job.ts` que corre cada hora.
- Templates HTML + integración con `sendInvoiceMail`.

**Total estimado**: ~3.5 días de trabajo. Se puede hacer por fases sin
bloquear producción — cada fase entrega valor por sí sola.

---

## 9. Decisiones de negocio confirmadas

### ✅ 9.1 Ciclo de cierre

- **Corte del consumo**: último día natural del mes (30 o 31 según el mes; febrero: 28/29).
- **Emisión de CFDI de cobro**: día **1 del mes siguiente**, con la información ya consolidada.
- El job `monthly-close.job.ts` corre a las **00:15 del día 1** para calcular todo antes de que los usuarios abran el ERP en la mañana.

### ✅ 9.2 Cambio de plan a mitad de mes — prorrateo por días

Cuando una empresa cambia de plan durante el mes, el ciclo se parte en dos y cada tramo se factura proporcional a los días vividos en cada plan.

**Ejemplo — cambio del 15 de junio (mes de 30 días):**

```
Del 1 al 14 en PKG_100 ($399, 100 timbres):
  Días vividos:  14 / 30
  Renta prorrateada:  $399 × 14/30 = $186.20
  Cap prorrateado:    100 × 14/30 = 46.67 timbres (redondeo hacia arriba = 47)

Del 15 al 30 en PKG_200 ($699, 200 timbres):
  Días vividos:  16 / 30
  Renta prorrateada:  $699 × 16/30 = $372.80
  Cap prorrateado:    200 × 16/30 = 106.67 timbres (redondeo hacia arriba = 107)

Total mes de junio:
  Renta total:  $186.20 + $372.80 = $559.00
  Cap efectivo: 47 + 107 = 154 timbres (más rollover previo si lo había)
```

**Extras**: si el consumo excede el cap efectivo del tramo respectivo, cada
timbre extra se cobra al `extra_stamp_mxn` del **plan vigente al momento del
timbrado** (se lee de `stamp_usage.package_code_at_stamp` que ya guardamos).

**Regla de redondeo**: al calcular el cap prorrateado, siempre redondeamos
**hacia arriba** (favorece al cliente). La renta no se redondea (usa 2 decimales).

**Rollover previo del plan viejo**: se **conserva íntegro** al cambiar de plan
— no se prorratea. El sobrante acumulado sigue disponible para el nuevo cap.
(Alternativa que descartamos: convertir a crédito monetario — muy complejo
contablemente.)

### ✅ 9.3 Job de cierre y emisión

- Nombre: `monthly-close.job.ts`
- Cron: `15 0 1 * *` (00:15 del día 1 de cada mes)
- Idempotente: si ya existe `monthly_invoicing` para `(company_id, billing_period=YYYY-MM-01 anterior)`, no hace nada.
- Detecta automáticamente si hubo cambio de plan mid-month leyendo el historial de `stamp_usage.package_code_at_stamp` — si hay más de un código en el mes, aplica prorrateo por días.

---

## 10. Decisiones pendientes → CERRADAS

### ✅ 10.1 CFDI de cobro — HCGM lo emite desde el mismo ERP (dogfooding)

Aprovechamos toda la infraestructura del ERP para el negocio de HCGM: al cerrar
el mes, el sistema emite y timbra las facturas contra cada cliente
automáticamente.

**Requisitos previos**:
- HCGM debe estar registrada como empresa en el ERP (con su propio RFC).
- HCGM debe tener su CSD subido al vault de SW.
- Cada empresa cliente debe existir como `customer` en la lista de clientes de HCGM (se crea automáticamente la primera vez).

**Flujo automático del job `monthly-close`**:
```
Para cada empresa cliente C:
  1. Calcula monthly_invoicing (renta + extras + prorrateo si aplica)
  2. Si total > 0:
       a. Asegura que exista customer en HCGM con el RFC de C
          (upsert con datos fiscales — CIF SAT si es la primera vez)
       b. Crea invoice tipo I en HCGM contra ese customer con:
             concepto: "Servicio de facturación electrónica — <YYYY-MM>"
             ClaveProdServ: 81112000 (Servicios de facturación)
             Cantidad: total_mxn como valor unitario (no timbres)
             IVA 16% trasladado
       c. Timbra con SW (misma ruta /v3/cfdi33/issue/json/v4)
       d. Guarda UUID en monthly_invoicing.invoice_folio + invoice_id
       e. Envía correo automático al contact_email del cliente con PDF + XML
```

**Fallback**: si el timbrado falla (PAC caído, sin timbres, cliente sin
correo), se registra en `monthly_invoicing.status = 'PENDING'` con el mensaje
de error y el super-admin puede reintentar desde la UI (botón "Timbrar CFDI de
cobro" por fila).

**Ventajas**:
- Consistencia total entre el negocio y el producto (dogfooding).
- El cliente recibe un CFDI válido que puede deducir.
- HCGM tiene reporte de ingresos automático (sus propios reportes de cobranza).

### ✅ 10.2 Precio prepago FLEX — $4.99 fijo

Precio uniforme para simplificar. Si en el futuro se quieren precios
especiales por cliente, se puede agregar una columna
`companies.override_flex_price NUMERIC(6,2)` que sobreescriba al default.
Por ahora hardcoded `4.99` en `stamp_packages` (ya está así).

### ✅ 10.3 Umbral de aviso — 5 timbres fijo

Constante en el código: `PREPAID_LOW_THRESHOLD = 5`.
Cuando `prepaid_stamp_balance.balance <= 5` y aún no se ha notificado en este
ciclo, se dispara el correo `prepaid_low`.

Se limpia el flag de "notificado" cuando el saldo vuelva a subir por encima
de `threshold + 5` (evita spam si el cliente sigue timbrando alrededor de 5).

### ✅ 10.4 Comportamiento al saldo 0 — Bloqueo total

Simple, sin ambigüedades. En `pac.service.stampInvoice`, antes de invocar al
PAC:

```typescript
if (company.stamp_package_code === 'PKG_FLEX') {
  const bal = await getPrepaidBalance(company.id);
  if (bal < 1) {
    throw new ValidationError(
      'Sin saldo prepago. Contacta al administrador para recargar tu plan.'
    );
  }
}
```

Correo `prepaid_zero` se envía una sola vez cuando el saldo llega a 0.
Se limpia el flag al recargar.

---

## 11. Todas las decisiones — resumen ejecutivo

| # | Decisión | Valor |
|---|---|---|
| 1 | Corte de consumo | Día 30/31 (último del mes) |
| 2 | Emisión CFDI | Día 1 del mes siguiente (job 00:15) |
| 3 | Cambio de plan mid-month | Prorrateo por días, cap redondeado ↑ |
| 4 | Rollover al cambiar de plan | Se conserva íntegro |
| 5 | Extras al cambiar de plan | Al precio del plan vigente al timbrar |
| 6 | CFDI a cliente | HCGM emite y timbra desde el ERP (dogfooding) |
| 7 | Precio prepago | $4.99 fijo para todos |
| 8 | Umbral aviso prepago | 5 timbres fijo |
| 9 | Comportamiento saldo 0 | Bloqueo total con mensaje |
| 10 | Cancelar CFDI devuelve timbre | No (SAT ya lo cobró) |

---

## 12. Plan de trabajo — ready para arrancar

Con estas 10 decisiones, la implementación queda bien definida. Sugerencia
de orden:

**Antes de arrancar** (10 min):
- Registrar HCGM como empresa en el ERP con su RFC real.
- Subir CSD de HCGM al vault SW.
- Verificar que HCGM tenga `contact_email` cargado para el reply-to.

**Fase 1** (foundational, ~1 día):
- Migración `2026-07-09_billing_module.sql` con:
  - Columna `carried_over_stamps` en `companies`
  - Tabla `monthly_invoicing`
  - Tabla `prepaid_stamp_balance`
  - Tabla `prepaid_stamp_purchases`
  - Vista `v_stamp_usage_current` ampliada con cap efectivo
- Helper `getCompanyEffectiveCap(companyId)` y `getPrepaidBalance(companyId)`.
- Validación pre-timbrado en `pac.service.stampInvoice` (bloqueo FLEX).

**Fase 2** (~½ día): UI SUPER_ADMIN read-only (ver estado del mes).

**Fase 3** (~1 día): Prepago — modal de recarga + validación + UI compras.

**Fase 4** (~1 día): Job `monthly-close.job.ts` con:
- Cálculo de prorrateo por días (helper reutilizable).
- Emisión automática del CFDI HCGM → cliente.
- Envío automático por correo con PDF + XML.
- Endpoint `POST /admin/billing/close-month` para dispararlo manual.

**Fase 5** (~½ día): Jobs de correos automáticos (prepago low/zero,
recordatorio pago).

**Total ~4 días de trabajo**. Se puede hacer por fases sin bloquear
producción — cada fase entrega valor.

Cuando quieras arrancar, dime "adelante Fase 1" y comenzamos.


---

# ═══ Deploy — Render ═══

_(origen: `DEPLOY_RENDER.md`)_

# Deploy a Render.com — GDM_FAC (ERP CFDI 4.0)

Guía paso a paso para llevar el proyecto al ambiente estable de Render.
El proyecto ya trae `render.yaml` listo — Render crea todo con 1 clic.

## Arquitectura de deploy

```
┌────────────────────────────────────────────┐
│ Render Blueprint "gdmfac"                   │
│                                            │
│  ┌────────────────────┐                    │
│  │ gdmfac-frontend    │  ← Static Site     │
│  │ React + Vite       │    Free plan       │
│  │ (dist/)            │                    │
│  └─────────┬──────────┘                    │
│            │ HTTPS + CORS                  │
│  ┌─────────▼──────────┐                    │
│  │ gdmfac-backend     │  ← Web Service     │
│  │ Node + Express     │    Free plan       │
│  │ (dist/index.js)    │    healthCheck     │
│  └─────────┬──────────┘                    │
│            │ TLS                           │
│  ┌─────────▼──────────┐                    │
│  │ gdmfac-postgres    │  ← Managed PG 15   │
│  │ 1 GB (Free)        │                    │
│  └────────────────────┘                    │
└────────────────────────────────────────────┘
```

## Paso 1 — Subir el código a GitHub (5 min)

Desde la carpeta del proyecto en local:

```bash
cd C:\Users\EQ-7\GDM_FAC

# Inicializa git si aún no lo está
git init
git add .
git commit -m "chore: preparar deploy a Render — render.yaml + migrations"

# Crea el repo en GitHub (privado): https://github.com/new
# Copia la URL del repo nuevo y:
git branch -M main
git remote add origin https://github.com/<TU_USUARIO>/gdmfac.git
git push -u origin main
```

**Importante**: verifica que `.env`, `backend/uploads/`, y `scratch/` NO estén
en el commit (el `.gitignore` los excluye — puedes correr `git status`
antes de commit para confirmar).

## Paso 2 — Conectar Render (2 min)

1. Entra a https://dashboard.render.com/
2. **New → Blueprint**
3. Selecciona tu repo `gdmfac`
4. Render detecta `render.yaml` y muestra los 3 servicios:
   - `gdmfac-postgres` (base de datos)
   - `gdmfac-backend` (API)
   - `gdmfac-frontend` (UI)
5. **Apply**. Render crea los 3 recursos y arranca el primer deploy.

## Paso 3 — Configurar secretos que NO van en git (3 min)

En el dashboard, entra a **gdmfac-backend → Environment** y pega:

| Variable | Valor |
|----------|-------|
| `SW_SAPIEN_TOKEN` | *(el mismo token que tienes en `.env` local)* |

Todo lo demás Render lo genera automáticamente
(`JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `CSD_MASTER_KEY`,
`DATABASE_URL`).

## Paso 4 — Ejecutar migraciones y seed inicial (1 min)

Al arrancar el backend, `start:prod` ejecuta:

```
npm run migrate:up && node dist/index.js
```

Esto aplica `schema.sql` + todos los `.sql` de `src/database/migrations/`
usando `schema_migrations` como control (idempotente — puede correr N veces).

**Para crear los 3 usuarios de capacitación** (superadmin + admin + user demo):

En el dashboard de `gdmfac-postgres`, pestaña **Connect → PSQL Command**,
copia el comando y pega en tu terminal local:

```bash
psql <URL_QUE_DA_RENDER> \
  -f backend/src/database/seeds/reset_to_training.sql
```

O usa la consola web de Render (**Shell**) desde el servicio backend:

```bash
node -e "require('./scripts/migrate-up.js')"     # ya lo hizo el start
psql $DATABASE_URL -f src/database/seeds/reset_to_training.sql
```

## Paso 5 — Verificar (1 min)

Render te da 3 URLs:

- `https://gdmfac-frontend.onrender.com` — abre y prueba login
- `https://gdmfac-backend.onrender.com/health` — debe responder `{"status":"OK"}`
- `https://gdmfac-backend.onrender.com/api/v1/pac/account-status`
  (con `Authorization: Bearer <token>`) — debe listar tus 501 timbres SW

## Costos mensuales (plan Free)

| Recurso | Free | Cuando escalar |
|---------|------|----------------|
| Frontend (Static) | Gratis, ilimitado | Siempre free |
| Backend (Web) | 750 h/mes, 512 MB RAM, se duerme tras 15 min | $7/mes (Starter) al pasar a prod |
| PostgreSQL | 1 GB, 90 días retención, se elimina si no hay actividad | $7/mes (Basic) para prod |

**Total dev/staging: $0/mes**. Total producción: **$14 USD/mes ≈ $280 MXN/mes**.

## Ciclo de trabajo desde acá

1. Editas código en local
2. `git commit && git push` a `main`
3. Render detecta el push y deployea automáticamente (3-5 min)
4. Los logs se ven en tiempo real desde el dashboard

## Rollback

Cada deploy en Render se puede revertir con 1 clic desde **Deploys → Rollback**.
Sin downtime.

## Datos sensibles

- `.env` local **NO** se sube (está en `.gitignore`)
- Los secretos en Render viven cifrados y sólo se muestran ofuscados
- El backup automático de Postgres corre diario en plan Basic; en Free
  puedes hacer `pg_dump` manual desde la consola


---

# ═══ Deploy — hosting (ZIP) ═══

_(origen: `docs/DEPLOY_HOSTING_ZIP.md`)_

# Colgar el ERP en hcgm.com.mx vía ZIP (cPanel) + activar PAC producción

Dos procedimientos:
- **Parte A**: servir el frontend del ERP desde `https://hcgm.com.mx/erp`
  subiendo un ZIP al hosting (sin tocar DNS ni Render frontend).
- **Parte B**: conectar el PAC en modo PRODUCCIÓN para usar los timbres
  reales contratados con SW Sapien.

---

## Parte A — Frontend en hcgm.com.mx/erp

### Arquitectura

```
Navegador ──► hcgm.com.mx/erp        (Hosting México: archivos estáticos del ZIP)
                   │ fetch /api/v1/…
                   ▼
              gdmfac-backend.onrender.com   (backend + BD siguen en Render)
```

El hosting solo sirve los archivos del frontend. El backend, la BD y el PAC
siguen en Render — nada de eso se mueve.

### Paso 1 — Generar el ZIP

En tu PowerShell:

```powershell
cd C:\Users\EQ-7\GDM_FAC\frontend
npm run build:hosting
```

Salida: `frontend/dist-hosting/gdmfac-erp-hosting.zip` (~1 MB).

El ZIP contiene la carpeta `erp/` con:
- `index.html` compilado con `base=/erp/` y `VITE_API_BASE` apuntando al backend Render.
- `.htaccess` con el fallback SPA (cualquier ruta → index.html) y cache de assets.
- `assets/` con JS/CSS versionados.

> Para otro path o backend:
> `HOSTING_BASE_PATH=/facturacion/ HOSTING_API_BASE=https://api.hcgm.com.mx npm run build:hosting`

### Paso 2 — Subir a cPanel

1. Entra a cPanel de Hosting México → **Administrador de archivos** (File Manager).
2. Navega a **`public_html/`** (la raíz del sitio).
3. Botón **Cargar** (Upload) → sube `gdmfac-erp-hosting.zip`.
4. De regreso en File Manager, click derecho sobre el ZIP → **Extract**.
   - Debe quedar `public_html/erp/index.html`, `public_html/erp/.htaccess`, etc.
5. Borra el ZIP (limpieza).

> ⚠ Si File Manager no muestra `.htaccess`, activa **Settings → Show Hidden
> Files (dotfiles)** en la esquina superior derecha.

### Paso 3 — CORS en Render

El backend debe aceptar peticiones del nuevo origen:

1. Render → `gdmfac-backend` → **Environment**.
2. Edita `CORS_ORIGIN` para que incluya ambos (separados por coma, sin espacios):
   ```
   https://hcgm.com.mx,https://gdmfac-frontend.onrender.com
   ```
3. Save Changes (reinicia solo, ~1 min).

> Si el sitio corre en `https://www.hcgm.com.mx` (con www), agrega TAMBIÉN ese
> origen: el CORS compara el string exacto.

### Paso 4 — Verificar

1. Abre **https://hcgm.com.mx/erp** en incógnito.
2. Debe cargar la landing pública del ERP.
3. Login → dashboard → abre DevTools → Network: las llamadas van a
   `gdmfac-backend.onrender.com/api/v1/…` y responden 200.
4. Navega a una ruta profunda (ej. `/erp/invoices`) y refresca (F5) — debe
   recargar la app, no un 404 del hosting (eso valida el `.htaccess`).

### Paso 5 — Menú en el sitio corporativo

En el sitio de hcgm.com.mx (WordPress u otro CMS), agrega el elemento de menú:

- **Texto**: `Facturación` (o `ERP`)
- **URL**: `https://hcgm.com.mx/erp/`
- **Abrir en**: misma pestaña o nueva, a gusto

### Actualizaciones futuras

Cada vez que el frontend cambie:

```powershell
cd C:\Users\EQ-7\GDM_FAC\frontend
npm run build:hosting
# → subir el nuevo ZIP a cPanel y extraer encima (sobrescribe)
```

> El deploy de Render sigue siendo automático con cada push; el del hosting
> es manual con el ZIP. Ambos frontends pueden convivir mientras migras.

---

## Parte B — PAC en PRODUCCIÓN (timbres reales)

El código ya soporta producción sin cambios (el guardrail de RFC de prueba
solo aplica en sandbox). Es pura configuración:

### Requisitos previos

- [ ] Contrato/paquete de timbres de **producción** activo con SW Sapien.
- [ ] Acceso al panel de **producción**: https://portal.sw.com.mx (el sandbox
      es un portal distinto).
- [ ] CSD **real** (.cer + .key + contraseña) de cada empresa emisora, vigente.

### Paso 1 — Token de producción

1. Portal SW **producción** → Configuración → Tokens → crear token
   (`GDMFAC-Prod`).
2. Copia el JWT completo (3 bloques separados por 2 puntos, sin espacios).

### Paso 2 — CSDs reales al vault de producción

Por **cada empresa emisora real** (las 2 que vas a dar de alta):

1. Portal SW producción → **Emisores / Certificados** → cargar `.cer` + `.key`
   + contraseña del CSD.
2. Verifica que el RFC aparezca como "activo" en su vault.

> Sin este paso el timbrado rebota: SW no puede sellar sin el CSD del emisor.

### Paso 3 — Variables en Render

Render → `gdmfac-backend` → Environment:

| Variable | Valor nuevo |
|---|---|
| `SW_SAPIEN_ENV` | `production` |
| `SW_SAPIEN_TOKEN` | el JWT de producción del Paso 1 |

Save Changes → espera el reinicio.

### Paso 4 — Alta de las empresas reales en el ERP

1. SUPER_ADMIN → Empresas → **Nueva empresa** → botón "Leer CIF" con la
   Constancia de Situación Fiscal real.
2. Sube el CSD también en el ERP (respaldo cifrado local + validación de
   vigencia).
3. Asigna plan y usuarios.

### Paso 5 — Prueba controlada (¡esto ya es dinero real!)

⚠ En producción **cada timbre consume saldo y el CFDI llega al SAT de
verdad**. Para la primera prueba:

1. Emite una factura **de monto pequeño** a un RFC propio o de un tercero
   que haya aceptado la prueba (ej. $1.00 + IVA).
2. Verifica: UUID real + QR válido en
   https://verificacfdi.facturaelectronica.sat.gob.mx (ahora SÍ debe aparecer,
   a diferencia del sandbox).
3. Cancela esa factura de prueba (motivo 02) — en producción el vault es
   estable y la cancelación procede sin el bug 404 del sandbox.
4. Confirma en el portal SW producción que el timbre se consumió y la
   cancelación se registró.

### Paso 6 — Facturación de la plataforma (opcional pero recomendado)

Si vas a usar el módulo de Facturación y Consumo con clientes reales:

| Variable | Valor |
|---|---|
| `PLATFORM_COMPANY_RFC` | RFC real de GRUPOHCGM |
| `ENABLE_BILLING_CRON` | `true` |

Con esto el día 1 de cada mes el sistema cierra el mes, emite los CFDIs de
cobro con timbres reales y los envía por correo.

### Rollback a sandbox

Si algo sale mal, en Render basta con volver a:
```
SW_SAPIEN_ENV=sandbox
SW_SAPIEN_TOKEN=<token sandbox>
```
El guardrail de EKU9003173C9 se reactiva solo.

---

## Checklist combinado

**Parte A (hosting)**
- [ ] `npm run build:hosting` genera el ZIP
- [ ] ZIP subido y extraído en `public_html/erp/`
- [ ] `.htaccess` visible en la carpeta
- [ ] `CORS_ORIGIN` incluye `https://hcgm.com.mx` (y `www.` si aplica)
- [ ] `https://hcgm.com.mx/erp` carga y el login funciona
- [ ] F5 en ruta profunda no da 404
- [ ] Menú "Facturación" agregado al sitio corporativo

**Parte B (PAC producción)**
- [ ] Token de producción generado
- [ ] CSDs reales cargados al vault SW producción
- [ ] `SW_SAPIEN_ENV=production` + token en Render
- [ ] Empresas reales dadas de alta con CIF + CSD
- [ ] Factura de prueba $1 timbrada y verificada en el portal SAT
- [ ] Cancelación de la prueba procesada
- [ ] (Opcional) `PLATFORM_COMPANY_RFC` + `ENABLE_BILLING_CRON=true`


---

# ═══ Deploy — dominio HCGM ═══

_(origen: `docs/DEPLOY_HCGM_DOMAIN.md`)_

# Colgar el ERP de un subdominio de hcgm.com.mx

Guía paso a paso para migrar el ERP de las URLs `.onrender.com` a un
subdominio propio bajo `hcgm.com.mx`. No requiere mover el hosting ni
cambiar el DNS principal del dominio corporativo.

## Resumen visual

```
┌──────────────────────────────────────────┐
│  hcgm.com.mx  (Hosting México, cPanel)   │
│    ├── www.hcgm.com.mx     → sitio corp  │
│    ├── erp.hcgm.com.mx     → Render      │  ← nuevo
│    ├── api.hcgm.com.mx     → Render      │  ← nuevo
│    └── facturas@hcgm.com.mx (SMTP)       │
└──────────────────────────────────────────┘
                    │
                    │  CNAME
                    ▼
┌──────────────────────────────────────────┐
│  Render.com                              │
│    ├── gdmfac-frontend.onrender.com      │
│    └── gdmfac-backend.onrender.com       │
└──────────────────────────────────────────┘
```

## Decisión: qué subdominios usar

Recomiendo **dos subdominios** (más limpio para SEO, CORS y auditoría):

| Subdominio | Apunta a | Uso |
|---|---|---|
| `erp.hcgm.com.mx` | Frontend Render (static) | UI del ERP — lo que ven los usuarios |
| `api.hcgm.com.mx` | Backend Render (Node) | Endpoints REST — lo que consume el frontend |

Alternativa más simple con **un solo subdominio** (`erp.hcgm.com.mx`) usando
rewrite del static site para proxear `/api/*` al backend. Es menos limpio y
Render Static no soporta rewrites; requeriría cambiar el frontend a un
servicio Node o incluir Cloudflare/Netlify por delante. **No recomendado**.

Aquí voy con la ruta de **dos subdominios**.

---

## Paso 1 — En Render (agregar los dominios custom)

### Frontend

1. Entra a **dashboard.render.com** → tu servicio `gdmfac-frontend` (Static Site).
2. Pestaña **Settings** → sección **Custom Domains** → **Add Custom Domain**.
3. Escribe `erp.hcgm.com.mx` → **Save**.
4. Render te muestra el registro DNS que debes crear en tu registrador. Copia el valor. Suele ser:
   ```
   Type:   CNAME
   Name:   erp
   Value:  gdmfac-frontend.onrender.com
   TTL:    Automático (300s)
   ```

### Backend

1. Selecciona `gdmfac-backend` (Web Service).
2. **Settings → Custom Domains → Add Custom Domain**.
3. Escribe `api.hcgm.com.mx` → **Save**.
4. Render te muestra el CNAME. Copia el valor:
   ```
   Type:   CNAME
   Name:   api
   Value:  gdmfac-backend.onrender.com
   TTL:    Automático (300s)
   ```

Deja Render abierto — vas a volver a validar cuando el DNS propague.

---

## Paso 2 — En Hosting México (crear los CNAME)

1. Entra a tu panel de cliente en **[clientes.hostingmexico.com](https://clientes.hostingmexico.com/)** → tu dominio `hcgm.com.mx`.
2. Busca **DNS Zone Editor** o **Zona DNS** (varía por template; también accesible desde cPanel → *Advanced Zone Editor*).
3. Agrega **dos registros CNAME**:

**Registro 1**:
```
Name:  erp
Type:  CNAME
TTL:   300
Value: gdmfac-frontend.onrender.com
```

**Registro 2**:
```
Name:  api
Type:  CNAME
TTL:   300
Value: gdmfac-backend.onrender.com
```

> ⚠ Algunos paneles piden el name completo (`erp.hcgm.com.mx`) y otros solo el
> subdominio (`erp`). Usa el formato que muestre tu panel. Si dudas, prueba con
> el subdominio solo — es lo más común.

Guarda cambios.

---

## Paso 3 — Verificar la propagación DNS (5–30 minutos)

En tu PowerShell:

```powershell
nslookup erp.hcgm.com.mx
nslookup api.hcgm.com.mx
```

Debe resolver a la IP de Render (`216.24.xxx.xxx` o similar).

O usa el web tool: **[dnschecker.org](https://dnschecker.org/)** → escribe
`erp.hcgm.com.mx` → tipo **CNAME** → busca. Cuando veas ✅ en la mayoría de
países, sigue al Paso 4.

---

## Paso 4 — SSL automático en Render

Una vez que Render detecta el CNAME resuelto (~5 min después de propagar),
emite automáticamente un certificado SSL vía **Let's Encrypt**.

En cada dominio verás el badge:

- 🟡 `Certificate pending` → esperando
- 🟢 `Certificate active` → listo

No hay que hacer nada manual. Render renueva el cert cada 90 días.

**Prueba desde el navegador**:
- https://erp.hcgm.com.mx → debe mostrar la landing pública.
- https://api.hcgm.com.mx/health → debe responder JSON `{ status: "OK" }`.

Si sale error de certificado, espera 10 minutos más. Si persiste, dispara
"Reissue certificate" desde Render → Settings → Custom Domains.

---

## Paso 5 — Actualizar variables de entorno

### Backend — `gdmfac-backend` en Render

Actualiza `CORS_ORIGIN` para que acepte el nuevo dominio. Puede ser lista
separada por comas si quieres mantener también el `.onrender.com` en paralelo
mientras las pruebas terminan:

```
CORS_ORIGIN=https://erp.hcgm.com.mx,https://gdmfac-frontend.onrender.com
```

Save Changes → Render reinicia el servicio (~1 min).

### Frontend — `gdmfac-frontend` en Render

Actualiza `VITE_API_BASE` para que apunte al nuevo backend custom:

```
VITE_API_BASE=https://api.hcgm.com.mx
```

Save Changes → **Manual Deploy → Deploy latest commit** (los static sites
recompilan con la env nueva; sin esto el frontend seguiría apuntando al
`.onrender.com` viejo).

---

## Paso 6 — Actualizar el mailer (opcional pero recomendado)

Si aún no lo hiciste, deja el remitente SMTP con el dominio propio para que
los correos que salen del ERP también tengan `hcgm.com.mx`:

```
MAIL_FROM=facturas@hcgm.com.mx
```

(Ya cubierto en la guía de configuración SMTP anterior.)

Además, para reducir la probabilidad de que los correos caigan en spam, verifica
que tu dominio tenga:

- **SPF**: en la zona DNS, un registro TXT del tipo:
  ```
  Name: @
  TXT:  v=spf1 include:hostingmexico.com ~all
  ```
- **DKIM**: cPanel → Email Deliverability → habilitar DKIM.
- **DMARC**: TXT en `_dmarc`:
  ```
  Name: _dmarc
  TXT:  v=DMARC1; p=none; rua=mailto:facturas@hcgm.com.mx
  ```

Hosting México suele preconfigurar SPF y DKIM automáticamente. Verifica desde
cPanel → **Email Deliverability**. Si sale verde, todo bien.

---

## Paso 7 — Actualizar la landing (opcional)

En `frontend/index.html`, cambia las meta tags para reflejar el dominio nuevo:

```html
<meta property="og:url" content="https://erp.hcgm.com.mx/" />
<link rel="canonical" href="https://erp.hcgm.com.mx/" />
```

Commit + push → Render redeploya.

---

## Paso 8 — Verificación final

1. Abre en incógnito: **https://erp.hcgm.com.mx** → landing pública OK.
2. Login como super_admin → dashboard carga.
3. Emite una factura → llama a `https://api.hcgm.com.mx/api/v1/...` (revisa Network en DevTools).
4. Envía por correo → llega desde `facturas@hcgm.com.mx`.

Cuando confirmes que todo funciona, **elimina** los dominios viejos:
- Puedes quitar `gdmfac-frontend.onrender.com` de `CORS_ORIGIN` (Render → Backend → Environment).
- Los dominios `.onrender.com` seguirán activos como fallback pero ya nadie los usa.

---

## Rollback

Si algo falla, es reversible en minutos:

1. **Volver a Render**: Backend → Environment → cambiar `CORS_ORIGIN` a `https://gdmfac-frontend.onrender.com`.
2. **Frontend**: cambiar `VITE_API_BASE` a `https://gdmfac-backend.onrender.com` + Manual Deploy.
3. El DNS de Hosting México puede seguir con los CNAME apuntando a Render sin problema (no bloquea nada).

Los DNS records se pueden borrar si prefieres, pero no urgen.

---

## Preguntas frecuentes

**¿Los usuarios ven la URL del backend?**
Solo en el DevTools → Network si abren la consola. No la ven en la barra de direcciones. Aun así, tener `api.hcgm.com.mx` es más profesional que `gdmfac-backend.onrender.com`.

**¿Puedo usar solo `hcgm.com.mx` sin subdominio?**
No sin mover el sitio corporativo. `hcgm.com.mx` ya tiene registros A apuntando al hosting; no puedes tener también un CNAME al mismo tiempo.

**¿Afecta al SEO del sitio corporativo?**
No — `erp.hcgm.com.mx` es un subdominio separado y Google los trata como sitios distintos. El sitio corporativo en `www.hcgm.com.mx` no se altera.

**¿Cuánto cuesta agregar dominios en Render?**
Nada. Render permite dominios custom ilimitados y SSL automático incluidos en todos los planes.

**¿Qué pasa con la landing pública que armamos hoy?**
Sigue viva en el mismo `/`. La URL cambia de `gdmfac-frontend.onrender.com` a `erp.hcgm.com.mx` pero la vista es idéntica.

---

## Checklist final

- [ ] Dominio `erp.hcgm.com.mx` agregado en Render (Frontend)
- [ ] Dominio `api.hcgm.com.mx` agregado en Render (Backend)
- [ ] CNAME `erp` → `gdmfac-frontend.onrender.com` en Hosting México
- [ ] CNAME `api` → `gdmfac-backend.onrender.com` en Hosting México
- [ ] Certificados SSL activos (badge verde en Render)
- [ ] `CORS_ORIGIN` actualizado con `https://erp.hcgm.com.mx`
- [ ] `VITE_API_BASE` actualizado con `https://api.hcgm.com.mx` + redeploy
- [ ] SPF/DKIM/DMARC verificados en cPanel Email Deliverability
- [ ] Prueba end-to-end en incógnito exitosa
- [ ] Landing `og:url` y `canonical` actualizados

Cuando marques los 10 checks, el ERP ya está oficialmente colgado de
`erp.hcgm.com.mx`.
