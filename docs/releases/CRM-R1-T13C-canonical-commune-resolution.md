---
title: CRM-R1-T13C — Canonical Commune Resolution from pc_pos.comuna
doc_id: release-crm-r1-t13c-canonical-commune-resolution
status: implemented_not_wired
owner: architecture
last_reviewed: 2026-08-10
source_of_truth_for:
  - CommuneResolver domain contract
  - pc_pos ownership and read-only access policy
depends_on:
  - ../audits/CRM-R1-T13B-shipping-destination-commune-resolution-audit.md
  - ../PRODUCT_NORTH_STAR.md
tags:
  - release
  - shipping
  - commune
  - pc_pos
---

# CRM-R1-T13C — Canonical Commune Resolution from `pc_pos.comuna`

Implementa un resolver de comuna canónico, puro y determinístico, que traduce texto (del cliente o extraído por el agente) hacia un `pc_pos.comuna.id_comuna` real. No implementa cotización de despacho, cobertura de carriers, migración de direcciones ni persistencia de shipping destination en el request — eso queda para tareas posteriores (ver "Siguiente tarea" en `docs/audits/CRM-R1-T13B-shipping-destination-commune-resolution-audit.md`).

## Ownership y autoridad (obligatorio dejar explícito)

```text
main_management.master_customer / customer_addresses
  -> autoridad del CLIENTE y sus direcciones (CRM domain)

pesas_productiva.ps_address
  -> fuente legacy/transitional de direcciones historicas del cliente,
     nunca la fuente de verdad futura

pc_pos.comuna
  -> CANONICAL_LOGISTICS_COMMUNE_CATALOG
  -> el CRM NO es dueño de este catalogo: solo lo lee, read-only,
     nunca lo copia, nunca crea una segunda tabla de comunas propia

pc_pos.comuna.id_comuna
  -> identidad logistica canonica (la unica que este resolver produce)

pc_pos.carrier_comunas.carrier_code
  -> especifico de cada carrier (Starken/Blue Express/Pesas Chile),
     NUNCA identidad global de comuna - T13C no lo consume todavia
```

`pc_pos.city` (56 filas) representa semánticamente **provincia**, no ciudad — confirmado contra los datos reales (`Elqui`, `Limarí`, `Choapa`, `Petorca`, `Santiago`, `Chacabuco`). El nombre de la columna/tabla es incorrecto respecto de lo que contiene; esta tarea no modifica el schema de `pc_pos` para corregirlo (fuera de alcance, es catálogo ajeno, read-only) — se documenta aquí para que nadie vuelva a asumir que `city` es una ciudad.

## Contrato

```ts
interface CommuneResolver {
  resolve(input: string): Promise<CommuneResolution>;
}

type CommuneResolution =
  | { status: "resolved"; communeId: number; canonicalName: string; matchedVia: "direct" | "alias" }
  | { status: "needs_clarification"; input: string; reason: "city_or_conurbation_ambiguous" | "region_level_not_commune" | "ambiguous_catalog_match" }
  | { status: "not_found"; input: string }
  | { status: "invalid_input"; input: string; reason: "empty" }
  | { status: "error"; input: string; reason: "unavailable" | "timeout" | "malformed_response" | "configuration_unavailable"; detail: string };
```

Un error técnico nunca se convierte en `not_found` — es un status `"error"` distinto, tipado, con `reason`/`detail` (sanitizado, sin credenciales). `communeId` proviene siempre de `CommuneCatalogPort` (nunca hardcodeado en `resolveCommune`/`createCommuneResolver`) — verificado por test (`tests/domains/communeResolution.test.ts`, "communeId always comes from the catalog port").

## Política de normalización

Determinística únicamente, sin fuzzy matching (`lib/domains/commune-resolution/normalize.ts`):

- `normalizeCommuneText`: trim, NFC, colapsa variantes de guion a espacio, colapsa espacios — preserva mayúsculas/tildes (es el valor que se muestra, nunca ASCII-forzado).
- `comparisonKey`: además, minúsculas + NFD + strip de marcas diacríticas combinantes (mismo rango `̀-ͯ` que ya usa `lib/domains/customer-addresses/repository.ts#buildNormalizedAddressHash`) — solo para comparar, nunca para mostrar.

`canonicalName` en un resultado `resolved` siempre viene de `pc_pos.comuna.comuna_name` tal cual está almacenado (con tildes), nunca de una transformación del input del cliente.

