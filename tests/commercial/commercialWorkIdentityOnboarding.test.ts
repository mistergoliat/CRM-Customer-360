import assert from "node:assert/strict";
import test, { after } from "node:test";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true"
});

import { getPool, queryRows } from "@/lib/db";
import { runCommercialWorkInboundCycle, findIdentityOnboardingTrigger } from "@/lib/brain/commercial/work/runCommercialWorkInboundCycle";
import { setupR2BenchmarkEnvironment, seedBenchmarkSelection, type R2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
import { createOfflinePlannerProvider } from "@/lib/brain/commercial/work/benchmark/offlinePlannerProvider";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import type { CustomerSessionDecisionContext } from "@/lib/brain/commercial/native-cycle/customer-session/types";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session/types";
import type { RuntimeIdentityContext, RuntimeIdentityStatus } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";

/**
 * SALES-AGENT-R2-ID-R2-A07. DB-backed subset of the CIW test matrix: the
 * gate's real effect end-to-end through runCommercialWorkInboundCycle (block
 * -> onboarding activation -> cross-turn resume, PARTE 8/13), against the
 * real crm_test database - same discipline as commercialWorkInboundCycle.test.ts
 * (offline planner, no live LLM). The pure/structural subset lives in
 * commercialWorkIdentityGating.test.ts.
 */

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function buildResolvedConfig(): ResolvedSalesAgentConfiguration {
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
    effectiveLoopConfiguration: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
    effectiveFollowUpConfiguration: SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT
  };
}

function runtimeIdentity(overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return {
    status: "ANONYMOUS",
    identityLevel: "LEVEL_0_ANONYMOUS",
    masterCustomerId: null,
    prestashopCustomerId: null,
    verificationRequired: false,
    requiredEvidence: [],
    readyToLink: false,
    conflictCode: null,
    policyCode: "NO_CHANNEL_EVIDENCE",
    evidenceRefs: [],
    ...overrides
  };
}

function atLevel(level: IdentityLevel, status: RuntimeIdentityStatus, overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return runtimeIdentity({ identityLevel: level, status, ...overrides });
}

function customerSessionDecision(identity: RuntimeIdentityContext): CustomerSessionDecisionContext {
  return {
    schemaVersion: "1.0.0",
    identity: { status: "identified", hasResolvedCustomer: true, source: "customer_service" },
    runtimeIdentity: identity,
    onboarding: null,
    contextAccess: "commercial_history",
    operations: { canAttemptResolve: true, canProposeCreateCustomer: true, canProposeLinkExternalIdentity: true }
  };
}

function buildSnapshot(env: R2BenchmarkEnvironment, overrides: Partial<CommercialContextSnapshot> = {}): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: { id: env.conversationId, publicId: "test-conv", channel: "whatsapp", provider: "meta", externalContactId: env.waId, status: "open", aiEnabled: true, humanOwnerActive: false, lastMessageAt: null },
    recentMessages: [],
    opportunity: {
      id: env.opportunityId,
      opportunityKey: `opp-${env.opportunityId}`,
      status: "open",
      stage: null,
      primaryIntent: "sales",
      currentSummary: null,
      nextActionType: null,
      nextActionDueAt: null,
      waitingFor: null,
      humanOwnerActive: false,
      aiBlocked: false,
      customerCandidateId: null,
      customerMasterId: env.masterCustomerId,
      leadId: null,
      conversationCaseId: env.conversationId,
      waId: env.waId,
      requirements: [],
      missingRequirements: [],
      productInterests: [],
      objections: [],
      signals: [],
      version: 1,
      lastActivityAt: new Date().toISOString(),
      closedAt: null
    },
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: true,
      hasNeedProfile: false,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false
    },
    identityConflict: null,
    shippingDestination: null,
    commercialLineItems: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: { source: "native_mariadb", conversationPublicId: "test-conv", currentTime: new Date().toISOString() },
    ...overrides
  } as CommercialContextSnapshot;
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function countCommercialWorkRows(conversationId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_commercial_work WHERE conversation_id = ?", [conversationId]);
  return Number(rows[0]?.count ?? 0);
}

