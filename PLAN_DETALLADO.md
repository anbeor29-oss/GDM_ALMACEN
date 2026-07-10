# 📅 Plan Detallado de Desarrollo - 16 Semanas

**Dedicación:** 10-20 horas/semana | **Total:** ~200 horas de desarrollo
**Objetivo:** MVP funcional con facturación CFDI 4.0 básica + reportes

---

## 📊 Resumen por Fases

| Fase | Duración | Horas | Objetivo |
|------|----------|-------|----------|
| **1: Infraestructura** | Sem 1-2 | 20h | Backend boilerplate, DB, estructura |
| **2: Core Backend** | Sem 3-6 | 60h | Auth, Empresas, Clientes, Productos |
| **3: CFDI** | Sem 7-10 | 60h | Parser, Generador, Validador |
| **4: Frontend** | Sem 11-13 | 45h | Dashboard, Facturación, UI |
| **5: Reportes + PAC** | Sem 14-16 | 30h | Reportes, Integración PAC lista |

---

## FASE 1️⃣: INFRAESTRUCTURA Y CONFIGURACIÓN (Semanas 1-2)

### Semana 1: Setup Inicial

**Objetivo:** Proyecto funcionando localmente con DB, autenticación básica

#### Tareas (10 horas)

- [ ] **Tarea 1.1: Estructura Backend Boilerplate** (2h)
  - Crear carpeta backend con estructura modular
  - Configurar TypeScript + tsconfig.json
  - Setup Express con middleware básico
  - Health check endpoint
  
  **Archivos a crear:**
  ```
  backend/
  ├── src/
  │   ├── index.ts
  │   ├── app.ts
  │   ├── config/
  │   │   ├── database.ts
  │   │   ├── redis.ts
  │   │   └── environment.ts
  │   ├── middleware/
  │   │   ├── errorHandler.ts
  │   │   ├── logger.ts
  │   │   └── authentication.ts
  │   └── utils/
  │       ├── validators.ts
  │       └── formatters.ts
  ├── package.json
  ├── tsconfig.json
  └── .env.example
  ```

- [ ] **Tarea 1.2: Base de Datos** (2h)
  - Ejecutar DATABASE.sql en PostgreSQL
  - Crear app_user con permisos
  - Verificar todas las tablas creadas
  - Hacer backup inicial
  
  **Checklist:**
  - [ ] 13 tablas principales creadas
  - [ ] Índices en lugar
  - [ ] Triggers funcionando
  - [ ] 3 vistas creadas

- [ ] **Tarea 1.3: Conexión DB + Redis** (2h)
  - Configurar cliente PostgreSQL (pg o Prisma)
  - Configurar cliente Redis
  - Connection pooling
  - Tests de conectividad
  
  **Código de prueba:**
  ```typescript
  // backend/src/config/database.ts
  import { Pool } from 'pg';
  
  export const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  
  // Prueba
  pool.query('SELECT NOW()', (err, res) => {
    if (err) console.error('DB ERROR:', err);
    else console.log('✅ DB Connected');
  });
  ```

- [ ] **Tarea 1.4: Autenticación JWT Básica** (2h)
  - Generar JWT al hacer login
  - Middleware para verificar token
  - Refresh tokens en Redis
  - Logout invalidando token
  
  **Endpoints:**
  - `POST /api/v1/auth/login` - login con email/password
  - `POST /api/v1/auth/refresh` - refresh token
  - `POST /api/v1/auth/logout` - invalidar sesión
  - `GET /api/v1/auth/me` - usuario actual

- [ ] **Tarea 1.5: Logging y Monitoreo** (1h)
  - Configurar Winston para logs
  - Middleware de request logging
  - Logs en archivos separados
  - Format JSON para producción

- [ ] **Tarea 1.6: Testing Infrastructure** (1h)
  - Configurar Jest
  - Crear primer test
  - GitHub Actions workflow (opcional)

**Criterio de Aceptación:**
- ✅ Backend corre sin errores en http://localhost:3001
- ✅ Health check retorna status OK
- ✅ Conexión DB confirmada en logs
- ✅ Redis conectado
- ✅ Login retorna JWT válido

---

### Semana 2: Modelos Iniciales + CRUD Base

**Objetivo:** APIs CRUD para Companies y primer usuario admin

#### Tareas (10 horas)

- [ ] **Tarea 2.1: Módulo Companies** (3h)
  - GET, POST, PUT, DELETE /api/v1/companies
  - Validación de RFC
  - Middleware de autorización
  - Tests unitarios
  
  **Endpoints:**
  ```
  POST   /api/v1/companies          (crear)
  GET    /api/v1/companies/:id      (obtener)
  PUT    /api/v1/companies/:id      (actualizar)
  GET    /api/v1/companies          (listar - admin)
  ```

