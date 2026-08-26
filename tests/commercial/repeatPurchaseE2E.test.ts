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
  BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true",
  // Deterministic regardless of ambient .env: no live Customer Profile
  // service is reachable in this sandbox, so get_customer_purchase_history
  // is expected to resolve to a real, observable SYSTEM_UNAVAILABLE outcome
  // (see the test's own comment) - this is an environmental limitation, not
  // a code defect (same as this codebase's other external-service E2E
  // boundaries, e.g. Catalog/Carrier smoke tests).
  CUSTOMER_PROFILE_ENABLED: "false"
});

import { getPool, queryRows } from "@/lib/db";
import { resetSharedCustomerProfileClientForTests } from "@/lib/integrations/customer-profile";
import { runCommercialWorkInboundCycle } from "@/lib/brain/commercial/work/runCommercialWorkInboundCycle";
import { setupR2BenchmarkEnvironment, type R2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
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
 * SALES-AGENT-R2-ID-R2-A11, PARTE 4/20. REPEAT_PURCHASE is the first real
 * CommercialWork objective to reach A06's LEVEL_3 (customer_profile_history)
 * requirement through the fully organic runCommercialWorkInboundCycle path -
 * real semantic planner (offline-scripted provider, same discipline every
 * other planner test in this codebase already uses - no live LLM anywhere in
 * this test suite), real projection, real identity gate, real same-work
 * resume, real Capability Gateway dispatch (a real crm_capability_executions
 * row for get_customer_purchase_history). This is exactly the "harness-
 * bounded" gap A09's own release doc named (PSB18-20: "no live
 * CommercialObjectiveType reaches a LEVEL_3 requirement today").
 *
 * What this test does NOT prove: a successful Customer Profile HTTP round
 * trip - no live Customer Profile service is reachable in this sandbox
 * (CUSTOMER_PROFILE_ENABLED=false, matching this codebase's other external-
 * service E2E boundaries). That data-flow (history resolved -> Catalog
 * re-validation -> select_products) is proven in full, with injected fakes,
 * by repeatPurchaseObjective.test.ts and getCustomerPurchaseHistoryCapability.test.ts.
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

/**
 * SALES-AGENT-R2-ID-R2-A11. `snapshot.customerSession` feeds the PROJECTION's
 * identity gate only; get_customer_purchase_history's own execute() reads
 * identity independently from `customerSessionExecution.runtimeIdentity`
 * (context.trustedCustomerSession) - a real, defense-in-depth re-check the
 * capability performs on its own (never trusting the projection gate alone).
 * Both must carry the SAME identity for a turn to reach a real dispatch.
 */
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

async function countCommercialWorkRows(conversationId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_commercial_work WHERE conversation_id = ?", [conversationId]);
  return Number(rows[0]?.count ?? 0);
}

async function countPurchaseHistoryExecutions(opportunityId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = 'get_customer_purchase_history'",
    [opportunityId]
  );
  return Number(rows[0]?.count ?? 0);
}

test("RPH19/20/22 (E2E): identity upgraded LEVEL_2 -> LEVEL_3 on the NEXT turn unblocks the SAME CommercialWork and genuinely dispatches get_customer_purchase_history through the real Capability Gateway", async () => {
  resetSharedCustomerProfileClientForTests();
  const env = await setupR2BenchmarkEnvironment();
  try {
    const provider = () => createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "repeat_purchase" }] } }]);
    const level2Identity = atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) });

    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero comprar lo mismo de la ultima vez",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(level2Identity) }),
      provider: provider(),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, level2Identity)
    });

    // RPH03/18 organic: below LEVEL_3, the objective is identity-blocked and
    // get_customer_purchase_history is never dispatched.
    const firstObjective = first.work?.objectives.find((item) => item.type === "REPEAT_PURCHASE");
    assert.equal(firstObjective?.status, "WAITING_CUSTOMER");
    assert.equal(firstObjective?.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), true);
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    assert.equal(await countPurchaseHistoryExecutions(env.opportunityId), 0, "must never dispatch below LEVEL_3");
    const firstWorkPublicId = first.work?.publicId;

    // Turn 2: identity is now LEVEL_3 (a real prestashopCustomerId distinct
    // from master_customer.id - numeric-collision-safe fixture).
    const level3Identity = atLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", {
      masterCustomerId: String(env.masterCustomerId),
      prestashopCustomerId: "7421",
      policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT"
    });
    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "ya vincule mi cuenta, ahora si quiero lo mismo de la ultima vez",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(level3Identity) }),
      provider: provider(),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, level3Identity)
    });

    // RPH20: same work, never a new row for the same conversation/opportunity.
    assert.equal(second.work?.publicId, firstWorkPublicId);
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);

    const liveObjectives = second.work?.objectives.filter((item) => item.type === "REPEAT_PURCHASE" && item.status !== "SUPERSEDED" && item.status !== "CANCELLED");
    assert.equal(liveObjectives?.length, 1, "exactly one LIVE REPEAT_PURCHASE objective, never two competing ones");
    // RPH18/04: no longer identity-blocked once LEVEL_3 is genuinely reached.
    assert.equal(liveObjectives?.[0]?.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), false);
    assert.notEqual(liveObjectives?.[0]?.status, "WAITING_CUSTOMER");

    // The real Capability Gateway genuinely dispatched get_customer_purchase_history
    // (a real crm_capability_executions row) - this is the organic reachability
    // A09 could not previously demonstrate for any real CommercialObjectiveType.
    assert.equal(await countPurchaseHistoryExecutions(env.opportunityId), 1);
    const executions = await queryRows<{ execution_status: string; error_code: string | null }>(
      "SELECT execution_status, error_code FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = 'get_customer_purchase_history'",
      [env.opportunityId]
    );
    // No live Customer Profile service in this sandbox - a real, observable
    // system-owned outcome (never silently swallowed, never a fabricated
    // success), consistent with this environment's other external-service
    // boundaries.
    assert.equal(executions[0]?.execution_status, "failed");
    assert.equal(executions[0]?.error_code, "customer_profile_unavailable");
  } finally {
    await env.teardown();
  }
});

test("RPH22 (E2E): a restart while identity-blocked resumes correctly - re-running the same turn never creates a second work row or a duplicate dispatch", async () => {
  resetSharedCustomerProfileClientForTests();
  const env = await setupR2BenchmarkEnvironment();
  try {
    for (let turn = 0; turn < 2; turn += 1) {
      await runCommercialWorkInboundCycle({
        conversationId: env.conversationId,
        waId: env.waId,
        inboundMessageId: uniqueSuffix("msg"),
        correlationId: uniqueSuffix("corr"),
        currentTime: new Date().toISOString(),
        customerMessage: turn === 0 ? "quiero comprar lo mismo de la ultima vez" : "sigo esperando",
        snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) })) }),
        provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: turn === 0 ? [{ type: "repeat_purchase" }] : [] } }]),
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });
    }

    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    assert.equal(await countPurchaseHistoryExecutions(env.opportunityId), 0);
  } finally {
    await env.teardown();
  }
});
