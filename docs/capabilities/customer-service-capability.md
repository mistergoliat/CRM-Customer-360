---
title: Capability - Customer Service (create_customer, link_external_identity, record_customer_interest)
doc_id: capability-customer-service
status: approved
version: "1.3.0"
owner: product
last_reviewed: 2026-07-13
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
- Implementa: `lib/domains/customer-service` (port, policy, service), `lib/integrations/customer-service/http-adapter.ts`, `lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts` (registro y ejecucion en el Gateway), `lib/brain/commercial/native-cycle/customer-session` (orquestador de sesion pre-plan que invoca `resolve_customer`; `runCustomerOnboardingPostPlanStage.ts`, ACS-R1-04-T06.1, que ensambla y ejecuta `create_customer`/`link_external_identity`)
- Evidencia: [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)
- Reemplaza: none

## Proposito

Frontera tecnica de ACS hacia el microservicio externo Customer Service: `resolve_customer` (read-only), `create_customer` y `link_external_identity` como capabilities con efecto secundario, mas policy y tipos (sin persistencia) para `record_customer_interest`.

## Estado en ACS-R1-04-T06.1

```text
domain: implemented
port: implemented
http_adapter: implemented
policy: implemented
gateway: registered
runtime: connected
operational: not_verified
status: accepted_with_debt
```

`resolve_customer`, `create_customer` y `link_external_identity` estan registrados en el Capability Gateway (`CAPABILITY_GATEWAY_REGISTRY`) y conectados al inbound nativo, todas de forma deterministica - ninguna es una herramienta que el sales agent proponga. `resolve_customer` lo invoca `resolveNativeCustomerSession` (fase pre-plan, hasta una vez por turno). `create_customer`/`link_external_identity` los invoca `runCustomerOnboardingPostPlanStage` (fase post-plan, ACS-R1-04-T06.1, runtime legacy exclusivamente) - T06 los registraba tambien como herramientas del sales agent (`createCustomer`/`linkExternalIdentity` via el alias table), pero T06.1 elimino ese alias: una segunda via LLM-propuesta hacia la misma capability arriesgaba una ejecucion duplicada en el mismo turno (contrato seccion 20), asi que el post-plan stage quedo como el unico punto de decision. `operational: not_verified` porque las pruebas de T06/T06.1 corrieron contra un servidor HTTP local (mismo patron que T04.1), no contra un Customer Service real desplegado - no hay validacion end-to-end verificada todavia (`ACS-R1-04-T08`). El runtime multi-request recibe `customerSession` solo a nivel de tipos e input hash; no ejecuta estas capabilities (mismo patron de deuda que Customer 360 en T05, confirmado explicitamente por T06.1).

`record_customer_interest`:

```text
contract: implemented
policy: implemented
persistence: not_implemented
gateway: not_connected
runtime: not_connected
status: designed_partial
```

`record_customer_interest` sigue sin registrar en el Gateway y sin efecto operacional - T06 no le agrego un no-op ni le dio persistencia. Customer 360 sigue sin recibir escritura de ninguna de estas operaciones; su lectura ahora esta detras de una compuerta de acceso explicita (`contextAccess`, ver [ACS-R1-04-T05/T06](../releases/ACS-R1-04-customer-identity-onboarding.md)) que no depende de estas capabilities.

## Proyeccion local (ACS-R1-04-T08.1)

`resolve_customer`/`create_customer`/`link_external_identity` retornan `customerMasterId` en sus resultados exitosos (`resolved`/`created`/`matched_existing`/`completed`/`already_linked`) - el identificador canonico compatible con `master_customer.id`, nunca el `customerId` ambiguo de versiones anteriores. Antes de que cualquiera de las tres capabilities complete onboarding con ese `customerMasterId`, ACS verifica que exista la fila local correspondiente (`CustomerMasterProjectionReader`, solo lectura, `lib/domains/customer-service/customerMasterProjection.ts`; gate centralizado en `lib/brain/commercial/native-cycle/customer-session/onboardingTransitions.ts#completeOnboardingWithVerifiedCustomer`). Customer Service sigue siendo la unica autoridad de creacion/vinculacion; ACS no inserta ni actualiza `master_customer`.

Si Customer Service reporta exito (`businessOutcome`: `created`/`resolved`/`completed`) pero la proyeccion local aun no existe: el `gatewayStatus`/`businessOutcome` de la capability no cambian (la llamada si tuvo exito), pero ACS no completa onboarding con ese id, no vincula la conversacion, no carga Customer 360, y registra el warning estructurado `customer_master_projection_unavailable` (via los eventos T07 ya existentes). Un fallo al consultar la proyeccion local es fail-closed y usa el warning `customer_master_projection_check_failed`, distinto y sin reintentar Customer Service en el mismo turno. Ver [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md) seccion 1.1 y [customer-service-http-contract](../integrations/customer-service-http-contract.md) v2.0.0.

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

Esta tabla describe la autoridad conceptual (contrato seccion 9). El Capability Gateway ya tiene registradas las tres capabilities desde `T06` (`gateway: registered`), pero su campo `authority` es binario (`autonomous` | `requires_approval`, sobre aprobacion de operador) y no modela directamente `policy`/`requires_consent`; las tres quedaron registradas como `authority: autonomous` porque el gate real (policy o consentimiento explicito) corre dentro de `execute()`, no como aprobacion previa de un operador - ver el comentario inline en `customerIdentityCapabilities.ts`.

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
customer identity local resolution: implemented, runtime-connected (ACS-R1-04-T06, via resolveNativeCustomerSession)
external Customer Service port: implemented, runtime-connected (ACS-R1-04-T06, via the Capability Gateway)
```
