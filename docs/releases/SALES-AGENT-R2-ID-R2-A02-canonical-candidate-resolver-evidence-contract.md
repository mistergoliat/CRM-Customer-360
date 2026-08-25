# SALES-AGENT-R2-ID-R2-A02 - Canonical Candidate Resolver + Identity Evidence Contract

## Veredicto

`ID_R2_A02_CANDIDATE_RESOLVER_VALIDATED`

## 1. Baseline y revalidacion de HEAD

Baseline obligatorio: `docs/audits/SALES-AGENT-R2-ID-R2-A01-existing-identity-onboarding-engine-reuse-audit.md`, veredicto `IDENTITY_ENGINE_HYBRID_REUSE`. Se revalido contra HEAD (`3decd40`) antes de tocar codigo: los paths citados por A01 siguen exactos - `lib/domains/customer-identity/{types,service,local-adapter,ports,index}.ts`, `lib/integrations/customer-external-identity/*`, `lib/customer-identity/sourceReaders.ts`, `resolveNativeCustomerSession.ts` con su unico caller real de `resolveIdentity` (`lib/brain/commercial/native-cycle/customer-session/resolveNativeCustomerSession.ts:149`). No hubo drift entre A01 y esta tarea.

## 2. Resolver anterior

`CustomerIdentityResolutionService.resolveIdentity({ channel, externalId, phoneNumber })` resolvia solo dos senales: `wa_id` exacto (`provider + external_id` contra `customer_external_identity`) y telefono normalizado cross-provider. Salida: `status` (`identified | identification_required | conflict | temporarily_unavailable | invalid_input`), `customerId`, `matchedBy`, `confidence`, `conflicts[]`, `warnings[]`. No conocia email, PrestaShop ni orden.

## 3. Resolver nuevo

Mismo entry point (`createCustomerIdentityResolutionService`/`resolveIdentity`), sin engine paralelo. La logica wa_id/telefono (`resolveWaPhone` en `service.ts`) es el mismo codigo de antes, extraido intacto a una funcion interna - probado con la suite original sin ningun test modificado en su aserción. `resolveIdentity` ahora:

1. Corre `resolveWaPhone` (sin cambios).
2. Si el resultado base no es `temporarily_unavailable`/`invalid_input`, intenta candidate discovery por `email`/`orderReference` (nuevos campos opcionales en `ResolveCustomerIdentityInput`, ambos `undefined` para todo caller existente).
3. Clasifica esas dos senales con una funcion pura (`classifyPrestashopCandidates`, `lib/domains/customer-identity/evidence.ts`).
4. Si emergio un unico `prestashopCustomerId`, verifica el bridge hacia `master_customer` reutilizando el mismo metodo generico ya existente, `findCustomerByExternalIdentity({ provider: "prestashop", externalId })` - **no se agrego un metodo de puerto nuevo para esto**, porque ya era provider-agnostic.
5. Combina base + evidencia PrestaShop con `applyIdentityEvidence` (8 reglas deterministicas, PARTE 10) y devuelve el resultado final.

`ResolveCustomerIdentityResult` gana un campo `detail?: IdentityResolutionDetail`, opcional a nivel de tipo (para no romper ~8 archivos de test que construyen resultados fake a mano en runtimes no relacionados a esta tarea) pero **siempre poblado por el servicio real**. `detail.status` usa el vocabulario ampliado (`RESOLVED | CANDIDATE | NEEDS_VERIFICATION | AMBIGUOUS | IDENTITY_CONFLICT | NOT_FOUND | INVALID_INPUT | SYSTEM_FAILURE`) exigido por la PARTE 2; el `status` externo de 5 valores se mantiene intacto y **solo** puede escalar a `"conflict"` (nueva contradiccion PrestaShop-vs-wa_id) o `"temporarily_unavailable"` (fuente PrestaShop caida sin nada mas que usar) - nunca a `"identified"` por email/PrestaShop solos. Esa es la decision central de la PARTE 2: mantener los estados externos y agregar el detalle interno, en vez de romper el contrato de 5 estados.

