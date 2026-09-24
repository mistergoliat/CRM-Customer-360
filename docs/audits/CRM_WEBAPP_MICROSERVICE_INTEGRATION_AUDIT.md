# CRM WebApp — Microservice Integration Architecture Audit

- **Repository:** `CRM-Customer-360`
- **Branch / revision inspected:** `develop` / `6526d2c`
- **Audit date:** `2026-09-24`
- **Mode:** read-only architectural audit
- **Changes made by this audit:** this report only
- **R4:** explicitly outside redesign scope; no R4 code, contract, schema, adapter, projection or migration was changed

Evidence labels used throughout the report:

- **CONFIRMED:** directly supported by current code, configuration names/status, tests or repository documentation.
- **INFERRED:** architectural conclusion derived from several confirmed facts.
- **UNVERIFIED:** could not be established from this checkout; external deployment and live reachability are not implied by adapter existence.

## 1. Executive verdict

1. **[CONFIRMED]** CRM has real HTTP integration boundaries for Catalog, Customer Profile, Customer Intelligence/Audiences, Marketing Copilot, Quote Service, Customer Service and Carrier Service. Their adapters use server-side `fetch`; the browser does not receive provider credentials through those paths.
2. **[CONFIRMED]** No sibling microservice source repositories or deploy manifests for those services were available in the inspected workspace. Their deployed topology, live health, traffic and production configuration are therefore **UNVERIFIED**.
3. **[CONFIRMED]** Catalog, Quote, Customer Service and Carrier are wired into server-side domain/runtime consumers. Catalog is also wired through CRM BFF routes for the Catalog console. This establishes `IMPLEMENTED` and `WIRED`, not `PRODUCTIVELY USED`.
4. **[CONFIRMED]** Local configuration is incomplete for the external boundaries in this checkout: the relevant base URLs/tokens are empty and the Customer Profile, Marketing Copilot, Customer Intelligence Audiences and Logistics feature flags are disabled. This is a checkout snapshot, not proof of every deployment environment.
5. **[CONFIRMED]** Customer Service is declared as the authority for customer creation/linking, but `POST /api/customers` still writes directly to the local `master_customer` table. This is the highest-severity authority violation and creates a possible split-brain identity path.
6. **[CONFIRMED]** Customer Profile has two client generations: an unused legacy `lib/customer-profile` adapter and the current `lib/integrations/customer-profile` client. Their configuration names, auth headers and contracts differ. The legacy client should be removed or formally retired after evidence confirms no external consumer.
7. **[CONFIRMED]** Marketing Copilot, Customer Intelligence Dashboard and Audiences share a CRM configuration base URL, but code comments are insufficient to prove whether they are one deployable service, several APIs in one deployment, or separate deployments. That topology remains **UNVERIFIED**.
8. **[CONFIRMED]** Remote health is not represented by the CRM system health endpoint. `getSystemHealth()` checks local DB, local/legacy sources, Meta configuration and n8n; it does not call Catalog, Quote, Customer Service, Carrier, Customer Profile, Copilot or Customer Intelligence readiness endpoints.
9. **[CONFIRMED]** The `/integrations` page is backed by a fixture/read model and carries a fixture badge. It must not be treated as an operational service registry or live connectivity dashboard.
10. **[CONFIRMED]** There is no Mercado Pago/payment adapter, payment webhook, checkout client or payment reconciliation path identifiable in the current runtime. Payments are `FUTURE` / `NOT CONNECTED`.
11. **[INFERRED]** The strongest current architecture is the server-side adapter plus domain/capability boundary. The largest hardening needs are shared invariants—correlation, readiness, runtime response validation, normalized errors, PII classification and configuration naming—not a single universal HTTP client.
12. **[INFERRED]** Catalog and Quote can be retained with hardening; Customer Service requires authority refactoring; duplicate Customer Profile and Meta transport generations require consolidation; payment remains future; Agent Configuration, Agent Follow-ups and future Agent Activity remain `PENDING R4`.

## 2. Scope and evidence

### Inspected scope

**[CONFIRMED]** The audit covered:

- `AGENTS.md`, `docs/PRODUCT_NORTH_STAR.md`, `docs/ACTIVE_RELEASE.md`, relevant ADRs, integration contracts and historical audit documents.
- Current `app/api/**` route handlers, React consumers and server pages relevant to external integrations.
- `lib/catalog/**`, `lib/integrations/**`, `lib/domains/**`, `lib/customer-intelligence/**`, `lib/brain/**` capability/runtime paths and the Meta messaging boundary.
- Environment variable names and safe boolean/status snapshots without exposing secret values.
- Integration/unit test locations and adapter behavior.
- Local health/readiness implementations and the `/integrations` read model.
- Repository and sibling-directory inventory to determine whether external service source/deploy evidence was present.

### Evidence limitations

- **[CONFIRMED]** The sibling development directory contained `CRM-Customer-360` and `R4-agent-platform`; no source checkout for Catalog, Customer Profile, Customer Intelligence, Marketing Copilot, Quote, Customer Service or Carrier was available there. The EC2 directory contained only a credential file, not service source or deploy manifests.
- **[CONFIRMED]** No external `curl`/smoke call was made. This audit performed no external writes and did not treat a timeout or absent local configuration as proof that a remote service is down.
- **[CONFIRMED]** The CRM checkout is clean at the inspected revision before this report. Existing historical documents were not corrected or treated as normative when current code contradicted them.
- **[INFERRED]** Any statement about an external endpoint being “available” below means “declared by a CRM contract/document or wrapped in an adapter”; actual deployment reachability is **UNVERIFIED** unless current local tests prove the behavior against a controlled HTTP server.

### State vocabulary

| State | Meaning in this audit |
|---|---|
| `IMPLEMENTED` | Adapter/client/contract exists in code. |
| `WIRED` | A current CRM route, domain service or runtime capability calls it. |
| `CONFIGURED` | Required runtime configuration is present in the inspected environment. |
| `REACHABLE` | A real deployed endpoint was reached during this audit. |
| `VALIDATED` | Behavior is covered by current tests or a controlled local HTTP contract. |
| `PRODUCTIVELY USED` | Evidence shows live product traffic or an operational deployment, not just code/tests. |

## 3. Current integration topology

```text
Browser
  │
  ├── Next.js BFF / route handlers ───────────────┐
  │       ├── /api/catalog/products/*             │
  │       ├── /api/marketing/copilot/*            │
  │       ├── /api/marketing/customer-intelligence/*
  │       └── /api/audiences/*                    │
  │                                               │
  │       server-side clients/adapters             │
  │          ├── CatalogPort + SearchProductsV2 ──┼──> Catalog Service
  │          ├── Copilot/Dashboard/Audience client ─> Customer Intelligence /
  │          │                                      Marketing backend [topology UNVERIFIED]
  │          └── local auth and operator gates     │
  │                                               │
  ├── CRM local routes/domains ────────────────────┤
  │       ├── Customer pages/read models ──────────> local MariaDB projections
  │       ├── POST /api/customers ────────────────> direct master_customer write [boundary gap]
  │       └── /integrations ──────────────────────> fixture/partial read model
  │                                               │
  └── Meta webhook / client boundary               │
          ├── inbound verified webhook             ├──> Meta Graph / WhatsApp
          └── outbox worker / transport             │

Agent/runtime server
  │
  └── Capability Gateway / domain services
          ├── Customer Profile client ────────────> Customer Profile [deployment UNVERIFIED]
          ├── Customer Service adapter ────────────> Customer Service [release externally blocked]
          ├── Quote Service adapter ───────────────> Quote Service
          ├── Carrier Service adapter ─────────────> Carrier Service
          └── CatalogPort ─────────────────────────> Catalog Service

Local / legacy data dependencies
  ├── master_customer and customer_external_identity
  ├── PrestaShop mirror DB
  ├── n8n legacy views/repositories
  └── PC/POS logistics DB commune resolver

R4
  └── Not redesigned or connected by this audit; listed only as PENDING R4.
```

**[CONFIRMED]** No React component imports provider tokens or calls an external URL directly. Browser consumers call CRM `/api/**` routes or use local server-rendered domain services. The exception worth monitoring is server-side UI code reading a Meta configuration boolean; it does not expose the token itself.

**[INFERRED]** CRM currently has two integration planes: a UI-facing BFF plane and an Agent/runtime capability plane. They share some adapters (especially Catalog) but do not share a uniform operational status model.

## 4. Service inventory

The matrix records the current CRM-side boundary. `UNVERIFIED` means the external fact could not be established from this checkout.

