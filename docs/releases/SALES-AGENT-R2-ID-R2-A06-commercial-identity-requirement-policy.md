# SALES-AGENT-R2-ID-R2-A06 - Commercial Identity Requirement Policy

## Veredicto

`ID_R2_A06_COMMERCIAL_IDENTITY_REQUIREMENT_VALIDATED`

## Baseline

- `docs/audits/SALES-AGENT-R2-ID-R2-A01-existing-identity-onboarding-engine-reuse-audit.md` - veredicto `IDENTITY_ENGINE_HYBRID_REUSE`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A02-canonical-candidate-resolver-evidence-contract.md` - veredicto `ID_R2_A02_CANDIDATE_RESOLVER_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A03-durable-identity-evidence-corrections.md` - veredicto `ID_R2_A03_DURABLE_IDENTITY_EVIDENCE_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A04-identity-verification-policy.md` - veredicto `ID_R2_A04_VERIFICATION_POLICY_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A05-runtime-identity-context-wiring.md` - veredicto `ID_R2_A05_RUNTIME_IDENTITY_CONTEXT_VALIDATED`.

Revalidado contra `develop`: `RuntimeIdentityContext`/`IdentityLevel`/`IdentityVerificationEntityType` (A04/A05) no cambiaron - este slice solo los consume, nunca los reinterpreta.

## Alcance real de esta tarea

Se implemento `lib/brain/commercial/identity/commercial-identity-requirement/` - una policy pura (sin I/O, sin LLM, sin mutacion) que, dada una `CommercialOperation` real (auditada contra el codigo, nunca inventada) y el `RuntimeIdentityContext` del turno (A05), decide si la identidad actual alcanza para esa operacion. **No se conecto a ningun runtime todavia** - ni CommercialWork, ni Agent Tool Loop, ni multi-request llaman a este modulo. Eso es explicitamente `ID-R2-A07`.

## 1. Inventario de operaciones reales (PARTE 1)

Auditado directamente contra `lib/brain/commercial/capability-gateway/registry.ts`, `customerIdentityCapabilities.ts`, `lib/brain/commercial/work/stepTypes.ts`, `lib/brain/commercial/customer-profile-context/` y `lib/domains/customer-identity-verification` (LEVEL_4). Tabla completa con la columna "Exists today" en `lib/brain/commercial/identity/commercial-identity-requirement/operations.ts` (comentario de cabecera) - resumen:

| Operation | Exists today | Runtime owner | Mutating | Customer-specific | Sensitive | Proposed requirement |
|---|---|---|---|---|---|---|
| `search_products` | si (capability) | CommercialWork/Agent Tool Loop/legacy | no | no | no | NONE |
| `get_product_details` | si (capability) | idem | no | no | no | NONE |
| `batch_get_products` | si (capability) | idem | no | no | no | NONE |
| `explore_catalog` | si (capability) | idem | no | no | no | NONE |
| `search_company_knowledge` | si (capability) | Agent Tool Loop | no | no | no | NONE |
| `recommend_catalog_products` | si (capability) | idem | no | no | no | NONE |
| `select_products` | si (capability) | idem | si (durable line items) | no | no | NONE |
| `set_shipping_destination` | si (capability) | idem | si (durable destination) | no | no | NONE |
| `calculate_shipping` | si (capability) | idem | no | no | no | NONE |
| `select_shipping_option` | si (capability) | idem | si (durable seleccion) | no | no | NONE |
| `create_quote` | si (capability) | idem | si (Quote Service externo) | si | si (pricing) | MINIMUM_LEVEL LEVEL_2 |
| `resolve_customer` | si (capability) | native-cycle session boundary | no | si | si | NONE (bootstrapping) |
| `link_external_identity` | si (capability) | native-cycle session boundary | si (`customer_external_identity`) | si | si | MINIMUM_LEVEL LEVEL_2 (precondicion necesaria, no suficiente) |
| `assisted_sale_handoff` | si (step type `HANDOFF` + dispatch, sin capability) | CommercialWork/Agent Tool Loop | no (solo dispatch) | no | no | MINIMUM_LEVEL LEVEL_1 |
| `customer_profile_history` | si (`lib/brain/commercial/customer-profile-context`) | Agent Tool Loop | no | si | si (historial/RFM) | MINIMUM_LEVEL LEVEL_3 |
| `order_status_entity_verification` | mecanismo existe (A04 `evaluateEntityVerification`, `entityType:"order"`); ninguna capability lo invoca todavia | ninguno todavia | no | si | si | ENTITY_VERIFICATION(order) |

`create_customer` se **excluyo deliberadamente** del catalogo - ver seccion 5.

No se encontro ninguna capability/step de checkout, payment, order-status o post-sales real en el repo - confirmado, no se inventaron.

## 2. Requirement model (PARTE 2)

```ts
type CommercialIdentityRequirement =
  | { kind: "NONE" }
  | { kind: "MINIMUM_LEVEL"; level: "LEVEL_1_CHANNEL_OBSERVED" | "LEVEL_2_MASTER_RESOLVED" | "LEVEL_3_PRESTASHOP_LINKED" }
  | { kind: "ENTITY_VERIFICATION"; entityType: IdentityVerificationEntityType };