## 4. Identity Evidence Contract (en memoria, sin persistencia nueva)

`lib/domains/customer-identity/types.ts`:

```ts
type IdentityEvidence = {
  signalType: "wa_id" | "phone" | "email" | "prestashop_customer_id" | "order_reference";
  source: "customer_external_identity" | "prestashop" | "order";
  strength: "observed" | "candidate" | "strong" | "verified" | "conflict";
  masterCustomerId?: string;
  prestashopCustomerId?: string;
  verified: boolean;
  observedAt: string;
};

type IdentityResolutionDetail = {
  status: IdentityResolutionDetailStatus; // RESOLVED | CANDIDATE | NEEDS_VERIFICATION | AMBIGUOUS | IDENTITY_CONFLICT | NOT_FOUND | INVALID_INPUT | SYSTEM_FAILURE
  masterCustomerId: string | null;
  prestashopCustomerId: string | null;
  evidence: IdentityEvidence[];
  conflictCode: CustomerIdentityConflictType | null;
};
```

Difiere del shape conceptual del audit A01 solo en que no incluye `evidenceId`/`conversationId`/`sourceRecordRef`/`freshness` - esos campos son de durabilidad (persistencia + reprojection), explicitamente fuera de alcance de A02 (ver Deudas). Nunca carga email/telefono crudos: `IdentityEvidence` solo transporta ids derivados (`masterCustomerId`, `prestashopCustomerId`), nunca el valor de la senal en si. Probado en runtime (no solo por tipo) por el test de serializacion (Parte 8, IDR22).

## 5. Source readers reutilizados

`lib/customer-identity/sourceReaders.ts` (legacy) usa descubrimiento dinamico de columnas (`getColumns` + SQL generado por tabla) y produce estados legacy (`created_provisional`, etc.) inaceptables para R2. Se **adapto el vocabulario** (que columnas mirar en `ps_customer`/`ps_orders`, que campos importan) pero se escribio un lector nuevo, chico y estatico: `lib/integrations/prestashop-mirror/repository.ts` (`findPrestashopCustomerIdsByEmail`, `findPrestashopCustomerIdsByOrderReference`). No importa `sourceReaders.ts` ni `resolveCustomerCandidate.ts` en ningun punto (verificado por un test estatico de imports, IDR21). SQL estatico contra columnas confirmadas reales (ver Parte 6), nunca `getColumns`-driven como el legacy.

`ps_address` **nunca** se lee ni se referencia en el resolver nuevo (verificado por test estatico, IDR13) - PARTE 9 lo prohibe explicitamente como prueba de identidad.

## 6. Topologia de datos observada vs. semantica de email

**Correccion sobre la version anterior de este documento**: decia "no existe una base `pesas_productiva` ni una conexion PrestaShop separada en este repo", concluyendo eso solo de que ambos readers (identidad y PrestaShop) usan el mismo pool. Eso mezclaba dos preguntas distintas - topologia fisica observada vs. propiedad logica del schema - y la primera estaba ademas incompleta. Los hechos verificados, separados:

### Topologia fisica (lo que el codigo realmente conecta)

