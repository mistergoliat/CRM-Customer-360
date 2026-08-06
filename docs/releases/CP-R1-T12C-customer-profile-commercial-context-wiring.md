---
title: CP-R1-T12C - Customer Profile Commercial Context Wiring
doc_id: cp-r1-t12c-customer-profile-commercial-context-wiring
status: implemented_pending_full_suite
tags:
  - release
  - customer-profile
  - commercial
  - runtime
---

# CP-R1-T12C - Customer Profile Commercial Context Wiring

Fecha de implementacion: 2026-08-05.

## 1. Objetivo

Conectar el cliente/product capability de `CP-R1-T12B` al runtime comercial de
`CRM-Customer-360` como contexto de apoyo para recomendaciones y continuidad
comercial, sin crear model tools nuevos, sin tocar el adapter legacy
`lib/customer-profile/*`, sin introducir RFM runtime y sin alterar el ranking
de Catalog por historial de compra.

## 2. Estado previo

Antes de T12C ya existian:

- el cliente nuevo directo por `customerId = ps_customer.id_customer` en
  `lib/integrations/customer-profile/*`;
- la capability interna en
  `lib/brain/commercial/capabilities/customer-profile/*`;
- el runtime comercial nativo y el agent loop en
  `lib/brain/commercial/agent-loop/*`.

El loop aun no consumia el nuevo Customer Profile. El repo tambien seguia
conviviendo con el adapter legacy `lib/customer-profile/*`, usado por el flujo
anterior de recommendation context.

## 3. Auditoria inicial

Se audito antes de editar:

- `lib/brain/commercial/agent-loop/*`
- `lib/brain/commercial/context/*`
- `lib/brain/commercial/recommendation-context/*`
- `lib/brain/commercial/capabilities/*`
- `lib/customer-profile/*`
- `lib/integrations/customer-profile/*`
- `tests/agent-loop/*`
- `tests/commercial/*`
- `.env.example`

Hallazgos:

- el mejor punto de wiring real era
  `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`;
- ya existia un patron fail-open reusable en
  `lib/brain/commercial/context/loadAutonomousCustomerContext.ts`;
- el `customerId` confiable para este wiring ya estaba disponible via
  `trustedCustomerSession.identity.customerId`;
- el prompt ya recibia `commercialContextSummary`, por lo que el lugar correcto
  para inyectar historial era el payload compacto de contexto, no una tool
  nueva;
- `lib/customer-profile/*` y el recommendation context legacy siguen activos,
  por lo que debian quedar intactos;
- no habia que tocar el ajuste previo de RFM/Monetary hecho en este repo.

### Matriz inicial

| CAPABILITY | CURRENT IMPLEMENTATION | INPUT | OUTPUT | CURRENT LOOP POSITION | REUSABLE | CONFLICT | TARGET WIRING | CHANGE REQUIRED |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Customer Profile HTTP direct | `lib/integrations/customer-profile/*` | `customerId`, requestId, limits | resultado discriminado por endpoint | fuera del loop | si, cliente T12B | no model-facing aun | capability interna del runtime | wiring |
| Customer Profile capability | `lib/brain/commercial/capabilities/customer-profile/*` | llamadas internas | wrapper estable | fuera del loop | si | no registrada en gateway | usar solo desde loop nativo | wiring |
| Legacy customer profile | `lib/customer-profile/*` | `masterCustomerId` | contexto legacy | recommendation-context legacy | no para T12C | identidad/contrato distinto | no usar | guard rail |
| Commercial agent loop | `runNativeAgentToolLoopCycle.ts` -> `runAgentToolLoop.ts` | snapshot, session, catalog continuity | prompt + decision loop | antes del prompt | si | ninguno | cargar contexto antes del prompt | cambio |
| Prompt payload | `buildAgentStepPromptPackage.ts` | `commercialContextSummary` | JSON user payload | ultimo paso previo al modelo | si | ninguna tool nueva | summary compacto + reglas | cambio |

## 4. Punto de wiring

El wiring productivo se implemento en:

- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`

Motivo:

- ahi ya confluyen `snapshot`, `trustedCustomerSession`,
  `recentCatalogContext`, `pendingCatalogAction` y `correlationId`;
- es el ultimo punto deterministico antes de construir
  `commercialContextSummary`;
- permite cargar contexto solo para el runtime nativo real, sin tocar el
  gateway de model tools ni el loop legacy.

## 5. Contrato comercial

Se agrego el dominio puro:

- `lib/brain/commercial/customer-profile-context/types.ts`
- `lib/brain/commercial/customer-profile-context/config.ts`
- `lib/brain/commercial/customer-profile-context/policy.ts`
- `lib/brain/commercial/customer-profile-context/loader.ts`
- `lib/brain/commercial/customer-profile-context/summary.ts`
- `lib/brain/commercial/customer-profile-context/compareRecommendationsWithPurchaseHistory.ts`

Estado canonico expuesto al runtime:

- `AVAILABLE`
- `PARTIAL`
- `NOT_FOUND`
- `UNAVAILABLE`
- `CONTRACT_ERROR`
- `IDENTITY_UNAVAILABLE`
- `DISABLED`

Capacidades posibles del contexto:

- `commercial-summary`
- `purchased-products`
- `purchase-behavior`
- `profile`

## 6. Politica de carga

Se implemento una politica conservadora en
`lib/brain/commercial/customer-profile-context/policy.ts`.

Reglas:

- si existe `pendingCatalogAction`, se marca
  `CATALOG_RESULT_REQUIRES_HISTORY_CHECK`;
- si existe `recentCatalogContext`, se marca
  `CATALOG_RESULT_REQUIRES_HISTORY_CHECK`;
- ciertas etapas/intenciones/acciones comerciales orientadas a producto
  activan `PRODUCT_RECOMMENDATION` o `PRODUCT_SEARCH`;
- `needProfile` con caso de uso, features o presupuesto tambien activa
  `PRODUCT_SEARCH`;
- no se usa clasificacion libre del modelo ni se crea una tool de decision
  adicional para decidir la carga.

## 7. Loader

El loader principal es:

- `loadCustomerCommercialHistoryContext(...)`

Comportamiento:

- si `CUSTOMER_PROFILE_CONTEXT_ENABLED=false`, retorna `DISABLED`;
- si no hay `customerId` confiable o no hay `commercialIntent`, retorna
  `IDENTITY_UNAVAILABLE`;
- siempre intenta primero `getCommercialSummary(...)`;
- solo si la politica lo requiere, carga en paralelo:
  `getPurchasedProducts(...)` y `getPurchaseBehavior(...)`;
- solo si la politica lo requiere, carga `getProfile(...)` para `recentOrders`;
- usa `Promise.allSettled(...)` para segundarias y degrada a `PARTIAL` cuando
  el resumen esta disponible pero alguna carga secundaria falla.

Mapeo de restricciones de negocio:

- `rfmAvailable=false`
- `monetarySegmentAvailable=false`
- `mayAlterCatalogRanking=false`
- `mayAutoExcludePurchasedProducts=false`

## 8. Contexto del modelo

El prompt no recibe payloads crudos de Customer Profile. En su lugar se
inyecta un resumen compacto dentro de `commercialContextSummary`:

- `commercialContext.customerPurchaseHistory`

Se incluyen solo campos utiles para el turno:

- `status`
- `reasonCodes`
- `constraints`
- `source`
- `contractVersion`
- `generatedAt`
- `summary`
- `recentOrders`
- `purchasedProducts`
- `purchaseBehavior`
- `recommendationHistoryMatches`

Campos vacios se omiten para mantener el prompt compacto.

## 9. Restricciones del modelo

Se agregaron reglas explicitas en
`lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` para las dos
fases del loop.

Invariantes:

- usar historial solo como evidencia de apoyo;
- se puede mencionar compra previa relevante o complementariedad;
- prohibido inferir RFM, segmento, poder adquisitivo, VIP o lifetime value;
- `historicalPurchaseValueTaxIncl` es informativo, no score;
- prohibido auto excluir o auto boostear productos comprados;
- prohibido alterar ranking de Catalog solo por historial;
- si el estado no es `AVAILABLE` o `PARTIAL`, no afirmar hechos historicos.

## 10. Cruce con Catalog

Se agrego un helper deterministico:

- `compareRecommendationsWithPurchaseHistory(...)`

Y un ensamblado de candidatos desde:

- `recentCatalogContext`
- `pendingCatalogAction`

Estados comparados:

- `NOT_PREVIOUSLY_PURCHASED`
- `SAME_PRODUCT_PREVIOUSLY_PURCHASED`
- `SAME_VARIANT_PREVIOUSLY_PURCHASED`
- `PRODUCT_MATCH_VARIANT_UNKNOWN`
- `HISTORY_UNAVAILABLE`

Este cruce solo agrega evidencia estructurada. No reordena Catalog ni elimina
productos por si mismo.

## 11. Fail-open

T12C se implemento como fail-open para no bloquear el runtime comercial.

Si el wiring falla:

- el loop sigue corriendo;
- el contexto cae a `UNAVAILABLE`, `PARTIAL`, `NOT_FOUND`,
  `IDENTITY_UNAVAILABLE` o `DISABLED` segun corresponda;
- el modelo recibe solo un resumen neutral del estado, nunca una excepcion;
- la ausencia de Customer Profile no provoca handoff automatico.

## 12. Configuracion

Variables agregadas en `.env.example`:

- `CUSTOMER_PROFILE_CONTEXT_ENABLED=false`
- `CUSTOMER_PROFILE_PURCHASED_PRODUCTS_LIMIT=20`
- `CUSTOMER_PROFILE_TOP_PRODUCTS_LIMIT=5`
- `CUSTOMER_PROFILE_TOP_VARIANTS_LIMIT=5`
- `CUSTOMER_PROFILE_RECENT_PURCHASES_LIMIT=5`

Reglas:

- el flag de contexto queda `false` por defecto;
- los limites se clamp-ean localmente;
- la activacion del contexto no sustituye el flag base
  `CUSTOMER_PROFILE_ENABLED`.

## 13. Observabilidad

Se agrega logging estructurado por carga:

- `event = customer_profile_context_loaded`
- `customerProfileContextStatus`
- `customerId`
- `requestedCapabilities`
- `loadedCapabilities`
- `failedCapabilities`
- `reasonCodes`
- `durationMs`
- `contractVersion`
- `historyItemCount`
- `recommendationMatchCount`
- `requestId`

No se loguean payloads completos ni PII adicional fuera del `customerId`
interno ya usado por el runtime.

## 14. Seguridad

Decisiones de seguridad:

- no se crean model tools nuevas;
- el historial entra solo como contexto resumido y controlado;
- no se usa `lib/customer-profile/*`;
- no se reexpone RFM ni segmentos monetarios;
- no se inventan compras cuando el contexto no esta disponible;
- no se altera el fix previo de RFM/Monetary del repo.

## 15. Tests

Archivos nuevos:

- `tests/customer-profile-context/customerProfileContextLoader.test.ts`
- `tests/customer-profile-context/customerProfileContextPolicy.test.ts`
- `tests/customer-profile-context/customerProfileCatalogComparison.test.ts`
- `tests/agent-loop/customerProfilePromptContext.test.ts`
- `tests/agent-loop/runNativeAgentToolLoopCycleCustomerProfile.test.ts`
- `tests/commercial/customerProfileLegacyImportGuard.test.ts`

Cobertura:

- disabled / identity unavailable / not found / unavailable / contract error;
- carga selectiva y parcial;
- limites configurables;
- profile opcional para recent orders;
- reglas de prompt en gathering y finalization;
- inyeccion del contexto compacto antes de invocar el modelo;
- guard rail para impedir imports desde `lib/customer-profile/*`.

## 16. Smoke test

Validaciones ejecutadas el 2026-08-05:

- `npx --yes tsx@4.20.5 --test "tests/customer-profile-context/**/*.test.ts" "tests/agent-loop/customerProfilePromptContext.test.ts" "tests/agent-loop/runNativeAgentToolLoopCycleCustomerProfile.test.ts" "tests/commercial/customerProfileLegacyImportGuard.test.ts"` -> ok, `18/18`
- `npm run typecheck` -> ok

