import type {
  SalesAgentProvider,
  SalesAgentProviderInvokeOptions,
  SalesAgentProviderRequest,
  SalesAgentProviderResponse
} from "../runtimeTypes";
import type {
  SalesAgentActionType,
  SalesAgentClaim,
  SalesAgentDecisionType,
  SalesAgentEvidence,
  SalesAgentMessageIntent,
  SalesAgentOutcome,
  SalesAgentProposedAction
} from "../validationTypes";

export const SALES_AGENT_FAKE_PROVIDER_BEHAVIORS = [
  "valid",
  "invalid",
  "timeout",
  "provider_error",
  "provider_unavailable",
  "hard_blocked_action",
  "sensitive_claim_without_evidence",
  "valid_tool_request",
  "run_id_mismatch",
  "malformed"
] as const;

export type SalesAgentFakeProviderBehavior = (typeof SALES_AGENT_FAKE_PROVIDER_BEHAVIORS)[number];

export type SalesAgentFakeProviderConfig = {
  behavior?: SalesAgentFakeProviderBehavior;
  delayMs?: number;
  rawOutput?: unknown;
  model?: string;
  version?: string;
  providerRequestId?: string;
  finishReason?: string;
  metadata?: Record<string, unknown>;
};

function createAbortError(message = "Provider invocation aborted.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function wait(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function firstCapability(request: SalesAgentProviderRequest) {
  return request.allowedCapabilities[0] ?? request.salesAgentInput.availableCapabilities[0] ?? null;
}

function buildEvidence(summary: string): SalesAgentEvidence[] {
  return [
    {
      source: "customer_message",
      summary,
      verified: true,
      confidence: "high",
      reference: "fake-evidence",
      capturedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null
    }
  ];
}

function buildResponseProposal(
  messageIntent: SalesAgentMessageIntent,
  draftText: string,
  claims: SalesAgentClaim[] = [],
  blockedClaims: SalesAgentClaim["type"][] = []
) {
  return {
    messageIntent,
    draftText,
    language: "es",
    tone: "direct",
    questions: [],
    claims,
    disclaimers: [],
    requiresApproval: "none" as const,
    blockedClaims,
    confidence: "high" as const
  };
}