- `getPool()` (`lib/db.ts:13-28`) es el **unico** factory de conexion usado por toda la app - incluye `customer_external_identity`, `master_customer`, y el `prestashop-mirror/repository.ts` nuevo de esta tarea. Esta hardcodeado a `resolveNamedDatabaseConnection("app")` (`lib/db.ts:15`); nunca al target `"legacy"`.
- `resolveNamedDatabaseConnection("app", ...)` (`lib/database-config.ts:204-213`) lee `DATABASE_HOST`/`DATABASE_PORT`/`DATABASE_NAME`/`DATABASE_USER`/`DATABASE_PASSWORD` (alias `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`). En este entorno, `.env` fija `DATABASE_NAME=main_management` (`DB_NAME=main_management`).
- Todo el SQL de `ps_customer`/`ps_orders` (legacy y nuevo) usa nombres de tabla sin calificar (`FROM \`ps_customer\``, sin prefijo de schema) - resuelve contra la base activa de la conexion, sea cual sea.
- Conclusion fisica, verificada en vivo: en este entorno, `ps_customer`/`ps_orders` y `master_customer`/`customer_external_identity` viven en la **misma** base fisica (`main_management`), a traves de la **misma** conexion. Esto no es nuevo de esta tarea - el resolver legacy (`lib/customer-identity/sourceReaders.ts`) ya lo asumia via el mismo `getPool()`/`getColumns()`.

### Seam de configuracion existente (no usado por ningun runtime)

El repo si define, deliberadamente, una nocion de conexion "legacy" separada:

- `lib/database-config.ts:163-215` (`resolveNamedDatabaseConnection`) tiene un target `"legacy"` con su propio namespace de env vars (`LEGACY_DATABASE_HOST/PORT/NAME/USER/PASSWORD`). `.env`/`.env.example` ya provisionan `LEGACY_DATABASE_USER`/`LEGACY_DATABASE_PASSWORD` (credenciales propias, distintas del target `app`).
- `scripts/db-utils.ts:41-51` (`getTargetDatabaseName`) resuelve el target `"legacy"` a una base **fisicamente distinta**: `crm_legacy_fixture` (vs. `main_management` para `"dev"`). `npm run db:legacy:reset` (`package.json:21`) existe especificamente para reconstruir esa base separada.
- `scripts/db-seed.ts:9-30` (`seedTarget`) siembra `database/fixtures/legacy-n8n-schema.sql` (el archivo que crea `ps_customer`/`ps_orders`/`ps_address`) en **ambos** casos: por diseño, cuando el target es `"dev"`/`"test"` (linea 18, `target !== "legacy"`) igual que cuando el target es `"legacy"` (lineas 22-24). Es decir, la co-ubicacion en `main_management` que se observa en este entorno **es la seed intencional del repo**, no una casualidad ni un drift de este dev instance.
- **Pero ningun caller de produccion o de `lib/`/`app/` invoca `resolveNamedDatabaseConnection("legacy")`** (grep completo, cero resultados) - `crm_legacy_fixture` solo lo tocan los scripts de reset/seed para pruebas aisladas del path legacy; ningun reader (ni el legacy `sourceReaders.ts`, ni el nuevo `prestashop-mirror/repository.ts`) lo lee jamas en runtime.

### Propiedad logica del schema (independiente de la topologia)

`ps_customer`/`ps_orders`/`ps_address` son, por nombre y forma de columnas (`id_customer`, `id_order`/`reference`/`invoice_number`), datos **logicamente propiedad de PrestaShop** - un dominio distinto de `master_customer`/`customer_external_identity`, que es propiedad del CRM. Esa separacion logica (ya establecida por la auditoria A01: "`master_customer.id` no equivale a `ps_customer.id_customer`") **no cambia** por el hecho de que, en este entorno, ambos dominios esten fisicamente co-ubicados. El codigo de esta tarea no asume ni requiere co-ubicacion: usa `getPool()`/`safeQueryRows`/`getColumns` exactamente igual que el resolver legacy ya lo hacia, sin codificar `main_management` en ningun lado (`repository.ts` no tiene un nombre de base hardcodeado). Si en un despliegue real se apuntara `DATABASE_NAME` a una base donde solo vive el dominio CRM, y `ps_customer`/`ps_orders` vivieran en otra base real (sea `crm_legacy_fixture`, un futuro `pesas_productiva`, o cualquier otra) alcanzable **solo** re-cableando `getPool()` a un target distinto (p. ej. `"legacy"`) - este codigo seguiria funcionando sin cambios una vez hecho ese recableo, porque no depende de la co-ubicacion, solo la hereda cuando existe.

