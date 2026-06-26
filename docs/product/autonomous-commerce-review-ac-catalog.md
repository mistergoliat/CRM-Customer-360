# Architecture-Owner Review — AC-CATALOG (ADR-005 Catalog Boundary)

Role: architecture owner / integrator. Branch reviewed: `ai/codex/ac-catalog`, base `fd23066`, original final commit `21fe910` (rebased onto `ADRclaude` as `d972b57`, no conflicts).

## Decision: changes_requested

The architecture boundary itself is sound and ADR-005-aligned. The blocking issues are real implementation gaps in `PrestashopCatalogAdapter`'s fidelity to actual PrestaShop semantics, and a test-coverage gap on the one piece of new code every existing consumer actually depends on. None of them touch opportunity/decision/action/policy/escalation territory, so **PR-04 is not blocked by this outcome** (see §6).

## 0. A correction to the handoff's own claims

`docs/ai/handoffs/AC-CATALOG-codex.md` (untracked, exists on disk in the catalog worktree but not committed) reports `npx tsc --noEmit -p tsconfig.catalog.tmp.json` — a scoped, temporary tsconfig that no longer exists. Re-ran with the real `tsconfig.json` against the full project: clean (exit 0), so this particular claim holds, but it should not have been the only typecheck evidence offered. More substantively:

- The handoff states "49 warnings preexistentes fuera del alcance de Catalog." This is **false as stated**: `npm run lint` on `ADRclaude` (pre-Catalog) reports **35** warnings; the same command on `ai/codex/ac-catalog` reports **49**. The delta (**14 new warnings**) is dead code inside Catalog's own new file, `lib/catalog/snapshotCatalogAdapter.ts`: unused types (`SnapshotAvailabilityRecord`, `SnapshotDimensionRecord`, `SnapshotUrlRecord`), unused functions (`resolveRecordArray`, `buildAvailability`, `buildDimensions`, `buildUrl`), and several unused `context` parameters. These are not pre-existing debt; they are this commit's own leftovers (the file appears to have been refactored mid-development and the old per-field builder functions were never removed). Per the instruction not to mix general lint cleanup into this review, these are **not fixed here**, but the claim that all 49 warnings are out of scope is incorrect and the 14 new ones should be removed by Codex as part of closing this out.
- The 12-test count is accurate. What it covers is narrower than "the full contract" — see §4.

## 1. Ancestry, isolation, overlap

1. **Base staleness**: confirmed. `fd23066` is the merge-base between `ADRclaude` and `ai/codex/ac-catalog` — i.e. the branch was cut before `INFRA-01`/`PR-02A`/`PR-02B`/`PR-03A` were integrated. Rebased `ai/codex/ac-catalog` onto `ADRclaude` (`git rebase ADRclaude` from the `CRM-Customer-360-catalog` worktree): clean, no conflicts, new tip `d972b57`. Not pushed anywhere, so this rewrite is safe.
2. **Overlap against `ai/claude/ac-pr04`**: this branch **does not exist** (`git rev-parse --verify` fails, not in `git branch -a`, no worktree). `docs/ai/AI_TASK_BOARD.md` lists it as `READY`, but nothing was ever created under that name — see §6.
3. **File overlap**: `git diff ADRclaude ai/codex/ac-catalog --stat` touches only `docs/architecture/catalog-boundary.md`, `lib/brain/commercial/sales-consultative/catalogRepository.ts`, `lib/catalog/**`, `tests/catalog/**`. None of these intersect with anything touched by `INFRA-01`/`PR-02A`/`PR-02B`/`PR-03A`. The clean rebase is itself confirmation.
4. **Semantic review** (not just grep): `git diff ADRclaude ai/codex/ac-catalog -- .` for `crm_opportunities|crm_agent_decisions|crm_agent_actions|CommercialDecision|CommercialAction|AIPlan|AIProposal|next_action|policy|escalation|outcome|opportunity` returns **zero matches** in the isolated catalog diff. Read every line of `lib/catalog/types.ts`, the two adapters, and the bridge by hand; none of it constructs a `CommercialDecision`, `CommercialAction`, touches `crm_opportunities`/`crm_agent_decisions`/`crm_agent_actions`, or implements any planning/policy/escalation/outcome logic. **Confirmed clean.**

