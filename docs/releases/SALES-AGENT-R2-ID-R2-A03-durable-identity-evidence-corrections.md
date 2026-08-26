# SALES-AGENT-R2-ID-R2-A03 - Durable Identity Evidence + Corrections/Supersede

## Veredicto

`ID_R2_A03_DURABLE_IDENTITY_EVIDENCE_VALIDATED`

## Baseline

- `docs/audits/SALES-AGENT-R2-ID-R2-A01-existing-identity-onboarding-engine-reuse-audit.md` - veredicto `IDENTITY_ENGINE_HYBRID_REUSE`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A02-canonical-candidate-resolver-evidence-contract.md` - veredicto `ID_R2_A02_CANDIDATE_RESOLVER_VALIDATED`.

Revalidado contra HEAD (`develop`, tras merge de `feat/marketing-r1-t04-copilot-workspace` y `feat/catalog-console-v1`): los paths citados por A02 siguen exactos - `lib/domains/customer-identity/{types,service,evidence}.ts` no cambiaron, el resolver sigue siendo el unico entry point (`createCustomerIdentityResolutionService`), y su contrato `IdentityEvidence`/`IdentityResolutionDetail` (in-memory, PARTE 3 de A02) es el insumo que A03 persiste. No hubo drift entre A02 y esta tarea.

## 1. Decision de persistencia (PARTE 1/2)

Auditoria de la persistencia existente antes de crear schema nuevo:

| Tabla | Que ya persiste | Por que no alcanza para evidence durable |
|---|---|---|
| `commercial_event` (migration 011) | Eventos descriptivos por turno - `customer_identity_resolution_recorded`, `customer_onboarding_transition_recorded`, `customer_identity_capability_outcome_recorded` (ACS-R1-04-T07) | Una fila agregada por turno, no una fila por senal con lifecycle propio; sin supersede; consultar "evidence actual para signalType=X" requeriria funciones JSON sobre `payload_json` sin indice util. |
| `crm_capability_executions` (migration 022) | Auditoria de llamadas al Gateway (`resolve_customer`/`create_customer`/`link_external_identity`), `evidence_json` es un snapshot puntual | Solo cubre invocaciones al Gateway, no la evidencia local wa_id/phone/email/PrestaShop que el resolver computa cada turno sin llamar al Gateway. |
| `crm_customer_onboarding_state` (migration 023) | Snapshot operacional actual (`collected_json`) | Documentado explicitamente en su propia migracion como NO audit log; `collectFields` mergea/sobreescribe - una correccion pierde el valor anterior en la fila canonica hoy. |
| `customer_external_identity` (migration 010/024) | Link canonico vigente (`provider + external_id` unico) | Sin columna de historia/supersede; nunca penso en guardar candidatos no vinculados de otras fuentes (email, PrestaShop) que nunca se volvieron link. |

Ninguna de las cuatro puede representar el contrato de PARTE 3 (lifecycle, supersede, freshness, conflict group) sin repropositar una tabla para un trabajo distinto al que fue disenada.

**Decision: Opcion C (hibrida).** Tabla nueva `crm_customer_identity_evidence` (migration `032_crm_customer_identity_evidence.sql`) es la fuente durable de evidence; `commercial_event` queda sin cambios y sigue grabando los outcomes descriptivos por turno que ya gababa antes de A03. No se agrego un nuevo `event_type` para evidence individual - habria duplicado el mismo hecho en dos sistemas de auditoria sin ganar capacidad de consulta (PARTE 12 lo advierte explicitamente).

Volumen esperado: acotado. La mayoria de los turnos solo tocan wa_id (que rara vez cambia dentro de una conversacion, asi que en la practica genera una fila una sola vez por conversacion) mas, ocasionalmente, phone/email/order cuando el resolver los evalua o el cliente los declara en onboarding. No hay fan-out por mensaje de texto ni por candidato descartado.

PII: nunca se persiste email/telefono/wa_id crudos. Ver seccion Privacidad.

## 2. Schema (migration 032)

`crm_customer_identity_evidence` (ver el archivo de migracion para el DDL completo y su razonamiento in-line):

- `evidence_id` (CHAR(36), UUID, unico) - identificador logico externo, nunca el `id` autoincremental.
- `conversation_id` (FK `conversation.id`, CASCADE), `message_id`, `correlation_id`.
- `channel`, `provider`, `channel_evidence` (`observed|controlled|verified`, PARTE 10 - nulo salvo `wa_id`).
- `signal_type` (`wa_id|phone|email|prestashop_customer_id|order_reference|manual_verification`), `source` (`customer_external_identity|prestashop|order|manual|customer_service`).
- `source_record_ref`, `signal_hash` (SHA-256), `signal_display` (redactado) - nunca el valor crudo.
- `master_customer_id` (FK `master_customer.id`, `SET NULL`), `prestashop_customer_id` (string opaco, sin FK - misma decision que A02 tomo para el bridge).
- `strength` (vocabulario ID-R2-A02, fijo al escribir) y `status` (lifecycle, PARTE 4).
- `conflict_group_id`, `conflict_code` (PARTE 6).
- `observed_at`, `verified_at`, `superseded_at`, `superseded_by_evidence_id`, `stale_at`, `revoked_at`.
- `idempotency_key` (unico, PARTE 18), `metadata_json` (reducido, nunca texto de mensaje).

Indices: `(conversation_id, signal_type, status)`, `master_customer_id`, `prestashop_customer_id`, `conflict_group_id`, `status`, `correlation_id`.

## 3. Lifecycle (PARTE 4)

Estados: `OBSERVED -> CANDIDATE -> VERIFIED`, cualquiera de esos `-> CONFLICTED`, y cualquiera de esos (incluido `CONFLICTED`) `-> SUPERSEDED | STALE | REVOKED` (terminal). `SUPERSEDED`/`REVOKED` nunca vuelven a `VERIFIED` ni a ningun otro estado - solo una fila **nueva** puede avanzar la identidad de una senal.

El estado inicial de una fila se deriva deterministicamente del `strength`/`verified` que ID-R2-A02 ya calculo (`deriveInitialStatus`, `repository.ts`): `verified -> VERIFIED`, `strong|candidate -> CANDIDATE`, cualquier otro -> `OBSERVED`; si la llamada forma parte de un turno con `IDENTITY_CONFLICT`, el estado inicial es siempre `CONFLICTED` (nunca se infiere despues).

Transiciones expuestas (`repository.ts`, cada una valida su propio conjunto `from`):

- `markIdentityEvidenceVerified` (`OBSERVED|CANDIDATE -> VERIFIED`)
- `markIdentityEvidenceConflicted` (`OBSERVED|CANDIDATE|VERIFIED -> CONFLICTED`)
- `markIdentityEvidenceStale` (`OBSERVED|CANDIDATE|VERIFIED|CONFLICTED -> STALE`)
- `revokeIdentityEvidence` (cualquier no-terminal `-> REVOKED`)
- `supersedeIdentityEvidence` (cualquier no-terminal `-> SUPERSEDED`, siempre con `supersededByEvidenceId` apuntando a la fila nueva)

Ninguna de estas funciones esta expuesta como capability/tool - ver seccion Autoridad/LLM.

## 4. Corrections / supersede (PARTE 5)

`recordIdentityEvidence` (unico punto de escritura para filas nuevas) resuelve correcciones automaticamente, dentro de una transaccion (`withTransaction`):

1. Calcula `idempotencyKey` de `(conversationId, messageId, signalType, sourceRecordRef, valor-comparable)`. Si ya existe -> `status: "duplicate"`, ninguna fila nueva (PARTE 18).
2. `SELECT ... FOR UPDATE` de la(s) fila(s) actuales (no terminales) para `(conversationId, signalType)` - nunca a nivel de `masterCustomerId` (ver PARTE 9 mas abajo, por que el scope es por conversacion).
3. Si el `signal_hash` de la fila actual coincide con el nuevo valor -> observacion repetida, no correccion: se devuelve la fila existente sin insertar nada (`status: "unchanged"`), salvo que el turno sea un conflicto nuevo (en ese caso si se inserta, para que el conflict_group_id quede trazado).
4. Si el valor cambio -> se inserta la fila nueva y, en la misma transaccion, se marca la fila anterior `SUPERSEDED` con `superseded_by_evidence_id` apuntando a la nueva.

Ejemplo (email, turno 1 `a@x.cl` -> turno 2 `b@x.cl`): la fila de `a@x.cl` queda `SUPERSEDED`, la de `b@x.cl` queda `OBSERVED`/current. `getCurrentEvidenceForConversation` devuelve solo `b@x.cl`; `getHistoricalEvidence` devuelve ambas. Cubierto por el test `IDE03`.

Mismo mecanismo, sin codigo especial por campo, para `phone` (`IDE08`) y `order_reference`. `firstName`/`lastName` **no** son signal types de este contrato (PARTE 3 los excluye explicitamente de la lista de senales posibles) - siguen siendo datos de perfil de onboarding, no evidencia de identidad; una correccion de nombre no genera fila aqui, decision explicita, no un olvido.

## 5. Conflict model (PARTE 6)

Cuando el resolver (`localResult.detail.status === "IDENTITY_CONFLICT"`, ID-R2-A02) produce un conflicto en un turno, `recordIdentityEvidenceBatch` genera **un** `conflictGroupId` nuevo y lo aplica a **todas** las evidencias de ese turno, insertandolas directamente en `CONFLICTED` con el `conflictCode` real (vocabulario ya definido por A02: `prestashop_link_vs_wa_phone`, `email_vs_order_prestashop_id`, `prestashop_id_multi_master`, etc.). `getConflictEvidence(conflictGroupId)` reconstruye el grupo completo despues, sin depender de memoria de proceso. Cubierto por `IDE05`.

## 6. Freshness (PARTE 7)

Freshness se deriva **solo del lifecycle status**, nunca de un TTL numerico inventado:

```
computeEvidenceFreshness(record):
  SUPERSEDED | REVOKED -> "historical"
  STALE                -> "stale"
  cualquier otro        -> "current"