- [ ] **Tarea 2.2: Módulo Usuarios** (3h)
  - CRUD usuarios dentro de empresa
  - Roles y permisos básicos
  - Hash de contraseña
  - Cambio de password
  
  **Endpoints:**
  ```
  POST   /api/v1/users              (crear usuario)
  GET    /api/v1/users              (listar usuarios empresa)
  PUT    /api/v1/users/:id          (actualizar)
  POST   /api/v1/users/change-password
  ```

- [ ] **Tarea 2.3: Seed de Datos Iniciales** (2h)
  - Script para crear usuario admin
  - Script para cargar catalogs SAT básicos
  - Datos de prueba (empresa de demo)
  
  **Script SQL:**
  ```bash
  npm run seed:admin -- --email admin@demo.com --password admin123
  npm run seed:catalogs
  npm run seed:demo-data
  ```

- [ ] **Tarea 2.4: Tests de Integración** (2h)
  - Test login
  - Test crear company
  - Test crear usuario
  - Test autenticación
  
  **Archivo:** `backend/__tests__/integration/auth.test.ts`

**Criterio de Aceptación:**
- ✅ Crear empresa con RFC válido
- ✅ Login retorna token
- ✅ Usuario admin funciona
- ✅ Catálogos SAT cargados (>100 registros)
- ✅ Tests pasan

---

## FASE 2️⃣: CORE BACKEND - CRUD PRINCIPALES (Semanas 3-6)

### Semana 3: Módulo Clientes

**Objetivo:** CRUD completo de clientes con validaciones

#### Tareas (15 horas)

- [ ] **Tarea 3.1: CRUD Customers Completo** (5h)
  - GET, POST, PUT, DELETE /api/v1/customers
  - Búsqueda por RFC, nombre
  - Paginación y filtros
  - Soft delete
  
  **Endpoints:**
  ```
  POST   /api/v1/customers                    (crear)
  GET    /api/v1/customers                    (listar con filtros)
  GET    /api/v1/customers/:id                (obtener)
  PUT    /api/v1/customers/:id                (actualizar)
  DELETE /api/v1/customers/:id                (soft delete)
  GET    /api/v1/customers/:id/invoices       (facturas cliente)
  GET    /api/v1/customers/:id/balance        (estado de cuenta)
  POST   /api/v1/customers/search             (búsqueda avanzada)
  ```

- [ ] **Tarea 3.2: Validaciones SAT** (4h)
  - Validar RFC formato
  - Validar régimen fiscal contra catálogo
  - Validar código postal
  - Validar estado/municipio
  
  **Función:**
  ```typescript
  async function validateCustomerFiscal(data: {
    rfc: string,
    fiscal_regime: string,
    postal_code: string,
    state: string
  }): Promise<{valid: boolean, errors: string[]}>
  ```

- [ ] **Tarea 3.3: Balance Automático** (3h)
  - Calcular balance cliente automáticamente
  - Trigger de base de datos
  - Caché en Redis
  - Endpoint /balance recalcula
  
  **Cálculo:**
  ```
  balance = SUM(facturas) - SUM(pagos)
  vencidas = facturas donde date_due < HOY
  próximo_vencimiento = MIN(date_due > HOY)
  ```

- [ ] **Tarea 3.4: Historial y Auditoría** (3h)
  - Guardar cambios en audit_logs
  - Historial de pagos
  - Timeline de eventos
  - Endpoint para ver historial

**Criterio de Aceptación:**
- ✅ Crear cliente con RFC válido
- ✅ Búsqueda por RFC/nombre funciona
- ✅ Balance calcula correctamente
- ✅ Auditoría completa
- ✅ 10 clientes de prueba creados

---

### Semana 4: Módulo Productos

**Objetivo:** CRUD productos con integración catálogos SAT

#### Tareas (15 horas)

- [ ] **Tarea 4.1: CRUD Productos** (4h)
  - GET, POST, PUT, DELETE /api/v1/products
  - Búsqueda por SKU, nombre, clave SAT
  - Stock management básico
  - Activos/inactivos
  
  **Endpoints:**
  ```
  POST   /api/v1/products                  (crear)
  GET    /api/v1/products                  (listar)
  GET    /api/v1/products/:id              (obtener)
  PUT    /api/v1/products/:id              (actualizar)
  DELETE /api/v1/products/:id              (eliminar)
  GET    /api/v1/products/search?q=algo    (búsqueda)
  ```

- [ ] **Tarea 4.2: Validación Catálogos SAT** (5h)
  - Validar clave_sat existe
  - Validar unit_code existe
  - Validar tax_rate válida
  - Validar combinaciones válidas
  
  **Validación:**
  ```typescript
  async function validateProductSAT(sku: string): Promise<{
    valid: boolean,
    clave_sat: string,
    unit_code: string,
    tax_rate: number,
    warnings: string[]
  }>
  ```

- [ ] **Tarea 4.3: Stock Management** (3h)
  - Cantidad en stock
  - Stock mínimo/máximo
  - Alertas si stock bajo
  - Historial de movimientos (básico)

