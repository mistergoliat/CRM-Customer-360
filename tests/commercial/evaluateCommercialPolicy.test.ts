import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMERCIAL_POLICY_CONTRACT_VERSION,
  COMMERCIAL_POLICY_DEFAULT_FLAGS,
  COMMERCIAL_POLICY_VERSION,
  evaluateCommercialPolicy,
  createCommercialPolicyFailedSafe
} from "../../lib/brain/commercial/policy";
import { SALES_AGENT_OUTPUT_CONTRACT_VERSION } from "../../lib/brain/commercial/sales-agent/validationTypes";
import type { CommercialPolicyInput } from "../../lib/brain/commercial/policy";
import type { SalesAgentEvidence, SalesAgentResult } from "../../lib/brain/commercial/sales-agent/validationTypes";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";

function makeEvidence(overrides: Partial<SalesAgentEvidence> = {}): SalesAgentEvidence {
  return {
    source: "customer_message",
    summary: "Mensaje base del cliente.",
    verified: true,
    confidence: "high",
    reference: "msg-001",
    capturedAt: FIXED_TIME,
    expiresAt: null,
    ...overrides
  };
}

function makeBaseResult(overrides: Record<string, unknown> = {}): SalesAgentResult {
  return {
    runId: "run-001",
    contractVersion: SALES_AGENT_OUTPUT_CONTRACT_VERSION,
    outcome: "response_proposed",
    analysis: {
      summary: "Consulta comercial segura.",
      qualificationState: "qualified",
      customerReadiness: "ready",
      productFit: "good",
      confidence: "high",
      riskLevel: "low",
      reasonCodes: ["customer_message_present"]
    },
    decision: {
      type: "respond_now",
      reason: "El caso puede responderse.",
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
      claims: [
        {
          type: "general",
          value: "Informacion general.",
          evidenceSource: "customer_message",
          evidenceSummary: "Base general del cliente.",
          verified: true,
          confidence: "high",
          expiresAt: null
        }
      ],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [makeEvidence()],
    policyAssessment: {
      status: "allowed",
      blocked: false,
      reason: "Sin bloqueo.",
      confidence: "high",
      riskLevel: "low",
      approvalRequirement: "none",
      errorCode: "none",
      reasonCodes: [],
      policyTags: ["commercial_reply"]
    },
    warnings: [],
    rationale: {
      summary: "Resumen operacional.",
      evidence: ["Mensaje inbound."],
      counterEvidence: [],
      assumptions: [],
      riskFlags: [],
      missingInformation: [],
      policyRulesApplied: []
    },
    metadata: {
      traceId: "trace-001"
    },
    ...overrides
  };
}

function makePolicyInput(overrides: Partial<CommercialPolicyInput> = {}): CommercialPolicyInput {
  return {
    salesAgentResult: overrides.salesAgentResult ?? makeBaseResult(),
    currentTime: FIXED_TIME,
    contractVersion: COMMERCIAL_POLICY_CONTRACT_VERSION,
    policyVersion: COMMERCIAL_POLICY_VERSION,
    allowedCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"],
    commercialContext: {
      sourceShape: "sales_agent_input",
      supportedContextShape: true
    },
    customerContext: null,
    opportunityContext: null,
    followUpContext: null,
    channelContext: {
      channel: "whatsapp",
      available: true,
      outboundAllowed: true,
      manualApprovalRequired: false,
      optOut: false,
      quietHoursActive: false,
      humanOwnerActive: false,
      aiBlocked: false,
      identityConflict: false,
      recentCustomerReply: false,
      recentHumanContact: false
    },
    operatorContext: null,
    featureFlags: {
      ...COMMERCIAL_POLICY_DEFAULT_FLAGS,
      commercialPolicyEnabled: true,
      allowDraftReplies: true,
      allowToolRequests: true,
      allowEntityProposals: true,
      allowFollowUpEvaluation: true,
      allowInternalTasks: true,
      allowQuoteDraftRequests: true,
      allowOperatorReviewRequests: true,
      allowSensitiveClaims: false,
      allowOutboundProposals: true
    },
    metadata: {
      safeTraceId: "policy-001"
    },
    ...overrides
  };
}

test("policy disabled fails safe", () => {
  const result = evaluateCommercialPolicy(
    makePolicyInput({
      featureFlags: {
        ...COMMERCIAL_POLICY_DEFAULT_FLAGS,
        commercialPolicyEnabled: false
      }
    })
  );

  assert.equal(result.status, "failed_safe");
  assert.equal(result.overallDecision, "failed_safe");
  assert.equal(result.governedResult.outcome, "failed_safe");
});

test("allows a valid SalesAgentResult with no sensitive claims", () => {
  const result = evaluateCommercialPolicy(makePolicyInput());

  assert.equal(result.status, "allowed");
  assert.equal(result.overallDecision, "allow");
  assert.equal(result.blockedClaims.length, 0);
  assert.equal(result.governedResult.responseProposal?.claims.length, 1);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("keeps a price claim with verified evidence", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "quote",
      draftText: "El precio es informativo.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [
        {
          type: "price",
          value: "Precio referencial.",
          evidenceSource: "tool_result",
          evidenceSummary: "Precio desde una fuente autorizada.",
          verified: true,
          confidence: "high",
          expiresAt: "2026-06-18T00:00:00.000Z"
        }
      ],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [
      makeEvidence({
        source: "tool_result",
        summary: "Fuente de precio autorizada.",
        expiresAt: "2026-06-18T00:00:00.000Z"
      })
    ]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: {
        ...makePolicyInput().featureFlags,
        allowSensitiveClaims: true
      }
    })
  );

  assert.equal(result.status, "allowed");
  assert.equal(result.governedResult.responseProposal?.claims[0]?.type, "price");
});