function buildBaseResult(request: SalesAgentProviderRequest, behavior: SalesAgentFakeProviderBehavior) {
  const runId = request.requestedMode === "recovery" ? "run-recovery" : request.correlationId ?? "fake-run-id";
  const evidence = buildEvidence("La solicitud del cliente es la fuente base.");
  const sharedMetadata = {
    provider: "fake",
    behavior,
    correlationId: request.correlationId ?? null
  };

  return {
    runId,
    contractVersion: request.contractVersion,
    outcome: "response_proposed" as SalesAgentOutcome,
    analysis: {
      summary: "Respuesta comercial segura y deterministica.",
      qualificationState: "qualified" as const,
      customerReadiness: "ready" as const,
      productFit: "good" as const,
      confidence: "high" as const,
      riskLevel: "low" as const,
      reasonCodes: ["customer_message_present"]
    },
    decision: {
      type: "respond_now" as SalesAgentDecisionType,
      reason: "El caso puede responderse con seguridad estructural.",
      confidence: "high" as const,
      riskLevel: "low" as const,
      requiresApproval: "none" as const,
      errorCode: "none" as const,
      reasonCodes: ["customer_message_present"],
      policyTags: ["commercial_reply"]
    },
    shouldRespondNow: true,
    shouldRequestTool: false,
    shouldRequestHuman: false,
    shouldEvaluateFollowUp: false,
    proposedActions: [] as SalesAgentProposedAction[],
    toolRequests: [],
    entityProposals: [],
    responseProposal: buildResponseProposal("answer", "Hola, te comparto la informacion solicitada."),
    evidence,
    policyAssessment: {
      status: "allowed" as const,
      blocked: false,
      reason: "Sin bloqueo de policy.",
      confidence: "high" as const,
      riskLevel: "low" as const,
      approvalRequirement: "none" as const,
      errorCode: "none" as const,
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
    metadata: sharedMetadata
  };
}

function buildBehaviorOutput(request: SalesAgentProviderRequest, behavior: SalesAgentFakeProviderBehavior) {
  if (behavior === "invalid") {
    return {
      ...buildBaseResult(request, behavior),
      outcome: "not_supported",
      decision: {
        ...buildBaseResult(request, behavior).decision,
        type: "respond_now" as const
      }
    };
  }

  if (behavior === "run_id_mismatch") {
    return {
      ...buildBaseResult(request, behavior),
      runId: "run-mismatch"
    };
  }

  if (behavior === "provider_error") {
    throw new Error("Provider error: Authorization: Bearer sk-test-123");
  }

  if (behavior === "provider_unavailable") {
    throw new Error("Sales provider unavailable.");
  }

  if (behavior === "hard_blocked_action") {
    return {
      ...buildBaseResult(request, behavior),
      proposedActions: [
        {
          type: "create_lead" as SalesAgentActionType,
          priority: "high" as const,
          confidence: "high" as const,
          riskLevel: "high" as const,
          requiresApproval: "blocked" as const,
          reason: "Intento de crear lead.",
          payload: {},
          dependencies: [],
          policyTags: ["blocked_action"],
          expiresAt: null,
          idempotencyHint: "hard-blocked"
        }
      ]
    };
  }

  if (behavior === "sensitive_claim_without_evidence") {
    return {
      ...buildBaseResult(request, behavior),
      responseProposal: buildResponseProposal(
        "quote",
        "El precio es 10.",
        [
          {
            type: "price",
            value: "El precio es 10.",
            evidenceSource: "customer_message",
            evidenceSummary: "Afirmacion sensible sin evidencia.",
            evidenceReference: null,
            verified: false,
            confidence: "high" as const,
            expiresAt: null
          }
        ],
        []
      )
    };
  }

  if (behavior === "valid_tool_request") {
    const tool = firstCapability(request);
    return {
      ...buildBaseResult(request, behavior),
      outcome: "tool_required" as const,
      decision: {
        ...buildBaseResult(request, behavior).decision,
        type: "request_tool" as const,
        reason: "Se requiere una herramienta permitida.",
        requiresApproval: "review" as const
      },
      shouldRespondNow: false,
      shouldRequestTool: true,
      responseProposal: null,
      toolRequests: tool
        ? [
            {
              tool,
              purpose: "Obtener evidencia permitida.",
              status: "planned" as const,
              requiredInputs: {},
              optionalInputs: null,
              urgency: "medium" as const,
              blocking: true,
              reason: "La solicitud requiere evidencia estructural adicional.",
              expectedEvidence: ["tool_result"],
              fallbackDecision: "request_human" as const,
              confidence: "high" as const,
              riskLevel: "low" as const
            }
          ]
        : []
    };
  }

  if (behavior === "timeout") {
    return buildBaseResult(request, behavior);
  }

  if (behavior === "malformed") {
    return "not an object";
  }

  return buildBaseResult(request, behavior);
}

export function createFakeSalesAgentProvider(config: SalesAgentFakeProviderConfig = {}): SalesAgentProvider {
  const behavior = config.behavior ?? "valid";

  return {
    name: "fake-sales-agent-provider",
    version: config.version ?? "fake-provider.v1",
    async invoke(request: SalesAgentProviderRequest, options: SalesAgentProviderInvokeOptions): Promise<SalesAgentProviderResponse> {
      if (behavior === "timeout") {
        await wait(24 * 60 * 60 * 1000, options.signal ?? null);
        throw createAbortError("Provider timed out.");
      }

      if (options.signal?.aborted) {
        throw createAbortError();
      }

      if (typeof config.delayMs === "number" && config.delayMs > 0) {
        await wait(config.delayMs, options.signal ?? null);
      }

      if (options.signal?.aborted) {
        throw createAbortError();
      }

      if (behavior === "provider_error") {
        throw new Error("Provider error: Authorization: Bearer sk-test-123");
      }

      if (behavior === "provider_unavailable") {
        throw new Error("Sales provider unavailable.");
      }

      const rawOutput = config.rawOutput ?? buildBehaviorOutput(request, behavior);
      return {
        rawOutput,
        model: config.model ?? "fake-sales-agent-model",
        inputTokens: 128,
        outputTokens: 256,
        estimatedCost: 0,
        providerRequestId: config.providerRequestId ?? "fake-provider-request-id",
        finishReason: config.finishReason ?? "stop",
        metadata: {
          ...config.metadata,
          behavior
        }
      };
    }
  };
}