- [ ] **Tarea 4.4: Impuestos Automáticos** (3h)
  - Asociar tasa de impuesto
  - Calcular impuesto automáticamente
  - Soportar múltiples impuestos
  - IVA, IEPS, exento
  
  **Cálculo:**
  ```
  tax_amount = base_price * tax_rate
  total = base_price + tax_amount
  ```

**Criterio de Aceptación:**
- ✅ Crear producto con clave SAT válida
- ✅ Búsqueda funciona
- ✅ Stock calcula correctamente
- ✅ Impuestos automáticos
- ✅ 20+ productos de prueba

---

### Semana 5: Módulo Facturas - Parte 1 (CRUD)

**Objetivo:** API facturas CRUD, generación de folio automático

#### Tareas (15 horas)

- [ ] **Tarea 5.1: Estructura de Facturas** (3h)
  - Modelo invoice + invoice_items
  - Calcular subtotal, impuestos, total automáticamente
  - Sequencial de folio automático
  - Status workflow
  
  **Status:** DRAFT → READY → STAMPED → SENT → PAID

- [ ] **Tarea 5.2: CRUD Facturas** (4h)
  - POST crear factura (con items)
  - GET listar facturas
  - GET obtener factura
  - PUT actualizar factura (solo en DRAFT)
  - DELETE eliminar (soft)
  
  **Endpoints:**
  ```
  POST   /api/v1/invoices                  (crear)
  GET    /api/v1/invoices                  (listar filtrado)
  GET    /api/v1/invoices/:id              (obtener)
  PUT    /api/v1/invoices/:id              (actualizar)
  DELETE /api/v1/invoices/:id              (soft delete)
  ```

- [ ] **Tarea 5.3: Validaciones Fiscales** (4h)
  - Validar datos cliente fiscal
  - Validar régimen combinación
  - Validar tipo de comprobante
  - Validar método/forma pago
  
  **Validaciones:**
  ```typescript
  async function validateInvoiceFiscal(invoice: Invoice): Promise<{
    valid: boolean,
    errors: string[],
    warnings: string[]
  }>
  ```

- [ ] **Tarea 5.4: Cálculos Automáticos** (4h)
  - Cálculo subtotal = suma items
  - Cálculo impuestos = suma items impuestos
  - Aplicar descuentos
  - Total final
  - Validar cuadre
  
  **Cálculo:**
  ```
  subtotal = SUM(item.quantity * item.unit_price)
  taxes = SUM(item.tax_amount)
  total = subtotal + taxes - discounts
  ```

**Criterio de Aceptación:**
- ✅ Crear factura con 3+ items
- ✅ Folio secuencial automático
- ✅ Subtotal/total calcula correcto
- ✅ Validaciones impiden datos inválidos
- ✅ Status workflow funciona

---

### Semana 6: Módulo Facturas - Parte 2 (XML + PDF)

**Objetivo:** Generación XML CFDI y PDF preview

#### Tareas (15 horas)

- [ ] **Tarea 6.1: Almacenamiento S3** (3h)
  - Configurar AWS S3 (o Azure Blob)
  - Subir XMLs a cloud
  - Subir PDFs a cloud
  - URLs públicas con expiración
  
  **Configuración:**
  ```typescript
  import AWS from 'aws-sdk';
  
  const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
  });
  ```

- [ ] **Tarea 6.2: Generador XML CFDI Básico** (6h)
  - Crear estructura XML válida CFDI 4.0
  - Incluir todas las claves SAT
  - Validar contra esquema local
  - Guardar en S3
  - **NO firmar digitalmente aún** (para fase 3)
  
  **Estructura XML:**
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <cfdi:Comprobante
    xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
    Version="4.0"
    Serie="F"
    Folio="1"
    Fecha="2026-06-07T10:30:00"
    FormaPago="01"
    MetodoPago="PUE"
    Total="1160.00"
    SubTotal="1000.00"
    Moneda="MXN"
    ...>
    
    <cfdi:Emisor/>
    <cfdi:Receptor/>
    <cfdi:Conceptos>
      <cfdi:Concepto/>
    </cfdi:Conceptos>
    <cfdi:Impuestos/>
  </cfdi:Comprobante>
  ```

- [ ] **Tarea 6.3: Validación XML contra Catálogos** (3h)
  - Verificar todas las claves existen
  - Verificar tasas correctas
  - Verificar sumas correctas
  - Retornar errores específicos
  
  **Endpoint:**
  ```
  POST /api/v1/invoices/:id/validate-xml
  Response: {
    valid: true,
    errors: [],
    warnings: [...]
  }
  ```

- [ ] **Tarea 6.4: Generador PDF (Preview)** (3h)
  - Librería: jsPDF o pdfkit
  - Layout profesional
  - Incluir datos invoice
  - Incluir QR (para timbro futuro)
  - Guardaren S3
  
  **PDF Layout:**
  ```
  ┌──────────────────────────────┐
  │ Logo Empresa                 │
  │ RFC | Razón Social           │
  ├──────────────────────────────┤
  │ FACTURA F-001                │
  │ Fecha: 07/06/2026            │
  ├──────────────────────────────┤
  │ Datos Cliente                │
  │ RFC | Nombre                 │
  ├──────────────────────────────┤
  │ Conceptos (tabla)            │
  │ Item | Desc | Cant | Precio  │
  ├──────────────────────────────┤
  │ Subtotal: $1000.00           │
  │ IVA: $160.00                 │
  │ TOTAL: $1160.00              │
  └──────────────────────────────┘
  ```

**Criterio de Aceptación:**
- ✅ XML generado válido (validación local)
- ✅ Todas las claves en catálogos
- ✅ PDF preview se ve profesional
- ✅ Archivos en S3 con URLs
- ✅ Endpoint GET /invoices/:id/pdf retorna PDF

---

## FASE 3️⃣: CFDI - PARSER + GENERADOR AVANZADO (Semanas 7-10)

### Semana 7: Parser CFDI (Leer XML existentes)

**Objetivo:** Importar XMLs CFDI y extraer datos automáticamente

#### Tareas (15 horas)

- [ ] **Tarea 7.1: Parser XML Básico** (5h)
  - Leer archivo XML
  - Extraer datos structure
  - Validar bien formado
  - Convertir a objeto JSON
  
  **Entrada:**
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <cfdi:Comprobante...>
  </cfdi:Comprobante>
  ```
  
  **Salida:**
  ```json
  {
    "emisor": {"rfc": "AAA010101AAA", "nombre": "..."},
    "receptor": {"rfc": "BBB010101BBB", "nombre": "..."},
    "conceptos": [...],
    "total": 1160.00
  }
  ```

