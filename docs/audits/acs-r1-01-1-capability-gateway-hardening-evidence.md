---
title: ACS-R1-01.1 Capability Gateway Hardening Evidence
doc_id: audit-acs-r1-01-1-capability-gateway-hardening-evidence
status: historical
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
audited_at: 2026-07-08
immutable_snapshot: true
source_of_truth_for:
  - historical capability gateway hardening evidence
depends_on:
  - audits/acs-r1-01-capability-gateway-evidence
supersedes: []
tags:
  - audit
  - historical
---

# ACS-R1-01.1 - Capability Gateway Hardening - Evidencia de termino

Sigue a [[audits/acs-r1-01-capability-gateway-evidence]] (ACS-R1-01, base). No reconstruye ese incremento; cierra deuda puntual identificada sobre el mismo codigo.

Fecha: 2026-07-08. Rama: `develop`.

## 1. Diff resumido

**Modificados:**
- `lib/catalog/httpCatalogAdapter.ts` - elimina el retry interno (`requestWithRetry` -> `requestOnce`); una sola llamada HTTP fisica por invocacion.
- `lib/brain/commercial/capability-gateway/types.ts` - agrega `CapabilityGovernanceMetadata` (`sideEffect`, `authority`, `riskClass`) y el campo `governance` en `CapabilityGatewayDefinition`.
- `lib/brain/commercial/capability-gateway/registry.ts` - ambas capabilities declaran `governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" }`; agrega `resolveCapabilityGovernance(capability)`.
- `lib/brain/commercial/capability-gateway/index.ts` - exporta `resolveCapabilityGovernance` y el alias table.
- `lib/brain/commercial/policy/evaluateCommercialToolRequests.ts` - `resolveEffectiveBlocking(tool, reportedBlocking)`: para un tool mapeado a una capability registrada, la aprobacion se deriva de `governance.authority`, nunca de `toolRequest.blocking`. Tools sin alias (`searchKnowledge`, etc.) mantienen el comportamiento previo exacto (test de regresion incluido).
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` - `NATIVE_CYCLE_ALLOWED_CAPABILITIES` ahora se deriva de `listAliasedSalesAgentToolNames()` (antes: literal `["searchProducts"]`); Fase 3.5 usa `runCapabilityExecutionStage` + `buildCatalogGroundedMessage` en vez de la funcion especifica de un solo tool.
- `.env.example` - aclara que `BRAIN_SALES_AGENT_DRY_RUN=true` no es una compuerta de seguridad de envio; agrega `CATALOG_SERVICE_*` (ya existian desde ACS-R1-01) y nota de subordinacion de multi-request.
- `docs/ACTIVE_RELEASE.md`, `docs/CAPABILITY_MATRIX.md` - actualizados de forma aditiva (sin cambiar release/tarea activa de `ACS-R1-04`, que pertenece a otro incremento en curso).

**Nuevos (productivo):**
- `lib/brain/commercial/capability-gateway/toolAliases.ts` - unico punto de traduccion `SalesAgentToolName` (camelCase) -> capability name (snake_case).
- `lib/brain/commercial/native-cycle/runCapabilityExecutionStage.ts` - etapa generica: itera tool requests sobrevivientes, resuelve alias, ejecuta cualquier capability registrada. No requiere una funcion nueva por tool.
- `lib/brain/commercial/native-cycle/buildCatalogGroundedMessage.ts` - projector especifico de catalogo (permitido por el objetivo 5): busca la ejecucion de `search_products` entre las genericas, selecciona el mejor match con un ranker deterministico, llama `get_product_details` sobre ese unico resultado, construye el mensaje grounded.
- `lib/brain/commercial/native-cycle/rankCatalogSearchResults.ts` - ranker deterministico y auditado (`matchType` -> `availability` -> orden original estable). Reemplaza la seleccion implicita de "primer resultado".
- `scripts/manual-test/catalog-service-smoke.ts` - smoke test real (ver seccion 5).

**Eliminado:** `lib/brain/commercial/native-cycle/runCatalogCapabilityStage.ts` (version original, un solo tool hardcodeado) - reemplazado por los tres archivos genericos de arriba. *(Nota: un archivo con el mismo nombre volvio a aparecer en el arbol de trabajo como wrapper de conveniencia sobre las piezas nuevas, creado por una sesion concurrente de Codex trabajando en `ACS-R1-04`; no se usa desde `runNativeAutonomousCycle.ts` y no fue tocado por este incremento.)*

**Nuevos (tests):**
- `tests/commercial/capabilityGatewayHardening.test.ts` - 9 tests: derivacion de aprobacion por governance (search_products con `blocking:true` ya NO escala; `blocking:false` da el mismo resultado; un tool no mapeado (`searchKnowledge`) preserva el comportamiento legado), metadata de gobierno presente y correcta, alias table centralizada, ranker (orden por matchType, por availability, estabilidad, `selectBestCatalogMatch`).
- `tests/native/catalogConversationFlow.test.ts` - prueba integrada de 5 turnos (seccion 4).
- Actualizaciones en `tests/catalog/httpCatalogAdapter.test.ts` y `tests/commercial/capabilityGateway.test.ts` para reflejar la llamada unica (seccion 2).

## 2. Objetivo 1 - Retry unico, cantidad exacta de llamadas verificada por test

**Antes:** el adapter reintentaba internamente (hasta 2 llamadas fisicas) y el Capability Gateway reintentaba por encima (hasta 2 llamadas a `definition.execute`), multiplicando hasta 4 llamadas HTTP reales por una sola invocacion logica.

**Ahora:** `httpCatalogAdapter.ts` hace exactamente una llamada HTTP por invocacion (`requestOnce`, sin loop). El Capability Gateway (`executeCapability.ts`) es el unico propietario del retry (`definition.maxRetries`, hoy `1` para ambas capabilities).

**Verificado por test** (conteo exacto de llamadas HTTP):

| Escenario | Llamadas fisicas esperadas | Test |
| --- | --- | --- |
| 500 persistente, sin retry en el adapter | `1` | `tests/catalog/httpCatalogAdapter.test.ts` - "a single 5xx never triggers an adapter-level retry" |
| Dos invocaciones independientes del port | `2` (una por invocacion, nunca mas) | `tests/catalog/httpCatalogAdapter.test.ts` - "two consecutive calls to the port are two physical HTTP calls, never more" |
| Gateway: 1 fallo retryable + 1 retry exitoso | `2` (nunca `3` o `4`) | `tests/commercial/capabilityGateway.test.ts` - "a retryable failure is retried exactly once at the capability level - the adapter never retries on its own" |

## 3. Objetivo 2 - Flags productivas y contradiccion de dry-run

**`runCommercialShadowEvaluation` - shadow real o pieza productiva con nombre historico:** es una **pieza productiva con nombre historico**, no un shadow real. Evidencia: su resultado (`governedResult`, `policyResult`) alimenta directamente `runCommercialOperationalLoop` (Fase 3) y de ahi `runCommercialExecutionBridge` (Fase 4), que escribe `crm_agent_actions` y `brain_message_outbox` reales, enviados por el worker a Meta. El nombre "shadow" viene de una etapa anterior del proyecto donde esta evaluacion corria en paralelo a un motor n8n como observacion; hoy es la unica fuente de decision del ciclo canonico. Renombrar la funcion es un cambio de mayor alcance (toca decenas de archivos/tests) y queda fuera de este incremento - documentado como deuda (seccion 6).

**Contradiccion de `BRAIN_SALES_AGENT_DRY_RUN=true`:** el flag NO es una compuerta de seguridad de envio. `runSalesAgentDryRun.ts` pasa `dryRun` como metadato al provider (`options.dryRun`) pero SIEMPRE ejecuta el pipeline completo con el resultado devuelto - si `dryRun=true`, `shouldUseHttpProvider()` (en `runCommercialShadowEvaluation.ts`) exige `dryRun === false` para usar el proveedor HTTP real, por lo que cae a `createFakeSalesAgentProvider({behavior:"valid"})` (texto canonico fijo). Ese resultado fake sigue fluyendo a loop -> bridge -> outbox -> Meta si esos flags estan en `true`. Es decir: `dry_run=true` cambia *que LLM genera el texto*, no *si el sistema envia*. Se corrigio la documentacion (`.env.example`, este audit) para que quede inequivoco; no se cambio el comportamiento en codigo porque `commercialCycleConfig.ts` es compartido con `processInbound.ts` (legacy) y anadir un gate cruzado dry-run -> bridge tiene radio de impacto fuera del Capability Gateway (deuda, seccion 6).

**Configuracion productiva exacta recomendada:**

```
# Sales agent real (LLM real, no canned)
BRAIN_SALES_AGENT_ENABLED=true
BRAIN_SALES_AGENT_DRY_RUN=false
BRAIN_ENABLE_REAL_MODEL=true

