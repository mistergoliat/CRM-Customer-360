---
title: Capability - Customer Service (create_customer, link_external_identity, record_customer_interest)
doc_id: capability-customer-service
status: approved
version: "1.0.0"
owner: product
last_reviewed: 2026-07-09
source_of_truth_for:
  - Customer Service port capability contract
  - create_customer / link_external_identity / record_customer_interest authority
depends_on:
  - ../data/customer-creation-linking-authority-contract.md
  - ../data/customer-onboarding-identity-contract.md
  - ../integrations/customer-service-http-contract.md
  - ../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md
supersedes: []
tags:
  - capability
  - identity
  - authority
---
# Capability: Customer Service (create_customer, link_external_identity, record_customer_interest)

## Relaciones

- Gobernado por: [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md)
- Depende de: [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md), [Customer Service HTTP contract](../integrations/customer-service-http-contract.md), [ADR-006](../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md)
- Implementa: `lib/domains/customer-service` (port, policy, service), `lib/integrations/customer-service/http-adapter.ts`
- Evidencia: [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)
- Reemplaza: none

## Proposito

Frontera tecnica de ACS hacia el microservicio externo Customer Service: `resolve_customer` (read-only), `create_customer` y `link_external_identity` como capabilities con efecto secundario, mas policy y tipos (sin persistencia) para `record_customer_interest`.

## Estado en ACS-R1-04-T04.1

```text
domain: implemented
port: implemented
http_adapter: implemented
policy: implemented
gateway: not_connected
runtime: not_connected
operational: not_verified
status: implemented_partial
```

`record_customer_interest`:

```text
contract: implemented
policy: implemented
persistence: not_implemented
gateway: not_connected
runtime: not_connected
status: designed_partial
```

Ninguna de estas operaciones esta conectada al inbound nativo, al LLM, al Capability Gateway o a Customer 360. La conexion real es `ACS-R1-04-T06`.

## Entrada / Salida

Ver [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md) secciones 4-6 para los contratos conceptuales de datos, y [Customer Service HTTP contract](../integrations/customer-service-http-contract.md) para el transporte real.

## Autoridad

Las tres policies puras (`lib/domains/customer-service/authority-policy.ts`) devuelven un `AuthorityDecision` comun (`allowed | missing_information | denied | requires_consent | requires_human`). La IA nunca decide autoridad - solo propone; la policy evalua precondiciones sobre evidencia estructurada real (nunca sobre un booleano/string que la IA afirme).

- `create_customer`: exige proposito comercial valido (`quote`, `purchase`, `checkout`, `account_request`), evidencia real de `resolve_customer = no_match`, datos minimos (`firstName`, `email`, `phoneNumber`) y `consent.createCustomer`.
- `link_external_identity`: exige `customerId`, que el `wa_id` a vincular sea el mismo que el canal inbound verifico, `consent.granted` con `messageId`/`capturedAt`, y ausencia de conflicto conocido.
- `record_customer_interest`: distingue `operational_context` (siempre permitido, sin customer), `persistent_customer_interest` (exige `customerId` + `consent.storeInterest`) y `proactive_followup` (exige ademas `consent.allowFollowUp`, autorizacion separada de la de almacenamiento).

## Gobernanza (referencial, contrato seccion 9)

| Capability | Side effect | Authority | Risk |
| --- | --- | --- | --- |
| `resolve_customer` | read_only | autonomous | low |
| `create_customer` | mutating | policy | medium |
| `link_external_identity` | mutating | requires_consent | medium |
| `record_customer_interest` provisional | mutating | autonomous/policy | low |
| `record_customer_interest` con follow-up | mutating | requires_consent | medium |

Esta tabla es documental en `T04.1`: no hay registro real en el Capability Gateway (`gateway: not_connected`) hasta `T06`.

## Reglas

1. `create_customer` nunca ejecuta `link_external_identity` como efecto secundario.
2. `link_external_identity` es siempre una llamada posterior y separada.
3. Un timeout, fallo o ausencia de evidencia nunca equivale a `no_match`.
4. El `idempotencyKey` lo genera la service layer (`customer-service:<op>:<capabilityExecutionId>`) - la API publica que usaria el agente no permite elegirlo.
5. El adapter HTTP es fail-closed: sin configuracion, responde `temporarily_unavailable`, nunca `no_match`.
6. Sin fallback hacia `master_customer`, PrestaShop, SAP, POS o `customer_external_identity`.
7. `record_customer_interest` no crea customers ni programa follow-ups en `T04.1`.

## Relacion con T02

`lib/domains/customer-identity` (T02/T02.1) sigue siendo la resolucion de sesion local y provisional, sin cambios en `T04.1`. No hay dual-read ni fallback entre ese resolver y este port. Ver [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md).

```text
customer identity local resolution: implemented, not runtime-connected
external Customer Service port: implemented, not runtime-connected
```
