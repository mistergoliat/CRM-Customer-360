import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionQueueItemCard } from "../../components/cases/ai-sdr/action-queue/ActionQueueItemCard";
import type { CrmAgentAction } from "../../lib/brain/commercial/action-queue";
import {
  buildSandboxAutonomyConfig,
  evaluateAgentActionForSandbox,
  maskWaId,
  parseAutonomousTestWaIds,
  type SandboxAutonomyAgentActionContext
} from "../../lib/brain/commercial/autonomy-sandbox";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";

function makeConfig(overrides: Partial<ReturnType<typeof buildSandboxAutonomyConfig>> = {}) {
  return buildSandboxAutonomyConfig({
    sandboxEnabled: true,
    autonomousReplyEnabled: true,
    whitelistedWaIds: ["56911111111"],
    allowedActionTypes: ["send_whatsapp_reply", "request_more_context"],
    maxRiskLevel: "low",
    ...overrides
  });
}

function makeContext(overrides: Partial<SandboxAutonomyAgentActionContext> = {}): SandboxAutonomyAgentActionContext {
  return {
    now: FIXED_TIME,
    caseId: "case-001",
    caseStatus: "open",
    lifecycleStatus: "open",
    humanOwnerActive: false,
    aiBlocked: false,
    requiresHuman: false,
    policyStatus: "allowed",
    conflictingActionExists: false,
    ...overrides
  };
}

function makeAction(overrides: Partial<CrmAgentAction> = {}): CrmAgentAction {
  return {
    id: null,
    actionId: "sandbox-action-001",
    idempotencyKey: "sandbox:test-001",
    opportunityId: "opp-001",
    decisionId: "decision-001",
    decisionRowId: 1,
    conversationCaseId: "case-001",
    messageId: "msg-001",
    waId: "56911111111",
    channel: "whatsapp",
    actionType: "send_whatsapp_reply",
    status: "proposed",
    riskLevel: "low",
    approvalRequirement: "none",
    draftPayload: null,
    finalPayload: null,
    executionPayload: null,
    draftMessage: "Hola, te ayudamos con tu consulta.",
    finalMessage: null,
    scheduledFor: null,
    expiresAt: "2026-06-20T12:00:00.000Z",
    attemptNumber: 1,
    maxAttempts: 3,
    blockReasons: [],
    cancelReason: null,
    failureReason: null,
    policyStatus: "allowed",
    policyNotes: [],
    source: "ai_sdr",
    createdBy: "ai",
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    cancelledAt: null,
    outboxMessageId: null,
    lifecycleVersion: "brain.commercial.action-queue.v1",
    policyVersion: "brain.commercial.policy.v1",
    runtimeVersion: "brain.commercial.runtime.v1",
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides
  };
}

function evaluate(overrides: {
  action?: Partial<CrmAgentAction>;
  context?: Partial<SandboxAutonomyAgentActionContext>;
  config?: Partial<ReturnType<typeof buildSandboxAutonomyConfig>>;
} = {}) {
  return evaluateAgentActionForSandbox(
    makeAction(overrides.action),
    makeContext(overrides.context),
    makeConfig(overrides.config)
  );
}

function scanSources() {
  const files = [
    "lib/brain/commercial/autonomy-sandbox/types.ts",
    "lib/brain/commercial/autonomy-sandbox/constants.ts",
    "lib/brain/commercial/autonomy-sandbox/parseWhitelist.ts",
    "lib/brain/commercial/autonomy-sandbox/validateAutonomousReplyCandidate.ts",
    "lib/brain/commercial/autonomy-sandbox/buildSandboxExecutionPreview.ts",
    "lib/brain/commercial/autonomy-sandbox/evaluateSandboxAutonomy.ts",
    "lib/brain/commercial/autonomy-sandbox/index.ts",
    "components/cases/ai-sdr/action-queue/ActionQueuePanel.tsx",
    "components/cases/ai-sdr/action-queue/ActionQueueItemCard.tsx"
  ];

  return files.map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
}

