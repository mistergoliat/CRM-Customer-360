# SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4.1 - Canonical Semantic Vocabulary Projection

**Verdict:** `TR_B4_1_IMPLEMENTED`

**Mode:** IMPLEMENTATION

**Depends on:** `SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4` (the `search_products_by_semantics` capability and its per-process registry cache).

## 1. The gap this closes

TR-B4 wired `search_products_by_semantics` end to end - it fetches and caches both Catalog registries, validates model-generated codes against them, and returns a typed `invalid_code` observation when the model invents or reuses a stale code. What it did **not** do is show DeepSeek the real vocabulary up front: the model had to guess codes and learn the valid ones only through `invalid_code` repair loops. This task closes exactly that gap - nothing else.

## 2. Source of truth

The vocabulary is a pure projection of the exact registry data `searchProductsBySemanticsCapability.ts` already fetches and caches. No new fetch, no second cache, no hardcoded ontology (`LOWER_BODY`/`HOME_GYM`/etc. never appear as literals anywhere in this change - a dedicated test proves the projection is a pure function of its input by feeding it a fixture with deliberately unusual, made-up codes and asserting they - and only they - come back out).

The capability's internal cache was widened (`CachedRegistry`) to retain the raw `product`/`training` registries alongside the derived code-set index it already used for validation - one fetch, two consumers, never a second independent read.

## 3. Compact projection

`projectSemanticVocabulary(product, training)` (pure, exported, unit-tested directly):

```
{
  axes: [
    { axis: "PRODUCT_FAMILY", codes: [{ code, label, description }, ...] },
    { axis: "DISCIPLINE", codes: [...] },
    { axis: "USE_CONTEXT", codes: [...] },
    { axis: "EXERCISE_CAPABILITY", codes: [{ code }, ...] },
    { axis: "TRAINING_FUNCTION", codes: [...] },
    { axis: "BODY_REGION", codes: [...] },
    { axis: "MUSCLE_GROUP", codes: [...] },
    { axis: "TRAINING_PATTERN", codes: [...] }
  ]
}
```