## Aliases aprobados (evidencia real, T13B)

| Alias (texto del cliente) | Canonical lookup text | `id_comuna` real |
|---|---|---:|
| `LLAY-LLAY` | `Llaillay` | 55 |
| `MARCHIHUE` | `Marchigüe` | 164 |
| `SAN VICENTE` | `San Vicente de Tagua Tagua` | 151 |

`lib/domains/commune-resolution/aliases.ts` mapea texto → texto (nunca texto → id): la resolución final del id siempre pasa por `CommuneCatalogPort`, así `pc_pos` sigue siendo la única autoridad del id. No se agregó ningún alias sin evidencia — no extender esta lista sin el mismo nivel de evidencia.

## Bloqueo explícito de auto-resolución (nunca silencioso)

`lib/domains/commune-resolution/knownAmbiguous.ts` — verificado como **override duro**, evaluado antes que cualquier consulta al catálogo (test: "known-ambiguous terms never even query the catalog"), no como último recurso:

- `"Santiago"` → `needs_clarification` (`city_or_conurbation_ambiguous`). Evidencia T13B: direcciones legacy reales con `city = "Santiago"` correspondían a Lo Barnechea, Melipilla, Isla de Maipo, San Miguel y otras — nunca una comuna única. Verificado por test que **aunque el catálogo contenga una entrada literal "Santiago"**, el resolver nunca la usa.
- `"Arica y Parinacota"` → `needs_clarification` (`region_level_not_commune`). Es una región (una de las 16 regiones reales de Chile, `pc_pos.region`), no una comuna — nunca se traduce a "Arica".

Esta es una lista curada y acotada a evidencia real, **no** un detector genérico de "cualquier nombre de región/ciudad" — extenderla requeriría el mismo tipo de evidencia (T13C sección 13, sin fuzzy matching ni generalización especulativa).

## Fuzzy matching

No implementado, deliberadamente. La resolución determinística (match exacto normalizado + los tres aliases explícitos) ya cubre ≈99,89% de la población histórica auditada en T13B. Cualquier extensión a fuzzy matching queda para una decisión de producto futura, con su propio threshold justificado por evidencia — no una decisión de esta tarea.

## Frontera de dominio

```text
lib/domains/commune-resolution/     -- puro: tipos, ports, normalización,
                                        aliases, bloqueo, algoritmo de
                                        resolución. Cero import de mysql2,
                                        pc_pos o credenciales.
lib/integrations/logistics/          -- adapter read-only. La unica
                                        implementacion real de
                                        CommuneCatalogPort. Unico lugar del
                                        repo que sabe que pc_pos existe.
```

`lib/domains/commune-resolution/ports.ts` define `CommuneCatalogPort` — el dominio depende de esa interfaz, nunca de SQL. Mismo patrón ya establecido por `lib/domains/customer-service/ports.ts` (`CustomerServicePort`), reutilizado aquí sin inventar una convención nueva.

## Acceso a `pc_pos`