## 2. Architecture boundary (§2 of the request)

| Check | Result |
|---|---|
| Commercial domain depends on `CatalogService` | ✅ `catalogRepository.ts` imports only `@/lib/catalog`; zero `ps_*` references after the change (confirmed by direct read of the diff, not just the architecture test). |
| PrestaShop SQL/tables confined to adapter/infra | ✅ All `ps_*` SQL lives in `lib/catalog/prestashopCatalogAdapter.ts`. No write verbs anywhere in that file (`grep -niE "INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE"` → no matches). |
| `catalogRepository.ts` delegates without reintroducing PrestaShop knowledge | ✅ The old direct-SQL implementation (344 lines of `ps_product`/`ps_stock_available`/etc. queries) was deleted outright and replaced with a bridge that only calls `CatalogService` methods and reshapes the result into `SalesConsultativeProduct`. `createPrestashopProductRepository()` is preserved as the exported entry point existing consumers already call. |
| No adapter creates decisions/actions/effects | ✅ Both adapters are pure read functions; nothing calls `auditLog`, `crm_agent_actions`, `crm_agent_decisions`, or any outbox/mutation path. |
| `SnapshotCatalogAdapter` cannot become productive by accident | ✅ `createSnapshotCatalogService` is exported from `lib/catalog/index.ts` but the **only** caller anywhere in the diff is the test file. `createPrestashopProductRepository()` (the one production entry point) hardcodes `createPrestashopCatalogService()` — no env flag, no fallback, no conditional wiring to snapshot. |
| `PrestashopCatalogAdapter` is strictly read-only | ✅ by absence of write verbs (above) and by design (every method is a `SELECT` + in-memory mapping). **But** "read-only" was verified by the adapter's own SQL text and by an architecture test that does the same textual check — not by an actual least-privilege DB user or a real connection-path audit. See §3 for why this matters and what's still unverified. |

## 3. Domain contracts (§3)

Read `lib/catalog/types.ts` in full. All nine required checks hold:

1. `Product`/`ProductVariant` are distinct interfaces; `Product.variantIds`/`defaultVariantId` link forward, `ProductVariant.productId` links back.
2. `ProductPrice.subjectType: "product" | "variant"` plus `subjectId` makes the subject explicit on every price.
3. `currency: string` and a structured `tax: { included, rate, code }` are both explicit, never inferred.
4. `validFrom`/`validTo`/`retrievedAt` are named, ISO-string fields — no ambiguous "timestamp" field doing double duty.
5. `Dimensions.unit` is a mandatory field; `CatalogDimensionValue = Dimensions | UnknownCatalogValue` keeps assembled/packaged independently unknown-capable.
6. `AvailabilityStatus` matches ADR-005's six canonical states exactly.
7. `CompatibilityResult` keeps `reasons`/`restrictions`/`evidence` as three separate `string[]`, never collapsed into one blob.
8. `Provenance.source`/`retrievedAt` are both present and required (not optional).
9. `UnknownCatalogValue` is a distinct discriminated type (`kind: "unknown"`); `CompatibilityResult.compatible` is `true | false | "unknown"` (the string, not a falsy sentinel); `AvailabilityStatus` has `"unknown"` as its own enum member, never aliased to `"out_of_stock"`. No path returns `null`/`0`/`false` where the real answer is "we don't know."

No findings here — this layer is well-designed and matches ADR-005's letter and intent.

## 4. PrestashopCatalogAdapter (§4) — this is where the real gaps are

Read every query and mapping function in `lib/catalog/prestashopCatalogAdapter.ts` (1174 lines), not just grepped for verbs.

