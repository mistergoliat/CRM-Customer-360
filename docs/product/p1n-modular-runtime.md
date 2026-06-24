# P1N Modular Runtime

Este documento resume la transición de P1M hacia un runtime modular con fuentes reales, adapters y read models aislados.

## Objetivo

Separar la cadena:

```text
fuente real
→ adapter
→ repository
→ service/read model
→ API
→ UI
```

para que un módulo defectuoso no derribe el resto del HUB.

## Autoridades de datos

- `master_customer` es la autoridad canónica para Customers.
- `n8n_vw_hub_cases` sigue siendo la fuente temporal para Cases y Conversations.
- La UI consume contratos internos y no SQL directo.
- `master_customer` representa una cuenta única.
- `email` es obligatorio y único.
- `platform_origin` indica la plataforma donde se creó originalmente la cuenta y no cambia por actividad posterior.

## Módulos iniciales

- `dashboard`
- `conversations`
- `cases`
- `customers`
- `opportunities`
- `actions`
- `marketing`
- `knowledge`
- `analytics`
- `integrations`

## Modo de datos

Valores válidos:

- `real`
- `partial`
- `fixture`
- `disabled`
- `error`

Cada módulo expone:

```ts
type ModuleRuntimeStatus = {
  module: string;
  mode: ModuleDataMode;
  available: boolean;
  source: string;
  warnings: string[];
  checkedAt: string;
};
```

## Reglas

- Los módulos fallan de forma aislada.
- `Promise.allSettled` se usa en el dashboard para evitar caídas globales.
- Los endpoints nuevos usan `requireOperator`.
- `DB_WRITE_ENABLED=false` bloquea escrituras en Customers.

## Estado actual

- Conversations: `real`
- Cases: `real`
- Customers: `real`
- Customers soporta `platform_origin`.
- Dashboard: `partial`
- Opportunities: `fixture`
- Actions: `partial`
- Marketing: `fixture`
- Knowledge: `fixture`
- Analytics: `partial`
- Integrations: `partial`
