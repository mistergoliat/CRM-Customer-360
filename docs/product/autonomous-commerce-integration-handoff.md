# Integration Handoff — INFRA-01, PR-02A, PR-02B, PR-03A

Role: architecture owner / integrator for the Autonomous Commerce System.

## 0. Correction to the premise of this review

The request that triggered this review referred to a "Codex branch" for this work. There is no such branch, locally or on `origin`: `git branch -a` / `git log --all` show no ref containing these changes, and the working tree had only uncommitted modifications on `ADRclaude` at the start of this review. This work was produced directly in this session, on this branch, uncommitted. It was audited with the same rigor requested for an external submission — including treating the prior self-authored QA report as a claim to verify, not a fact to trust — and "integration" below means committing the reviewed result, not merging a branch.

## 1. Scope and ownership verification

- **Files touched** (`git diff --name-only` against the committed tree): `.env.example`, `app/api/integrations/whatsapp/webhook/route.ts`, `docs/development/local-database.md`, `docs/product/autonomous-commerce-implementation-backlog.md`, `infra/.env.example`, `infra/docker-compose.dev.yml`, `infra/mariadb/init/001-create-databases-and-users.sql`, `infra/mariadb/init/002-set-local-passwords.sh`, `lib/audit.ts`, `lib/brain/commercial/context/index.ts`, `lib/brain/commercial/events/repository.ts`, `lib/brain/native-whatsapp/service.ts`, `lib/integrations/customer-external-identity/repository.ts`, `middleware.ts`, `package.json`, `scripts/db-permissions.ts`, plus new files (`lib/brain/commercial/context/buildNativeCommercialContext.ts`, `scripts/db-bootstrap-smoke.ts`, `.gitattributes`, and the test files listed per block below).
- **ADR/architecture boundary check**: `git diff -- . | grep -niE "crm_opportunities|crm_agent_decisions|crm_agent_actions|opportunity...(stage|status|lifecycle|terminal)|next_action|CommercialDecision|CommercialAction|AIPlan|AIProposal"` returns matches **only inside documentation prose** (the backlog file describing pre-existing context and PR-04's own title). No code file modifies opportunity lifecycle, terminality, `CommercialDecision`, `CommercialAction`, Next Best Action, or planning. No file under `docs/architecture/adr/` was touched. **Confirmed clean.**
- **Backlog ownership**: the canonical backlog (`docs/product/autonomous-commerce-implementation-backlog.md`) was edited during the original implementation pass. Per instruction, this review did not accept that text at face value — every claim in the `INFRA-01`/`PR-02A`/`PR-02B`/`PR-03A` sections was re-verified independently (fresh clean-volume runs, fresh live HTTP calls, fresh test runs) before the backlog's status lines were finalized in this pass. Three real gaps were found during that re-verification (not just rubber-stamped) and closed before acceptance — see §5.
- **Overlap check**: `git fetch origin` then diffed every local and remote branch (`main`, `develop`, `P1I`, `P1K-010J`, `P1Ka`, `P1Kb`, `P1Ma`, `P1N-modular-real-data-runtime`, `P1O-conversation-ai-runtime-core`, `section-p1d`, `origin/P1J`, `origin/revert-7-P1I`) against their merge-base with `ADRclaude`, restricted to the touched files. **No overlap found** — none of these branches contain divergent commits on any file this work touches.

## 2. Independent re-verification (this review, fresh clean volume)

```text
npm run db:down
docker volume rm infra_main_management_mariadb_data
npm run db:up                          -> container/volume created
npm run db:wait                        -> "MariaDB ready for dev"
npm run db:migrate -- --database=dev   -> 11/11 migrations applied
npm run db:bootstrap:smoke             -> "PASS: clean-volume bootstrap is reproducible
                                            (database, user, grants, migrations, app connection)."
npx tsc --noEmit -p tsconfig.json      -> clean, exit 0
npm run build                          -> clean, exit 0
npm run lint                           -> 0 errors, 35 pre-existing warnings (none new, none in
                                            touched files beyond what already existed)
npx tsx --test <every *.test.ts>       -> 583/583 passing, 0 failures (38 test files)
```

Live HTTP re-verification against a real running app (`npm run dev -p 3011`) and the same real DB, **with no `x-admin-bypass-token` at any point**:

```text
GET  ?hub.mode=subscribe&hub.verify_token=<correct>&hub.challenge=X   -> 200, body "X"
GET  ?hub.mode=subscribe&hub.verify_token=<wrong>&hub.challenge=X     -> 403
POST signed (valid HMAC over raw body)                                -> 200, ok:true,
                                                                            commercial_event created
POST identical body+signature again                                   -> 200, duplicate:true,
                                                                            real (non-empty) ISO timestamps
POST unsigned                                                          -> 401 missing_signature
POST forged signature                                                  -> 401 invalid_signature
DB check: commercial_event / conversation_message rows for this id    -> 1 / 1 (no duplication)
```

Identity conflict, live, against real persisted data (not a mock): seeded two `customer_external_identity` rows for one phone number pointing at two different real customers, then ran `processNativeWhatsAppInbound` directly:

```json
{"customerId": null, "identityConflict": {"type": "divergent_identity_links", "candidateCustomerIds": [21, 22]}}
```

Then ran `buildNativeCommercialContext` against the resulting real `conversationPublicId`, independently:

```json
{"signals": {"identityConflict": true}, "identityConflict": {"type": "divergent_identity_links", "candidateCustomerIds": [21, 22]}}
```

`hub_audit_log` shows real `customer.identity_conflict` rows (ids 26, 18, 16) for these and earlier runs in this session.

## 3. Gaps found during this review and closed before acceptance

The first-pass QA report (`autonomous-commerce-qa-report-infra01-pr02a-02b-03a.md`) was directionally correct but incomplete. This review found and closed:

1. **PR-02A had no test proving the signature is checked over the literal raw body** (not a parsed-and-reserialized copy) — added a test that signs a pretty-printed, non-canonical JSON body and confirms acceptance.
2. **PR-02A's production fail-closed path was implemented but never exercised by a test** — added a test with `NODE_ENV=production` and no secret configured, asserting 401.
3. **PR-03A's requirement "visible to future consumers of CommercialContext" was explicitly documented as NOT done** in the first pass — implemented: `buildNativeCommercialContext` now independently re-derives the same conflict signal and exposes it (`identityConflict`, `signals.identityConflict`, two new warning codes), with 3 new tests plus the live cross-check in §2.
4. **Audit log fix had no dedicated test and no stated failure policy** — added `tests/native/audit-log.test.ts` (successful write + observable, non-throwing failure with no partial row) and explicitly recorded the policy: audit logging degrades on failure, never propagates, never blocks a commercial/native write.
5. Minor: added a GET-missing-`hub.challenge` test for completeness.

No new gaps remain open in the four blocks reviewed.

## 4. Per-block decision

| Block | Decision | Basis |
|---|---|---|
| `INFRA-01` | **accepted** | Reproducible from an empty volume, independently re-run twice in this review; single coherent env contract; no manual SQL step; no real credentials in tracked files. |
| `PR-02A` | **accepted** | All 9 required security properties hold by code review and are now test-covered (14/14 passing) and live-proven without any admin token. |
| `PR-02B` | **accepted** | Root cause fixed correctly; never returns `""`; systemic naive-DATETIME/timezone risk is documented separately and explicitly *not* conflated with this fix. |
| `PR-03A` | **accepted** | Both conflict types detected; block is real (`customer`/`customerId` actually `null`, asserted directly, not just a warning); no link ever silently overwritten; audited; human-resolvable; now visible to `CommercialContext`. |

**Dependency order respected**: `INFRA-01` first (the other three depend on it for their DB-backed tests), then `PR-02A`/`PR-02B`/`PR-03A` (file-disjoint except `lib/audit.ts`, which is committed together with `PR-03A` since the audit fix was required to prove `PR-03A`'s audit-trail acceptance criterion).

## 5. Integration

Committed serially, in the dependency order above, on `ADRclaude`:

1. `INFRA-01` — env contract, docker-compose, init scripts, `.gitattributes`, bootstrap smoke script, `db-permissions.ts` export fix, dev doc.
2. `PR-02A` — middleware carve-out, webhook signature hardening, tests.
3. `PR-02B` — `commercialEventRowToContract` Date fix, test.
4. `PR-03A` — identity conflict detection, `CommercialContext` exposure, audit log fix, tests.
5. Docs — canonical backlog update (status lines only, evidence-based) and this handoff.

Post-merge validation: re-ran `npx tsc --noEmit`, `npm run build`, and the full test suite (583/583) against the final committed state on `ADRclaude`; unchanged from §2 (no behavioral diff introduced by committing).

## 6. Outcome

- `INFRA-01`, `PR-02A`, `PR-02B`, `PR-03A`: **completed**.
- `PR-04` is **unblocked**.

## 7. Debt carried forward, not silently dropped

- Naive `DATETIME`/`mysql2` timezone interpretation (`lib/db.ts` has no explicit `timezone` option) — systemic, affects every naive DATETIME column read as a JS `Date` anywhere in the app, not just `commercial_event`. Needs a dedicated task: decide `timezone: "Z"` vs. consistent UTC handling, then re-verify every table that implicitly relies on current behavior.
- `customer_external_identity`'s divergence/mismatch checks in `buildNativeCommercialContext` use the conversation's `external_contact_id` as a proxy for "normalized value"; in the rare case where `normalizedSenderPhone` and `normalizedExternalId` diverge (both are computed from message fields that are usually but not always equal), the context-level check could miss a conflict that `resolveOrCreateNativeCustomer` would still catch on the next inbound turn (the authoritative detection point). Not a regression — the inbound path remains the source of truth — but worth tightening if a real divergent case is ever observed.