| # | Check | Result |
|---|---|---|
| 1 | Table-prefix support | ❌ **Gap.** Every query hardcodes the literal `ps_` prefix (`ps_product`, `ps_product_lang`, `ps_stock_available`, `ps_shop_url`, ...). Real PrestaShop installs can run a different prefix; there is no configuration point for it anywhere in `PrestashopCatalogAdapterDependencies`. |
| 2 | Multishop | ❌ **Gap.** `resolveProductFilter` compares `query.filters?.shop !== context.shop` — both values come from the *caller*, not from the database row. No query ever adds `WHERE p.id_shop_default = ?`; `id_shop_default` is only read to join `ps_shop_url` for a URL domain. In a real multistore catalog this adapter would return products from every shop, not just `context.shop`'s. |
| 3 | Active/inactive | ✅ `productStatus()`/`availabilityFromRow()` both read `p.active`/`pa.active` and map `0` to `"discontinued"`. |
| 4 | Combinations/SKU | ✅ `ps_product_attribute` is queried for variants, joined to `ps_attribute`/`ps_attribute_lang`/`ps_attribute_group_lang` for option values, with its own `reference` as SKU. |
| 5 | Language/locale | ❌ **Gap.** `getLanguageId()` runs `SELECT id_lang FROM ps_product_lang LIMIT 1` and uses whatever row happens to come back first — `context.locale` (e.g. `"es-CL"`) is **never** translated to a `id_lang`. Every query effectively ignores the requested locale. |
| 6 | Currency | ✅ `context.currency` flows into `priceFromRow`'s `currency_iso ?? context.currency` and into provenance; not hardcoded. |
| 7 | Taxes | ⚠️ Partial. `tax.included`/`tax.rate`/`tax.code` exist on the type and are populated from a `PriceRow`, but no query in this file ever selects real tax data (`ps_tax`, `ps_tax_rule`, `ps_tax_rule_group`) — `tax_included` defaults to `true`, `tax_rate`/`tax_code` are always `null` from the actual lookups (`getPrice`'s inline `PriceRow` objects hardcode `tax_rate: null, tax_code: null`). The contract is right; the data behind it isn't wired up yet. |
| 8 | Base price, specific price, offer | ✅ `loadSpecificPriceRow`/`priceFromRow` implement base price + `ps_specific_price` reduction (amount or percentage) → sale price → effective price, matching PrestaShop's real discount model. |
| 9 | Stock per product/combination | ✅ `ps_stock_available` is joined with `id_product_attribute = 0` for products and the real attribute id for variants. |
| 10 | Discontinued/backorder/unknown | ⚠️ Partial. Discontinued (`active=0`) and unknown (`quantity === null`) both work. **Backorder/preorder are unreachable** — `availabilityFromRow`'s status logic only ever produces `discontinued`/`unknown`/`in_stock`/`out_of_stock`; `ps_stock_available.out_of_stock` (PrestaShop's actual backorder-allowance flag) is never selected or read. |
| 11 | Commercial URLs | ✅ `getCommercialUrl()` has a dedicated, correct lookup. Note: `getProduct()`/`getVariant()` always return `commercialUrl: unknown` (URL is only resolved via the dedicated method or inside search hits) — checked that `SnapshotCatalogAdapter` behaves identically, so this is a deliberate, consistent design choice across both adapters, not a divergence. |
| 12 | Dimensions | ✅ assembled/packaged both read, independently unknown-capable. |
| 13 | Absence of writes | ✅ confirmed (see §2). |
| 14 | DB errors without faking data | ✅ every method falls back to `unknown`/`null`/empty array on `safeQueryRows` failure (`ok: false`), never invents a value. Verified by the "degrades safely on infrastructure failure" test, which passes. |
| 15 | Read-only DB user | ❌ **Not verified, and not verifiable from this repo as-is.** `prestashopCatalogAdapter.ts` defaults to `@/lib/db`'s shared pool, which resolves to the `app` connection (`crm_app`, minimal grants, confirmed in `INFRA-01`) — but that pool's database is `main_management`, the CRM's own native schema, which **does not contain any `ps_*` table**. There is no separate PrestaShop connection wired anywhere in this repo (this is a pre-existing gap, not introduced by this commit — the old direct-SQL `catalogRepository.ts` had the exact same assumption). The adapter's `PrestashopCatalogAdapterDependencies` type does allow injecting a different `queryRows`/`safeQueryRows`, which is the right shape for a real deployment to plug in a dedicated, least-privilege PrestaShop connection — but nothing in this repo proves that connection would actually be read-only in production, because that connection doesn't exist here to test against. |