- [ ] **Tarea 7.2: Validación XML contra Esquemas SAT** (4h)
  - Descargar esquemas XSD SAT
  - Validar structure
  - Validar tipos de datos
  - Validar namespace
  
  **Validación:**
  ```typescript
  function validateXMLStructure(xmlString: string): {
    valid: boolean,
    errors: string[]
  }
  ```

- [ ] **Tarea 7.3: Extracción de Datos Inteligente** (4h)
  - RFC cliente → buscar/crear customer
  - Clave SAT → buscar producto
  - Cantidad + precio → calcular subtotal
  - Impuestos → detectar automáticamente
  
  **Extracción:**
  ```typescript
  async function parseAndImportInvoice(xmlString: string, companyId: UUID): Promise<Invoice>
  ```

- [ ] **Tarea 7.4: Endpoint de Importación** (2h)
  - POST /api/v1/invoices/import
  - Upload XML file
  - Procesar y retornar invoice creada
  
  **Endpoint:**
  ```
  POST /api/v1/invoices/import
  Content-Type: multipart/form-data
  
  Body: {
    xml_file: <binary>,
    company_id: UUID
  }
  
  Response: {
    success: true,
    invoice_id: UUID,
    data: {...}
  }
  ```

**Criterio de Aceptación:**
- ✅ Importar XML CFDI 4.0 válido
- ✅ Datos extraídos correctamente
- ✅ Cliente auto-creado si no existe
- ✅ Productos detectados
- ✅ Impuestos calculados

---

### Semana 8: Generador CFDI Avanzado + Firma Digital

**Objetivo:** Generar XML CFDI 4.0 completo y firmado digitalmente

#### Tareas (15 horas)

- [ ] **Tarea 8.1: Builder XML Completo** (4h)
  - Estructura completa CFDI 4.0
  - Todos los campos opcionales
  - Validar antes de crear
  - Usar librería xml2js o similar
  
  **Campos importantes:**
  ```xml
  <cfdi:Comprobante
    Version="4.0"
    Serie="F"
    Folio="001"
    Fecha="2026-06-07T10:30:00"
    FormaPago="01"
    MetodoPago="PUE"
    TipoDeComprobante="I"
    Exportacion="01"
    Moneda="MXN"
    SubTotal="1000.00"
    DescuentoTotal="0.00"
    Total="1160.00"
    Sello="SE_CALCULARA_EN_FIRMA"
    NoCertificado="CERT_NUMBER"
    Certificado="BASE64_CERT"
  >
  ```

- [ ] **Tarea 8.2: Firma Digital** (6h)
  - Cargar certificado .pfx
  - Generar sello digital
  - Calcular certificado encoded
  - Validar firma
  - Manejo de errores
  
  **Código:**
  ```typescript
  import { execSync } from 'child_process';
  
  async function signXML(xmlString: string, pfxPath: string, password: string): Promise<string> {
    // Usar openssl o librería node
    // Retornar XML firmado
  }
  ```

- [ ] **Tarea 8.3: Validación Post-Firma** (3h)
  - Verificar XML está bien formado
  - Verificar firma es válida
  - Verificar sello correcto
  - Tests de validación
  
  **Validación:**
  ```typescript
  function validateSignedXML(signedXml: string): {
    valid: boolean,
    signature_valid: boolean,
    errors: string[]
  }
  ```

