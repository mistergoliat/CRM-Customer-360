# SALES-AGENT-R2-ID-R2-A04 - Identity Verification Policy

## Veredicto

`ID_R2_A04_VERIFICATION_POLICY_VALIDATED`

## Baseline

- `docs/audits/SALES-AGENT-R2-ID-R2-A01-existing-identity-onboarding-engine-reuse-audit.md` - veredicto `IDENTITY_ENGINE_HYBRID_REUSE`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A02-canonical-candidate-resolver-evidence-contract.md` - veredicto `ID_R2_A02_CANDIDATE_RESOLVER_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A03-durable-identity-evidence-corrections.md` - veredicto `ID_R2_A03_DURABLE_IDENTITY_EVIDENCE_VALIDATED`.

Revalidado contra `develop`: `lib/domains/customer-identity/*` (A02) y `lib/domains/customer-identity-evidence/*` (A03) siguen exactos - sin drift. Esta tarea agrega un dominio nuevo, `lib/domains/customer-identity-verification/*`, que **lee** de ambos pero no los modifica en su comportamiento (una unica adicion aditiva se explica en la seccion "Cambio aditivo sobre A03" mas abajo).

## Alcance real de esta tarea

Solo se construyo el dominio de policy (schema/tipos, logica pura, wrapper de I/O) y su suite de tests. **No se conecto a ningun runtime todavia** (ni `resolveNativeCustomerSession`, ni `runCustomerOnboardingPostPlanStage`, ni onboarding conversacional) - el enunciado (PARTE 17) pide explicitamente "solo definir boundary usable", no el planner conversacional, y ninguna otra PARTE exige wiring de runtime. La conexion real queda para el siguiente slice (ver "Next slice").

## 1. Identity Levels (PARTE 1)

```
LEVEL_0_ANONYMOUS
LEVEL_1_CHANNEL_OBSERVED
LEVEL_2_MASTER_RESOLVED
LEVEL_3_PRESTASHOP_LINKED
```

`LEVEL_4` no es un nivel mas de esta lista (ver PARTE 7 abajo) - es un resultado *scoped*, nunca un valor de `IdentityLevel`.

| Nivel | Prerequisites | Evidence minima | Lifetime | Downgrade | Que NO implica |
|---|---|---|---|---|---|
| `LEVEL_0_ANONYMOUS` | Ninguno. | Sin fila en `customer_external_identity` para el `(provider, externalId)` actual. | Instantaneo - se recalcula cada llamada, nunca se cachea. | N/A. | Que el interlocutor no exista en absoluto - solo que este canal nunca fue observado. |
| `LEVEL_1_CHANNEL_OBSERVED` | Una fila `customer_external_identity` existe para el canal actual. | La fila, con `customer_id IS NULL`. | Mientras la fila siga sin `customer_id`. | Automatico - cualquier evidencia CONFLICTED lo baja a `IDENTITY_CONFLICT` en el resultado, aunque `currentLevel` se sigue reportando. | Que el customer no exista - solo que este canal no esta vinculado todavia. Nunca autoriza crear un customer por si solo. |
| `LEVEL_2_MASTER_RESOLVED` | `customer_external_identity.customer_id` no nulo para el canal actual, O evidencia `phone`/`customer_service` durable con `masterCustomerId`. | Fila canonica O evidencia `wa_id`/`phone` `OBSERVED`\|`CANDIDATE`\|`VERIFIED` con `masterCustomerId`. | Mientras la asociacion siga vigente (no hay TTL). | Una evidencia `CONFLICTED` que involucre el mismo master. | Que exista cuenta PrestaShop vinculada. Nunca autoriza operaciones sensibles. |
| `LEVEL_3_PRESTASHOP_LINKED` | `LEVEL_2` + un bridge **canonico** (`customer_external_identity(provider="prestashop")`) confirmado. | Evidencia `prestashop_customer_id`, `source: "customer_external_identity"`, `status: VERIFIED`. | Mientras el bridge siga vigente. | Conflicto en el bridge (`prestashop_link_vs_wa_phone`/`prestashop_id_multi_master`). | Que el interlocutor este verificado para NINGUNA orden/operacion especifica - eso es siempre `LEVEL_4` scoped, nunca heredado de `LEVEL_3`. |

## 2. Sin scoring agregado (PARTE 2)

Cero `confidence` numerico, cero promedios, cero umbral. Toda la logica de `evaluate.ts` son comparaciones deterministicas sobre campos discretos (`status`, `source`, `signalType`, igualdad de ids) - documentado inline con la regla del enunciado que cada rama implementa (Casos A/B/C de PARTE 5, Reglas 1/2/5/6 de A02 via `mapConflictCodeToPolicyCode`).

## 3. Verification Outcome (PARTE 3)

```ts
type IdentityVerificationDecision =
  | { status: "VERIFIED"; identityLevel; masterCustomerId: string; prestashopCustomerId: string | null; currentLevel; evidenceIds; policyCode }
  | { status: "READY_TO_LINK"; masterCustomerId: string; prestashopCustomerId: string; currentLevel; evidenceIds; policyCode }
  | { status: "NEEDS_VERIFICATION"; requiredEvidence; currentLevel; masterCustomerId; evidenceIds; policyCode }
  | { status: "AMBIGUOUS"; currentLevel; masterCustomerId; evidenceIds; policyCode }
  | { status: "IDENTITY_CONFLICT"; conflictCode; currentLevel; masterCustomerId: null; evidenceIds; policyCode }
  | { status: "NOT_LINKED"; currentLevel; masterCustomerId; evidenceIds; policyCode }
  | { status: "SYSTEM_FAILURE"; retryable: boolean; policyCode };
```

Diferencia deliberada del sketch del enunciado: **todas** las ramas salvo `SYSTEM_FAILURE` cargan `currentLevel` y `masterCustomerId` (el sketch los omitia en varias) - un consumidor nunca tiene que re-derivar "en que nivel/master estabamos" a partir de solo el `status` (PARTE 20, auditabilidad). `masterCustomerId` es siempre `null` en `IDENTITY_CONFLICT`, incluso si el calculo base ya habia resuelto un master - misma disciplina que A02 (`evidence.ts`: un conflicto nunca elige un lado).

## 4. LEVEL_1 (PARTE 4)

Requiere solo una fila `customer_external_identity` para el canal/provider actual con `customer_id IS NULL`. Nunca crea customer. Cubierto por `IVP02`.

## 5. LEVEL_2 (PARTE 5)

Tres casos, en orden de precedencia (`evaluate.ts#computeBaseLevel`):

- **Caso A** - el wa_id actual ya esta canonicamente vinculado (`customer_external_identity.customer_id` no nulo). `policyCode: EXISTING_CHANNEL_LINK`. `IVP01`.
- **Caso B** - evidencia `phone` durable con `masterCustomerId` (el resolver de A02 ya llama "identified" a un match de telefono cross-provider, `matchedBy: "phone"`, aunque A03 lo clasifique inicialmente como `CANDIDATE` en vez de `VERIFIED` - la policy confia en esa decision del resolver, no la re-cuestiona). `policyCode: PHONE_EVIDENCE_MASTER_CONVERGED`.
- **Caso C** - evidencia `source: "customer_service"` `VERIFIED` con `masterCustomerId` (proyeccion local confirmada). `policyCode: MASTER_FROM_CUSTOMER_SERVICE`. Ningun caller real produce esta evidencia todavia (el flujo `resolve_customer` de Customer Service no pasa por A03 hoy) - la rama existe para que la policy sea provider/source-aware desde el dia uno, no una deuda oculta.

**Email solo nunca resuelve LEVEL_2** - `computeBaseLevel` no mira evidencia `email`/`prestashop_customer_id`/`order_reference` en absoluto. `IVP03`.

## 6. LEVEL_3 (PARTE 6)

Requiere una fila de evidencia `signalType: "prestashop_customer_id"`, `source: "customer_external_identity"`, `status: "VERIFIED"` cuyo `masterCustomerId` coincida con el master ya resuelto en LEVEL_2. Esa combinacion exacta (`source: "customer_external_identity"`) es la que A02 escribe **solo** cuando el bridge (`findCustomerByExternalIdentity({provider:"prestashop",...})`) confirmo un link real - nunca para un candidato sin vincular (esos llegan con `source: "prestashop"`, ver PARTE 14). No se agrego SQL nueva contra `ps_customer`/`ps_orders`: la distincion candidate-vs-canonico ya vive en el campo `source` que A02/A03 escriben. `IVP06` (VERIFIED)/`IVP07` (conflicto).

## 7. LEVEL_4 (PARTE 7)

Nunca es un valor de `IdentityLevel`. Es el unico resultado de `evaluateEntityVerification`/`decideEntityVerification` (`lib/domains/customer-identity-verification/evaluateEntity.ts`):

```ts
type IdentityEntityVerificationDecision =
  | { status: "VERIFIED_FOR_ENTITY"; entityType; masterCustomerId; prestashopCustomerId; verifiedAt; evidenceIds; policyCode }
  | { status: "NOT_VERIFIED_FOR_ENTITY"; entityType; reason; evidenceIds; policyCode }
  | { status: "SYSTEM_FAILURE"; retryable; policyCode };
```

Exige, en orden: (1) el `IdentityVerificationDecision` base de la conversacion debe ser `VERIFIED` en `LEVEL_3_PRESTASHOP_LINKED`; (2) debe existir evidencia `order_reference` corriente cuyo `signalHash` coincida con el hash del `entityRef` que el caller pregunta (mismo `hashSignalValue` que A03 ya usa - nunca un segundo almacen de valores crudos); (3) esa evidencia debe apuntar al **mismo** `prestashopCustomerId` que el LEVEL_3 ya confirmado. Un resultado `VERIFIED_FOR_ENTITY` para la orden `ABC123` no dice nada sobre ninguna otra orden, ni sobre cambiar email, ni sobre relinkear un canal - cubierto explicitamente por `IVP14`/`IVP15`.

## 8. Email policy (PARTE 8)

- Email exacto unico -> evidencia `CANDIDATE`/`OBSERVED` en el track PrestaShop -> `NEEDS_VERIFICATION`, en cualquier nivel base (incluso `LEVEL_0`). `IVP03`.
- Email + order convergen (ya verificado por A02, `Regla 5`) -> evidencia `VERIFIED`, `source: "prestashop"` -> `READY_TO_LINK`, nunca auto-link. `IVP04`.
- Email contradice el master ya vinculado -> A02 ya produce `CONFLICTED` (`email_vs_order_prestashop_id`/`prestashop_link_vs_wa_phone`) -> `IDENTITY_CONFLICT`. `IVP05`/`IVP07`.
- Email corregido -> la fila vieja queda `SUPERSEDED` en A03 y el read boundary de A03 ya la excluye - la policy nunca la ve. `IVP09`.

## 9. Order ownership policy (PARTE 9)

Reutiliza integramente el mecanismo minimo que A02 ya implemento y A03 ya persiste (`docs/releases/.../A02...md`, seccion 9, "Path A/B") - esta tarea **no** agrega una segunda comparacion `ps_orders.id_customer` vs `ps_customer.id_customer`. Cuando esas dos fuentes convergen, A02 ya marca la evidencia `prestashop_customer_id` como `strength: "verified"`; cuando divergen, ya la marca `CONFLICTED`. La policy solo lee ese resultado. `orderReference` sola (sin la convergencia de A02) nunca adjudica master - cae en `NEEDS_VERIFICATION` igual que email solo. Nunca eleva a `LEVEL_4` sin un `entityRef` explicito (seccion 7).

## 10. Channel control (PARTE 10)

`IdentityVerificationContext` recibe `provider`/`externalId` explicitos y la evaluacion es estrictamente por conversacion: `computeBaseLevel` solo consulta `customer_external_identity` para el `(provider, externalId)` de la llamada actual, nunca infiere "control de WhatsApp implica control de Instagram" ni ningun otro canal. `IVP16` prueba esto con dos conversaciones reales de providers distintos. `channelEvidence` (`observed`/`controlled`/`verified`) es un campo de A03 que la policy respeta pero nunca reinterpreta con semantica especifica de WhatsApp.

## 11. Freshness (PARTE 11)

`decideIdentityVerification` filtra explicitamente `STALE` (nunca eleva nivel) y separa `CONFLICTED` (nunca eleva, pero gana precedencia - seccion 12) del resto ("usable"). `SUPERSEDED`/`REVOKED` ya estan excluidos por el propio query de A03 (`getCurrentEvidenceForConversationOrFail`, `status NOT IN ('SUPERSEDED','REVOKED')`) - la policy no los vuelve a filtrar porque nunca los recibe. Sin TTL numerico inventado en ningun punto. `IVP09`/`IVP10`/`IVP11`.

Para el link canonico vigente (`customer_external_identity`), la policy **si** hace una lectura controlada en vivo (`findExternalIdentityByProviderExternalId`) en cada llamada - nunca confia en un snapshot persistido de "el link estaba vigente en el turno X". Esto cierra exactamente el gap que A03 dejo declarado como deuda ("freshness no cruza contra el estado vigente de `customer_external_identity`") para el caso de LEVEL_2 via wa_id; el caso LEVEL_3 (bridge PrestaShop) sigue dependiendo de la evidencia durable de A03 (`source: "customer_external_identity"`, escrita en el momento del bridge) porque no existe hoy un segundo lookup en vivo equivalente para `provider="prestashop"` fuera del resolver mismo - declarado como deuda explicita, no una omision silenciosa.

## 12. Conflict precedence (PARTE 12)

`decideIdentityVerification` chequea evidencia `CONFLICTED` **antes** de cualquier otra rama (incluso antes de `freshStatus`). Ninguna cantidad de senales convergentes debiles (`OBSERVED`/`CANDIDATE`) puede ganarle a un solo conflicto. `IVP23` prueba esto directamente: `LEVEL_2` via wa_id + email candidate + phone convergente + un conflicto -> `IDENTITY_CONFLICT` de todas formas. Nunca majority voting - basta una fila `CONFLICTED`.

Codigos de conflicto (PARTE 19) mapeados desde el vocabulario de A02 (`CustomerIdentityConflictType`, nunca redefinido):

| A02 `conflictCode` | A04 `policyCode` |
|---|---|
| `external_identity_vs_phone` | `CHANNEL_MASTER_CONFLICT` |
| `phone_ambiguous` | `CHANNEL_MASTER_CONFLICT` |
| `prestashop_link_vs_wa_phone` | `PRESTASHOP_MASTER_CONFLICT` |
| `prestashop_id_multi_master` | `PRESTASHOP_MASTER_CONFLICT` |
| `email_vs_order_prestashop_id` | `EMAIL_ORDER_CONFLICT` |
| (desconocido/null) | `IDENTITY_EVIDENCE_CONFLICT` |

## 13. Ambiguity vs. Conflict (PARTE 13)

Distincion real, no cosmetica: A02 (`evidence.ts`) **nunca** escribe una fila de evidencia para su resultado `AMBIGUOUS` (email/orden con multiples matches en la misma fuente) - no hay nada que converger, asi que no hay nada que persistir con el vocabulario de `IdentityEvidenceStrength` actual (`observed|candidate|strong|verified|conflict`, sin un valor "ambiguous"). Esto significa que la ambiguedad de un turno **no sobrevive** en la evidencia durable por diseno de A02/A03 - un gap real, documentado aqui, no inventado por esta tarea.

Solucion adoptada: `evaluateIdentityVerification(context, { freshStatus })` acepta opcionalmente el `detail.status` del mismo turno (traducido a `"AMBIGUOUS"|"SYSTEM_FAILURE"`) - exactamente el mismo patron que A01/A02 ya establecieron para "fresh evidence del turno actual" vs. "evidence durable" (`freshExternalResolutionEvidence` en `resolveNativeCustomerSession`). Sin ese parametro, la policy nunca puede reportar `AMBIGUOUS` por si sola desde evidencia durable - se degrada correctamente a lo que la evidencia si sostiene (`NOT_LINKED`/`NEEDS_VERIFICATION`). `IVP13`.

## 14. READY_TO_LINK (PARTE 14)

Se introdujo el outcome explicito. Requiere: master resuelto (LEVEL_2) + evidencia `prestashop_customer_id` `VERIFIED` con `source: "prestashop"` (candidato fuerte, cross-source-converged) + ausencia de bridge canonico + ausencia de conflicto. **Nunca ejecuta un link** - `evaluateIdentityVerification`/`decideIdentityVerification` no importan el Capability Gateway ni `link_external_identity` en ningun punto (verificado estructuralmente, `IVP20`). Documentado explicitamente: `READY_TO_LINK` no es `LEVEL_3` - un futuro workflow de mutacion (fuera de alcance de A04) decidiria si ese link se autoriza de verdad. `IVP04`/`IVP08`.

## 15. READY_TO_CREATE (PARTE 15)

**No se agrego una funcion nueva.** Las reglas de elegibilidad para `create_customer` (purpose permitido, onboarding activo, `resolve_customer` `no_match` fresco, consentimiento del turno actual, campos minimos) ya viven completas y correctas en `runCustomerOnboardingPostPlanStage.ts` (ACS-R1-04). Duplicarlas aqui violaria la instruccion explicita del enunciado ("no duplicarlas si ya estan correctamente implementadas"). La relacion es documental: un `IdentityVerificationDecision` en `LEVEL_0`/`LEVEL_1` (sin `IDENTITY_CONFLICT`) es una condicion **necesaria pero no suficiente** para que `create_customer` sea elegible - el runtime existente ya verifica un conjunto equivalente de senales localmente (`identity.status === "anonymous"`/`"identification_required"`) sin necesitar este modulo. No se creo codigo muerto sin caller.

## 16. Relacion con Customer Service (PARTE 16)

El dominio entero (`evaluate.ts`, `evaluateEntity.ts`, `service.ts`) nunca importa `executeGovernedCapability`, el Capability Gateway, ni ningun adapter de Customer Service. Solo lee (`findExternalIdentityByProviderExternalId`, `getCurrentEvidenceForConversationOrFail`). Nunca escribe `master_customer` ni `customer_external_identity`, nunca llama `create_customer`/`link_external_identity`. Verificado estructuralmente por `IVP20`/`IVP21` (grep del codigo fuente real, no solo una promesa en un comentario).

## 17. Relacion con Onboarding (PARTE 17)

Se definio el boundary (`IdentityVerificationDecision.status`/`requiredEvidence`), consumible por un futuro planner conversacional (ej.: `NEEDS_VERIFICATION` con `requiredEvidence: ["order_reference"]` -> "¿tienes el numero de tu ultima compra?"). **No se implemento el planner** - explicitamente fuera de alcance (enunciado, PARTE 17) y no conectado a `crm_customer_onboarding_state` en este slice.

## 18. Omnicanalidad (PARTE 18)

`IdentityVerificationContext.provider`/`externalId` son genericos - nada hardcodea `"whatsapp"`. `IVP16` prueba que un master vinculado en WhatsApp no le da nada a una conversacion de Instagram sin su propio link canonico; `IVP17` prueba que dos canales **cada uno con su propio link canonico** al mismo master resuelven independientemente el mismo `LEVEL_2` (el mecanismo omnicanal correcto: adjudicacion explicita via `customer_external_identity`, nunca inferencia); `IVP18` prueba que el mismo email observado en dos conversaciones/providers nunca se fusiona automaticamente (cada evaluacion es estrictamente por `conversationId`, nunca cruza evidencia entre conversaciones).

## 19. Policy codes (PARTE 19)

Union `IdentityVerificationPolicyCode` (`lib/domains/customer-identity-verification/types.ts`) - 19 codigos fijos, nunca prosa. Cada rama de `decideIdentityVerification`/`decideEntityVerification` retorna exactamente uno.

## 20. Auditability (PARTE 20)

Cada `IdentityVerificationDecision`/`IdentityEntityVerificationDecision` ya carga `policyCode` + `evidenceIds` + `currentLevel`/`masterCustomerId` (seccion 3) - suficiente para que un futuro caller explique la decision sin re-consultar nada. **No se agrego un nuevo evento a `commercial_event`** en este slice: el enunciado lo deja como "evaluar", y sin un caller real todavia (seccion "Alcance real" arriba) no hay turno del que emitir un evento - agregar uno ahora seria codigo sin invocador (YAGNI). Cuando el siguiente slice conecte esta policy a un runtime, debe reusar el patron ya existente (`identityAuditEvents.ts`, fail-safe, nunca bloqueante) en vez de inventar un segundo mecanismo.

## 21. Privacidad (PARTE 21/23)

Ningun valor crudo (email/telefono/wa_id/fila de `ps_customer`) sale de este dominio en ningun momento - todo lo que retorna son ids derivados (`masterCustomerId`, `prestashopCustomerId`), `evidenceId`s, y codigos. `entityRef` (la referencia de orden que un caller pasa a `evaluateEntityVerification`) se hashea inmediatamente con la misma funcion que A03 ya usa (`hashSignalValue`) y nunca se persiste ni se loguea en texto plano por este dominio.

## Cambio aditivo sobre A03

`lib/domains/customer-identity-evidence/repository.ts` gano `getCurrentEvidenceForConversationOrFail` (retorna `{ok,error}` en vez de tragarse el fallo como `[]`) - `getCurrentEvidenceForConversation` se reescribio para llamarla y desenvolver el resultado, **firma identica, comportamiento identico** para todo caller existente (A03 lo sigue usando sin cambios; sus 18 tests siguen 18/18 verdes). Sin este cambio, A04 no podia distinguir "sin evidencia" de "la consulta fallo" (IVP19) - exactamente el problema que A03 mismo dejaba abierto para un consumidor que necesite fail-closed real. `index.ts` de A03 tambien gano `export * from "./redact"` (expone `hashSignalValue`, ya usado internamente por A03, ahora reutilizado por A04 para el hash de `entityRef` - PARTE 21).

## Test Matrix (PARTE 21 del enunciado, IVP)

`tests/domains/customerIdentityVerification.test.ts`, 27 tests (16 puros sin DB + 9 de integracion contra MariaDB real + 2 estructurales):

| ID | Cubierto por |
|---|---|
| IVP01 | dedicado (puro) |
| IVP02 | dedicado (puro) |
| IVP03 | dedicado (puro) |
| IVP04 | dedicado (puro) |
| IVP05 | dedicado (puro) |
| IVP06 | dedicado (puro + integracion real) |
| IVP07 | dedicado (puro + integracion real) |
| IVP08 | dedicado (puro + integracion real) |
| IVP09 | dedicado (puro + integracion real, junto a IVP10) |
| IVP10 | integracion real (junto a IVP09) |
| IVP11 | dedicado (puro) |
| IVP12 | dedicado |
| IVP13 | dedicado (puro) |
| IVP14 | integracion real (junto a IVP15) |
| IVP15 | integracion real (junto a IVP14) |
| IVP16 | dedicado (puro + integracion real) |
| IVP17 | integracion real |
| IVP18 | integracion real |
| IVP19 | dedicado (dependency injection, fallo real simulado) |
| IVP20 | estructural |
| IVP21 | estructural (junto a IVP20) |
| IVP22 | estructural |
| IVP23 | dedicado |
| IVP24 | integracion real (restart real via `resetPoolForTests`) |

27/27 verdes.

## Regresion (PARTE 24)

Contra MariaDB real (`main_management`, migraciones 001-032, seed de fixtures aplicado):

- `npx tsc --noEmit`: limpio.
- `npx eslint` sobre archivos nuevos/tocados: limpio.
- `npm run build`: limpio.
- `tests/domains/customerIdentityVerification.test.ts`: 27/27.
- `tests/domains/customerIdentityEvidence.test.ts` (A03, tras el cambio aditivo): 18/18, sin cambios de aserciones.
- `tests/domains/customerIdentity.test.ts`, `customerOnboarding.test.ts`, `tests/commercial/customerSession.test.ts`, `customerSessionCustomer360Gate.test.ts`, `customerSessionPrivacy.test.ts`, `customerOnboardingPostPlanStage.test.ts`, `customerOnboardingPostPlanRuntime.test.ts`, `customerOnboardingPostPlanPrivacy.test.ts`, `extractCustomerOnboardingFields.test.ts`, `customerIdentityCapabilityGateway.test.ts`, `customerIdentityAuditEvents.test.ts`, `identityCapabilityGatewaySummaries.test.ts`, `customerMasterProjectionGate.test.ts`, `tests/native/identity-conflict.test.ts`, `nativeInboundIdentityBoundary.test.ts`, `tests/e2e/customerIdentityOnboarding.e2e.test.ts`: 333/335 (variables `DATABASE_*` exportadas en el shell) - las 2 fallas son `T08-A6`/`T08-A7`, ya documentadas como `PREEXISTING_FAILURE` en `docs/ACTIVE_RELEASE.md` y en el propio regreso de A02 (falta de Customer Service desplegado, no relacionado a identidad/evidence/verification).

Cero fallas nuevas atribuibles a este cambio.

## Deudas explicitas (no cerradas en A04, por diseno)

- Freshness de LEVEL_3 no hace un segundo lookup en vivo contra `customer_external_identity(provider="prestashop")` - depende de la evidencia durable escrita por el bridge de A02 en el momento en que corrio (seccion 11). Un link revocado despues de esa escritura, sin que el resolver haya vuelto a correr, seguiria pareciendo `VERIFIED` hasta el proximo turno.
- Ninguna evidencia de `AMBIGUOUS` sobrevive un restart por si sola (seccion 13) - requiere que el caller pase `freshStatus` en el mismo turno; A02/A03 no persisten esa senal.
- No se conecto a ningun runtime (`resolveNativeCustomerSession`, onboarding post-plan, CommercialWork) - deliberado, ver "Alcance real" y "Next slice".
- No se agrego auditoria a `commercial_event` - sin caller real todavia, ver seccion 20.
- `docs/CAPABILITY_MATRIX.md` no se toco: este dominio no es un tool/capability agent-callable, mismo criterio que A03.
- `docs/ACTIVE_RELEASE.md` no se toco: mismo precedente que A01/A02/A03 (track `SALES-AGENT-R2` documentado solo via sus propios archivos `docs/releases/SALES-AGENT-R2-*.md`).

## Next slice

Create/link actuales (`createCustomerCapability.ts`/`linkExternalIdentityCapability.ts`, ACS-R1-04) ya satisfacen su propia policy de autoridad (consentimiento, `no_match` fresco, projection gate) - **no** necesitan hardening adicional motivado por A04, porque A04 nunca les exige nada nuevo (nunca los llama, nunca cambia su contrato). Eso deja como siguiente paso natural:

**`ID-R2-A05` - CommercialWork Identity Integration Preparation**: conectar `evaluateIdentityVerification`/`evaluateEntityVerification` a un call site real (probablemente el mismo punto de `resolveNativeCustomerSession` donde A03 ya persiste evidencia), y decidir como `IdentityVerificationDecision` informa a R2 sin exponerle email/telefono/reglas internas - exactamente el objetivo final que motivo A02/A03/A04.

No se conecta Customer Profile hasta que `LEVEL_3` tenga un consumidor real que lo necesite (Customer Profile sigue fuera de alcance, como en A01/A02/A03).

## Criterio de salida - checklist

1. Identity levels con semantica explicita - seccion 1. OK
2. Email solo no adjudica ownership - `IVP03`. OK
3. Order ownership refuerza/verifica candidate - seccion 9, `IVP04`. OK
4. Canonical PrestaShop link requisito para LEVEL_3 - seccion 6, `IVP06`/`IVP08`. OK
5. LEVEL_4 scoped, no permanente - seccion 7, `IVP14`/`IVP15`. OK
6. Stale/superseded/revoked evidence no eleva identidad - seccion 11, `IVP09`/`IVP10`/`IVP11`. OK
7. Conflict tiene precedencia - seccion 12, `IVP23`. OK
8. Ambiguity y conflict son estados distintos - seccion 13, `IVP13`. OK
9. Cross-channel evidence no auto-mergea - seccion 18, `IVP16`/`IVP18`. OK
10. Policy es provider-aware - seccion 10/18, `IVP16`/`IVP17`. OK
11. No existe scoring LLM - seccion 2, sin numeros agregados en ningun punto. OK
12. No ejecuta create/link - seccion 16, `IVP20`. OK
13. No escribe master_customer - seccion 16, `IVP21`. OK
14. Cada decision tiene policyCode + evidence refs - seccion 3/19. OK
15. Restart produce misma decision - `IVP24`. OK
16. Tests de conflicto/convergencia/scope verdes - ver Test Matrix, 27/27. OK
17. Queda definido que mutacion/linking corresponde al siguiente slice - ver "Next slice". OK
