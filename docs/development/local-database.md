# Base Local MariaDB

Este repositorio usa una base local reproducible para desarrollo y pruebas rápidas.

## Requisitos

- Docker Desktop
- Node.js
- npm

## Contrato de variables de entorno (INFRA-01)

- `DB_HOST` / `DB_PORT` son comunes a todos los targets (una sola instancia local de MariaDB). Se definen una vez.
- `DB_USER` / `DB_PASSWORD` deliberadamente **no** se usan: en `lib/database-config.ts`, esos alias ganan sobre `MIGRATION_DATABASE_USER`/`TEST_DATABASE_USER`/etc., lo que deja inalcanzable a `crm_dev_admin`. Cada target define su propio usuario/clave:
  - app -> `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_NAME` (`main_management`, usuario `crm_app`).
  - migraciones -> `MIGRATION_DATABASE_USER` / `MIGRATION_DATABASE_PASSWORD` (usuario `crm_dev_admin`).
  - tests -> `TEST_DATABASE_USER` / `TEST_DATABASE_PASSWORD` (usuario `crm_dev_admin`, base `crm_test`).
  - legacy -> `LEGACY_DATABASE_USER` / `LEGACY_DATABASE_PASSWORD` (usuario `crm_app`, base `crm_legacy_fixture`).
  - El nombre de base por target ya está fijo en `scripts/db-utils.ts#getTargetDatabaseName` (`dev` -> `main_management`, `test` -> `crm_test`, `legacy` -> `crm_legacy_fixture`); no se sobreescribe con `*_DATABASE_NAME`.
- `CRM_APP_PASSWORD` es exclusiva de infraestructura: la usa `infra/mariadb/init/002-set-local-passwords.sh` vía `docker-compose` para fijar la clave real de `crm_app` en MariaDB. Debe llevar siempre el mismo valor que `DATABASE_PASSWORD`.

`infra/.env` (consumida por los scripts `db:*`) y `.env` (consumida por Next.js) deben declarar los mismos valores. `infra/.env.example` y `.env.example` documentan el contrato vigente.

## Preparación (volumen limpio)

En PowerShell:

```powershell
Copy-Item infra\.env.example infra\.env
npm run db:up
npm run db:wait
npm run db:migrate -- --database=dev
npm run db:seed -- --database=dev
npm run db:bootstrap:smoke
npm run dev:local
```

`db:bootstrap:smoke` aplica migraciones, verifica que existan las tablas esperadas, confirma que `crm_app` puede conectarse y que sus permisos están acotados (sin CREATE/ALTER/DROP), y que `crm_dev_admin` sí puede hacer DDL. Es el procedimiento automatizado para comprobar que el bootstrap funciona desde un volumen vacío, sin SQL manual dentro del contenedor.

## Reinicio completo (recrea el volumen desde cero)

```powershell
npm run db:down
docker volume rm infra_main_management_mariadb_data
npm run db:up
npm run db:wait
npm run db:migrate -- --database=dev
npm run db:bootstrap:smoke
```

`npm run db:reset` (más abajo) reinicia el contenido de una base ya existente sin tocar el volumen ni la creación del usuario; úsalo para limpiar datos, no para verificar el bootstrap completo.

```powershell
npm run db:reset
```

## Tests

```powershell
npm run db:test:reset
npm test
```

## Estado del contenedor

```powershell
npm run db:status
```

## Base legacy de fixtures

```powershell
npm run db:legacy:reset
```

## Conexión manual

- host: `127.0.0.1`
- port: `3306`
- database: `main_management`
- user: `crm_app`

## Herramientas SQL

Puedes usar DBeaver, la extensión SQL de VS Code o cualquier cliente compatible con MariaDB.

## Notas

- No se versionan credenciales reales.
- MariaDB corre solo en `127.0.0.1:3306`.
- La aplicación Next.js usa el mismo `infra/.env` cuando arrancas con `npm run dev:local`.
