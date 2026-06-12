# PesasChile HUB Webapp

Webapp independiente para continuidad operacional del HUB WhatsApp/Casos. La app no depende de webhooks n8n para leer casos ni enviar respuestas manuales: usa MySQL/MariaDB y Meta Graph API server-side.

## Stack

- Next.js + TypeScript
- TailwindCSS con tokens Crimson Logic
- MySQL/MariaDB vía `mysql2`
- Docker separado de n8n

## Rutas funcionales fase 1

- `/dashboard`: métricas reales o estados `query_error`.
- `/cases`: listado real desde `n8n_vw_hub_cases`.
- `/cases/[id]`: detalle, timeline, respuesta manual, cerrar, reabrir, bloquear IA, prioridad.
- `/whatsapp`: lectura parcial de inbound/outbound y estado Meta.
- `/audit`: lectura de `hub_audit_log`.
- `/system`: salud básica DB, Meta config y n8n opcional.

## Módulos preview

`/customers`, `/customer-master`, `/mailing`, `/knowledge`, `/agents`, `/analytics` y `/settings` son pantallas de producto en preview. No tienen backend falso ni métricas inventadas.

## Configuración

```powershell
Copy-Item .env.example .env
```

Completar:

```dotenv
DATABASE_URL=mysql://user:password@host:3306/database
META_GRAPH_API_VERSION=v22.0
META_ACCESS_TOKEN=...
DEFAULT_PHONE_NUMBER_ID=...
APP_BASE_URL=http://localhost:3010
SESSION_SECRET=...
N8N_BASE_URL=https://n8n.pesaschile.cl
ADMIN_BYPASS_TOKEN=...
```

`META_ACCESS_TOKEN` nunca se expone al cliente. Las llamadas a Meta se ejecutan únicamente desde rutas API server-side.

## Migración de auditoría

La app intenta crear `hub_audit_log` al registrar eventos. También está disponible la migración:

```sql
migrations/001_hub_audit_log.sql
```

## Docker

Desde la raíz del repo:

```powershell
docker compose -f docker-compose.hub.yml up --build
```

Abrir:

```text
http://localhost:3010
```

Login inicial: usar el valor de `ADMIN_BYPASS_TOKEN`.

## Desarrollo local

Requiere Node/NPM local:

```powershell
npm install
npm run dev
```

## Notas de seguridad y datos

- Queries parametrizadas para inputs de usuario.
- Escrituras adaptativas: antes de actualizar/insertar se inspeccionan columnas reales con `DESCRIBE`.
- Si falta una columna esperada, se omite o se devuelve warning/error controlado.
- Timestamps operacionales usan `CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00')`.
- No se implementan templates WhatsApp en fase 1. Si la ventana 24h está cerrada, el reply devuelve error claro.
- No se tocan workflows n8n ni tablas existentes fuera de updates operacionales solicitados.
