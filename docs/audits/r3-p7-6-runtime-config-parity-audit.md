# P7.6 - Runtime Configuration Parity & Commercial Decision Completion

Auditoria de diagnostico. No implementa P8, no MCP, no redisena Gateway, no cambia CommercialWork, eligibility ni la arquitectura de ejecucion de tools, no toca el prompt. Repo `CRM-Customer-360`, rama `develop`, HEAD `137502b`. Sin commit, sin push.

Estado: **P7.6 CLOSED** (incluye la extension P7.6-B, seccion 10.2; registrado en `docs/R3_COMMERCIAL_AGENT_HANDOFF.md`, seccion 23.6). Nota de alcance: "EC2-equivalent" no es paridad total; live assimilation no se ejercito en el harness (flag pasado pero inerte, su ancla numerica de `inboundMessageId` no se satisface) y el comportamiento de canal es `EC2_ONLY_CHANNEL_BEHAVIOR`.

Documentos base: `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` (seccion 23.5, P7.5) y el batch P7.5 archivado fuera del repo (`~/benchmark-archive/r3-commercial-e2e/2026-09-18T03-56-41-903Z-live/`, 45/45 runs, HYBRID).

## 0. Alcance y limites de acceso

- **EC2 verificado el 2026-09-21 (solo lectura).** La primera pasada (2026-09-20/21) no pudo conectar porque la IP habia cambiado (el host anterior daba timeout en el puerto 22). Con la IP nueva `98.80.166.131` (`98-80-166-131.sslip.io`) y la llave del operador el acceso funciono. Se leyo: git, pm2, flags via un filtro con allowlist de claves no secretas (allowlists de WhatsApp y URLs solo como conteo o presencia), un `SELECT` sobre `sales_agent_configurations` (campos no secretos) y agregados de conteo de `commercial_event` y `crm_capability_executions`. No se leyo ni persistio ningun secreto, contenido de conversacion ni telefono.
- Aun con acceso, una sesion previa (2026-09-15) documento que leer `.env`/`pm2 env` estaba bloqueado por el clasificador de credenciales del harness. Por eso los flags se leyeron con un filtro de allowlist (seccion 12) y no volcando `.env`.
- Las observaciones de EC2 del 2026-09-15 quedan superadas por la verificacion del 2026-09-21: EC2 esta en `b2fd0c5` (2026-09-16), no en `faf88d7`.
- No se persiste ningun secreto. Valores de tokens, API keys, hosts de bases externas y IDs de cuentas Meta estan omitidos.
- "LOCAL" significa el checkout `develop` de esta maquina: `.env` local, defaults de codigo y la base Docker `crm_test`.

## 1. Baseline

`develop` local @ `137502b` (P7.5 CLOSED en el handoff); EC2 en `b2fd0c5`, 10 commits detras. Arbol tracked limpio salvo cambios propios de esta fase (harness, ver seccion 14) y el `.gitignore` de la fase previa. `artifacts/benchmarks/r3-stable-agent-v1/` (legacy, untracked) intacto.

## 2. Matriz de paridad LOCAL vs EC2

Estados: `PARITY`, `INTENTIONALLY_DIFFERENT`, `LOCAL_UNAVAILABLE`, `EC2_ONLY`, `UNKNOWN_EC2`. Columna Impacto: `B` = behavioral (puede cambiar decisiones del agente), `I` = infra-only.

"Bench" indica lo que uso el benchmark P7.5, que no siempre coincide con el `.env` local (el harness fuerza varios flags).

### 2.1 Runtime R3

| Setting | LOCAL | Bench | EC2 | Estado | Imp. | Fuente |
|---|---|---|---|---|---|---|
| `BRAIN_SALES_AGENT_RUNTIME_ENABLED` (ruta R3) | no definido -> `false` | N/A (entra por `runSalesAgentRuntimeCycle`) | `true` | INTENTIONALLY_DIFFERENT | B (decide si R3 corre) | `commercialCycleConfig.ts:257`, `.env.example` |
| `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` (allowlist piloto) | no definido -> vacio -> nadie enrutado | N/A | allowlist de 3 entradas | INTENTIONALLY_DIFFERENT | B | `shouldRouteToSalesAgentRuntime`, `commercialCycleConfig.ts:275` |
| `BRAIN_AGENT_TOOL_LOOP_ENABLED` (rama R1 legacy) | `false` | N/A | `false` | PARITY | B (rama distinta de R3) | `.env`, `commercialCycleConfig.ts:153` |
| `BRAIN_R3_COMMERCIAL_WORK_KERNEL_ENABLED` | no definido -> `false` | forzado `true` | `true` | INTENTIONALLY_DIFFERENT (bench = EC2) | B | `commercialCycleConfig.ts:407`, `runCommercialE2ECase.ts` |
| `BRAIN_R3_COMMERCIAL_PROPOSAL_SHADOW_ENABLED` (P4) | no definido -> `false` | forzado `true` | `true` | INTENTIONALLY_DIFFERENT (bench = EC2) | B (agrega el contrato `commercialProposal` al prompt) | `commercialCycleConfig.ts:388` |
| `BRAIN_R3_COMMERCIAL_OBJECTIVE_RECONCILIATION_ENABLED` (P5) | no definido -> `false` | forzado `true` | clave ausente -> `false` | INTENTIONALLY_DIFFERENT (bench forzado `true`) | B (fija el objective al final del turno) | `commercialCycleConfig.ts:538` |
| `BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED` (P2) | no definido -> `false` | forzado `true` | `true` | INTENTIONALLY_DIFFERENT (bench = EC2) | I | `commercialCycleConfig.ts:348` |
| `BRAIN_R3_CAPABILITY_ELIGIBILITY_SHADOW_ENABLED` (P6 shadow) | no definido -> `false` | forzado `true` | codigo ausente en `b2fd0c5` | INTENTIONALLY_DIFFERENT | I (solo evento) | `commercialCycleConfig.ts:361` |
| `BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED` (P6.3 vista al modelo) | no definido -> `false` | forzado `true` | codigo ausente en `b2fd0c5` | INTENTIONALLY_DIFFERENT | **B** (agrega `capabilityEligibility` al prompt) | `commercialCycleConfig.ts:372`, handoff sec. 14 ("false hasta activacion controlada") |

### 2.2 Comportamiento de turno

| Setting | LOCAL | Bench | EC2 | Estado | Imp. | Fuente |
|---|---|---|---|---|---|---|
| `BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED` | `false` (default) | `false` | `true` | INTENTIONALLY_DIFFERENT | **B** (quita techo fijo 3/2) | `commercialCycleConfig.ts:503`, `runAgentToolLoop.ts:1390` |
| `BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED` | `false` | `false` | `true` | INTENTIONALLY_DIFFERENT | B (forma del prompt) | `commercialCycleConfig.ts:519` |
| `BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED` | default de codigo `true` | `true` | `true` | PARITY | B (historial de sesion al prompt) | `commercialCycleConfig.ts:430` |
| `BRAIN_R3_SESSION_COMPACTION_ENABLED` | `false` | `false` | `true` (max raw 40, target 20) | INTENTIONALLY_DIFFERENT | B (conversaciones largas) | `commercialCycleConfig.ts:469` |
| `BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED` | `false` | forzado `false` | `true` | INTENTIONALLY_DIFFERENT | B (asimila fragmentos nuevos dentro del turno) | `commercialCycleConfig.ts:488` |
| `BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS` | no definido -> `0` | no aplica (no usa el path inbound) | `5000` | INTENTIONALLY_DIFFERENT | B si >0 (agrega fragmentos en un turno) | `turn-settlement/config.ts:6`, `.env.example` |
| `BRAIN_R3_INBOUND_TURN_SETTLE_MAX_MS` | no definido -> `5000` | no aplica | `20000` | INTENTIONALLY_DIFFERENT | B si delay>0 | `turn-settlement/config.ts:7` |
| `BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED` | no definido -> `false` | no aplica | `true` | INTENTIONALLY_DIFFERENT | I | `turn-settlement/config.ts` |