```

`CommercialIdentityMinimumLevel` reusa `IdentityLevel` de A04 (`Exclude<IdentityLevel, "LEVEL_0_ANONYMOUS">`) - nunca redefine los niveles por segunda vez. LEVEL_4 nunca es un `MINIMUM_LEVEL` posible - es siempre `ENTITY_VERIFICATION`, verificado en runtime por `CIR17` (el comparador de niveles solo conoce 4 valores) y `CIR15` (una operacion `ENTITY_VERIFICATION` nunca se satisface por nivel, ni siquiera en LEVEL_3).

## 3. Decision contract (PARTE 3)

```ts
type CommercialIdentityRequirementDecision =
  | { status: "SUFFICIENT"; currentLevel; requiredLevel: IdentityLevel | null; policyCode }
  | { status: "ONBOARDING_REQUIRED"; currentLevel; requiredLevel; requiredEvidence; policyCode }
  | { status: "ENTITY_VERIFICATION_REQUIRED"; currentLevel; entityType; policyCode }
  | { status: "READY_TO_LINK"; currentLevel; policyCode }
  | { status: "AMBIGUITY_RESOLUTION_REQUIRED"; currentLevel; policyCode }
  | { status: "IDENTITY_CONFLICT"; policyCode }
  | { status: "SYSTEM_WAIT"; retryable: boolean; policyCode };