test("sandbox disabled blocks by sandbox flag", () => {
  const result = evaluate({
    config: {
      sandboxEnabled: false
    }
  });

  assert.equal(result.status, "disabled");
  assert.equal(result.eligible, false);
  assert.ok(result.blockReasons.includes("sandbox_disabled"));
});

test("autonomous reply disabled blocks by reply flag", () => {
  const result = evaluate({
    config: {
      autonomousReplyEnabled: false
    }
  });

  assert.equal(result.status, "disabled");
  assert.ok(result.blockReasons.includes("autonomous_reply_disabled"));
});

test("recipient missing is invalid", () => {
  const result = evaluate({
    action: {
      waId: null
    }
  });

  assert.equal(result.status, "invalid");
  assert.ok(result.blockReasons.includes("missing_recipient"));
});

test("recipient not authorized is blocked", () => {
  const result = evaluate({
    config: {
      whitelistedWaIds: ["56922222222"]
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("recipient_not_whitelisted"));
});

test("exact whitelist match is eligible", () => {
  const result = evaluate();

  assert.equal(result.status, "eligible");
  assert.equal(result.eligible, true);
  assert.equal(result.blockReasons.length, 0);
});

test("partial whitelist match does not pass", () => {
  const result = evaluate({
    action: {
      waId: "5691111111"
    },
    config: {
      whitelistedWaIds: ["56911111111"]
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("recipient_not_whitelisted"));
});

test("wa_id normalization works across formatting", () => {
  const result = evaluate({
    action: {
      waId: "+56 9 1111 1111"
    },
    config: {
      whitelistedWaIds: ["56911111111"]
    }
  });

  assert.equal(result.status, "eligible");
});

test("duplicate whitelist entries are deduped by parser", () => {
  const parsed = parseAutonomousTestWaIds("56911111111, 56911111111, 56922222222");
  assert.deepEqual(parsed, ["56911111111", "56922222222"]);

  const result = evaluate({
    config: {
      whitelistedWaIds: parsed
    }
  });

  assert.equal(result.status, "eligible");
});

test("unsupported channel is blocked", () => {
  const result = evaluate({
    action: {
      channel: "email"
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsupported_channel"));
});

test("unsupported action type is blocked", () => {
  const result = evaluate({
    action: {
      actionType: "schedule_followup"
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsupported_action_type"));
});

test("medium risk is blocked", () => {
  const result = evaluate({
    action: {
      riskLevel: "medium"
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("risk_too_high"));
});

test("high risk is blocked", () => {
  const result = evaluate({
    action: {
      riskLevel: "high"
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("risk_too_high"));
});

test("approval requirement moves the action to review", () => {
  const result = evaluate({
    action: {
      approvalRequirement: "operator_review"
    }
  });

  assert.equal(result.status, "requires_review");
  assert.ok(result.blockReasons.includes("approval_required"));
});

test("human owner active blocks autonomy", () => {
  const result = evaluate({
    context: {
      humanOwnerActive: true
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("human_owner_active"));
});

test("ai blocked blocks autonomy", () => {
  const result = evaluate({
    context: {
      aiBlocked: true
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("ai_blocked"));
});

test("closed case blocks autonomy", () => {
  const result = evaluate({
    context: {
      caseStatus: "closed"
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("case_closed"));
});

test("expired action is expired", () => {
  const result = evaluate({
    action: {
      expiresAt: "2026-06-16T12:00:00.000Z"
    }
  });

  assert.equal(result.status, "expired");
  assert.ok(result.blockReasons.includes("action_expired"));
});

test("missing idempotency key blocks autonomy", () => {
  const result = evaluate({
    action: {
      idempotencyKey: ""
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("missing_idempotency_key"));
});

test("ACS-R1-05-T06.2: legitimate commercial phrases are no longer lexically blocked", () => {
  const legitimatePhrases = [
    "¿Quieres que revise los precios?",
    "Puedo confirmar el stock.",
    "Voy a comparar las alternativas.",
    "No puedo garantizarte disponibilidad sin revisarla.",
    "Antes de confirmar el precio debo consultar el catálogo.",
    "Hay stock asegurado para hoy."
  ];

  for (const draftMessage of legitimatePhrases) {
    const result = evaluate({ action: { draftMessage, finalMessage: null } });
    assert.equal(result.status, "eligible", `expected "${draftMessage}" to be eligible, got blocked by ${result.blockReasons.join(",")}`);
    assert.ok(!result.blockReasons.includes("unsafe_message"));
  }
});

test("empty message still blocks autonomy on technical grounds", () => {
  const result = evaluate({
    action: {
      draftMessage: "",
      finalMessage: null
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsafe_message"));
});

test("overlong message still blocks autonomy on technical grounds", () => {
  const result = evaluate({
    action: {
      draftMessage: "x".repeat(801),
      finalMessage: null
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsafe_message"));
});

test("credential marker still blocks autonomy", () => {
  const result = evaluate({
    action: {
      draftMessage: "Authorization: Bearer sk-abc123def456",
      finalMessage: null
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsafe_payload"));
});

test("raw JSON payload still blocks autonomy", () => {
  const result = evaluate({
    action: {
      draftMessage: JSON.stringify({ productId: "123", price: 79990 }),
      finalMessage: null
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsafe_payload"));
});

test("unresolved placeholder blocks autonomy", () => {
  const result = evaluate({
    action: {
      draftMessage: "Hola {{name}}",
      finalMessage: null
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("unsafe_payload"));
});

test("conflicting action blocks autonomy", () => {
  const result = evaluate({
    context: {
      conflictingActionExists: true
    }
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockReasons.includes("duplicate_or_conflicting_action"));
});

test("eligible low-risk reply stays eligible", () => {
  const result = evaluate();

  assert.equal(result.status, "eligible");
  assert.equal(result.eligible, true);
  assert.equal(result.executionPreview.canExecute, false);
});

test("planned low-risk reply stays eligible", () => {
  const result = evaluate({
    action: {
      status: "planned",
      outboxMessageId: null
    }
  });

  assert.equal(result.status, "eligible");
  assert.equal(result.executionPreview.canExecute, false);
});

test("eligible request_more_context stays eligible", () => {
  const result = evaluate({
    action: {
      actionType: "request_more_context",
      draftMessage: "Necesito tu comuna para continuar.",
      waId: "56911111111"
    }
  });

  assert.equal(result.status, "eligible");
  assert.equal(result.executionPreview.canExecute, false);
});

test("eligible sandbox actions still render with canExecute false", () => {
  const result = evaluate({
    action: {
      actionType: "request_more_context",
      draftMessage: "Necesito tu comuna para continuar.",
      waId: "56911111111"
    }
  });

  const markup = renderToStaticMarkup(
    createElement(ActionQueueItemCard, {
      item: {
        actionId: result.actionId,
        actionType: result.actionType,
        status: "eligible",
        riskLevel: result.riskLevel,
        approvalRequirement: result.approvalRequirement,
        draftMessage: result.executionPreview.messagePreview,
        scheduledFor: null,
        blockReasons: result.blockReasons,
        cancelReason: null,
        rationale: "Sandbox preview only.",
        idempotencyKey: result.executionPreview.idempotencyKey,
        persisted: false,
        executable: false,
        source: "next_action_json",
        sandboxAutonomy: result
      }
    })
  );

  assert.equal(result.executionPreview.canExecute, false);
  assert.ok(markup.includes("Sandbox eligibility"));
  assert.ok(markup.includes("Recipient"));
  assert.ok(markup.includes("Whitelist"));
  assert.ok(markup.includes("Execution"));
  assert.ok(markup.includes("disabled in current milestone"));
});

test("recipient masking keeps the number hidden", () => {
  assert.equal(maskWaId("56912345678"), "569*****678");
});

test("sandbox integration files do not add DB, outbox, send, Meta or n8n code", () => {
  const source = scanSources();

  assert.equal(/INSERT INTO|queryRows|PoolConnection|safeQueryRows/i.test(source), false);
  assert.equal(/brain_message_outbox|outboxMessageId/i.test(source), false);
  assert.equal(/sendWhatsApp|sendMessage|fetch\(.*graph\.facebook/i.test(source), false);
  assert.equal(/Meta send|graph\.facebook/i.test(source), false);
  assert.equal(/n8n_/i.test(source), false);
});