### 2.3 Timing y presupuestos

| Setting | LOCAL | Bench | EC2 | Estado | Imp. | Fuente |
|---|---|---|---|---|---|---|
| Timeout del modelo por turno (`timeoutMs`) | `20000` (safe default; no hay config publicada en `main_management`) | `20000` | `60000` (config publicada id 2, version 2) | INTENTIONALLY_DIFFERENT | **B** | `defaults.ts:38`, `resolver.ts:61`, `runAgentToolLoop.ts:1011` |
| `BRAIN_MODEL_TIMEOUT_MS` | `15000` | no lo usa | `15000` | PARITY (sin efecto en R3) | I | solo lo lee `runKnowledgeAgent.ts:259` |
| Presupuesto de decisiones / tool executions | `3` / `2` | `3` / `2` | `loopConfiguration` publicada = null -> 3/2, pero con open-turn el techo fijo no aplica | INTENTIONALLY_DIFFERENT | **B** | `defaults.ts:43`, `resolver.ts:66`; limites 1..12 / 0..12 en `constants.ts` |
| `maxOutputTokens` enviado al provider | no se envia (solo si hay config publicada) | no se envia | `4000` (config publicada) | INTENTIONALLY_DIFFERENT | B | `resolver.ts:57` |
| `maxModelRetries` | `0` | `0` | `5` (config publicada) | INTENTIONALLY_DIFFERENT | B (latencia) | `resolver.ts:63` |
| Modelo | `BRAIN_MODEL_NAME=deepseek-v4-flash` | igual | `deepseek-v4-flash` | PARITY | B | `.env`, `resolver.ts:56` |
| `thinking` del provider en la rama R3 | codigo: `"disabled"` fijo | **omitido (default del provider = razonamiento activo)** | codigo `disabled` presente en `b2fd0c5` (3 ocurrencias) | PARITY (codigo); el benchmark diverge, ver seccion 5 | **B** | `runNativeAutonomousCycle.ts:806` vs `liveProvider.ts` |
| Timeout Catalog / Carrier / Customer Service / Profile | `20000` / `5000` / `5000` / `5000` | Catalog y Carrier stubbeados | Catalog `25000` (search v2 `20000`), Carrier `25000`, Quote `5000`; Customer Service y Profile: clave ausente (default de codigo) | INTENTIONALLY_DIFFERENT | I para decisiones (afecta latencia de tool) | `.env` |
| Timeout HTTP WhatsApp saliente | `10000` | no aplica | clave ausente; `lib/` no la consume | PARITY (sin efecto) | I | `.env` `BRAIN_WHATSAPP_TIMEOUT_MS` |
| Outbox: poll / lock / max attempts / backoff | `4000 ms` (default del worker) / `60 s` / `5` / `30..3600 s` | N/A (solo escribe la fila) | pm2 `--poll-ms=3000 --batch-size=1`; env batch `5`, lock `60 s`; resto default | INTENTIONALLY_DIFFERENT | I | `scripts/autonomous-outbox-worker.ts:28`, `.env` |
| Turn-settle worker: poll | `1000 ms` (default) | N/A | pm2 sin argumentos -> `1000 ms` (default) | PARITY | I | `scripts/autonomous-turn-settle-worker.ts:23` |

### 2.4 Canal Meta / HTTPS

| Aspecto | LOCAL | EC2 (verificado 2026-09-21) | Estado | Imp. | Fuente |
|---|---|---|---|---|---|
| Endpoint webhook publico HTTPS | no existe (sin dominio ni TLS) | `https://98-80-166-131.sslip.io`, certificado Let's Encrypt valido hasta 2026-12-15; `/` responde 307 y el webhook responde 403 a un GET sin token de verificacion | EC2_ONLY | I | curl de estado, `app/api/integrations/whatsapp/webhook/route.ts` |
| Verificacion de firma | sin `META_WHATSAPP_APP_SECRET` y `NODE_ENV!=production` -> se acepta sin firma | secreto configurado (`<set>`) -> firma exigida | INTENTIONALLY_DIFFERENT | I | `route.ts:25-31` |
| Agregacion / debounce de fragmentos inbound | delay `0`: camino sincrono, sin fila pending ni agregacion | delay **5000 ms**, maximo **20000 ms**: el turno se procesa por el worker `crm-turn-settle` tras la ventana de silencio | INTENTIONALLY_DIFFERENT | **B** | `native-whatsapp/service.ts:1225`, `turn-settlement/config.ts` |
| Typing indicator | `false` | `true` | INTENTIONALLY_DIFFERENT | I | `turn-settlement/config.ts` |
| Envio real a Meta | `BRAIN_META_SEND_ENABLED=false`, worker `false`, real send `false` | `BRAIN_META_SEND_ENABLED=true`, `BRAIN_OUTBOX_WORKER_ENABLED=true`, `BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND=true`, `BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true` | INTENTIONALLY_DIFFERENT | I | env |
| Allowlists de piloto | vacias | `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` 3 entradas, `BRAIN_AUTONOMOUS_TEST_WA_IDS` 3, `BRAIN_WHATSAPP_ALLOWED_WA_IDS` 1 (solo conteos) | INTENTIONALLY_DIFFERENT | B (decide quien pasa por R3) | env |
| Eventos delivery/read | sin recibirlos | reales (`outbound_message_sent/delivered/read` presentes en `commercial_event`) | EC2_ONLY | I | `commercial_event` |
| Orden / idempotencia inbound | sin trafico real | real | EC2_ONLY | B indirecto | webhook + `result.duplicate` |

No se intento simular Meta localmente ni cambiar valores locales "para parecer EC2".

### 2.5 Servicios y workers

| Servicio / worker | LOCAL | Benchmark | EC2 (verificado 2026-09-21) | Estado |
|---|---|---|---|---|
| Catalog Service | `http://127.0.0.1:4010`, sin ruta desde este entorno | stub HTTP local | proceso `catalog-service` online, puerto 4010 escuchando, URL local | LOCAL_UNAVAILABLE / EC2 READY |
| Carrier MS | `http://ms.pesaschile.cl` | stub en proceso | URL remota configurada; la raiz responde HTTP 200 desde EC2 | EC2 READY |
| **Quote Service** | `QUOTE_SERVICE_BASE_URL`/`AUTH_TOKEN` sin definir -> BLOCKED | precheck BLOCKED | `QUOTE_SERVICE_BASE_URL` (localhost:3011) y `QUOTE_SERVICE_AUTH_TOKEN` configurados, pero el proceso `quote-service` esta **`stopped`** (2595 reinicios acumulados, log de error vacio) y el puerto 3011 **rechaza conexiones** | LOCAL_UNAVAILABLE / **EC2 BLOCKED (servicio detenido)** |
| Customer Service | `CUSTOMER_SERVICE_BASE_URL` vacio | identidad inyectada | clave ausente en `.env` | BLOCKED en ambos |
| Customer Profile | `CUSTOMER_PROFILE_ENABLED=false` | no aplica | proceso `customer-profile` online, `CUSTOMER_PROFILE_API_URL` definida | LOCAL_UNAVAILABLE / EC2 READY (no probado) |
| Identity resolution | sesion inyectada (LEVEL_0 / LEVEL_2) | fixture | `customer_identity_resolution_recorded` 148 eventos en 30 dias | INTENTIONALLY_DIFFERENT |
| `crm-outbox` | no corre | no corre | online (0 reinicios) | EC2_ONLY |
| `crm-turn-settle` | no corre | no corre | online (5 reinicios); con delay 5000 procesa turnos reales | EC2_ONLY |
| `crm-commercial-work` (R2) | no corre | no corre | **stopped** pese a `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=true` | EC2 stopped |
| `crm-followup` | no corre | no corre | **stopped** | EC2 stopped |
| `crm-web` | no corre | no corre | online (2 reinicios) | EC2_ONLY |
| MariaDB | Docker local `crm_test` (35 migraciones) | igual | base `main_management` de produccion, nunca usada por tests | INTENTIONALLY_DIFFERENT |

