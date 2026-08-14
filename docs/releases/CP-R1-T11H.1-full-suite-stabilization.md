---
title: CP-R1-T11H.1 - Full Suite Stabilization and Regression Closeout
doc_id: cp-r1-t11h1-full-suite-stabilization
status: T11H_VALIDATED_WITH_PREEXISTING_SUITE_DEBT
tags:
  - release
  - customer-profile
  - sales-agent
  - rfm
  - test-infrastructure
---

# CP-R1-T11H.1 - Full Suite Stabilization and Regression Closeout

Fecha: 2026-08-14.

## 1. Objetivo

Determinar de forma concluyente la causa de los 12 fallos que quedaron
pendientes al cerrar CP-R1-T11H (`npm test -> 12 fallos`), clasificarlos,
corregir lo que fuera atribuible a T11H, y auditar `scripts/run-tests.ts`
(el runner nuevo que T11H agrego para soportar Windows).

## 2. Los 12 fallos iniciales

El baseline de "12 fallos" reportado al cerrar T11H salio de `npm test`
corriendo unicamente el primer batch de `scripts/run-tests.ts` (ver seccion
7 - el runner tenia un bug que lo hacia salir tras el primer batch con
fallos, nunca llegaba a correr el resto de la suite). Los 12 fallos, todos
dentro de ese primer batch (299 tests), fueron:

1. `[T05] offline benchmark: the full C01-C12 corpus runs end to end and every case's own scripted ground truth passes` - `tests/agent-loop/benchmark/offlineHarnessEndToEnd.test.ts`
2. `[LLM-R1-T03 Caso 5] gathering system/user prompt lengths are unchanged from before this task` - `tests/agent-loop/buildAgentStepPromptPackage.test.ts`
3. `[LLM-R1-T04 Caso 1] a normal call (no priorAttemptFailure) is byte-identical to before this task` - `tests/agent-loop/buildAgentStepPromptPackage.test.ts`
4. `[MI-Loop-1] single select_products intent: resolves, executes, and produces one consolidated respond` - `tests/agent-loop/multi-intent/runCommercialMultiIntentLoop.test.ts`
5. `[MI-Loop-2] single get_shipping_quote with a durable selection and a stated destination` - idem
6. `[MI-Loop-3] select_products + get_shipping_quote fully resolvable in one turn` - idem
7. `[MI-Loop-4] select_products completes while get_shipping_quote stays waiting` - idem
8. `[MI-Loop-5] a later bare-destination reply resolves the pending get_shipping_quote` - idem
9. `DB: newer event without pendingCatalogAction invalidates an older pending action` - `tests/agent-loop/pendingCatalogAction.test.ts`
10. `DB: newer event with pendingCatalogAction is loaded over an older event without one` - idem
11. `DB: identical created_at values use id DESC as a deterministic tie breaker` - idem
12. `DB: one-turn sequence N persists, N+1 consumes, N+2 does not revive the older pending action` - idem

## 3. Clasificacion causal

| # | Test | Clasificacion | Relacionado con T11H |
|---|------|----------------|-----------------------|
| 1 | offline benchmark C01-C12 | `ENVIRONMENT` | No |
| 2 | LLM-R1-T03 Caso 5 (prompt length) | `T11H_REGRESSION` (test drift intencional) | Si - corregido |
| 3 | LLM-R1-T04 Caso 1 (byte-identical) | `T11H_REGRESSION` (test drift intencional) | Si - corregido |
| 4-8 | MI-Loop-1..5 | `ENVIRONMENT` | No |
| 9-12 | pendingCatalogAction DB tests | `ENVIRONMENT` | No |

### 3.1 `#1` y `#4-12`: `ENVIRONMENT` (falta de base de datos local)

Este sandbox no tiene Docker/MariaDB disponible:

```text
docker ps
  -> error during connect: ...dockerDesktopLinuxEngine... no puede
     encontrar el archivo especificado
```

Evidencia por grupo:

- **offline benchmark (`#1`)**: falla en `seedBenchmarkSelection`
  (`lib/brain/commercial/agent-loop/benchmark/environment.ts:191`) con
  `benchmark fixture setup: failed to seed commercial line items for
  opportunity ... (status=persistence_failed)` - un intento real de escritura
  en DB.
