# SALES-AGENT-R2-A11.2 - Catalog Service Integration Audit for CommercialWork

Estado: auditoria completa, sin cambios funcionales. Instrumentacion usada: ninguna
persistida (solo smoke tests read-only contra una instancia local del Catalog Service,
apagada al terminar). No se toco codigo de produccion en ningun repo.

Repos auditados:
- `CRM-Customer-360` (este repo, rama `develop`, HEAD `0aaccd8`)
- `MS-pesaschile-catalog-service`, local en `C:\Users\Goli\Pesas Chile\MS\MS-Stock\services`
  (remote `github.com/mistergoliat/MS-pesaschile-catalog-service`, HEAD `ce4beba`)

Nota de higiene: existe un segundo directorio local, `C:\Users\Goli\Pesas Chile\MS\MS-Stock\catalog-service-mvp`,
que **no es un repo git** (sin `.git`), sin remote, con `package.json name: "catalog-service-mvp"`
y arquitectura plana (no hexagonal). Es un prototipo abandonado anterior a `services`. La
memoria previa de esta sesion (`ref-catalog-service-mvp-repo`) apuntaba a ese path por error;
ya fue corregida. Todo este audit usa exclusivamente `services`.

---

## Resumen ejecutivo (para quien no lea las 20 partes)

El bug reportado ("discos olimpicos de 20kg" -> 0 resultados) **no es un problema de
normalizacion de unidades, plural/singular, ni de que falte un endpoint "mejor"**. Es un bug
puntual y aislado en el fallback de tokens SQL del Catalog Service: la palabra de relleno
**"de"** se trata como token obligatorio de coincidencia literal (`LIKE '%de%'`), y casi ningun
nombre de producto contiene la subcadena "de". Verificado empiricamente en vivo (Parte 17):

```
"discos olimpicos de 20kg"  -> 0 resultados
"disco olimpico de 20kg"    -> 0 resultados   (mismo problema, sin plural)
"discos olimpicos 20kg"     -> 3 resultados   (misma frase, sin "de")
"disco olimpico 20 kg"      -> 3 resultados   (singular, con espacio)
```

El segundo hallazgo, mas importante para la arquitectura: **ya existe en el Catalog Service
una capability disenada exactamente para este problema -T12 Product Intent Resolution,
`POST /api/v2/catalog/resolve-product-intent`- y CommercialWork nunca la llama.** El
`CatalogPort` de este repo (`lib/catalog/types.ts`) solo expone 4 operaciones: `searchProducts`
(-> `/v1/products/search`, el endpoint legacy simple), `getProductDetails`, `batchGetProducts`
y `exploreCatalog`. T12 no esta en ese contrato. Verificado en vivo: T12 tambien devuelve
`no_match` para la frase literal del cliente -porque internamente llama al mismo
`CatalogApplicationService.searchProducts` legacy (`catalogProductIntentProvider.ts:100`)-,
pero para la frase sin "de" devuelve `clarification_required` con 3 candidatos reales,
precio, stock y un motivo de clarificacion estructurado (`dimension: "weight"`, opciones
"15 kg" / "20 kg"). Es decir: **arreglar solo el bug de "de" no basta para tener el
comportamiento que pide la tarea (C02-C10); conectar T12 sin arreglar el bug tampoco basta**,
porque T12 hereda la misma falla de retrieval.

Veredicto: **CATALOG_INTEGRATION_PARTIAL**.

---

## Parte 1 - Inventario del Catalog Service

Todas las rutas HTTP reales, leidas de `src/interfaces/http/app.ts` (rutas `/v1/*`, registradas
inline) y de los tres archivos `src/interfaces/http/routes/*Route.ts` (rutas `/api/v2/*`).

### 1.1 `GET /v1/products/search` (legacy)

- Handler: `app.ts:193-225` -> `CatalogApplicationService.searchProducts` (`catalogService.ts:97`)
  -> `MySqlSearchProvider.search` (`infrastructure/search/mysqlSearchProvider.ts:17`)
  -> `MySqlCatalogRepository.getSearchCandidates` (`infrastructure/repositories/mysqlCatalogRepository.ts:276`)
- Input: `q` (string, 2-120 chars), `limit` (1-10, default 5), `includeOutOfStock` (bool, default false)
- Output: `{ query, items: SearchItem[], freshness }`. Cada item: `productId`, `combinationId`,
  `sku`, `name`, `variantLabel`, `shortDescription`, `physicalQuantity`, `available`, `matchType`
  (`exact_sku | exact_name | partial_name | description`).
- Side effect: ninguno (lectura). Cachea por `searchCacheKey` (TTL `SEARCH_CACHE_TTL_SECONDS`, 300s local).
- Determinismo: si, dado el mismo estado de catalogo (ranking puramente por reglas, sin LLM/embeddings).
- Idempotencia: si (GET puro).
- 0 resultados: `items: []`, HTTP 200 (no es error).
- N resultados: ordenados por `compareCatalogSearchRankEntries` (`searchTextRelevance.ts:142`) -
  prioridad `exact_sku > exact_name > partial_name > description`, luego coincidencia de frase
  exacta, cobertura de tokens en el nombre, orden de tokens, cobertura en descripcion,
  variante default, nombre alfabetico, productId/combinationId como tie-break final.
- Retorna: `productId`, `combinationId` si (0 = "sin variante", ver Parte 3.9), `name`, `sku`
  (como "referencia"), NO categoria, NO precio, NO score numerico (solo `matchType`
  categorico), stock (`physicalQuantity`/`available`). **No es evidencia suficiente para
  selection por si sola** - no trae precio ni confirma que el producto siga activo mas alla
  del filtro `p.active = 1` en la query.
- Errores: ninguno propio mas alla de 400 (input invalido) y 401. Nunca 404.

### 1.2 `GET /v1/products/:productId` (legacy, "get details")

- Handler: `app.ts:227-280` -> `CatalogApplicationService.getProduct` (`catalogService.ts:132`)
- Input: `productId` (path), `combinationId`, `quantity`, `customerId`, `customerGroupId`,
  `currencyId`, `countryId` (querystring, todos opcionales con defaults de config)
- Output: producto completo - `variants[]`, `selectedVariant`, `price` (con `taxRate`,
  `discountApplied`), `availability`, `stockQuantity`, `weightKg`, `publicLink`.
- 0 resultados: `404 PRODUCT_NOT_FOUND` (a diferencia de search, aqui SI es un error HTTP).
- Combinacion invalida: `404 COMBINATION_NOT_FOUND` (`combinationId` no pertenece al producto).
- Esta es la unica fuente real de precio y de disponibilidad confirmada por producto - `search`
  y `explore` deliberadamente no la reemplazan (confirmado leyendo el codigo, no solo el nombre).

### 1.3 `POST /v1/products/batch` (legacy, hidratacion masiva)

- Handler: `app.ts:282-327` -> `CatalogApplicationService.batchGetProducts`
- Input: `items[]` (max 20), cada uno `{ productId, combinationId?, quantity? }`
- Output: `items[]` con resultado por item (`ok: true/false` individual - fallo parcial no
  tumba el batch completo).
- Uso real en CRM: exclusivamente interno (hidratacion post-search), nunca expuesto al LLM
  como tool (confirmado: `lib/catalog/types.ts:246` lo documenta explicitamente; no aparece
  en `AGENT_LOOP_TOOL_POOL`).

### 1.4 `POST /v1/products/explore` ("Explore Catalog")

- Handler: `exploreProductsRoute.ts:130` -> `ExploreProductsService`
  (`application/catalog/explore-products/defaultExploreProductsService.ts`)
- **No es busqueda semantica ni textual libre.** Es un browse estructurado: filtros
  (`categoryId`/`categorySlug`/`productType`/`price`/`availability`/`query` como filtro de
  texto adicional, no como intent primario) + `sort` obligatorio (`price|stock|name`,
  `asc|desc`) + `limit` (1-10). Piensa "dame los 3 mas baratos de la categoria mancuernas",
  no "encuentra el producto que el cliente describio".
- Output: `{ scope, sort, totalMatched, exhaustiveForScope, classificationSource?, products[] }`.
  `exhaustiveForScope=true` significa que `products` cubre TODO el scope filtrado (no solo un
  top-N truncado) - importante porque le permite al agente decir "es el mas barato" con certeza.
- 0 resultados: `products: []`, `totalMatched: 0`, HTTP 200.
- Categoria inexistente: `404 category_not_found`.
- Errores propios (confirmado por `httpCatalogAdapter.ts:165-176`, vocabulario `lower_snake`
  distinto al resto de endpoints, no documentado formalmente): `invalid_limit`, `invalid_sort`,
  `invalid_request`, `catalog_source_unavailable`.

### 1.5 `POST /api/v2/catalog/resolve-product-intent` (T12, "Product Intent Resolution")

Doc fuente: `docs/recommendation/product-intent-resolution.md`. Esta es la pieza central del
audit - ver Parte 1.5.1 mas abajo por su relevancia directa al bug reportado.

