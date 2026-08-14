---
title: CP-R1-T11H - CRM / Sales Agent RFM Consumption Adapter
doc_id: cp-r1-t11h-crm-sales-agent-rfm-consumption-adapter
status: implemented_pending_full_suite
tags:
  - release
  - customer-profile
  - sales-agent
  - rfm
---

# CP-R1-T11H - CRM / Sales Agent RFM Consumption Adapter

Fecha de implementacion: 2026-08-14.

## 1. Objetivo

Consumir en `CRM-Customer-360` el endpoint de Customer Profile
`GET /v1/customers/:masterCustomerId/rfm` como evidencia interna del Sales
Agent, usando el cliente nuevo `lib/integrations/customer-profile/*`,
manteniendo el comportamiento fail-open y sin convertir RFM en una policy
comercial automatica.

## 2. Estado previo

Antes de T11H ya existian:

- el cliente HTTP tipado de Customer Profile en
  `lib/integrations/customer-profile/*` (T12B);
- el wiring del contexto comercial de historial de compras en
  `lib/brain/commercial/customer-profile-context/*` (T12C);
- la policy comercial basada en historial de compras, pero sin consumo de RFM
  runtime (T12D).

No existia aun:

- metodo `getRfm(...)` en el cliente compartido;
- normalizacion interna de un bloque `customerRfm`;
- wiring desde `trustedCustomerSession.masterCustomerIdentity`;
- reglas de prompt especificas para RFM;
- taxonomia interna para `no_customer`, `no_rfm`, `rfm_degraded`,
  `provider_error`.

## 3. Auditoria inicial

Se revisaron antes de editar:

- `lib/integrations/customer-profile/http-client.ts`
- `lib/integrations/customer-profile/types.ts`
- `lib/integrations/customer-profile/schemas.ts`
- `lib/brain/commercial/capabilities/customer-profile/*`
- `lib/brain/commercial/customer-profile-context/*`
- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`
- `tests/customer-profile-client/*`
- `tests/customer-profile-context/*`
- `tests/agent-loop/*`

Hallazgos:

- el adapter correcto para extender era el cliente nuevo
  `lib/integrations/customer-profile/*`;
- `lib/customer-profile/*` sigue existiendo, pero es legacy y no debia
  reutilizarse;
- el runtime ya tenia identidad canonica separada en
  `trustedCustomerSession.masterCustomerIdentity`;
- el contexto comercial de T12C era el punto correcto para hospedar RFM como
  evidencia, no como una model tool nueva;
- el prompt ya recibia `commercialContextSummary`, por lo que el bloque RFM
  podia entrar como payload compacto y acotado.

## 4. Decision arquitectonica

Se aplico una extension incremental del cliente compartido y del contexto
comercial:

```text
Customer Profile HTTP client
  -> getRfm(masterCustomerId)
  -> CustomerRfmResult (discriminated union)
  -> customer-profile capability wrapper
  -> customer-profile-context loader
  -> agent loop commercialContextSummary.customerRfm
  -> prompt rules / fail-open consumption
```

Decisiones explicitas:

- se reutiliza `CUSTOMER_PROFILE_BASE_URL`;
- no se agregan retries nuevos;
- se conserva timeout corto del cliente existente;
- no hay fallback de `masterCustomerId` desde `identity.customerId`;
- no se usa `lib/customer-profile/*`;
- RFM solo informa, nunca altera ranking, descuentos, promociones o handoff.

## 5. Contrato y taxonomia

Se agrego `getRfm(input)` al cliente compartido con contrato cerrado:

- `AVAILABLE`
- `NOT_FOUND`
- `INVALID_REQUEST`
- `UNAVAILABLE`
- `CONTRACT_ERROR`

Taxonomia normalizada en el runtime comercial:

- `AVAILABLE`
- `NO_CUSTOMER`
- `NO_RFM`
- `RFM_DEGRADED`
- `PROVIDER_ERROR`

Mapeo principal:

- `404 customer_not_found` -> `NO_CUSTOMER`
- `404 rfm_not_available` -> `NO_RFM`
- `503 no_published_rfm_snapshot` -> `RFM_DEGRADED`
- timeout / 429 / 5xx / network -> `PROVIDER_ERROR`
- contrato invalido / masterCustomerId mismatch -> `PROVIDER_ERROR`

## 6. Implementacion

### 6.1 Cliente HTTP

`lib/integrations/customer-profile/*` ahora soporta:

- validacion estricta de `masterCustomerId`;
- parseo estricto del contrato `customer-rfm-runtime-v1`;
- observabilidad propia `event = customer_rfm_lookup`;
- rechazo de payloads con campos inesperados o
  `MASTER_CUSTOMER_ID_MISMATCH`.

### 6.2 Capability y contexto comercial

`lib/brain/commercial/capabilities/customer-profile/*` expone `getRfm(...)`
como wrapper fino.

`lib/brain/commercial/customer-profile-context/*` ahora:

- agrega `customerRfm: CustomerRfmContext | null`;
- carga `getCommercialSummary(...)` y `getRfm(...)` en paralelo;
- usa `masterCustomerId` solo cuando la identidad canonica esta resuelta;
- mantiene el contexto `AVAILABLE` cuando no hay fila RFM;
- degrada a `PARTIAL` ante `RFM_DEGRADED` o error de proveedor;
- conserva `monetarySegmentAvailable=true` solo si RFM esta disponible y el
  segmento no es nulo.

### 6.3 Agent loop y prompt

`runNativeAgentToolLoopCycle.ts` ahora:

- pasa `masterCustomerId` al loader del contexto comercial;
- extrae ese id solo desde `trustedCustomerSession.masterCustomerIdentity`;
- incluye `customerRfm` en `commercialContextSummary` cuando existe;
- loguea `rfmLookupStatus`, `rfmContractVersion` y `rfmSegmentVersion`.

`buildAgentStepPromptPackage.ts` ahora agrega guard rails explicitos:

- usar `customerRfm` solo como evidencia de apoyo;
- no exponer nombres internos de segmento como policy customer-facing;
- no inferir facts RFM si el estado no es `AVAILABLE`;
- no generar descuentos, promociones o follow-up rules desde RFM;
- continuar el turno si RFM esta ausente o degradado.

## 7. Tests

Cobertura agregada o ajustada:

- `tests/customer-profile-client/customerProfileSchemas.test.ts`
- `tests/customer-profile-client/customerProfileCapabilities.test.ts`
- `tests/customer-profile-client/httpCustomerProfileClient.test.ts`
- `tests/customer-profile-context/customerProfileContextLoader.test.ts`
- `tests/customer-profile-context/customerHistoryCommercialSignals.test.ts`
- `tests/agent-loop/customerProfilePromptContext.test.ts`
- `tests/agent-loop/runNativeAgentToolLoopCycleCustomerProfile.test.ts`
- `tests/agent-loop/customerHistoryCommercialPolicyAgentLoop.test.ts`

Casos nuevos relevantes:

- parseo exitoso del contrato RFM, incluyendo `segment = null`;
- rechazo de `masterCustomerId` mismatch;
- mapeo de `customer_not_found`, `rfm_not_available` y `no_published_rfm_snapshot`;
- logging seguro del adapter RFM;
- loader fail-open para `NO_RFM`, `RFM_DEGRADED` y `PROVIDER_ERROR`;
- forwarding de `masterCustomerId` resuelto al loader;
- prueba explicita de no-fallback desde `customerId`.

## 8. Validacion ejecutada

Ejecutado el 2026-08-14:

- `npm run typecheck` -> ok
- `npm run lint` -> ok con warnings preexistentes fuera de T11H
- `npm test` -> el script ya corre en Windows tras agregar
  `scripts/run-tests.ts`, pero la suite completa sigue con 12 fallos ajenos a
  T11H
- subset T11H:
  `npx --yes tsx@4.20.5 --test tests/customer-profile-client/customerProfileSchemas.test.ts tests/customer-profile-client/customerProfileCapabilities.test.ts tests/customer-profile-client/httpCustomerProfileClient.test.ts tests/customer-profile-context/customerProfileContextLoader.test.ts tests/customer-profile-context/customerHistoryCommercialSignals.test.ts tests/agent-loop/customerProfilePromptContext.test.ts tests/agent-loop/runNativeAgentToolLoopCycleCustomerProfile.test.ts tests/agent-loop/customerHistoryCommercialPolicyAgentLoop.test.ts`
  -> ok, `90/90`

Fallos ajenos observados en `npm test` completo:

- `tests/agent-loop/benchmark/offlineHarnessEndToEnd.test.ts`
- `tests/agent-loop/multi-intent/runCommercialMultiIntentLoop.test.ts`
- `tests/agent-loop/pendingCatalogAction.test.ts`

Esos fallos caen en benchmark, multi-intent y pending action persistence,
coincidiendo con trabajo no relacionado ya presente en el arbol del repo.

## 9. Archivos modificados

Principales archivos tocados:

- `lib/integrations/customer-profile/types.ts`
- `lib/integrations/customer-profile/schemas.ts`
- `lib/integrations/customer-profile/http-client.ts`
- `lib/integrations/customer-profile/index.ts`
- `lib/brain/commercial/capabilities/customer-profile/types.ts`
- `lib/brain/commercial/capabilities/customer-profile/customerProfileCapabilities.ts`
- `lib/brain/commercial/customer-profile-context/types.ts`
- `lib/brain/commercial/customer-profile-context/loader.ts`
- `lib/brain/commercial/customer-profile-context/summary.ts`
- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`
- `tests/customer-profile-client/*`
- `tests/customer-profile-context/*`
- `tests/agent-loop/customerProfilePromptContext.test.ts`
- `tests/agent-loop/runNativeAgentToolLoopCycleCustomerProfile.test.ts`
- `tests/agent-loop/customerHistoryCommercialPolicyAgentLoop.test.ts`
- `package.json`
- `scripts/run-tests.ts`

## 10. Riesgos y deuda restante

- la suite completa del repo sigue condicionada por fallos ajenos a T11H;
- `customerRfm` hoy solo vive como evidencia interna; no existe aun contrato
  HTTP/CRM externo para consultarlo fuera del Sales Agent;
- el estado `PROVIDER_ERROR` agrupa timeout, indisponibilidad y contrato
  invalido para mantener fail-open; si en el futuro se necesitan decisiones
  operativas distintas, la taxonomia podria abrirse mas;
- el repo sigue conviviendo con adapters legacy `lib/customer-profile/*`,
  aunque T11H no los toca ni los reutiliza.

## 11. Veredicto

`CRM_SALES_AGENT_RFM_CONSUMPTION_ADAPTER_IMPLEMENTED`

Condiciones cumplidas:

- cliente RFM compartido agregado
- wiring por `masterCustomerId` canonico
- fail-open mantenido
- sin fallback desde `customerId`
- sin reglas comerciales basadas en segmento
- sin cambios de ranking o promociones
- tests del scope T11H en verde

## 12. Siguiente tarea

Continuar con la exposicion controlada/consumo operacional del bloque RFM
solo despues de estabilizar la suite ajena del repo y definir si el siguiente
paso es un consumer adicional del CRM o rollout operacional del Sales Agent.
