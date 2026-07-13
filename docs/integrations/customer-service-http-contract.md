---
title: Customer Service HTTP contract
doc_id: integration-customer-service-http-contract
status: approved
version: "2.0.0"
owner: architecture
last_reviewed: 2026-07-13
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

Contrato de transporte HTTP entre ACS y el microservicio externo Customer Service para `resolve_customer`, `create_customer` y `link_external_identity`. `record_customer_interest` no tiene transporte HTTP en `ACS-R1-04-T04.1` (solo tipos y policy - contrato de datos section 6).

Los outcomes de negocio que Customer Service decide explicitamente (`created`, `denied`, `conflict` de dominio, `no_match`, ...) viajan dentro del cuerpo de una respuesta `2xx` con su propio campo `status`. El codigo HTTP no `2xx` tambien es significativo, y no representa unicamente problemas de transporte: `400`/`422` senalan un request estructuralmente invalido (`invalid_input`) y `409` senala un conflicto detectado por Customer Service (`conflict`) - ambos son resultados de validacion/negocio expresados via el codigo HTTP en vez de un body `2xx`. Solo `408`/`429`/`502`/`503`/`504`, el timeout y el error de red son estrictamente problemas de transporte. Ver "Codigos HTTP -> outcome".

## Autenticacion

Header `x-api-key: <CUSTOMER_SERVICE_API_KEY>` en cada request. No se usa `Authorization: Bearer`.

## Timeout

`CUSTOMER_SERVICE_TIMEOUT_MS` (default `5000`). Un timeout aborta la request via `AbortController` y se reporta como `temporarily_unavailable` - nunca como excepcion sin capturar.

## Idempotencia

Las operaciones mutating (`create_customer`, `link_external_identity`) envian:

```http
Idempotency-Key: customer-service:create:<capabilityExecutionId>
Idempotency-Key: customer-service:link:<capabilityExecutionId>
```

La clave la genera `lib/domains/customer-service/service.ts` a partir de un `capabilityExecutionId` operacional - nunca un valor libre elegido por el agente o el LLM. El adapter solo transporta la clave ya generada; no la construye ni la valida.

## Ownership del retry

El adapter no reintenta. Es exactamente una llamada HTTP fisica por invocacion del port (igual que `lib/catalog/httpCatalogAdapter.ts`). El Capability Gateway es el unico propietario del retry cuando esta capability se registre en el (fuera de alcance de `T04.1`).

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
{ "status": "resolved", "customerMasterId": "123" }
{ "status": "no_match" }
{ "status": "conflict", "conflictCode": "multiple_candidates" }
```

No hay variante `failed` para esta operacion (contrato de datos, seccion 1): un `5xx` no clasificado se mapea a `temporarily_unavailable`, nunca se inventa un sexto status.

**v2.0.0 (breaking, ACS-R1-04-T08.1):** el campo se llama `customerMasterId`, no el `customerId` ambiguo de v1.0.0 - semantica obligatoria: identificador canonico compatible con `master_customer.id`. Ver [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md) seccion 1.1.

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

`idempotencyKey` viaja solo en el header, no se duplica en el body.

Respuesta `2xx`, cuerpo `status`:

```json
{ "status": "created", "customerMasterId": "999" }
{ "status": "matched_existing", "customerMasterId": "42" }
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
{ "status": "completed", "customerMasterId": "42", "externalIdentityId": "ext-1" }
{ "status": "already_linked", "customerMasterId": "42", "externalIdentityId": "ext-1" }
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

`fields` se usa para `400`/`422`. `conflictCode` se usa para `409`. `message` nunca se guarda en el resultado tipado - solo `code`/`fields`/`conflictCode`/`reason` (identificadores estables), y esos igual pasan por redaccion defensiva antes de devolverse (ver "Redaccion de PII").

## Codigos HTTP -> outcome

| HTTP | Outcome |
| --- | --- |
| `2xx` | outcome real segun `status` del body |
| `400` / `422` | `invalid_input` (`fields` desde el envelope) |
| `409` | `conflict` (`conflictCode` desde el envelope) |
| `408` / `429` / `502` / `503` / `504` | `temporarily_unavailable` (`retryable: true`) |
| otros `5xx` | `failed` (`create_customer` / `link_external_identity`); `temporarily_unavailable` para `resolve_customer` (no tiene variante `failed`) |
| timeout / error de red | `temporarily_unavailable` (`retryable: true`) |
| respuesta invalida (JSON invalido o forma inesperada en `2xx`) | `failed` (`create_customer` / `link_external_identity`); `temporarily_unavailable` `retryable:false` para `resolve_customer` |

Configuracion ausente (`CUSTOMER_SERVICE_BASE_URL` o `CUSTOMER_SERVICE_API_KEY` sin definir) nunca intenta una llamada HTTP: `createCustomerServicePort()` devuelve un port fail-closed que responde `temporarily_unavailable` en las tres operaciones. Nunca se interpreta como `no_match`.

## Validacion de `customerMasterId` (v2.0.0, ACS-R1-04-T08.1)

Una respuesta `2xx` que declara un status exitoso (`resolved`/`created`/`matched_existing`/`completed`/`already_linked`) pero:

- no incluye `customerMasterId`;
- incluye un `customerMasterId` vacio o de formato invalido (debe ser un entero positivo en string, compatible con `master_customer.id`);
- incluye simultaneamente un envelope `error` (campos incompatibles);

se rechaza en el adapter, fail-closed. Nunca se reinterpreta como `no_match`: se mapea a `temporarily_unavailable`/`failed` segun la operacion, igual que un payload malformado (ver "Codigos HTTP -> outcome"). El adapter valida forma; ACS ademas verifica, antes de completar onboarding, que ese `customerMasterId` corresponda a una fila real en `master_customer` local (`CustomerMasterProjectionReader`, `lib/domains/customer-service/customerMasterProjection.ts`) - ver [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md) seccion 1.1.

## Redaccion de PII

El adapter nunca incluye en el resultado tipado: `x-api-key`, header `Authorization`, el `message` crudo del envelope, emails completos ni telefonos completos. `code`/`fields`/`conflictCode`/`reason` pasan por una funcion de sanitizacion antes de devolverse, por si un upstream mal configurado los reutiliza para ecoar contexto sensible.

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
