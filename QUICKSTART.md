# 🚀 QUICKSTART - Comenzar Desarrollo

Guía rápida para configurar el proyecto localmente y comenzar a desarrollar.

---

## ✅ Requisitos Previos

Asegúrate de tener instalado:

```bash
# Verificar versiones
node --version        # debe ser 18.0 o superior
npm --version        # debe ser 9.0 o superior
git --version        # cualquier versión reciente
docker --version     # para contenedores (opcional)
```

**Descargas necesarias:**
- [Node.js 18+ LTS](https://nodejs.org)
- [PostgreSQL 15+](https://www.postgresql.org/download)
- [Git](https://git-scm.com)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (opcional, pero recomendado)

---

## 📂 Paso 1: Preparar la Carpeta del Proyecto

El proyecto está en: `D:\Obsidian\GDM_FAC\`

```bash
# Navegar a la carpeta
cd D:\Obsidian\GDM_FAC

# Verificar archivos existentes
dir
# Deberías ver: README.md, ARCHITECTURE.md, DATABASE.sql, .gitignore, .env.example
```

---

## 🗄️ Paso 2: Configurar Base de Datos PostgreSQL

### Opción A: PostgreSQL Local (Manual)

```bash
# 1. Iniciar PostgreSQL (debe estar instalado)
# En Windows: El servicio debería iniciar automáticamente

# 2. Conectarse a PostgreSQL
psql -U postgres

# 3. Crear base de datos
CREATE DATABASE cfdi_erp 
  ENCODING = 'UTF8' 
  LC_COLLATE = 'es_MX.UTF-8' 
  LC_CTYPE = 'es_MX.UTF-8';

# 4. Salir
\q

# 5. Ejecutar el script SQL
psql -U postgres -d cfdi_erp < DATABASE.sql

# 6. Verificar que se creó correctamente
psql -U postgres -d cfdi_erp -c "SELECT * FROM companies;"
```

### Opción B: Docker Compose (Recomendado)

Crear archivo `docker-compose.yml` en la raíz:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: cfdi_db
    environment:
      POSTGRES_DB: cfdi_erp
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: postgres_password
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=es_MX.UTF-8"
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./DATABASE.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - cfdi_network

  redis:
    image: redis:7-alpine
    container_name: cfdi_redis
    ports:
      - "6379:6379"
    networks:
      - cfdi_network

volumes:
  postgres_data:

networks:
  cfdi_network:
    driver: bridge
```

Luego ejecutar:

```bash
docker-compose up -d

# Esperar a que los contenedores estén listos (5-10 segundos)
docker-compose logs -f

# Detener (cuando necesites)
docker-compose down
```

---

## 📝 Paso 3: Configurar Variables de Entorno

```bash
# Copiar el archivo de ejemplo
cp .env.example .env

# Editar .env con tus valores (nota: en local puedes usar defaults)
# Para desarrollo local, los valores por defecto son:
# DB_HOST=localhost
# DB_USER=app_user
# DB_PASSWORD=postgres_password  (si usas Docker Compose)
# REDIS_HOST=localhost
# JWT_SECRET=dev_secret_change_in_production
```

---

## 🏗️ Paso 4: Crear Estructura del Proyecto

### Backend (Node.js + Express)

```bash
# Crear carpeta backend
mkdir backend
cd backend

# Inicializar proyecto Node
npm init -y

# Instalar dependencias principales
npm install express cors dotenv pg redis jsonwebtoken bcrypt joi winston axios

# Instalar dependencias de desarrollo
npm install --save-dev typescript ts-node @types/node @types/express nodemon jest ts-jest

# Crear estructura de carpetas
mkdir -p src/{config,modules,middleware,utils,database,tests}
mkdir -p src/modules/{auth,companies,customers,products,invoices,payments,reports,cfdi,catalogs,pac}

cd ..
```

Crear `backend/package.json` adecuado:

```json
{
  "name": "cfdi-erp-backend",
  "version": "0.1.0",
  "description": "Backend ERP CFDI 4.0 México",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node -r dotenv/config src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "migrate": "node scripts/migrate.js",
    "seed:catalogs": "node scripts/seed-catalogs.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC"
}
```

### Frontend (React)

```bash
# Crear app React con Vite (más rápido que CRA)
npm create vite@latest frontend -- --template react-ts

cd frontend
npm install

# Instalar UI y utilidades
npm install axios zustand react-router-dom tailwindcss recharts

cd ..
```

---

## 📦 Paso 5: Instalar Dependencias

```bash
# Backend
cd backend
npm install
cd ..

# Frontend
cd frontend
npm install
cd ..
```

---

## ✨ Paso 6: Crear Archivo Inicial Backend

Crear `backend/src/index.ts`:

```typescript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.APP_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '0.1.0'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`📚 API Docs: http://localhost:${PORT}/api/docs`);
});
```

---

## 🎨 Paso 7: Crear Archivo Inicial Frontend

Frontend ya viene generado por Vite, solo necesitas verificar `frontend/src/App.tsx`:

```typescript
import { useState } from 'react'

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-blue-600">
            ERP CFDI México
          </h1>
        </div>
      </nav>
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Bienvenido</h2>
          <p className="text-gray-600">
            Sistema de facturación CFDI 4.0 para México
          </p>
        </div>
      </main>
    </div>
  )
}