| Service | Domain owner | Business responsibility | Source of truth | Deployment | CRM consumers | CRM route handlers | CRM adapter(s) | Remote endpoints used | Other endpoints available | API version | Contract/version | Authentication | Browser exposure | Timeout | Retry | Idempotency | Concurrency/versioning | Correlation | Health/live | Health/ready | Error taxonomy | Degraded semantics | Provenance | Freshness | PII | Cache | Duplicate clients | Runtime coupling | Current maturity | Target decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Catalog Service | Catalog | Product identity, price, stock, semantic discovery and recommendations | Catalog Service | External deployment **UNVERIFIED** | Catalog console; quote assembly; agent product tools | `/api/catalog/products/search`; `/api/catalog/products/[productId]/context` | `lib/catalog/httpCatalogAdapter.ts`; `lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts` | Search, detail, batch, explore, intent resolution, semantics, registries; recommendation search V2 | Health/live/ready not called; any undocumented provider endpoints **UNVERIFIED** | v1 and `/api/v2` | Adapter contract plus semantic/ontology/training registry versions | `x-api-key` | No provider exposure; BFF only | 5s; V2 3s default, capped 30s | No adapter retry; gateway/orchestrator owns retry | No command mutation in this boundary | Snapshot/execution fields; no CRM CAS | `x-correlation-id` or optional V2 correlation | Not consumed | Not consumed by CRM adapter | Closed provider/status/parse/timeout codes | Search/recommendations preserve warnings and degraded blocks; no silent fixture fallback | Catalog source, retrieved time, cache flag; semantic execution metadata | Snapshot/version fields where supplied | Product/business data; credentials redacted in errors | No shared CRM cache; provider cache flag preserved | Two clients for same owner/gateway | Medium | 4 — integration-tested; local configuration absent; live/productive use **UNVERIFIED** | KEEP + HARDEN |
| Customer Profile | Customer Profile | Profile, commercial summary, purchase history/behavior, order status and RFM snapshots | Customer Profile service for returned profile facts; identity semantics cross-service **UNVERIFIED** | External deployment **UNVERIFIED** | Agent customer-profile context; no direct UI consumer found | None identified | Current: `lib/integrations/customer-profile/http-client.ts`; legacy: `lib/customer-profile/httpCustomerProfileAdapter.ts` | Profile, commercial-summary, purchased-products, purchase-behavior, order status, RFM; current client can call `health/ready` | Legacy docs mention no resolution/search/PrestaShop direct/RFM in old adapter; exact external inventory **UNVERIFIED** | v1 | `customer-profile-prestashop-direct-v1`; `customer-rfm-runtime-v1`; legacy contract differs | Current Bearer plus service name; legacy optional API key | No | 3s default, capped 30s; legacy 5s | No client retry; capability layer decides retryability | Read-only | Contract/provenance checks, no CRM mutation | Current `x-request-id`; legacy `x-correlation-id` | Not consumed | Current client exposes readiness method but system health does not call it | Typed invalid/not-found/unavailable/timeout/schema/provenance errors; legacy taxonomy differs | Typed unavailable; no silent local fallback | Identity source, generated time, contract version, snapshot metadata | `DERIVED`/near-real-time and snapshot semantics from contract | Customer and purchase data; summaries intentionally minimize PII | No CRM cache | Legacy/current clients and env families | High in agent context; low UI coupling | 4 — integration-tested/wired; disabled and unconfigured locally; reachability/productive use **UNVERIFIED** | CONSOLIDATE |
| Customer Intelligence / Audiences | Customer Intelligence | Dashboard analytics, RFM, clusters, intersections, audience schema/evaluation/export | Intelligence backend for analytics and audience evaluation/export; CRM composes UI | Deployment relationship to Profile/Copilot **UNVERIFIED** | Marketing dashboard; audience workspace | `/api/marketing/customer-intelligence/dashboard/*`; `/api/audiences/*` | `lib/customer-intelligence/dashboardClient.ts`; `audienceClient.ts` | Dashboard context/overview/RFM/clusters/intersections; audience schema/evaluate/export | Any provider health and population-management endpoints **UNVERIFIED** | v1 | Audience definition v1; dashboard filter contracts; response validation incomplete | Internal token headers, separate audience evaluate/export/PII tokens | No; BFF only | 30s via marketing timeout | No client retry | Export/evaluate semantics not CRM-idempotent | Feature snapshot ID and contract fields; no CRM CAS | No consistent correlation header | Not consumed | No remote readiness called | Proxy/HTTP errors; dashboard/Copilot JSON largely cast/passthrough | Audience routes fail closed when disabled/unconfigured; export is asynchronous/contract-dependent | Audience definition version; dashboard context/filter snapshot fields | Feature snapshot/provenance supplied by backend; freshness external | Audience export is PII-sensitive; field allowlist exists; per-user granular PII permission absent | `cache: no-store` in shared JSON call | Shared base/token client family with Copilot; audience-specific client | Medium/high due analytical contracts | 3 — configurable/wired; disabled and unconfigured locally; live/productive use **UNVERIFIED** | KEEP + HARDEN |
| Marketing Copilot | Marketing/Customer Intelligence | Copilot questions, sessions, messages, refresh/reset, delete and export | Copilot backend session/answer authority; CRM owns only BFF boundary | Whether same deployment as Profile/CI **UNVERIFIED** | Marketing Copilot workspace | `/api/marketing/copilot/**` | `lib/customer-intelligence/copilotClient.ts` | Copilot one-shot, session create/message/refresh/reset/delete/export | Provider health, session listing or audit endpoints not consumed; inventory **UNVERIFIED** | v1 | No explicit CRM runtime response schema version found | `x-internal-copilot-token`; server-side only | No; middleware/BFF | 30s default | No client retry | Session UUID, but no explicit command idempotency contract | Session ID; no optimistic version exposed | No consistent correlation header | Not consumed | Not consumed | Disabled/not-configured/timeout/unavailable; response body mostly typed cast | Safe HTTP errors; unavailable is surfaced, not replaced with fixture by client | UI context/session IDs; provider provenance **UNVERIFIED** | Session continuity delegated upstream; freshness **UNVERIFIED** | Questions/session/export may contain customer PII; export boundary requires hardening | `no-store` | Shares backend caller/config with dashboard/audiences | High session coupling | 3 — configurable/wired; disabled and unconfigured locally; live/productive use **UNVERIFIED** | KEEP + HARDEN |
| Quote Service | Quotes | Authoritative quote aggregate, number, pricing snapshot, validity, issue artifacts and delivery requests | Quote Service | External deployment **UNVERIFIED** | Agent capability gateway; opportunity read model consumes a local locator/projection | No direct UI-to-service route identified | `lib/integrations/quote-service/httpQuoteServiceAdapter.ts` | Create, update draft, issue, send email, get by ID/number, delivery by ID/list | List, accept, mark-paid, cancel, expire, revisions, documents/audit and document-by-reference are documented historically but external availability **UNVERIFIED** | v1 | Quote domain types; adapter contract documented as v2.0-era boundary | Bearer token | No | 5s default | Adapter none; capability gateway max retries on selected operations | `Idempotency-Key` on mutations; deterministic capability keys | `expectedVersion` on update/issue; fresh get before issue/send | Correlation in request source/body, not a dedicated header | Not consumed | No Quote readiness call | Auth/validation/not-found/conflict/invalid-transition/upstream/timeout/malformed/not-configured | Retryable upstream/timeout; 202 email means requested/pending, not sent | Quote response and capability evidence; CRM stores locator subset | Quote Service authoritative; local projection can be stale | Customer snapshot, recipient email and quote data; adapter sanitizes messages | No shared cache | No duplicate HTTP client found; local `crm_*` quote locator is a second representation | High transactional coupling | 4 — integration-tested/wired; local config absent; live/productive use **UNVERIFIED** | KEEP + HARDEN |
| Customer Service | Identity | Resolve/create/link canonical customer identity and external identities | Customer Service by contract; local `master_customer` is intended projection/read model | External deployment unavailable in active release; live reachability **UNVERIFIED** | Onboarding/capability runtime; local customer UI also has legacy direct write | No route identified that uses adapter; `POST /api/customers` directly writes local DB | `lib/integrations/customer-service/http-adapter.ts`; `lib/domains/customer-service/service.ts` | Resolve, create, link external identity | Unlink/readiness/live endpoint inventory **UNVERIFIED** | v1 | `docs/integrations/customer-service-http-contract.md` v2.0.0 | `x-api-key` | No | 5s default | Adapter none; gateway owns retryability | `Idempotency-Key` on governed mutations | Customer master ID and operation idempotency; no remote version shown | No dedicated correlation header | Not consumed | No remote readiness call; release is `PAUSED_EXTERNAL` | Invalid/conflict/temporarily unavailable/failed/not-configured; payload fail-closed | Typed unavailable; no silent local remote-equivalent fallback | `customerMasterId` and operation result; local projection reference | External authority current; local projection may lag | Identity/consent data; adapter redacts provider payloads | No shared cache | Adapter vs direct local customer writer | Critical authority coupling | 4 — integration-tested/wired in runtime; external configuration/deployment unavailable; productive use **UNVERIFIED** | REFACTOR |
| Carrier Service | Shipping calculation | Coverage, carriers, service options, cost and estimated delivery | Carrier Service for calculation/options; CRM owns destination input; fulfillment authority not present | External deployment **UNVERIFIED** | Agent `calculate_shipping` capability; no direct UI consumer found | None identified | `lib/integrations/carrier-service/httpCarrierServiceAdapter.ts` | `GET /api/pc-carrier/carrier/v1/all` with destination/weight/receipt total and fixed dimensions | Pickup, fulfillment, selection persistence and tax metadata not exposed by this CRM boundary; inventory **UNVERIFIED** | v1 | Carrier option parser; domain port | No auth header in adapter; code comment records unauthenticated provider contract | No | 5s default | No adapter retry | Read-only calculation; no idempotency needed | None | None | Not consumed | Not consumed | Invalid/empty coverage/unavailable/timeout/malformed | Empty options is no-coverage business result; unavailable is typed | Input destination/weight/receipt total; provider option response | Calculation time only; freshness **UNVERIFIED** | Destination and commercial totals; no direct customer profile payload | No shared cache | Local logistics DB is a separate resolver, not duplicate HTTP client | Medium/high agent coupling | 4 — integration-tested/wired to capability; reachability/productive use **UNVERIFIED** | KEEP + HARDEN |
| Meta / WhatsApp | Channel platform | Inbound webhook verification, outbound messages and delivery statuses | Meta provider for provider IDs/status; CRM outbox and normalized inbound/delivery projections | Meta Graph external; account/deployment **UNVERIFIED** | Webhook route, outbox worker, manual/test transport and channel UI | `/api/integrations/whatsapp/webhook`; gated send-test route | `lib/brain/messaging/metaClient.ts`; `whatsapp-transport/**`; outbox worker | Graph `/messages`; inbound/status webhook | Other Meta Graph APIs not consumed | Graph version configured in client (default v25.0) | CRM inbound/outbound/delivery state types | Bearer access token; HMAC webhook signature; verify token | Provider endpoint never browser-called | 8s default, clamped 1–30s | Direct client none; worker/outbox controls attempts | Outbox dedupe/idempotency; transport abstraction has idempotency key | Delivery/provider message IDs; no general CAS | Request/provider IDs vary by path | No process live call | Meta config check only, not provider readiness | Disabled/missing config/allowlist/provider/network/timeout; webhook rejects invalid signatures | Outbox preserves pending/failure states; no claim that request means delivery | Provider message ID, webhook status, timestamps | Delivery is asynchronous; freshness event-based | Messages may contain customer PII; webhook HMAC is strong boundary; response sanitization needs review | No shared response cache | Direct Meta client plus transport abstraction | High channel coupling | 4 — tested/wired; actual provider reachability/productive traffic **UNVERIFIED** | CONSOLIDATE |
| Payments / Mercado Pago | Payments | Payment link, checkout, payment status and reconciliation | None connected in current CRM | **UNVERIFIED / not present** | Opportunity stage labels only | None | None found | None | Entire payment endpoint inventory **UNVERIFIED** | None | None | None | No | None | None | None | None | None | None | None | None | None | None | None | Future PII/financial boundary | None | None | Future | 0 — NOT IMPLEMENTED | FUTURE |

