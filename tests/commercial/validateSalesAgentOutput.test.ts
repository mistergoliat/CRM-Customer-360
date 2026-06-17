import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES } from "../../lib/brain/commercial/constants";
import { SALES_AGENT_TOOL_NAMES } from "../../lib/brain/commercial/salesAgentConstants";
import { SALES_AGENT_OUTPUT_CONTRACT_VERSION } from "../../lib/brain/commercial/sales-agent/validationTypes";
import { createFailedSafeResult } from "../../lib/brain/commercial/sales-agent/createFailedSafeResult";
import { validateSalesAgentOutput } from "../../lib/brain/commercial/sales-agent/validateSalesAgentOutput";
import type { SalesAgentOutputValidationContext } from "../../lib/brain/commercial/sales-agent/validationTypes";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";
const ALL_CAPABILITIES = [...SALES_AGENT_TOOL_NAMES];

function makeContext(overrides: Partial<SalesAgentOutputValidationContext> = {}): SalesAgentOutputValidationContext {
  return {
    expectedRunId: "run-001",
    contractVersion: SALES_AGENT_OUTPUT_CONTRACT_VERSION,
    allowedCapabilities: ALL_CAPABILITIES,
    requestedMode: "standard" as const,
    commercialContextSummary: {
      sourceShape: "brain_context",
      supportedContextShape: true,
      channel: "whatsapp",
      platform: "meta",
      department: "ventas",
      conversationCaseId: 1001,
      waId: "56912345678",
      email: "cliente@example.com",
      phone: "+56912345678",
      idCustomer: 10,
      idOrder: 20,
      invoiceNumber: 30,
      contactId: 40,
      caseStatus: "open",
      caseLifecycleStatus: "open",
      humanOwnershipActive: false,
      aiBlocked: false,
      manualReplyActive: false,
      hasCustomerCandidate: true,
      hasCustomerReference: true,
      hasConversationHistory: true,
      hasLatestCustomerMessage: true,
      hasLatestOutboundMessage: true,
      leadAvailable: false,
      opportunityAvailable: false,
      hasCommercialEntity: true,
      commercialIntentLegacy: "quote_requested",
      orderContextAvailable: true,
      productServiceContextAvailable: true,
      latestInboundAt: FIXED_TIME,
      latestOutboundAt: FIXED_TIME,
      recentMessagesCount: 2,
      recentMessagesLimit: COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES
    },
    currentTime: FIXED_TIME,
    strictMode: false,
    metadata: {
      safeTraceId: "trace-001"
    },
    ...overrides
  };
}

function makeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    source: "customer_message",
    summary: "El cliente preguntó por el producto.",
    verified: true,
    confidence: "high",
    reference: "msg-001",
    capturedAt: FIXED_TIME,
    expiresAt: null,
    ...overrides
  };
}

function makeBaseResult(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-001",
    contractVersion: SALES_AGENT_OUTPUT_CONTRACT_VERSION,
    outcome: "response_proposed",
    analysis: {
      summary: "Consulta de producto con intención comercial explícita.",
      qualificationState: "qualified",
      customerReadiness: "ready",
      productFit: "good",
      confidence: "high",
      riskLevel: "low",
      reasonCodes: ["customer_message_present"]
    },
    decision: {
      type: "respond_now",
      reason: "El resultado puede responder ahora.",
      confidence: "high",
      riskLevel: "low",
      requiresApproval: "none",
      errorCode: "none",
      reasonCodes: ["customer_message_present"],
      policyTags: ["commercial_reply"]
    },
    shouldRespondNow: true,
    shouldRequestTool: false,
    shouldRequestHuman: false,
    shouldEvaluateFollowUp: false,
    proposedActions: [],
    toolRequests: [],
    entityProposals: [],
    responseProposal: {
      messageIntent: "answer",
      draftText: "Hola, te comparto la informacion solicitada.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [makeEvidence()],
    policyAssessment: {
      status: "allowed",
      blocked: false,
      reason: "Sin bloqueo de policy.",
      confidence: "high",
      riskLevel: "low",
      approvalRequirement: "none",
      errorCode: "none",
      reasonCodes: [],
      policyTags: ["commercial_reply"]
    },
    warnings: [],
    rationale: {
      summary: "Resumen operacional breve.",
      evidence: ["Mensaje inbound del cliente."],
      counterEvidence: [],
      assumptions: [],
      riskFlags: [],
      missingInformation: [],
      policyRulesApplied: ["fail_closed_validation"]
    },
    metadata: {
      traceId: "trace-001"
    },
    ...overrides
  };
}