# Ciclo comercial completo
BRAIN_COMMERCIAL_SHADOW_ENABLED=true
BRAIN_COMMERCIAL_RUNTIME_ENABLED=true
BRAIN_COMMERCIAL_POLICY_ENABLED=true
BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER=true
BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED=true
BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED=true
BRAIN_AGENT_ACTION_QUEUE_ENABLED=true
BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED=true
BRAIN_EXECUTION_GATE_ENABLED=true
BRAIN_OUTBOX_BRIDGE_ENABLED=true
BRAIN_AUTONOMOUS_SANDBOX_ENABLED=true
BRAIN_AUTONOMOUS_REPLY_ENABLED=true

# Envio real
BRAIN_META_SEND_ENABLED=true
BRAIN_OUTBOX_WORKER_ENABLED=true
BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND=true
BRAIN_PERSIST_CANONICAL_OUTBOUND=true

# Capability Gateway v1 (catalogo real)
CATALOG_SERVICE_BASE_URL=<url del microservicio>
CATALOG_SERVICE_API_KEY=<api key>
CATALOG_SERVICE_TIMEOUT_MS=5000

# Runtimes que deben permanecer apagados
BRAIN_MULTI_REQUEST_RUNTIME_ENABLED=false
```

`BRAIN_WHATSAPP_ALLOWED_WA_IDS` / `BRAIN_AUTONOMOUS_TEST_WA_IDS` deben quedar vacios en produccion real (piloto controlado: usar solo `BRAIN_AUTONOMOUS_TEST_WA_IDS` con los numeros del piloto).

## 4. Objetivo 3 y 4 - Governance por capability, no `blocking` del LLM; nombres canonicos centralizados

`CapabilityGatewayDefinition.governance` (`sideEffect: read_only|mutating`, `authority: autonomous|requires_approval`, `riskClass: low|medium|high`) es dato de backend, nunca inferido del output del LLM. `search_products` y `get_product_details` declaran `read_only` / `autonomous` / `low`.

`evaluateCommercialToolRequests.ts#resolveEffectiveBlocking` resuelve el nombre canonico del tool via `toolAliases.ts` y, si existe metadata de gobernanza para esa capability, la usa para decidir si requiere aprobacion - **ignorando por completo** `toolRequest.blocking`. Para tools sin alias registrado, el comportamiento previo (confiar en `blocking`) se mantiene exactamente igual (test de regresion `"a tool outside the Capability Gateway still trusts its own blocking flag"`).