**[CONFIRMED]** PrestaShop mirror, n8n views and the PC/POS logistics DB are local/legacy dependencies, not additional HTTP microservice integrations. They are listed in the detailed sections where they affect authority or layering.

## 5. Catalog Service

### Current boundary and consumers

**[CONFIRMED]** The primary adapter is `lib/catalog/httpCatalogAdapter.ts`, created through `lib/catalog/index.ts`. It requires `CATALOG_SERVICE_BASE_URL` and `CATALOG_SERVICE_API_KEY`; without them `createCatalogPort()` returns no port rather than switching to SQL or a local snapshot. The console also creates `lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts` against the same configured service.

**[CONFIRMED]** Current Catalog operations are:

- `GET /v1/products/search`
- `GET /v1/products/:productId`
- `POST /v1/products/batch`
- `POST /v1/products/explore`
- `POST /api/v2/catalog/resolve-product-intent`
- `GET /v1/products/:productId/semantics`
- `POST /v1/products/semantic-discovery/query`
- `GET /v1/products/semantics/registry`
- `GET /v1/products/training-semantics/registry`
- V2 recommendation search: `POST /api/v2/recommendations/search-products`

The Catalog console path is:

```text
CatalogConsole.tsx
  → /api/catalog/products/search or /api/catalog/products/:productId/context
  → catalog console service
  → CatalogPort + SearchProductsV2 client
  → Catalog Service
```

The agent/quote path is:

```text
agent capability / quote assembly
  → CatalogPort
  → Catalog Service
```

**[CONFIRMED]** `getCatalogConsoleProductContextWithLimit` calls detail, V2 recommendations and semantics in parallel and preserves warnings/degraded recommendation information. The current code therefore wires V2 recommendations even though `docs/integrations/catalog-search-products-v2-client.md` still says `implemented_not_wired`; the document is stale relative to runtime code.

### Transport and contract behavior

**[CONFIRMED]** The adapters use native `fetch`, `AbortController`, server-side `x-api-key`, correlation IDs and runtime response parsing. Default timeouts are 5 seconds for the primary adapter and 3 seconds for the V2 recommendation client. Each adapter makes one physical call and does not retry; comments assign retry ownership to a gateway/orchestrator.

**[CONFIRMED]** Provider statuses and malformed responses are mapped to closed CRM outcomes such as `invalid_input`, `unauthorized`, `rate_limited`, `not_found`, `unavailable`, `invalid_response`, `timeout`, `network_error` and configuration errors. Errors redact API keys/Bearer values.

**[CONFIRMED]** Responses carry Catalog provenance (`source`, retrieval time and cache state), and semantic endpoints retain execution/degradation/registry information. Snapshot/ontology/training versions are parsed and pinned where the contract requires them.

**[UNVERIFIED]** CRM does not call a Catalog live/ready endpoint. No external deployment, actual API version rollout, cache behavior or production traffic was validated from this checkout.

### Assessment

- `IMPLEMENTED`: **CONFIRMED**.
- `WIRED`: **CONFIRMED** for UI, quote assembly and agent tools.
- `CONFIGURED`: **CONFIRMED false/absent in this local checkout**; deployment configuration **UNVERIFIED**.
- `VALIDATED`: **CONFIRMED** by controlled HTTP adapter tests.
- `REACHABLE`: **UNVERIFIED**.
- `PRODUCTIVELY USED`: **UNVERIFIED**.
- Maturity: **4 — INTEGRATION TESTED** at the CRM adapter layer.
- Decision: **KEEP + HARDEN**. Consolidate the shared service policy and remove contract/document drift; retain separate API-generation types only where the remote contracts genuinely differ.

## 6. Customer Profile / Customer Intelligence / Audiences

### Separation of concepts

**[CONFIRMED]** The CRM distinguishes:

- `Customer`: identity/read model and local customer UI data.
- `Customer 360`: local CRM composition of customer, conversations, opportunities and related operational facts.
- `Customer Profile`: external profile/commercial history/behavior/RFM contract consumed by agent context.
- `Customer Intelligence`: external analytical dashboard and segmentation APIs.
- `Audience`: an external evaluation/export operation based on a versioned audience definition; CRM does not persist the audience as a local authority.

**[INFERRED]** These should remain separate ownership boundaries. A local Customer 360 view may compose them, but it must not become authoritative for profile, analytical population, or audience evaluation facts.

### Customer Profile generations

**[CONFIRMED]** The legacy client in `lib/customer-profile/httpCustomerProfileAdapter.ts` targets purchased products and purchase behavior using `CUSTOMER_PROFILE_SERVICE_*`, optional API key auth and `x-correlation-id`. Repository search found no current productive caller; a guard test protects the current context from importing it.

**[CONFIRMED]** The current client in `lib/integrations/customer-profile/http-client.ts` is used by the agent customer-profile capability context. It uses `CUSTOMER_PROFILE_ENABLED`, `CUSTOMER_PROFILE_BASE_URL`, `CUSTOMER_PROFILE_AUTH_TOKEN`, Bearer auth, `x-service-name`, optional `x-request-id`, strict schemas and provenance/contract checks. It exposes profile, commercial summary, purchased products, purchase behavior, order status, RFM and a `health/ready` method.