- **MI-Loop-1..5 (`#4-8`)**: `MI-Loop-2` falla con el mismo
  `seedBenchmarkSelection ... persistence_failed`. `MI-Loop-1/3/4/5` fallan
  porque `select_products`/`get_shipping_quote` intentan persistir estado
  durable real y no pueden; el propio archivo de test lo documenta en su
  comentario de cabecera: *"select_products/set_shipping_destination
  genuinely persist durable state"*. Ninguno de estos archivos
  (`runCommercialMultiIntentLoop.test.ts`, la orquestacion multi-intent, ni
  `benchmark/environment.ts`) aparece en el diff de T11H.
- **pendingCatalogAction DB tests (`#9-12`)**: fallan en el helper
  `persistEventAt` del propio test
  (`tests/agent-loop/pendingCatalogAction.test.ts:89`,
  `assert.equal(result.ok, true)` sobre `recordCommercialEvent(event)`) -
  sin DB, `recordCommercialEvent` devuelve `ok:false`. Confirmado que T11H no
  toco este archivo ni sus dependencias: `git diff HEAD~1 HEAD --
  tests/agent-loop/pendingCatalogAction.test.ts` es vacio, y el ultimo commit
  que lo modifico es anterior a T11H (`c298621`, `fix(catalog): close T10B8D
  recommendation context audit findings`).

Los cuatro archivos usan las mismas credenciales de DB local
(`DB_HOST=127.0.0.1`, `DB_NAME=main_management`, `DB_USER=crm_app`) via
`Object.assign(process.env, ...)` en su propio setup - son integration tests
por diseno, nunca pensados para correr sin una base real.

### 3.2 `#2` y `#3`: `T11H_REGRESSION` (test drift intencional, corregido)

`buildAgentStepPromptPackage.ts` (tocado por T11H) agrega
`CUSTOMER_RFM_RULE_LINES` (7 lineas de reglas de uso de `customerRfm` como
evidencia) a **ambas** ramas de `buildEvidenceAndToolRulesLines` (gathering y
finalization), de forma incondicional (independiente de si hay RFM real
disponible ese turno). El archivo de test tiene una convencion establecida
(ver comentarios de T08C/T08D/T09A ya presentes) de fijar el largo exacto del
system prompt como golden value y actualizarlo con un comentario cuando un
cambio de contenido es intencional. T11H no actualizo esos dos valores
golden, y el test (no tocado por T11H) seguia comparando contra el valor
pre-T11H.

Medido con el mismo fixture del test (`baseInput` + `pesasChileConfig()`):

| Fase | Antes (pre-T11H) | Despues (con RFM rules) | Delta |
|------|-------------------|---------------------------|-------|
| gathering system prompt | 21039 | 21881 | +842 |
| finalization system prompt | 17728 | 18570 | +842 |
| user prompt (ambas fases) | 205 | 205 | 0 |

El delta es identico en ambas fases porque `CUSTOMER_RFM_RULE_LINES` se
inserta igual en las dos ramas. No es una regresion de produccion: es
exactamente el escenario que la Fase 3 de esta tarea pedia comprobar (T11H
agrego datos al prompt, lo que cambia un snapshot determinista aunque la
logica sea correcta).

## 4. Cambios de produccion

**Ninguno.** No se encontro ninguna regresion de produccion atribuible a
T11H entre los 12 fallos originales ni en la muestra dirigida de la seccion
6.2.

## 5. Cambios de tests/fixtures

- `tests/agent-loop/buildAgentStepPromptPackage.test.ts`: se actualizaron los
  cuatro valores golden de largo de prompt (`21039->21881` gathering,
  `17728->18570` finalization, en el test de Caso 5 y en las constantes
  `GATHERING_SYSTEM_PROMPT_LENGTH_NORMAL_T04` /
  `FINALIZATION_SYSTEM_PROMPT_LENGTH_NORMAL_T04` del bloque LLM-R1-T04), con
  un comentario nuevo seccion T11H siguiendo la misma convencion que
  T08C/T08D/T09A ya usaban. Ningun assertion se debilito ni se elimino - solo
  se corrigio el valor esperado a la medicion real y correcta post-T11H.
- Ningun otro archivo de test se modifico. Los 10 fallos `ENVIRONMENT` no se
  tocaron: no son fixtures incompletos ni mocks desactualizados, son
  integration tests que requieren una base de datos real que este sandbox no
  tiene.

## 6. Auditoria de `scripts/run-tests.ts`

### 6.1 Bug encontrado y corregido: la suite nunca corria completa

