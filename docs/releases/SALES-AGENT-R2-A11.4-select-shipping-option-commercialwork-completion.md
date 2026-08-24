# SALES-AGENT-R2-A11.4 - SELECT_SHIPPING_OPTION CommercialWork Completion

Estado: implementacion funcional cerrada (runtime + planner), en dos fases obligatorias
(Phase A runtime, Phase B planner), verificada contra MariaDB real (`crm_test`).

## 1. Root cause

La auditoria transversal (`docs/audits/SALES-AGENT-R2-cross-service-integration-contract-audit.md`)
encontro que `SELECT_SHIPPING_OPTION` estaba completamente modelado en CommercialWork R2 (tipo de
objetivo, tipo de step, logica de proyeccion, mensajes de finalizer, modelo de conflictos) pero
estructuralmente inalcanzable: ausente de `EXECUTABLE_STEP_TYPES`, y sin ningun intent del
planificador semantico capaz de producir el objetivo.

Una revision de diseno previa a la implementacion (un pase con un agente de planificacion, antes
de escribir codigo) encontro que agregar el tipo a `EXECUTABLE_STEP_TYPES` sin mas cambios habria
enviado un deadlock *distinto*, no arreglado el original:

**Bug 1 - dependencia estructuralmente insatisfacible.** El step declaraba
`{type:"CAPABILITY_EVIDENCE", capabilityName:"calculate_shipping"}`, que exige un step COMPLETED
con ese `capabilityName` **en el mismo work**. `GET_SHIPPING_QUOTE` (el unico productor de un step
`calculate_shipping`) y `SELECT_SHIPPING_OPTION` comparten la misma familia de supersesion,
`"shipping"` (`deriveCommercialObjectives.ts:51`) - en el instante en que se genera un objetivo
`SELECT_SHIPPING_OPTION`, supersede cualquier `GET_SHIPPING_QUOTE` previo de esa familia, incluso
uno ya COMPLETED de un turno anterior, y el step de un objetivo superseded se fuerza a
`SUPERSEDED` tambien (`terminalOr`). No existe ningun turno real donde un objetivo
`SELECT_SHIPPING_OPTION` vivo coexista con un step `calculate_shipping` COMPLETED en el mismo
work - confirmado en el propio comentario del test `CWEX22-24`, que ya documentaba esto como "a
real dependency that a fresh seed never satisfies on its own".

**Bug 2 - el rechazo de evidencia obsoleta mapeaba a un callejon sin salida permanente.**
`selectShippingOptionCapability.ts` retorna `status:"invalid_arguments"` (con
`data.status:"shipping_calculation_stale"` como sub-codigo) cuando el carrito/destino cambio
desde el calculo que origino la opcion elegida. `stepRecordFromGateway` mapeaba **todo**
`invalid_arguments` a `"failed"` antes de inspeccionar `dataStatus` - y `FAILED` es un estado de
work genuinamente terminal.

**Correccion de rumbo durante la revision del usuario**: el primer intento de arreglar el Bug 2
(mapear a `"blocked"` en vez de `"failed"`) fue rechazado explicitamente por el usuario: dejaba
`SELECT_SHIPPING_OPTION` en `BLOCKED` sin ningun mecanismo de progreso - tecnicamente ya no
`unsupported_step_type`, pero igual de callejon sin salida, con la respuesta ya dada por el
cliente perdida silenciosamente. La instruccion fue explicita: o se resuelve de verdad dentro de
A11.4, o el release se cierra `PARTIAL`, no `VALIDATED`. Esto llevo al diseno de
auto-recalculacion descrito en la seccion 4.

## 2. Wiring antes/despues