Las validaciones restantes del repo quedan sujetas al baseline global del
proyecto y a dependencias externas del entorno.

## 17. Riesgos

- el repo sigue conviviendo con la ruta legacy `lib/customer-profile/*`; T12C
  la protege pero no la elimina;
- la politica de carga es deliberadamente conservadora y hoy no usa heuristica
  sobre `customerMessage`;
- la suite completa del repo puede seguir condicionada por servicios externos
  ajenos a T12C;
- el logging estructurado del contexto agrega observabilidad, pero puede
  requerir afinacion futura si se masifica el volumen.

## 18. Veredicto

`COMMERCIAL_CONTEXT_VALIDATED_WITH_RUNTIME_FLAG_REQUIRED`

Condiciones cumplidas:

- `CUSTOMER_PROFILE_CONTEXT_RUNTIME_WIRED`
- `SELECTIVE_LOADING_ACTIVE`
- `PROMPT_CONTEXT_COMPACT`
- `FAIL_OPEN_ACTIVE`
- `NO_NEW_MODEL_TOOLS`
- `LEGACY_IMPORTS_BLOCKED`
- `RFM_NOT_EXPOSED`
- `CATALOG_RANKING_NOT_MODIFIED`

## 19. Siguiente tarea

Activar el contexto primero en shadow o entorno controlado y observar el evento
`customer_profile_context_loaded` antes de habilitar
`CUSTOMER_PROFILE_CONTEXT_ENABLED=true` en un runtime productivo.