- **Configuración**: `LOGISTICS_DB_ENABLED`/`LOGISTICS_DB_HOST`/`LOGISTICS_DB_PORT`/`LOGISTICS_DB_USER`/`LOGISTICS_DB_PASSWORD`/`LOGISTICS_DB_NAME` (`.env.example`). Namespace completamente independiente de `DATABASE_*`/`DB_*` — **nunca** hereda el host/usuario/password de la conexión principal del CRM, ni siquiera como fallback implícito (verificado por test: variables `DATABASE_*`/`DB_*` presentes en el entorno no afectan la config de logística). No se reusó `lib/database-config.ts#resolveDatabaseConnectionFromEnv` porque esa función fue diseñada específicamente para los 4 targets de UNA sola instancia MariaDB local (app/migration/test/legacy) con aliasing deliberado a `DB_*` — `pc_pos` es un sistema externo genuino, mismo patrón de configuración que `lib/integrations/customer-profile` (namespace propio, sin aliasing).
- **Read-only a nivel de aplicación**: `lib/integrations/logistics/pc-pos-adapter.ts` ejecuta exactamente una sentencia SQL fija (`SELECT id_comuna, comuna_name FROM comuna`, sin parámetros, sin interpolación) — no existe en el módulo ningún método ni código camino que emita `INSERT`/`UPDATE`/`DELETE`/DDL. `lib/integrations/logistics/queryExecutor.ts` expone deliberadamente una única operación (`queryRows`), sin superficie de escritura que un caller futuro pudiera invocar por error.
- **Read-only a nivel de base de datos**: no garantizado por esta tarea — requiere que el usuario configurado en `LOGISTICS_DB_USER` tenga un grant `SELECT`-only real (mismo patrón que la credencial de auditoría `pc_consultor` usada en T13B, `GRANT SELECT ON *.*`). Provisionar ese usuario es una acción de infraestructura/DBA fuera de este repositorio — queda como decisión abierta, no resuelta aquí.
- **Credenciales**: ninguna credencial real fue escrita en este repositorio. `.env.example` solo tiene placeholders vacíos, consistente con el resto del archivo.
- **Sin conexión en import**: `getLogisticsQueryExecutor()`/el pool de `mysql2` solo se instancian dentro de la primera llamada real a `CommuneCatalogPort.findByNormalizedName` — verificado leyendo `lib/integrations/logistics/pool.ts` (el pool es un singleton `let pool: Pool | null = null`, nunca inicializado a nivel de módulo).
- **Caché**: `pc_pos.comuna` (346 filas, referencia casi estática) se cachea en memoria de proceso con TTL de 5 minutos (`lib/integrations/logistics/pc-pos-adapter.ts`) para no re-consultar la tabla completa en cada resolución — marcado explícitamente `ponytail:` como una simplificación deliberada (caché de un solo proceso, sin invalidación entre instancias), suficiente para datos de referencia que prácticamente nunca cambian.

## Qué NO hace esta tarea (confirmado, verificado por scope check)

- No crea tablas nuevas en `main_management` ni en ningún otro schema.
- No ejecuta DDL ni DML contra `pc_pos` (solo el `SELECT` fijo ya descrito).
- No migra `ps_address` ni pobla `customer_addresses`.
- No implementa cotización de despacho, cobertura de carriers ni `carrier_comunas` en runtime.
- No implementa fuzzy matching general.
- No persiste `shipping_destination`/`delivery_commune` en `crm_request_facts` ni en ninguna otra tabla — `delivery_address_id` (migración 017/018) sigue siendo un concepto distinto (dirección guardada seleccionada) de una comuna logística resuelta antes de conocer una dirección completa; sobrecargarlo habría sido incorrecto (T13C sección 17).
- No conecta el resolver al Agent Tool Loop, al Capability Gateway ni a ningún `request-definitions`/`capabilities/registry.ts` — queda ensamblado y listo (`lib/integrations/logistics/index.ts#createPcPosCommuneResolver`), sin ningún caller productivo todavía.

## Evidencia de cierre

- `npx tsc --noEmit`: limpio.
- `npm run lint`: 0 errores (34 warnings preexistentes en archivos no tocados por esta tarea).
- `npm test`: 33 tests nuevos (`tests/domains/communeResolution.test.ts`, `tests/integrations/pcPosCommuneCatalog.test.ts`), todos en verde. Suite completa: 2730 tests, 2698 pass / 32 fail — el mismo cluster de fallos preexistentes confirmado idéntico contra `develop@b9d0324` limpio vía `git stash` (outbox worker/pilot-isolation, e2e de onboarding `T08-A6`/`T08-A7`, concurrencia de `sales-agent-configuration` — ninguno toca `lib/domains/commune-resolution` ni `lib/integrations/logistics`).
- `npm run build`: limpio.
- Esquema real de `pc_pos.comuna`/`pc_pos.city`/`pc_pos.region` y los seis `id_comuna` de aceptación (99/105/86/55/164/151) verificados directamente contra producción (misma credencial read-only de auditoría de T13B) antes de implementar, para no construir contra un schema asumido.

## Siguiente tarea

Sin decidir aquí. Candidatas naturales, en orden de dependencia: (1) wiring del resolver a una capability del Gateway (`resolve_commune` o similar) siguiendo el patrón ya establecido (`explore_catalog`/`recommend_catalog_products`); (2) diseño de persistencia de `shipping destination` per-request (extensión de `crm_request_facts` o una estructura nueva acotada, nunca sobrecargando `delivery_address_id`); (3) `carrier_comunas`/cobertura de carrier, solo después de que exista una destination confirmada. Ninguna de las tres se decide en este documento.