### 2.6 Codigo desplegado en EC2

- Rama `develop`, HEAD `b2fd0c5` (`fix(r3): restore clean TypeScript validation`, 2026-09-16). Arbol tracked limpio; hay archivos untracked de operacion (`.env.backup-*`, `.env.save*`, backups `scripts/autonomous-turn-settle-worker.ts.bak.20260916-*`, `scripts/diagnostics/`, el benchmark `quote-conversion-diagnostic-v0`).
- **10 commits detras del `develop` local** (`2a74ed5` P6.2-A hasta `137502b`): EC2 **no tiene** `capability-eligibility` (P6), ni la vista P6.3, ni la telemetria P7.1-P7.3, ni el harness P7.4. Si tiene P4 (proposal), P5 (reconciliacion), kernel y `thinking: "disabled"` en la rama R3.
- `BRAIN_R3_COMMERCIAL_OBJECTIVE_RECONCILIATION_ENABLED` no figura en el `.env` de EC2: P5 esta apagado por default (P4 y kernel encendidos).

### 2.7 Configuracion del agente publicada en EC2

`sales_agent_configurations` (scope `pesas_chile`, id 2, nombre "R3", version 2, schema v3, publicada 2026-08-31, hash `a4439aa8...`):

| Campo | EC2 | Benchmark P7.5 |
|---|---|---|
| `modelConfiguration.model` | `deepseek-v4-flash` | `deepseek-v4-flash` |
| `temperature` | `0` | `0` |
| `timeoutMs` | **`60000`** | `20000` |
| `maxOutputTokens` | **`4000`** (se envia como `max_tokens`) | no se envia |
| `maxModelRetries` | **`5`** | `0` |
| `loopConfiguration` | `null` -> 3 decisiones / 2 tool executions, sin efecto real con open-turn | 3 / 2 con techo fijo |
| `followUpConfiguration` | ausente (follow-up desactivado) | safe default |
| `customInstructions` | **longitud 0** (sin instrucciones propias) | vacio |
| `agentName` / `companyName` / `role` | "Asistente comercial" / "Pesas Chile" / "Asesor comercial" (descripcion de 53 caracteres) | "Asistente comercial" / "la empresa" / "Asesor comercial" |

Conclusion: el prompt de EC2 es esencialmente el mismo que el del benchmark (sin `customInstructions`); lo que difiere son timeout, tokens, reintentos y todas las banderas de turno.

### 2.8 Uso productivo observado (agregados, 2026-08-24 a 2026-09-16, ultimo evento 2026-09-16)

Trafico de piloto pequeno: 204 mensajes entrantes, 143 loops del agente, 137 turnos R3 despachados en 30 dias.

| Metrica | Produccion | Benchmark P7.5 |
|---|---|---|
| Terminal reason de los loops | `responded` 135, `timeout` 5, `provider_unavailable` 1, `no_progress` 1, `handoff` 1 | `responded` 42, `timeout` 19, `handoff` 2 (de 63 turnos) |
| Tasa de timeout | **3.5%** (5/143); los 5 ocurrieron el 2026-09-14; 0 los demas dias | 30% |
| Tool calls por loop | 0: 72, 1: 34, 2: 25, 3: 2, 4: 1, 5: 3, 6: 3, 8: 1, 10: 1, 12: 1 (hay loops de 10 y 12: open-turn sin techo de 2) | maximo 2 |
| `get_product_details` completados | 179 | - |
| `select_products` | 33 solicitados: 8 completados, 22 sin ejecutar por oportunidad (`opportunity_unavailable` 20, `no_active_opportunity` 2, todos el 2026-09-10 en 3 conversaciones), 3 `source_product_not_observed` | 6 completados en 45 runs |
| Conversaciones con `get_product_details` completado | 5; en 4 hubo una solicitud posterior de `select_products` (2 completaron) | - |

Cautela: n es minimo (5 conversaciones) y el trafico incluye pruebas del equipo (por ejemplo una capability `drop_database` rechazada por el Gateway). No es una tasa. Lo que si indica es que **en produccion el modelo si solicita `select_products` tras el grounding**, y que los fallos de `select_products` observados alli fueron de oportunidad (un modo que el benchmark no puede ver porque prepara la oportunidad de antemano).

## 3. Behavioral vs infra-only

**Solo B entra al analisis causal:**
`RUNTIME_ENABLED`+allowlist, kernel, P4, P5, **P6 input**, **open-turn**, harness-aligned, persistent session, compaction, live assimilation, **settle delay**, **timeoutMs**, **presupuesto 3/2**, **maxOutputTokens/retries/modelo**, **`thinking`**, y la **configuracion publicada** (prompt + `customInstructions`).

**Infra-only (no cambian decisiones):** P2 shadow, P6 shadow, workers outbox/followup, timeouts HTTP de servicios (salvo su efecto de latencia dentro del deadline), backoff del outbox, verificacion de firma Meta, typing indicator, entrega/read.

## 4. Diferencias Meta/HTTPS y timing que el benchmark nunca ejercita

El benchmark entra por `runSalesAgentRuntimeCycle`. Nunca pasa por el webhook, el turn-settlement, el `additionalInboundMessageIds` ni el envio. Consecuencias:

1. Un turno con fragmentos ("hola" / "quiero una barra") se mide como un mensaje unico. En produccion, con delay>0, se fusionan en una decision cognitiva (`customerMessageFragments`).
2. El tiempo de espera de settle ocurre **antes** de que empiece el deadline del loop (`runAgentToolLoop.ts:1011`), asi que no consume `timeoutMs`.
3. Con delay `0` el webhook ejecuta el ciclo completo de forma sincrona dentro de la peticion HTTP (`service.ts:1225`), por lo que el turno completo (hasta `timeoutMs`) ocurre dentro del request de Meta.

Ninguna se puede reproducir localmente sin HTTPS/webhook real: `EC2_ONLY`.

## 5. Divergencias del instrumento respecto del codigo de produccion

Estas NO son local-vs-EC2: son diferencias entre lo que el benchmark P7.5 midio y lo que el codigo R3 (identico en EC2 si esta en el mismo commit) hace.

