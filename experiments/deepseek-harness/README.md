# SALES-AGENT-R2-A13-H0 -- DeepSeek Harness bake-off

Isolated architecture spike. Nothing here touches production code,
WhatsApp routing, or the CommercialWork entry point. See
`docs/architecture/A13-H0-deepseek-harness-bakeoff.md` for the full
audit, methodology, and decision.

## Layout

- `scenarios/bakeoff-scenarios.json` -- the 20 shared scenarios both
  architectures run, verbatim.
- `fixtures/catalogFixtureServer.mjs` -- a local, deterministic double of the
  real Catalog Service HTTP contract (`lib/catalog/httpCatalogAdapter.ts`),
  seeded with a small fixed gym-equipment product set. Both runners point at
  this instead of a live catalog microservice, so results are reproducible
  and independent of what else is running locally.
- `tools/bakeoffCrmTools.ts` -- the four read-only tool bodies
  (`search_products`, `get_customer_context`, `get_purchase_history`,
  `get_shipping_options`), calling the SAME production domain functions R2
  itself uses (`lib/catalog`, `lib/integrations/carrier-service`,
  `lib/brain/commercial/commercial-customer-context`). Shared, unchanged,
  by both runners below.
- `harness/` -- the DeepSeek Harness (`@deepseek-ai/dsh`) side:
  - `bakeoff.cordis.patch.yml` -- the patch layered over
    `@deepseek-ai/dsh-base`, disabling every coding-agent capability
    (bash/pwsh/fs tools, subagents, plan mode, skills, web search,
    telemetry) and registering only the two plugins below.
  - `bakeoffToolsPlugin.ts` -- registers the four tools via `ctx.tools`,
    the same public extension point `@deepseek-ai/dsh-tool-web` uses.
  - `bakeoffRunnerPlugin.ts` -- drives one persistent Agent through every
    turn of one scenario sequentially (`agent.followup` + `agent.whenIdle`),
    the multi-turn equivalent of `@deepseek-ai/dsh-headless`'s own
    one-shot `headless-runner`, built from the same public `ctx.agents`
    API. Never runs `create_quote`/`create_order`/identity
    linking/cancellation/outbox send.
  - `bootBakeoff.mts` -- boots one scenario: starts the catalog fixture,
    composes `dsh-base` + the bake-off patch via `@deepseek-ai/dsh-app-boot`,
    exits when the runner plugin finishes.
  - `runAllHarnessScenarios.mjs` -- runs every scenario, one fresh process
    each, into `results/<id>.harness.json`.
- `r2-runner/runR2PlannerProbe.ts` -- the R2 side (see "Why a probe, not the
  full pipeline" below): calls the real `buildIntentPlannerPromptPackage` ->
  the real DeepSeek HTTP provider (`createHttpAgentLoopProvider`, same env
  vars as production) -> `parseCommercialIntentPlan`, turn by turn.
  `runAllR2Scenarios.mjs` runs every scenario into `results/<id>.r2-planner.json`.

## Why a probe, not the full `runCommercialWorkInboundCycle`, for R2

R2's durable projection/execution/dispatch stage
(`buildCommercialWorkProjection`, `executeCommercialWork`,
`settleCommercialWorkProjection`) requires a real MariaDB (`crm_test`) --
confirmed unreachable in this environment (`127.0.0.1:3306 ECONNREFUSED`).
That stage is deterministic, non-LLM code, already covered by Phase 1's
code audit and by the existing
`tests/commercial/fixtures/a13-conversational-reliability-scenarios.ts`
suite elsewhere in this repo. The probe isolates the one part that
genuinely needed a live run to compare against the Harness: how well each
architecture's model understands the same Spanish customer turns.
Known, disclosed simplification: `pendingIntents` (the durable
clarification-carry-forward state) is tracked in memory only, always
starting empty per scenario -- multi-turn clarification fidelity for R2 is
therefore probably UNDER-stated here, never over-stated.

## Reproducing

Requires Node >= 22 for the Harness half (`Promise.withResolvers`, used by
`@deepseek-ai/dsh-agent-loop`, does not exist on Node 20 -- this repo's
ambient Node is 20.19.0, so the Harness commands below pin an explicit
newer binary; the R2 probe runs fine on the repo's normal Node).

```bash
cd experiments/deepseek-harness
npm install @deepseek-ai/dsh-base@0.1.1-rc.2 @deepseek-ai/dsh-app-boot@0.1.1-rc.2 \
  @deepseek-ai/dsh-llm@0.1.1-rc.2 @deepseek-ai/cordis@4.0.2 tsx@4.20.5 esbuild@0.24.0
# pin exact 0.1.1-rc.2 versions everywhere - dsh-base's own "latest" npm dist-tag
# resolves to a stale, broken 0.0.1-rc.1 that 404s on a renamed transitive
# dependency (see the decision doc's Phase 2 section).
node_modules/.bin/esbuild tools/bakeoffCrmTools.ts --bundle --platform=node \
  --format=esm --outfile=tools/bakeoffCrmTools.bundle.mjs
# @deepseek-ai/cordis-plugin-loader's dynamic import() of a plugin's .ts
# dependency graph does not reliably go through tsx's alias/transform hook -
# the plugins import the pre-bundled, dependency-free .mjs instead of the
# raw .ts for that reason (rebuild after editing bakeoffCrmTools.ts).

cd ../..  # repo root
<path-to-node-22-plus> experiments/deepseek-harness/node_modules/tsx/dist/cli.mjs \
  experiments/deepseek-harness/harness/runAllHarnessScenarios.mjs

npx tsx experiments/deepseek-harness/r2-runner/runAllR2Scenarios.mjs
```

Results land in `experiments/deepseek-harness/results/*.json` (gitignored,
regenerate rather than commit -- these hit the real DeepSeek API and a
local fixture, never anything productive).
