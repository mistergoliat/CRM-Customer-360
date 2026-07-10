---
title: Customer Service HTTP contract
doc_id: integration-customer-service-http-contract
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-09
source_of_truth_for:
  - Customer Service HTTP wire contract
  - Customer Service error envelope
  - Customer Service idempotency header
depends_on:
  - ../data/customer-creation-linking-authority-contract.md
  - ../releases/ACS-R1-04-customer-identity-onboarding.md
supersedes: []
tags:
  - integration
  - identity
  - authority
---
# Customer Service HTTP contract

## Relaciones

- Gobernado por: [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md)
- Depende de: [ACS-R1-04 release](../releases/ACS-R1-04-customer-identity-onboarding.md)
- Implementa: `lib/integrations/customer-service/http-adapter.ts`
- Evidencia: [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)
- Reemplaza: none

## Alcance

Contrato de transporte HTTP entre ACS y el microservicio externo Customer Service para `resolve_customer`, `create_customer` y `link_external_identity`. `record_customer_interest` no tiene transporte HTTP en `ACS-R1-04-T04.1` (solo tipos y policy).

Los outcomes de negocio que Customer Service decide explicitamente viajan dentro del cuerpo de una respuesta `2xx` con su propio campo `status`. El codigo HTTP no `2xx` tambien es significativo: `400`/`422` senalan request estructuralmente invalido (`invalid_input`), `409` senala conflicto de dominio (`conflict`) y `408`/`429`/`502`/`503`/`504`, timeouts y errores de red son problemas de transporte.

## Autenticacion

Header `x-api-key: <CUSTOMER_SERVICE_API_KEY>` en cada request. No se usa `Authorization: Bearer`.

## Timeout

`CUSTOMER_SERVICE_TIMEOUT_MS` (default `5000`). Un timeout aborta la request via `AbortController` y se reporta como `temporarily_unavailable`.

## Idempotencia

Las operaciones mutating (`create_customer`, `link_external_identity`) envian:

```http
Idempotency-Key: customer-service:create:<capabilityExecutionId>
Idempotency-Key: customer-service:link:<capabilityExecutionId>
```

La clave la genera `lib/domains/customer-service/service.ts` a partir de un `capabilityExecutionId` operacional - nunca un valor libre elegido por el agente o el LLM.

## Ownership del retry

El adapter no reintenta. Es exactamente una llamada HTTP fisica por invocacion del port. El Capability Gateway es el unico propietario del retry cuando esta capability se registre en el.

## Endpoints

### `POST /v1/customers/resolve`

Request:

```json
{
  "channel": "whatsapp",
  "externalId": "56912345678",
  "phoneNumber": "56912345678",
  "email": null
}
```

Respuesta `200`, cuerpo `status`:

```json
{ "status": "resolved", "customerId": "123" }
{ "status": "no_match" }
{ "status": "conflict", "conflictCode": "multiple_candidates" }
```

No hay variante `failed` para esta operacion: un `5xx` no clasificado se mapea a `temporarily_unavailable`, nunca se inventa un sexto status.

### `POST /v1/customers`

Header `Idempotency-Key` obligatorio.

Request:

```json
{
  "firstName": "Ana",
  "lastName": "Perez",
  "email": "ana@example.com",
  "phoneNumber": "56912345678",
  "origin": { "channel": "whatsapp", "externalId": "56912345678" },
  "commercialPurpose": "quote",
  "consent": { "createCustomer": true, "messageId": "wamid.xxx", "capturedAt": "2026-07-09T00:00:00.000Z" }
}
```

Respuesta `2xx`, cuerpo `status`:

```json
{ "status": "created", "customerId": "999" }
{ "status": "matched_existing", "customerId": "42" }
{ "status": "missing_information", "requiredFields": ["email"] }
{ "status": "denied", "reason": "..." }
```

### `POST /v1/customers/{customerId}/external-identities`

Header `Idempotency-Key` obligatorio.

Request:

```json
{
  "externalIdentity": { "provider": "whatsapp", "externalId": "56912345678", "normalizedPhone": "56912345678" },
  "consent": { "granted": true, "messageId": "wamid.xxx", "capturedAt": "2026-07-09T00:00:00.000Z" }
}
```

Respuesta `2xx`, cuerpo `status`:

```json
{ "status": "completed", "customerId": "cust-1", "externalIdentityId": "ext-1" }
{ "status": "already_linked", "customerId": "cust-1", "externalIdentityId": "ext-1" }
{ "status": "denied", "reason": "..." }
```

## Error envelope

Cualquier respuesta no `2xx` usa:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "human readable string, never persisted",
    "fields": ["email"],
    "conflictCode": "already_linked_to_other_customer"
  }
}
```

## Codigos HTTP -> outcome

| HTTP | Outcome |
| --- | --- |
| `2xx` | outcome real segun `status` del body |
| `400` / `422` | `invalid_input` (`fields` desde el envelope) |
| `409` | `conflict` (`conflictCode` desde el envelope) |
| `408` / `429` / `502` / `503` / `504` | `temporarily_unavailable` (`retryable: true`) |
| otros `5xx` | `failed` (`create_customer` / `link_external_identity`); `temporarily_unavailable` para `resolve_customer` |
| timeout / error de red | `temporarily_unavailable` (`retryable: true`) |
| respuesta invalida | `failed` (`create_customer` / `link_external_identity`); `temporarily_unavailable` (`retryable: false`) para `resolve_customer` |

Configuracion ausente (`CUSTOMER_SERVICE_BASE_URL` o `CUSTOMER_SERVICE_API_KEY` sin definir) nunca intenta una llamada HTTP: `createCustomerServicePort()` devuelve un port fail-closed que responde `temporarily_unavailable` en las tres operaciones. Nunca se interpreta como `no_match`.

## Redaccion de PII

El adapter nunca incluye en el resultado tipado: `x-api-key`, `Authorization`, el `message` crudo del envelope, emails completos ni telefonos completos.

## Configuracion minima

```text
CUSTOMER_SERVICE_BASE_URL
CUSTOMER_SERVICE_API_KEY
CUSTOMER_SERVICE_TIMEOUT_MS   (default 5000)
```

## Fuera de alcance de este contrato

- `record_customer_interest` (solo policy y tipos en `T04.1`, sin transporte).
- Registro en el Capability Gateway.
- Conexion al runtime autonomo o al inbound.