- Handler: `resolveProductIntentRoute.ts` -> `ProductIntentResolutionService`, retrieval real
  via `CatalogProductIntentProvider.search()` (`infrastructure/catalog/catalogProductIntentProvider.ts:91-120`)
- Input: `query` (texto libre), `filters.inStockOnly?`, `limit` (default 5, pool interno
  `max(limit*4, 20)` capado a 50)
- Proposito explicito (de la doc): `customer phrase -> resolved sourceProduct | clarification_required | no_match`.
  Es exactamente "resolver una frase de cliente en un productId o pedir precision" - el
  problema que CommercialWork tiene hoy resuelto a mano y peor en `applyObjectiveState`.
- Normalizacion: lowercase, sin acentos, tokeniza, normaliza unidades (`20kg`/`20 kilos` ->
  `20 kg`, **con espacio**, al contrario de `normalizeCatalogSearchText` del legacy que las
  junta sin espacio - ver Parte 1.5.1).
- Sinonimos reales (`StaticProductSearchSynonymProvider`): `pesas rusas -> kettlebell`,
  `discos de goma -> discos bumper/rubber`, `barra para sentadilla -> barra olimpica`,
  `collarines -> cierres barra/seguros barra`, etc. **El Catalog Service ya tiene un
  diccionario de sinonimos de dominio que CRM no usa en absoluto.**
- Ranking: score 0-1, con calibracion de constraints explicitos (peso, diametro, largo,
  tipo de producto, referencia, marca, variante) que puede **contradecir** una coincidencia
  lexica (ej: query "15 kg" contra candidato "20 kg" -> `contradicted`, penalizado fuerte,
  nunca gana aunque el nombre calce). Esto es exactamente el tipo de logica que la tarea
  prohibe duplicar en Customer 360 (Parte 5/12) y que hoy no existe ahi.
- Politica de resolucion: `resolved` (score>=0.82 y gap top1-top2>=0.12, o exactamente un
  candidato plausible que satisface todos los constraints explicitos), `clarification_required`
  (score>=0.45 pero resolucion automatica no segura, o 2+ candidatos satisfacen los mismos
  constraints), `no_match` (sin candidatos elegibles o score<0.45, o todos contradicen un
  constraint explicito).
- Clarificacion **estructurada**, no texto libre: `dimension` (`product_type|weight|diameter|
  length|category|brand|variant|unspecified`) + `options[]` agrupadas. No repite una dimension
  que el cliente ya especifico.
- Precio/stock: nunca inventados; ausentes -> `null` + warning global deduplicado.
- Determinismo: si (ranking puramente por reglas). Idempotencia: si (GET conceptual expuesto
  como POST por el tamano del payload).
- HTTP: siempre 200 para resultados de negocio (`resolved`/`clarification_required`/`no_match`).
  400 = input invalido. 422 = output de catalogo/provider invalido. 503 = fallo real de busqueda/enriquecimiento.
- **No ejecuta T11.3 (recommend), no genera productos, no usa LLM/embeddings en V1.**

#### 1.5.1 El detalle que mas importa: T12 reusa el retrieval legacy, no lo reemplaza

`catalogProductIntentProvider.ts:91-120` (`CatalogProductIntentProvider.search`) construye una
lista de terminos (`searchTerms()`, linea 69-83: el query normalizado + sinonimos + variantes
con unidades "compactadas") y por cada termino llama:

```ts
const result = await this.catalogService.searchProducts(term, input.limit, input.includeOutOfStock);
```

Es decir: **T12 no tiene su propio acceso a SQL para retrieval.** Delega en el mismo
`CatalogApplicationService.searchProducts` que respalda el endpoint legacy `/v1/products/search`
(Parte 1.1), el mismo que tiene el bug de tokens con "de" (Parte 3). T12 aporta sinonimos,
normalizacion de unidades, ranking con constraints y clarificacion estructurada **por encima**
de lo que ese retrieval le devuelva - pero si el retrieval devuelve 0 candidatos, T12 no tiene
nada que rankear y correctamente reporta `no_match`. Confirmado en vivo (Parte 17, query 8):
T12 con la frase literal del cliente ("discos olimpicos de 20kg") tambien da `no_match`.

**Consecuencia arquitectonica directa**: apuntar CommercialWork a T12 en vez de al endpoint
legacy es necesario pero no suficiente. El fix del bug de tokens (Parte 3) beneficia a AMBOS
endpoints simultaneamente porque comparten la misma capa de retrieval - es la correccion de
mayor apalancamiento de todo este audit.

### 1.6 `POST /api/v2/recommendations/search-products` (T11, "SearchProducts V2")