No se cambio ninguna decision de arquitectura de dominio a partir de esta observacion (instruccion explicita del usuario) - esto es documentacion de topologia, no una propuesta de refactor.

### Schema real de `ps_customer` (confirmado en vivo, no solo el fixture en disco)

- `UNIQUE KEY uq_ps_customer_email (email)` - un email mapea a lo sumo a una fila.
- Sin columna de shop scope (`id_shop`), sin soft-delete/`active`, sin guest-checkout flag.
- Collation `utf8mb4_unicode_ci` (case-insensitive a nivel DB), pero la comparacion en codigo igual normaliza a minusculas antes de consultar (`normalizeCustomerEmail`, reutilizado de `lib/domains/customers/email.ts` - no se reimplemento).

Comportamiento: 0 matches -> `NOT_FOUND` (no crea nada); 1 match -> `prestashopCustomerId` candidate; >1 matches (posible solo si el schema real de produccion no impone la constraint observada aqui) -> `AMBIGUOUS`, nunca se elige uno por heuristica. Sin fuzzy matching.

## 7. Semantica de wa_id/telefono

Sin cambios de comportamiento - `resolveWaPhone` es el mismo codigo de ACS-R1-04-T02, ahora extraido a una funcion nombrada dentro de `service.ts` pero byte-identico en su logica de decision. Los 6 tests unitarios y 6 tests de integracion (DB real) originales pasan sin modificar sus aserciones.

## 8. Semantica de candidato PrestaShop -> master

El bridge (`master_customer.id -> ps_customer.id_customer`) se resuelve consultando `customer_external_identity` con `provider = "prestashop"`, `external_id = <id_customer>` - reutilizando `findCustomerByExternalIdentity`, ya generico en `provider`. `uq_customer_external_identity_provider_external_id (provider, external_id)` (migration 010) hace que un mismo id de PrestaShop no pueda estar linkeado a mas de un master **a nivel de escritura real** - el caso "E" del audit (un mismo PrestaShop id en multiples masters) queda estructuralmente prevenido por esa constraint. El resolver igual lo trata defensivamente (IDR16, `prestashop_id_multi_master`) por si un `CustomerIdentityPort` futuro no diera esa garantia.

Ningun writer del repo crea filas `customer_external_identity` con `provider = "prestashop"` hoy (confirmado en A01) - en la practica, todo lookup de bridge en este entorno devuelve "no linkeado" (Caso D), y el resolver reporta `CANDIDATE`, nunca `RESOLVED`/`NEEDS_VERIFICATION`. Eso es el comportamiento correcto mientras no exista ese writer (ID-R2-A07 en el roadmap del audit).

## 9. Evidencia de orden y validacion minima de ownership (revalidado)

**Correccion sobre la version anterior**: decia "Sin ownership validator... orderReference sigue siendo evidencia, nunca prueba de titularidad", lo cual subestimaba lo que el codigo ya hace. Revalidado con el path exacto, linea por linea.

### Path A - orderReference vs. email (Regla 5/6, lo que prueban IDR10/IDR11)

```
input.orderReference
  -> service.ts:135  port.findPrestashopCustomerIdsByOrderReference({ orderReference })
  -> prestashop-mirror/repository.ts:54-66
       SELECT DISTINCT id_customer FROM `ps_orders`
       WHERE (id_order=? OR reference=? OR order_reference=? OR invoice_number=?)
         AND id_customer IS NOT NULL
  -> orderCandidateIds: string[]                          (ps_orders.id_customer real)

input.email
  -> service.ts:128  port.findPrestashopCustomerIdsByEmail({ normalizedEmail })
  -> prestashop-mirror/repository.ts:37-50
       SELECT DISTINCT id_customer FROM `ps_customer` WHERE LOWER(email)=?
  -> emailCandidateIds: string[]                          (ps_customer.id_customer real)

evidence.ts:46-52  classifyPrestashopCandidates()
  const emailId = emailCandidateIds.length === 1 ? emailCandidateIds[0] : null;
  const orderId = orderCandidateIds.length === 1 ? orderCandidateIds[0] : null;
  if (emailId && orderId) {
    return emailId === orderId
      ? { kind: "resolved", prestashopCustomerId: emailId, strength: "verified" }  // Regla 5
      : { kind: "cross_source_conflict" };                                         // Regla 6
  }
```