test("blocks a price claim without evidence", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "quote",
      draftText: "El precio es informativo.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [
        {
          type: "price",
          value: "Precio sin soporte.",
          evidenceSource: "customer_message",
          evidenceSummary: "Sin evidencia autorizada.",
          verified: false,
          confidence: "high",
          expiresAt: null
        }
      ],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    }
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: {
        ...makePolicyInput().featureFlags,
        allowSensitiveClaims: true
      }
    })
  );

  assert.notEqual(result.status, "allowed");
  assert.equal(result.blockedClaims.length, 1);
  assert.ok(result.issues.some((issue) => issue.code === "sensitive_claim_blocked" || issue.code === "evidence_unverified" || issue.code === "claim_source_not_authorized"));
});

// ACS-R1-05-T06.2 (P1 correction): commitment grounding. The same declarative
// draftText sentence must be allowed when backed by a real, verified claim
// and require review when the Sales Agent wrote the fact in prose without
// ever declaring a matching claim - evaluateCommercialClaims.ts alone cannot
// catch the second case because it only ever governs claims that were
// actually declared.

test("a declarative catalog price statement is allowed when backed by a verified claim", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "quote",
      draftText: "El precio informado por catálogo es $500.000.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [
        {
          type: "price",
          value: "$500.000",
          evidenceSource: "tool_result",
          evidenceSummary: "Precio hidratado desde el catalogo real.",
          verified: true,
          confidence: "high",
          expiresAt: "2026-06-18T00:00:00.000Z"
        }
      ],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [makeEvidence({ source: "tool_result", summary: "Fuente de precio autorizada.", expiresAt: "2026-06-18T00:00:00.000Z" })]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: { ...makePolicyInput().featureFlags, allowSensitiveClaims: true }
    })
  );

  assert.equal(result.status, "allowed");
  assert.ok(!result.warnings.includes("commercial_statement_missing_evidence"));
});

test("the identical declarative catalog price statement requires review when no matching claim was declared at all", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "answer",
      draftText: "El precio informado por catálogo es $500.000.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    }
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "requires_review");
  assert.ok(result.warnings.includes("commercial_statement_missing_evidence"));
  assert.ok(result.appliedRules.includes("POLICY-DRAFT-STATEMENT-EVIDENCE"));
  // ACS-R1-05-T06.2 (second correction, section 8): requires_review must
  // carry the same authority into requiresApproval, never leave it "none".
  assert.equal(result.requiresApproval, "operator_review");
});

// ACS-R1-05-T06.2 (second correction, section 4/5): instance-level grounding.
// A verified claim only grounds a declarative statement about the SAME
// concrete value it attests, never any statement of the same claim type.

function priceClaim(value: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "price" as const,
    value,
    evidenceSource: "tool_result" as const,
    evidenceSummary: "Precio hidratado desde el catalogo real.",
    verified: true,
    confidence: "high" as const,
    expiresAt: "2026-06-18T00:00:00.000Z",
    ...overrides
  };
}

