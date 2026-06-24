# PesasChile HUB Webapp

Webapp independiente para continuidad operacional del HUB WhatsApp/Casos. La app no depende de webhooks n8n para leer casos ni enviar respuestas manuales: usa MySQL/MariaDB y Meta Graph API server-side.

## Stack

- Next.js + TypeScript
- TailwindCSS con tokens Crimson Logic
- MySQL/MariaDB vía `mysql2`
- Docker separado de n8n

## Rutas visuales P1M

- `/dashboard`: centro operacional.
- `/conversations` y `/conversations/[id]`: inbox y workspace conversacional.
- `/cases` y `/cases/[id]`: dominio operativo separado de Conversations.
- `/customers` y `/customers/[id]`: directorio y perfil provisional.
- `/opportunities` y `/opportunities/[id]`: inbox y workspace comercial.
- `/actions` y `/actions/[id]`: cola global de acciones.
- `/marketing`: overview del módulo de crecimiento.
- `/marketing/copilot`, `/marketing/segments`, `/marketing/campaigns/new`, `/marketing/campaigns/[id]`, `/marketing/automations/[id]`: subrutas visuales de Marketing.
- `/knowledge`: biblioteca y artículo de conocimiento.
- `/analytics`: BI transversal.
- `/integrations`: salud de integraciones.
- `/settings`: gobernanza y configuración.

## Rutas legacy

- `/chats` redirige a `/conversations`.
- `/mailing` redirige a `/marketing`.
- `/system` redirige a `/integrations`.

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