Esta comparacion **es real y deterministica**: compara el `id_customer` que efectivamente posee la orden (`ps_orders.id_customer`, dato de PrestaShop, no auto-reportado) contra el `id_customer` que produce el email que el cliente escribio este turno. No son el mismo dato reportado dos veces - son dos consultas independientes a dos tablas distintas que deben coincidir. Si coinciden, es evidencia cruzada consistente (`verified`); si no coinciden, es `IDENTITY_CONFLICT` (`email_vs_order_prestashop_id`) y el `status` externo escala a `"conflict"` - nunca se ignora la discrepancia.

### Path B - orderReference vs. la identidad ya verificada del canal (Regla 1/2, mas fuerte que A)

Cuando `classifyPrestashopCandidates` resuelve un `prestashopCustomerId` unico (sea por orden sola, por email solo, o por ambos convergiendo), `service.ts:154-159` siempre lo cruza contra el bridge `customer_external_identity(provider="prestashop")`, y `evidence.ts:259-267` compara ese `linkedMaster` contra `baseMaster` - el master que **ya resolvio el wa_id/telefono de quien esta escribiendo ahora mismo** (la unica identidad de este turno que el sistema trata como controlada por el interlocutor, no auto-reportada):

```
evidence.ts:259  if (linkedMaster === baseMaster) -> RESOLVED   (orden pertenece a quien escribe)
evidence.ts:267  else                             -> IDENTITY_CONFLICT, status externo -> "conflict"
```

Esto es la comparacion mas fuerte posible sin un servicio de ownership dedicado: "¿el dueño real de esta orden (via PrestaShop) es la misma persona cuyo wa_id/telefono ya identificamos este turno?". Hoy siempre devuelve Caso D (`CANDIDATE`, sin bridge) porque ningun writer crea filas `provider="prestashop"` (Parte 8) - el mecanismo esta implementado y probado (fake port), pero no se ejercita con datos reales en este entorno porque el prerequisito (bridge poblado) todavia no existe.

### Que es esto y que NO es

Path A + Path B juntos **son la validacion minima de ownership determinstica necesaria para usar `orderReference` como evidence sin fabricar nada**: nunca se acepta una orden aislada como identificadora (IDR12, orden sin ningun otro dato converge en `NOT_FOUND`), y toda vez que hay algo con que cruzarla (email u wa_id/telefono ya resuelto), se cruza deterministicamente antes de subir el `strength`. Esto **reemplaza** la caracterizacion anterior ("solo evidencia recolectada, sin validacion") - la validacion si existe y esta cubierta por tests (IDR10/IDR11 para Path A; Rules 1/2 - Casos A/C - para Path B, cubiertos por IDR07/IDR08/IDR09).

Lo que esto **no** es, y sigue siendo deuda real:

- No es un boundary/servicio reusable y formal - vive inline dentro de `classifyPrestashopCandidates`/`applyIdentityEvidence`, acoplado al resolver de identidad. Extraerlo a un modulo de "order ownership" propio (para que, p. ej., un futuro flujo postventa lo reuse sin pasar por todo `resolveIdentity`) queda como deuda explicita.
- No otorga `LEVEL_4_VERIFIED_FOR_SENSITIVE_ACTION` ni ninguna autoridad para operaciones sensibles (reclamos, garantia, estado de pedido) - eso exige una policy formal que hoy no existe (Parte 8 del enunciado: "No conceder todavia LEVEL_4 si no existe policy formal"), y sigue siendo el alcance de `ID-R2-A04`.
- Sin Path B poblado (bridge vacio, caso actual), Path A por si solo sigue siendo evidencia a nivel de PrestaShop-id, no una prueba de que el interlocutor controla esa cuenta - `verified` en la Regla 5 describe convergencia entre dos senales del mismo turno, nunca ownership del canal.

## 10. Reglas de conflicto duras (PARTE 10, las 8 implementadas)

Implementadas en `applyIdentityEvidence`/`classifyPrestashopCandidates` (`evidence.ts`), sin score agregado, sin LLM:

| Regla | Condicion | Resultado |
|---|---|---|
| 1 | wa/phone master A + PrestaShop linkeado a master A | `RESOLVED`, status externo sin cambio |
| 2 | wa/phone master A + PrestaShop linkeado a master B | `IDENTITY_CONFLICT`, status externo escalado a `conflict` |
| 3 | phone candidate A + email candidate A | evidencia convergente fuerte (`verified`) |
| 4 | phone candidate A + email candidate B | cubierto por Regla 2 cuando ambos resuelven master via bridge |
| 5 | email PS A + orden PS A | evidencia PS-level `verified` |
| 6 | email PS A + orden PS B | `IDENTITY_CONFLICT` (`email_vs_order_prestashop_id`), status externo escalado |
| 7 | email solo, sin bridge | `CANDIDATE`/`NOT_FOUND`, nunca `RESOLVED` |
| 8 | nombre/direccion solo | insuficiente - ni siquiera es un signal type valido en el resolver |

Precedencia: conflictos cruzados entre fuentes (Reglas 2/6) siempre ganan sobre candidatos/ambiguedad de una sola fuente; una fuente PrestaShop caida (`SYSTEM_FAILURE`) nunca degrada una identidad wa/phone ya resuelta, solo se agrega como warning.

## 11. Privacidad

`IdentityEvidence` nunca lleva el valor crudo de email/telefono (Parte 4). Verificado en runtime (no solo por tipo): un test end-to-end normaliza `Camila.Rojas@Example.TEST`, corre `resolveIdentity`, y confirma que `JSON.stringify(result)` no contiene ni el nombre, ni el dominio, ni el numero de telefono provisto (IDR22). Los warnings son codigos fijos (`email_ambiguous`, `email_invalid_input`, `prestashop_evidence_unavailable`, etc.), nunca interpolan el input.

## 12. Semantica de fallas

| Caso | Semantica |
|---|---|
| DB (`customer_external_identity`) no disponible | `temporarily_unavailable` (sin cambio, comportamiento previo) |
| `ps_customer`/`ps_orders` no existen en el entorno | tratado como "sin evidencia" (`tableAvailable: false`), no como fallo tecnico - la ausencia de la tabla espejo no es una caida real |
| Query real contra `ps_customer`/`ps_orders` falla (tabla existe, error de ejecucion) | `SYSTEM_FAILURE` -> `temporarily_unavailable` si no hay master ya resuelto; solo warning si ya habia un master resuelto |
| Email con sintaxis invalida | `INVALID_INPUT` en `detail`, nunca se consulta la DB con ese valor, status externo sin cambio |
| Orden inexistente | `NOT_FOUND`, no fabrica candidate |
| Multiples matches inesperados (email/orden/bridge) | `AMBIGUOUS`/`IDENTITY_CONFLICT` segun si es la misma fuente o fuentes cruzadas, nunca autoseleccion |

## 13. Reutilizacion vs. CustomerIdentityResolutionService/Customer Service (Parte 12/13)