El script original hacia `process.exit(result.status)` dentro del loop, en
cuanto el **primer** batch (25 archivos) devolvia un status distinto de
cero. Con 204 archivos de test repartidos en 9 batches, eso significaba que
en cuanto un solo test fallaba en el batch 1 (alfabeticamente
`tests/agent-loop/**`), los batches 2-9 (~179 archivos, la gran mayoria de
la suite) **nunca se ejecutaban**. Confirmado empiricamente: la primera
corrida de `npm test` en esta sesion se detuvo en `# tests 299` (el batch 1
completo) con exit code 1, sin una sola linea de output de los batches
restantes.

Esto explica por completo el baseline de "12 fallos": nunca fue el resultado
de la suite completa, era el resultado parcial del unico batch que alcanzaba
a correr.

**Correccion aplicada**: el loop ahora continua por todos los batches
siempre, acumula el peor exit code visto, y solo llama a `process.exit` al
final con ese codigo agregado. Con el fix, `npm test` corre los 204 archivos
/ 3153 tests reales (ver seccion 8).

### 6.2 Deuda preexistente revelada por el fix

Al correr la suite completa por primera vez, aparecieron ~512 fallos
adicionales fuera de los 12 originales, todos en batches que antes nunca se
ejecutaban. Esto es exactamente "deuda preexistente revelada", no una
regresion nueva:

- El log crudo contiene 620 ocurrencias de `ECONNREFUSED`.
- Un batch tomado como muestra (batch 4, 25 archivos, 280 tests) tuvo 50
  fallos; el 100% de los titulos corresponde a pruebas de persistencia real
  (`the DB itself rejects...`, `persisted request summary`, escalaciones,
  quotes, upsert de facts, etc).
- Se hizo una busqueda dirigida por las palabras clave `rfm`/`customerProfile`
  sobre la lista completa de fallos para descartar que alguno de estos ~512
  fuera atribuible a T11H; los tres resultados que matchearon
  (`customer360AutonomousBoundary.test.ts`, `turnPlanPersistence.test.ts`, y
  el propio `#1` de la seccion 2) se verificaron individualmente: ninguno
  toca codigo de T11H (`runNativeAutonomousCycle.ts` en `native-cycle/` es un
  archivo distinto de `runNativeAgentToolLoopCycle.ts` en `agent-loop/`, que
  es el que T11H si toco) y todos fallan por el mismo patron de DB
  inalcanzable.

Un triage exhaustivo de los ~512 fallos individuales queda fuera del alcance
de T11H.1 (cuyo mandato son los 12 fallos originales); la evidencia reunida
es suficiente para atribuirlos, como grupo, a la falta de base de datos local
en este sandbox - una condicion preexistente e independiente de T11H.

### 6.3 Otros puntos de la auditoria

- **Preserva argumentos**: NO, en la version original - el script ignoraba
  `process.argv` por completo, incluso el patron documentado
  `npm run test -- tests/foo.test.ts` (usado historicamente segun
  `docs/audits/autonomous-commerce-current-state-audit.md:677`). Se agrego
  soporte opcional (`process.argv.slice(2)` filtra por sufijo de path si se
  pasan argumentos; sin argumentos, comportamiento identico - corre todo).
  Ningun CI depende de este flujo (no hay workflows en `.github/`), asi que
  es una mejora de bajo riesgo, no una correccion de una regresion activa.
- **Preserva exit codes**: si, y ahora mejor que antes - el codigo final
  refleja si *algun* batch fallo, no solo el primero.
- **Funciona en Windows**: si, confirmado corriendo la suite completa varias
  veces en este sandbox Windows.
- **No excluye tests**: confirmado - `collectTestFiles` recorre `tests/`
  recursivamente y encuentra los 204 archivos `*.test.ts` que tambien
  encuentra `find tests -name "*.test.ts"` de forma independiente.
- **No altera ordering de forma material**: el array final se ordena
  alfabeticamente por path relativo (`localeCompare` en cada nivel de
  recursion, y de nuevo en el retorno de la llamada raiz, que ya contiene
  todos los paths aplanados) - orden deterministico entre corridas.