test("accepts a fully valid SalesAgentResult", () => {
  const input = makeBaseResult();
  const before = JSON.stringify(input);
  const result = validateSalesAgentOutput(input, makeContext());

  assert.equal(result.status, "valid");
  assert.equal(result.result?.runId, "run-001");
  assert.equal(result.result?.outcome, "response_proposed");
  assert.equal(result.result?.responseProposal?.messageIntent, "answer");
  assert.equal(result.result?.metadata.traceId, "trace-001");
  assert.equal(JSON.stringify(input), before);
  assert.notStrictEqual(result.result, input);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("rejects null root", () => {
  const result = validateSalesAgentOutput(null, makeContext());
  assert.equal(result.status, "failed_safe");
  assert.equal(result.result.outcome, "failed_safe");
});

test("rejects array root", () => {
  const result = validateSalesAgentOutput([], makeContext());
  assert.equal(result.status, "failed_safe");
  assert.equal(result.result.outcome, "failed_safe");
});

test("rejects invalid enum values", () => {
  const result = validateSalesAgentOutput(makeBaseResult({ outcome: "not_supported" }), makeContext());
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.code === "invalid_enum_value"));
});

test("rejects missing required fields", () => {
  const input = makeBaseResult();
  delete (input as { decision?: unknown }).decision;
  const result = validateSalesAgentOutput(input, makeContext());
  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "missing_required_field" || issue.code === "contract_incomplete"));
});

test("rejects runId mismatch", () => {
  const result = validateSalesAgentOutput(makeBaseResult({ runId: "run-xyz" }), makeContext());
  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "run_id_mismatch"));
});

test("rejects circular output metadata", () => {
  const metadata: Record<string, unknown> = { traceId: "trace-001" };
  metadata.self = metadata;
  const result = validateSalesAgentOutput(makeBaseResult({ metadata }), makeContext());
  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "non_serializable_value"));
});

test("sanitizes BigInt in metadata", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      metadata: {
        traceId: "trace-001",
        orderId: 9007199254740993n
      }
    }),
    makeContext()
  );

  assert.equal(result.status, "valid");
  assert.equal(typeof result.result?.metadata.orderId, "string");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("rejects prototype pollution keys", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      metadata: JSON.parse('{"__proto__":{"polluted":true}}')
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "forbidden_key"));
});

test("rejects excessive proposedActions", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      proposedActions: Array.from({ length: 10 }, (_, index) => ({
        type: "draft_response",
        priority: "medium",
        confidence: "high",
        riskLevel: "low",
        requiresApproval: "none",
        reason: `Action ${index}`,
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }))
    }),
    makeContext()
  );

  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.code === "excessive_array_length"));
});

test("rejects unknown tool requests", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      outcome: "tool_required",
      shouldRespondNow: false,
      shouldRequestTool: true,
      responseProposal: null,
      toolRequests: [
        {
          tool: "unknown_tool",
          purpose: "Buscar datos",
          status: "planned",
          requiredInputs: {},
          optionalInputs: null,
          urgency: "high",
          blocking: false,
          reason: "Se requiere una herramienta.",
          expectedEvidence: [],
          fallbackDecision: null
        }
      ]
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "invalid_enum_value" || issue.code === "contract_incomplete"));
});

test("rejects tool requests outside allowedCapabilities", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      toolRequests: [
        {
          tool: "searchProducts",
          purpose: "Buscar productos",
          status: "planned",
          requiredInputs: {},
          optionalInputs: null,
          urgency: "high",
          blocking: false,
          reason: "Herramienta no disponible en este contexto.",
          expectedEvidence: [],
          fallbackDecision: null
        }
      ]
    }),
    makeContext({ allowedCapabilities: ["getConversationHistory"] })
  );

  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.code === "invalid_tool_request"));
});