**[CONFIRMED]** Both clients are read-only and make no adapter retry. They differ in configuration family, auth, timeout default, error taxonomy and endpoint coverage. This is a duplicate contract generation, not merely a different domain projection.

### Customer Intelligence and Audiences

**[CONFIRMED]** Dashboard calls use `lib/customer-intelligence/dashboardClient.ts` and share the Copilot backend base URL/configuration. They cover context, overview, RFM, clusters and intersections. The dashboard proxy validates top-level query/body constraints but casts the analytical filter tree rather than fully validating it at runtime.

**[CONFIRMED]** Audience calls use `lib/customer-intelligence/audienceClient.ts` and cover schema, evaluate and export. They use distinct evaluate/export/PII-export tokens, an audience definition version (`customer-intelligence-audience-definition-v1`), server-side field allowlists and explicit operator authentication on audience routes. CRM does not persist the evaluated population.

**[CONFIRMED]** Audience export is PII-sensitive. The current route has a field allowlist and operator gate, but repository comments explicitly state there is no granular PII permission model beyond the operator session and server allowlist.

**[UNVERIFIED]** The code comment describing Customer Profile, Marketing Copilot and Dashboard as sharing an `MS-pesaschile-customer-profile` instance does not prove deployment identity. The external repository/deployment topology and whether Audiences runs in the same process, service or deployment are not available.

### Assessment

- Customer Profile current client: `IMPLEMENTED` and `WIRED` **CONFIRMED**; `CONFIGURED`, `REACHABLE` and `PRODUCTIVELY USED` **UNVERIFIED/false locally**; maturity **4 — INTEGRATION TESTED**; decision **CONSOLIDATE** because the legacy client must be retired and the service contract owner must be made explicit.
- Customer Intelligence/Audiences: `IMPLEMENTED`, `WIRED` and configurable route boundaries **CONFIRMED**; response/runtime and live deployment validation **UNVERIFIED**; maturity **3 — CONFIGURABLE**; decision **KEEP + HARDEN**.
- Customer 360 local read model: **CONFIRMED** as CRM-owned composition, not a substitute for external Profile/Intelligence authority.

## 7. Marketing Copilot

### Boundary and lifecycle

**[CONFIRMED]** `lib/customer-intelligence/copilotClient.ts` uses `MARKETING_COPILOT_ENABLED`, `MARKETING_COPILOT_BACKEND_BASE_URL`, `MARKETING_COPILOT_INTERNAL_TOKEN` and `MARKETING_COPILOT_TIMEOUT_MS`. It sends `x-internal-copilot-token` server-side, uses `fetch`/`AbortController`, `cache: "no-store"`, a 30-second default timeout and no client retry.

**[CONFIRMED]** The CRM-facing operations are:

- `POST /v1/customer-intelligence/copilot`
- `POST /v1/customer-intelligence/copilot/sessions`
- `POST /v1/customer-intelligence/copilot/sessions/:id/messages`
- `POST /v1/customer-intelligence/copilot/sessions/:id/refresh`
- `POST /v1/customer-intelligence/copilot/sessions/:id/reset`
- `DELETE /v1/customer-intelligence/copilot/sessions/:id`
- `POST /v1/customer-intelligence/copilot/sessions/:id/export`

The CRM route chain is:

```text
MarketingCopilotWorkspace
  → /api/marketing/copilot/**
  → route handler / copilotClient
  → Customer Intelligence / Marketing backend [deployment UNVERIFIED]
```

Session continuity is represented by a provider/session ID and lifecycle calls; CRM does not locally persist the authoritative session transcript. Provider persistence and retention are **UNVERIFIED**.

### Security and validation

**[CONFIRMED]** Next middleware globally protects `/api/**` except explicitly excluded authentication/webhook cases. Copilot handlers do not consistently call `requireOperator` themselves, so direct handler invocation/tests could bypass a defense-in-depth check that browser requests normally receive through middleware.

**[CONFIRMED]** Request validation is partial: question/session identifiers have checks, but some UI context and upstream response objects are typed/cast rather than runtime-schema validated. TypeScript types are not runtime validation.

**[UNVERIFIED]** No CRM evidence establishes the remote provider, model, deployment identity, session persistence, provider exposure, response provenance, or live readiness.

### Assessment

- `IMPLEMENTED`/`WIRED`: **CONFIRMED**.
- `CONFIGURED`: **CONFIRMED false/absent locally**.
- `VALIDATED`: client error paths are covered in CRM code/tests where present; full remote contract validation **UNVERIFIED**.
- `REACHABLE`/`PRODUCTIVELY USED`: **UNVERIFIED**.
- Maturity: **3 — CONFIGURABLE**.
- Decision: **KEEP + HARDEN**. Preserve the BFF boundary, then standardize route-level authorization, runtime response schemas, correlation and export/PII audit semantics.

## 8. Quote Service

### Authority and consumed surface

**[CONFIRMED]** `lib/integrations/quote-service/httpQuoteServiceAdapter.ts` is the current external boundary. `lib/domains/quote-service/ports.ts` exposes:

- `POST /v1/quotes` — create draft.
- `PUT /v1/quotes/:id/draft` — update draft.
- `POST /v1/quotes/:id/issue` — issue and generate durable artifacts.
- `POST /v1/quotes/:id/send-email` — request asynchronous delivery.
- `GET /v1/quotes/:id` and `GET /v1/quotes/by-number/:quoteNumber`.
- `GET /v1/quotes/:id/deliveries/:deliveryId` and `GET /v1/quotes/:id/deliveries`.

The CRM capability chain is:

```text
Agent capability gateway
  → quote assembly / local quote locator
  → QuoteServicePort
  → HTTP adapter
  → Quote Service
```

**[CONFIRMED]** Current capability consumers are `create_quote`, `get_quote`, `issue_quote` and `send_quote_email`. No direct React-to-Quote route was found. The opportunity UI reads a CRM projection/locator, not the Quote Service directly.

**[CONFIRMED]** Quote Service is the intended authority for quote ID/number, aggregate status, version, pricing snapshot, validity and issue document artifacts. CRM stores a durable locator/projection for opportunity continuity.

### Transaction semantics

**[CONFIRMED]** The adapter uses Bearer auth, a 5-second default timeout, strict response parsing and no adapter retry. Mutations receive `Idempotency-Key`. The issue capability performs a fresh `getQuote` before issuing and sends `expectedVersion`; issue/email paths use deterministic action idempotency keys. A 202 email result is represented as “delivery requested/pending,” not “email sent.”

**[CONFIRMED]** `create_quote` derives its idempotency key from opportunity and selection fact, assembles prices from Catalog, and persists only a locator subset after the upstream create succeeds. If local persistence fails after upstream creation, it returns a retryable outcome with the same key.

**[CONFIRMED]** The current create path explicitly disables shipping assembly because the Carrier contract does not provide the tax metadata required by quote input assembly. Shipping destination, calculation, selected option and quote shipping line therefore remain separate concerns.

**[CONFIRMED]** Historical integration documentation lists additional Quote Service operations such as list, accept, mark-paid, cancel, expire, revisions, documents and audit. Those are not wrapped by the current CRM port; actual external availability is **UNVERIFIED** without the service source/deployment.

### Assessment

- `IMPLEMENTED`/`WIRED`: **CONFIRMED** for capability runtime.
- `CONFIGURED`: **CONFIRMED false/absent in this checkout**.
- `VALIDATED`: **CONFIRMED** by controlled HTTP adapter tests and capability tests.
- `REACHABLE`/`PRODUCTIVELY USED`: **UNVERIFIED**.
- Maturity: **4 — INTEGRATION TESTED**.
- Decision: **KEEP + HARDEN**. Preserve Quote Service authority; add operational readiness evidence, dedicated correlation propagation and explicit reconciliation semantics for the local locator.

## 9. Customer Service / Identity

### Intended authority

**[CONFIRMED]** `docs/integrations/customer-service-http-contract.md` identifies Customer Service as the sole authority for customer create/link operations. `lib/domains/customer-service/service.ts` derives deterministic operation idempotency keys from the capability execution context. `lib/integrations/customer-master/customer-repository.ts` is intended as a local projection reader in the governed path.

**[CONFIRMED]** The adapter supports:

- `POST /v1/customers/resolve`
- `POST /v1/customers`
- `POST /v1/customers/:customerId/external-identities`