Doc fuente: `docs/contracts/search-products-v2.md` + `docs/recommendation/
commercial-product-recommendation-service.md`. **Este es el endpoint que el nombre de la
tarea original ("SearchProducts V2, normalizeCatalogSearchText, tokenized SQL fallback...")
supone que hace busqueda textual mejorada. No es asi - esa es una lectura incorrecta del
nombre.** T11 es un motor de **recomendaciones basado en relaciones de producto** ("clientes
que compraron X tambien compraron Y" / cross-sell), no un buscador de texto libre:

- Requiere `sourceProduct.productId` YA CONOCIDO (`RecommendCatalogProductsGatewayInput.
  sourceProduct`, `catalogRecommendationGatewayAdapter.ts:39` - `required: ["sourceProduct"]`).
  No busca desde texto - la propia descripcion de la capability lo dice literalmente:
  "it does not search from free text (use search_products or explore_catalog for that)".
- Candidatos vienen de `T07.findBySource({ sourceProduct, relationshipTypes })` - snapshot de
  relaciones producto-producto pre-calculado offline, no de una query SQL contra nombres.
- Scoring: 45% confiabilidad de la relacion + 20% confianza + 15% lift normalizado + 10%
  soporte normalizado, mas señales de disponibilidad/compatibilidad/margen/penalizaciones.
  Nada de esto tiene que ver con "match de texto".
- **La normalizacion de tokens, `normalizeCatalogSearchText`, el fallback SQL tokenizado, y el
  `matchType`/score que la tarea atribuye a "SearchProducts V2" viven en realidad en el
  retrieval del endpoint LEGACY (`/v1/products/search`, Parte 1.1/7), no aqui.** Se corrige
  esta premisa en la Parte 7.
- El nombre `search-products-v2` en el contrato historico (`src/domain/recommendation/
  contracts.ts`) es un artefacto de una version anterior del diseno (T01A) que la propia doc
  aclara ya no es el contrato de transporte vigente.

### 1.7 Politica de exclusion de discovery

`docs/catalog-discovery-exclusion-policy.md`: `search_products` y `explore_catalog` excluyen
2 productId conocidos (444 "Servicio vendedor Pesas Chile", 505 "Costo logistico") ANTES de
ranking/limit/totalMatched. Aplicado en `mysqlSearchProvider.ts:31` y (via `NOT IN` SQL) en
`mysqlCatalogRepository.ts:377`. No aplica a `/v1/products/:productId` ni `/v1/products/batch`
(hidratacion directa se permite siempre). No aplica a T12 explicitamente en la doc, pero
como T12 reusa `searchProducts` para retrieval, la exclusion aplica transitivamente ahi tambien.

---

## Parte 2 - Inventario de capabilities en Customer 360 (matriz de coverage)

| Capability | Gateway (`registry.ts`) | Legacy Tool Pool | CommercialWork Step | Quien la ejecuta hoy en R2 |
|---|---|---|---|---|
| `search_products` | Si (`registry.ts:52-96`) | Si | `SEARCH_PRODUCTS` (ejecutable) | `commercialWorkExecutor.ts` via `SEARCH_PRODUCTS` step |
| `get_product_details` | Si (`registry.ts:109-149`) | Si | `GET_PRODUCT_DETAILS` (step existe, **no ejecutable**) | Nadie en R2 - solo el legacy loop y `buildCatalogGroundedMessage.ts` lo llaman directo |
| `batch_get_products` | Si (`registry.ts:178-221`) | No (interno) | No existe como step | Nadie en R2 - hidratacion interna, sin caller real todavia (comentario propio: "internal enrichment capability") |
| `explore_catalog` | Si (`registry.ts:311-387`) | Si | **No existe step type** | Nadie en R2 - solo alcanzable via legacy Agent Tool Loop |
| `recommend_catalog_products` | Si (`catalogRecommendationGatewayAdapter.ts:241`) | Si | `RECOMMEND_PRODUCTS` (step existe, **no ejecutable**) | Nadie en R2 - ademas su objective type (`RECOMMEND_PRODUCTS`/`COMPARE_PRODUCTS`) nunca se produce (ver Parte 2.1) |
| `select_products` | Si | Si | `SELECT_PRODUCTS` (ejecutable) | `commercialWorkExecutor.ts` |
| `set_shipping_destination` | Si | Si | `SET_SHIPPING_DESTINATION` (ejecutable) | `commercialWorkExecutor.ts` |
| `calculate_shipping` | Si | Si | `CALCULATE_SHIPPING` (ejecutable) | `commercialWorkExecutor.ts` |
| `select_shipping_option` | Si | Si | `SELECT_SHIPPING_OPTION` (step existe, **no ejecutable**) | Nadie en R2 (confirmado: `EXECUTABLE_STEP_TYPES` no lo incluye) |
| `create_quote` | Si | Si | `CREATE_QUOTE` (ejecutable) | `commercialWorkExecutor.ts` |
| `search_company_knowledge` | Si | Si | No aplica (no es catalogo) | Legacy loop unicamente |

Fuentes: `lib/brain/commercial/work/stepTypes.ts:1-11` (9 step types),
`lib/brain/commercial/work/commercialWorkExecutor.ts:23`
(`EXECUTABLE_STEP_TYPES = new Set(["SEARCH_PRODUCTS", "SELECT_PRODUCTS",
"SET_SHIPPING_DESTINATION", "CALCULATE_SHIPPING", "CREATE_QUOTE"])` - exactamente 5 de 9),
`lib/brain/commercial/agent-loop/runAgentToolLoop.ts:62-73` (10 tools legacy).

Un step cuyo tipo no esta en `EXECUTABLE_STEP_TYPES` no falla silenciosamente: el executor lo
marca `status: "blocked", errorCode: "unsupported_step_type"` explicitamente
(`commercialWorkExecutor.ts:606-611` y `:686-689`) - trazable, no un bug oculto, pero si una
capacidad estructuralmente inalcanzable por R2 hoy.

### 2.1 Por que `RECOMMEND_PRODUCTS`/`explore_catalog` estan "vivos" en el Gateway pero "muertos" en R2

`deriveCommercialWorkSteps.ts:71-86` SI sabe derivar un step `RECOMMEND_PRODUCTS` para
objectives de tipo `COMPARE_PRODUCTS`/`RECOMMEND_PRODUCTS`. El problema es upstream: **nada
en el planificador produce esos tipos de objective.** `semanticIntentAdapter.ts:24-111`
(`commercialObjectiveSeedsFromResolvedIntent`) solo mapea 4 tipos de intent del LLM:
`select_products`, `get_shipping_quote`, `create_quote`, `cancel`. No existe un intent
`discover_products`, `recommend_products`, `compare_products` ni `explore_catalog` en el
planner (`buildIntentPlannerPromptPackage.ts`/`parseCommercialIntentPlan.ts` no los conocen).
`objectiveSeedsFromPendingIntents` (`deriveCommercialObjectives.ts:80-113`) confirma lo mismo
del lado de intents pendientes multi-turno.

**Todo mensaje relacionado a producto - sea "quiero la barra classic", "2 discos de 20kg",
"quiero una pesa", "busco mancuernas" o "cual me recomiendas" - cae hoy en el mismo unico
intent `select_products`.** No hay diferenciacion de especificidad en el planner. Esto explica
por que C03/C04/C10 (Parte 6) no tienen hoy un comportamiento distinto a C02: todos terminan
en la misma rama `SELECT_PRODUCTS`/`CHANGE_QUANTITY` de `applyObjectiveState`.

`explore_catalog` tiene un problema estructural distinto y mas duro: **ni siquiera existe
`EXPLORE_CATALOG` en `COMMERCIAL_WORK_STEP_TYPES`** (`stepTypes.ts:1-11`). No es solo que
nadie lo derive - el tipo de step no existe. Es alcanzable unicamente por el legacy Agent
Tool Loop.

---

## Parte 3 - Trazado end-to-end real: "necesito 2 discos olimpicos de 20kg"

1. WhatsApp inbound entra a `runNativeAutonomousCycle.ts`, que rutea a R2 vs legacy segun
   `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED`/`_WA_IDS` (chokepoint confirmado en A11, ver Parte 16).
2. `semanticIntentAdapter.ts:planCommercialObjectiveSeeds` arma el prompt
   (`buildIntentPlannerPromptPackage.ts`), llama al LLM, parsea con `parseCommercialIntentPlan.ts`.
   El LLM devuelve `{ type: "select_products", productReference: "discos olimpicos de 20kg",
   quantity: 2 }` (o similar - el nombre exacto puede variar levemente entre corridas, pero el
   `intent.type` siempre es `select_products`; no hay otro intent posible para esta frase).
3. `resolveCommercialIntentPlan` (`requirementResolver.ts:245-278`) resuelve PRODUCT contra
   `RecentCatalogContext` (candidatos YA vistos esta conversacion) - primera vez, no hay
   candidatos -> `status: "missing"`. QUANTITY resuelve `2` (explicito) -> `resolved`.
4. `commercialObjectiveSeedsFromResolvedIntent` (`semanticIntentAdapter.ts:28-70`): como
   PRODUCT no esta `resolved`, cae a la rama de la linea 53-68 - crea un seed
   `SELECT_PRODUCTS` con `inputs: { productReference: "discos olimpicos de 20kg", quantity: 2 }`
   (sin `productEvidenceAvailable: false` porque el status es `missing`, no `ambiguous`).
5. `deriveCommercialObjectives` (`deriveCommercialObjectives.ts:115-179`) produce el
   `CommercialObjective` real, `status: "PENDING"`.
6. `buildCommercialWorkProjection.ts:applyObjectiveState`, rama `SELECT_PRODUCTS`
   (linea 171-268): no hay `requestedItems`, hay `productReference`, quantity es number,
   `productCandidates` vacio -> busca `latestSearchProductsExecution` (linea 218) - primera
   vez, no existe -> `objective.status = "READY"` (linea 219-221, comentario propio explicito:
   "never searched" always becomes READY).
7. `deriveCommercialWorkSteps.ts`, rama `SELECT_PRODUCTS`/`CHANGE_QUANTITY` (linea 87-171):
   `needsSearch = true` (READY, sin items, con productReference) -> deriva
   `SEARCH_PRODUCTS` step (READY, capability `search_products`, `input: objective.inputs`)
   y `SELECT_PRODUCTS` step (BLOCKED, dependencia `STEP_COMPLETED` en el search step).
8. `commercialWorkExecutor.ts` ejecuta el step `SEARCH_PRODUCTS` (esta en
   `EXECUTABLE_STEP_TYPES`) -> `executeGovernedCapability` -> `resolveCapabilityGatewayDefinition("search_products")`
   -> `registry.ts:66-94` (`execute`): `query = input.query` (`objective.inputs.productReference`
   pasa como `query` porque `input: objective.inputs` en el step, y el capability lee
   `input.query` - **el campo se llama `productReference` en `objective.inputs` pero el
   capability schema pide `query`; el mapeo real ocurre en como se construye `objective.inputs`
   para el step: en efecto, `objective.inputs.productReference` termina siendo lo que
   `port.searchProducts` recibe como `query`, confirmado por `latestSearchProductsExecution`
   matcheando `requestSummaryJson.query` contra `objective.inputs.productReference`
   normalizado, `buildCommercialWorkProjection.ts:77-88`**).
9. `port.searchProducts({ query: "discos olimpicos de 20kg", limit: 5 }, ...)` ->
   `httpCatalogAdapter.ts:540-546` -> `GET /v1/products/search?q=discos+olimpicos+de+20kg&limit=5`.
10. Catalog Service: `CatalogApplicationService.searchProducts` -> cache miss ->
    `MySqlSearchProvider.search` -> `catalogSearchQueryVariants("discos olimpicos de 20kg")`
    (`searchTextNormalization.ts:37-41`): la frase ya esta en minusculas, sin acentos, con
    espacios simples, y "20kg" ya viene pegado en el mensaje del cliente -> `normalizeCatalogSearchText`
    es idempotente sobre esta frase -> **un solo variant** (original == canonico).
11. `getSearchCandidates("discos olimpicos de 20kg", ...)` (`mysqlCatalogRepository.ts:276-323`):
    - Fase frase (linea 284-303): `p.reference = ? OR pa.reference = ? OR pl.name = ? OR
      pl.name LIKE '%discos olimpicos de 20kg%' OR pl.description_short LIKE '%...%' OR
      pl.description LIKE '%...%'`. Ningun producto real tiene esa frase completa en nombre o
      descripcion -> 0 candidatos de frase.
    - `shouldUseNameTokenFallback("discos olimpicos de 20kg", ["discos","olimpicos","de","20kg"])`
      (linea 55-62): `hasShortAlphabeticToken` = true (token "de", 2 letras) pero
      `hasCanonicalUnitToken` = true (token "20kg" matchea `/^\d+(?:\.\d+)?(?:kg|...)$/`) ->
      la condicion `!hasShortAlphabeticToken || hasCanonicalUnitToken` es true por el segundo
      termino -> **el fallback de tokens SI se activa** (no se descarta por tener "de").
    - `shouldRunNameTokenFallback`: 0 candidatos de frase -> true -> corre.
    - Fase tokens (linea 311-316): `pl.name LIKE '%discos%' AND pl.name LIKE '%olimpicos%'
      AND pl.name LIKE '%de%' AND pl.name LIKE '%20kg%'`. **Los 4 tokens son obligatorios via
      AND, sin filtrado de stopwords.** El producto real mas cercano se llama
      `"Par Discos Olímpicos Grip Rubber 20kg | PROmachine"` - no contiene la subcadena "de"
      en ninguna parte del nombre -> falla el AND -> 0 filas.
12. `search_products` capability retorna `status: "completed", data: { items: [] }` (0
    resultados NO es un error tecnico, es un resultado valido y vacio - correcto por diseno,
    ver Parte 1.1).
13. Siguiente ronda de proyeccion: `applyObjectiveState` vuelve a la rama `SELECT_PRODUCTS`,
    ahora `latestSearchProductsExecution` SI encuentra la ejecucion (matchea por
    `requestSummaryJson.query` normalizado == `productReference` normalizado,
    `buildCommercialWorkProjection.ts:72-88`), `executionStatus === "completed"`,
    `searchProductsCandidates(...)` (linea 92-105) parsea `responseSummaryJson.items` -> `[]`
    -> `candidates.length === 0` -> linea 239-242: `objective.status = "WAITING_CUSTOMER"`,
    `missingRequirements.push("PRODUCT_NOT_FOUND")`.
14. `buildCommercialWorkFinalizerMessage.ts:219-224` (`buildMissingInfoQuestion`, rama
    `PRODUCT_NOT_FOUND`): construye exactamente
    `` `No encontré "${reference}" en el catálogo. ¿Puedes confirmarme el nombre exacto del producto?` ``
    con `reference = objective.inputs.productReference = "discos olimpicos de 20kg"`.

**Esto reproduce byte-a-byte el mensaje reportado como bug en vivo.** No es una hipotesis -
es la traza completa, confirmada linea por linea, mas la reproduccion empirica en la Parte 17.

### Respuestas directas a las 9 preguntas de la Parte 3

1. Query enviada hoy: la frase literal del `productReference` que devolvio el LLM, sin
   modificacion, como parametro `q` de `GET /v1/products/search`.
2. Endpoint: `/v1/products/search` (legacy). Nunca T12, nunca explore, nunca T11.
3. Normalizacion antes de enviar: ninguna en CRM (`httpCatalogAdapter.ts:541`, `input.query.trim()`
   solamente).
4. Normalizacion dentro del servicio: `normalizeCatalogSearchText` (unidades sin espacio,
   diacriticos fuera, minusculas) + el fallback de tokens AND descrito arriba.
5. Ranking ejecutado: ninguno llega a correr - la query SQL de retrieval ya devuelve 0 filas
   antes de que `evaluateCatalogSearchTextRelevance`/`compareCatalogSearchRankEntries` tengan
   algo que rankear.
6. Fallback existente: el fallback de tokens SI existe y SI se activa, pero falla por el
   token "de" obligatorio sin filtrar.
7. Por que 0 en vivo: el token "de" (preposicion de relleno, no filtrada) es obligatorio como
   subcadena literal del nombre via `LIKE '%de%'`, y el nombre real del producto no la contiene.
8. Se puede encontrar el mismo producto por otro endpoint hoy: **si** - T12
   (`resolve-product-intent`) con la misma frase exacta **tambien falla** (hereda el mismo
   retrieval, Parte 1.5.1), pero con la frase sin "de" ("disco olimpico 20kg") T12 SI lo
   encuentra con `clarification_required` y candidatos reales con precio.
9. Causa raiz clasificada: **no es** query construction generico, no es endpoint incorrecto
   per se (el legacy si intenta), no es indexing/data, no es singular/plural (probado
   irrelevante, Parte 17), no es espaciado de "20kg" (probado irrelevante en aislamiento), no
   es acentos, no es category resolution, no es threshold de ranking (nunca llega a rankear),
   no es variant handling. **Es, especificamente: filtrado de stopwords ausente en el
   fallback de tokens AND del retrieval SQL legacy**, agravado porque **CommercialWork llama
   a ese retrieval en vez del endpoint disenado para lenguaje natural (T12)**, que ademas
   tampoco resolveria el caso sin ese mismo fix.

---

## Parte 4 - Pipeline comercial correcto (evaluacion de las 5 opciones)

Ninguna de las opciones A-D calza exacto con lo que el codigo real puede soportar hoy sin
cambios, porque ninguna capability real de "discovery" existe como step de CommercialWork
(Parte 2.1). La opcion mas fiel a "usar solo capacidades reales existentes" es una variante
de la **opcion A, pero reemplazando el SEARCH_PRODUCTS actual (legacy) por uno respaldado en
T12**, sin agregar EXPLORE_CATALOG ni RECOMMEND_PRODUCTS como pasos obligatorios del flujo
principal - motivo detallado en Partes 8 y 9.

```
PRODUCT_REFERENCE (del planner, sin cambios)
       |
SEARCH_PRODUCTS  <- ejecuta contra T12 (resolve-product-intent), NO contra /v1/products/search
       |
   T12 ya devuelve una de tres:
       |
   resolved -----------------> SELECT_PRODUCTS (auto, 1 candidato claro, con precio/stock ya incluidos)
       |
   clarification_required ----> WAITING_CUSTOMER con opciones estructuradas reales
   (objective.inputs.productCandidates = T12 candidates, no re-implementadas)
       |
   no_match -------------------> WAITING_CUSTOMER (PRODUCT_NOT_FOUND), mensaje actual sin cambios
```

`GET_PRODUCT_DETAILS` explicito como step separado **no hace falta** en el camino feliz: T12
ya devuelve precio, stock, disponibilidad y `publicLink` en cada candidato (via
`CatalogCommercialTruthService`, Parte 1.5), porque T12 fue disenado para eso desde T11.4
("T12 enriches candidate products through the shared CatalogCommercialTruthService"). Hoy
`SELECT_PRODUCTS` no vuelve a pedir detalles - simplemente confia en `matchType`/nombre del
search legacy sin precio (una brecha real y silenciosa: el cliente puede seleccionar un
producto sin que el sistema haya confirmado su precio actual en esa misma conversacion). Con
T12 esa brecha se cierra gratis.

`RECOMMEND_PRODUCTS`/`explore_catalog` no entran al camino principal: no resuelven "encontrar
el producto que el cliente describio", resuelven problemas distintos (cross-sell desde un
producto ya conocido; browse por filtros estructurados). Ver Partes 8 y 9.