| Divergencia | Benchmark P7.5 | Codigo R3 productivo | Riesgo para la extrapolacion |
|---|---|---|---|
| `thinking` | omitido -> default del provider (razonamiento activo) | `thinking: "disabled"` fijo en la rama R3 (`runNativeAutonomousCycle.ts:806`); hotfix R3 `8f1610b` (2026-08-31): "DeepSeek was consuming the entire output-token budget as reasoning_content, leaving content empty"; ademas se subio `maxOutputTokensMax` a 8192 | **Alto**: latencia y probablemente decisiones. Explica los `reasoningTokens` de 2000-3700 y buena parte de los timeouts |
| Configuracion del agente | `safe_default` fijo (prompt generico, sin `customInstructions`) | `resolveSalesAgentConfiguration` lee la config publicada (prompt, timeout, presupuesto, modelo) | Alto: prompt real desconocido |
| P6.3 input | forzado `true` | **el codigo P6 no existe en EC2 (`b2fd0c5`)**; en local el default es `false` | Alto: el benchmark mide un prompt que EC2 no tiene. C2 (vista apagada) es la condicion equivalente a EC2 |
| Flags P2..P6 shadow | forzados `true` | EC2: P2/P4/kernel `true`; P5 apagado; P6 inexistente | Medio |
| Identidad | sesion inyectada | Customer Service real | Medio |
| Catalog / Carrier | stubs | servicios reales | Bajo (tool time ~0) |
| Settle / webhook | bypass | real, con delay 5000 ms / max 20000 ms | Medio en conversaciones fragmentadas |
| Catalogo `search_products` | stub que **siempre** devuelve `clarification_required` con 2 candidatos, ignorando la consulta | resuelve por consulta | Medio: fuerza una desambiguacion que el catalogo real probablemente no exige (C4/C5: no causa el hallazgo #1) |
| Estado durable "despues del turno" | reportaba mutaciones como ausentes (snapshot refrescado solo al inicio del turno); el 100% de las mutaciones completadas estaba en DB (P7.5: 6/6 select, 3/3 destino; P7.6: 19/19 y 14/14) | n/a | Corregido en P7.6; ver seccion 13 |

| Flags de turno | open-turn, harness-aligned, live assimilation, compaction en `false` (o forzados) | EC2: los cuatro en `true` | **Alto**: el benchmark no midio la configuracion de turno de EC2; con open-turn el techo de 2 tools no existe |
| Timeout / tokens / reintentos | `20000` / no se envia / `0` | config publicada: `60000` / `4000` / `5` | Alto para latencia y para timeouts |

## 6. Hallazgo #1 - grounding -> commit (P7.5)

Fuente: `providerCalls` del batch archivado (incluye prompt completo, latencia y tokens por llamada) y reruns de la seccion 10.

### 6.1 Mecanismo (probado con trazas)

`runAgentToolLoop.ts` (modo legacy, open-turn `false`) itera mientras `decisionIndex < maxDecisions(3) && toolExecutionCount < maxToolExecutions(2)`. Al agotar el techo entra a **finalizacion** (`agent_loop_finalization_entered`): el prompt dice "This turn's tool budget is spent - no more tools are available" y `use_tool` deja de existir.

Traza tipo (E02 run0, `quiero la barra olimpica classic de 20kg`):

| # | Fase | `Steps remaining` que ve el modelo | Latencia | Decision |
|---|---|---|---|---|
| 0 | gathering | 3 | 1451 ms | `search_products` |
| 1 | gathering | 2 | 1784 ms | `get_product_details` |
| - | (2 tool executions = techo) | - | - | `agent_loop_finalization_entered` |
| 2 | finalization | (sin herramientas) | 5231 ms | `respond` + `commercialProposal` |

- La propuesta P4 en **todos** los casos es `SELECT_PRODUCTS / START / PRODUCT_SELECTION`: el modelo **entendio la intencion**.
- El prompt anuncia `Steps remaining: 2` en la 2a decision, pero el techo que realmente se aplica es de **tool executions (2)**, no de decisiones (3). El modelo cree que le quedan 2 pasos y el runtime cierra tras el 2o tool.
- `select_products` exige evidencia de producto (`PRODUCT_IDENTITY`): el camino minimo es `search_products` -> `select_products` (2 tools). Anadir `get_product_details` (habito del modelo: precio/stock/link) lo lleva a 3 tools > 2.

### 6.2 Descripcion del batch P7.5 (no es la causa)

De los 19 turnos no confundidos por timeout: 16 terminaron con 2 tool executions y finalizacion forzada sin `select_products` (E02 x3, E04 x3, E05 t0 x3, E07 x3, E14 x3, E15 run0); 2 (E15 run1/2) hicieron `search_products`+`select_products` y perdieron el destino; 3 (E05 turno 1) usaron 1 solo tool sin agotar el presupuesto. El presupuesto agotado **describe** la mayoria de los casos pero, como muestran los reruns, no es lo que impide el commit.

### 6.3 Clasificacion causal (reruns controlados, seccion 10)

`select_products` completado en el turno indicado, 3 runs por celda, seis condiciones (cada una cambia UNA dimension respecto de su base):

| Turno | C0 base | C1 tools=3 | C2 elig off | C3 thinking off | C4 = C3 + catalogo resuelve | C5 = C0 + catalogo resuelve |
|---|---|---|---|---|---|---|
| E02 t0 `quiero la ... classic de 20kg` | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| E04 t0 `quiero una barra olimpica classic` | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| E05 t0 `quiero la classic` | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| E07 t0 `quiero la barra olimpica classic` | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| E14 t0 `quiero la barra olimpica classic` | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| E15 t0 `quiero 2 barras ..., envialas a Nunoa` | 1/3 | 2/3 | 3/3 | 0/3 | 0/3 | 3/3 |
| E04 t1 `mejor dos unidades` | 2/3 | 3/3 | 3/3 | 0/3 | 3/3 | 3/3 |
| E14 t1 `mejor cotizamela` | 1/3 | 2/3 | 2/3 | 0/3 | 0/3 | 3/3 |

Lectura:

1. **Cinco casos x tres runs x seis condiciones = 90 turnos sin ningun commit en el turno inicial** (E02/E04/E05/E07/E14 t0). Ninguna palanca lo mueve: ni presupuesto, ni vista P6.3, ni razonamiento, ni que el catalogo resuelva el producto. Esto descarta que la causa sea C, D, B o el stub de catalogo, y apunta a **A. PROMPT_POLICY / decision del modelo**: ante "quiero X" sin confirmacion explicita el modelo presenta el producto, ofrece el link y no compromete. Es coherente con `SELECT_PRODUCTS_RULE_LINES` ("solo cuando el cliente confirmo producto Y cantidad") y con la regla de cierre obligatoria del link; el modelo ademas hace `get_product_details` en 15-16 de 18 turnos 0 con razonamiento activo (C0-C2, C5) y en 18/18 en C4 (regla `COMMERCIAL_BEHAVIOR_POLICY_RULE_LINES[1]`: obtener proactivamente el link verificado); en C3 solo 4/18, porque con el catalogo ambiguo prefiere preguntar cual de los dos productos.
2. El commit ocurre cuando el turno siguiente aporta confirmacion o cantidad (E04 t1, E14 t1) y en el caso de mayor intencion (E15: cantidad 2 + destino). En E14 t1 el modelo llega a preguntar "cuantas unidades necesitas?" (3/3 en C4): la politica de cantidad se observa directamente.
3. **C. DECISION_BUDGET es un factor secundario y especifico de multi-hecho**: solo en E15 con 3 tool executions se completan `select_products` **y** `set_shipping_destination` en el mismo turno (C1: 2/3; en el resto 0/3). Con el techo de 2 el modelo sigue el camino `search -> select` y el destino queda pendiente (defecto historico "todo junto").
4. **`thinking` no cambia el no-commit, y con `disabled` el commit baja** (C3/C4: E15 0/3; C3: E04 t1 0/3). Como el codigo R3 productivo usa `thinking: "disabled"`, el baseline P7.5 (razonamiento activo) probablemente **sobreestima** el comportamiento de commit del agente real.
5. **Vista P6.3 (hipotesis E)**: sin efecto en los turnos 0; la subida de E15 (C0 1/3 -> C2 3/3) se reproduce tambien con la vista encendida (C5 3/3), por lo que es ruido de muestra (n=3). No hay evidencia de que `select_products BLOCKED (OBJECTIVE_REQUIRED)` suprima el commit.
6. **Stub de catalogo**: siempre devuelve `clarification_required` con dos candidatos, ignorando el texto de la consulta (documentado en `benchmark/environment.ts`). Sin `thinking` hace que el modelo pregunte "cual de las dos te interesa?" (C3). Con la palanca `BENCHMARK_E2E_CATALOG_QUERY_AWARE=true` (C4/C5) el producto se resuelve y el no-commit persiste: es un limite instrumental real pero **no la causa** del hallazgo #1.

Clasificacion final por caso:

| Caso | Causa primaria | Secundaria |
|---|---|---|
| E02, E04 t0, E05 t0, E07 t0, E14 t0 | A. PROMPT_POLICY (sin confirmacion/cantidad, regla de cierre-link) | - |
| E04 t1, E14 t1 | A (confirmacion tardia, pregunta de cantidad) | D. TIMEOUT en condiciones con razonamiento (turnos con `select_products` completado que igual expiran) |
| E05 t1 | A (sin seleccion previa que reemplazar; sin cantidad) | - |
| E15 | C. DECISION_BUDGET (destino) | A (con `thinking` off pide confirmacion) |
| B. TOOL_METADATA | descartada | - |

## 7. Auditoria de metadata y prompt

### 7.1 Metadata de tools (registry, tal como llega al modelo)

- `select_products`: "Records the customer's confirmed product selection..." / Use when: "the conversation establishes which products and quantities make up the current purchase" / Do not use when: "products are still only being explored, compared, or recommended". Esquema `FULL_REPLACEMENT`. Clara y bien acotada.
- `get_product_details`: Do not use when: "the customer is committing to what they want to buy - **reading a product's details is never a commercial selection (select_products)**". Es una instruccion fuerte y correcta.
- `search_products`: "never current price, stock, variants or link" -> obliga a `get_product_details` para precio/link.
- `recommend_catalog_products`: requiere producto fuente ya identificado.

Conclusion: **no hay ambiguedad de metadata** que explique el comportamiento. El modelo hace lo correcto por tool; lo que falta es presupuesto.

### 7.2 Prompt / policy

A favor del commit:
- `COMMERCIAL_BEHAVIOR_POLICY_RULE_LINES[0]`: "Actively move a qualified commercial conversation toward concrete purchase progress ... prefer executing the next useful capability over asking permission".
- `buildAgentStepPromptPackage.ts:811` (LLM-R1-T08D): priorizar la tool que compromete lo confirmado (`select_products`) sobre `get_product_details` de re-verificacion **pero solo cuando "el mensaje pide mas de una cosa"**. Un pedido de un solo producto no activa esa regla.

En tension:
- `SELECT_PRODUCTS_RULE_LINES[0]`: usar `select_products` solo con "producto(s) y cantidad confirmados"; `[5]`: pedir aclaracion ante cantidad no clara "instead of guessing".
- Regla de cierre obligatoria: si la respuesta identifica un unico producto, cerrar con `"Quieres que te envie el link para revisarlo?"` (con signos de interrogacion de apertura) (empuja a ofrecer link, no a comprometer).
- Presupuesto: el prompt comunica `Steps remaining` (decisiones), no el techo real de tool executions.

### 7.3 Vista P6.3 al modelo

En el turno inicial de cualquier conversacion nueva el modelo recibe `capabilityEligibility.blocked = [select_products: OBJECTIVE_REQUIRED, ...]` y la linea "A blocked capability has a known structural blocker now and can become usable after new facts are obtained during this turn". `OBJECTIVE_REQUIRED` **no lo puede resolver el modelo en el turno** (P5 fija el objective al final). Es un bloqueo irresoluble presentado como transitorio. En el batch P7.5 hubo 10 invocaciones `blockedThenCompleted` (el modelo la ignoro) y no se puede descartar que en otros turnos la haya obedecido. Es hipotesis E; C2 (vista apagada) la puso a prueba sin tocar eligibility: sin efecto medible (ver 6.3).

## 8. Auditoria del timeout de 20 s

### 8.1 Semantica (codigo)

- `runAgentToolLoop.ts:1011`: `deadline = Date.now() + timeoutMs` se calcula **una vez al iniciar el loop**. Es un deadline de **turno completo**, no por llamada ni reiniciado por decision.
- Cada llamada al provider recibe `remainingMs = deadline - now` (`invokeProviderWithDeadline`, `runAgentToolLoop.ts:339`). Incluye tiempo de tools y de servicios HTTP (todo wall-clock).
- El deadline se verifica en ambos modos (legacy y open-turn) "incondicionalmente, nunca se elimina" (`runAgentToolLoop.ts:1390-1412`). Open-turn cambia el techo de decisiones, no el timeout.
- El valor viene de `effectiveModelConfiguration.timeoutMs`: config publicada (clamp 5000..60000) o `20000`. `BRAIN_MODEL_TIMEOUT_MS` (15000 local) no participa en R3.

### 8.2 Latencias medidas (batch P7.5, 63 turnos, 132 llamadas)

| Llamada | n | p50 | p90 | max |
|---|---|---|---|---|
| 0 (1a decision) | 45 | 2.8 s | 20.0 s (censurado por el deadline) | 20.0 s |
| 1 (2a) | 40 | 3.7 s | 9.5 s | 17.7 s |
| 2 (3a / finalizacion) | 23 | 4.5 s | 8.0 s | 9.6 s |
| 3 | 13 | 6.4 s | 15.5 s | 18.3 s |

- En los **19 turnos con timeout la suma de latencia del provider es 19.7-20.0 s**: casi la totalidad del presupuesto se consume en el LLM; tiempo de tools ~0 (Catalog/Carrier son stubs locales).
- La latencia sigue a los **tokens de razonamiento** (`reasoningTokens` ~ `outputTokens`): llamadas de 2500-3700 tokens de razonamiento tardan 9-18 s; las de <300 tokens, 1.5-3 s.
- **9 de 19 timeouts ocurren en la PRIMERA llamada**, sin completar (E09 run2, E10 run0, E11 run0/2, E12 x2, E13 x3): todos son casos de cotizacion. Corrige lo dicho en P7.5 ("correlaciona con decisiones secuenciales"): en esos casos no hay decisiones secuenciales, la primera decision razona demasiado.
- Los otros 10 timeouts (E03 x3, E04 x2, E07, E09 x2, E10, E14) tienen una o dos llamadas previas exitosas (2-18 s, 250-3700 tokens de razonamiento) y la siguiente se corta por el deadline restante.

### 8.3 Clasificacion (paso 11)

- Timeout del benchmark: **20 s = safe default LOCAL**. Valor EC2 verificado: **60 s** (config publicada). Estado: `LOCAL_ONLY`.
- La causa raiz medida no es el 20 s en si sino el razonamiento activo (`thinking` no deshabilitado en el benchmark), mientras el codigo R3 productivo lo deshabilita. **El timeout P7.5 no representa produccion**: EC2 usa 60 s, `thinking: "disabled"` y open-turn; ademas su tasa observada es de 3.5% (5/143 loops, todos el 2026-09-14) frente al 30% del benchmark.

## 9. Quote Service

- LOCAL: `BLOCKED` (`QUOTE_SERVICE_BASE_URL`/`QUOTE_SERVICE_API_KEY` sin definir).
- EC2: **BLOCKED**. URL (`localhost:3011`) y `QUOTE_SERVICE_AUTH_TOKEN` estan configurados, pero el proceso `quote-service` esta `stopped` y el puerto 3011 rechaza conexiones; hoy `create_quote`/`get_quote` fallan tambien en produccion. Nota: el cliente real lee `QUOTE_SERVICE_AUTH_TOKEN`; el precheck del harness verificaba `QUOTE_SERVICE_API_KEY` (variable equivocada, corregido).
- Las fallas de E09-E14 de P7.5 no son evidencia del agente: sin dependencia y con timeouts previos al `create_quote`. No se resolvio en esta fase.

## 10. Reruns controlados

Alcance: E02, E04, E05, E07, E14, E15 x 3 runs, HYBRID (DeepSeek real, `crm_test`, Catalog/Carrier stubbeados). Cada condicion cambia **una** dimension respecto de su base. No son propuestas de tuning ni afirman paridad con EC2 (valor EC2 desconocido): son contrafactuales para atribuir causa. Los directorios estan archivados fuera del repo en `~/benchmark-archive/r3-p7-6/`.

| Cond. | Dimension cambiada | Palanca | Run |
|---|---|---|---|
| C0 | ninguna (control, config local P7.5) | - | `2026-09-21T02-17-32-025Z-live` |
| C1 | `maxToolCallsPerTurn` 2 -> 3 (vs C0) | `BENCHMARK_E2E_MAX_TOOL_CALLS=3` | `2026-09-21T02-24-23-468Z-live` |
| C2 | vista P6.3 apagada (vs C0) | `BENCHMARK_E2E_ELIGIBILITY_INPUT_ENABLED=false` | `2026-09-21T02-31-09-458Z-live` |
| C3 | `thinking: "disabled"` (vs C0; = codigo R3 productivo) | `BENCHMARK_LIVE_LLM_THINKING=disabled` | `2026-09-21T02-38-06-711Z-live` |
| C4 | catalogo resuelve el producto nombrado (vs C3) | C3 + `BENCHMARK_E2E_CATALOG_QUERY_AWARE=true` | `2026-09-21T02-41-51-301Z-live` |
| C5 | catalogo resuelve el producto nombrado (vs C0) | `BENCHMARK_E2E_CATALOG_QUERY_AWARE=true` | `2026-09-21T02-43-55-938Z-live` |

Metricas sobre los 18 turnos de intencion (turno 0 de los 6 casos x 3 runs):

| Cond. | `select_products` | timeouts | finalizacion forzada | tools/turno | latencia p50 / p90 por llamada | tokens de razonamiento (prom.) |
|---|---|---|---|---|---|---|
| C0 | 1/18 | 3 | 16 | 1.89 | 4.0 s / 14.2 s | 576 |
| C1 | 2/18 | 3 | 2 | 2.11 | 3.8 s / 9.5 s | 586 |
| C2 | 3/18 | 2 | 18 | 2.00 | 3.6 s / 10.1 s | 604 |
| C3 | 0/18 | 0 | 4 | 1.22 | 1.7 s / 2.1 s | 0 |
| C4 | 0/18 | 0 | 18 | 2.00 | 1.5 s / 1.9 s | 0 |
| C5 | 3/18 | 2 | 18 | 2.00 | 3.4 s / 9.1 s | 544 |

Advertencia C4/C5: el stub "consciente de la consulta" de esas dos condiciones tenia una regex defectuosa para el nombre `pro` (caracteres de control en lugar de `\b`, corregida en P7.6-B), de modo que las consultas por la Pro (E05 turno 1) seguian devolviendo `clarification_required`. Solo afecta a la fila E05 t1; el resto de las conclusiones de 6.3 no cambia y la seccion 10.2 lo repite con el stub corregido.

Notas de validez: n=3 por celda (diferencias de 1 a 3 sobre 18 estan dentro del ruido); la latencia de DeepSeek vario entre el 2026-09-18 y el 2026-09-21, por eso toda comparacion se hace contra el control del mismo dia; C0-C3 corrieron antes del fix del snapshot posterior, pero las metricas anteriores salen de invocaciones de tools, que ese defecto no afecta. La matriz caso-por-caso esta en 6.3.

Sobre el timeout: sobre los 30 turnos de cada condicion, con razonamiento activo hubo 7-9 timeouts (C0 9, C1 8, C2 7, C5 8) y con `thinking: "disabled"` hubo 0 (C3 0, C4 0); el p90 por llamada baja de 9-14 s a ~2 s. Es la comparacion que faltaba para la seccion 8: la latencia de P7.5 es consecuencia de la configuracion de razonamiento del benchmark, no de un limite de producto de 20 s.

### 10.2 P7.6-B - configuracion EC2-equivalente sobre el codigo de `develop`

Hay dos benchmarks posibles y no se mezclan: **A. EC2-current parity** (codigo `b2fd0c5` + configuracion EC2) y **B. develop-target parity** (codigo actual + configuracion cognitiva/temporal equivalente a EC2). Se ejecuto **B**, porque el producto a validar es `develop` y no perpetuar el estado atrasado de EC2. Por eso P5, P6 y P7 quedan **encendidos** aunque EC2 no los tenga; solo se replican las variables operativas y cognitivas que siguen siendo relevantes. A no se ejecuto (solo tendria valor como comparacion historica puntual).

Palancas (todas `BENCHMARK_E2E_*`, apagadas por defecto, `.env` sin modificar; el manifest registra `benchmarkOverrides` y `notReproducibleInHarness`):

| Variable | Valor EC2 | Estado en el harness |
|---|---|---|
| `BENCHMARK_E2E_OPEN_TURN_ENABLED` | `true` | reproducido |
| `BENCHMARK_E2E_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED` | `true` | reproducido |
| `BENCHMARK_E2E_LIVE_TURN_ASSIMILATION_ENABLED` | `true` | **NOT_REPRODUCIBLE_IN_HARNESS**: el flag se pasa pero es inerte; su ancla es `Number(inboundMessageId)` como id de `conversation_message` (`runAgentToolLoop.ts`) y el harness usa ids de texto y no crea mensajes entrantes posteriores |
| `BENCHMARK_E2E_SESSION_COMPACTION_ENABLED` | `true` | activado pero no ejercitado: solo dispara sobre 40 mensajes crudos de sesion |
| `BENCHMARK_E2E_MODEL_TIMEOUT_MS` | `60000` | reproducido |
| `BENCHMARK_E2E_MAX_OUTPUT_TOKENS` | `4000` | reproducido (llega al provider real) |
| `BENCHMARK_E2E_MAX_MODEL_RETRIES` | `5` | reproducido |
| `BENCHMARK_E2E_THINKING` | `disabled` | reproducido |
| persistent session cognition | `true` | ya era el default |

**EC2_ONLY_CHANNEL_BEHAVIOR (no simulado):** webhook/HTTPS y firma Meta, delay de settle de 5000/20000 ms, eventos delivery/read y worker real de outbox. El harness entra directo por `runSalesAgentRuntimeCycle`; no se agrego ningun `sleep` haciendolo pasar por paridad. Bajo open-turn `maxDecisions=3`/`maxToolExecutions=2` del manifest son inertes: gobiernan el deadline, el guard de no-progreso y los techos de emergencia (24 pasos / 20 tool executions).

Diferencias residuales conocidas: `companyName`/`companyDescription` de la config publicada (texto de identidad del prompt), vista P6.3 encendida (el codigo no esta en EC2), P5 encendido, Catalog/Carrier/identidad stubbeados.

Corridas (6 casos x 3 = 18 cada una, archivadas en `~/benchmark-archive/r3-p7-6/`):

| Corrida | Diferencia | Run |
|---|---|---|
| R1 | configuracion EC2-equivalente, catalogo del harness sin cambios (igual que P7.5) | `2026-09-21T04-08-10-961Z-live` |
| R2 | R1 + el catalogo resuelve el producto nombrado (una sola dimension) | `2026-09-21T04-10-06-911Z-live` |

R1 sola no puede responder la pregunta: con `thinking` apagado el modelo trata el `clarification_required` fijo del stub como ambiguo y solo 2 de 27 turnos llegan al grounding. R2 quita esa distorsion instrumental; es la corrida que se lee.

Cadena medida sobre los 27 turnos con intencion de compra explicita (E02 t0, E04 t0/t1, E05 t0/t1, E07 t0, E14 t0/t1, E15 t0; 3 runs):

| Paso | R1 | R2 |
|---|---|---|
| intencion de compra explicita | 27 | 27 |
| producto identificado (`get_product_details` completado) | 2 | **20** |
| `select_products` intentado / completado | 0 / 0 | **2 / 2** (ambos E15) |
| seleccion durable tras el turno | 0 | 2 |
| grounded -> respuesta final **sin intentar** `select_products` | 2 de 2 | **18 de 20** |
| finalizacion forzada por techo de tools | 0 | 0 |
| checkpoint terminal de open-turn que obligo a continuar | 0 | 0 |
| `no_progress` / emergency ceiling | 0 / 0 | 0 / 0 |
| turnos con timeout | 0 de 30 | 0 de 30 |
| latencia por llamada p50 / p90 | 1.6 s / 2.0 s | 1.4 s / 2.0 s |

Despues de `get_product_details` en R2 (20 turnos): `Steps remaining` mostrado 1 (2 en E14 t1), tool executions restantes 18-19 de 20, tiempo transcurrido 3.0-4.6 s de 60 s, siguiente decision del provider = **respond** en 18 de 20 (en los otros 2, E15, sigue con `set_shipping_destination` / `select_products`). En los 18 turnos sin commit la `CommercialProposal` declara `requestedOutcome` `PRODUCT_SELECTION` (16) o `QUOTE_CREATION` (2): el modelo entiende la intencion y no la ejecuta. El cierre es "quieres que te envie el link para revisarlo?" en 15, pide cantidad o comuna en 2 y otro en 1.

Lectura:

1. **El defecto reproduce bajo la configuracion operativa de EC2 sobre el codigo actual.** Con presupuesto y tiempo de sobra (4 s de 60 s, 18 tool executions libres, sin finalizacion forzada ni checkpoint), el modelo decide responder tras el grounding. Quedan descartadas C. DECISION_BUDGET, D. TIMEOUT, la vista P6.3, `thinking` y el stub como causa; **la causa primaria sigue siendo A. PROMPT_POLICY / decision del modelo**.
2. **Cuando el mensaje trae cantidad y destino, el modelo si compromete y avanza**: E15 completa `select_products`, `set_shipping_destination` y `calculate_shipping` en un solo turno en 2 de 3 runs (con el techo de 2 de P7.5 eran 0 de 3). El "todo junto" de P7.5 era mayormente el techo de tools, que open-turn elimina.
3. En los demas turnos el modelo no compromete ni pregunta lo que falta: ofrece el link. Es un fallo de progresion, no de seguridad.
4. La configuracion EC2 no mejora el commit: E04 t1 ("mejor dos unidades") paso de 3/3 (C4, config local con thinking apagado) a 0/3, y la respuesta es "quieres que avancemos con la cotizacion?". No se atribuyo a una palanca concreta (open-turn, harness-aligned o persistent session); si P7.7 lo necesita, requiere pruebas de una dimension cada una.
5. Con `thinking` apagado la latencia cae a p50 1.4 s / p90 2.0 s y desaparecen los timeouts: el hallazgo #2 de P7.5 era de configuracion del benchmark.

Cautelas: n=3 por celda; catalogo, carrier e identidad son stubs (el catalogo real no se ha ejercitado); el trafico productivo de EC2 (5 conversaciones) si mostro solicitudes de `select_products` tras el grounding en 4 de 5, por lo que el corpus, que empieza cada caso con un primer mensaje "quiero X", puede ser mas exigente que ese trafico; `commercialOutcomeCompletionRate` y las categorias `UNKNOWN` (13-14 de 16-18 fallas) siguen inflados por la deuda del clasificador (un caso que nunca intenta la herramienta cae en `UNKNOWN`; `DURABLE_STATE_FAILURE` se dispara si *cualquier* tool relevante completo).

Criterio para avanzar: bajo configuracion equivalente persiste "explicit purchase -> grounded product -> final answer -> no `select_products`" de forma consistente (18 de 20 turnos grounded). **Se cumple: el siguiente paso es P7.7 - Grounding-to-Commit Behavior Fix**, con cambios minimos de prompt/semantica de tools (no antes de aprobarlo).

## 11. P8

**P8 sigue sin evidencia a favor.** El patron que P8 resolveria (una tool cambia el estado, el agente sigue razonando dentro del mismo turno sobre un snapshot viejo y eso causa el error posterior) no aparece:

- El no-commit del turno 0 ocurre antes de cualquier mutacion (0 mutaciones, nada que reproyectar) y es insensible a las seis palancas probadas.
- Donde hay dos hechos en un turno (E15), la causa medida es el techo de tool executions, no un snapshot obsoleto: con 3 tool executions el modelo hace `select_products` y luego `set_shipping_destination` sin reproyeccion (C1: 2/3).
- El unico "snapshot viejo" real que aparecio fue el del **harness** (estado despues del turno), no el del agente, y ya esta corregido.

P7.6-B lo confirma con la configuracion de EC2: tras el grounding sobran tiempo y tool executions, no hay finalizacion forzada y no se observa ningun caso de decision tomada sobre un snapshot obsoleto.

Para no confundir con P8: el desajuste entre `Steps remaining` (decisiones) y el techo real de tool executions (seccion 6.1) es de contrato de presupuesto/prompt, no de reproyeccion.

## 12. Procedimiento usado para leer EC2 sin exponer secretos

Este procedimiento (ya ejecutado el 2026-09-21) sirve para repetir la verificacion tras cada deploy. Solo imprime nombres de claves de una allowlist no secreta (nunca `KEY`, `TOKEN`, `SECRET`, `PASSWORD`):

```bash
cd /home/ec2-user/CRM-Customer-360
git rev-parse HEAD
grep -E '^(BRAIN_SALES_AGENT_RUNTIME_ENABLED|BRAIN_SALES_AGENT_RUNTIME_WA_IDS|BRAIN_AGENT_TOOL_LOOP_ENABLED|BRAIN_R3_[A-Z_]*_(ENABLED|DELAY_MS|MAX_MS)|BRAIN_AUTONOMOUS_RESPONSES_ENABLED|BRAIN_MODEL_NAME|BRAIN_MODEL_TIMEOUT_MS|BRAIN_OUTBOX_WORKER_ENABLED|BRAIN_META_SEND_ENABLED|BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED|SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON)=' .env | sed -E 's/(SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON)=.*/\1=<set>/'
pm2 jlist | python3 -c "import sys,json;[print(p['name'],p['pm2_env']['status']) for p in json.load(sys.stdin)]"
```

Y la configuracion publicada, sin el contenido del prompt:

```sql
SELECT id, scope_key, status, version, published_at,
       JSON_EXTRACT(configuration_json,'$.modelConfiguration.timeoutMs')  AS timeout_ms,
       JSON_EXTRACT(configuration_json,'$.modelConfiguration.maxOutputTokens') AS max_out,
       JSON_EXTRACT(configuration_json,'$.loopConfiguration')             AS loop_cfg,
       CHAR_LENGTH(JSON_EXTRACT(configuration_json,'$.customInstructions')) AS custom_instr_len
FROM sales_agent_configurations WHERE status='published';
```

(el nombre exacto de la columna JSON debe confirmarse contra `migrations/026_sales_agent_configurations.sql`).

## 13. Correcciones a P7.5

1. "Tool-budget ceiling: 0 ocurrencias" era incorrecto. El techo no aparece como `max_steps_exceeded`; aparece como `agent_loop_finalization_entered` seguido de un `responded`. 16 de los 19 turnos sin `select_products` lo tocaron.
2. "Timeout correlaciona con decisiones secuenciales": incompleto. La causa medida es la latencia de razonamiento; 9/19 timeouts ocurren en la primera llamada.
3. El baseline P7.5 **no es una medicion fiel del R3 productivo**: `thinking` omitido, `safe_default` en lugar de la config publicada, P6.3 forzado. Sigue siendo una linea base valida del agente *tal como el harness lo configuro*.
4. **El estado durable "despues del turno" del harness era obsoleto** y el fix de P7.5 fue incompleto: solo refrescaba carrito/destino al inicio de cada turno. El 100% de las mutaciones completadas estaba persistido en DB (P7.5: 6/6 `select_products`, 3/3 `set_shipping_destination`) pero el trace las reportaba ausentes. Efecto sobre P7.5: 3 de las 35 fallas (E03 run2, E04 run0, E04 run2) eran falsos negativos (`DURABLE_STATE_FAILURE` por seleccion "ausente") y pasan a PASS (10 -> 13 PASS de 45); `commercialOutcomeCompletionRate` (40%) esta subestimado; el detector `repeatKnown*` no podia dispararse. El hallazgo #1 (no se llama `select_products`) **no** se ve afectado: sale de las invocaciones de tools. Corregido en esta fase.
5. El precheck de Quote Service del harness P7.4 verificaba `QUOTE_SERVICE_API_KEY`; el cliente real lee `QUOTE_SERVICE_AUTH_TOKEN`. Corregido (`environmentHealthPrecheck.ts`). Localmente sigue BLOCKED (ninguna de las dos variables esta definida).
6. El baseline P7.5 no midio la configuracion de EC2 (ver 2.6-2.7): sin open-turn, harness-aligned, live assimilation ni compaction, con timeout 20 s y `thinking` activo, y con la vista P6.3 que EC2 no tiene.
7. Fixes del instrumento aplicados en P7.6/P7.6-B (no cambian al agente): estado durable post-turno re-leido antes de cada captura (con regresion en `runCommercialE2ECorpus.test.ts`); precheck de Quote Service con `QUOTE_SERVICE_AUTH_TOKEN`; categoria `TIMEOUT` propia en la taxonomia (se evalua despues de `DEPENDENCY_FAILURE`/`IDENTITY_FIXTURE` y antes de las conductuales); `QUOTE_CONFIRMATION_CLAIM_PATTERN` ahora entiende negaciones a nivel de oracion; regex `\bpro\b` del stub de catalogo corregida.
8. Deuda del clasificador aun abierta: `DURABLE_STATE_FAILURE` se dispara cuando *cualquier* tool relevante completo aunque la expectativa fallida sea de otra tool (R1 E07 run1), y un caso que nunca intenta la herramienta cae en `UNKNOWN`.
9. Las cifras historicas (tool selection ~86.7%, boundary ~0%) no estan en el repo. Una sesion previa (2026-09-15) las ubico en un benchmark sin commitear en EC2 (`quote-conversion-diagnostic-v0`), lo que confirma que provienen de un harness distinto (nivel `runAgentToolLoop`, sin `trustedCustomerSession`).

## 14. Archivos modificados en esta fase

- `docs/audits/r3-p7-6-runtime-config-parity-audit.md` (este documento).
- `lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECase.ts`: dos palancas de diagnostico por variable de entorno, sin efecto si no se definen: `BENCHMARK_E2E_MAX_TOOL_CALLS` (solo `maxToolCallsPerTurn`) y `BENCHMARK_E2E_ELIGIBILITY_INPUT_ENABLED=false`.
- `lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECorpus.ts`: el manifest refleja el override del presupuesto de tools.
- `lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/environmentHealthPrecheck.ts`: el precheck de Quote Service verifica `QUOTE_SERVICE_AUTH_TOKEN` (la variable que lee el cliente real).
- `lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECase.ts` (ademas): `refreshSnapshotFacts()` se ejecuta antes de la captura inicial, al inicio de cada turno y antes de la captura final (fix del estado obsoleto). Sin efecto sobre lo que ve el agente.
- `lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/benchmarkOverrides.ts` (nuevo): palancas `BENCHMARK_E2E_*` de P7.6-B, apagadas por defecto; `types.ts`, `runCommercialE2ECase.ts` y `runCommercialE2ECorpus.ts` las consumen y el manifest agrega `modelConfig.maxModelRetries`, `modelConfig.thinking`, `benchmarkOverrides` y `notReproducibleInHarness`.
- `failureClassification.ts` (categoria `TIMEOUT`) y `conversationalSignals.ts` (negaciones).
- Tests: `tests/commercial/benchmarkE2E/benchmarkOverrides.test.ts` (nuevo), casos nuevos en `conversationalSignals.test.ts` y `scoreCaseAndFailureClassification.test.ts`, fixture de `artifacts.test.ts` y una regresion del estado post-turno en `tests/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECorpus.test.ts`.
- `lib/brain/commercial/agent-loop/benchmark/environment.ts`: palanca `BENCHMARK_E2E_CATALOG_QUERY_AWARE=true` en el stub de catalogo (resuelve el producto cuando la consulta nombra exactamente uno de los dos productos del fixture). Apagada por defecto; los corpus legacy no cambian.

## 15. Respuestas y siguiente paso

1. **Diferencias local vs EC2**: grandes (secciones 2.1-2.8). EC2 corre R3 con open-turn, harness-aligned, live assimilation y compaction activos, settle 5000/20000 ms, config publicada con timeout 60 s, 4000 tokens y 5 reintentos, `thinking` deshabilitado, envio real a Meta habilitado, sin el codigo P6/P7 y con `quote-service`, `crm-commercial-work` y `crm-followup` detenidos.
2. **Cuales cambian decisiones (B)**: config publicada (timeout, tokens, reintentos), open-turn, harness-aligned, live assimilation, compaction, persistent session, settle delay, `thinking`, allowlists de piloto y la vista P6.3 (que EC2 no tiene).
3. **El timeout P7.5 representa EC2?** No: `LOCAL_ONLY`. EC2 usa 60 s con `thinking` deshabilitado y su tasa observada es 3.5% (5/143, todos el 2026-09-14) contra 30% en P7.5.
4. **Grounding -> commit reproduce bajo configuracion equivalente?** **Si.** Bajo la configuracion cognitiva/temporal de EC2 (open-turn, harness-aligned, compaction, `thinking` deshabilitado, timeout 60 s, 4000 tokens, 5 reintentos) sobre el codigo actual con P5/P6/P7 encendidos y el catalogo resolviendo el producto (R2), 18 de 20 turnos con producto identificado terminan en respuesta final sin intentar `select_products`, usando ~4 s de 60 s y con 18 tool executions libres. Limitaciones: live assimilation no es reproducible en el harness, el settle de 5 s es `EC2_ONLY_CHANNEL_BEHAVIOR` y catalogo/identidad son stubs.
5. **Causa**: A. PROMPT_POLICY / decision del modelo. Descartadas C. DECISION_BUDGET (open-turn elimina el techo y sobran tool executions), D. TIMEOUT (0 de 30 turnos), B. TOOL_METADATA, la vista P6.3, `thinking` y el stub de catalogo. El presupuesto solo explicaba el "todo junto" de E15 (ahora 2 de 3 completan producto, destino y envio).
6. **P8**: sin evidencia. En produccion los fallos observados de `select_products` fueron de oportunidad (`opportunity_unavailable`), no de estado obsoleto.
7. **Cambio minimo a probar despues** (no implementado aqui): la condicion del criterio se cumplio, asi que la fase siguiente es **P7.7 - Grounding-to-Commit Behavior Fix**, con el cambio mas chico posible y medido con la configuracion EC2-equivalente de 10.2: (a) primero una variante acotada de la politica de commit inyectada por `configuration.customInstructions` (hoy vacio en EC2, prueba limpia y reversible), midiendo el mismo corpus; (b) solo si funciona, evaluar `SELECT_PRODUCTS_RULE_LINES` y la regla de cierre obligatoria del link, y alinear `Steps remaining` con el contrato real; (c) verificar que E04 t1 no empeore (0/3 hoy) y que E15 conserve 2 de 3. Por separado, fuera del agente: restaurar `quote-service` en EC2 y revisar por que `crm-commercial-work` y `crm-followup` estan detenidos con el worker habilitado.