| | Antes | Despues |
|---|---|---|
| `EXECUTABLE_STEP_TYPES` | `SELECT_SHIPPING_OPTION` ausente | incluido |
| Dependencia del step (evidencia fresca) | `CAPABILITY_EVIDENCE calculate_shipping` (insatisfacible) | `FACT_CONFIRMED commercial_line_items` + `FACT_CONFIRMED shipping_destination` |
| Dependencia del step (evidencia obsoleta) | N/A - nunca se derivaba distinto | cadena de dos steps: `CALCULATE_SHIPPING` (READY) + `SELECT_SHIPPING_OPTION` (BLOCKED, `STEP_COMPLETED` del anterior) |
| `buildGatewayInput` | sin case, caia a `{}` (habria descartado `optionIndex` en silencio) | `{ optionIndex: step.input.optionIndex }` |
| `priority()` | sin case, caia a 1000 | `35`, entre `CALCULATE_SHIPPING=30` y `CREATE_QUOTE=40` |
| `stepRecordFromGateway` | `invalid_arguments` siempre -> `"failed"` | `shipping_calculation_stale` -> `"blocked"` (defensa en profundidad), el resto de `invalid_arguments` sigue `"failed"` |
| `objective.inputs.optionIndex` | se esperaba ya resuelto al momento del seed | **nunca** se siembra directo; se computa cada pasada de proyeccion desde `optionReference` |
| Planner (`multi-intent`) | sin tipo de intent `select_shipping_option` | tipo nuevo, solo texto crudo del cliente |

## 3. Evidence gate

Ya existia por completo antes de esta tarea, en `selectShippingOptionCapability.ts`: el input
UNICO que acepta es `optionIndex` (entero), nunca carrier/precio/service type (el schema
estructuralmente no tiene esos campos). `resolveObservedShippingOption` resuelve ese indice contra
la ultima ejecucion real de `calculate_shipping` de esta conversacion (`crm_capability_executions`),
y `checkShippingEvidenceFreshness` rechaza evidencia obsoleta antes de escribir nada. Esta tarea no
construyo un evidence gate nuevo - solo aprendio a alimentarle un `optionIndex` real.

## 4. Stale evidence semantics - auto-recalculacion

Reutiliza un patron ya existente y probado en el mismo archivo: `SELECT_PRODUCTS`/`CHANGE_QUANTITY`
tiene una rama `needsSearch` (`deriveCommercialWorkSteps.ts:87-146`) que, cuando falta evidencia,
deriva DOS steps de un mismo objetivo - uno que la genera (READY) y el real (BLOCKED,
`STEP_COMPLETED` del anterior, con un codigo de blocker deliberadamente fuera de la whitelist de
`canAutoActivateStep` para que solo reactive en la SIGUIENTE ronda de reproyeccion fresca, nunca en
la misma pasada del executor).

Aplicado a `SELECT_SHIPPING_OPTION`: `objective.inputs.optionReference` (texto crudo del cliente)
es la fuente de verdad durable, nunca mutada. `optionIndex` se computa fresco en cada pasada de
`applyObjectiveState`, nunca se confia entre pasadas. Cuando la evidencia esta obsoleta/ausente,
el objetivo queda `BLOCKED`+`MISSING_SHIPPING` (codigo ya existente, sin codigo nuevo) y
`deriveCommercialWorkSteps.ts` deriva la cadena `CALCULATE_SHIPPING` (READY) ->
`SELECT_SHIPPING_OPTION` (BLOCKED, depende del anterior). Dentro del mismo turno (el loop de
reproyeccion de `settleCommercialWorkProjection` corre hasta 3 rondas), la ronda 1 ejecuta el
recalculo, la ronda 2 re-resuelve `optionReference` contra las opciones frescas - la respuesta del
cliente nunca se descarta, se re-evalua contra evidencia real y actual.