Hallazgo real durante ACS-R1-01 (documentado ahi como riesgo #1): sin este cambio, cualquier tool request de `search_products` marcado `blocking:true` por el LLM escalaba a `escalate_to_operator`, bloqueando la recomendacion autonoma de un capability de solo lectura. Ya esta cerrado.

`toolAliases.ts` es el unico punto de traduccion `searchProducts -> search_products` en todo el runtime; `NATIVE_CYCLE_ALLOWED_CAPABILITIES` en `runNativeAutonomousCycle.ts` se deriva de esa tabla en vez de repetir el literal.

## 5. Objetivo 5 y 6 - Etapa de ejecucion generica y seleccion de producto auditada

`runCapabilityExecutionStage.ts` reemplaza la funcion especifica de un solo tool: itera los tool requests sobrevivientes de policy, resuelve cada uno via el alias table, y ejecuta cualquier capability registrada. Agregar una capability nueva no requiere una nueva funcion de etapa - solo una entrada en el registry y (si aplica) un alias.

`buildCatalogGroundedMessage.ts` es el projector especifico de catalogo permitido por el objetivo 5: consume las ejecuciones genericas, y solo si hay una ejecucion de `search_products` completada, selecciona el mejor resultado con `rankCatalogSearchResults.ts` (orden: `matchType` exacto-sku > exacto-nombre > parcial > descripcion, luego `availability` en-stock > desconocido > sin-stock, orden original estable en empates) y llama `get_product_details` sobre ESE unico producto - nunca sobre "el primero" sin mas. La razon de seleccion queda en el resultado (`reason.rule`, `reason.matchType`, `reason.availability`), auditable.

## 6. Objetivo 7 - Smoke test real

`scripts/manual-test/catalog-service-smoke.ts`: llamadas HTTP reales contra `CATALOG_SERVICE_BASE_URL`/`CATALOG_SERVICE_API_KEY`. Se niega a ejecutar (exit 1, sin request) si faltan credenciales - nunca corre en CI. Busca un producto real, selecciona el mejor match con el mismo ranker productivo, obtiene su detalle, y reporta contract version, latencia de cada llamada y evidencia (`source`, `retrievedAt`, `cached`). Verificado en esta sesion contra un servidor mock local (no contra el microservicio real desplegado, que no estaba accesible desde este entorno):

```
Catalog Port smoke test - contract catalog-service.v1
searchProducts OK in 69ms - 1 item(s)
Selected best match: productId=501 rule=catalog-ranker.v1 matchType=partial_name availability=in_stock
getProductDetails OK in 5ms
  price=89990 CLP (discountApplied=true)
Total latency: 74ms (search=69ms, details=5ms)
```

Documentado en `scripts/manual-test/README.md`.

## 7. Objetivo 8 - Prueba integrada

`tests/native/catalogConversationFlow.test.ts`: 5 turnos reales sobre `runNativeAutonomousCycle` (BD real, HTTP mockeado, proveedor LLM scripted por turno):

1. Busqueda ("busco una jaula") -> `search_products` real via HTTP -> recomendacion grounded cita "Jaula de entrenamiento premium".
2. Objecion ("esta muy cara") -> la oportunidad NO queda en estado terminal (`won|lost|cancelled|archived`), el ciclo sigue corriendo.
3. Alternativa ("¿algo mas economico?") -> SEGUNDA busqueda real y distinta (`jaula economica`), recomendacion grounded cita "Jaula de entrenamiento economica". Se verifica que las dos queries HTTP fueron distintas y que `crm_capability_executions` tiene exactamente 2 filas `search_products`, ambas `completed`.
4. "Lo voy a pensar" -> `selectedNextAction.type === "propose_followup"`.
5. El cliente vuelve ("listo, lo compro") -> el ciclo continua sobre la MISMA `opportunityId`, sin perder continuidad.

**Alcance honesto (no se afirma mas de lo probado):** `propose_followup` aqui es la seleccion de next-action del loop operacional y la fila `crm_agent_actions` resultante (`actionType=schedule_followup`) que produce `runCommercialExecutionBridge`. El subsistema separado de scheduling/cancelacion/ejecucion-por-silencio real (`lib/brain/commercial/follow-up-planner`, con `scheduledFor`/due_at y su propio worker, ya cubierto por `followUpScheduling.test.ts` / `runFollowupTick.test.ts`) **no esta conectado a `runCommercialExecutionBridge`** - se confirmo leyendo `buildAgentActionFromNextAction` (usa `context.scheduledFor`, que `runCommercialExecutionBridge.ts` nunca setea) vs `buildAgentActionFromFollowUpPlan` (la funcion que si crea un follow-up real con `scheduledFor`, invocada desde otro lugar). Por tanto este incremento NO prueba "cancelacion por respuesta o ejecucion por silencio" de un follow-up disparado por `propose_followup`, porque esa conexion no existe todavia en el runtime canonico. Se documenta como deuda real (seccion 8), no se simulo un resultado falso.

## 8. Riesgos y deuda pendiente (actualiza la seccion 12 de ACS-R1-01)

1. **Gap real descubierto en objetivo 8:** `propose_followup` (Fase 3/4 del ciclo canonico) no esta conectado al subsistema real de scheduling de follow-ups (`follow-up-planner`, `scheduledFor`/due_at, worker). Un cliente que dice "lo voy a pensar" hoy genera una accion `schedule_followup` sin fecha de disparo real - no despierta sola. Requiere un incremento dedicado (fuera de alcance del Capability Gateway).
2. **`runCommercialShadowEvaluation` sigue con nombre historico** ("shadow") pese a ser la pieza productiva real. Renombrar es deuda de claridad, no de correctness; alto radio de archivos afectados.
3. **`BRAIN_SALES_AGENT_DRY_RUN` sigue sin ser una compuerta de seguridad real** - solo se documento la contradiccion, no se cerro en codigo (compartido con `processInbound.ts` legacy).
4. Los items 2-6 de la seccion 12 de [[audits/acs-r1-01-capability-gateway-evidence]] (multi-request no reconciliado, `capabilities/registry.ts` de multi-request en SQL directo, `denied` sin escalamiento formal, latencia de `get_product_details` no medida en produccion real) siguen vigentes sin cambios.
5. Un archivo `runCatalogCapabilityStage.ts` reaparecio en el arbol de trabajo (ver seccion 1) creado por una sesion Codex concurrente trabajando en `ACS-R1-04`; no interfiere con este incremento (no importado desde `runNativeAutonomousCycle.ts`) pero deberia revisarse/eliminarse o adoptarse formalmente en una revision posterior para evitar dos nombres para conceptos similares.

## 9. Validacion

`npx tsc --noEmit` -> exit 0. `npm run lint` -> 0 errores (35 warnings preexistentes sin cambios). `npx tsx --test "tests/**/*.test.ts"` -> **749 tests, 749 pass, 0 fail** (base ACS-R1-01: 735; +14 de este incremento: 9 en `capabilityGatewayHardening.test.ts`, 1 en `catalogConversationFlow.test.ts`, +4 netos en los archivos de adapter/gateway actualizados).

## 10. Entrega

- Funcional: codigo productivo real, migracion ya aplicada desde ACS-R1-01 (sin cambios de schema en este incremento), tests contra BD real y HTTP mockeado/real (smoke test).
- No se toco Customer 360, ADRs, `AGENTS.md`/`CLAUDE.md`, ni el trabajo activo de `ACS-R1-04` (identity resolution) - verificado explicitamente antes de escribir en `docs/ACTIVE_RELEASE.md`/`docs/CAPABILITY_MATRIX.md`, que pertenecen a una sesion Codex concurrente.
- No se agregaron capabilities de negocio nuevas ni se habilito multi-request.