---

## Parte 5 - Ownership por capa (validado contra la implementacion real)

| Capa | Responsabilidad real hoy (confirmada en codigo) | Coincide con el ideal de la tarea |
|---|---|---|
| **LLM** (planner) | Extrae `productReference`, `quantity`, intent type. Nunca decide que capability llamar, nunca ve nombres de capability/endpoint (`buildIntentPlannerPromptPackage.ts`). | Si |
| **CommercialWork** | Decide READY/BLOCKED/WAITING_*, deriva steps, maneja dependencias (`STEP_COMPLETED`), persiste evidence, hace retry (`retryable`/`retryCandidate`). | Si, pero interpreta 0/1/N resultados con logica propia (Parte 5.1) en vez de delegar esa interpretacion al catalogo (T12 ya la hace mejor) |
| **Catalog Service** | Normaliza, busca, rankea, hidrata, calcula precio/stock/disponibilidad real. T12 ademas resuelve/clarifica/no-matchea. | Si, pero su retrieval SQL tiene el bug de stopwords (Parte 3) que ninguna capa de arriba puede compensar sin duplicarlo |
| **Capability Gateway** | Governance (`sideEffect`, `authority`, `riskClass`), input schema, `maxRetries`, audit trail (`crm_capability_executions`), mapeo de errores HTTP -> outcome. | Si, sin cambios necesarios |

### 5.1 Una duplicacion real, aunque pequena, que ya existe

`applyObjectiveState` (`buildCommercialWorkProjection.ts:223-242`) reimplementa a mano la
misma decision de 3 vias que T12 ya resuelve con mas informacion:
`0 candidatos -> PRODUCT_NOT_FOUND`, `1 -> auto-select`, `2+ -> PRODUCT_AMBIGUOUS (top 5)`.
Es una logica de ~15 lineas, no un motor de ranking - no es la "duplicacion de busqueda,
ranking o exploracion" que la tarea prohibe explicitamente reconstruir. Pero **si CommercialWork
pasa a consumir T12, esta logica queda redundante**: T12 ya devuelve
`resolved|clarification_required|no_match` con la misma semantica pero mejor calibrada
(constraints explicitos, no solo conteo). El cambio correcto es que `applyObjectiveState` lea
el campo `resolution.status` de T12 en vez de recontar `candidates.length` el mismo con sus
propias reglas.

`requirementResolver.ts:matchProductReference` (linea 123-132) es una excepcion legitima, NO
una violacion: hace fuzzy-substring-match, pero exclusivamente contra `RecentCatalogContext`
- candidatos que YA llegaron de una busqueda real esta misma conversacion (ej. reconciliar
"la classic" contra un search de un turno anterior). No vuelve a tocar el catalogo ni
reimplementa retrieval/ranking - es reconciliacion local de contexto conversacional, un
alcance distinto y mas angosto.