// SUPERSEDED/CANCELLED steps are terminal and intentionally excluded: A08.6's
// existing supersession pattern (deriveCommercialObjectives.ts) is
// CommercialWork's pre-A07 mechanism for "a later turn's message re-resolves
// a still-pending intent" - it marks the OLD objective/step SUPERSEDED
// (never re-executed, never a duplicate execution risk) and derives a fresh
// one rather than mutating the original in place. What CIW14 actually cares
// about - the property A07 must not break - is that there is never more than
// ONE LIVE (non-terminal) CREATE_QUOTE step at a time.
async function countLiveCreateQuoteSteps(conversationId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM crm_commercial_work_steps s JOIN crm_commercial_work w ON w.id = s.commercial_work_id WHERE w.conversation_id = ? AND s.step_type = 'CREATE_QUOTE' AND s.status NOT IN ('SUPERSEDED', 'CANCELLED')",
    [conversationId]
  );
  return Number(rows[0]?.count ?? 0);
}

async function countOnboardingRows(conversationId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_customer_onboarding_state WHERE conversation_id = ?", [conversationId]);
  return Number(rows[0]?.count ?? 0);
}

function buildTrustedSession(env: R2BenchmarkEnvironment, identity: RuntimeIdentityContext): NativeCustomerSessionExecutionContext {
  return {
    conversationId: String(env.conversationId),
    opportunityId: String(env.opportunityId),
    trustedInbound: { channel: "whatsapp", externalId: env.waId, normalizedPhone: env.waId, messageId: uniqueSuffix("msg"), receivedAt: new Date().toISOString() },
    identity: { status: "anonymous", customerId: null, source: "none", localResolutionOutcome: "anonymous", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_absent" },
    runtimeIdentity: identity,
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

// ==========================================================================
// Gate effect end-to-end: an identity-insufficient CREATE_QUOTE never reaches
// the Quote Service capability, even against a real opportunity whose
// crm_opportunities.customer_master_id is already set (CIW04/CIW22) - proves
// the gate, not the underlying capability, is what blocks this turn.
// ==========================================================================

test("CIW04 (E2E): create_quote blocked by an insufficient RuntimeIdentityContext never reaches the Quote Service capability", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "create_quote" }] } }]);
    const snapshot = buildSnapshot(env, { customerSession: customerSessionDecision(atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED")) });

    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hazme la cotizacion",
      snapshot,
      provider,
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    assert.equal(result.ran, true);
    const objective = result.work?.objectives.find((item) => item.type === "CREATE_QUOTE");
    assert.equal(objective?.status, "WAITING_CUSTOMER");
    const blocker = objective?.blockers.find((item) => item.code === "IDENTITY_REQUIREMENT");
    assert.equal(blocker?.identityDecision?.status, "ONBOARDING_REQUIRED");
    assert.equal(result.work?.steps.find((step) => step.type === "CREATE_QUOTE")?.status, "WAITING_CUSTOMER");

    const created = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_quotes WHERE opportunity_id = ?", [env.opportunityId]);
    assert.equal(Number(created[0]?.count ?? 0), 0, "the capability must never have been reached");
  } finally {
    await env.teardown();
  }
});

test("CIW05 (E2E, regression): the exact same setup with SUFFICIENT identity proceeds past the gate normally", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "create_quote" }] } }]);
    const snapshot = buildSnapshot(env, {
      customerSession: customerSessionDecision(atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) }))
    });

    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hazme la cotizacion",
      snapshot,
      provider,
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    const objective = result.work?.objectives.find((item) => item.type === "CREATE_QUOTE");
    assert.notEqual(objective?.status, "WAITING_CUSTOMER");
    assert.equal(objective?.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), false);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// PARTE 13: reprojection/resume across turns - same work, same objective,
// step never duplicated, unblocks once identity improves next turn.
// ==========================================================================