- [ ] **Tarea 8.4: Integración con Facturación** (2h)
  - POST /api/v1/invoices/:id/generate-xml
  - Retorna XML firmado
  - Guarda en S3
  - Actualiza status a "READY"

**Criterio de Aceptación:**
- ✅ XML generado es válido SAT
- ✅ Firma digital correcta
- ✅ Certificado incluido
- ✅ Sello válido
- ✅ XML se puede timbrar

---

### Semana 9: Validador SAT + Catálogos

**Objetivo:** Validar contra catálogos completos del SAT

#### Tareas (15 horas)

- [ ] **Tarea 9.1: Carga de Catálogos Completos** (4h)
  - Cargar 16+ catálogos SAT
  - Almacenar en DB
  - Caché en Redis
  - Actualización automática (mensual)
  
  **Catálogos:**
  ```
  ✓ c_ClaveProdServ (20,000+ items)
  ✓ c_ClaveUnidad (190 items)
  ✓ c_FormaPago (17 items)
  ✓ c_MetodoPago (23 items)
  ✓ c_RegimenFiscal (23 items)
  ✓ c_UsoCFDI (23 items)
  ✓ c_Impuesto (3 items)
  ✓ c_TasaOCuota (100+ items)
  ✓ c_Moneda (100+ items)
  ✓ c_Pais (250+ items)
  ✓ c_Estado (32 items)
  ✓ c_Localidad (2600+ items)
  ✓ c_Colonia (80,000+ items)
  ✓ c_CodigoPostal (57,000+ items)
  ✓ c_TipoComprobante
  ✓ c_Exportacion
  ```
  
  **Script:**
  ```bash
  npm run seed:catalogs
  ```

- [ ] **Tarea 9.2: Validador contra Catálogos** (5h)
  - Función que valida campo por campo
  - RFC correcto
  - Clave SAT válida
  - Unidad válida
  - Tasa válida
  - Combinaciones válidas
  
  **Función:**
  ```typescript
  async function validateInvoiceAgainstCatalogs(invoice: Invoice): Promise<{
    valid: boolean,
    errors: string[],
    warnings: string[],
    field_errors: {
      [field: string]: string[]
    }
  }>
  ```

- [ ] **Tarea 9.3: Endpoint de Validación** (3h)
  - POST /api/v1/invoices/:id/full-validate
  - Ejecuta todas las validaciones
  - Retorna reporte completo
  - Bloquea si hay errores críticos
  
  **Response:**
  ```json
  {
    "valid": true,
    "ready_for_stamping": true,
    "errors": [],
    "warnings": ["cliente recién creado"],
    "field_errors": {}
  }
  ```

- [ ] **Tarea 9.4: Sincronización SAT Mensual** (3h)
  - Cron job mensual
  - Descargar catálogos nuevos
  - Detectar cambios
  - Actualizar BD
  - Log de cambios
  
  **Script:**
  ```bash
  npm run sync:sat-catalogs
  ```

**Criterio de Aceptación:**
- ✅ 100,000+ registros catálogos en BD
- ✅ Validación rechaza claves inválidas
- ✅ Validación acepta claves válidas
- ✅ Sincronización automática mensual
- ✅ Cache funciona

---

### Semana 10: Complementos de Pago (CFDI Pagos)

**Objetivo:** Generar complemento de pago CFDI válido

#### Tareas (15 horas)

- [ ] **Tarea 10.1: Modelo de Pagos en BD** (3h)
  - Tabla payments mejorada
  - Tabla payment_supplements
  - Relaciones correctas
  - Índices de performance

- [ ] **Tarea 10.2: Generador Complemento Pago** (6h)
  - POST /api/v1/invoices/:id/add-payment
  - Crear CFDI complemento de pago
  - Usar factura + métodopago + referencia
  - Validar montos
  - Firmar XML
  
  **XML Complemento:**
  ```xml
  <cfdi:CfdiRelacionado>
    <cfdi:CfdiRelacionado
      UUID="UUID_FACTURA"
      ParcialidadNumero="1"
      ImpSaldoAnt="1160.00"
      ImpPagado="1160.00"
      ImpSaldoInsoluto="0.00"
    />
  </cfdi:CfdiRelacionado>
  ```

- [ ] **Tarea 10.3: Actualización de Saldos** (3h)
  - Restar pago del balance cliente
  - Si balance = 0, marcar factura PAGADA
  - Si balance > 0, marcar PAGO_PARCIAL
  - Calcular vencimientos
  
  **Cálculos:**
  ```
  balance_restante = invoice_total - SUM(pagos)
  status = IF balance = 0 THEN "PAID" ELSE "PARTIAL_PAYMENT"
  ```

- [ ] **Tarea 10.4: Endpoint de Timbrado (Pre-PAC)** (3h)
  - GET /api/v1/invoices/:id/payment/xml
  - Retorna XML complemento listo para PAC
  - Validar antes de retornar
  - Guardar en S3
  