---

## Parte 6 - Casos comerciales: comportamiento hoy vs esperado

Todos los casos abajo asumen que CommercialWork sigue enrutando via el unico intent
`select_products` (Parte 2.1) - eso no cambia por si solo con este audit, requiere decision
de producto (ver Parte 19).

| Caso | Query | Hoy (legacy `/v1/products/search`, verificado en vivo) | Con T12 + fix de stopwords (verificado en vivo) |
|---|---|---|---|
| C01 exacta | "barra classic" | 2 resultados reales (`matchType: partial_name`), auto-selecciona si es 1 tras filtrar, si no `PRODUCT_AMBIGUOUS` con solo nombres | `clarification_required`, `dimension: "weight"`, opciones "15 kg"/"20 kg" con precio - **mejor**: la ambiguedad real (2 pesos distintos) queda explicita, no solo "2 nombres parecidos" |
| C02 descripcion especifica | "2 discos olimpicos de 20kg" | **0 resultados** (bug de "de") -> `PRODUCT_NOT_FOUND` | Sin fix de stopwords: T12 tambien da `no_match` (Parte 1.5.1). Con fix: 3 candidatos reales, `clarification_required` (3 marcas de disco 20kg legitimamente distintas, con precio) |
| C03 amplia | "quiero una pesa" | `productReference: "pesa"` (probable) -> search literal de "pesa", resultado incierto sin sinonimo -> probablemente 0 o pocos, `PRODUCT_NOT_FOUND`/`AMBIGUOUS` generico | T12 no tiene sinonimo para "pesa" generico -> igual de debil. **Este caso necesita EXPLORE_CATALOG real, no busqueda por texto** - ver Parte 9 |
| C04 categoria | "busco mancuernas" | Busqueda literal de "mancuernas", probablemente funciona si el nombre real usa "Mancuernas" | Similar o mejor via T12 (sinonimos ya cubren "pesas rusas") |
| C05 varios matches | "disco 20kg" | 4 resultados reales, `PRODUCT_AMBIGUOUS` con 5 nombres pelados, sin precio | T12: candidatos con precio real, permite al cliente decidir con informacion, no solo nombres |
| C06 0 real | "producto inexistente xyz" | 0 resultados reales, `PRODUCT_NOT_FOUND` correcto | Igual, `no_match` correcto - sin cambio de comportamiento esperado |
| C07 typos | "mancuerna exagonal 10k" | **Encuentra el producto correcto por coincidencia de subcadena accidental** ("exagonal" es subcadena literal de "Hexagonales" desde la 2da letra; "10k" es subcadena de "10kg") - no es tolerancia a typos real, es suerte de substring | T12 igual (mismo retrieval). Un typo que no calce como subcadena (ej. "olinpica" por "olímpica" - la "n" no es subcadena de "olimpica") seguiria fallando en ambos |
| C08 catalogo caido | (fallo de red/5xx) | `mapCatalogErrorToOutcome` -> `temporarily_blocked`/`retryable: true` -> `applyObjectiveState` linea 247-251: `WAITING_SYSTEM`, nunca `WAITING_CUSTOMER` - **correcto hoy, confirmado en codigo** | Sin cambio necesario |
| C09 variantes | producto con combinations | `combinationId` se preserva salvo que sea `"0"` (sentinel de PrestaShop para "sin variante"), normalizado explicitamente en `requirementResolver.ts:104-106` (bug real ya corregido en LLM-R1-T09B) | Sin cambio - T12 usa el mismo campo |
| C10 recomendacion | "cual me recomiendas" | Cae en `select_products` igual que todo lo demas -> intenta buscar "recomendaciones" como si fuera nombre de producto -> `PRODUCT_NOT_FOUND` casi seguro | Necesita un intent nuevo del planner + `recommend_catalog_products` (requiere `sourceProduct` ya conocido - no sirve en frio) - ver Parte 8 |

---

## Parte 7 - Search V2 y ranking: respuestas directas

1. ¿R2 llega a Search V2 (T11)? **No, nunca.** R2 llega solo al retrieval legacy
   (`/v1/products/search`), que es el que en realidad tiene la normalizacion/tokenizacion/
   `matchType` que la tarea atribuia a "V2" (correccion de premisa, Parte 1.6).
2. ¿Usa un cliente viejo? El `CatalogPort` (`lib/catalog/types.ts`) es el contrato vigente y
   unico para R2 - no hay dos versiones de cliente compitiendo. Existe un cliente separado
   (`httpCatalogSearchProductsV2Client.ts`) para T11, pero solo lo usa `recommend_catalog_products`,
   nunca `search_products`.
3. ¿El Gateway adapta correctamente el contrato? Si para lo que expone - el problema no es de
   adaptacion sino de que endpoint se eligio conectar.
4. ¿`search_products` expone todos los campos necesarios? No: falta precio (Parte 4). Trae
   `matchType` pero no `score` numerico.
5. ¿Se pierde score/matchType en alguna capa? `matchType` sobrevive completo hasta CRM
   (`parseSearchItem`, `httpCatalogAdapter.ts:219-241`). El `score` numerico interno del
   Catalog Service (`searchTextRelevance.ts`) **nunca se expone en el JSON de `/v1/products/search`**
   - solo se usa para ordenar server-side, no se serializa. CRM nunca lo ve.
6. ¿Hay thresholds que conviertan candidatos validos en 0? No en el ranking (no hay corte por
   score minimo en el endpoint legacy) - el problema es 100% en el retrieval SQL (candidatos
   nunca llegan a existir para rankear), no en un threshold de ranking descartandolos despues.
7. ¿"discos olimpicos de 20kg" deberia devolver resultados hoy? Si, claramente - el producto
   existe, esta activo, en stock. No lo hace por el bug de la Parte 3.
8. ¿Que query real produce mejor resultado y por que? "disco olimpico 20kg" o "discos
   olimpicos 20kg" - cualquier variante SIN la palabra "de" like conector. Confirmado en vivo
   (Parte 17).

---

## Parte 8 - `recommend_catalog_products`: que hace exactamente

- ¿Rankea resultados existentes? Si, pero de un universo pre-calculado de relaciones
  (snapshot offline), no de un search en vivo.
- ¿Busca por si mismo? No - requiere `sourceProduct.productId` (constraint dura, `registry`
  linea 61 `required: ["productId"]` dentro de `sourceProduct`, que a su vez es
  `required: ["sourceProduct"]`).
- ¿Usa categorias? No directamente - usa relaciones producto-producto (co-occurrence,
  transition, rule), no taxonomia.
- ¿Requiere product IDs previos? Si, siempre.
- ¿Usa stock/precio? Si, como señal de disponibilidad/penalizacion en el score (T08 docs,
  Parte 1.6), pero via un puerto de datos comerciales, nunca inventado.
- ¿Es adecuada para resolver ambiguedad de "que producto es este"? **No** - resuelve
  "que mas le ofrezco dado que YA se cual es este producto", un problema distinto.
- ¿Es adecuada para "algo parecido"? Si, **si** ya existe un `sourceProductId` confirmado en
  la conversacion (ej. tras un `get_product_details` o una seleccion previa). En frio (C10 sin
  contexto previo) no sirve.
- ¿Debe ser obligatorio en el path normal? **No.** Debe activarse solo cuando el cliente pide
  explicitamente una alternativa/recomendacion sobre un producto YA identificado - necesita un
  intent nuevo del planner que hoy no existe (Parte 2.1).

---

## Parte 9 - `explore_catalog`: que es y cuando debe correr

Es explicitamente **browse estructurado por filtros + sort**, no discovery semantico
(confirmado por el propio schema: `sort`/`limit` obligatorios, filtros opcionales por
categoria/tipo/precio/disponibilidad - Parte 1.4). La descripcion del capability en el
Gateway lo dice sin ambiguedad: "Not for open-ended semantic product discovery (use
search_products)" (`registry.ts:316`).