Un unico entry point (`createCustomerIdentityResolutionService`) sigue siendo el resolver canonico - no se creo `NewIdentityEngineV2`. `resolveIdentity` no llama a Customer Service (`resolve_customer` HTTP) en ningun punto nuevo - esa llamada sigue viviendo, sin cambios, en `resolveNativeCustomerSession.ts` como fallback cuando el onboarding esta activo. La evidencia local (wa/phone/email/orden/PrestaShop) siempre corre primero y en el mismo proceso, sin fan-out de red adicional por turno.

## 14. Onboarding / trusted session / niveles de identidad (Parte 14-16)

No se toco `CustomerOnboardingService` ni `crm_customer_onboarding_state`. No se conecto `detail` a `resolveNativeCustomerSession`/`trustedCustomerSession` todavia (explicitamente fuera de alcance, "NO conectar CommercialWork R2" y "NO tocar Customer Profile") - el unico caller real sigue pasando solo `{channel, externalId, phoneNumber}` y sigue recibiendo exactamente el mismo `status`/`customerId`/`matchedBy`/`confidence`/`conflicts`/`warnings` de siempre; `detail` queda disponible pero no leido por nadie en produccion todavia. El vocabulario es compatible con los niveles conceptuales `LEVEL_0`-`LEVEL_4` del audit A01: `CANDIDATE`/`NOT_FOUND` no implican `LEVEL_3`; `RESOLVED` via bridge PrestaShop si es compatible con `LEVEL_3_PRESTASHOP_LINKED`; ningun path de este resolver produce `LEVEL_4` (eso exige el ownership validator de A04).

## 15. Tests

`tests/domains/customerIdentity.test.ts`: 43 tests (17 preexistentes sin tocar sus aserciones + 4 estaticos ampliados/nuevos + 22 nuevos IDR/unit de `evidence.ts`), 43/43 verdes contra DB real (`main_management`, dev). Cobertura: IDR03-IDR12, IDR16-IDR18, IDR23-IDR24 explicitos; IDR01/IDR02/IDR14/IDR15 cubiertos por los tests preexistentes (referenciados, no duplicados); IDR13/IDR19/IDR20/IDR21/IDR22 como tests estaticos/estructurales nuevos. IDR03 e IDR10 tienen ademas variante de integracion contra datos reales de `ps_customer`/`ps_orders` (fixture sembrado: `camila.rojas@example.test` -> `id_customer 1`, orden `REF-1001`/`INV-1001` -> `id_customer 1`).

No se escribieron IDR06/IDR07/IDR08/IDR09/IDR11 como pruebas de integracion DB-backed porque requeririan sembrar filas `customer_external_identity` con `provider = "prestashop"`, que ningun writer real crea hoy (Parte 8) - se cubrieron con el fake port, que es donde vive la logica de combinacion real (`evidence.ts`), separada limpiamente de la SQL (`prestashop-mirror/repository.ts`, cubierta por su propio test de integracion).

## 16. Regresion (Parte 20)

Ejecutado contra el dev DB real (`main_management`), comparado contra baseline limpio (`git stash`) cuando aparecio una falla:

- `npx tsc --noEmit`: limpio.
- `npm run lint` (ambito de los archivos tocados): limpio.
- `npm run build`: limpio (ver nota de verificacion abajo).
- `tests/domains/customerIdentity.test.ts`: 43/43.
- `tests/domains/customerOnboarding.test.ts`, `customerService.test.ts`, `tests/integrations/customerServiceHttpAdapter.test.ts`, `tests/commercial/customerSession*.test.ts`, `customerOnboardingPostPlan*.test.ts`, `extractCustomerOnboardingFields.test.ts`: 209/213 - las 4 fallas eran variables de entorno faltantes en la invocacion directa (`DATABASE_NAME`), no una regresion; confirmado re-ejecutando esos 3 archivos con el entorno completo (`.env` cargado): 88/88 verde.
- `customerIdentityCapabilityGateway.test.ts`, `customerIdentityAuditEvents.test.ts`, `identityCapabilityGatewaySummaries.test.ts`, `createCustomerCapability.test.ts`, `linkExternalIdentityCapability.test.ts`, `customerMasterProjectionGate.test.ts`, `identity-conflict.test.ts`, `nativeInboundIdentityBoundary.test.ts`, `resolveMasterCustomerIdentity.test.ts`: verdes.
- `runNativeAutonomousCycleCustomer360.test.ts` + `customer360AutonomousBoundary.test.ts`: 6 fallas, **identicas en cantidad y nombre contra `develop` limpio** (`git stash` + re-run: mismos 6 tests fallan, mismo mensaje) - `PREEXISTING_FAILURE`, no relacionado a Customer 360 (fuera de alcance de esta tarea).
- `tests/e2e/customerIdentityOnboarding.e2e.test.ts`: 2/14 verdes, **identico contra `develop` limpio** (mismo 12/14 fallando, mismos nombres, mismo primer assert `state` null) - `PREEXISTING_FAILURE` de entorno (no es solo el T08-A6/T08-A7 documentado en `docs/ACTIVE_RELEASE.md`; en este entorno el gap es mas amplio, pero confirmado no causado por este cambio).
- `tests/domains/customerOnboarding.test.ts`, subtest "integration 11" (checksum de migracion `001_hub_audit_log.sql`): `PREEXISTING_FAILURE`, identico contra `develop` limpio - drift de checksum ya documentado en otras migraciones por sesiones previas (`docs/ACTIVE_RELEASE.md`).

Cero fallas nuevas atribuibles a este cambio en toda la regresion dirigida.

## 17. Deudas explicitas (no cerradas en A02, por diseno)

- Persistencia durable de evidence (tabla nueva o extension de `commercial_event`) - PARTE 3 la exige solo en memoria; queda para el slice siguiente.
- Correction/supersede history de email/nombre/orden.
- Persistencia de identity level (`LEVEL_0`-`LEVEL_4`) - el vocabulario es compatible, nada lo calcula/persiste todavia.
- Extraer la validacion minima de ownership de orden (Parte 9, Path A/B - ya implementada y probada) a un boundary/servicio reusable y formal, en vez de vivir inline dentro del resolver de identidad; y otorgar `LEVEL_4_VERIFIED_FOR_SENSITIVE_ACTION`/autoridad sobre postventa a partir de ella, lo que exige una policy formal que hoy no existe (ID-R2-A04).
- Bridge writer PrestaShop (`customer_external_identity` con `provider = "prestashop"`) - sin el, Path B de la Parte 9 nunca se ejercita con datos reales en este entorno, solo con el fake port (ID-R2-A07).
- `detail`/evidence no esta conectado a `resolveNativeCustomerSession`/`trustedCustomerSession`/CommercialWork R2 todavia - explicitamente fuera de alcance.
- Omnicanalidad (`channel: "whatsapp"` sigue hardcodeado en el input) - sin cambios, ID-R2-A08 en el roadmap del audit.
- Merge de masters, creacion de cuenta PrestaShop: no tocados, como exige el enunciado.

## 18. Siguiente slice

Dos caminos validos, no excluyentes, ambos ya identificados por el audit A01 como siguientes pasos naturales:

1. **Durable evidence persistence + corrections** (`ID-R2-A02` original del audit / continuacion): agregar la tabla/extension de `commercial_event` que grabe cada `IdentityEvidence` real emitido por este resolver, mas historial de correccion de campos.
2. **Order Ownership Verification** (`ID-R2-A04` del audit): construir el validador que confirme titularidad real de una orden, habilitando `LEVEL_4_VERIFIED_FOR_SENSITIVE_ACTION` para "estado de mi pedido"/reclamos.

No se debe iniciar ninguno de los dos, ni conectar este resolver a CommercialWork R2, hasta que el usuario abra explicitamente el siguiente slice.