```

Diferencia deliberada del sketch del enunciado: se agrego `AMBIGUITY_RESOLUTION_REQUIRED` como status propio (PARTE 10 lo pedia evaluar explicitamente) en vez de colapsar la ambiguedad dentro de `ONBOARDING_REQUIRED` o `IDENTITY_CONFLICT` - un caller nunca tiene que re-derivar "es un conflicto duro, una ambiguedad transitoria del turno, o simplemente falta evidencia" a partir de un `policyCode` suelto. Cero texto conversacional en ningun campo.

## 4. Precedencia (PARTE 4)

`decideCommercialIdentityRequirement` (`evaluate.ts`), en orden, nunca salteable:

1. La operacion requiere identidad (`kind !== "NONE"`) Y `runtimeIdentity.status === "CONFLICT"` -> `IDENTITY_CONFLICT`.
2. La operacion requiere identidad Y `runtimeIdentity.status === "SYSTEM_UNAVAILABLE"` -> `SYSTEM_WAIT`.
3. `kind === "NONE"` -> `SUFFICIENT` (la identidad nunca estuvo en juego).
4. `kind === "ENTITY_VERIFICATION"` -> `ENTITY_VERIFICATION_REQUIRED`, siempre, sin importar el nivel actual.
5. `currentLevel >= requiredLevel` -> `SUFFICIENT`.
6. `requiredLevel === LEVEL_3` Y `runtimeIdentity.status === "READY_TO_LINK"` -> `READY_TO_LINK`.
7. `runtimeIdentity.status === "AMBIGUOUS"` -> `AMBIGUITY_RESOLUTION_REQUIRED`.
8. de lo contrario -> `ONBOARDING_REQUIRED`, con `requiredEvidence` propagado tal cual desde `RuntimeIdentityContext`.

Los pasos 1/2 se evaluan ANTES que cualquier otra regla - una operacion que si requiere identidad nunca puede saltarse `CONFLICT`/`SYSTEM_UNAVAILABLE` via una regla mas debil (PARTE 4, ultima linea). Los pasos 1/2 se saltan por completo cuando `kind === "NONE"` (paso 3 nunca se alcanza para una operacion publica en conflicto/system-unavailable - ver seccion 6).

## 5. create_customer: exclusion deliberada (PARTE 5)

El enunciado pide explicitamente "no duplicar ACS-R1-04 eligibility policy" para `create_customer`. Su elegibilidad real (purpose permitido, consentimiento del turno, `resolve_customer` `no_match` fresco, projection gate) ya vive completa en `runCustomerOnboardingPostPlanStage.ts`/`evaluateCreateCustomerAuthority` (ACS-R1-04) y no encaja en el modelo `MINIMUM_LEVEL` de todos modos: `create_customer` se invoca exactamente cuando la identidad **no** esta resuelta (LEVEL_0/LEVEL_1), lo opuesto de "requiere mas nivel". Se excluyo del catalogo `CommercialOperation` en vez de modelarlo con un requirement que no reflejaria su semantica real - documentado explicitamente, no un olvido.

`link_external_identity` si se modelo, pero solo como precondicion necesaria (`MINIMUM_LEVEL LEVEL_2` - "master ya resuelto, evidencia PrestaShop ya convergio") - la autorizacion completa (consentimiento explicito de este turno, `no_match` fresco) sigue siendo exclusivamente responsabilidad de la policy ACS-R1-04 existente, nunca duplicada aqui.

## 6. Checkout neutrality (PARTE 6)

El modulo nunca importa ni lee configuracion de checkout - no existe ninguna capability/step de checkout real en el repo hoy (seccion 1), y el enunciado prohibe agregarla salvo como deuda documental (ver "Deudas"). `CIR19` prueba esto estructuralmente (ningun import specifier de los 4 archivos del modulo contiene `"checkout"`, y ninguno lee `process.env`).

## 7. Assisted sale (PARTE 7)

`assisted_sale_handoff` requiere solo `LEVEL_1_CHANNEL_OBSERVED` - nunca `LEVEL_2`/`LEVEL_3`. `CIR18` prueba las tres franjas: en `LEVEL_0` todavia pide `ONBOARDING_REQUIRED` hacia `LEVEL_1` (el canal mismo no fue observado nunca), en `LEVEL_1` ya es `SUFFICIENT`, y en `LEVEL_2` sigue siendo `SUFFICIENT` (una identidad ya resuelta nunca se "degrada"). No se implemento ninguna captura de email/enriquecimiento opcional - eso es explicitamente responsabilidad de un slice posterior (A07+).

## 8. READY_TO_LINK vs. informacion faltante (PARTE 8)

`READY_TO_LINK` solo sustituye a `ONBOARDING_REQUIRED` cuando el gap es especificamente "falta el link canonico a LEVEL_3" - nunca para un requirement `LEVEL_1`/`LEVEL_2` (una conversacion `READY_TO_LINK` ya esta en `LEVEL_2` por definicion de A04, asi que jamas puede genuinamente faltarle `LEVEL_1`/`LEVEL_2`). `CIR09` prueba el caso positivo (requiere LEVEL_3, status `READY_TO_LINK` -> `READY_TO_LINK`, nunca `ONBOARDING_REQUIRED` generico).

## 9. NEEDS_VERIFICATION (PARTE 9)

Cuando `runtimeIdentity.status === "NEEDS_VERIFICATION"` y la operacion exige mas nivel, la decision es `ONBOARDING_REQUIRED` con `policyCode: "IDENTITY_INFORMATION_MISSING"` (distinto del `..._REQUIRED` generico que describe "todavia no llego a ese nivel en absoluto") y `requiredEvidence` copiado tal cual desde `RuntimeIdentityContext.requiredEvidence` - nunca redactado, nunca traducido a una pregunta. `CIR10` lo prueba con `requiredEvidence: ["email"]`.

## 10. Ambiguity (PARTE 10)

Se agrego el status explicito `AMBIGUITY_RESOLUTION_REQUIRED`, separado de `IDENTITY_CONFLICT` y de `ONBOARDING_REQUIRED` (seccion 3). Una operacion publica (`kind: "NONE"`) con identidad ambigua sigue siendo `SUFFICIENT` (`CIR13`, la ambiguedad nunca importa si la operacion no necesita identidad); una operacion que si requiere nivel y encuentra `AMBIGUOUS` obtiene `AMBIGUITY_RESOLUTION_REQUIRED`, nunca `IDENTITY_CONFLICT` ni un `ONBOARDING_REQUIRED` que perderia la distincion (`CIR14`).

## 11. Conflict (PARTE 11)

`IDENTITY_CONFLICT` solo se produce cuando la operacion requiere identidad. `search_products` (catalogo publico) en conflicto sigue siendo `SUFFICIENT` (`CIR02`) - un conflicto de identidad nunca bloquea toda la conversacion, solo las operaciones que genuinamente dependen de saber quien es el cliente.

## 12. SYSTEM_UNAVAILABLE (PARTE 12)

Mismo criterio que conflict: `search_products` con Identity Service caido sigue siendo `SUFFICIENT` (`CIR03`); una operacion customer-specific (`create_quote`) obtiene `SYSTEM_WAIT` (`CIR12`). Un fallo de Identity nunca tumba el Sales Agent completo.

## 13. Minimum level comparison (PARTE 13)

`isIdentityLevelAtLeast(current, required)` - comparacion numerica explicita contra una tabla fija (`LEVEL_0_ANONYMOUS: 0 ... LEVEL_3_PRESTASHOP_LINKED: 3`), nunca comparacion de strings. `CIR16` prueba las 16 combinaciones de la matriz 4x4. `IDENTITY_LEVELS_IN_COMPARISON_ORDER` (export runtime-checkable) prueba que solo existen esos 4 valores - LEVEL_4 esta estructuralmente ausente (`CIR17`).

## 14. Objective vs. capability (PARTE 14)

Se eligio **capability name** (el vocabulario de `lib/brain/commercial/capability-gateway/registry.ts`) como key primaria de `CommercialOperation` - es la unidad mas cercana a la ejecucion real, compartida por los cuatro runtimes (nunca objective/step type, que son vocabularios redundantes del mismo hecho: `GET_SHIPPING_QUOTE` objective / `CALCULATE_SHIPPING` step / `calculate_shipping` capability son la MISMA operacion, y modelar tres keys distintas habria duplicado la regla exactamente como el enunciado advierte evitar). Para las operaciones reales sin capability (`assisted_sale_handoff`, `customer_profile_history`, `order_status_entity_verification`) se extendio el mismo namespace con tres identificadores adicionales, en vez de forzarlas a una capability inexistente. Un test de integridad (`tests/commercial/commercialIdentityRequirement.test.ts`, "catalog integrity") cruza el catalogo contra `CAPABILITY_GATEWAY_REGISTRY` y `COMMERCIAL_WORK_STEP_CAPABILITIES` reales para evitar drift silencioso - importado solo en el test, nunca en el modulo de produccion (para no acoplar la policy al registry, seccion 16).

## 15. No modificar planning todavia (PARTE 15)

`getCommercialIdentityRequirement`/`evaluateCommercialIdentityRequirement`/`decideCommercialIdentityRequirement` son funciones puras, sin I/O. Ningun archivo de `lib/brain/commercial/work/`, `multi-request/`, `agent-loop/` importa este modulo - no hay ningun caller real todavia (verificado, `CIR23` mas la ausencia de cualquier import cruzado). Step state, READY/BLOCKED, objective derivation, executor, finalizer, follow-up y planner prompts permanecen exactamente como estaban.

## 16. Provider neutrality (PARTE 16)

`RuntimeIdentityContext` (A05) nunca carga un campo `provider`/`channel` - este modulo tampoco agrega ninguno. `CIR20` prueba ambas cosas: que el tipo `RuntimeIdentityContext` sigue sin esos campos, y que ningun archivo de este modulo los lee. Un requirement como `customer_profile_history -> LEVEL_3` es identico sin importar si el canal actual es WhatsApp o un futuro Instagram.

## 17. Privacidad (PARTE 17)

`CommercialIdentityRequirementDecision` solo contiene `currentLevel`/`requiredLevel`/`entityType`/`requiredEvidence` (tipos de senal, nunca valores)/`policyCode`/`retryable` - ningun campo nuevo de PII. Como `RuntimeIdentityContext` (su unico input de identidad) ya garantiza ausencia de email/telefono/wa_id/referencias de orden crudas (A05), y esta policy nunca agrega un campo nuevo, la garantia se hereda sin necesitar una prueba de serializacion adicional.

## 18. Policy codes (PARTE 18)

`CommercialIdentityRequirementPolicyCode` - 13 codigos fijos. Superset simetrico de los ejemplos del enunciado: se agregaron `CHANNEL_IDENTITY_REQUIRED`/`MASTER_IDENTITY_SUFFICIENT`/`PRESTASHOP_IDENTITY_SUFFICIENT` (el enunciado solo listaba un lado de cada par SUFFICIENT/REQUIRED) para que cada rama `MINIMUM_LEVEL` tenga un codigo simetrico en ambos sentidos de la comparacion. Nunca prosa para branching - cada rama de `decideCommercialIdentityRequirement` retorna exactamente uno.

## 19. Test Matrix (PARTE 19, CIR)

`tests/commercial/commercialIdentityRequirement.test.ts`, 26 tests (24 CIR + 2 de integridad de catalogo). Modulo enteramente puro - **cero dependencia de DB**, corre en <1s.

| ID | Cubierto por |
|---|---|
| CIR01-CIR03 | dedicados |
| CIR04 | dedicado (ambos niveles) |
| CIR05/CIR06 | dedicados |
| CIR07/CIR08 | dedicados |
| CIR09/CIR10 | dedicados |
| CIR11/CIR12 | dedicados |
| CIR13/CIR14 | dedicados |
| CIR15 | dedicado |
| CIR16 | dedicado (matriz 4x4 completa) |
| CIR17 | dedicado |
| CIR18 | dedicado (3 niveles) |
| CIR19 | dedicado (estructural) |
| CIR20 | dedicado (estructural, incluye el tipo `RuntimeIdentityContext`) |
| CIR21 | dedicado (estructural) |
| CIR22 | dedicado (estructural) |
| CIR23 | dedicado (estructural) |
| CIR24 | dedicado |

26/26 verdes.

## 20. Regresion (PARTE 20)

Ejecutado contra MariaDB real (`main_management`, migraciones 001-032 aplicadas). Nota: `npm test` por defecto corre archivos en paralelo dentro de un mismo batch de `node --test`, lo que reproduce la contencion de recursos compartidos ya documentada en `docs/ACTIVE_RELEASE.md` (`ACS-R1-05.1-T02.3D`, "scope compartido `pesas_chile`/`crm_test` entre archivos concurrentes") - una corrida en paralelo de este batch mostro 2-3 fallas no deterministicas y no reproducibles (nombres de test distintos en corridas sucesivas); la MISMA corrida con `--test-concurrency=1` fue 100% verde. Todo lo reportado abajo esta serializado:

- `npx tsc --noEmit`: limpio.
- `npx eslint` sobre `lib/brain/commercial/identity/commercial-identity-requirement/` y el test nuevo: limpio.
- `npm run build`: limpio.
- `tests/commercial/commercialIdentityRequirement.test.ts` (A06, nuevo): 26/26.
- `tests/domains/customerIdentity.test.ts`, `customerIdentityVerification.test.ts`, `customerIdentityEvidence.test.ts`, `tests/commercial/runtimeIdentityContext.test.ts`, `customerSession.test.ts`, `customerSessionCustomer360Gate.test.ts`, `customerSessionPrivacy.test.ts`: 197/197.
- `tests/commercial/customerOnboardingPostPlanStage.test.ts`, `customerOnboardingPostPlanRuntime.test.ts`, `customerOnboardingPostPlanPrivacy.test.ts`, `customerIdentityAuditEvents.test.ts`, `identityCapabilityGatewaySummaries.test.ts`, `createCustomerCapability.test.ts`, `linkExternalIdentityCapability.test.ts`, `customerMasterProjectionGate.test.ts`, `extractCustomerOnboardingFields.test.ts`, `tests/native/identity-conflict.test.ts`, `tests/native/nativeInboundIdentityBoundary.test.ts`: 156/156.
- `tests/commercial/commercialWorkInboundCycle.test.ts`, `multiRequestRuntime.test.ts`, `multiRequestCustomer360.test.ts`, `tests/agent-loop/runNativeAgentToolLoopCycleConfig.test.ts`: 36/36.
- `tests/e2e/customerIdentityOnboarding.e2e.test.ts`: 12/14 - las 2 fallas son `T08-A6`/`T08-A7`, ya documentadas como `PREEXISTING_FAILURE` (falta de Customer Service desplegado), no relacionadas con este cambio.

Cero fallas nuevas atribuibles a este cambio. Cero cambio funcional de runtime - ningun test previamente existente cambio su comportamiento, porque este modulo no tiene todavia ningun caller real.

## Deudas explicitas (no cerradas en A06, por diseno)

- Sin caller real todavia - `getCommercialIdentityRequirement`/`evaluateCommercialIdentityRequirement` no se invocan desde ningun runtime. Es exactamente el alcance de `ID-R2-A07`.
- `create_customer` queda fuera del catalogo `CommercialOperation` (seccion 5) - una futura necesidad de representarlo debe reusar `evaluateCreateCustomerAuthority` (ACS-R1-04), nunca redefinir su elegibilidad aqui.
- `create_quote`'s requirement propuesto (`MINIMUM_LEVEL LEVEL_2`) es mas estricto que el comportamiento actual de `createQuoteCapability`/`assembleQuoteInput` (que degrada de forma informativa, sin bloquear duro, ante identidad ausente) - deliberado, documentado (seccion 1): A06 propone el requirement, no cambia el capability existente. Un futuro `A07` decide si/como aplicarlo.
- `order_status_entity_verification` no tiene todavia ninguna capability real que lo invoque - modelado solo porque el mecanismo subyacente (A04) ya existe.
- `docs/CAPABILITY_MATRIX.md` no se toco: este modulo no es un tool/capability agent-callable, mismo criterio que A03/A04/A05.
- `docs/ACTIVE_RELEASE.md` no se toco: mismo precedente que A01-A05.

## Next slice

**`ID-R2-A07` - CommercialWork Identity Gating + Onboarding Resume**: `operation/step -> A06 requirement -> RuntimeIdentityContext -> READY / BLOCKED_BY_IDENTITY -> onboarding -> identity upgraded -> reprojection -> original objective continues`. Ese slice sera el primer caller real de este modulo, y el primero en decidir que pasa operacionalmente cuando una decision no es `SUFFICIENT`.

## Criterio de salida - checklist

1. Operaciones reales inventariadas - seccion 1. OK
2. Cada operacion relevante tiene requirement explicito - seccion 1/5. OK
3. Catalogo publico no exige identidad - `CIR01`. OK
4. Identity conflict no bloquea operaciones que no necesitan identidad - seccion 11, `CIR02`. OK
5. System failure no bloquea operaciones que no necesitan identidad - seccion 12, `CIR03`. OK
6. LEVEL_3 se exige solo donde realmente se necesita historial/PrestaShop - seccion 1 (`customer_profile_history`). OK
7. LEVEL_4 sigue entity-scoped - seccion 2/13, `CIR15`/`CIR17`. OK
8. READY_TO_LINK se distingue de falta de informacion - seccion 8, `CIR09`/`CIR10`. OK
9. Assisted-sale handoff no exige onboarding completo - seccion 7, `CIR18`. OK
10. Checkout availability no afecta requirements existentes - seccion 6, `CIR19`. OK
11. Policy es provider-neutral - seccion 16, `CIR20`. OK
12. No depende del LLM - seccion 15, `CIR21`. OK
13. No ejecuta mutaciones - `CIR22`. OK
14. No modifica CommercialWork todavia - seccion 15, `CIR23`. OK
15. Tests son deterministicos - `CIR24`. OK
16. Queda definido A07 como wiring de gating/resume - ver "Next slice". OK