It uses `x-api-key`, JSON, `Idempotency-Key` for mutations, 5-second timeout, strict payload checks and typed mapping for validation, conflict, unavailable, timeout and not-configured states. It does not retry physically; capability/gateway policy owns retryability.

### Direct write violation

**[CONFIRMED]** `app/api/customers/route.ts` POST calls the local `lib/domains/customers` repository, which reaches `lib/integrations/customer-master/customer-repository.ts` and performs a direct SQL `INSERT INTO master_customer` when `DB_WRITE_ENABLED` permits it. That path does not call the Customer Service adapter.

**[CONFIRMED]** This contradicts the declared Customer Service authority and the release/contract statements that CRM should not create the master directly.

**[INFERRED]** The direct endpoint is either an unretired legacy/manual operator path or an accidental second authority. In both cases it must not remain ambiguous: a local projection writer and a remote identity authority cannot both silently create canonical customers.

### Operational state

**[CONFIRMED]** `docs/ACTIVE_RELEASE.md` marks Customer Service external deployment as paused/unavailable for the active release. The local `.env` snapshot has no Customer Service base URL/key. This explains why integration tests use controlled local HTTP contracts; it does not prove the external service is globally down.

- `IMPLEMENTED`/runtime `WIRED`: **CONFIRMED** for the governed capability path.
- `CONFIGURED`, `REACHABLE`, `PRODUCTIVELY USED`: **UNVERIFIED/false locally**.
- `VALIDATED`: **CONFIRMED** by adapter and controlled-contract tests.
- Maturity: **4 — INTEGRATION TESTED**.
- Decision: **REFACTOR**. Make authority singular, then expose unavailable/conflict outcomes honestly to UI/runtime.

## 10. Carrier / Shipping

### Separate shipping concepts

**[CONFIRMED]** Current code separates:

- durable shipping destination in the CRM commercial domain;
- Carrier Service calculation and options;
- selected shipping option persistence in CRM;
- Quote Service shipping line, currently not assembled by `create_quote`;
- fulfillment/pickup, for which no complete external boundary was identified.

**[CONFIRMED]** `lib/integrations/logistics/pc-pos-adapter.ts` resolves communes from a local logistics/POS DB. It is not the Carrier Service HTTP adapter. `lib/integrations/carrier-service/httpCarrierServiceAdapter.ts` is the external calculator used by the `calculate_shipping` agent capability.

### Adapter behavior

**[CONFIRMED]** Carrier calls:

```text
GET /api/pc-carrier/carrier/v1/all
  ?destino=<canonical commune>
  &alto=1&ancho=1&largo=1
  &kilos=<weight>
  &total_boleta=<receipt total>
```

It parses carrier name, service type, cost and estimated delivery. A valid empty `options` list is a no-coverage result; malformed responses and provider failures become typed unavailable/invalid outcomes. The adapter has a 5-second timeout, no auth header, no retry, no correlation header and no idempotency header.

**[UNVERIFIED]** The code comment records the unauthenticated provider contract, but live exposure, network policy, service ownership, tax semantics, pickup/fulfillment support and deployment health could not be independently verified.

- `IMPLEMENTED`/`WIRED`: **CONFIRMED** to agent capability.
- Direct WebApp UI consumer: **not found** in current source.
- `CONFIGURED`, `REACHABLE`, `PRODUCTIVELY USED`: **UNVERIFIED**.
- `VALIDATED`: **CONFIRMED** by controlled adapter tests.
- Maturity: **4 — INTEGRATION TESTED**.
- Decision: **KEEP + HARDEN**. Require explicit service identity, network/auth decision, correlation, freshness and a closed tax/quote-line contract before widening usage.

## 11. Payments

**[CONFIRMED]** No current CRM module was found for Mercado Pago or another payment service: no adapter, route handler, payment link, checkout client, signed payment webhook, payment status projection, idempotency contract or reconciliation worker was identified.

**[CONFIRMED]** `checkout_support`, `purchase_intent` and `quote_pending` occur as opportunity stage labels and customer-purpose values. They are domain states, not payment integration evidence.

**[UNVERIFIED]** A payment service may exist outside the inspected workspace, but no repository evidence connects it to this WebApp.

- Maturity: **0 — NOT IMPLEMENTED**.
- Decision: **FUTURE**.
- Scope boundary: inventory only; this audit does not design a Payment Service or payment contract.

## 12. Messaging / channel boundaries

### WhatsApp / Meta

**[CONFIRMED]** `app/api/integrations/whatsapp/webhook/route.ts` owns the public Meta webhook boundary. GET verifies the Meta verify token; POST verifies `x-hub-signature-256` with the configured app secret, rejects invalid/missing signatures in production, normalizes inbound messages/status callbacks and applies delivery status updates.

**[CONFIRMED]** Outbound delivery uses `lib/brain/messaging/metaClient.ts` and the outbox worker. The Graph endpoint is `https://graph.facebook.com/{version}/{phoneNumberId}/messages`, with Bearer access token, an 8-second default timeout and no direct client retry. The outbox persists dedupe keys, provider message IDs and delivery outcomes. The separate `whatsapp-transport/**` abstraction carries request/idempotency information and has its own status classification.

**[CONFIRMED]** The public webhook route is intentionally outside the normal browser/operator middleware because Meta must reach it; cryptographic signature verification is therefore the primary boundary. The send-test route has an explicit gate and disabled-by-default behavior.

**[INFERRED]** Direct `metaClient` plus `whatsapp-transport` represent two generations of transport policy. They may be layered implementations, but ownership of retry, idempotency, safe provider error handling and observability should be consolidated to one explicit transport contract.

### Email and other channels

**[CONFIRMED]** Quote email is delegated to Quote Service via `send_quote_email`; CRM does not expose a second SMTP/provider client for that operation. No independent general email integration or additional channel provider was identified in the audited surface.

### Assessment

- Messaging integration: `IMPLEMENTED`, `WIRED`, `VALIDATED` **CONFIRMED** in CRM tests/code.
- Actual Meta account reachability and productive traffic: **UNVERIFIED**.
- Maturity: **4 — INTEGRATION TESTED**.
- Decision: **CONSOLIDATE** the transport policy while preserving the webhook/outbox ownership split.
- Cognitive agent behavior is intentionally outside this section and was not audited as a channel integration.

## 13. Cross-service inconsistencies

### Configuration

**[CONFIRMED]** Configuration families vary:

- Catalog: `*_BASE_URL`, `*_API_KEY`, `*_TIMEOUT_MS`, plus V2-specific timeout.
- Customer Profile current: `CUSTOMER_PROFILE_ENABLED`, `BASE_URL`, `AUTH_TOKEN`, timeout.
- Customer Profile legacy: `CUSTOMER_PROFILE_SERVICE_BASE_URL`, `SERVICE_API_KEY`, timeout.
- Copilot/CI: enabled flag, shared backend URL, internal token, timeout.
- Audiences: separate enabled and evaluate/export/PII token variables, reusing the Copilot timeout.
- Quote: base URL, Bearer auth token, timeout, but no explicit enabled flag.
- Customer Service: base URL, API key, timeout.
- Carrier: base URL and timeout, with no auth configuration.
- Meta: several historical token/phone-number/verify-token names and feature flags.

**[INFERRED]** Presence-based configuration for Quote and the disabled-flag model for Profile/Copilot/Audiences can produce different “unavailable” behavior for equivalent operational failures. A future standard should normalize configuration metadata without forcing every service to have identical flags.

### HTTP behavior and validation

**[CONFIRMED]** The current code consistently uses native `fetch` and `AbortController`; no axios dependency or browser-to-provider client was identified. However, headers, timeout defaults, correlation naming, response parsing and error types differ materially.

**[CONFIRMED]** Catalog, current Customer Profile, Quote, Customer Service and Carrier perform meaningful runtime parsing. Copilot and portions of Dashboard pass upstream JSON through typed casts; this is not runtime validation. Audience validates request shape more strongly than all response shapes.

### Errors and degradation

**[CONFIRMED]** Catalog and Quote retain relatively closed error taxonomies. Customer Service distinguishes conflict/unavailable. Carrier distinguishes no coverage from technical failure. Copilot/Dashboard routes normalize HTTP errors but do not retain a complete provider contract taxonomy. No universal mapping exists for all of `400/401/403/404/409/422/429/500/502/503/504`, timeout, network failure and schema mismatch.

**[INFERRED]** A single generic `500` at a route boundary would destroy important business distinctions such as no coverage, not configured, conflict, retryable upstream failure and malformed provider response. The current adapter work is directionally correct but not transversal.

### Health model

