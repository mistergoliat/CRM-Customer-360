---
title: CP-R1-T12D - Customer History Commercial Policy and Runtime Validation
doc_id: cp-r1-t12d-customer-history-commercial-policy-runtime-validation
status: implemented_pending_review
tags:
  - release
  - customer-profile
  - sales-agent
  - commercial-policy
---

# CP-R1-T12D - Customer History Commercial Policy and Runtime Validation

Branch: `feat/cp-r1-t12d-customer-history-commercial-policy`, base `develop`
(`f6f18b5`, includes the merged T12B/T12C PR #84). No commit, push or PR was
made for this task.

## 1. Objetivo

Convertir el historial de compras ya disponible via Customer Profile (T12B/
T12C) en señales comerciales determinísticas, y usar esas señales - nunca
texto libre del modelo, nunca inferencia no auditable - para orientar cómo el
Sales Agent presenta comercialmente esa evidencia. Cierra la línea de
capacidad Customer Profile como capacidad comercial operativa.

## 2. Estado previo

T12A (identidad directa PrestaShop), T12B (cliente HTTP tipado en
`lib/integrations/customer-profile/*`) y T12C (wiring de contexto comercial
en `lib/brain/commercial/customer-profile-context/*` + los dos archivos de
agent-loop) estaban implementadas, validadas y mergeadas (PR #84,
`f6f18b5`). El runtime podía cargar `CustomerCommercialHistoryContext` de
forma selectiva y fail-open, y comparar recomendaciones contra historial
(`compareRecommendationsWithPurchaseHistory`), pero la interpretación de esa
evidencia (¿es relevante?, ¿es una recompra?, ¿es un complemento?) quedaba
enteramente delegada a las reglas de prompt en texto libre - sin una capa
determinística intermedia.

## 3. Auditoría inicial

Matriz de estado, reconstruida leyendo `customer-profile-context/*`,
`runNativeAgentToolLoopCycle.ts`, `buildAgentStepPromptPackage.ts`,
`recommendation-context/*` y `agent-loop/pendingCatalogAction.ts` (no existe
un directorio `pending-catalog-action/` separado - confirmado antes de
editar):

| CAPABILITY | CURRENT INPUT | CURRENT SIGNAL | CURRENT MODEL EFFECT | TARGET POLICY | RISK | CHANGE REQUIRED |
|---|---|---|---|---|---|---|
| `CustomerCommercialHistoryContext` (loader T12C) | Respuestas HTTP de Customer Profile (summary/purchased-products/purchase-behavior/profile) | Ninguna - hechos normalizados crudos (`validatedOrderCount`, `purchasedProducts[]`, `purchaseBehavior`) | El modelo recibe JSON compacto y debe interpretarlo por sí mismo via reglas de prompt en texto libre | Capa determinística intermedia entre hechos crudos e interpretación | El modelo puede sobre-afirmar (declarar recompra como hecho) o sub-usar (nunca mencionar un match real) | `commercial-signals.ts` (nuevo) |
| `compareRecommendationsWithPurchaseHistory` (T12C) | `recommendationHistoryMatches` candidatos vs `purchasedProducts` | Solo `matchStatus` (5 valores enum) | Solo llega al modelo dentro de `customerPurchaseHistory.recommendationHistoryMatches`, sin repetición/recencia/reorder derivados | Reutilizar tal cual como base de evidencia para `PRODUCT_PREVIOUSLY_PURCHASED`/`VARIANT_PREVIOUSLY_PURCHASED` | Ninguno - ya inmutable y acotado | Ninguno (reutilizado sin cambios) |
| `buildCommercialContextSummary`/`buildCustomerPurchaseHistorySummary` (T12C) | `CustomerCommercialHistoryContext` | Hechos JSON compactos, sin política/guía | El modelo debe inferir relevancia y comportamiento apropiado solo con reglas estáticas | Agregar `customerHistoryCommercialSignals` (señales + guía), bajo su propio flag, aditivo | Bloat de prompt si estuviera siempre activo; debe quedar apagado por defecto y acotado | Nuevo wiring en `runNativeAgentToolLoopCycle.ts` |
| `CUSTOMER_PURCHASE_HISTORY_RULE_LINES` (T12C) | Texto de prompt estático, siempre presente | N/D | Indica generalidades sobre `customerPurchaseHistory`, no cómo leer las señales nuevas | Agregar `CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES`, mismo precedente de inclusión estática | Ninguno - texto estático es barato e inerte si las señales están ausentes | Nuevo bloque de reglas |
| `recommendation-context`/`recentCatalogContext`/`pendingCatalogAction` (T10B8x) | Pipeline de evidencia para gating de `recommend_catalog_products`/`get_product_details` | Ya gobierna autorización de candidatos de Catalog Service | No afectado por T12D - ningún producto se agrega, quita o reordena por señales de historial | Ninguno requerido - T12D solo lee `recommendationHistoryMatches` (ya derivado de estos), nunca escribe de vuelta | Riesgo de acoplamiento accidental si el wiring tocara estos archivos directamente | Ninguno (T12D no toca ninguno de estos archivos) |
| Capability Gateway / Catalog Service | Autoridad de ranking de productos | N/D | Ranking siempre determinado por Catalog Service | Debe seguir siendo la única autoridad de ranking; señales T12D son solo informativas | Cualquier ruta de código que reordene/filtre "recommendations" por historial violaría esto | Guardado por tests de inmutabilidad + test arquitectónico estático |

Confirmado antes de editar: las señales existentes son solo `matchStatus`
(T12C); la comparación recomendación-historial ya existe y es inmutable; las
reglas actuales al modelo son texto estático sin política derivada; el
resumen compacto se construye en `buildCommercialContextSummary`
(`runNativeAgentToolLoopCycle.ts`); solo `customerPurchaseHistory` llegaba al
prompt; el comportamiento de relevancia/repetición/reorder dependía
enteramente de interpretación libre del modelo - exactamente el vacío que
esta tarea cierra.

## 4. Arquitectura

Tres capas separadas, ninguna mezclada:

```
Customer Profile context (T12C, sin cambios)
  -> evidencia histórica normalizada (CustomerCommercialHistoryContext)
Commercial history signals (T12D, nuevo)
  -> lib/brain/commercial/customer-profile-context/commercial-signals.ts
     deriveCustomerHistoryCommercialSignals(): señales determinísticas puras
Relevance (T12D, nuevo)
  -> lib/brain/commercial/customer-profile-context/relevance.ts
     filterRelevantCustomerHistorySignals(): qué llega al modelo
Sales Agent policy (T12D, nuevo)
  -> lib/brain/commercial/customer-profile-context/commercial-policy.ts
     buildCustomerHistoryCommercialGuidance(): reglas de uso, nunca texto final
```

Flujo real (`runNativeAgentToolLoopCycle.ts`):

```
customerProfileContext (T12C, sin cambios)
  -> deriveCustomerHistoryCommercialSignals(context, referenceTime, ...)
  -> filterRelevantCustomerHistorySignals(signals, maxSignals)
  -> buildCustomerHistoryCommercialGuidance(exposedSignals)
  -> buildCustomerHistoryCommercialSignalsSummary({signals, guidance})
  -> commercialContextSummary.customerHistoryCommercialSignals (solo si hay señales expuestas)
  -> buildAgentStepPromptPackage.ts (CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES)
  -> Sales Agent response
```

El historial nunca controla Catalog Service directamente: ninguna función de
esta tarea toca `recommend_catalog_products`, `search_products`,
`recentCatalogContext.ts` ni `pendingCatalogAction.ts` - solo los **lee**
(via el `recommendationHistoryMatches` ya calculado por T12C).

## 5. Señales implementadas

`lib/brain/commercial/customer-profile-context/commercial-signals.ts`,
unión cerrada `CustomerHistoryCommercialSignal` - exactamente el contrato
propuesto en la tarea, sin campos ni tipos adicionales:

`CUSTOMER_HAS_PURCHASE_HISTORY`, `CUSTOMER_HAS_NO_PURCHASE_HISTORY`,
`HISTORY_UNAVAILABLE` (reason: `IDENTITY_UNAVAILABLE | DISABLED | NOT_FOUND |
TIMEOUT | UNAVAILABLE | CONTRACT_ERROR`), `PRODUCT_PREVIOUSLY_PURCHASED`,
`VARIANT_PREVIOUSLY_PURCHASED`, `PRODUCT_PURCHASE_REPEATED`,
`POSSIBLE_REORDER` (confidence `LOW | MEDIUM`, nunca `HIGH`),
`POSSIBLE_COMPLEMENT` (confidence `LOW` únicamente),
`RECENT_PURCHASE_RELEVANT`.

`deriveCustomerHistoryCommercialSignals(input)` es pura y determinística:
nunca lee `Date.now()` (recibe `referenceTime` explícito), nunca muta
`context` ni sus arrays anidados (27 tests, incluyendo inmutabilidad y "misma
llamada dos veces produce arrays nuevos pero iguales").

## 6. Reglas de derivación

- **`CUSTOMER_HAS_PURCHASE_HISTORY`**: `validatedOrderCount > 0` o
  `purchasedProducts.length > 0`, solo con `status` `AVAILABLE`/`PARTIAL`.
- **`CUSTOMER_HAS_NO_PURCHASE_HISTORY`**: solo cuando el servicio respondió
  correctamente (`AVAILABLE`/`PARTIAL`) y `validatedOrderCount === 0` -
  nunca cuando el servicio está unavailable (eso emite `HISTORY_UNAVAILABLE`
  en su lugar, nunca ambas).
- **`PRODUCT_PREVIOUSLY_PURCHASED`/`VARIANT_PREVIOUSLY_PURCHASED`**: uno por
  cada entrada de `recommendationHistoryMatches` con `matchStatus`
  `SAME_PRODUCT_PREVIOUSLY_PURCHASED`/`PRODUCT_MATCH_VARIANT_UNKNOWN` (mapea
  a `PRODUCT_PREVIOUSLY_PURCHASED`, nunca inventa un tipo de señal nuevo) o
  `SAME_VARIANT_PREVIOUSLY_PURCHASED` (mapea a `VARIANT_PREVIOUSLY_PURCHASED`
  con `productAttributeId` exacto). Una variante distinta de la observada
  nunca produce el match - `NOT_PREVIOUSLY_PURCHASED`/`HISTORY_UNAVAILABLE`
  (por match) nunca producen señal.
- **`PRODUCT_PURCHASE_REPEATED`**: `orderCount >= 2` exclusivamente - nunca
  `totalQuantity >= 2` (varias unidades en una sola orden no demuestra
  repetición temporal; test dedicado). Derivado de **todo**
  `purchasedProducts` (ya acotado por `config.purchasedProductsLimit`), no
  solo de los que coinciden con la solicitud actual - la exposición
  selectiva es responsabilidad de `relevance.ts`, nunca de la derivación.
- **`POSSIBLE_REORDER`**: solo cuando el producto coincide con la solicitud
  actual (via `recommendationHistoryMatches`) **y** `orderCount >= 2`.
  `confidence` `LOW` en exactamente 2 órdenes, `MEDIUM` desde 3 - nunca
  `HIGH` (verificado por test que serializa y busca `/HIGH/` en el
  resultado).
- **`POSSIBLE_COMPLEMENT`**: exige evidencia explícita
  `CustomerHistoryCatalogComplementEvidence` (`recommendedProductId` +
  `sourceProductId`) cuyo `sourceProductId` esté en `purchasedProducts` -
  nunca se infiere solo por coexistencia histórica. Ver "Limitaciones" para
  por qué esta evidencia no llega hoy desde el wiring real.
- **`RECENT_PURCHASE_RELEVANT`**: solo si el producto coincide con la
  solicitud actual y su `lastPurchasedAt` cae dentro de
  `CUSTOMER_HISTORY_RECENT_PURCHASE_DAYS` (default 90) respecto de
  `referenceTime`.

## 7. Política comercial

`lib/brain/commercial/customer-profile-context/commercial-policy.ts`,
`buildCustomerHistoryCommercialGuidance(signals)`: función pura del conjunto
de señales ya filtrado por relevancia - nunca lee env, nunca genera texto
final de respuesta. `preserveCatalogOrdering`/`autoExcludePurchasedProducts`/
`inferCustomerSegment`/`inferPurchasingPower` son literal-tipados (`true`/
`false`), no `boolean` - ningún consumidor puede aceptar un valor distinto
sin romper la compilación. `allowedStatements`/`prohibitedStatements` son
listas de guía en inglés (mismo idioma que el resto del prompt), nunca
frases customer-facing.

## 8. Política de relevancia

`lib/brain/commercial/customer-profile-context/relevance.ts`.
`shouldExposeCustomerHistorySignalToModel(signal, turnContext)`: decisión
pura de una sola señal. Defaults exactamente como la tarea especifica:
historial genérico sin relevancia -> no exponer; mismo producto/variante ->
exponer; repetido relacionado con la solicitud actual -> exponer; repetido
no relacionado -> no exponer; historial unavailable -> exponer solo como
constraint interno (nunca como hecho customer-facing).
`filterRelevantCustomerHistorySignals(signals, maxSignals)` es el punto de
entrada real del wiring: deriva `matchedProductIds` de las propias señales
(nunca requiere contexto externo adicional), deduplica, ordena en prioridad
fija y determinística (`HISTORY_UNAVAILABLE` primero, variante > producto >
reorder > complemento > recencia > repetición > hechos genéricos), y aplica
`CUSTOMER_HISTORY_MAX_SIGNALS`.

## 9. Relación con Catalog

`compareRecommendationsWithPurchaseHistory` (T12C) permanece exactamente
igual - no fue necesario extenderlo, ya produce los 5 `matchStatus` que
T12D consume tal cual. Ningún archivo de `commercial-signals.ts`/
`commercial-policy.ts`/`relevance.ts` importa ni referencia
`recentCatalogContext.ts`, `pendingCatalogAction.ts`, ni ningún archivo de
`recommendation-context/*` o `capability-gateway/*` - confirmado por lectura
y por el test arquitectónico (sección 20). Catalog Service permanece la
única autoridad de ranking: ninguna función de esta tarea ordena, filtra ni
reasigna un array de recomendaciones (test arquitectónico dedicado) y ningún
test de inmutabilidad detecta mutación del array/objeto de entrada.

## 10. Reglas del modelo

`buildAgentStepPromptPackage.ts`:
`CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES` (9 líneas), agregado en
ambas fases (`gathering`/`finalization`) inmediatamente después de
`CUSTOMER_PURCHASE_HISTORY_RULE_LINES` - mismo precedente de T12C: **siempre
presente** en el prompt (texto estático, barato) independientemente de si
`commercialContextSummary.customerHistoryCommercialSignals` está poblado
este turno; cuando el flag está apagado o no hay señales relevantes, el
campo simplemente está ausente y estas reglas describen el caso vacío.
Cubren: usar historial solo si cambia la respuesta; nunca mencionarlo
decorativamente; nunca remover/asumir sobre un producto ya comprado;
preguntar solo si la distinción cambia materialmente la recomendación;
`POSSIBLE_REORDER` como hipótesis nunca como hecho; `POSSIBLE_COMPLEMENT`
solo con evidencia de Catalog, nunca compatibilidad inventada;
`PRODUCT_PURCHASE_REPEATED` nunca clasifica el producto como
consumible/reposición/servicio; prohibición explícita de RFM/VIP/poder
adquisitivo/lifetime value/sensibilidad a precio/lealtad/riesgo de fuga;
`HISTORY_UNAVAILABLE` como constraint interno, nunca "sin compras" como
hecho.

## 11. Configuración

```
CUSTOMER_HISTORY_COMMERCIAL_POLICY_ENABLED=false   # default, no se activa en esta tarea
CUSTOMER_HISTORY_RECENT_PURCHASE_DAYS=90
CUSTOMER_HISTORY_MAX_SIGNALS=8
```

Independiente de `CUSTOMER_PROFILE_CONTEXT_ENABLED` (T12C) -
`readCustomerHistoryCommercialPolicyConfig()` (`config.ts`, reutiliza los
mismos helpers `readFlag`/`readPositiveInt`/`clamp` ya existentes en el
archivo, nunca reimplementados). Con el flag apagado (default),
`runNativeAgentToolLoopCycle.ts` nunca deriva señales ni construye el resumen
compacto - `commercialContextSummary` queda exactamente igual al que T12C ya
producía. `RunNativeAgentToolLoopCycleInput.customerHistoryCommercialPolicyConfig`
es un punto de inyección solo para tests (mismo patrón que
`loadCustomerProfileContext` de T12C) - los llamadores de producción no lo
pasan, y por lo tanto siempre leen el entorno real.

## 12. Observabilidad

Un `console.info({event: "customer_history_commercial_policy_evaluated", ...})`
por ciclo, solo cuando el flag está activo (mismo precedente que el log de
T12C, que tampoco emite si su propio flag está apagado): `customerHistoryPolicyEnabled`,
`historyStatus`, `derivedSignalTypes`, `exposedSignalTypes`,
`suppressedSignalCount`, `sameProductMatchCount`, `sameVariantMatchCount`,
`possibleReorderCount`, `possibleComplementCount`, `historyMentionRecommended`,
`reasonCodes`, `durationMs`, `requestId`. Nunca nombres de producto
completos, email, teléfono, nombre del cliente, dirección, RUT/DNI, historial
completo, payload del prompt, texto final del modelo, ni token - solo tipos
de señal (etiquetas enum), conteos, booleanos y `reasonCodes` (también
enum). `customerId`/`productId` nunca aparecen como valor de ningún campo de
este log (confirmado por lectura del bloque completo).

## 13. Casos conversacionales

Los 9 casos (A-I) de la tarea están implementados como tests deterministas
con proveedor scripteado (nunca un modelo real) en
`tests/agent-loop/customerHistoryCommercialPolicyAgentLoop.test.ts`:

- **A** (sin historial): `customerHistoryCommercialSignals` ausente del
  contexto - el modelo nunca ve una razón para mencionar historial.
- **B** (historial general sin match): cubierto por "unrelated purchase
  history" - señal ausente.
- **C** (misma variante): `VARIANT_PREVIOUSLY_PURCHASED` expuesta.
- **D** (otra variante): ninguna señal - nunca se fabrica un match de
  variante que la evidencia no respalda.
- **E** (compra repetida, 3 órdenes): `POSSIBLE_REORDER` expuesta,
  `confidence` nunca `HIGH`.
- **F** (complemento respaldado): sin evidencia real de Catalog disponible
  en el wiring actual, `POSSIBLE_COMPLEMENT` nunca aparece - ver
  "Limitaciones".
- **G** (historial no relacionado): señal suprimida del prompt.
- **H** (Customer Profile unavailable): el loop responde igual,
  `HISTORY_UNAVAILABLE` presente solo como constraint interno, nunca
  `CUSTOMER_HAS_NO_PURCHASE_HISTORY`, nunca un stack trace/error técnico en
  el payload.
- **I** (monto agregado presente): `customerPurchaseHistory.summary.monetaryInterpretation`
  sigue siendo `INFORMATIONAL_ONLY` (sin cambios de T12C); cero VIP/capacidad
  económica/segmento en todo el payload.

## 14. Evaluación del modelo

No existe en este repositorio un harness para invocar un modelo real de
forma determinista fuera del proveedor scripteado ya usado en cada suite de
integración de agent-loop (`createFakeAgentLoopProvider`/inyección directa de
`AgentLoopProvider`) - el mismo mecanismo que T10B8D y T12C ya usan como su
"harness de evaluación". Los 9 casos de la sección 13 usan ese mismo
mecanismo con aserciones estructurales equivalentes a la taxonomía pedida
(`FAIL_UNSUPPORTED_HISTORY_CLAIM`, `FAIL_UNNECESSARY_HISTORY_MENTION`,
`FAIL_AUTO_EXCLUSION`, `FAIL_RANKING_CHANGE`, `FAIL_RFM_INFERENCE`,
`FAIL_VIP_INFERENCE`, `FAIL_INVENTED_COMPATIBILITY`,
`FAIL_UNNECESSARY_CLARIFICATION`) - cada test falla exactamente si el
comportamiento correspondiente ocurre. No se envió WhatsApp real ni se
invocó ningún proveedor de modelo real; `BRAIN_META_SEND_ENABLED`/
`BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND` no aplican porque ningún test de esta
tarea llega a la capa de dispatch/outbox real (el commercial-event write se
traga igual que en el resto de la suite, sin MariaDB).

## 15. Runtime validation

No hay Customer Profile real accesible desde este entorno (confirmado:
mismo hallazgo que T12B/T12C, sin `CUSTOMER_PROFILE_BASE_URL` real
configurado). Toda la validación usa fixtures sintéticos, documentados como
tal en cada test (`historyContext()`/`purchasedProduct()` en los tests de
agent-loop; `baseContext()`/`purchasedProduct()`/`match()` en los tests de
señales) - nunca datos personales reales. Los 5 clientes técnicos
representativos pedidos (sin historial, una compra, producto repetido,
misma variante, otra variante) están cubiertos exactamente por los fixtures
de la sección 13 y los tests de la sección 5/6. `Customer Profile ready`,
`context loaded`, `signals derived`, `signals filtered by relevance`,
`prompt compact`, `no RFM`, `no ranking change`, `no real outbound` -
confirmados por los tests de agent-loop (loop responde, señales presentes/
ausentes según corresponda, cero RFM/VIP en el payload serializado, cero
llamada HTTP real - el `loadCustomerProfileContext` inyectado nunca hace
`fetch`).

## 16. Tests

74 tests nuevos:

- `tests/customer-profile-context/customerHistoryCommercialSignals.test.ts` (27) - derivación completa, sección 5/6/18.
- `tests/customer-profile-context/customerHistoryRelevance.test.ts` (12) - relevancia, sección 13/18.
- `tests/customer-profile-context/customerHistoryCommercialPolicy.test.ts` (10) - política, sección 7/18.
- `tests/customer-profile-context/customerHistoryCommercialSignalsSummary.test.ts` (4) - resumen compacto, sección 10.
- `tests/agent-loop/customerHistoryCommercialPolicyAgentLoop.test.ts` (16) - wiring end-to-end, sección 16/19.
- `tests/commercial/customerHistoryCommercialPolicyGuard.test.ts` (5) - guarda arquitectónica, sección 20.

0 `.only`, 0 `.skip`, 0 `.todo` en los 6 archivos (confirmado por grep). Cero
dependencia de MariaDB en los archivos nuevos (todos usan inyección directa
de dependencias, nunca `safeQueryRows`/`safeExecute`).

## 16b. Comparación con baseline (`origin/develop`, `f6f18b5`)

Baseline corrido en un worktree aislado (`git worktree add` a `origin/develop`,
`node_modules` reutilizado via junction, nunca reinstalado) - el working tree
de esta rama nunca se tocó (permanece con los cambios de T12D sin commitear,
tal como se pidió):

| | `origin/develop` (`f6f18b5`) | esta rama (T12D) |
|---|---|---|
| tests | 2623 | 2697 |
| pass | 2150 | 2224 |
| fail | 473 | 473 |

`2623 + 74 = 2697` y `2150 + 74 = 2224` exacto. La comparación no se quedó
en el conteo: los nombres de los 473 tests fallidos se extrajeron de ambas
corridas, se normalizó el prefijo de directorio (única diferencia esperada
entre un worktree y el checkout principal) y se diferenciaron -
**diff vacío, conjunto de fallos idéntico byte a byte**. Cero fallos
relacionados con `customerHistory`/`commercial-signals`/`commercial-policy`/
`relevance` en ninguna de las dos corridas.

## 17. Limitaciones

- **`POSSIBLE_COMPLEMENT` no se activa en el wiring real todavía.** La
  función `derivePossibleComplementSignals` está completamente implementada
  y testeada (acepta `CustomerHistoryCatalogComplementEvidence`), pero
  `runNativeAgentToolLoopCycle.ts` carga `customerProfileContext` **antes**
  de que el agent tool loop ejecute sus propias herramientas - el
  `sourceProduct` de una llamada real a `recommend_catalog_products` de este
  mismo turno todavía no existe en ese punto del ciclo. Threading esa
  evidencia requeriría mover el punto de carga (o re-derivar después del
  loop, antes de la finalización) - un cambio de arquitectura mayor,
  explícitamente fuera del alcance mínimo de esta tarea. El contrato
  permanece correcto y provablemente inerte (`derivePossibleComplementSignals`
  retorna `[]` sin evidencia) en vez de ausente en silencio.
- La política de relevancia expone como máximo `CUSTOMER_HISTORY_MAX_SIGNALS`
  señales por turno (default 8) - un cliente con muchos productos repetidos y
  relacionados con la solicitud actual podría tener señales legítimas
  recortadas; el orden de prioridad fijo asegura que las más específicas
  (variante, producto, reorder) sobrevivan primero.
- No existe smoke test contra un Customer Profile real en este entorno
  (mismo hallazgo documentado en T12B/T12C).

## 18. Riesgos

- Ninguno nuevo identificado que no esté ya cubierto por un test o un guard
  estático (ver secciones 9, 16, 20).
- El flag permanece apagado por defecto - no hay riesgo productivo hasta que
  se active explícitamente en una tarea futura separada.

## 19. Veredicto

`CUSTOMER_HISTORY_COMMERCIAL_POLICY_VALIDATED`

## 20. Cierre de la línea

Se cumplen todas las condiciones de cierre: historial disponible, carga
selectiva (T12C, sin cambios), señales determinísticas (sección 5-6),
política explícita (sección 7), relevancia controlada (sección 8),
fail-open (sección 15), sin RFM, sin VIP, sin cambios de ranking, sin
auto-exclusión, tests conversacionales (sección 13), runtime validation
(sección 15). No corresponde abrir otra tarea de Customer Profile salvo
defecto en producción, incorporación futura aprobada de RFM, cambio de
identidad a `master_customer`, o nuevo contrato del microservicio.

## 21. Siguiente tarea

`QUOTATION-R1-T01` - Quotation Capability Discovery and Contract Definition.
