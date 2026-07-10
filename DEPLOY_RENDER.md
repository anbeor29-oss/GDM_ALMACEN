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