**[CONFIRMED]** Customer Profile has a `health/ready` client method, but CRM system health does not call it. There is no equivalent Catalog/Quote/Customer Service/Carrier live/ready aggregation in `getSystemHealth()`.

**[CONFIRMED]** `/api/system/health` is operator-protected and reports local DB, open cases, inbound/outbound, Meta configuration, PrestaShop identity source, DB writer and n8n. It is not a microservice registry.

**[INFERRED]** `configured`, `reachable`, `ready`, `available`, `degraded` and capability-level unavailable must remain separate states. A process health result cannot certify every business capability.

### Retry and idempotency

**[CONFIRMED]** Adapters generally make one physical call and delegate retry to a gateway/orchestrator. Quote capabilities and workers have selected retries; direct BFF Copilot/CI/Audience calls do not show a shared retry layer. Meta outbox attempts are separate from the provider client.

**[CONFIRMED]** Quote and Customer Service mutations have idempotency headers. Meta has durable outbox dedupe. Catalog, Carrier, Copilot and Dashboard are mostly read-only; audience export/evaluate command semantics are not represented by a common CRM idempotency contract.

**[INFERRED]** The main risk is not adapter retry stacking today; it is inconsistent ownership and unclear behavior after a mutation timeout. Each command boundary needs explicit “unknown outcome” semantics.

### Correlation and observability

**[CONFIRMED]** Catalog uses `x-correlation-id`; current Customer Profile uses `x-request-id`; legacy Profile uses `x-correlation-id`; Quote carries correlation in the source/body; Customer Service and Carrier have no dedicated correlation header; Copilot/CI/Audiences do not consistently propagate one; Meta paths expose provider message/request IDs differently.

**[INFERRED]** Cross-service traces cannot be reconstructed uniformly from current headers alone. Correlation should be a required CRM-side field with service-specific propagation rules.

### Security and PII

**[CONFIRMED]** Provider credentials are server-side in the audited BFF/adapter paths. Meta webhook uses HMAC verification. Audience exports use operator auth, separate backend tokens and field allowlists.

**[CONFIRMED]** Audience comments identify a missing granular PII permission model. `metaClient` response sanitization returns a provider record rather than demonstrating field-level redaction, so provider error payload exposure should be reviewed before treating it as safe by default.

**[INFERRED]** PII classification, retention, export authorization and audit should be mandatory per operation, not inferred from service name or route location.

## 14. Duplicate clients and contracts

| Area | Current duplicate or drift | Evidence | Risk | Decision |
|---|---|---|---|---|
| Catalog | `CatalogPort`/HTTP adapter plus separate Search Products V2 client point to the same configured service | `lib/catalog/httpCatalogAdapter.ts`; `lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts`; console calls both | Different headers, timeout, error and contract policy for one owner | CONSOLIDATE |
| Catalog documentation | V2 integration document says `implemented_not_wired`, while console service calls it | `docs/integrations/catalog-search-products-v2-client.md` versus `lib/catalog/consoleService.ts` | Operators and future refactors may make the wrong decision | REFACTOR |
| Customer Profile | Legacy `lib/customer-profile` versus current `lib/integrations/customer-profile` | Two env families, auth schemes, endpoint sets and response contracts | Wrong client import, identity/provenance drift, dead code | REMOVE |
| Customer Profile / Intelligence config | `CUSTOMER_PROFILE_*`, `CUSTOMER_PROFILE_SERVICE_*` and `MARKETING_COPILOT_*` imply different owners while comments suggest shared service instance | Client config files and comments | Deployment/ownership ambiguity | CONSOLIDATE |
| Marketing/Copilot responses | Dashboard/Copilot JSON calls share transport but do not share full runtime response validation | `copilotClient.ts`, `dashboardClient.ts` | Same backend can fail with different semantics across consumers | CONSOLIDATE |
| Meta transport | Direct `metaClient` plus `whatsapp-transport/**` both encode provider transport policy | `lib/brain/messaging/metaClient.ts`; `lib/brain/messaging/whatsapp-transport/**` | Retry, idempotency and safe error policy can diverge | CONSOLIDATE |
| Customer identity | Customer Service adapter/domain path plus direct `/api/customers` local SQL writer | `lib/integrations/customer-service/**`; `app/api/customers/route.ts`; `customer-master/customer-repository.ts` | Two canonical-create authorities | REFACTOR |
| Logistics naming | Local PC/POS logistics resolver and external Carrier Service both participate in shipping-related flows | `lib/integrations/logistics/**`; `lib/integrations/carrier-service/**` | A local destination resolver may be mistaken for a carrier integration | KEEP + HARDEN |
| Quote data | Quote Service aggregate plus CRM `created_quote` locator/projection | Quote adapter and `lib/domains/created-quote` | Stale local status could be treated as authoritative | KEEP + HARDEN |

**[INFERRED]** Consolidation means one owner and one explicit policy contract, not necessarily one TypeScript file or one generic HTTP abstraction. Separate API generations should remain separately typed if the remote contracts are genuinely distinct.

## 15. Authority matrix

| Data/object | Current owner evidenced in CRM | CRM role | Target owner | Decision/evidence |
|---|---|---|---|---|
| Customer Identity | Customer Service by contract; local `master_customer`/external identity tables are provisional/projection surfaces | Resolve context, local read model, legacy direct create | Customer Service | **[CONFIRMED]** authority contract; **[CONFIRMED]** direct write violation; REFACTOR |
| Customer Profile | Customer Profile service for returned profile/history/RFM facts | Agent context projection/summary | Customer Profile service | **[CONFIRMED]** current client contract; identity namespace semantics **UNVERIFIED** |
| Customer 360 | CRM local composed read model | UI composition across customer/conversations/opportunities | CRM composition, never a domain authority for external facts | **[INFERRED]** from local domain/read models |
| Product | Catalog Service | Lookup, batch and semantic product data | Catalog Service | **[CONFIRMED]** Catalog adapter and quote assembly |
| Stock | Catalog Service contract where supplied | Display/quote input; no local authoritative stock | Catalog Service | **[CONFIRMED]** business facts come from Catalog tools; exact live stock semantics **UNVERIFIED** |
| Price | Catalog Service | Quote assembly consumes Catalog pricing/tax metadata | Catalog Service | **[CONFIRMED]** quote assembly rejects missing/incomplete price metadata |
| Recommendation | Catalog Service for product recommendations; analytical recommendations may be external CI if separately contracted | UI/agent result projection | Explicit owning service per endpoint; Catalog for current recommendation endpoints | **[CONFIRMED]** current endpoint; broader recommendation ownership **UNVERIFIED** |
| Audience | Customer Intelligence/Audience backend | Definition request, evaluate/export BFF; no local population persistence | Customer Intelligence/Audience backend | **[CONFIRMED]** audience client and no local authority |
| Quote | Quote Service | Local `created_quote` locator and UI summary | Quote Service | **[CONFIRMED]** adapter/capability description |
| Shipping destination | CRM commercial domain durable destination | Captures customer/opportunity input | CRM until a separate address authority is contracted | **[CONFIRMED]** current destination domain; do not conflate with calculation |
| Shipping calculation/options | Carrier Service | Agent capability result; optional local selected option | Carrier Service for calculation; CRM only for selected reference | **[CONFIRMED]** carrier port and selected-option domain |
| Fulfillment | No complete owner identified | None beyond carrier calculation | **UNVERIFIED / future boundary** | **[UNVERIFIED]** no fulfillment contract in inspected runtime |
| Payment | None connected | Opportunity stages only | Future payment service | **[CONFIRMED]** no adapter/routes/webhook; FUTURE |
| Agent Configuration | CRM local domain today, future R4 surface not stabilized | Existing CRM screens/runtime | Deferred | PENDING R4; no target integration designed |
| Agent Follow-ups | CRM/R1-R3 structures today | Existing operational surfaces | Deferred | PENDING R4; no target integration designed |
| Agent Activity future | Not a stable external authority in this audit | Existing/history surfaces may exist | Deferred | PENDING R4; no target integration designed |

## 16. WebApp layering problems

### Confirmed or strongly evidenced problems