**Criterio de Aceptación:**
- ✅ Crear pago genera XML válido
- ✅ Balance cliente se actualiza
- ✅ Status factura cambia correctamente
- ✅ Múltiples pagos funcionan
- ✅ XML complemento pago válido SAT

---

## FASE 4️⃣: FRONTEND BÁSICO (Semanas 11-13)

### Semana 11: Setup React + Autenticación

**Objetivo:** Frontend funcional con login y dashboard básico

#### Tareas (12 horas)

- [ ] **Tarea 11.1: Setup React + Vite** (2h)
  - Crear proyecto React con Vite
  - Configurar TypeScript
  - Instalar Tailwind CSS
  - ESLint + Prettier
  
  **Estructura:**
  ```
  frontend/
  ├── src/
  │   ├── components/
  │   ├── pages/
  │   ├── services/
  │   ├── store/
  │   ├── types/
  │   ├── App.tsx
  │   └── main.tsx
  ├── index.html
  ├── tsconfig.json
  ├── vite.config.ts
  └── package.json
  ```

- [ ] **Tarea 11.2: Cliente HTTP + API Service** (3h)
  - Configurar axios
  - Interceptores para JWT
  - Refresh token automático
  - Manejo de errores
  
  **Servicio:**
  ```typescript
  // src/services/api.ts
  const api = axios.create({
    baseURL: process.env.REACT_APP_API_URL
  });
  
  // Interceptor JWT
  api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
  ```

- [ ] **Tarea 11.3: Autenticación (Login/Logout)** (4h)
  - Página de login
  - POST auth/login
  - Guardar token en localStorage
  - Verificar token al cargar app
  - Logout
  
  **Flujo:**
  ```
  Login Page → API /auth/login → Token storage → Redirect Dashboard
  ```

- [ ] **Tarea 11.4: State Management (Redux/Zustand)** (3h)
  - Configurar store
  - Auth slice/store
  - User state
  - Selectors
  
  **Store:**
  ```typescript
  // src/store/authSlice.ts
  const authSlice = createSlice({
    name: 'auth',
    initialState: {
      user: null,
      token: null,
      loading: false
    },
    reducers: {
      setUser: (state, action) => { ... },
      logout: (state) => { ... }
    }
  });
  ```

**Criterio de Aceptación:**
- ✅ Login funciona
- ✅ Token se guarda y recupera
- ✅ Logout funciona
- ✅ Rutas protegidas
- ✅ Refresh automático de token

---

### Semana 12: Dashboard + Navegación

**Objetivo:** Dashboard principal con menú y primeras métricas

#### Tareas (12 horas)

- [ ] **Tarea 12.1: Layout Principal** (3h)
  - Navbar superior
  - Sidebar con menú
  - Main content area
  - Footer (opcional)
  
  **Componentes:**
  ```
  Layout
  ├── Header
  │   ├── Logo
  │   ├── User menu
  │   └── Notifications
  ├── Sidebar
  │   ├── Dashboards
  │   ├── Invoices
  │   ├── Customers
  │   ├── Products
  │   ├── Reports
  │   └── Settings
  └── Main (outlet)
  ```

- [ ] **Tarea 12.2: Dashboard KPIs** (4h)
  - Cards con métricas principales
  - Total facturas emitidas
  - Total facturas pendientes
  - Cobranza del mes
  - Gráficos básicos (Recharts)
  
  **KPIs:**
  ```json
  {
    "total_invoices_month": 25,
    "total_revenue_month": 125000,
    "pending_amount": 35000,
    "overdue_amount": 5000,
    "collection_rate": 72
  }
  ```

- [ ] **Tarea 12.3: Tabla de Facturas Recientes** (3h)
  - Listar últimas 10 facturas
  - Columnas: folio, cliente, monto, estado
  - Ordenable, buscable
  - Link a detail
  
  **Tabla:**
  ```
  | Folio | Cliente | Monto | Estado | Acción |
  |-------|---------|-------|--------|--------|
  | F-001 | ABC Corp | $1000 | SENT  | Ver   |
  ```

- [ ] **Tarea 12.4: Menú y Navegación** (2h)
  - React Router v6
  - Rutas principales
  - Redirección según rol
  - Breadcrumbs
  
  **Rutas:**
  ```
  /dashboard
  /invoices
  /customers
  /products
  /reports
  /settings
  /login
  ```

**Criterio de Aceptación:**
- ✅ Dashboard carga sin errores
- ✅ Menú navega correctamente
- ✅ KPIs muestran datos reales
- ✅ Tabla facturas funciona
- ✅ Responsive en mobile

---

### Semana 13: Generación de Facturas (Frontend)

**Objetivo:** Interfaz para crear facturas completamente

#### Tareas (12 horas)