function withDraftAndClaims(draftText: string, claims: ReturnType<typeof priceClaim>[]) {
  return makeBaseResult({
    responseProposal: {
      messageIntent: "answer",
      draftText,
      language: "es",
      tone: "friendly",
      questions: [],
      claims,
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: claims.length > 0 ? [makeEvidence({ source: "tool_result", summary: "Fuente de precio autorizada.", expiresAt: "2026-06-18T00:00:00.000Z" })] : []
  });
}

function evaluateWithSensitiveClaims(salesAgentResult: SalesAgentResult) {
  return evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: { ...makePolicyInput().featureFlags, allowSensitiveClaims: true }
    })
  );
}

test("same type + same concrete value: grounded and allowed (task example: jaula A cuesta $500.000)", () => {
  const salesAgentResult = withDraftAndClaims("La jaula A cuesta $500.000.", [priceClaim("500000")]);
  const result = evaluateWithSensitiveClaims(salesAgentResult);

  assert.equal(result.status, "allowed");
  assert.ok(!result.warnings.includes("commercial_statement_missing_evidence"));
});

test("same type + different value (different product): requires review (task example: jaula B cuesta $900.000, claim is for jaula A at $500.000)", () => {
  const salesAgentResult = withDraftAndClaims("La jaula B cuesta $900.000.", [priceClaim("500000")]);
  const result = evaluateWithSensitiveClaims(salesAgentResult);

  assert.equal(result.status, "requires_review");
  assert.ok(result.warnings.includes("commercial_statement_missing_evidence"));
  assert.equal(result.requiresApproval, "operator_review");
});

test("same type + different currency: requires review even when the numeric amount matches", () => {
  const salesAgentResult = withDraftAndClaims("El precio es $500.000.", [priceClaim("500000 USD")]);
  const result = evaluateWithSensitiveClaims(salesAgentResult);

  assert.equal(result.status, "requires_review");
  assert.ok(result.warnings.includes("commercial_statement_missing_evidence"));
});

test("unverified claim never grounds a declarative statement, even of the same type", () => {
  const salesAgentResult = withDraftAndClaims("El precio es $500.000.", [priceClaim("500000", { verified: false })]);
  const result = evaluateWithSensitiveClaims(salesAgentResult);

  assert.equal(result.status, "requires_review");
});

test("claim from a weak/unauthorized evidence source never grounds a declarative statement", () => {
  const salesAgentResult = withDraftAndClaims("El precio es $500.000.", [priceClaim("500000", { evidenceSource: "customer_message" })]);
  const result = evaluateWithSensitiveClaims(salesAgentResult);

  assert.equal(result.status, "requires_review");
});

test("a claim of an unrelated type never grounds a different-type declarative statement", () => {
  const salesAgentResult = withDraftAndClaims("El stock está disponible.", [priceClaim("500000")]);
  const result = evaluateWithSensitiveClaims(salesAgentResult);

  assert.equal(result.status, "requires_review");
});

test("questions and pending-action sentences about sensitive topics never require grounding", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "clarify",
      draftText: "¿Quieres que revise el precio? Voy a consultar el stock. Necesito confirmar el despacho.",
      language: "es",
      tone: "friendly",
      questions: ["¿Quieres que revise el precio?"],
      claims: [],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    }
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "allowed");
  assert.ok(!result.warnings.includes("commercial_statement_missing_evidence"));
});

test("downgrades stale stock claims to review", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "quote",
      draftText: "Hay stock.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [
        {
          type: "stock",
          value: "Hay stock.",
          evidenceSource: "tool_result",
          evidenceSummary: "Stock antiguo.",
          verified: true,
          confidence: "high",
          expiresAt: "2026-06-16T00:00:00.000Z"
        }
      ],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [
      makeEvidence({
        source: "tool_result",
        summary: "Stock antiguo.",
        capturedAt: "2026-06-10T00:00:00.000Z",
        expiresAt: "2026-06-16T00:00:00.000Z"
      })
    ]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: {
        ...makePolicyInput().featureFlags,
        allowSensitiveClaims: true
      }
    })
  );

  assert.equal(result.status, "requires_review");
  assert.equal(result.governedResult.policyAssessment.status, "review");
  assert.ok(result.issues.some((issue) => issue.code === "evidence_stale"));
});