1. **[CONFIRMED] Direct canonical customer write:** `POST /api/customers` reaches SQL `master_customer` instead of the Customer Service boundary. This is an authority/data-integrity problem, not merely a style issue.
2. **[CONFIRMED] Status surface disconnected from services:** `/integrations` calls `getIntegrationsViewModel()` from `lib/p1m/read-models` and renders a fixture badge; it does not call `/api/system/health` or remote health endpoints.
3. **[CONFIRMED] Local system health is over-named for the external integration question:** `getSystemHealth()` reports local/legacy dependencies and Meta configuration, not remote microservice readiness.
4. **[CONFIRMED] Duplicate service-specific transport policies:** Catalog, Profile, Copilot, Quote, Customer Service, Carrier and Meta each implement slightly different combinations of timeout, headers, parsing and errors.
5. **[CONFIRMED] Response validation gap:** Copilot/Dashboard code casts some upstream JSON to TypeScript shapes without equivalent runtime schema validation.
6. **[CONFIRMED] Correlation propagation gap:** the same conceptual request can use `x-correlation-id`, `x-request-id`, a body field or no dedicated header depending on service.
7. **[CONFIRMED] Boundary naming ambiguity:** local logistics DB, PrestaShop mirror, n8n legacy views and external services are all integration-shaped modules, but only some are microservice boundaries. This increases accidental coupling risk.
8. **[CONFIRMED] Historical contract drift:** the Catalog V2 document says not wired while current console code wires it.

### Things not found

- **[CONFIRMED]** No React direct call to an external microservice URL was found in the audited app/components surface.
- **[CONFIRMED]** No browser-visible provider API key, Bearer token or internal Copilot token was found in the audited BFF paths.
- **[CONFIRMED]** No `page.tsx → external fetch` path was found for the audited microservices; server pages call CRM domain/read-model functions.
- **[CONFIRMED]** No direct SQL access to an external microservice database was identified. Local/legacy DB reads are separate concerns and must not become external contracts.

## 17. Integration maturity matrix

| Integration | Level | Evidence supporting level | State distinctions |
|---|---:|---|---|
| Catalog primary + V2 | 4 — INTEGRATION TESTED | Current adapters, UI/runtime wiring and controlled HTTP tests | `IMPLEMENTED`/`WIRED`/`VALIDATED` confirmed; local `CONFIGURED` false; `REACHABLE` and `PRODUCTIVELY USED` unverified |
| Customer Profile current | 4 — INTEGRATION TESTED | Current client, agent capability wiring, schemas and client tests | `IMPLEMENTED`/`WIRED`/`VALIDATED` confirmed; enabled/base/token absent locally; live/productive unverified |
| Customer Profile legacy | 1 — CODE EXISTS | Adapter and tests/comments exist; no productive caller found | Not wired/productive; target `REMOVE` |
| Customer Intelligence Dashboard | 3 — CONFIGURABLE | Client, BFF routes, filter contracts and env family exist | Wired/configurable code confirmed; upstream response/live validation unverified |
| Audiences | 3 — CONFIGURABLE | Client, BFF routes, request allowlists, versions and token families exist | Disabled/unconfigured locally; external reachability/productive export unverified |
| Marketing Copilot | 3 — CONFIGURABLE | Client, lifecycle routes and UI consumers exist | Disabled/unconfigured locally; remote persistence/readiness/productive use unverified |
| Quote Service | 4 — INTEGRATION TESTED | Adapter, capability wiring, strict parser and controlled HTTP tests | Config absent locally; live/productive use unverified |
| Customer Service | 4 — INTEGRATION TESTED | Adapter/domain path and controlled-contract tests | Active release externally blocked; direct local writer remains; reachability/productive use unverified |
| Carrier Service | 4 — INTEGRATION TESTED | Adapter, capability wiring and HTTP tests | No auth/correlation/readiness; live/productive use unverified |
| Meta / WhatsApp | 4 — INTEGRATION TESTED | Webhook signature tests, client/outbox/transport wiring | Actual Meta account reachability and productive traffic unverified |
| Payments / Mercado Pago | 0 — NOT IMPLEMENTED | No adapter, route, webhook, provider config or worker found | `NOT CONNECTED`; target `FUTURE` |
| `/integrations` status page | 1 — CODE EXISTS | Page/read model exists and is explicitly fixture/partial | Not an operational integration health surface |

**[CONFIRMED]** Level 4 is the highest defensible general level from this checkout. No integration was assigned Level 5 or 6 because no live external validation or productive-traffic evidence was available.

## 18. Target integration architecture

The following is a target boundary model, not an implementation change:

```text
Browser
  │  session/operator auth only; no provider secrets
  ▼
CRM BFF / domain layer
  │
  ├── typed read/query boundary ───────> Catalog Service
  ├── typed profile context boundary ──> Customer Profile
  ├── analytics/audience boundary ─────> Customer Intelligence / Audiences
  ├── copilot session boundary ────────> Marketing Copilot
  ├── governed command boundary ───────> Quote Service
  ├── governed identity command ───────> Customer Service
  ├── shipping calculation boundary ───> Carrier Service
  ├── channel transport/outbox ────────> Meta / Email owners
  └── future payment boundary ─────────> Payment Service [FUTURE]

Each service-specific boundary carries:
  ServiceIdentity + configuration state
  authenticated request + request/correlation identity
  timeout + retry/unknown-outcome policy
  command idempotency where applicable
  runtime request/response validation
  normalized error + degraded state
  provenance + freshness
  PII classification + audit/metrics metadata

Local CRM read models compose facts but do not silently become owners.
Remote service internal SQL is never a contract.
R4 is not designed here; its listed surfaces remain PENDING R4.
```

**[INFERRED]** This architecture preserves the clean parts already present—server-side BFF, typed ports, governed commands and local composition—while making authority, availability and evidence explicit.

## 19. Proposed CRM External Service Integration Standard

This section is design-only; no standard was implemented in this audit.

Every new external integration should declare the following contract record:

1. **ServiceIdentity:** stable logical owner, domain, environment, API generation, contract version and deployment identity. Do not infer service identity from a UI folder or a shared base URL.
2. **Configuration:** required/optional variables, enabled semantics, safe configuration status and secret source. Names should distinguish `BASE_URL`, credential type, timeout and feature capability.
3. **Authentication:** auth scheme, server-only rule, rotation expectation, trusted-header policy and whether a public webhook uses signature verification.
4. **Request identity:** request ID, correlation ID and optional causation/trace ID. Define which header/body field is propagated to the service and provider.
5. **Timeout:** operation-specific budget, cancellation behavior and whether a timeout leaves a mutation outcome unknown.
6. **Retry policy:** owner of retry, retryable classifications, attempt budget and protection against UI × route × adapter × service retry stacking.
7. **Idempotency semantics:** read retry versus command idempotency, key derivation, scope, retention and behavior when the response is lost after commit.
8. **Runtime validation:** request and response schema validation. TypeScript declarations alone do not satisfy this requirement.
9. **Normalized errors:** preserve status and domain meaning for auth, validation, not found, conflict, rate limit, unavailable, timeout, malformed response and unknown outcome.
10. **Health/readiness:** separate process liveness, readiness, configured, reachable, capability available and degraded. Health checks must not mutate business state.
11. **Provenance/freshness:** source owner, retrieval timestamp, snapshot/feature version, cache state and whether the value is authoritative, derived or a local projection.
12. **Degraded states:** explicit unavailable/no-coverage/partial/stale/unknown-outcome states. Never silently substitute fixtures for a failed remote call.
13. **PII classification:** fields, purpose, minimization, retention, export permission, audit requirement and redaction rule for logs/errors.
14. **Audit and metrics:** operation name, service identity, outcome class, latency, retries, correlation ID, provider ID where safe, and no raw secrets or chain-of-thought.
15. **Consumer boundary:** browser/BFF/domain/capability/worker consumer, route authorization, owner of local persistence and whether the service is read-only or command-capable.
16. **Validation evidence:** controlled HTTP tests, contract fixtures, live smoke evidence where authorized and a clear distinction between `IMPLEMENTED`, `WIRED`, `CONFIGURED`, `REACHABLE`, `VALIDATED` and `PRODUCTIVELY USED`.

**[INFERRED]** The standard should be a set of invariants and per-service policy objects, not a “mega HTTP client.” Native `fetch`, service-specific schemas and service-specific error mapping can remain where they express real contract differences.

## 20. Migration / hardening map