test("fails safe when a blocking tool is unavailable", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      toolRequests: [
        {
          tool: "searchProducts",
          purpose: "Buscar productos",
          status: "planned",
          requiredInputs: {},
          optionalInputs: null,
          urgency: "high",
          blocking: true,
          reason: "Herramienta bloqueante no disponible.",
          expectedEvidence: [],
          fallbackDecision: null
        }
      ]
    }),
    makeContext({ allowedCapabilities: ["getConversationHistory"] })
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "invalid_tool_request"));
});

test("rejects price claims without evidence", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      responseProposal: {
        messageIntent: "quote",
        draftText: "El precio es 10",
        language: "es",
        tone: "friendly",
        questions: [],
        claims: [
          {
            type: "price",
            value: "El precio es 10",
            evidenceSource: "customer_message",
            evidenceSummary: "El modelo afirma un precio.",
            verified: true,
            confidence: "high",
            expiresAt: FIXED_TIME
          }
        ],
        disclaimers: [],
        requiresApproval: "none",
        blockedClaims: [],
        confidence: "high"
      },
      evidence: []
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "sensitive_claim_without_evidence"));
});

test("rejects stock claims without verification", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      responseProposal: {
        messageIntent: "quote",
        draftText: "Hay stock.",
        language: "es",
        tone: "friendly",
        questions: [],
        claims: [
          {
            type: "stock",
            value: "Hay stock",
            evidenceSource: "customer_message",
            evidenceSummary: "Afirmacion de stock sin verificacion.",
            verified: false,
            confidence: "high",
            expiresAt: FIXED_TIME
          }
        ],
        disclaimers: [],
        requiresApproval: "none",
        blockedClaims: [],
        confidence: "high"
      }
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "sensitive_claim_without_evidence"));
});

test("accepts a general claim with valid evidence", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      responseProposal: {
        messageIntent: "answer",
        draftText: "Respuesta general.",
        language: "es",
        tone: "friendly",
        questions: [],
        claims: [
          {
            type: "general",
            value: "Informacion general del producto.",
            evidenceSource: "customer_message",
            evidenceSummary: "Se apoya en el mensaje del cliente.",
            verified: true,
            confidence: "high",
            expiresAt: null
          }
        ],
        disclaimers: [],
        requiresApproval: "none",
        blockedClaims: [],
        confidence: "high"
      }
    }),
    makeContext()
  );

  assert.equal(result.status, "valid");
  assert.equal(result.result?.responseProposal?.claims[0]?.type, "general");
});

test("rejects hard-blocked actions", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      proposedActions: [
        {
          type: "create_lead",
          priority: "high",
          confidence: "high",
          riskLevel: "high",
          requiresApproval: "blocked",
          reason: "Intento de crear lead.",
          payload: {},
          dependencies: [],
          policyTags: [],
          expiresAt: null
        }
      ]
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "hard_blocked_action"));
});

test("rejects forbidden entity proposal changes", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      entityProposals: [
        {
          entityType: "lead",
          proposedChanges: {
            forbiddenField: "x"
          },
          evidence: [makeEvidence()],
          confidence: "high",
          requiresApproval: "operator_review",
          reason: "Propuesta invalida.",
          policyTags: [],
          expiresAt: null
        }
      ]
    }),
    makeContext()
  );

  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.code === "invalid_entity_proposal"));
});

test("rejects tool_required without toolRequests", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      outcome: "tool_required",
      shouldRespondNow: false,
      shouldRequestTool: true,
      responseProposal: null,
      toolRequests: []
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "contract_incomplete"));
});

test("rejects response_proposed without responseProposal", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      responseProposal: null
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "contract_incomplete"));
});