Para "una pesa", "algo para entrenar en casa", "quiero una maquina" (Part 9's examples):
`explore_catalog` **no sirve directamente** tampoco, porque exige ya saber por que filtrar
(categoria/tipo/precio) o que ordenar - no responde "que tipos de producto existen para esta
necesidad vaga". Lo que esos casos necesitan es en realidad **T12 con constraint calibration
mas debil + fallback a mostrar categorias**, o un intent de discovery nuevo que primero
pregunte/infiera una categoria y LUEGO use `explore_catalog` para listar top-N de esa
categoria. Verificado en vivo: T12 con "una barra" da `clarification_required` pero el
ranking para queries de una sola palabra generica es debil (los primeros candidatos fueron
almohadillas para barra, no barras - Parte 17, query 9), asi que tampoco es una solucion
completa lista para usar sin ajuste.

**El planner debe emitir un intent nuevo y distinguible** (no derivar por "nivel de
especificidad" dentro de CommercialWork con heuristicas de longitud de string, que seria
fragil) - ver Parte 12.

---

## Parte 10 - Evidence model recomendado

CommercialWork ya tiene un evidence model funcional para search_products
(`buildCommercialWorkProjection.ts:72-105`), reusable casi integro para T12:

```
{
  query: string,                    // productReference original, sin normalizar
  executionId: string,               // crm_capability_executions.id (ya existe)
  sourceCapability: "search_products", // sin cambio de nombre - mismo capability, otro backend
  status: "resolved" | "clarification_required" | "no_match",  // NUEVO: copiado 1:1 de T12.resolution.status
  selectedCandidate?: { productId, combinationId?, name },      // ya existe (candidates.length===1)
  candidates: [{ productId, combinationId?, name, score, matchType, price?, stock? }],
  // price/stock: NUEVOS, ya vienen en T12 sin llamada adicional
}
```

Campos obligatorios: `query`, `executionId`, `sourceCapability`, `status`. Opcionales:
`selectedCandidate`, `candidates`, `price`/`stock` por candidato (pueden faltar si T12 no los
resolvio, nunca inventados - regla ADR-005 ya vigente en `lib/catalog/types.ts`).

Persistencia: sin cambio de tabla - `crm_capability_executions.responseSummaryJson` ya
guarda el payload completo del capability (confirmado: `searchProductsCandidates` lee
`execution.responseSummaryJson.items` hoy). Solo cambia la forma del JSON si se conecta T12.

Como evita inventar IDs: el capability nunca construye `productId` desde texto - siempre lo
lee de la respuesta del Catalog Service (confirmado, ningun path en `registry.ts` ni en
`applyObjectiveState` sintetiza un id).

Sobrevive restart/reprojection: si - `latestSearchProductsExecution` (`buildCommercialWorkProjection.ts:72-88`)
relee `crm_capability_executions` por `requestSummaryJson.query` normalizado en cada
proyeccion, no depende de estado en memoria.

Stale evidence: `staleBlockersForStep` (`commercialWorkExecutor.ts:613`, no detallado en este
audit por no ser parte de catalog integration) ya invalida evidence cuando cambian selection/
destination. Si cambia `productReference` entre turnos, `commercialObjectiveSupersessionFamily`
(`deriveCommercialObjectives.ts:48-54`) trata `SELECT_PRODUCTS`/`CHANGE_QUANTITY` como la
misma familia "selection" - un nuevo objective del mismo tipo supersede al anterior
automaticamente (linea 164-173), invalidando la evidencia vieja de forma natural sin logica
adicional.

---

## Parte 11 - Step graph recomendado (nombres reales)

```
Objective SELECT_PRODUCTS/CHANGE_QUANTITY, sin items resueltos
       |
   SEARCH_PRODUCTS (capabilityName: "search_products", backend HTTP -> T12 en vez de /v1/products/search)
       |
   T12 resolution.status
   +---------------------+---------------------------+
 resolved            clarification_required        no_match
   |                       |                           |
 items[] auto            objective.status =        objective.status =
 (READY,                 WAITING_CUSTOMER,          WAITING_CUSTOMER,
 SELECT_PRODUCTS         missingRequirements:       missingRequirements:
 continua)               PRODUCT_AMBIGUOUS          PRODUCT_NOT_FOUND
                          (candidates con precio)    (mensaje actual, sin cambio)
```

Por edge:

- `PRODUCT_REFERENCE -> SEARCH_PRODUCTS`: dependency ninguna, activation siempre que falten
  items y sobre productReference, system-owned, retryable segun `error.retryable` del Catalog
  Service (timeout/5xx si, 4xx no), evidence: la respuesta cruda de T12, terminal: nunca (solo
  alimenta el siguiente edge).
- `SEARCH_PRODUCTS(resolved) -> SELECT_PRODUCTS(auto)`: dependency `STEP_COMPLETED`
  (mecanismo ya existente, sin cambio), system-owned, no retryable (ya resuelto), evidence:
  `selectedCandidate`, terminal: no (SELECT_PRODUCTS sigue su propio ciclo).
- `SEARCH_PRODUCTS(clarification_required) -> WAITING_CUSTOMER`: customer-owned, no
  retryable, evidence: `candidates[]` con precio real (mejora sobre hoy), terminal para este
  turno (espera respuesta).
- `SEARCH_PRODUCTS(no_match) -> WAITING_CUSTOMER`: idem, mensaje sin cambio de contrato.

No se agrega `EXPLORE_CATALOG` ni `RECOMMEND_PRODUCTS` a este grafo - permanecen fuera del
camino principal de resolucion de producto (Partes 8/9), reservados para un intent distinto
del planner si se decide construirlo (fuera de alcance de A11.2, ver Parte 19).

---

## Parte 12 - Planner vs derivacion deterministica

El estado real ya esta mayormente alineado con la preferencia de la tarea: el LLM **no**
decide tool-by-tool. Emite solo `{ intent.type, productReference, quantity }` (Parte 2.1,
confirmado por `buildIntentPlannerPromptPackage.ts`/`parseCommercialIntentPlan.ts` -
ningun campo de intent representa un nombre de capability). Toda la derivacion de
`SEARCH_PRODUCTS` a partir de "hay productReference sin items" es determinista
(`deriveCommercialWorkSteps.ts:99`, expresion booleana pura sobre el estado del objective).

Lo que la tarea pide como mejora (derivar `EXPLORE_CATALOG` "si la query es demasiado
amplia") **no es factible de forma puramente deterministica hoy** sin heuristicas fragiles
(longitud de string, conteo de palabras) porque no existe una senal estructurada de
"especificidad" en el output del planner - el LLM ya sabe si "una pesa" es mas vago que
"barra classic 20kg" (esa es literalmente su tarea de comprension de lenguaje), pero hoy no
se le pide expresarlo. La opcion correcta no es que el LLM elija la capability, sino que el
LLM devuelva una senal adicional simple y auditable (ej. un campo `specificity: "exact" |
"described" | "broad"` o directamente el resultado de T12 que ya lo resuelve mejor: dejar que
T12 sea quien decida `resolved/clarification_required/no_match`, que es exactamente ese
juicio, ya implementado con reglas explicitas y explicables). **Conclusion: la arquitectura
actual ya cumple el principio ("LLM no decide tool-by-tool"); el gap no es de quien decide,
es de que el unico backend de decision conectado (retrieval legacy) es mas tosco que el que
ya existe (T12).**

---

## Parte 13 - Retry / failure semantics por capability de catalogo

| Capability | Errores retryable | Errores no retryable | Mapeo a estado CommercialWork |
|---|---|---|---|
| `search_products` | `rate_limited`, `unavailable`, `timeout` (`mapCatalogErrorToOutcome`, `registry.ts:389-405`) | `invalid_input`, `unauthorized`, `not_found` (nunca ocurre en search - 0 resultados no es `not_found`) | retryable -> `WAITING_SYSTEM` (`applyObjectiveState:248-251`); no retryable -> `FAILED` (linea 253) |
| `get_product_details` | igual que arriba | `not_found` (404 real del Catalog Service) -> `data: null`, `errorCode: "product_not_found"`, NO error tecnico | no ejecutado por R2 hoy (Parte 2) |
| `explore_catalog` | igual, mas `catalog_source_unavailable` propio | `invalid_limit`/`invalid_sort`/`invalid_request`/`category_not_found` (mapeados explicitamente por el comentario de incidente real en `httpCatalogAdapter.ts:165-176`) | no ejecutado por R2 hoy |
| `recommend_catalog_products` | segun `error.retryable` de T10B5 (`maxRetries: 0` propio - nunca reintenta el capability mismo, delega el retry al Gateway si aplica) | invalido `source_product_required` etc. | no ejecutado por R2 hoy |

Regla obligatoria de la tarea ("system-owned gap != WAITING_CUSTOMER"): **ya se cumple** en
el codigo actual, confirmado explicitamente por el propio comentario en
`buildCommercialWorkProjection.ts:244-246`: "Technical failure (catalog unavailable,
invalid_arguments, etc.) - system-owned, never WAITING_CUSTOMER". No requiere cambio.

`maxRetries` por capability (Gateway-level, antes de marcar el step no-retryable-por-el-Gateway
y dejarlo a `WAITING_SYSTEM`/reintento por proyeccion): `search_products: 1`,
`get_product_details: 1`, `batch_get_products: 1`, `explore_catalog: 1`,
`recommend_catalog_products: 0`.

---

## Parte 14 - Continuation model

Ya implementado y funcional para el caso `PRODUCT_AMBIGUOUS` (multi-turno con candidatos
reales, no solo texto):

Turno 1: `applyObjectiveState` linea 232-238 pone `productCandidates` en `objective.inputs` y
persiste `WAITING_CUSTOMER`.

Turno 2 (respuesta del cliente, ej. "mancuernas" o "la XMASTER"): `resolveProductRequirement`
(`requirementResolver.ts:176-202`) hace fuzzy-match de la nueva frase contra
`RecentCatalogContext` (que ya incluye los candidatos mostrados en el turno 1, porque
`RecentCatalogContext` se alimenta de ejecuciones de capability recientes) - si matchea
exactamente 1 -> `resolved`, sigue directo a `SELECT_PRODUCTS` sin research. Si matchea 0 o
2+, permanece `missing`/`ambiguous` y el ciclo continua.

No reinicia discovery desde cero: `commercialObjectiveSupersessionFamily` (Parte 10) asegura
que un nuevo seed del mismo tipo (`SELECT_PRODUCTS`) supersede el objective viejo pero
preserva la busqueda ya hecha via `RecentCatalogContext`, no dispara un `search_products`
nuevo si el fuzzy-match local ya resuelve. No duplica searches: confirmado por el propio
comentario en `semanticIntentAdapter.ts:60-67` ("asking search_products again would be a
redundant network call for information already in hand").

Con T12 conectado, este mecanismo no cambia de forma - solo mejora la calidad de los
candidatos que `RecentCatalogContext` termina conteniendo (con precio, en vez de sin precio).

---

## Parte 15 - Observabilidad requerida

Hoy existe una traza minima pero real: `crm_capability_executions` guarda
`requestSummaryJson`/`responseSummaryJson`/`executionStatus`/`errorCode`/`retryable` por
ejecucion, mas `evidence[]` con `source`/`summary`/`capturedAt` adjunta a cada step
(`commercialWorkExecutor.ts`, confirmado en toda la traza de la Parte 3). No hay logs
estructurados con nombres tipo `R2_SEARCH_PRODUCTS` como la tarea sugiere - el step type
(`SEARCH_PRODUCTS`) y el capability name (`search_products`) ya cumplen ese proposito via el
mismo `stepType`/`capabilityName` guardados en cada `CommercialWorkStepExecutionRecord`.

Gap real si se conecta T12: agregar al `evidence`/`responseSummaryJson` el campo
`resolution.status` (`resolved`/`clarification_required`/`no_match`) y `match.reasons[]` de
T12 explicitamente, para poder auditar despues *por que* el sistema pidio clarificacion (hoy
solo se ve "0 o 2+ candidatos", no el motivo estructurado). No loguear el `description` largo
de cada producto (ya viene en la respuesta de T12 pero es ruido para logs/auditoria, no un
dato sensible - simplemente extenso).

---

## Parte 16 - Legacy vs R2 (mutual exclusion)

No se corrio una query en vivo contra `crm_capability_executions` con `message_id` reales
para esta auditoria especifica (fuera del alcance read-only definido - requeriria acceso a
una base con conversaciones reales y no es necesario para responder la pregunta arquitectonica
de este audit). Lo que si se confirmo, releyendo el codigo del chokepoint (trabajo de la
misma sesion de hoy, `SALES-AGENT-R2-A11`, commit `00e93e0`): `runNativeAutonomousCycle.ts`
es el unico punto de entrada compartido entre WhatsApp real y el legacy follow-up worker, y
enruta a R2 vs legacy segun `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED`/`_WA_IDS` como decision
excluyente antes de invocar cualquier capability de catalogo - no hay un camino de codigo
donde ambos runtimes corran para el mismo mensaje. `search_products`/`explore_catalog`/
`recommend_catalog_products` estan registrados una sola vez en `CAPABILITY_GATEWAY_REGISTRY`
(Parte 2) y son consumidos por ambos runtimes desde el mismo registro - **no hay dos
implementaciones de capability compitiendo**, solo dos consumidores (legacy loop vs
CommercialWork step executor) que llaman al mismo Gateway. Confirmar con datos reales
(`SELECT message_id, COUNT(*) FROM crm_capability_executions GROUP BY message_id HAVING
COUNT(DISTINCT source_runtime) > 1` o equivalente) queda como gap explicito de este audit -
ver Parte 17 (lista de gaps).

---

## Parte 17 - Pruebas reales ejecutadas (read-only, en vivo)

Instancia local del Catalog Service levantada en modo dev (`npm run dev`,
`tsx watch src/server.ts`), conectada a la base real `pesas_productiva` (RDS,
usuario de solo lectura `pc_consultor` segun `.env`), apagada al terminar. Ninguna escritura
- todos los endpoints probados son GET/POST de lectura pura. Resultados completos:

| # | Query | Endpoint | Resultados | Top candidato / hallazgo |
|---|---|---|---|---|
| 1 | "discos olimpicos de 20kg" | `/v1/products/search` | **0** | - |
| 2 | "disco olimpico 20 kg" | `/v1/products/search` | 3 | productId 1499 "Par Discos Olímpicos Grip Rubber 20kg \| PROmachine" |
| 3 | "disco 20kg" | `/v1/products/search` | 4 | idem + productId 1528 |
| 4 | "barra classic" | `/v1/products/search` | 2 | productId 1171 (15kg), 31 (20kg) |
| 5 | "discos 20kg" (plural, sin "de") | `/v1/products/search` | >0 | confirma que plural NO rompe el match |
| 6 | "discos olimpicos 20kg" (plural, sin "de") | `/v1/products/search` | >0 | confirma que la frase completa SIN "de" funciona |
| 7 | "disco olimpico de 20kg" (singular, CON "de") | `/v1/products/search` | **0** | aisla "de" como la variable causante, no plural ni espaciado |
| 8 | "discos olimpicos de 20kg" (frase literal del cliente) | `/api/v2/catalog/resolve-product-intent` | `no_match` | T12 hereda el mismo bug via retrieval compartido (Parte 1.5.1) |
| 9 | "disco olimpico 20kg" (sin "de") | `/api/v2/catalog/resolve-product-intent` | `clarification_required`, 3 candidatos | precio/stock/publicLink completos por candidato, reasons `["NAME_TOKEN_MATCH","DESCRIPTION_MATCH","ATTRIBUTE_MATCH","EXPLICIT_WEIGHT_MATCH"]` |
| 10 | "una barra" | `/api/v2/catalog/resolve-product-intent` | `clarification_required`, 5 candidatos | **gap real de ranking**: top candidatos son almohadillas para barra ("Almohadilla de Barra..."), no barras - el termino generico "barra" no prioriza el tipo de producto correcto |
| 11 | "barra classic" | `/api/v2/catalog/resolve-product-intent` | `clarification_required`, dimension "weight" | opciones estructuradas "15 kg"/"20 kg" con precio - mejor que el legacy (solo nombres) |
| 12 | "mancuerna exagonal 10k" (typo) | `/v1/products/search` | 1 (correcto) | match por coincidencia de subcadena accidental, no tolerancia real a typos |

Latencias: no medidas con precision (curl simple, ambiente local con DB remota RDS) - todas
las respuestas llegaron en <1.5s subjetivamente, sin timeouts. No se considera un benchmark
valido, solo confirmacion de disponibilidad funcional.

---

## Parte 18 - Output principal (sintesis)

1. **Diagrama del Catalog Service real**: 6 endpoints operativos -
   `/v1/products/search|:productId|batch|explore` (legacy, `/v1` prefix) +
   `/api/v2/catalog/resolve-product-intent` (T12) + `/api/v2/recommendations/search-products`
   (T11) - todos leidos de `app.ts` + los 3 archivos `*Route.ts` (Parte 1).
2. **Tabla de endpoints**: Parte 1 (secciones 1.1-1.6).
3. **Tabla de capabilities Gateway**: Parte 2.
4. **Legacy vs R2 coverage**: Parte 2 (misma tabla, columnas "Legacy Tool Pool"/"CommercialWork Step").
5. **Trazado WA01 actual**: Parte 3, 14 pasos, confirmado byte-a-byte contra el mensaje real
   reportado en produccion.
6. **Root cause de 0 resultados**: filtrado de stopwords ausente en el fallback de tokens SQL
   del retrieval legacy (`mysqlCatalogRepository.ts:311-316`), que afecta tanto a
   `/v1/products/search` como a T12 (que lo reusa). Aislado empiricamente (Parte 17, queries 1/6/7).
7. **¿Search V2 conectado?** T11 (el endpoint que ese nombre designa realmente) no esta
   conectado a `search_products` ni deberia estarlo - resuelve un problema distinto
   (recomendacion desde producto conocido). El endpoint que si deberia usarse para busqueda
   por texto libre (T12) tampoco esta conectado.
8. **Que endpoint/capability por etapa**: Parte 4 (pipeline recomendado) + Parte 11 (step graph).
9. **Pipeline recomendado**: Parte 4.
10. **Step graph recomendado**: Parte 11.
11. **Evidence contract recomendado**: Parte 10.
12. **WAITING_CUSTOMER/WAITING_SYSTEM semantics**: ya correctas hoy, sin cambio necesario (Parte 13).
13. **Retry semantics**: Parte 13.
14. **Continuation model**: ya implementado y funcional, sin cambio de forma necesario (Parte 14).
15. **Observabilidad requerida**: Parte 15 (gap pequeno: exponer `resolution.status`/`reasons` en evidence).
16. **Legacy vs R2 mutual exclusion**: confirmado estructuralmente por diseno del chokepoint;
    verificacion con datos reales queda pendiente como gap explicito (Parte 16).
17. **Gaps concretos**: ver lista abajo.
18. **Piezas reutilizables**: `applyObjectiveState`'s manejo de READY/WAITING_CUSTOMER,
    `latestSearchProductsExecution`, `commercialObjectiveSupersessionFamily`, todo el
    Capability Gateway/executor/persistence layer - **nada de esto necesita reescribirse**,
    solo el backend HTTP detras de `search_products` y la interpretacion de su respuesta.
19. **Cambios minimos en Customer 360**: ver Parte 19 (slices).
20. **Cambios minimos en Catalog Service**: fix del filtrado de stopwords en
    `mysqlCatalogRepository.ts` (Parte 3, paso 11) - una lista chica de palabras de relleno
    en espanol ("de", "del", "la", "el", "los", "las", "un", "una") excluidas del AND
    obligatorio de tokens, o usadas solo como boost opcional. Este cambio beneficia a
    `/v1/products/search` y a T12 simultaneamente sin tocar CRM.
21. **Que NO deberia cambiarse**: el Capability Gateway, el executor, la persistencia
    (`crm_capability_executions`), el mecanismo de supersession/reprojection, el manejo de
    WAITING_SYSTEM/retry - todos ya correctos y alineados con los principios de la tarea.
    Tampoco deberia agregarse `EXPLORE_CATALOG`/`RECOMMEND_PRODUCTS` al camino principal sin
    un intent nuevo del planner que los justifique (evitar pasos innecesarios, Parte 4).

### Gaps concretos

- **G1 (Catalog Service)**: fallback de tokens SQL trata stopwords como tokens obligatorios -
  bug aislado y reproducido, fix de bajo riesgo (lista de exclusion, sin tocar ranking).
- **G2 (arquitectura)**: `search_products` en CRM apunta al endpoint legacy en vez de a T12 -
  gap de conexion, no de diseno (T12 ya existe, ya esta documentado, ya esta probado en este
  audit).
- **G3 (calidad de datos para CommercialWork)**: `search_products` no trae precio - una
  seleccion puede confirmarse sin que el sistema haya visto el precio actual en esa
  conversacion. T12 lo resuelve gratis si se conecta.
- **G4 (ranking T12)**: consultas genericas de una palabra ("una barra") priorizan mal
  (accesorios sobre el producto principal) - gap real dentro de T12 mismo, independiente de
  si CRM lo conecta o no.
- **G5 (planner)**: no existe intent de discovery/recomendacion/exploracion distinto de
  `select_products` - C03/C04/C10 no tienen tratamiento diferenciado posible sin esto.
- **G6 (observabilidad)**: `crm_capability_executions` no captura el motivo estructurado de
  clarificacion (solo conteo de candidatos) - perdida de trazabilidad util para soporte.
- **G7 (verificacion pendiente)**: mutual exclusion legacy/R2 no verificada con datos reales
  de produccion en este audit (Parte 16).

---

## Parte 19 - Plan de implementacion por slices

### A11.2-A - Catalog Contract Audit (este documento)

Sin codigo. Cerrado con este archivo.

### A11.2-B - Fix de stopwords en Catalog Service

- Objetivo: que `/v1/products/search` y T12 encuentren productos con conectores naturales
  ("de", "del", etc.) en la frase del cliente.
- Archivos: `MS-pesaschile-catalog-service/src/infrastructure/repositories/mysqlCatalogRepository.ts`
  (funcion `shouldUseNameTokenFallback` + construccion de tokens del fallback, lineas ~55-76,
  305-316), posiblemente `src/domain/catalog/searchTextNormalization.ts` si se decide filtrar
  stopwords en `tokenizeCatalogSearchText` en vez de en el repository.
- Tests: casos existentes del repo del Catalog Service (`tests/`) + un caso nuevo explicito
  para "producto X de Y kg" con stopword en medio.
- Riesgos: bajo - cambio acotado a una funcion pura, no toca schema ni endpoints. Riesgo de
  falsos positivos si una stopword filtrada coincide con parte de un nombre real de producto
  (revisar con datos reales antes de mergear, ya que el team de Catalog Service es dueño de
  ese repo, no este).
- Criterio de aceptacion: los 3 casos de la Parte 17 (queries 1, 7 -> pasan a devolver
  candidatos) sin regresion en queries que hoy funcionan (2-6, 8-12).
- Dependencia: ninguna - puede ir antes o en paralelo con B/C.

### A11.2-C - Conectar `search_products` (CRM) a T12 en vez del legacy

- Objetivo: que CommercialWork use el endpoint disenado para lenguaje natural, con
  clarificacion estructurada y datos comerciales completos.
- Archivos: `lib/catalog/types.ts` (extender `CatalogPort`/agregar metodo nuevo, o
  reemplazar el metodo `searchProducts` existente - decision de diseno: ¿mantener
  `search_products` como capability y solo cambiar su backend HTTP, o exponer T12 como
  capability nueva? Recomendado: mismo capability, nuevo backend, para no duplicar el step
  type `SEARCH_PRODUCTS` ni el evidence model existente), `lib/catalog/httpCatalogAdapter.ts`
  (nuevo metodo apuntando a `POST /api/v2/catalog/resolve-product-intent`),
  `lib/brain/commercial/capability-gateway/registry.ts` (`searchProductsCapability`, adaptar
  el mapeo de `result.value` al nuevo shape de respuesta),
  `lib/brain/commercial/work/buildCommercialWorkProjection.ts` (`applyObjectiveState`,
  reemplazar el conteo manual de candidatos por lectura de `resolution.status`).
- Tests: los tests existentes de `search_products` capability + `applyObjectiveState`
  necesitan actualizar sus fixtures al nuevo shape de respuesta; agregar casos para
  `clarification_required` con candidatos que traen precio.
- Riesgos: medio - toca el capability mas usado de R2 y su interpretacion en la proyeccion;
  requiere decidir si `PRODUCT_AMBIGUOUS` sigue siendo el nombre del `missingRequirement` o
  se renombra (recomendado: mantener el nombre, solo cambia el origen del dato, para no
  romper `buildCommercialWorkFinalizerMessage.ts` innecesariamente).
- Criterio de aceptacion: WA01 (Parte 3) deja de terminar en `PRODUCT_NOT_FOUND` para
  "2 discos olimpicos de 20kg" tras B+C combinados; C01/C05 mantienen o mejoran su
  comportamiento actual (mas informacion en la clarificacion, misma o menor tasa de preguntas
  innecesarias).
- Dependencia: se beneficia de B (sin B, C sigue heredando el mismo bug via T12 - Parte 1.5.1),
  pero puede implementarse y testearse en paralelo con fixtures que no dependan del bug real.

### A11.2-D - Exponer precio/stock de T12 en el evidence, sin nuevo step

- Objetivo: cerrar G3 (Parte 18) - que `SELECT_PRODUCTS` pueda confirmar que el precio visto
  por el cliente sigue vigente sin una llamada adicional a `get_product_details`.
- Archivos: el mismo `applyObjectiveState`/evidence model de C, extendido con los campos
  `price`/`stock` ya presentes en la respuesta de T12 (Parte 10).
- Tests: verificar que el evidence persistido en `crm_capability_executions` incluye estos
  campos sin romper la deserializacion existente.
- Riesgos: bajo - aditivo, no cambia ningun campo existente.
- Criterio de aceptacion: un `select_products` posterior puede leer precio directamente del
  evidence de `search_products` sin nueva llamada HTTP.
- Dependencia: requiere C completo primero (no tiene sentido sin T12 conectado).

### (Fuera de alcance de A11.2, requiere decision de producto separada)

Un intent nuevo de discovery/recomendacion en el planner (para C03/C04/C10, G5) es un cambio
de superficie del planner + un nuevo objective type con productor real, no una integracion de
catalogo - se recomienda como una release propia (`SALES-AGENT-R2-A12` o similar), no como
parte de A11.2, porque cambia el contrato del LLM-facing prompt y el alcance de intents
soportados, algo que excede "integracion con el Catalog Service".

---

## Parte 20 - Veredicto

**CATALOG_INTEGRATION_PARTIAL**

Razon: la arquitectura de orquestacion (Capability Gateway, CommercialWork executor,
evidence/persistence, retry/WAITING_SYSTEM semantics, continuation) ya esta correctamente
disenada y alineada con los principios de la tarea - no requiere reconstruccion. Pero el
camino de resolucion de producto conecta hoy al backend de catalogo equivocado (legacy en vez
de T12), y el backend correcto (T12) hereda un bug real y aislado en su capa de retrieval
compartida que debe corregirse en el Catalog Service antes de que conectar T12 resuelva el
caso reportado. Ninguna de las dos correcciones por si sola (solo B, o solo C) resuelve
completamente "2 discos olimpicos de 20kg" - se necesitan ambas. No se declara
`A11_OWNER_ONLY_OPERATIONAL` ni implementacion completa; este documento es exclusivamente el
insumo de diseno para decidir el siguiente release (A11.2-B/C/D, Parte 19).