export default App
```

---

## ▶️ Paso 8: Ejecutar en Local

### Terminal 1: PostgreSQL + Redis (si usas Docker)

```bash
docker-compose up
# Dejar abierta
```

### Terminal 2: Backend

```bash
cd backend
npm run dev
# Debería ver: ✅ Backend running on http://localhost:3001
```

### Terminal 3: Frontend

```bash
cd frontend
npm run dev
# Debería ver: http://localhost:5173
```

---

## ✅ Verificar que Todo Funciona

1. **Backend Health Check**
   ```bash
   curl http://localhost:3001/api/v1/health
   # Respuesta: {"status":"OK","timestamp":"...","version":"0.1.0"}
   ```

2. **Frontend cargando**
   - Abrir http://localhost:5173
   - Deberías ver la página inicial

3. **Base de datos**
   ```bash
   psql -U app_user -d cfdi_erp -c "SELECT COUNT(*) FROM sat_catalogs;"
   # Respuesta: count
   # -------
   #      5
   ```

---

## 📝 Siguiente: Desarrollar Módulos

Una vez todo esté funcionando, comienza con:

### 1. Módulo de Autenticación (1-2 días)
- Login endpoint
- JWT tokens
- Middleware de verificación

### 2. Módulo de Empresas (1 día)
- CRUD companies
- Validación RFC
- Configuración

### 3. Módulo de Clientes (1-2 días)
- CRUD customers
- Búsqueda por RFC
- Balance automático

### 4. Módulo de Productos (1 día)
- CRUD products
- Validación contra catálogos SAT
- Stock management

### 5. Módulo CFDI Parser (2-3 días)
- Leer XML CFDI
- Extraer información
- Validar estructura

### 6. Módulo CFDI Generator (3-4 días)
- Crear XML CFDI válido
- Firmar digitalmente
- Guardar en S3

### 7. Módulo de Facturas (2-3 días)
- API facturas CRUD
- Calcular impuestos
- Generar PDF

### 8. Frontend Básico (3-4 días)
- Dashboard
- Crear factura
- Ver facturas

---

## 🆘 Solución de Problemas

### "Port 3001 already in use"
```bash
# Cambiar puerto en .env
APP_PORT=3002
```

### "Cannot connect to database"
```bash
# Verificar PostgreSQL está corriendo
psql -U postgres -c "SELECT version();"

# Si no está instalado:
# Descargar desde: https://www.postgresql.org/download
```

### "Module not found"
```bash
# Reinstalar dependencias
rm -rf node_modules package-lock.json
npm install
```

### "Docker issues"
```bash
# Limpiar y reiniciar
docker-compose down -v
docker-compose up
```

---

## 📚 Recursos

- [CFDI 4.0 Official](https://www.sat.gob.mx/consulta/49263/catalogos-de-validacion-disponibles)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)
- [Express.js Guide](https://expressjs.com)
- [React Docs](https://react.dev)
- [SAT Anexo 20](https://www.sat.gob.mx/consulta/49263/catalogos-de-validacion-disponibles)

---

## ✨ ¡Listo!

Ya tienes el proyecto configurado y listo para comenzar a desarrollar.

**Próximo paso:** Ver PLAN_DETALLADO.md para el roadmap de desarrollo fase por fase.