- [ ] **Tarea 13.1: Formulario de Factura - Paso 1 (Cliente)** (3h)
  - Select o búsqueda cliente
  - RFC, nombre, régimen autocompletan
  - Opción crear nuevo cliente
  - Validación requerida
  
  **Form:**
  ```
  ┌─ NUEVA FACTURA ─┐
  │ Cliente: [buscar] │
  │ RFC: AAA010101AAA │
  │ Nombre: ACME Inc  │
  │ Régimen: General  │
  └──────────────────┘
  ```

- [ ] **Tarea 13.2: Formulario - Paso 2 (Items)** (4h)
  - Agregar productos
  - Buscar por SKU/nombre
  - Cantidad editable
  - Precio se carga del producto
  - Impuesto auto-calcula
  - Botón "Agregar más"
  - Remover items
  
  **Form:**
  ```
  | Producto | Cantidad | P.Unit | Total |
  |----------|----------|--------|-------|
  | Prod A   | 2        | $500   | $1000 |
  [+ Agregar Producto]
  ```

- [ ] **Tarea 13.3: Formulario - Paso 3 (Confirmación)** (3h)
  - Mostrar resumen
  - PDF preview (preview de PDF)
  - Subtotal/Total calculado
  - Opciones de pago/método
  - Notas (opcional)
  - Botón "Crear Factura"
  
  **Summary:**
  ```
  RESUMEN
  Subtotal: $1000.00
  IVA:      $160.00
  ──────────────────
  TOTAL:    $1160.00
  
  [PDF Preview]
  
  [Crear Factura] [Cancelar]
  ```

- [ ] **Tarea 13.4: Postacción** (2h)
  - Mostrar confirmar creada
  - Opciones: descargar XML, descargar PDF, enviar PAC, nuevo
  - Ir a vista detalle factura
  - Toast notifications
  
**Criterio de Aceptación:**
- ✅ Crear factura funciona E2E
- ✅ Impuestos calculan correctamente
- ✅ XML se genera en backend
- ✅ PDF se ve correctamente
- ✅ Validaciones funcionan

---

## FASE 5️⃣: REPORTES + INTEGRACION PAC (Semanas 14-16)

### Semana 14: Reportes Básicos

**Objetivo:** Reportes de cobranza, IVA, ventas por producto

#### Tareas (12 horas)

- [ ] **Tarea 14.1: Reporte Cobranza** (5h)
  - Período seleccionable (desde/hasta)
  - Total facturas, cobrado, pendiente
  - Tabla de facturas vencidas
  - Antigüedad de saldos (0-30, 31-60, 61-90, 90+)
  - Gráfico de cobranza
  - Exportar PDF/Excel
  
  **Report:**
  ```
  REPORTE DE COBRANZA - JUNIO 2026
  
  Período: 01/06/2026 - 30/06/2026
  
  RESUMEN
  Total Facturado:    $150,000
  Total Cobrado:      $120,000
  Pendiente:          $30,000
  Vencido:            $5,000
  Tasa Cobranza:      80%
  
  ANTIGÜEDAD DE SALDOS
  0-30 días:   $10,000 (33%)
  31-60 días:  $15,000 (50%)
  61-90 días:  $5,000  (17%)
  90+ días:    $0      (0%)
  
  CLIENTES MOROSOS
  [tabla]
  ```

- [ ] **Tarea 14.2: Reporte Fiscal (IVA)** (4h)
  - IVA trasladado (ventas)
  - IVA acreditable (futuro)
  - Retenciones ISR
  - Retenciones IVA
  - Por período
  - Exportar para contador
  
  **Report:**
  ```
  REPORTE FISCAL - JUNIO 2026
  
  IVA TRASLADADO: $19,200
  (relacionado a ventas)
  
  RETENCIONES:
  - ISR: $0
  - IVA: $0
  ```

- [ ] **Tarea 14.3: Reporte Ventas por Producto** (2h)
  - Cantidad vendida por producto
  - Ingresos por producto
  - Gráfico de top 10
  - Crecimiento periodo a periodo
  
- [ ] **Tarea 14.4: Página de Reportes** (1h)
  - Selector de reporte
  - Filtros comunes
  - Download buttons
  - Guardar reportes

**Criterio de Aceptación:**
- ✅ Reporte cobranza calcula correcto
- ✅ Antigüedad de saldos agrupa bien
- ✅ Exporta a PDF/Excel
- ✅ Gráficos interactivos
- ✅ Datos coinciden con facturación

---

### Semana 15: Integración PAC (Preparación)

**Objetivo:** Sistema listo para conectar PAC sin fricción

#### Tareas (10 horas)

- [ ] **Tarea 15.1: Abstracto PAC Connector** (3h)
  - Interfaz IPACConnector
  - Factory pattern para crear connectors
  - Error handling estándar
  - Retry logic
  
  **Interfaz:**
  ```typescript
  interface IPACConnector {
    authenticate(): Promise<void>
    stamp(xml: string): Promise<{
      uuid: string,
      xml_stamped: string,
      timestamp: Date
    }>
    cancel(uuid: string, rfc: string): Promise<boolean>
    getStatus(uuid: string): Promise<"valid" | "cancelled">
  }
  ```