test("CIW12/14/15/31 (E2E): identity upgraded on the NEXT turn unblocks the SAME CommercialWork - no new work row, never more than one LIVE CREATE_QUOTE step", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const messageId = uniqueSuffix("msg");

    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: messageId,
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hazme la cotizacion",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED")) }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "create_quote" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(first.work?.objectives.find((item) => item.type === "CREATE_QUOTE")?.status, "WAITING_CUSTOMER");
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    assert.equal(await countLiveCreateQuoteSteps(env.conversationId), 1);
    const firstWorkPublicId = first.work?.publicId;

    // Turn 2 re-sends create_quote (the customer confirming they still want
    // it, now that identity is sufficient) - CommercialWork's own pre-A07
    // supersession mechanism (deriveCommercialObjectives.ts, the same
    // mechanism SELECT_PRODUCTS/SET_DESTINATION already rely on for a
    // customer's later message) marks the old WAITING_CUSTOMER objective/step
    // SUPERSEDED and derives a fresh one - this is CommercialWork's normal,
    // safe cross-turn continuation, not a duplicate-execution risk (the old
    // step is terminal, never re-executed). What A07 must guarantee is what
    // this test actually asserts below: the SAME work row, never two LIVE
    // CREATE_QUOTE steps at once, and the new one no longer identity-blocked.
    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "aqui esta mi correo, ahora si hazme la cotizacion",
      snapshot: buildSnapshot(env, {
        customerSession: customerSessionDecision(atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) }))
      }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "create_quote" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // CIW15: same CommercialWork id - never a new work created for the same conversation/opportunity.
    assert.equal(second.work?.publicId, firstWorkPublicId);
    const liveCreateQuote = second.work?.objectives.filter((item) => item.type === "CREATE_QUOTE" && item.status !== "SUPERSEDED" && item.status !== "CANCELLED");
    assert.equal(liveCreateQuote?.length, 1, "exactly one LIVE CREATE_QUOTE objective, never two competing ones");
    // CIW12: no longer blocked on identity.
    assert.equal(liveCreateQuote?.[0]?.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), false);
    assert.notEqual(liveCreateQuote?.[0]?.status, "WAITING_CUSTOMER");
    // CIW14: never more than one LIVE CREATE_QUOTE step - the superseded one is terminal, never re-executed.
    assert.equal(await countLiveCreateQuoteSteps(env.conversationId), 1);
    // CIW31: restart/second-turn continuation never recreated the work row itself.
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// PARTE 8/9: onboarding activation reuses the EXISTING subsystem, registered
// with the correct purpose - never a second state machine.
// ==========================================================================

test("CIW06/09/28 (E2E): a blocked create_quote objective activates the EXISTING onboarding subsystem with purpose=quote, via customerSessionExecution", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const identity = atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED", { requiredEvidence: ["email"] });

    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hazme la cotizacion",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(identity) }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "create_quote" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, identity)
    });

    assert.equal(result.work?.objectives.find((item) => item.type === "CREATE_QUOTE")?.status, "WAITING_CUSTOMER");
    assert.equal(await countOnboardingRows(env.conversationId), 1, "the existing onboarding subsystem must have been activated");
    const onboarding = await queryRows<{ purpose: string; status: string }>("SELECT purpose, status FROM crm_customer_onboarding_state WHERE conversation_id = ?", [env.conversationId]);
    assert.equal(onboarding[0]?.purpose, "quote");
    assert.notEqual(onboarding[0]?.status, undefined);
  } finally {
    await env.teardown();
  }
});

test("CIW07 (E2E): a second turn with the same still-insufficient identity never activates a second onboarding row", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const identity = atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED", { requiredEvidence: ["email"] });

    for (let turn = 0; turn < 2; turn += 1) {
      await runCommercialWorkInboundCycle({
        conversationId: env.conversationId,
        waId: env.waId,
        inboundMessageId: uniqueSuffix("msg"),
        correlationId: uniqueSuffix("corr"),
        currentTime: new Date().toISOString(),
        customerMessage: turn === 0 ? "hazme la cotizacion" : "sigo esperando",
        snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(identity) }),
        provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: turn === 0 ? [{ type: "create_quote" }] : [] } }]),
        resolvedSalesAgentConfiguration: buildResolvedConfig(),
        customerSessionExecution: buildTrustedSession(env, identity)
      });
    }

    assert.equal(await countOnboardingRows(env.conversationId), 1, "onboarding must never be duplicated across turns");
  } finally {
    await env.teardown();
  }
});

test("without customerSessionExecution, the block is still enforced but onboarding is never activated (safe no-op, never a crash)", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hazme la cotizacion",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED")) }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "create_quote" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(result.work?.objectives.find((item) => item.type === "CREATE_QUOTE")?.status, "WAITING_CUSTOMER");
    assert.equal(await countOnboardingRows(env.conversationId), 0);
  } finally {
    await env.teardown();
  }
});

test("findIdentityOnboardingTrigger is exported and reachable from the module the runtime imports (wiring sanity check)", () => {
  assert.equal(typeof findIdentityOnboardingTrigger, "function");
});