test("rejects no_commercial_action with executable actions", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      outcome: "no_commercial_action",
      decision: {
        type: "no_commercial_action",
        reason: "No hay accion comercial.",
        confidence: "low",
        riskLevel: "low",
        requiresApproval: "none",
        errorCode: "none",
        reasonCodes: [],
        policyTags: []
      },
      shouldRespondNow: false,
      proposedActions: [
        {
          type: "draft_response",
          priority: "medium",
          confidence: "high",
          riskLevel: "low",
          requiresApproval: "none",
          reason: "Accion ejecutable no permitida.",
          payload: {},
          dependencies: [],
          policyTags: [],
          expiresAt: null
        }
      ]
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "contradictory_decision"));
});

test("rejects blocked_by_policy without a blocked policy assessment", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      outcome: "blocked_by_policy",
      decision: {
        type: "blocked_by_policy",
        reason: "Bloqueado por policy.",
        confidence: "low",
        riskLevel: "blocked",
        requiresApproval: "blocked",
        errorCode: "blocked_by_policy",
        reasonCodes: [],
        policyTags: []
      },
      policyAssessment: {
        status: "allowed",
        blocked: false,
        reason: "No bloqueado.",
        confidence: "low",
        riskLevel: "blocked",
        approvalRequirement: "blocked",
        errorCode: "blocked_by_policy",
        reasonCodes: [],
        policyTags: []
      }
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "contradictory_decision"));
});

test("flags excessive rationale arrays", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      rationale: {
        summary: "Razonamiento demasiado largo.",
        evidence: Array.from({ length: 25 }, (_, index) => `Evidencia ${index}`),
        counterEvidence: [],
        assumptions: [],
        riskFlags: [],
        missingInformation: [],
        policyRulesApplied: []
      }
    }),
    makeContext()
  );

  assert.equal(result.status, "valid");
  assert.ok(result.issues.some((issue) => issue.code === "excessive_array_length"));
});

test("trims excessive draftText without breaking the contract", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      responseProposal: {
        messageIntent: "answer",
        draftText: "a".repeat(5000),
        language: "es",
        tone: "friendly",
        questions: [],
        claims: [],
        disclaimers: [],
        requiresApproval: "none",
        blockedClaims: [],
        confidence: "high"
      }
    }),
    makeContext()
  );

  assert.equal(result.status, "valid");
  assert.equal((result.result?.responseProposal?.draftText?.length ?? 0) <= 2000, true);
  assert.ok(result.issues.some((issue) => issue.code === "excessive_string_length"));
});

test("accepts a valid failed_safe result", () => {
  const safeResult = createFailedSafeResult(makeContext(), {
    issues: [
      {
        code: "missing_required_field",
        level: "fatal",
        message: "Missing field.",
        path: ["runId"]
      }
    ],
    reason: "Missing field."
  });
  const result = validateSalesAgentOutput(safeResult, makeContext());

  assert.equal(result.status, "valid");
  assert.equal(result.result?.outcome, "failed_safe");
  assert.equal(result.result?.shouldRequestHuman, true);
});

test("is JSON serializable", () => {
  const result = validateSalesAgentOutput(makeBaseResult(), makeContext());
  assert.equal(result.status, "valid");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("is deterministic for the same input", () => {
  const input = makeBaseResult();
  const context = makeContext();
  const first = validateSalesAgentOutput(input, context);
  const second = validateSalesAgentOutput(input, context);

  assert.deepEqual(first, second);
});

test("sanitizes control values, Date, Map, Set, function and symbol in metadata", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      metadata: {
        safeTraceId: "trace-001",
        when: new Date(FIXED_TIME),
        map: new Map([["x", 1]]),
        set: new Set(["x"]),
        fn: () => "noop",
        sym: Symbol("x")
      }
    }),
    makeContext()
  );

  assert.notEqual(result.status, "valid");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("rejects nested prototype pollution keys", () => {
  const result = validateSalesAgentOutput(
    makeBaseResult({
      metadata: {
        constructor: {
          prototype: {
            polluted: true
          }
        }
      }
    }),
    makeContext()
  );

  assert.equal(result.status, "failed_safe");
  assert.ok(result.issues.some((issue) => issue.code === "forbidden_key"));
});