- [ ] **Tarea 15.2: Mock PAC (para testing)** (2h)
  - Implementación mock que simula PAC
  - Retorna UUIDs válidos
  - Simula tiempos
  - Permite testing sin APIs reales
  
  **Mock:**
  ```typescript
  class MockPACConnector implements IPACConnector {
    async stamp(xml: string) {
      return {
        uuid: generateUUID(),
        xml_stamped: xml,
        timestamp: new Date()
      }
    }
  }
  ```

- [ ] **Tarea 15.3: Endpoints para Timbrado** (3h)
  - POST /api/v1/invoices/:id/send-to-pac
  - GET /api/v1/invoices/:id/stamping-status
  - PUT /api/v1/invoices/:id/cancel
  - Manejo de errores PAC
  
  **Endpoints:**
  ```
  POST /api/v1/invoices/:id/send-to-pac
  Body: { pac_name: "finkok" }
  Response: { status: "stamping", uuid: "..." }
  
  GET /api/v1/invoices/:id/stamping-status
  Response: { status: "stamped", uuid: "...", pdf_url: "..." }
  ```

- [ ] **Tarea 15.4: Frontend - Timbrado UI** (2h)
  - Botón "Enviar a PAC"
  - Modal de confirmación
  - Status de timbrado en tiempo real
  - Descarga PDF timbrado
  - Cancelar si es necesario

**Criterio de Aceptación:**
- ✅ Sistema acepta timbrado
- ✅ Mock PAC funciona
- ✅ UUIDs se guardan
- ✅ Status se actualiza
- ✅ Listo para PAC real (solo cambiar credentials)

---

### Semana 16: Documentación + Pulido Final

**Objetivo:** Proyecto producción-ready, documentado y testeado

#### Tareas (12 horas)

- [ ] **Tarea 16.1: Documentación API (OpenAPI/Swagger)** (3h)
  - Endpoints documentados
  - Parámetros y responses
  - Autenticación
  - Ejemplos
  - Deploy swagger UI
  
  **URL:** `http://localhost:3001/api/docs`

- [ ] **Tarea 16.2: README & Guías** (2h)
  - Actualizar README.md
  - Guía de instalación
  - Guía de desarrollo
  - FAQ
  
- [ ] **Tarea 16.3: Tests Integración E2E** (4h)
  - Test crear factura E2E
  - Test reporte cobranza
  - Test pago
  - Test exportación
  - Target: >70% coverage
  
  **Suite:**
  ```bash
  npm test
  # Coverage: 72%
  ```

- [ ] **Tarea 16.4: Pulido y Optimizaciones** (3h)
  - Performance checks
  - Frontend bundle size
  - DB query optimization
  - Security review
  - Fixes de bugs
  - Cleanup de código

**Criterio de Aceptación:**
- ✅ Documentación clara
- ✅ Tests pasan
- ✅ Coverage >70%
- ✅ Performance OK
- ✅ Sin errores en consola
- ✅ Pronto para MVP

---

## 📈 Métricas de Éxito por Fase

| Métrica | Fase 1 | Fase 2 | Fase 3 | Fase 4 | Fase 5 |
|---------|--------|--------|--------|--------|--------|
| Tests | 5+ | 20+ | 50+ | 30+ | 100+ |
| Code Coverage | 50% | 65% | 80% | 75% | 72% |
| Endpoints | 8 | 35 | 50 | 60 | 65 |
| UI Pages | 0 | 0 | 0 | 6 | 8 |
| DB Tables | 13 | 13 | 13 | 13 | 13 |
| Commits | 10 | 30 | 40 | 25 | 20 |

---

## 🚀 Plan de Acción Semanal

Cada semana:

1. **Lunes:** Planear tareas de la semana
2. **Martes-Jueves:** Desarrollo (10-15h)
3. **Viernes:** Testing + documentación (3-5h)
4. **Sábado-Domingo:** Review y próximas tareas (1-2h)

---

## ⚠️ Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|-----------|
| Cambios catálogos SAT | Medio | Sincronización automática mensual |
| Cambios Anexo 20 | Medio | Monitorear SAT, tests validación |
| Performance reportes | Bajo | Índices BD, caché Redis |
| Integración PAC compleja | Alto | Abstracción, mock para testing |
| Timeline ajustado | Alto | Priorizar MVP, V2 para features extra |

---

## ✅ Checklist Final (Semana 16)

- [ ] Todos los tests pasan
- [ ] Coverage >70%
- [ ] Documentación completa
- [ ] No hay console errors
- [ ] Performance aceptable
- [ ] Security review pasada
- [ ] BD respaldada
- [ ] Código limpio
- [ ] Listo para MVP beta
- [ ] Plan para Fase 2 (PAC + Multi-empresa)

---

**Última actualización:** Junio 7, 2026
**Versión:** 0.1.0
**Estado:** Plan Base - Ajustable según progreso

