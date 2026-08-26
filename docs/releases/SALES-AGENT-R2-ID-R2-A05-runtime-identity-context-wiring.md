# SALES-AGENT-R2-ID-R2-A05 - Runtime Identity Context Wiring

## Veredicto

`ID_R2_A05_RUNTIME_IDENTITY_CONTEXT_VALIDATED`

## Baseline

- `docs/audits/SALES-AGENT-R2-ID-R2-A01-existing-identity-onboarding-engine-reuse-audit.md` - veredicto `IDENTITY_ENGINE_HYBRID_REUSE`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A02-canonical-candidate-resolver-evidence-contract.md` - veredicto `ID_R2_A02_CANDIDATE_RESOLVER_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A03-durable-identity-evidence-corrections.md` - veredicto `ID_R2_A03_DURABLE_IDENTITY_EVIDENCE_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A04-identity-verification-policy.md` - veredicto `ID_R2_A04_VERIFICATION_POLICY_VALIDATED`.

Revalidado contra `develop`: `lib/domains/customer-identity/*` (A02), `lib/domains/customer-identity-evidence/*` (A03) y `lib/domains/customer-identity-verification/*` (A04) siguen exactos salvo el cambio aditivo descrito en la seccion "LEVEL_3 live freshness" mas abajo, que A04 dejo declarado explicitamente como deuda para el siguiente slice.

## Alcance real de esta tarea

Se conecto A04 (`evaluateIdentityVerification`) al runtime real por primera vez, se definio `RuntimeIdentityContext` como el contrato minimizado que describe la identidad de la conversacion en el turno actual, y se transporto ese contexto - de forma pasiva, sin cambiar comportamiento - a los cuatro runtimes comerciales (CommercialWork, multi-request, Agent Tool Loop, legacy) que ya comparten el mismo `CustomerSessionDecisionContext`. Ademas se cerro el gap de freshness de LEVEL_3 que A04 dejo declarado. No se implemento ninguna regla de negocio (onboarding, checkout, requerimiento por operacion) - eso queda para `ID-R2-A06`.

## 1. Call path antes/despues (PARTE 1)

**Antes de A05:**

```
processNativeWhatsAppInbound
  -> runNativeAutonomousCycle
    -> resolveNativeCustomerSession
      -> identityService.resolveIdentity()          (A02, in-memory)
      -> recordLocalIdentityResolution()             (T07 audit, descriptivo)
      -> recordTurnIdentityEvidence()                (A03, durable evidence)
      -> [reconciliacion onboarding / external resolve_customer / consent]
      -> session.decision (CustomerSessionDecisionContext, sin identity fact de A04)
    -> [CommercialWork | multi-request | Agent Tool Loop | legacy], cada uno recibe
       snapshot.customerSession = session.decision
```

A04 (`evaluateIdentityVerification`/`evaluateEntityVerification`) existia como dominio completo y probado, pero **sin ningun caller real** - confirmado en A04, seccion "Alcance real de esta tarea".

**Despues de A05:**

```
resolveNativeCustomerSession
  -> identityService.resolveIdentity()               (A02, sin cambios)
  -> recordLocalIdentityResolution()                  (sin cambios)
  -> recordTurnIdentityEvidence()                     (A03, sin cambios - PERO ahora es
                                                        el punto de corte de ordering, ver PARTE 5)
  -> resolveRuntimeIdentityContext()                  (A05, NUEVO)
       -> evaluateIdentityVerification(                (A04, real I/O)
            { conversationId, provider: "whatsapp", externalId: normalizeWaId(...) },
            { freshStatus: detail.status en {AMBIGUOUS, SYSTEM_FAILURE} | null }
          )
       -> mapIdentityVerificationDecisionToRuntimeIdentityContext()  (puro)
  -> recordIdentityVerificationDecision()              (A05, audit fail-safe, NUEVO)
  -> [reconciliacion onboarding / external resolve_customer / consent - SIN CAMBIOS,
      nunca lee runtimeIdentity]
  -> execution.runtimeIdentity + decision.runtimeIdentity
-> [CommercialWork | multi-request | Agent Tool Loop | legacy], cada uno recibe
   snapshot.customerSession = session.decision, que ahora incluye .runtimeIdentity
   de forma pasiva (PARTE 10/11)
```

## 2. Donde se calcula, donde se persiste, cuantas veces por turno (PARTE 1)

1. **Identity hoy**: `lib/domains/customer-identity/service.ts` (A02, in-memory), llamado una vez por turno desde `resolveNativeCustomerSession`.
2. **A03 evidence**: `recordTurnIdentityEvidence` (`identityEvidenceHooks.ts`), llamado una vez por turno, inmediatamente despues de (1).
3. **A04 ahora se llama**: dentro de `resolveRuntimeIdentityContext` (`runtimeIdentityContext.ts`), inmediatamente despues de (2) - una sola vez por turno, nunca por capability, nunca por tool call (cumple la preferencia explicita del enunciado, PARTE 1).
4. **Consumers**: los cuatro runtimes (`CommercialWork`, multi-request, Agent Tool Loop, legacy) reciben el mismo `session.decision.runtimeIdentity` via `snapshot.customerSession` - ver seccion 8.

## 3. RuntimeIdentityContext (PARTE 2)

`lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext.ts`:

```ts
type RuntimeIdentityStatus =
  | "ANONYMOUS" | "CHANNEL_OBSERVED" | "MASTER_RESOLVED" | "PRESTASHOP_LINKED"
  | "NEEDS_VERIFICATION" | "READY_TO_LINK" | "AMBIGUOUS" | "CONFLICT" | "SYSTEM_UNAVAILABLE";

// Reusa IdentityLevel de A04 directamente - nunca una copia redefinida.
type RuntimeIdentityLevel = IdentityLevel;

type RuntimeIdentityContext = {
  status: RuntimeIdentityStatus;
  identityLevel: RuntimeIdentityLevel;
  masterCustomerId: string | null;
  prestashopCustomerId: string | null;
  verificationRequired: boolean;
  requiredEvidence: readonly IdentityEvidenceSignalType[];
  readyToLink: boolean;
  conflictCode: string | null;
  policyCode: string;
  evidenceRefs: readonly string[];
};
```

Diferencia deliberada del sketch conceptual del enunciado: se reusa `IdentityLevel` de `customer-identity-verification` en vez de redefinir los cuatro niveles por segunda vez (YAGNI - el enunciado mismo autoriza "no copiar literalmente si el codebase ofrece mejor shape"). Sin `email`/`phone`/`wa_id`/filas `ps_customer`/referencias de orden/detalles SQL - verificado en runtime por `RIC12/RIC13/RIC14`.

## 4. Mapping A04 -> RuntimeIdentityContext (PARTE 3)

`mapIdentityVerificationDecisionToRuntimeIdentityContext` (pura, sin I/O):

| A04 `status` | A04 `identityLevel`/`currentLevel` | RuntimeIdentityContext |
|---|---|---|
| `NOT_LINKED` | `LEVEL_0_ANONYMOUS` | `ANONYMOUS` |
| `NOT_LINKED` | `LEVEL_1_CHANNEL_OBSERVED` | `CHANNEL_OBSERVED` |
| `NOT_LINKED` | `LEVEL_2_MASTER_RESOLVED` | `MASTER_RESOLVED` |
| `VERIFIED` | `LEVEL_3_PRESTASHOP_LINKED` | `PRESTASHOP_LINKED` |
| `READY_TO_LINK` | (siempre LEVEL_2 en A04) | `READY_TO_LINK`, `readyToLink: true`, `identityLevel` fijado a `LEVEL_2_MASTER_RESOLVED` (nunca LEVEL_3) |
| `NEEDS_VERIFICATION` | `currentLevel` | `NEEDS_VERIFICATION`, `verificationRequired: true`, `requiredEvidence` copiado tal cual |
| `AMBIGUOUS` | `currentLevel` | `AMBIGUOUS` |
| `IDENTITY_CONFLICT` | `currentLevel` | `CONFLICT`, `masterCustomerId: null` (nunca un lado del conflicto, misma disciplina que A04) |
| `SYSTEM_FAILURE` | (A04 nunca carga nivel aqui) | `SYSTEM_UNAVAILABLE`, `identityLevel: LEVEL_0_ANONYMOUS` como piso no autoritativo - todo consumidor debe verificar `status` antes de leer `identityLevel`/`masterCustomerId` |

Nunca se reinterpreta A04: cada rama de `decideIdentityVerification` mapea a exactamente una rama de esta funcion, sin logica de negocio adicional. Cubierto por `RIC01`-`RIC09`.

## 5. Call site real (PARTE 4)

`resolveRuntimeIdentityContext` se llama dentro de `resolveNativeCustomerSession.ts`, inmediatamente despues de `recordTurnIdentityEvidence` (linea ~183) - exactamente donde el enunciado prefiere, porque ahi ya convergen resolver local, onboarding state, trusted session y evidence hooks. No se duplica la evaluacion dentro de `CommercialWork` ni de ningun otro runtime - `runCommercialWorkInboundCycle.ts`, `runMultiRequestAutonomousCycle.ts` y `runNativeAgentToolLoopCycle.ts` nunca llaman a `evaluateIdentityVerification` ni a `resolveRuntimeIdentityContext` (verificado estructuralmente, `RIC15`/`RIC17`/`RIC18`).

## 6. A03 evidence ordering (PARTE 5)

Orden real en `resolveNativeCustomerSession.ts`:

```
identityService.resolveIdentity()   (calcula fresh detail)
  -> recordTurnIdentityEvidence()   (persiste evidence del turno actual)
    -> resolveRuntimeIdentityContext()  (A04 ve evidence ya persistida de ESTE turno)
```

`resolveRuntimeIdentityContext` nunca corre antes de `recordTurnIdentityEvidence` - si corriera antes, la verificacion veria la evidencia del turno N-1 (el bug que el enunciado advierte explicitamente). `RIC10` prueba directamente que un wa_id resuelto POR PRIMERA VEZ en el turno actual ya aparece como `LEVEL_2_MASTER_RESOLVED` en el mismo turno, sin necesitar un segundo turno.

## 7. freshStatus wiring (PARTE 6)

`resolveRuntimeIdentityContext` traduce `localResult.detail?.status` (A02, mismo turno) a `freshStatus` solo cuando es `"AMBIGUOUS"` o `"SYSTEM_FAILURE"` - los dos unicos valores que A04 acepta y que la evidencia durable no puede reconstruir por si sola (A04, PARTE 13). No se intenta persistir `AMBIGUOUS` en A05 - se sigue exactamente el contrato de A04 (`evaluateIdentityVerification(context, {freshStatus})`), sin inventar un segundo mecanismo.

## 8. LEVEL_3 live freshness (PARTE 7)

A04 dejo declarado explicitamente (seccion "Deudas explicitas") que el LEVEL_3 dependia solo de la evidencia durable escrita por A02 en el momento del bridge, sin un segundo lookup en vivo. Se cerro en este slice, dentro del propio dominio A04 (`lib/domains/customer-identity-verification/service.ts`, no en la capa de A05) porque es exactamente el mismo tipo de I/O que PARTE 22 de A04 ya autorizaba (un tercer lookup de solo lectura, mismo patron que el lookup de canal):

- `decideWithLiveLevel3Check` envuelve `decideIdentityVerification`: cuando el resultado puro es `VERIFIED`/`LEVEL_3_PRESTASHOP_LINKED`, hace un lookup adicional contra `customer_external_identity(provider="prestashop", external_id=prestashopCustomerId)` - la MISMA tabla que A02 ya consulto cuando escribio esa evidencia.
- Si el lookup falla (error de repositorio) -> `SYSTEM_FAILURE`, `policyCode: EVIDENCE_REPOSITORY_FAILURE` - nunca se degrada en silencio.
- Si el lookup no confirma (`customer_id` no coincide con el master, o la fila ya no existe) -> `NOT_LINKED` a `LEVEL_2_MASTER_RESOLVED`, `policyCode: PRESTASHOP_LIVE_LINK_STALE` (codigo nuevo, agregado a `IdentityVerificationPolicyCode`). Nunca se expone un LEVEL_3 conocido como stale.
- Se aplica tanto a `evaluateIdentityVerification` como a `evaluateEntityVerification` (LEVEL_4 hereda la misma disciplina - un LEVEL_3 stale nunca puede producir `VERIFIED_FOR_ENTITY`).
- `evaluate.ts` (la funcion pura, ya probada por 27 IVP tests) permanece completamente intacta - el nuevo lookup vive solo en la capa de I/O.

Nuevos tests `IVP25`/`IVP26` en `tests/domains/customerIdentityVerification.test.ts` prueban el downgrade (bridge revocado) y el fail-closed a `SYSTEM_FAILURE` (fallo del lookup) respectivamente. Los fixtures de integracion `IVP06/IVP07`/`IVP14/IVP15` (que antes solo escribian la fila de evidencia, sin la fila real en `customer_external_identity`) se corrigieron para sembrar tambien el bridge real via `linkChannelIdentity("prestashop", ...)` - sin este ajuste, el nuevo lookup los habria hecho fallar, porque ya no representaban con precision lo que un bridge real produce.

## 9. Runtime consumers (PARTE 10/11)

`CustomerSessionDecisionContext` (`session.decision`) es el boundary minimizado que los cuatro runtimes YA compartian antes de A05 (`snapshot.customerSession: CustomerSessionDecisionContext | null`, un unico tipo reusado en `buildNativeCommercialContext.ts`, `salesAgentTypes.ts`, `multi-request/planTurn.ts`, `multi-request/runMultiRequestAutonomousCycle.ts`, `multi-request/turnPlannerProvider.ts`). Se extendio ese boundary con el nuevo campo `runtimeIdentity: RuntimeIdentityContext` en vez de crear una segunda entrada - exactamente la preferencia del enunciado (PARTE 10).

| Runtime | Como lo recibe | Lo lee activamente? |
|---|---|---|
| CommercialWork (`runCommercialWorkInboundCycle.ts`) | `snapshot.customerSession.runtimeIdentity`, via `snapshot` | No - ningun archivo bajo `lib/brain/commercial/work/` referencia `runtimeIdentity` (verificado, `RIC15`/`RIC16`) |
| Multi-request (`runMultiRequestAutonomousCycle.ts` -> `planTurn.ts` -> `turnPlannerProvider.ts`) | mismo campo, incluido en `buildTurnPlanInputHash` (igual que el resto de `customerSession` ya lo estaba) | No - ningun archivo bajo `lib/brain/commercial/multi-request/` referencia `runtimeIdentity` (`RIC17`) |
| Agent Tool Loop (`runNativeAgentToolLoopCycle.ts`) | mismo campo, via `buildNativeBrainContextShim.ts` -> `snapshot.customerSession` | No - ningun archivo bajo `lib/brain/commercial/agent-loop/` referencia `runtimeIdentity` (`RIC18`); `buildAgentStepPromptPackage.ts` no serializa `customerSession` en absoluto hoy |
| Legacy (`runNativeAutonomousCycle.ts`, rama shadow/operational-loop) | mismo campo, via el mismo `snapshot` | No - mismo mecanismo, mismo boundary, sin lectura adicional |

Ningun runtime tiene una segunda evaluacion propia - los cuatro comparten la unica llamada a `resolveRuntimeIdentityContext` hecha en `resolveNativeCustomerSession` (cumple PARTE 11: "no crear cuatro evaluaciones distintas").

## 10. Fail-closed (PARTE 12)

`resolveRuntimeIdentityContext` envuelve la llamada a `evaluateIdentityVerification` en `try/catch` (defensa adicional sobre la garantia de A04 de nunca lanzar) - cualquier fallo, controlado o inesperado, produce `{status: "SYSTEM_UNAVAILABLE", identityLevel: "LEVEL_0_ANONYMOUS", masterCustomerId: null, ...}`. Nunca se fabrica `ANONYMOUS` como si fuera un hecho confirmado - `RIC09` prueba explicitamente que `SYSTEM_FAILURE` de A04 nunca produce el status `ANONYMOUS`.

## 11. Privacidad (PARTE 13)

`RuntimeIdentityContext` nunca contiene email/telefono/wa_id/filas de `ps_customer`/referencias de orden crudas - solo ids internos (`masterCustomerId`/`prestashopCustomerId`), codigos fijos (`status`/`identityLevel`/`policyCode`/`conflictCode`) y refs de evidencia opacos (`evidenceRefs`, ya redactados por A03). Se reviso cada serializer de prompt existente (`buildAgentStepPromptPackage.ts`, `salesAgentTypes.ts`) - ninguno serializa `customerSession`/`runtimeIdentity` hacia el LLM hoy, asi que no existe superficie de fuga nueva. `RIC12`/`RIC13`/`RIC14` prueban en runtime, con un turno real que declara email/telefono/wa_id crudos en el mensaje, que `JSON.stringify(decision.runtimeIdentity)` nunca los contiene.

## 12. Auditoria (PARTE 14)

Se agrego `identity_verification_decision_recorded` a `commercial_event` (`lib/brain/commercial/events/{types,normalize,dedupe,service}.ts`), siguiendo el mismo patron fail-safe de `identityAuditEvents.ts` (T07): `recordIdentityVerificationDecision` envuelve la escritura en `try/catch`, nunca bloquea ni cambia el resultado del turno. Payload: `status`, `identityLevel`, `policyCode`, `masterCustomerId`, `prestashopCustomerId`, `evidenceIds`, `conflictCode` - sin PII (los mismos campos que `RuntimeIdentityContext` ya garantiza limpios). `correlationId`/`conversationId`/`customerId` viven en las columnas top-level de `commercial_event`, nunca duplicados en el payload. `RIC21` prueba el contenido real contra MariaDB; `RIC22` prueba que un fallo del writer (dedupe key vacia) nunca propaga ni bloquea al caller.

## 13. Onboarding compatibility (PARTE 15)

No se toco `crm_customer_onboarding_state`, `runCustomerOnboardingPostPlanStage.ts` ni ningun flujo conversacional. `RuntimeIdentityContext.status` ya distingue los ocho estados necesarios para que un futuro `A06` decida cuando pedir que evidencia (`ANONYMOUS`/`CHANNEL_OBSERVED`/`MASTER_RESOLVED`/`PRESTASHOP_LINKED`/`NEEDS_VERIFICATION`/`READY_TO_LINK`/`CONFLICT`/`SYSTEM_UNAVAILABLE`), y `requiredEvidence` ya expone el vocabulario de senales sin definir ninguna pregunta.

## 14. Future omnichannel (PARTE 16)

`IdentityVerificationContext.provider`/`externalId` (A04) son genericos - la policy nunca hardcodea `"whatsapp"`. El unico lugar que sigue siendo especifico de WhatsApp es el adapter de inbound real: `resolveRuntimeIdentityContext` fija `provider: "whatsapp"` porque `resolveNativeCustomerSession` solo recibe inbound de WhatsApp hoy (mismo alcance que el resto del modulo `native-cycle`). `RIC23`/`RIC24` prueban, llamando a `evaluateIdentityVerification` directamente para un segundo provider (`instagram`), que un canal sin link propio nunca hereda el `LEVEL_2` de otro canal, y que un link explicito al mismo master en ambos canales resuelve `LEVEL_2` de forma independiente en cada uno - la arquitectura subyacente ya es multi-provider, aunque el unico adapter productivo actual sea WhatsApp.

## 15. Test Matrix (PARTE 17, RIC)

`tests/commercial/runtimeIdentityContext.test.ts`, 19 tests (9 puros de mapping + 2 de wiring/restart + 1 de privacidad + 4 estructurales + 3 de auditoria/omnicanalidad):

| ID | Cubierto por | Tipo |
|---|---|---|
| RIC01 | dedicado | puro |
| RIC02 | dedicado | puro |
| RIC03 | dedicado | puro |
| RIC04 | dedicado | puro |
| RIC05 | dedicado | puro |
| RIC06 | dedicado | puro |
| RIC07 | dedicado | puro |
| RIC08 | dedicado | puro |
| RIC09 | dedicado | puro |
| RIC10 | dedicado (integracion real) | DB |
| RIC11 | dedicado (restart real, `resetPoolForTests`) | DB |
| RIC12/RIC13/RIC14 | un unico test combinado (integracion real) | DB |
| RIC15/RIC16 | dedicado (estructural) | estructural |
| RIC17 | dedicado (estructural) | estructural |
| RIC18 | dedicado (estructural) | estructural |
| RIC19/RIC20 | un unico test combinado (estructural, solo import specifiers) | estructural |
| RIC21 | dedicado (integracion real) | DB |
| RIC22 | dedicado | puro (fail-safe) |
| RIC23/RIC24 | un unico test combinado (integracion real) | DB |

19/19 verdes.

Complementa, sin duplicar: `IVP25`/`IVP26` (nuevos, A04) cubren el LEVEL_3 live freshness a nivel de dominio; los 27 IVP originales siguen verdes sin cambios de aserciones salvo los dos fixtures corregidos (seccion 8).

## 16. Regresion (PARTE 18)

Ejecutado contra MariaDB real (`main_management`, contenedor `infra/docker-compose.dev.yml`, migraciones 001-032 aplicadas):

- `npx tsc --noEmit`: limpio.
- `npx eslint` sobre `lib/brain/commercial/native-cycle/customer-session/`, `lib/domains/customer-identity-verification/`, `lib/brain/commercial/events/`: limpio.
- `npm run build`: limpio.
- `tests/domains/customerIdentityVerification.test.ts` (A04 + LEVEL_3 live freshness): 29/29.
- `tests/commercial/runtimeIdentityContext.test.ts` (A05, nuevo): 19/19.
- `tests/domains/customerIdentityEvidence.test.ts`, `tests/commercial/customerSession.test.ts`, `customerSessionCustomer360Gate.test.ts`, `customerSessionPrivacy.test.ts`, `customerOnboardingPostPlanStage.test.ts`, `customerOnboardingPostPlanRuntime.test.ts`, `customerOnboardingPostPlanPrivacy.test.ts`, `customerIdentityAuditEvents.test.ts`, `identityCapabilityGatewaySummaries.test.ts`, `createCustomerCapability.test.ts`, `linkExternalIdentityCapability.test.ts`: 202/202.
- `tests/native/identity-conflict.test.ts`, `tests/commercial/nativeInboundIdentityBoundary.test.ts`, `tests/commercial/customerMasterProjectionGate.test.ts`, `tests/commercial/extractCustomerOnboardingFields.test.ts`: 31/31.
- `tests/e2e/customerIdentityOnboarding.e2e.test.ts`: 12/14 - las 2 fallas son `T08-A6`/`T08-A7`, ya documentadas como `PREEXISTING_FAILURE` en `docs/ACTIVE_RELEASE.md` y en el propio regreso de A02/A03 (falta de Customer Service desplegado, no relacionado a este cambio).
- `tests/commercial/commercialWorkInboundCycle.test.ts`: 10/10 (CommercialWork focused).
- `tests/commercial/multiRequestRuntime.test.ts` + `multiRequestCustomer360.test.ts`: 16/16 (multi-request focused).
- `tests/agent-loop/runNativeAgentToolLoopCycleConfig.test.ts`: 10/10; `runNativeAgentToolLoopCycleCustomerProfile.test.ts`: 4/4 (Agent Tool Loop focused).
- `tests/commercial/catalogRecommendationGatewayAdapter.test.ts` + `catalogRecommendationGatewayAdapterIntegration.test.ts`: 109/109.
- `tests/agent-loop/recommendCatalogProductsAgentLoopIntegration.test.ts`: 24/24 visibles, sin fallas (proceso sin `after`/`getPool().end()` en dos archivos de agent-loop preexistentes a esta tarea - el proceso de test no cierra solo tras el ultimo "ok"; no es un defecto de esta tarea, ver seccion Deudas).

Cero fallas nuevas atribuibles a este cambio.

## Deudas explicitas (no cerradas en A05, por diseno)

- `resolveRuntimeIdentityContext` fija `provider: "whatsapp"` porque el unico adapter de inbound real hoy es WhatsApp - la policy subyacente (A04) ya es provider-neutral (seccion 14), pero un segundo adapter de inbound (Instagram, por ejemplo) necesitaria su propio call site, no una rama condicional en este.
- Dos archivos de test preexistentes a esta tarea (`tests/agent-loop/runNativeAgentToolLoopCycleCustomerProfile.test.ts`, `tests/agent-loop/recommendCatalogProductsAgentLoopIntegration.test.ts`) no cierran el pool de MariaDB en un hook `after` - el proceso de `node --test` para esos dos archivos no termina solo tras el ultimo test en verde (hay que interrumpirlo). No es una regresion de A05 (no se toco ninguno de los dos archivos en su estructura de hooks, solo se agrego el campo `runtimeIdentity` a fixtures ya existentes) - queda registrado como deuda de infraestructura de tests preexistente.
- `docs/CAPABILITY_MATRIX.md` no se toco: `RuntimeIdentityContext`/`resolveRuntimeIdentityContext` no son un tool/capability agent-callable - mismo criterio ya documentado ahi para `customer_onboarding_state` y para A03/A04.
- `docs/ACTIVE_RELEASE.md` no se toco: mismo precedente que A01-A04 (el track `SALES-AGENT-R2-ID-R2` se documenta unicamente via sus propios archivos `docs/releases/SALES-AGENT-R2-ID-R2-*.md`).
- Los otros tres runtimes (multi-request, Agent Tool Loop, legacy) reciben `runtimeIdentity` pasivamente pero **ninguno lo usa todavia para nada** (ni siquiera logging) - deliberado (PARTE 8: "A05 no debe contener reglas"), pendiente para `A06`.

## Next slice

**`ID-R2-A06` - Commercial Identity Requirement Policy**: dado `operation`/`objective` + `RuntimeIdentityContext` actual, decidir `sufficient` / `onboarding_required` / `conflict` / `system_wait`. Ese slice decide, por ejemplo, que catalogo no requiere onboarding, que venta asistida puede pedir email, que recompra requiere LEVEL_3, que order status requiere `evaluateEntityVerification` (LEVEL_4) - ninguna de esas reglas existe todavia en el repo. Checkout, cuando se habilite, declarara su propio requirement contra este mismo `RuntimeIdentityContext` sin que este slice necesite cambiar.

## Criterio de salida - checklist

1. A04 se ejecuta en runtime real - seccion 5. OK
2. `RuntimeIdentityContext` existe - seccion 3. OK
3. Same-turn evidence entra en la decision - seccion 6, `RIC10`. OK
4. `freshStatus` se propaga - seccion 7. OK
5. R2 recibe el context - seccion 9. OK
6. Comportamiento R2 no cambia todavia - seccion 9, `RIC15`-`RIC18`. OK
7. Otros runtimes no sufren regresion - seccion 16. OK
8. LEVEL_3 no se expone desde un bridge conocido como stale - seccion 8, `IVP25`/`IVP26`. OK
9. Errores son fail-closed - seccion 10, `RIC09`. OK
10. No se expone PII - seccion 11, `RIC12`-`RIC14`. OK
11. Audit event es seguro - seccion 12, `RIC21`/`RIC22`. OK
12. Wiring es provider-neutral - seccion 14, `RIC23`/`RIC24`. OK
13. Checkout availability no afecta Identity - `RIC19`/`RIC20`. OK
14. No se inicia onboarding - seccion 13. OK
15. No se ejecuta create/link - sin cambios sobre A02/A03/A04 en ese aspecto. OK
16. No se modifica planning - seccion 9, verificado estructuralmente. OK
17. Tests runtime y privacidad verdes - seccion 15/16. OK
18. Queda definido A06 como consumidor de este context - seccion "Next slice". OK