The instruction not to settle for a textual verb search was correct to give: the *write-verb* absence is real and verified, but the *read-only DB user* and *effective connection route* claims cannot be substantiated from this codebase, because there is no PrestaShop-shaped schema or connection anywhere in this repository (confirmed: `database/fixtures/legacy-n8n-schema.sql` only defines `ps_customer`/`ps_address`/`ps_orders` — none of the catalog tables this adapter queries). This is carried-forward, pre-existing scope, not a new defect, but it means item 15 stays **unverified** rather than **confirmed**.

## 5. SnapshotCatalogAdapter (§5)

Read `lib/catalog/snapshotCatalogAdapter.ts` and `snapshot-data.ts` in full.

- **Determinism**: no `Date.now()`, `Math.random()`, or bare `new Date()` anywhere in either file; every timestamp comes from `context.effectiveAt`, which the caller controls. The contract test asserting `assert.deepEqual(first, second)` on two identical `searchProducts` calls passes.
- **No fixture mutation**: `productEntity`/`variantEntity` (and the equivalent availability/dimension/url builders) construct fresh objects with spread-cloned arrays/objects (`[...product.tags]`, `{...product.attributes}`) on every call; nothing returns a live reference into the shared `state`. `.sort()`/`.push()` calls all operate on locally-built arrays, never on the shared fixture collections.
- **Unknown preserved**: `mystery-band` (price), `paddock-rower` (availability), `mystery-addon` (dimensions) all correctly degrade to `UnknownCatalogValue`/`status: "unknown"` in the snapshot fixture, exercised by the contract test.
- **Coverage**: variants, prices, stock, dimensions, and compatibility are all present in `snapshot-data.ts`'s fixture set.

No findings here — this adapter is correctly built.

## 6. Tests (§6) — real gaps, not just count-checking

12 tests is an accurate count, but it does not cover "the full contract":

**Confirmed covered**: simple product, multiple variants (product+variant both returned from search), unknown price, known availability, unknown availability, assembled+packaged dimensions, compatibility true/false/unknown, infrastructure-unavailable degradation, read-only-queries-only check, no-PrestaShop-import-from-domain check.

**Missing or only nominally covered** (verified by reading the test bodies, not just their titles):