**Referencias posicionales vs. por contenido despues de un recalculo.** El matcher
(`matchShippingOptionReference.ts`) etiqueta cada resolucion con un `matchKind`
(`"position"|"carrier"|"cheapest"`). Una referencia posicional ("la segunda") solo significa algo
relativo a la lista exacta que el cliente vio - si el orden cambia en un recalculo, la misma
posicion puede apuntar a una opcion real distinta. Una referencia por contenido (nombre de
transportista, "la mas barata") resuelve por lo que la opcion ES, asi que sigue siendo segura tras
un recalculo. `applyObjectiveState` usa el parametro `carriedStatus` ya existente (el mismo
mecanismo que `SELECT_PRODUCTS`/`SET_DESTINATION`/`CREATE_QUOTE` ya usan, via
`carriedObjectiveStatusById`) para detectar si la evidencia fresca actual es el resultado directo
de un recalculo (`carriedStatus === "BLOCKED"`, el unico valor que `MISSING_SHIPPING` deja) - en
ese caso, un match `matchKind:"position"` se degrada a `WAITING_CUSTOMER` con la lista
actualizada en vez de auto-seleccionar; un match por contenido completa normalmente sin importar
`carriedStatus`.

Esto fue una correccion explicita pedida por el usuario tras revisar el primer diseno (que
auto-resolvia posiciones incluso tras un recalculo) - ver tests SHIP17 (el caso que debia fallar
sin este fix: opciones `[A,B]`, cliente dice "la segunda"=B, evidencia se vuelve obsoleta,
recalculo devuelve `[B,C]`, el sistema NO selecciona C solo por ocupar la posicion 2) y SHIP18
(control: referencia por contenido si se resuelve automaticamente tras el mismo recalculo).

"La mas rapida" deliberadamente no se implemento: `estimatedDelivery` es texto opaco en todo el
resto del codebase (nunca parseado como fecha/duracion), y construir el primer parser de duracion
del sistema para una frase que el cliente puede evitar trivialmente ("la primera", nombrar el
transportista) es alcance no justificado. Cae a `missing` como cualquier referencia no
reconocida, aterriza en `WAITING_CUSTOMER` con el texto real (sin parsear) de cada opcion.

## 5. Planner change

`lib/brain/commercial/multi-intent/`: sexto tipo de intent, `select_shipping_option`, con un solo
campo opcional `optionReference` (texto libre, nunca un numero - el modelo nunca ve datos reales
de opciones ni construye un indice). `parseCommercialIntentPlan.ts` lo parsea con el mismo patron
bounded-text que `productReference`/`destination`. `buildIntentPlannerPromptPackage.ts` instruye
al modelo a extraer las palabras del cliente verbatim, nunca a interpretarlas.

`requirementResolver.ts#resolveShippingOptionRequirement` es deliberadamente solo un chequeo de
presencia (como `resolveQuantityRequirement`), no hace matching - a diferencia de
`resolveProductRequirement` contra `RecentCatalogContext`. La razon: la evidencia real
(opciones de `calculate_shipping`) es intrinsecamente re-computable dentro del ciclo de vida de UN
solo objetivo (el carrito/destino pueden cambiar a mitad de seleccion, forzando un recalculo), asi
que resolverla una sola vez en el planner y cachear un indice quedaria obsoleto exactamente cuando
mas importa. Por eso el matching real vive enteramente en `applyObjectiveState` (seccion 4), nunca
en el planner - esto tambien simplifico el alcance de esta fase: no hizo falta un
`RecentShippingQuoteContext` nuevo, ni tocar `runCommercialWorkInboundCycle.ts`, ni refactorizar
`resolveObservedShippingOption.ts`.

`semanticIntentAdapter.ts#commercialObjectiveSeedsFromResolvedIntent` empuja siempre exactamente
un seed `SELECT_SHIPPING_OPTION` con `inputs:{optionReference}` cuando el intent esta presente -
sin ramificacion ambigua/missing aqui (a diferencia de `select_products`), porque toda esa logica
real vive downstream.

## 6. Cross-turn continuation