test("keeps a delivery claim with explicit approval", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "answer",
      draftText: "La entrega es estimada.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [
        {
          type: "delivery",
          value: "Entrega estimada.",
          evidenceSource: "operator_input",
          evidenceSummary: "Estimacion aprobada por operador.",
          verified: true,
          confidence: "high",
          expiresAt: "2026-06-18T00:00:00.000Z"
        }
      ],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [
      makeEvidence({
        source: "operator_input",
        summary: "Estimacion aprobada por operador.",
        capturedAt: FIXED_TIME
      })
    ]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: {
        ...makePolicyInput().featureFlags,
        allowSensitiveClaims: true
      }
    })
  );

  assert.equal(result.status, "requires_review");
  assert.equal(result.requiresApproval, "explicit_operator_approval");
});

test("keeps an order status claim supported by tool evidence", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "answer",
      draftText: "El estado del pedido es visible.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [
        {
          type: "order_status",
          value: "Pedido pagado.",
          evidenceSource: "tool_result",
          evidenceSummary: "Estado proveniente de herramienta.",
          verified: true,
          confidence: "high",
          expiresAt: "2026-06-18T00:00:00.000Z"
        }
      ],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [makeEvidence({ source: "tool_result" })]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: {
        ...makePolicyInput().featureFlags,
        allowSensitiveClaims: true
      }
    })
  );

  assert.equal(result.status, "allowed");
  assert.equal(result.governedResult.responseProposal?.claims[0]?.type, "order_status");
});

