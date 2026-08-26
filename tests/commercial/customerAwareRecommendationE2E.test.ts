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
  // SALES-AGENT-R2-ID-R2-A12, Decision 5. No live Customer Profile service is
  // reachable in this sandbox - same environmental limitation
  // repeatPurchaseE2E.test.ts documents for get_customer_purchase_history.
  // The point of this file's first test is that, UNLIKE that sibling
  // capability (which maps this exact condition to a real FAILED outcome),
  // get_customer_recommendation_signal maps it to a real, observable
  // NO_SIGNAL/completed outcome - proven against the real Capability
  // Gateway/DB, not an injected fake.
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
 * SALES-AGENT-R2-ID-R2-A12. Mirrors repeatPurchaseE2E.test.ts's scope
 * exactly: real semantic planner (offline-scripted provider), real
 * projection, real identity gate, real same-work resume, real Capability
 * Gateway dispatch (a real crm_capability_executions row for
 * get_customer_recommendation_signal) - organic reachability through
 * runCommercialWorkInboundCycle, not an isolated unit call.
 *
 * What this test does NOT prove: a full search_products/Catalog happy path
 * with real candidates - no live Catalog Service is reachable in this
 * sandbox either. That data flow (signal -> query -> Catalog candidates ->
 * bounded presentation -> supersession into an ordinary select_products) is
 * proven in full, with injected fakes, by customerAwareRecommendationObjective.test.ts
 * and customerAwareRecommendationE2E.test.ts's own PII/no-duplicate-dispatch
 * checks below - same division of proof the sibling REPEAT_PURCHASE feature
 * already established.
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

async function countRecommendationSignalExecutions(opportunityId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = 'get_customer_recommendation_signal'",
    [opportunityId]
  );
  return Number(rows[0]?.count ?? 0);
}

test("CAR03/04/13 (E2E): identity upgraded LEVEL_2 -> LEVEL_3 unblocks the SAME work and genuinely dispatches get_customer_recommendation_signal, which degrades a real Customer-Profile-unavailable condition to NO_SIGNAL/completed - never WAITING_SYSTEM, never re-onboarding, unlike REPEAT_PURCHASE's real FAILED outcome in the identical environment", async () => {
  resetSharedCustomerProfileClientForTests();
  const env = await setupR2BenchmarkEnvironment();
  try {
    const provider = () => createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "customer_aware_recommendation" }] } }]);
    const level2Identity = atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) });

    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "que me recomiendas segun lo que compro",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(level2Identity) }),
      provider: provider(),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, level2Identity)
    });

    // CAR03: below LEVEL_3, the objective is identity-blocked and
    // get_customer_recommendation_signal is never dispatched.
    const firstObjective = first.work?.objectives.find((item) => item.type === "CUSTOMER_AWARE_RECOMMENDATION");
    assert.equal(firstObjective?.status, "WAITING_CUSTOMER");
    assert.equal(firstObjective?.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), true);
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    assert.equal(await countRecommendationSignalExecutions(env.opportunityId), 0, "must never dispatch below LEVEL_3");
    const firstWorkPublicId = first.work?.publicId;

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
      customerMessage: "ya vincule mi cuenta, sigo esperando esa recomendacion",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(level3Identity) }),
      provider: provider(),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, level3Identity)
    });

    // CAR04: same work, never a new row for the same conversation/opportunity.
    assert.equal(second.work?.publicId, firstWorkPublicId);
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);

    const liveObjectives = second.work?.objectives.filter((item) => item.type === "CUSTOMER_AWARE_RECOMMENDATION" && item.status !== "SUPERSEDED" && item.status !== "CANCELLED");
    assert.equal(liveObjectives?.length, 1, "exactly one LIVE CUSTOMER_AWARE_RECOMMENDATION objective, never two competing ones");
    assert.equal(liveObjectives?.[0]?.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), false);

    // The real Capability Gateway genuinely dispatched get_customer_recommendation_signal.
    assert.equal(await countRecommendationSignalExecutions(env.opportunityId), 1);
    const executions = await queryRows<{ execution_status: string; error_code: string | null; response_summary_json: string | null }>(
      "SELECT execution_status, error_code, response_summary_json FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = 'get_customer_recommendation_signal'",
      [env.opportunityId]
    );
    // CAR13/Decision 5, proven for real (not an injected fake): the exact
    // same "no live Customer Profile" condition that makes
    // get_customer_purchase_history genuinely FAIL in this sandbox
    // (repeatPurchaseE2E.test.ts) instead completes here with NO_SIGNAL -
    // the conversation is never blocked for lost personalization.
    assert.equal(executions[0]?.execution_status, "completed");
    assert.equal(executions[0]?.error_code, null);
    const responseSummary = JSON.parse(executions[0]?.response_summary_json ?? "null");
    assert.deepEqual(responseSummary, { status: "NO_SIGNAL" });

    // No queryHint and no signal - a plain clarifying question, never
    // WAITING_SYSTEM, never a re-triggered onboarding.
    assert.equal(liveObjectives?.[0]?.status, "WAITING_CUSTOMER");
    assert.equal(liveObjectives?.[0]?.missingRequirements.includes("RECOMMENDATION_QUERY_HINT"), true);

    // No PII/raw-CP-payload anywhere in the persisted request/response summary.
    const serialized = JSON.stringify(executions[0]).toLowerCase();
    for (const forbidden of ["email", "phone", "address", "wa_id"]) {
      assert.equal(serialized.includes(forbidden), false, `crm_capability_executions row must never contain "${forbidden}"`);
    }
  } finally {
    await env.teardown();
  }
});

test("CAR30 (E2E half): a restart while identity-blocked resumes correctly - re-running the same turn never creates a second work row or a duplicate dispatch", async () => {
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
        customerMessage: turn === 0 ? "que me recomiendas segun lo que compro" : "sigo esperando",
        snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) })) }),
        provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: turn === 0 ? [{ type: "customer_aware_recommendation" }] : [] } }]),
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });
    }

    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    assert.equal(await countRecommendationSignalExecutions(env.opportunityId), 0, "still below LEVEL_3 - must never dispatch");
  } finally {
    await env.teardown();
  }
});

test("CAR15 (E2E): a repeat_purchase-phrased plan still produces a REPEAT_PURCHASE objective, not CUSTOMER_AWARE_RECOMMENDATION", async () => {
  resetSharedCustomerProfileClientForTests();
  const env = await setupR2BenchmarkEnvironment();
  try {
    const level3Identity = atLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", {
      masterCustomerId: String(env.masterCustomerId),
      prestashopCustomerId: "7421",
      policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT"
    });
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero lo mismo de la ultima vez",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(level3Identity) }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "repeat_purchase" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, level3Identity)
    });

    assert.ok(result.work?.objectives.some((item) => item.type === "REPEAT_PURCHASE"));
    assert.equal(result.work?.objectives.some((item) => item.type === "CUSTOMER_AWARE_RECOMMENDATION"), false);
  } finally {
    await env.teardown();
  }
});