```

Decision explicita por signal type (documentada en el codigo, `service.ts`): `wa_id`/`prestashop_customer_id` deberian ademas depender de que su link en `customer_external_identity` siga activo, pero esta version no hace ese join - no existe todavia un writer de revocacion de `customer_external_identity` en el repo (confirmado por A01/A02), asi que esa capa adicional de freshness queda como deuda explicita, no una feature a medias.

## 7. Omnicanalidad (PARTE 9/10)

El schema nunca asume WhatsApp: `channel`/`provider` son columnas libres, `signalType`/`source` ya incluyen `manual`/`customer_service`/`prestashop`. `channel_evidence` (`observed|controlled|verified`) separa "canal visto" de "canal controlado" - solo se setea para `wa_id` (`"controlled"`, ver `identityEvidenceHooks.ts`), nunca generalizado a Instagram/Facebook con la misma semantica de consentimiento de WhatsApp (PARTE 10 lo prohibe explicitamente).

`IDE10`/`IDE20`: el mismo email observado en dos conversaciones/providers distintos coexiste como dos filas `current` independientes - nunca se fusionan ni se comparan entre si. `IDE11`: un candidate de un canal nunca auto-linkea con un master resuelto en otro canal (verificado estructuralmente: el repositorio nunca escribe `master_customer`/`customer_external_identity`).

No se implemento un resolver omnicanal ni adapters de Instagram/Facebook - explicitamente fuera de alcance (enunciado, "NO implementar todavia").

## 8. Relacion con `customer_external_identity` (PARTE 11)

Esta tabla nunca reemplaza a `customer_external_identity`. Separacion:

- `customer_external_identity` = asociacion canonica **vigente** (autoridad de Customer Service via `link_external_identity`).
- `crm_customer_identity_evidence` = historia de que se **observo/evaluo**, incluida evidencia que nunca se convirtio en link.

Nada en este dominio escribe `customer_external_identity` (verificado por el test estructural `IDE11/IDE18`, que lee el codigo fuente del repositorio y confirma la ausencia de cualquier `INSERT`/`UPDATE` contra esa tabla o `master_customer`).

## 9. Relacion con `crm_customer_onboarding_state` (PARTE 12)

`crm_customer_onboarding_state` sigue siendo la maquina de estados operacional (current values, pending fields, status, version) - no se le agrego historia. La evidencia durable vive exclusivamente en la tabla nueva; no se duplica el payload completo en ambos lados (el registro de onboarding solo dispara la llamada a `recordOnboardingFieldEvidence` con el valor normalizado, nunca copia `collected_json` entero).

## 10. Privacidad (PARTE 17)

- Nunca se persiste email/telefono/wa_id/orderReference crudo. `redact.ts`: `hashSignalValue` (SHA-256, una via, solo para detectar "mismo valor") y `redactSignalValue` (`****1234`, mismo patron que `maskWaId` de follow-up-observability).
- `toPromptSafeSummary(record)` devuelve solo `{signalType, status, strength, observedAt}` - nunca `masterCustomerId`, `prestashopCustomerId`, hash ni display. Verificado en runtime por `IDE16` (no solo por tipo): confirma que ni el JSON de la fila completa ni el del summary contienen el valor crudo.
- No se persisten mensajes completos ni filas crudas de `ps_customer`/`ps_orders`.

## 11. Idempotencia (PARTE 18)

`idempotencyKey = hash(conversationId | messageId | signalType | sourceRecordRef | valor-comparable)`, columna `UNIQUE`. Un replay exacto (mismo mensaje) siempre devuelve la fila existente (`status: "duplicate"`) sin insertar. Cubierto por `IDE02`.

## 12. Concurrencia (PARTE 19)

`recordIdentityEvidence` corre dentro de `withTransaction` y toma `SELECT ... FOR UPDATE` sobre la(s) fila(s) actuales de `(conversationId, signalType)` antes de decidir insertar/superseder - dos correcciones concurrentes para la misma senal se serializan a nivel de fila InnoDB, nunca se resuelven con un workflow distribuido. Verificado con una race real de dos `Promise.all` concurrentes contra MariaDB (`IDE15`): exactamente una fila `current` sobrevive, la otra queda `SUPERSEDED` de forma consistente.

## 13. Restart / reproyeccion (PARTE 13)

No hay memoria de proceso involucrada - toda lectura pasa por SQL. `IDE06/IDE07` fuerza un restart real (`resetPoolForTests()`, mismo mecanismo que ACS-R1-05-T07) entre dos turnos y confirma que la evidencia del turno 1 (wa_id) sigue disponible y que el turno 2 (order_reference) se agrega correctamente sobre estado recargado desde DB.

## 14. Write API (PARTE 15)

`lib/domains/customer-identity-evidence/` - dominio cerrado, nunca expuesto como tool/capability (verificado estructuralmente por `IDE17`, que confirma que `customerIdentityCapabilities.ts` del Capability Gateway no referencia este modulo):

- `recordIdentityEvidence(input)` - unico punto de insercion, con correccion/supersede/idempotencia incorporados.
- `recordIdentityEvidenceBatch(input)` - envuelve el array `IdentityEvidence[]` que ID-R2-A02 ya produce, agrupando conflictos con un `conflictGroupId` compartido.
- `markIdentityEvidenceVerified` / `markIdentityEvidenceConflicted` / `markIdentityEvidenceStale` / `revokeIdentityEvidence` / `supersedeIdentityEvidence`.

Ningun input del LLM llega a estas funciones - ver Wiring abajo.

## 15. Read API (PARTE 16)

`getCurrentEvidenceForConversation`, `getCurrentEvidenceForMasterCustomer`, `getEvidenceBySignal`, `getUnresolvedEvidence`, `getConflictEvidence`, `getHistoricalEvidence`, `getEvidenceById`, mas `toPromptSafeSummary` para la variante redactada. Todas usan `safeQueryRows` (nunca lanzan) y son de solo lectura.

## 16. Wiring real (los dos unicos call sites)

No se creo un segundo motor. Se conectaron los dos lugares donde el runtime nativo ya produce senales de identidad reales:

1. `resolveNativeCustomerSession.ts` - justo despues de `identityService.resolveIdentity()` (ID-R2-A02), llama a `recordTurnIdentityEvidence` (`identityEvidenceHooks.ts`) con `localResult.detail`. Cubre `wa_id`/`phone`/`email`/`prestashop_customer_id`/`order_reference` cuando el resolver los evalua. Mismo patron fail-safe que `identityAuditEvents.ts` (ACS-R1-04-T07): nunca lanza, nunca cambia el resultado del turno.
2. `runCustomerOnboardingPostPlanStage.ts` - en el paso de captura de campos (`collectFields`), tras un `result.ok`, llama a `recordOnboardingFieldEvidence` para `email`/`orderReference` cuando el cliente los declaro este turno. Es el unico lugar productivo donde esos dos campos realmente fluyen hoy (el resolver pre-plan no los recibe todavia - deuda ya documentada por A02).

Ninguna otra ruta de codigo escribe esta tabla.

## Test Matrix (PARTE 20)

`tests/domains/customerIdentityEvidence.test.ts`, 18 tests, contra MariaDB real (`main_management`, migracion 032 aplicada):

| ID | Cubierto por | Resultado |
|---|---|---|
| IDE01 | test dedicado | OK |
| IDE02 | test dedicado | OK |
| IDE03 | test dedicado | OK |
| IDE04 | test dedicado | OK |
| IDE05 | test dedicado | OK |
| IDE06/IDE07 | test dedicado (restart real) | OK |
| IDE08 | test dedicado | OK |
| IDE09 | test dedicado | OK |
| IDE10 | test dedicado (junto a IDE20) | OK |
| IDE11 | test estructural (junto a IDE18) | OK |
| IDE12 | test dedicado | OK |
| IDE13 | test dedicado | OK |
| IDE14 | no reproducido con fault injection real (ver Deudas) - garantizado por diseno: unico insert+supersede vive dentro de `withTransaction`, MariaDB hace rollback completo ante cualquier fallo | por diseno, no probado con inyeccion de fallos |
| IDE15 | test dedicado (race real con `Promise.all`) | OK |
| IDE16 | test dedicado | OK |
| IDE17 | test estructural | OK |
| IDE18 | test estructural (junto a IDE11) | OK |
| IDE19 | test estructural | OK |
| IDE20 | test dedicado (junto a IDE10) | OK |

18/18 verdes.

## Regresion (PARTE 21)

Ejecutado contra MariaDB real (`main_management`, contenedor `infra/docker-compose.dev.yml`, migraciones 001-032 aplicadas, seed de fixtures aplicado):

- `npx tsc --noEmit`: limpio.
- `npx eslint` sobre los archivos nuevos/tocados: limpio.
- `npm run build`: limpio.
- `tests/domains/customerIdentityEvidence.test.ts`: 18/18.
- `tests/domains/customerIdentity.test.ts`, `customerOnboarding.test.ts`, `tests/commercial/customerSession.test.ts`, `customerSessionCustomer360Gate.test.ts`, `customerSessionPrivacy.test.ts`, `customerOnboardingPostPlanStage.test.ts`, `customerOnboardingPostPlanRuntime.test.ts`, `customerOnboardingPostPlanPrivacy.test.ts`, `extractCustomerOnboardingFields.test.ts`, `customerIdentityCapabilityGateway.test.ts`, `customerIdentityAuditEvents.test.ts`, `identityCapabilityGatewaySummaries.test.ts`, `customerMasterProjectionGate.test.ts`, `tests/native/identity-conflict.test.ts`, `nativeInboundIdentityBoundary.test.ts`: 297/297 con las variables `DATABASE_*` exportadas en el shell (3 archivos fallan al invocarlos sueltos sin esas variables - `customerSession.test.ts`, `customerOnboardingPostPlanStage.test.ts`, `customerSessionPrivacy.test.ts` - por un `after` hook que llama `getPool().end()` sin que el archivo fije sus propias env vars; confirmado que es un artefacto del entorno de invocacion, no una regresion, exportando las mismas variables al shell: 88/88 verde).

Cero fallas nuevas atribuibles a este cambio.

## Deudas explicitas (no cerradas en A03, por diseno)

- `computeEvidenceFreshness` no cruza contra el estado vigente de `customer_external_identity` (no existe writer de revocacion en el repo todavia) - queda declarado en PARTE 7/6.
- IDE14 (fallo tecnico de DB a mitad de escritura -> ningun estado parcial) no se probo con inyeccion de fallos real; la garantia descansa en que el unico camino de escritura (`recordIdentityEvidence`) vive completo dentro de una transaccion `withTransaction`, con rollback automatico de MariaDB ante cualquier excepcion.
- El pre-plan resolver (`resolveNativeCustomerSession`) todavia no recibe `email`/`orderReference` como input (deuda ya documentada por A02) - por eso el unico lugar productivo que genera evidencia de esos dos signal types hoy es el flujo de onboarding post-plan, no el resolver mismo.
- Sin verification policy formal: una fila `VERIFIED` en esta tabla nunca autoriza por si sola una mutacion (`create_customer`/`link_external_identity` siguen exigiendo su propio flujo de Customer Service + consentimiento) - PARTE 23 evalua si eso se vuelve `ID-R2-A04`.
- `docs/CAPABILITY_MATRIX.md` no se toco: esta tabla es `domain_state` interno, nunca un tool/capability agent-callable (mismo criterio ya documentado ahi para `customer_onboarding_state`, seccion "notas").
- `docs/ACTIVE_RELEASE.md` no se toco: siguiendo el mismo precedente que ID-R2-A01/A02 (ninguno de los dos aparece referenciado en ese documento), este track SALES-AGENT-R2 se documenta unicamente via sus propios archivos `docs/releases/SALES-AGENT-R2-*.md`, fuera de la secuencia `ACS-R1-04`/`ACS-R1-05` que `ACTIVE_RELEASE.md` gobierna.

## Next slice (PARTE 23)

No se fusiono Verification Policy dentro de A03: el codigo demuestra que evidence durable sin semantica de verification explicita **no** queda incompleto para lo que A03 exigia (persistencia, correccion, supersede, conflicto, freshness por lifecycle) - todo eso funciona sin necesitar todavia una policy que decida cuando una evidencia puede *autorizar* algo. Esa pregunta ("cuando una VERIFIED real habilita una mutacion / LEVEL_4") es exactamente el alcance de:

**`ID-R2-A04` - Verification Policy** (o, si el audit A01 prefiere la secuencia alli descrita, Order Ownership Verification) - ninguno de los dos se inicia sin autorizacion explicita del usuario.

No se avanza hacia CommercialWork R2 identity workflow ni Customer Profile en esta tarea.

## Criterio de salida - checklist

1. Evidence sobrevive restart - `IDE06/IDE07`. OK
2. Correcciones no destruyen history - `IDE03/IDE08/IDE12`. OK
3. Evidence puede supersederse/revocarse - `supersedeIdentityEvidence`/`revokeIdentityEvidence`, `IDE13`. OK
4. Conflicts reconstruibles - `conflict_group_id`, `IDE05`. OK
5. Provider/channel persistido - columnas `channel`/`provider`/`channel_evidence`. OK
6. Diseno soporta multiples canales sin hardcode WhatsApp - `IDE10/IDE20`. OK
7. No auto-merge cross-channel - `IDE10/IDE11`. OK
8. `customer_external_identity` sigue siendo la asociacion canonica - nunca escrita por este dominio. OK
9. Onboarding state no se usa como audit log - sin cambios ahi, evidencia vive aparte. OK
10. Replays son idempotentes - `IDE02`. OK
11. Writes concurrentes son seguros - `IDE15`. OK
12. PII minimizada/redacted - `IDE16`. OK
13. LLM no puede marcar VERIFIED - `IDE17`. OK
14. Evidencia historica no autoriza mutaciones por si sola - ninguna funcion de este dominio llama a Capability Gateway ni a Customer Service. OK
15. No se escribe `master_customer` - `IDE11/IDE18`. OK
16. No se llama `link_external_identity` automaticamente - este dominio no importa el Capability Gateway. OK
17. Tests cross-turn/restart/correction verdes - ver Test Matrix. OK
18. Verification policy faltante para A04 declarada explicitamente - ver Deudas/Next slice. OK