- **Variant price math is never tested.** Every price assertion in `catalog-contract.test.ts` calls `getPrice` on a *product* id (`"treadmill-sale"`); nothing calls `getPrice("bike-pro-black", ...)` to exercise the `base_price + variant_price` / reduction math in `priceFromRow`'s `"variant"` branch.
- **Discontinued status is fixture data that's never asserted.** `legacy-bike` (`active: 0`) exists in the fixture but no test calls `getAvailability("legacy-bike", ...)` or checks `status === "discontinued"` anywhere.
- **Provenance fields are never asserted directly.** The test titled "unknown stays unknown and provenance carries context" only asserts `isUnknownCatalogValue(...)`; it never reads `.provenance.source`/`.tenant`/`.shop`/`.locale`/`.currency` to confirm the context actually propagated.
- **Freshness is never asserted.** `STALE`/`FRESH` timestamps exist in the fixture and feed `freshnessFor()`, but no test asserts `provenance.freshness === "stale"` or `"fresh"` anywhere.
- **Multi-shop scoping is never really tested** — consistent with it not being implemented (§4.2): no test sets `query.filters.shop` to something that should exclude `folding-bench` (`id_shop_default: "intl-store"`) from a `shop: "cl-main"` search.
- **"Equivalence between adapters" is a shared test loop, not a strict equivalence check.** The for-loop running the same test body against both adapters is the right shape, but several assertions branch on `adapter.name === "snapshot" ? X : Y` with adapter-specific expected values. That's reasonable given the two fixtures intentionally hold different data, but it means the tests prove "both adapters satisfy the same schema and degrade the same way," not "both adapters are interchangeable for identical input data."
- **The PrestaShop adapter is tested only against a hand-written JS object that string-matches SQL text** (`buildFixtureRows()`'s `safeQueryRows` mock), never against a real MariaDB connection executing the actual SQL. There is no PrestaShop-shaped schema fixture anywhere in this repo to integrate against (checked `database/fixtures/`; only `legacy-n8n-schema.sql` exists, and it only has `ps_customer`/`ps_address`/`ps_orders`, none of the catalog tables). Building a realistic schema+seed fixture for `ps_product`/`ps_product_lang`/`ps_product_attribute`/`ps_stock_available`/`ps_specific_price`/`ps_manufacturer`/`ps_category_lang`/`ps_shop_url`/`ps_attribute*` is a substantial undertaking on its own and is the single most important piece of missing coverage — it's the only way to catch real SQL/JOIN/GROUP_CONCAT mistakes, which a string-matching mock structurally cannot do.
- **The most consequential gap**: **the bridge itself is completely untested.** `git grep` for `createCatalogBackedSalesConsultativeProductRepository` and `createPrestashopProductRepository` inside `tests/` returns zero matches. The 12 tests exercise `CatalogService` directly; nothing exercises `mapSearchHitToConsultativeProduct`, `mapEntityToConsultativeProduct`, `resolveConsultativeEntity`, `resolveMoneyValue`, `resolveDimensionsValue`, or `resolveCompatibilityTokens` — the actual translation layer that `lib/brain/native-whatsapp/service.ts` and `lib/brain/processInbound.ts` depend on through `createPrestashopProductRepository()`. Typecheck passing proves the shapes line up; it proves nothing about whether the mapping is *correct* (e.g., whether `currency` really falls back sanely when price is unknown, whether `stockQuantity` is null exactly when it should be, whether related-product mapping terminates and de-duplicates correctly).

## 7. Consumer compatibility (§7)

- `SalesConsultativeProductRepository` (the interface in `lib/brain/commercial/sales-consultative/types.ts`) is **unchanged** — zero diff on that file.
- Both real call sites (`lib/brain/native-whatsapp/service.ts:852`, `lib/brain/processInbound.ts:1256`) call `createPrestashopProductRepository()` with no arguments, exactly the preserved signature.
- `createMemorySalesConsultativeProductRepository` (used by `tests/commercial/sales-consultative*.test.ts`) is also preserved with the same signature and equivalent behavior.
- **However**: neither real call site, nor any existing test, currently exercises `createPrestashopProductRepository()`'s new implementation at runtime — `processNativeWhatsAppInbound`'s own test suite explicitly asserts "native inbound path does not invoke consultative engine or outbox writers" (a passing test), meaning the consultative engine (and therefore this catalog bridge) isn't wired into anything that runs today. Compatibility here is currently a **type-level** guarantee (confirmed by a clean `tsc --noEmit` against the real `tsconfig.json`), not a runtime-proven one. That will matter the moment something does start calling the consultative engine for real — which is exactly why §6's missing bridge tests matter.

No ordering/nullability/currency/URL regressions found in what's actually wired up today, because nothing is wired up to exercise the new code at runtime yet.

## 8. Independent validation (this review, real `tsconfig.json`, not the temp scoped one)

Run from the `CRM-Customer-360-catalog` worktree, on the rebased branch (`d972b57`):

```text
npx tsc --noEmit -p tsconfig.json     -> clean, exit 0   (real project tsconfig, not tsconfig.catalog.tmp.json)
npm run lint                          -> 0 errors, 49 warnings (35 pre-existing + 14 new in this commit, see §0)
npm run build                         -> exit 0
npx tsx --test tests/catalog/*.test.ts -> 12/12 passing
npx tsx --test <every *.test.ts>      -> 595/595 passing (583 prior + 12 catalog), 0 failures
```

**CI/Linux reproduction**: no `.github/` workflow or other CI exists in this repository to run or reproduce. The build log on this Windows machine does show the warning Codex's handoff mentions:

```text
⚠ Failed to copy traced files for .../.next/server/pages/_app.js
[Error: EPERM: operation not permitted, symlink '...\node_modules' -> '...\.next\standalone\node_modules']
```

This is Next.js's `output: "standalone"` file-tracing step trying to symlink `node_modules`, which requires elevated privileges or Developer Mode on Windows; it does not fail the build (exit 0) and is unrelated to Catalog's code — it would reproduce identically on this machine for any commit, with or without this change. I cannot literally execute a Linux/CI run to confirm the standalone artifact is unaffected there, since no such environment is available to me in this session; I'm reporting that limitation rather than asserting a result I didn't observe.

## 9. Task-board reality sync (`docs/ai/AI_TASK_BOARD.md`)

This file is untracked and **not shared between worktrees** (confirmed: it exists only in the main `CRM-Customer-360` checkout; the catalog and quality-gate-01 worktrees each have their own independent, mostly-empty `docs/ai/`). Found stale relative to what's actually in git:

- `AC-INFRA-INGRESS` is listed `READY`, owner Codex, branch `ai/codex/ac-infra-ingress`. That branch **does not exist**. The equivalent scope (dev DB bootstrap, WhatsApp ingress auth, duplicate-response contract) was already implemented and **accepted/integrated directly on `ADRclaude`** in a prior review pass (commits `be00ae9`, `8854ab1`, `54c02bb`). AC-CATALOG's stated dependency ("AC-INFRA-INGRESS accepted or isolated dependency audit") is therefore **satisfied**, just not through the branch name the board expected.
- `AC-PR04` is listed `READY`, owner Claude, branch `ai/claude/ac-pr04`. That branch **does not exist** either (no local ref, no remote ref, no worktree).
- A third worktree exists, `ai/codex/ac-quality-gate-01` at `CRM-Customer-360-quality-gate-01`, tip `fd23066` (i.e. no commits yet beyond the shared base). It is not mentioned anywhere in the task board. Not investigated further — out of scope for this request, and not touched.

Updated the board's status column for `AC-INFRA-INGRESS` and `AC-CATALOG` to reflect the above (see diff in that file). Did not invent or assume content for `ai/claude/ac-pr04` or `ai/codex/ac-quality-gate-01`.

## 10. Required changes for Codex (in priority order)

1. Add a SQL-backed integration test for `PrestashopCatalogAdapter` against a real (even if minimal) PrestaShop-shaped fixture schema, or explicitly document why a mock-only suite is an accepted permanent tradeoff and get that tradeoff signed off — don't leave it implicit.
2. Test the bridge (`createCatalogBackedSalesConsultativeProductRepository` / `createPrestashopProductRepository`) directly, not just the underlying `CatalogService`.
3. Either implement table-prefix configuration, real `context.locale` → `id_lang` resolution, and SQL-level shop scoping, or explicitly scope them out in `docs/architecture/catalog-boundary.md` as known, deliberate limitations with an upgrade path — right now they're silent gaps, not documented tradeoffs.
4. Wire real tax data (`ps_tax*`) or document that `tax.rate`/`tax.code` are placeholders until a follow-up.
5. Read PrestaShop's actual backorder-allowance flag so `"backorder"`/`"preorder"` are reachable, or remove them from the adapter's effective range until they are.
6. Remove the 14 new dead-code lint warnings introduced in `snapshotCatalogAdapter.ts`.
7. Correct the handoff's "49 preexisting warnings" claim.

None of these require touching `opportunity`/`CommercialDecision`/`CommercialAction`/policy/escalation/outcome code, and none of them are large enough to justify blocking PR-04.