Probado end-to-end contra MariaDB real via el executor real (`SHIP01`): turno 1 completa
`GET_SHIPPING_QUOTE`; turno 2, una reconciliacion real (`reconcileCommercialObjectives`, el mismo
mecanismo que usa el loop de rondas de `settleCommercialWorkProjection` en produccion, nunca un
seed sintetico aislado) supersede el objetivo COMPLETED anterior (misma familia "shipping") y
resuelve `SELECT_SHIPPING_OPTION` contra evidencia todavia fresca - exactamente la interaccion que
el Bug 1 hacia estructuralmente insatisfacible.

## 7. Tests

**Phase A (runtime)**: 15 tests en `commercialWorkExecutor.test.ts` (incluye `SHIP01`, `SHIP03-06`,
`SHIP14`, mas la actualizacion del comentario de `CWEX22-24`), 45 en `commercialWorkProjection.test.ts`
(incluye `SHIP02`, `SHIP11-13`, `SHIP17-18`, mas casos de ambiguedad/no-match/sin-facts), 12 en
`matchShippingOptionReference.test.ts` (`SHIP07-10`, `SHIP16` a nivel de matcher puro). Cero
regresiones en `commercialWorkRetryWorker.test.ts` (8), `commercialWorkWaitingCustomerReactivation.test.ts`
(12) ni `selectShippingOptionCapability.test.ts` (8, sin tocar - la capability no cambio).

**Phase B (planner)**: 3 tests nuevos en `requirementResolver.test.ts` (`MI-Resolve-13/14`,
`SHIP16` a nivel de multi-intent), 3 en `parseCommercialIntentPlan.test.ts` (`MI-Parse-16/17/18`),
2 en `r2SemanticIntentAdapter.test.ts` (`R2SEM11/12`, pipeline completo con provider scripted +
DB real). `SHIP07-10` end-to-end no se duplicaron como tests DB-pesados adicionales - la misma
funcion matcher, el mismo codigo de paso de seed y el mismo codigo de proyeccion ya estan probados
de forma aislada en cada capa (matcher puro, planner->seed, seed->proyeccion->executor via
`SHIP01`/`SHIP02`), asi que la cadena completa esta probada por construccion sin repetir cobertura
DB-backed de los mismos puntos de union. `SHIP15` (el planner no puede producir el intent antes de
esta fase) se deja como afirmacion verificable por inspeccion de codigo
(`COMMERCIAL_INTENT_TYPES` no lo incluia hasta Phase B), no un test en tiempo de ejecucion para
una ausencia.

`npx tsc --noEmit` limpio. `npm run build` limpio (exit 0, cero errores). `npm run lint`: 0
errores, 39 warnings preexistentes sin relacion a esta tarea (ninguno en archivos tocados).
Regresion completa `npm test` (162 archivos): ver resultado final abajo.

## 8. Riesgos/deuda

- **Referencia posicional en el turno de re-confirmacion**: si el cliente responde de nuevo tras
  un `SHIPPING_OPTION_RECALCULATED` con otra referencia posicional, esa SI se resuelve
  automaticamente (el `carriedStatus` de ese nuevo turno ya no es `BLOCKED`, es `WAITING_CUSTOMER`)
  - comportamiento correcto: el cliente esta respondiendo a la lista YA actualizada, no repitiendo
    ciegamente una respuesta de contexto obsoleto.
- **Sin auto-disparo de recalculo si nadie mas lo activa**: si `SELECT_SHIPPING_OPTION` queda
  `BLOCKED`+`MISSING_SHIPPING` y ningun turno nuevo llega, el work queda `ACTIVE` con un step
  `CALCULATE_SHIPPING` real y `READY` (progresable, recogido por el worker) - no es un deadlock,
  pero SI depende de que el worker/turno siguiente efectivamente ejecute ese step. Mismo
  comportamiento que cualquier otro step `WAITING_SYSTEM`/`READY` pendiente de este sistema, no una
  deuda nueva de esta tarea.