| Component | Current | Target | Decision | Priority | Dependency |
|---|---|---|---|---|---|
| Customer creation route | Direct SQL `master_customer` writer competes with Customer Service | One explicit authority; local DB projection/read path separated from governed create/link | REFACTOR | P0 | Customer Service deployment/contract evidence and operator workflow decision |
| External configuration registry | Service-specific env families and mixed enabled semantics | Per-service configuration contract with safe status | CONSOLIDATE | P1 | Authority and deployment inventory |
| Remote health | Mostly absent from CRM health; local health named broadly | Capability-specific ready/reachable/degraded checks, no mutation | KEEP + HARDEN | P1 | Safe read-only health endpoints and timeout budgets |
| Catalog clients | Primary port plus V2 client with policy drift; stale V2 docs | One owner policy with separate typed API generations where needed | CONSOLIDATE | P1 | Confirm external API generations |
| Customer Profile | Legacy and current clients | Retain one supported client/contract; remove legacy imports/docs after evidence | REMOVE | P1 | Confirm external consumers and deployment contract |
| Copilot/Dashboard responses | Some typed casts/passthrough | Runtime request/response schemas and provenance | KEEP + HARDEN | P1 | Obtain backend schemas/version guarantees |
| Audience export | Operator + field allowlist, no granular PII permission | Explicit export/PII authorization and audit model | KEEP + HARDEN | P0 | Security/product decision on roles and export policy |
| Quote integration | Strong command/idempotency boundary; no live readiness and local locator projection | Keep authority, add correlation/unknown-outcome/reconciliation evidence | KEEP + HARDEN | P1 | Quote Service live contract and deployment evidence |
| Customer Service availability | Controlled tests only; active release externally blocked | Validate deployed service before enabling governed flow | KEEP + HARDEN | P0 | External deployment access |
| Carrier integration | Unauthenticated, no correlation/readiness/tax-complete quote line | Explicit auth/network decision, readiness, freshness and tax contract | KEEP + HARDEN | P1 | Carrier owner contract |
| Meta transports | Direct client and transport abstraction | Single documented transport policy behind webhook/outbox | CONSOLIDATE | P1 | Provider account and channel contract evidence |
| Integrations page | Fixture/partial read model | Evidence-backed operational status view, separate from local health | REFACTOR | P2 | Standard health model and route authorization |
| Payments | No current integration | Leave disconnected until payment authority and provider are authorized | FUTURE | P3 | Explicit future product scope |
| R4 surfaces | Evolving and out of scope | Do not reorganize in this audit | PENDING R4 | P0 boundary | R4 contract stabilization |

## 21. R4 deferred surface

Agent Configuration → `PENDING R4`

Agent Follow-ups → `PENDING R4`

Agent Activity future → `PENDING R4`

## 22. Prioritized findings

### P0 — seguridad / autoridad / data corruption

- **P0-1 — [CONFIRMED]** Direct `/api/customers` SQL creation bypasses Customer Service authority and can create divergent canonical identity records. Decision: **REFACTOR**.
- **P0-2 — [CONFIRMED]** Audience PII export has no granular per-user PII permission beyond operator gate and field allowlist. Decision: **KEEP + HARDEN**.
- **P0-3 — [CONFIRMED]** Customer Service is externally blocked/unconfigured in the active release; enabling customer identity commands without deployment evidence would be unsafe. Decision: **KEEP + HARDEN**.
- **P0-4 — [INFERRED]** A UI that reports integration status from fixture data can create operationally false confidence if interpreted as live health. Decision: **REFACTOR**.

### P1 — arquitectura / contrato / reliability

- **P1-1 — [CONFIRMED]** Customer Profile has duplicate client generations and configuration families. Decision: **CONSOLIDATE** plus legacy **REMOVE** after consumer evidence.
- **P1-2 — [CONFIRMED]** Catalog V2 runtime wiring contradicts its integration document. Decision: **REFACTOR** documentation/contract ownership.
- **P1-3 — [CONFIRMED]** Correlation, timeout, retry and idempotency semantics vary across otherwise similar service boundaries. Decision: **KEEP + HARDEN** via standard.
- **P1-4 — [CONFIRMED]** Copilot/Dashboard response validation is weaker than Catalog/Profile/Quote adapters. Decision: **KEEP + HARDEN**.
- **P1-5 — [CONFIRMED]** No remote readiness model exists for most external services. Decision: **KEEP + HARDEN**.
- **P1-6 — [CONFIRMED]** Carrier has no auth/correlation/readiness contract visible in CRM. Decision: **KEEP + HARDEN**.
- **P1-7 — [INFERRED]** Local quote locator/projection needs explicit stale/unknown-outcome reconciliation rules after mutation timeouts. Decision: **KEEP + HARDEN**.

### P2 — consistencia / observabilidad / UX

- **P2-1 — [CONFIRMED]** `/api/system/health` does not represent external microservice readiness.
- **P2-2 — [CONFIRMED]** `/integrations` is fixture/partial and disconnected from the health endpoint.
- **P2-3 — [CONFIRMED]** Meta transport policies exist in more than one abstraction.
- **P2-4 — [CONFIRMED]** Service-specific freshness/provenance semantics are not displayed through one common operational model.
- **P2-5 — [INFERRED]** Different configuration flag semantics will make support diagnosis inconsistent across environments.

### P3 — cleanup

- **P3-1 — [CONFIRMED]** Legacy Customer Profile adapter has no current productive caller found. Decision: **REMOVE** after external-consumer confirmation.
- **P3-2 — [CONFIRMED]** Historical documents contain stale status/endpoint coverage and must be labeled historical or reconciled in a later documentation task.
- **P3-3 — [CONFIRMED]** Payment strings in current code are opportunity/customer-purpose states, not a payment integration. Keep payment out of current refactoring.

## 23. Open questions requiring evidence

1. Which deployed service, repository and deployment owns each of these hostnames/base URLs: Catalog, Customer Profile, Customer Intelligence, Marketing Copilot, Quote, Customer Service and Carrier?
2. Are Profile, Dashboard, Audiences and Copilot one deployable service, several APIs in one service, or separate deployments? The current CRM comments do not prove this.
3. What are the live API contract versions and health/readiness endpoints for each external service?
4. Which environments currently have the base URLs, credentials and enabled flags configured, and which services have observed production traffic from CRM?
5. Is Customer Service deployed and reachable now, or is the active-release `PAUSED_EXTERNAL` state still current outside this checkout?
6. Which human/operator workflow is intended for `POST /api/customers`, and is direct local creation authorized at all after Customer Service became the declared authority?
7. What is the canonical identity namespace for the Customer Profile `customerId`, and how does it map to `masterCustomerId`/PrestaShop identity?
8. Does the external Catalog deployment expose all documented semantic/registry/recommendation endpoints at the same API generation used by CRM?
9. Which Quote Service operations listed in historical docs are actually deployed and supported today, especially cancel, expire, mark-paid, documents, audit and listing?
10. What is the Quote Service behavior for a lost response after a successful mutation, and how long are idempotency keys retained?
11. Does Carrier permit unauthenticated network access by policy, and where are tax/IVA metadata and fulfillment/pickup responsibilities owned?
12. What PII roles/permissions are required for audience exports, and which exports are allowed to contain PII?
13. Which Meta phone-number/account/environment is active, and are all outbound paths routed through the same outbox/transport policy?
14. Does a payment provider/service exist outside the inspected workspace, and if so what system owns payment status and reconciliation?
15. What operational telemetry system receives service correlation IDs, latency, retry, provider IDs and degraded outcomes?

## 24. Recommended next implementation sequence

The following are proposed phases only; none was executed in this audit.

1. **Evidence freeze:** obtain deployment/service inventory, live contract versions, safe health/readiness results and current traffic/configuration evidence for every external owner. Reconcile stale historical docs without changing runtime behavior.
2. **Authority and security closure:** decide the single customer-create/link authority; remove the ambiguous direct writer from the target path; establish audience PII export permissions and audit requirements.
3. **Integration standard adoption:** define service identity, configuration state, correlation, timeout, retry, idempotency, runtime validation, normalized errors, provenance/freshness and degraded-state records as per-service invariants.
4. **Operational readiness:** add or consume read-only capability health/readiness evidence for Catalog, Profile, Intelligence/Copilot/Audiences, Quote, Customer Service and Carrier. Keep local process health separate from remote capability availability.
5. **Client/contract consolidation:** retire the legacy Customer Profile client; align Catalog client policy and documentation; clarify the shared Profile/Intelligence/Copilot deployment boundary; choose one Meta transport policy.
6. **Transactional hardening:** preserve Quote authority and add unknown-outcome/reconciliation evidence; close Carrier auth/tax/freshness semantics; validate Customer Service availability before enabling governed mutations.
7. **BFF response hardening:** add runtime schemas and provenance/freshness checks to Copilot, Dashboard and Audience responses; preserve typed unavailable/degraded states to UI without fixture substitution.
8. **Status surface only after evidence:** redesign the integrations status read model around the standard states, keeping `/integrations` separate from local system health and ensuring every displayed status has an evidence source.
9. **Payment boundary later:** only after explicit product authorization and owner/deployment evidence, inventory a payment integration as a separate future workstream. Do not introduce it as part of the current CRM refactor.
10. **R4 remains deferred:** do not use this sequence to design CRM↔R4 contracts or migrate Agent Configuration, Agent Follow-ups or Agent Activity surfaces.
