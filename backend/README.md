# Backend - ERP CFDI 4.0 México

Servidor Node.js + Express para gestión de facturación electrónica CFDI 4.0.

## 🚀 Inicio Rápido

### Requisitos Previos
- Node.js 18+
- PostgreSQL 15+
- Redis 6+
- npm o yarn

### Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 3. Ejecutar en desarrollo
npm run dev

# 4. Crear base de datos (si es nueva)
npm run migrate

# 5. Cargar catálogos SAT
npm run seed:catalogs

# 6. Crear usuario admin (opcional)
npm run create:admin
```

### Verificar que funciona

```bash
# Health check
curl http://localhost:3001/health

# API info
curl http://localhost:3001/api/v1
```

## 📁 Estructura del Proyecto

```
backend/
├── src/
│   ├── config/
│   │   ├── environment.ts      (Variables de entorno)
│   │   ├── database.ts         (PostgreSQL config)
│   │   └── redis.ts            (Redis config)
│   ├── middleware/
│   │   ├── logger.ts           (Winston logging)
│   │   ├── errorHandler.ts     (Manejo de errores)
│   │   └── authentication.ts   (JWT middleware)
│   ├── modules/                (Módulos de funcionalidad)
│   │   ├── auth/
│   │   ├── companies/
│   │   ├── customers/
│   │   ├── products/
│   │   ├── invoices/
│   │   ├── payments/
│   │   ├── reports/
│   │   ├── cfdi/
│   │   ├── catalogs/
│   │   └── pac/
│   ├── utils/
│   │   └── validators.ts       (Validaciones)
│   ├── types/
│   │   └── index.ts            (TypeScript types)
│   ├── app.ts                  (Express setup)
│   └── index.ts                (Entry point)
├── scripts/
│   ├── migrate.ts
│   ├── seed-catalogs.ts
│   └── create-admin.ts
├── package.json
├── tsconfig.json
├── .env.example
└── Dockerfile
```

## 🛠️ Scripts Disponibles

```bash
npm run dev              # Desarrollo con hot reload
npm run build           # Compilar TypeScript
npm start               # Producción
npm test                # Ejecutar tests
npm run test:watch      # Tests en modo watch
npm run test:coverage   # Coverage de tests
npm run lint            # ESLint
npm run lint:fix        # ESLint auto-fix
npm run migrate         # Migraciones DB
npm run seed:catalogs   # Cargar catálogos SAT
npm run seed:demo       # Datos de prueba
npm run create:admin    # Crear usuario admin
```

## 🔐 Autenticación

### Generar Tokens JWT

```typescript
import { generateToken, generateRefreshToken } from './middleware/authentication';

// Token de acceso (1 hora)
const token = generateToken({
  userId: 'user-uuid',
  email: 'user@example.com',
  role: 'USER',
  companyId: 'company-uuid'
});

// Refresh token (7 días)
const refreshToken = generateRefreshToken({
  userId: 'user-uuid',
  email: 'user@example.com',
  role: 'USER'
});
```

### Usar Middleware de Autenticación

```typescript
import { authenticateToken, authorize } from './middleware/authentication';

app.post('/api/v1/invoices', 
  authenticateToken,                    // Verifica token
  authorize('USER', 'MANAGER', 'ADMIN'),// Verifica rol
  invoiceController.create
);
```

## 📊 Base de Datos

### Conexión

PostgreSQL se configura automáticamente desde `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cfdi_erp
DB_USER=app_user
DB_PASSWORD=your_password
```

### Ejecutar Migraciones

```bash
npm run migrate
```

Esto ejecuta `DATABASE.sql` del proyecto raíz.

### Pool de Conexiones

- Min: 2 conexiones
- Max: 10 conexiones
- Timeout inactivo: 30 segundos

## 🔴 Redis

### Conexión

Redis se configura automáticamente:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_TTL=3600 (1 hora)
```

### Uso

```typescript
import * as redis from './config/redis';

// Set
await redis.set('key', { data: 'value' }, 3600); // TTL en segundos

// Get
const data = await redis.get('key');

// Delete
await redis.del('key');

// Check exists
const exists = await redis.exists('key');

// Delete by pattern
await redis.deletePattern('session:*');
```

## 📝 Logging

Winston está configurado para:

- **Console:** Salida colorizada en desarrollo
- **error.log:** Solo errores
- **all.log:** Todos los logs

### Niveles

```
error  (0)
warn   (1)
info   (2)
http   (3)
debug  (4)
```

### Usar Logger

```typescript
import logger from './middleware/logger';

logger.error('Error message', { context: 'data' });
logger.warn('Warning message');
logger.info('Info message');
logger.http('HTTP request');
logger.debug('Debug message');
```

## ✅ Validaciones

Utilidades en `src/utils/validators.ts`:

```typescript
import * as validators from './utils/validators';

// RFC Mexicano
validators.isValidRFC('AAA010101AAA');  // true

// Email
validators.isValidEmail('user@example.com');  // true

// Código postal
validators.isValidPostalCode('28020');  // true

// Teléfono
validators.isValidPhoneNumber('5551234567');  // true

// UUID
validators.isValidUUID('...');  // true

// UUID CFDI
validators.isValidCFDIUUID('...');  // true

// Contraseña fuerte
validators.isStrongPassword('SecurePass123!');  // true

// Porcentaje
validators.isValidPercentage(50);  // true

// JSON válido
validators.isValidJSON('{"key": "value"}');  // true
```

## 🚨 Manejo de Errores

Excepciones personalizadas en `src/middleware/errorHandler.ts`:

```typescript
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from './middleware/errorHandler';

// Throw error
throw new ValidationError('RFC inválido');     // 400
throw new UnauthorizedError('Token no válido'); // 401
throw new ForbiddenError('Acceso denegado');   // 403
throw new NotFoundError('Cliente no existe'); // 404
throw new ConflictError('RFC ya existe');     // 409
```

## 🐳 Docker

### Build Image

```bash
docker build -t cfdi-erp-backend:0.1.0 .
```

### Run Container

```bash
docker run \
  -e NODE_ENV=production \
  -e DB_HOST=host.docker.internal \
  -e DB_PASSWORD=your_password \
  -e JWT_SECRET=your_secret \
  -p 3001:3001 \
  cfdi-erp-backend:0.1.0
```

### Docker Compose

Ver `docker-compose.yml` en la raíz del proyecto.

```bash
docker-compose up -d backend
```

## 📈 Performance

### Optimizaciones

- Connection pooling (min 2, max 10)
- Redis caching para catálogos SAT
- Índices DB en tablas principales
- Logging asincrónico
- Compression de respuestas

### Monitoreo

```bash
# Health check
curl http://localhost:3001/health
```

## 🔧 Troubleshooting

### "Cannot find module"
```bash
rm -rf node_modules
npm install
npm run build
```

### "Database connection refused"
```bash
# Verificar PostgreSQL running
psql -U postgres -c "SELECT 1;"
```

### "Redis connection refused"
```bash
# Verificar Redis running
redis-cli ping
```

### "Port 3001 already in use"
```bash
# Cambiar puerto en .env
APP_PORT=3002
```

## 📚 Próximos Pasos

Semana 1 (Backend Setup):
- [x] Estructura del proyecto
- [x] Configuración express
- [x] Autenticación JWT
- [x] Logger y manejo de errores
- [ ] Endpoints de prueba
- [ ] Tests básicos
- [ ] Deploy local

## 📞 Contacto

- **Autor:** anbeor29@gmail.com
- **Proyecto:** ERP CFDI 4.0 México
- **Versión:** 0.1.0

---

**Última actualización:** Junio 7, 2026