- **Flake observado, no corregido**: en una de las cuatro corridas completas
  de esta sesion, 5 de 9 batches fallaron con `Could not find '<archivo>'`
  para un archivo que si existe en disco (confirmado con `ls` inmediatamente
  despues). Las otras tres corridas, con el mismo codigo y los mismos
  archivos, no mostraron el problema. Es un flake de entorno (probablemente
  relacionado a lanzar 9 procesos `npx --yes tsx@...` secuenciales en este
  Windows sandbox), no un bug determinista del script ni algo causado por
  T11H. Corregirlo con reintentos por batch se evaluo y se descarto por
  alcance (requeriria capturar stdout en vez de heredarlo con `stdio:
  inherit`, aumentando la complejidad del script para un problema
  intermitente y no bloqueante). Queda como deuda documentada.

## 7. Resultados finales

```text
npm run typecheck -> PASS (0 errores)
npm run lint      -> PASS (0 errores, 34 warnings preexistentes, mismos
                      archivos/reglas que antes de T11H)
npm test          -> 2629 pass / 524 fail / 3153 total (exit 1)
```

Subset especifico de T11H (los 8 archivos que T11H toco directamente):

```text
tests/agent-loop/customerHistoryCommercialPolicyAgentLoop.test.ts
tests/agent-loop/customerProfilePromptContext.test.ts
tests/agent-loop/runNativeAgentToolLoopCycleCustomerProfile.test.ts
tests/customer-profile-client/customerProfileCapabilities.test.ts
tests/customer-profile-client/customerProfileSchemas.test.ts
tests/customer-profile-client/httpCustomerProfileClient.test.ts
tests/customer-profile-context/customerHistoryCommercialSignals.test.ts
tests/customer-profile-context/customerProfileContextLoader.test.ts
-> 90/90 PASS
```

Los tres grupos originalmente senalados, corridos individualmente:

```text
tests/agent-loop/benchmark/offlineHarnessEndToEnd.test.ts
-> 2 pass / 1 fail (el 1 fallo: ENVIRONMENT, ver 3.1)

tests/agent-loop/multi-intent/runCommercialMultiIntentLoop.test.ts
-> 4 pass / 5 fail (los 5 fallos: ENVIRONMENT, ver 3.1)

tests/agent-loop/pendingCatalogAction.test.ts
-> 29 pass / 4 fail (los 4 fallos: ENVIRONMENT, ver 3.1)
```

`tests/agent-loop/buildAgentStepPromptPackage.test.ts` (los 2 fallos
`T11H_REGRESSION` originales vivian aqui):

```text
-> 55/55 PASS (post-fix)
```

## 8. Deuda remanente

1. **Sin base de datos local en este sandbox**: ~512 tests de integracion
   (fuera de los 12 originales) mas los 10 `ENVIRONMENT` de la seccion 2 no
   pueden pasar sin Docker/MariaDB corriendo. No es deuda de T11H ni de
   T11H.1 - es una limitacion de este entorno de ejecucion. Recomendado como
   item separado: levantar `npm run db:up` (o equivalente) antes de correr
   `npm test` en este sandbox, o documentar explicitamente que `npm test`
   aqui requiere DB local para estar realmente verde.
2. **Flake intermitente en `run-tests.ts`** (`Could not find '<archivo>'` en
   algunos batches, no reproducible de forma consistente) - documentado en
   6.3, no corregido, no bloqueante (una segunda corrida sin cambios lo
   resolvio en esta sesion).
3. **Triage completo de los ~512 fallos fuera de los 12 originales** no se
   hizo test por test - se verifico la causa raiz dominante (DB) con
   evidencia cuantitativa y una busqueda dirigida por keywords de T11H, pero
   no hay una clasificacion exhaustiva fallo-por-fallo de toda la suite. Si
   se necesita, es un T11H.2 o una tarea de infraestructura de test
   separada, no T11H.1.

## 9. Veredicto final de T11H (y T11H.1)

```text
T11H_VALIDATED_WITH_PREEXISTING_SUITE_DEBT
```

`typecheck` y `lint` estan verdes. Los 2 fallos genuinamente atribuibles a
T11H (drift de golden prompt-length, causado por una adicion de contenido
intencional y documentada) quedaron corregidos. Los 10 fallos originales
restantes, y la enorme mayoria de los fallos adicionales que revelo la
correccion de `run-tests.ts`, son deuda preexistente e independiente de
T11H: este sandbox no tiene una base de datos local disponible, y una
fraccion sustancial de la suite son integration tests que la requieren por
diseno. `npm test` no esta verde, pero ninguna de sus fallas restantes es
atribuible a T11H.
