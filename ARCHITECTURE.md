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