test("blocks a hard-blocked action", () => {
  const salesAgentResult = makeBaseResult({
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
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "blocked");
  assert.equal(result.blockedActions.length, 1);
  assert.ok(result.issues.some((issue) => issue.code === "hard_blocked_action"));
});

test("allows a low-risk draft response action", () => {
  const salesAgentResult = makeBaseResult({
    proposedActions: [
      {
        type: "draft_response",
        priority: "low",
        confidence: "high",
        riskLevel: "low",
        requiresApproval: "none",
        reason: "Borrador util.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "allowed");
  assert.equal(result.governedResult.proposedActions.length, 1);
});

test("marks a human review action as review", () => {
  const salesAgentResult = makeBaseResult({
    proposedActions: [
      {
        type: "request_human_review",
        priority: "medium",
        confidence: "high",
        riskLevel: "medium",
        requiresApproval: "review",
        reason: "Necesita revision humana.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "requires_review");
  assert.equal(result.governedResult.shouldRequestHuman, true);
});

test("keeps an outbound message proposal with explicit approval", () => {
  const salesAgentResult = makeBaseResult({
    proposedActions: [
      {
        type: "send_whatsapp_message",
        priority: "high",
        confidence: "high",
        riskLevel: "high",
        requiresApproval: "none",
        reason: "Enviar mensaje al cliente.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: {
        ...makePolicyInput().featureFlags,
        allowOutboundProposals: true
      }
    })
  );

  assert.equal(result.status, "requires_review");
  assert.equal(result.requiresApproval, "explicit_operator_approval");
});

test("deduplicates equivalent actions", () => {
  const salesAgentResult = makeBaseResult({
    proposedActions: [
      {
        type: "draft_response",
        priority: "low",
        confidence: "high",
        riskLevel: "low",
        requiresApproval: "none",
        reason: "Mismo borrador.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      },
      {
        type: "draft_response",
        priority: "low",
        confidence: "high",
        riskLevel: "low",
        requiresApproval: "none",
        reason: "Mismo borrador.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.governedResult.proposedActions.length, 1);
  assert.ok(result.issues.some((issue) => issue.code === "duplicate_action"));
});

test("blocks an expired action", () => {
  const salesAgentResult = makeBaseResult({
    proposedActions: [
      {
        type: "draft_response",
        priority: "low",
        confidence: "high",
        riskLevel: "low",
        requiresApproval: "none",
        reason: "Accion expirada.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: "2026-06-16T00:00:00.000Z"
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "expired_action"));
});

test("allows a tool request inside the capability allowlist", () => {
  const salesAgentResult = makeBaseResult({
    shouldRequestTool: true,
    responseProposal: null,
    outcome: "tool_required",
    decision: {
      type: "request_tool",
      reason: "Se requiere una herramienta.",
      confidence: "high",
      riskLevel: "medium",
      requiresApproval: "review",
      errorCode: "none",
      reasonCodes: [],
      policyTags: []
    },
    toolRequests: [
      {
        tool: "searchKnowledge",
        purpose: "Buscar informacion.",
        status: "planned",
        requiredInputs: {},
        optionalInputs: null,
        urgency: "medium",
        blocking: true,
        reason: "Se requiere herramienta.",
        expectedEvidence: [],
        fallbackDecision: "request_human",
        confidence: "high",
        riskLevel: "low"
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "requires_review");
  assert.equal(result.toolRequestAssessments[0]?.status, "review");
});

test("blocks a tool outside the allowlist", () => {
  const salesAgentResult = makeBaseResult({
    shouldRequestTool: true,
    responseProposal: null,
    outcome: "tool_required",
    decision: {
      type: "request_tool",
      reason: "Se requiere una herramienta.",
      confidence: "high",
      riskLevel: "medium",
      requiresApproval: "review",
      errorCode: "none",
      reasonCodes: [],
      policyTags: []
    },
    toolRequests: [
      {
        tool: "searchProducts",
        purpose: "Buscar productos.",
        status: "planned",
        requiredInputs: {},
        optionalInputs: null,
        urgency: "medium",
        blocking: true,
        reason: "Herramienta no permitida.",
        expectedEvidence: [],
        fallbackDecision: "request_human",
        confidence: "high",
        riskLevel: "low"
      }
    ]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      allowedCapabilities: ["getConversationHistory"]
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "tool_not_allowed"));
});

test("blocks a blocking tool request when tools are disabled", () => {
  const salesAgentResult = makeBaseResult({
    shouldRequestTool: true,
    responseProposal: null,
    outcome: "tool_required",
    decision: {
      type: "request_tool",
      reason: "Se requiere una herramienta.",
      confidence: "high",
      riskLevel: "medium",
      requiresApproval: "review",
      errorCode: "none",
      reasonCodes: [],
      policyTags: []
    },
    toolRequests: [
      {
        tool: "searchKnowledge",
        purpose: "Buscar informacion.",
        status: "planned",
        requiredInputs: {},
        optionalInputs: null,
        urgency: "medium",
        blocking: true,
        reason: "Herramienta bloqueante no disponible.",
        expectedEvidence: [],
        fallbackDecision: "request_human",
        confidence: "high",
        riskLevel: "low"
      }
    ]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: {
        ...makePolicyInput().featureFlags,
        allowToolRequests: false
      }
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "tool_unavailable"));
});

test("blocks a tool request that claims execution", () => {
  const salesAgentResult = makeBaseResult({
    shouldRequestTool: true,
    responseProposal: null,
    outcome: "tool_required",
    decision: {
      type: "request_tool",
      reason: "Se requiere una herramienta.",
      confidence: "high",
      riskLevel: "medium",
      requiresApproval: "review",
      errorCode: "none",
      reasonCodes: [],
      policyTags: []
    },
    toolRequests: [
      {
        tool: "searchKnowledge",
        purpose: "Herramienta ya ejecutada y completada.",
        status: "planned",
        requiredInputs: {},
        optionalInputs: null,
        urgency: "medium",
        blocking: true,
        reason: "Ya fue ejecutada.",
        expectedEvidence: [],
        fallbackDecision: "request_human",
        confidence: "high",
        riskLevel: "low"
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "tool_execution_claimed"));
});

test("keeps a low-risk entity proposal", () => {
  const salesAgentResult = makeBaseResult({
    entityProposals: [
      {
        entityType: "lead",
        proposedChanges: {
          notes: "Nota comercial."
        },
        evidence: [makeEvidence()],
        confidence: "high",
        requiresApproval: "none",
        reason: "Propuesta de bajo riesgo.",
        policyTags: [],
        expiresAt: null,
        idempotencyHint: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "allowed");
  assert.equal(result.governedResult.entityProposals.length, 1);
});

test("blocks a terminal opportunity transition without evidence", () => {
  const salesAgentResult = makeBaseResult({
    entityProposals: [
      {
        entityType: "opportunity",
        proposedChanges: {
          status: "won",
          reason: "Cierre ganado."
        },
        evidence: [],
        confidence: "high",
        requiresApproval: "explicit_operator_approval",
        reason: "Transicion terminal.",
        policyTags: [],
        expiresAt: null,
        idempotencyHint: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "terminal_transition_requires_evidence"));
});

test("allows a won proposal with evidence", () => {
  const salesAgentResult = makeBaseResult({
    entityProposals: [
      {
        entityType: "opportunity",
        proposedChanges: {
          status: "won",
          reason: "Cierre ganado."
        },
        evidence: [
          {
            source: "operator_input",
            summary: "Operacion aprobada.",
            verified: true,
            confidence: "high",
            reference: "op-001",
            capturedAt: FIXED_TIME,
            expiresAt: null
          }
        ],
        confidence: "high",
        requiresApproval: "explicit_operator_approval",
        reason: "Transicion terminal con evidencia.",
        policyTags: [],
        expiresAt: null,
        idempotencyHint: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "requires_review");
  assert.equal(result.governedResult.entityProposals.length, 1);
});

test("blocks customer master mutation attempts", () => {
  const salesAgentResult = makeBaseResult({
    entityProposals: [
      {
        entityType: "lead",
        proposedChanges: {
          customerMasterId: 1234,
          notes: "Intento de mutar identidad."
        },
        evidence: [makeEvidence()],
        confidence: "high",
        requiresApproval: "blocked",
        reason: "Mutation de customer master.",
        policyTags: [],
        expiresAt: null,
        idempotencyHint: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "customer_master_mutation_blocked"));
});

test("blocks opt-out active outbound proposals", () => {
  const result = evaluateCommercialPolicy(
    makePolicyInput({
      channelContext: {
        channel: "whatsapp",
        available: true,
        outboundAllowed: true,
        manualApprovalRequired: false,
        optOut: true,
        quietHoursActive: false,
        humanOwnerActive: false,
        aiBlocked: false,
        identityConflict: false,
        recentCustomerReply: false,
        recentHumanContact: false
      }
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "opt_out_active"));
});

test("blocks ai blocked outbound proposals", () => {
  const result = evaluateCommercialPolicy(
    makePolicyInput({
      channelContext: {
        channel: "whatsapp",
        available: true,
        outboundAllowed: true,
        manualApprovalRequired: false,
        optOut: false,
        quietHoursActive: false,
        humanOwnerActive: false,
        aiBlocked: true,
        identityConflict: false,
        recentCustomerReply: false,
        recentHumanContact: false
      }
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "ai_blocked"));
});

test("marks human owner active as review", () => {
  const result = evaluateCommercialPolicy(
    makePolicyInput({
      channelContext: {
        channel: "whatsapp",
        available: true,
        outboundAllowed: true,
        manualApprovalRequired: false,
        optOut: false,
        quietHoursActive: false,
        humanOwnerActive: true,
        aiBlocked: false,
        identityConflict: false,
        recentCustomerReply: false,
        recentHumanContact: false
      }
    })
  );

  assert.equal(result.status, "requires_review");
  assert.ok(result.issues.some((issue) => issue.code === "human_owner_active"));
});

test("ACS-R1-05-T06.2: recentCustomerReply alone (human_owner_active false) does not force review on a reactive turn", () => {
  const result = evaluateCommercialPolicy(
    makePolicyInput({
      channelContext: {
        channel: "whatsapp",
        available: true,
        outboundAllowed: true,
        manualApprovalRequired: false,
        optOut: false,
        quietHoursActive: false,
        humanOwnerActive: false,
        aiBlocked: false,
        identityConflict: false,
        recentCustomerReply: true,
        recentHumanContact: false
      }
    })
  );

  assert.notEqual(result.status, "requires_review");
  assert.notEqual(result.status, "blocked");
  assert.ok(!result.issues.some((issue) => issue.code === "human_owner_active"));
});

test("ACS-R1-05-T06.2: quiet hours and manual approval are reported by their own real cause, never as human_owner_active", () => {
  const quietHoursResult = evaluateCommercialPolicy(
    makePolicyInput({
      channelContext: {
        channel: "whatsapp",
        available: true,
        outboundAllowed: true,
        manualApprovalRequired: false,
        optOut: false,
        quietHoursActive: true,
        humanOwnerActive: false,
        aiBlocked: false,
        identityConflict: false,
        recentCustomerReply: false,
        recentHumanContact: false
      }
    })
  );

  /**
   * ACS-R1-05-T06.2 (second correction, section 10 - investigated and
   * reverted): quietHoursActive keeps gating evaluateCommercialPolicy's
   * status here, unchanged from the original T06.2 close. It was briefly
   * removed on the theory that it could wrongly block the reactive turn,
   * but the reactive path's own channel-context builder
   * (shadow/runCommercialShadowEvaluation.ts#buildChannelContext) already
   * hardcodes quietHoursActive: false unconditionally, so the reactive
   * turn never actually receives a live quiet-hours signal here. The real
   * caller that does is sales-consultative/followUpDispatchPolicy.ts (the
   * proactive follow-up dispatch gate), which needs this to keep working -
   * see followUpDispatchPolicy.test.ts "[7] quiet hours -> decision
   * require_review".
   */
  assert.equal(quietHoursResult.status, "requires_review");
  assert.ok(quietHoursResult.issues.some((issue) => issue.code === "quiet_hours_active"));
  assert.ok(quietHoursResult.warnings.includes("quiet_hours_active"));
  assert.ok(!quietHoursResult.issues.some((issue) => issue.code === "human_owner_active"));
  assert.ok(!quietHoursResult.warnings.includes("human_owner_active"));

  const manualApprovalResult = evaluateCommercialPolicy(
    makePolicyInput({
      channelContext: {
        channel: "whatsapp",
        available: true,
        outboundAllowed: true,
        manualApprovalRequired: true,
        optOut: false,
        quietHoursActive: false,
        humanOwnerActive: false,
        aiBlocked: false,
        identityConflict: false,
        recentCustomerReply: false,
        recentHumanContact: false
      }
    })
  );

  assert.equal(manualApprovalResult.status, "requires_review");
  assert.ok(manualApprovalResult.issues.some((issue) => issue.code === "manual_approval_required"));
  assert.ok(manualApprovalResult.warnings.includes("manual_approval_required"));
  assert.ok(!manualApprovalResult.issues.some((issue) => issue.code === "human_owner_active"));
  assert.ok(!manualApprovalResult.warnings.includes("human_owner_active"));
});

test("blocks identity conflicts", () => {
  const result = evaluateCommercialPolicy(
    makePolicyInput({
      channelContext: {
        channel: "whatsapp",
        available: true,
        outboundAllowed: true,
        manualApprovalRequired: false,
        optOut: false,
        quietHoursActive: false,
        humanOwnerActive: false,
        aiBlocked: false,
        identityConflict: true,
        recentCustomerReply: false,
        recentHumanContact: false
      }
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "identity_conflict"));
});

test("marks recent customer reply follow-up as review", () => {
  const salesAgentResult = makeBaseResult({
    shouldEvaluateFollowUp: true,
    proposedActions: [
      {
        type: "follow_up",
        priority: "medium",
        confidence: "high",
        riskLevel: "medium",
        requiresApproval: "review",
        reason: "Seguimiento.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      channelContext: {
        channel: "whatsapp",
        available: true,
        outboundAllowed: true,
        manualApprovalRequired: false,
        optOut: false,
        quietHoursActive: false,
        humanOwnerActive: false,
        aiBlocked: false,
        identityConflict: false,
        recentCustomerReply: true,
        recentHumanContact: false
      }
    })
  );

  // ACS-R1-05-T06.2: recentCustomerReply still blocks the follow_up action
  // itself (evaluateCommercialActions.ts, unchanged) - that's the legitimate
  // "cancel pending follow-up" use case. It no longer forces the whole turn's
  // status to requires_review via channelReview, since this same signal is
  // computed from the inbound message the reactive turn is currently
  // answering and must not block that turn's own response (see
  // computeChannelSignals in evaluateCommercialPolicy.ts).
  assert.equal(result.status, "allowed_with_restrictions");
  assert.ok(result.issues.some((issue) => issue.code === "recent_customer_reply"));
  assert.ok(result.blockedActions.some((action) => action.type === "follow_up"));
});

test("allows follow-up evaluation when not blocked", () => {
  const salesAgentResult = makeBaseResult({
    shouldEvaluateFollowUp: true,
    proposedActions: [
      {
        type: "follow_up",
        priority: "medium",
        confidence: "high",
        riskLevel: "medium",
        requiresApproval: "review",
        reason: "Seguimiento.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.notEqual(result.status, "blocked");
  assert.equal(result.governedResult.proposedActions.length, 1);
});

test("returns a partial allow with restrictions", () => {
  const salesAgentResult = makeBaseResult({
    proposedActions: [
      {
        type: "create_opportunity",
        priority: "high",
        confidence: "high",
        riskLevel: "high",
        requiresApproval: "blocked",
        reason: "Intento bloqueado.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      },
      {
        type: "draft_response",
        priority: "low",
        confidence: "high",
        riskLevel: "low",
        requiresApproval: "none",
        reason: "Borrador valido.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }
    ]
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "allowed_with_restrictions");
  assert.equal(result.blockedActions.length, 1);
  assert.equal(result.governedResult.proposedActions.length, 1);
});

test("blocks when everything is blocked", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: null,
    shouldRespondNow: false,
    proposedActions: [
      {
        type: "create_lead",
        priority: "high",
        confidence: "high",
        riskLevel: "high",
        requiresApproval: "blocked",
        reason: "Bloqueado.",
        payload: {},
        dependencies: [],
        policyTags: [],
        expiresAt: null
      }
    ],
    toolRequests: [],
    entityProposals: []
  });

  const result = evaluateCommercialPolicy(makePolicyInput({ salesAgentResult }));

  assert.equal(result.status, "blocked");
  assert.equal(result.governedResult.shouldRespondNow, false);
  assert.equal(result.governedResult.proposedActions.length, 0);
});

test("fails safe on policy version mismatch", () => {
  const result = evaluateCommercialPolicy(
    makePolicyInput({
      policyVersion: "brain.commercial.policy.v9"
    })
  );

  assert.equal(result.status, "failed_safe");
  assert.equal(result.overallDecision, "failed_safe");
});

test("createCommercialPolicyFailedSafe returns a valid failed-safe result", () => {
  const result = createCommercialPolicyFailedSafe(
    makePolicyInput(),
    "invalid_input",
    [
      {
        code: "invalid_input",
        level: "fatal",
        message: "Invalid input.",
        path: ["salesAgentResult"],
        ruleId: "POLICY-GOVERNANCE-FAIL-CLOSED"
      }
    ]
  );

  assert.equal(result.status, "failed_safe");
  assert.equal(result.governedResult.outcome, "failed_safe");
  assert.equal(result.requiresApproval, "blocked");
});

test("result is JSON serializable", () => {
  const result = evaluateCommercialPolicy(makePolicyInput());
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("input is not mutated and output is deterministic", () => {
  const input = makePolicyInput();
  const before = JSON.stringify(input);
  const first = evaluateCommercialPolicy(input);
  const second = evaluateCommercialPolicy(input);

  assert.equal(JSON.stringify(input), before);
  assert.notStrictEqual(first.governedResult, input.salesAgentResult);
  assert.deepEqual(first, second);
});

test("sanitizes BigInt, circular and prototype pollution metadata", () => {
  const circular: Record<string, unknown> = JSON.parse('{"traceId":"trace-001","__proto__":{"polluted":true}}');
  circular.orderId = 9007199254740993n;
  circular.createdAt = new Date(FIXED_TIME);
  circular.self = circular;

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      metadata: circular
    })
  );

  assert.equal(result.status !== "failed_safe", true);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(typeof result.metadata.safeMetadata.orderId, "string");
});

test("feature flags are fail closed", () => {
  const salesAgentResult = makeBaseResult({
    responseProposal: {
      messageIntent: "quote",
      draftText: "Precio.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [
        {
          type: "price",
          value: "Precio referencial.",
          evidenceSource: "customer_message",
          evidenceSummary: "Sin permiso sensible.",
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
  });

  const result = evaluateCommercialPolicy(
    makePolicyInput({
      salesAgentResult,
      featureFlags: {
        ...COMMERCIAL_POLICY_DEFAULT_FLAGS,
        commercialPolicyEnabled: true,
        allowDraftReplies: true,
        allowToolRequests: true,
        allowEntityProposals: false,
        allowFollowUpEvaluation: false,
        allowInternalTasks: false,
        allowQuoteDraftRequests: false,
        allowOperatorReviewRequests: false,
        allowSensitiveClaims: false,
        allowOutboundProposals: false
      }
    })
  );

  assert.notEqual(result.status, "allowed");
  assert.ok(result.issues.length > 0);
});

test("governed result does not keep direct references to the input", () => {
  const input = makePolicyInput();
  const result = evaluateCommercialPolicy(input);

  assert.notStrictEqual(result.governedResult, input.salesAgentResult);
  assert.notStrictEqual(result.governedResult.analysis, input.salesAgentResult.analysis);
  assert.notStrictEqual(result.governedResult.decision, input.salesAgentResult.decision);
  assert.notStrictEqual(result.governedResult.metadata, input.salesAgentResult.metadata);
});