Product axes carry `label`/`description` (sourced from the registry's `labelEs`/`definition`). Training axes carry codes only - the upstream training registry itself has no per-code label/definition for `EXERCISE_CAPABILITY`/`TRAINING_FUNCTION`/`BODY_REGION`/`MUSCLE_GROUP`/`TRAINING_PATTERN` (confirmed against the real contract in TR-B4), so none are fabricated. Never exposed: `ontologyVersion`/`ontologyHash`/`registryVersion`/`registryHash`/`snapshotId`/`semanticChecksum`/`classifierVersion`/`residual`/`status` - a dedicated test greps the serialized output for every one of these field names and asserts none appear.

No filtering beyond what the registries return: a code the server-side validator (`validateCodesAgainstRegistry`) still accepts is never hidden from the model here, and vice versa - both surfaces are built from the exact same cached fetch, so they can never drift apart.

`getSemanticVocabularyForPrompt(port, correlationId)` is the one impure entry point - it reuses/ensures the same cache `execute()` already relies on and never throws (a missing port, an unconfigured capability, or any transport/parse failure degrades to `null`).

## 4. Runtime context

`semanticVocabulary` was added to:

- `BuildHarnessAlignedMessagesInput` / `buildDynamicContextMessage` (`harnessAlignedMessageProjection.ts`) - rendered inside the existing dynamic runtime context `system` message (`RUNTIME CONTEXT (system-provided, not authored by the customer): {...}`), omitted entirely (never a `null` literal) when unavailable.
- `AgentLoopPromptInput` (`buildAgentStepPromptPackage.ts`) - threaded into the harness-aligned branch only.
- `runAgentToolLoop.ts` - resolved once per turn (reused for both the gathering and finalization prompt builds), the same resolve-once-reuse discipline `recentCatalogContext`/`pendingCatalogAction` already follow.

It was deliberately **not** added to the legacy/persistent mega-envelope branches of `buildAgentStepPromptPackage.ts`, and **not** placed in the raw user message, `RecentCatalogContext`, `PendingCatalogAction`, or conversation history - it is backend-owned current capability vocabulary, nothing else. Tests prove the raw customer message is untouched and that adding `semanticVocabulary` changes only the dynamic context message's own JSON payload - message count, roles and order are unaffected either way.

Scoped to harness-aligned mode only (`BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED`): the legacy envelope path gets zero new I/O and is byte-identical to before this task, same discipline every other `BRAIN_R3_*`-flagged addition in this file already follows.

## 5. Lifecycle

`runAgentToolLoop.ts` calls `createCatalogPort()` (stateless, cheap - reads env fresh, allocates no connection) and passes the result into `getSemanticVocabularyForPrompt`, which reuses the existing per-process registry cache. No new DB persistence, no semantic memory. If the cache is reset (`resetSearchProductsBySemanticsRegistryForTests()` in tests; in production, only a process restart clears it - no runtime invalidation exists or was added), the next call re-fetches and the next provider invocation receives the refreshed vocabulary. Server-side registry validation (`validateCodesAgainstRegistry`, inside `execute()`) is completely unchanged and remains the authoritative gate - the vocabulary is advisory context for the model, not a bypass of that check.

## 6. Capability relation

`search_products_by_semantics`'s own `description`/`useWhen`/`doNotUseWhen` (from TR-B4) remain the only place explaining when semantic discovery is appropriate, `required`/`preferred`, `any`/`all`, and what the capability produces. `semanticVocabulary` answers exactly one question - "what canonical axes/codes are currently available?" - and duplicates none of that prose.

## 7. Tests

- `tests/commercial/searchProductsBySemanticsCapability.test.ts` (+9, `[TR-B4.1]`): product registry projected correctly; training registry projected as codes-only; only real upstream codes appear (fixture with deliberately unusual codes, asserted verbatim, nothing else leaks in); classifier internals excluded (hash/snapshot/checksum/status/residual field-name grep); `getSemanticVocabularyForPrompt` returns `null` for a missing port and for a registry load failure, never throws; cache reuse across `execute()` and `getSemanticVocabularyForPrompt` (one fetch serves both); cache reuse across repeated vocabulary reads; `resetSearchProductsBySemanticsRegistryForTests()` actually changes what the next read returns.
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` (+5, `[TR-B4.1]`): runtime context receives `semanticVocabulary` when present; absent means no placeholder key at all; the raw current user message never contains it; adding it changes nothing about message count/roles/order (only the dynamic context message's own payload); flag off makes it inert (byte-identical output with or without it).
- All existing `search_products_by_semantics` tests remain green after the internal cache refactor (`CachedRegistry` widened to also retain the raw registries) - `execute()`'s call sites were updated mechanically, no behavior change.
- Full harness-aligned-mode regression (`harnessAlignedMessageSequencing.test.ts`, `runAgentToolLoop.test.ts`, `openTurnExecution.test.ts`, `runAgentToolLoopLiveAssimilation.test.ts`, 140 tests) - only the 9 pre-existing DB-connectivity failures remain (confirmed identical against a clean `develop` checkout via `git stash`/`git stash pop`), plus one real, expected update: `runAgentToolLoop.test.ts`'s "I0" pool-membership test asserted an exact `AGENT_LOOP_TOOL_POOL` list that predated TR-B4's own addition of `search_products_by_semantics` - updated to include it (this was TR-B4's gap, caught and closed by this task's fuller regression pass).

`npx tsc --noEmit`, `npm run lint` (0 errors, 40 warnings - unchanged baseline), and `npm run build` (27/27 pages) are all clean.

## 8. No C2

Not implemented. `catalogEvidenceVsSelection`/`catalogDiscoveryFreshness`/`supersededByNewerDiscovery`/`OpenQuestionContinuitySignal` remain deferred, unchanged.

## Files changed

- `lib/brain/commercial/capability-gateway/searchProductsBySemanticsCapability.ts` - cache widened to retain raw registries; added `projectSemanticVocabulary` (pure) and `getSemanticVocabularyForPrompt` (impure entry point).
- `lib/brain/commercial/agent-loop/harnessAlignedMessageProjection.ts` - `semanticVocabulary` on `BuildHarnessAlignedMessagesInput`/`buildDynamicContextMessage`.
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` - `semanticVocabulary` on `AgentLoopPromptInput`, threaded into the harness-aligned branch.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` - resolves `semanticVocabulary` once per turn (harness-aligned mode only) and passes it to both prompt builds.
- Tests listed in section 7; `tests/agent-loop/runAgentToolLoop.test.ts`'s "I0" test updated (TR-B4 regression, caught here).

## Debt / known gaps

- No runtime cache-invalidation signal exists (or was added) - a registry update only takes effect on the next process restart in production, same lifecycle the code-validation cache already had since TR-B4.
- No token-budget cap on the projected vocabulary - if the real registries grow very large, this may need bounding later; not a problem with the current registry sizes.
- No live DeepSeek acceptance benchmark proving the model actually constructs better first-attempt requirements with the vocabulary present (would require the same live-benchmark infrastructure TR-B4 already flagged as unavailable in this session).
