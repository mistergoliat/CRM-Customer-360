# Base Local MariaDB

Este repositorio usa una base local reproducible para desarrollo y pruebas rápidas.

## Requisitos

- Docker Desktop
- Node.js
- npm

## Preparación

En PowerShell:

```powershell
Copy-Item infra\.env.example infra\.env
npm run db:up
npm run db:wait
npm run db:migrate -- --database=dev
npm run db:seed -- --database=dev
npm run dev:local
```

## Reinicio completo

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