- **"la mas rapida" no resuelve**: deferido deliberadamente, ver seccion 4.
- Ningun cambio en Carrier Service, Quote Service, Catalog Service, Customer Profile, ni en el
  motor legacy Agent Tool Loop (que ya podia seleccionar opciones de envio de punta a punta antes
  de esta tarea, sin cambios).

## 9. Owner-live steps

Ninguno realizado en esta sesion - sin acceso de red a WhatsApp/produccion desde este entorno.
Pendiente: validar en vivo que un turno real con `select_shipping_option` allowlisted en R2
resuelve correctamente por posicion/transportista/precio, y que el flujo de recalculo (Parte 5,
turno con destino/carrito cambiado entre la cotizacion y la seleccion) se comporta como lo prueban
`SHIP14`/`SHIP17`/`SHIP18` contra datos reales de Carrier MS.

Regresion completa (`npm test`, 162 archivos, todos los directorios `tests/`): fallas
pre-existentes confirmadas contra un baseline limpio via `git stash` (todos los archivos tocados
por esta tarea stasheados, suite ejecutada contra `develop` sin cambios, luego restaurados) -
mismos 9 fallos exactos en `createCustomerCapability.test.ts`, `customerOnboardingPostPlanStage.test.ts`,
`customerSession.test.ts`, `customerSessionPrivacy.test.ts`, `linkExternalIdentityCapability.test.ts`,
`processInboundCommercialShadow.test.ts`, `runCommercialOperationalLoop.test.ts` (conexion a DB),
`salesAgentConfiguration.test.ts` (`[R17]`/`[P25]`/`[A13]`, fila de configuracion con integridad
invalida preexistente) y `customerOnboarding.test.ts` (checksum de migracion `001_hub_audit_log.sql`
en disco vs `schema_migrations`) - mas `T08-A6`/`T08-A7` en `customerIdentityOnboarding.e2e.test.ts`,
ya documentados como preexistentes desde A10. Ninguno de estos archivos fue tocado por esta tarea, y
ninguno esta relacionado con shipping/CommercialWork/multi-intent. **Cero fallas nuevas atribuibles
a A11.4.**

## Veredicto

**A11_4_SELECT_SHIPPING_OPTION_VALIDATED**

Los 10 puntos del criterio de salida de la tarea se cumplen:
1. `SELECT_SHIPPING_OPTION` es realmente ejecutable en R2 - confirmado via `SHIP01`/`SHIP02` contra
   MariaDB real.
2. El deadlock `unsupported_step_type -> BLOCKED forever` no existe - el bug real (la dependencia
   `CAPABILITY_EVIDENCE` insatisfacible) fue encontrado y corregido antes de que el primer deadlock
   siquiera se manifestara.
3. El planner puede representar seleccion de envio - `select_shipping_option` intent, Phase B.
4. El LLM no puede inventar una opcion - el schema de la capability estructuralmente no acepta
   carrier/precio/service type, solo `optionIndex`; el planner solo pasa texto crudo.
5. Toda seleccion se rastrea a opciones reales previamente calculadas - `matchShippingOptionReference`
   nunca inventa un indice, y la capability re-verifica independientemente.
6. Funciona cross-turn - `SHIP01`, reconciliacion real, no un seed sintetico.
7. La evidencia obsoleta no puede reutilizarse - recalculo automatico (`SHIP11/12/14`), y las
   referencias posicionales nunca se auto-confian tras un recalculo (`SHIP17`, la correccion
   explicita pedida por el usuario), mientras que las referencias por contenido si (`SHIP18`).
8. Retry/failure semantics correctos - `SHIP03/04/05`, mas el fix de defensa en profundidad para
   `shipping_calculation_stale`.
9. El Agent Tool Loop no es necesario para seleccionar una opcion de envio - R2 ahora puede
   hacerlo de punta a punta.
10. `set_shipping_destination`/`calculate_shipping` no se rompieron - cero cambios a su propia
    logica de capability/adapter, solo se reutiliza su patron de derivacion de step; regresion
    completa confirmada sin fallas nuevas.
