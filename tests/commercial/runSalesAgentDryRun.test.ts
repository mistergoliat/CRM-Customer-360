import assert from "node:assert/strict";
import test from "node:test";
import { buildCommercialContext } from "../../lib/brain/commercial/context/buildCommercialContext";
import { buildSalesAgentPromptPackage } from "../../lib/brain/commercial/sales-agent/promptBuilder";
import { createFakeSalesAgentProvider } from "../../lib/brain/commercial/sales-agent/providers/fakeSalesAgentProvider";
import { runSalesAgentDryRun } from "../../lib/brain/commercial/sales-agent/runSalesAgentDryRun";
import {
  SALES_AGENT_CONTRACT_VERSION,
  SALES_AGENT_PROMPT_VERSION,
  SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS,
  SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS
} from "../../lib/brain/commercial/sales-agent/runtimeTypes";
import type { SalesAgentProvider, SalesAgentRuntimeClock, SalesAgentRuntimeInput } from "../../lib/brain/commercial/sales-agent/runtimeTypes";
import type { SalesAgentOutputValidationIssue } from "../../lib/brain/commercial/sales-agent/validationTypes";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";
const FIXED_NOW = Date.parse(FIXED_TIME);

const FIXED_CLOCK: SalesAgentRuntimeClock = {
  now: () => FIXED_NOW,
  toISOString: (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
  }
};

function makeRecentMessage(index: number) {
  const minute = String(index).padStart(2, "0");
  return {
    id: index,
    direction: index % 2 === 0 ? "inbound" : "outbound",
    text: index % 2 === 0 ? `Mensaje inbound ${index}` : `Mensaje outbound ${index}`,
    occurred_at: `2026-06-17T11:${minute}:00.000Z`,
    created_at: `2026-06-17T11:${minute}:00.000Z`,
    updated_at: `2026-06-17T11:${minute}:30.000Z`,
    message_type: "text",
    final_action: index % 2 === 0 ? "customer_reply" : "manual_reply",
    status: "ok",
    intent: index % 2 === 0 ? "sales" : "followup",
    department: "ventas",
    wa_id: "56912345678",
    phone_number_id: "phone-001",
    conversation_case_id: 4821,
    source_table: "n8n_conversation_messages"
  };
}

function makeBrainContext(overrides: Record<string, unknown> = {}) {
  return {
    customer_context: {
      wa_id: "56912345678",
      phone_number_id: "phone-001",
      email: "cliente@example.com",
      phone: "+56912345678",
      id_customer: 10045,
      id_order: 20001,
      invoice_number: 30001,
      contact_id: 40001,
      customer_candidate: {
        idCustomer: 10045,
        idOrder: 20001,
        invoiceNumber: 30001,
        email: "cliente@example.com",
        contactId: 40001,
        status: "qualified"
      }
    },
    case_context: {
      conversation_case_id: 4821,
      status: "open",
      lifecycle_status: "open",
      department: "ventas",
      requires_human: false,
      ai_blocked: false,
      bot_replied: false,
      final_action: "continue",
      updated_at: "2026-06-17T11:50:00.000Z"
    },
    conversation_context: {
      recent_messages: [makeRecentMessage(1), makeRecentMessage(2), makeRecentMessage(3)],
      latest_inbound_message: makeRecentMessage(2),
      latest_outbound_message: makeRecentMessage(3)
    },
    business_context: {
      ps_orders: [
        {
          id_order: 20001,
          id_customer: 10045,
          invoice_number: 30001,
          status: "paid",
          total_paid: 79990
        }
      ]
    },
    service_context: {
      primary_service: "sales",
      service_code: "quote_requested",
      department: "ventas"
    },
    metadata: {
      sourceWorkflow: "wa-webhook",
      headers: {
        authorization: "Bearer hidden"
      },
      token: "secret-token",
      rawWebhook: { should: "not-leak" }
    },
    ...overrides
  };
}

function makeInboundMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "wamid.general.1",
    message_text: "Hola, quiero saber precio y stock de una trotadora",
    channel: "whatsapp",
    platform: "meta",
    wa_id: "56912345678",
    phone_number_id: "phone-001",
    conversation_case_id: 4821,
    occurred_at: FIXED_TIME,
    headers: {
      authorization: "Bearer hidden"
    },
    rawWebhook: { leaked: true },
    token: "should-not-appear",
    credentials: {
      secret: true
    },
    metadata: {
      nested: "safe"
    },
    ...overrides
  };
}

function makeSalesAgentInput(overrides: Record<string, unknown> = {}) {
  const result = buildCommercialContext({
    brainContext: makeBrainContext(overrides.brainContext as Record<string, unknown> | undefined),
    inboundMessage: makeInboundMessage(overrides.inboundMessage as Record<string, unknown> | undefined),
    requestedMode: (overrides.requestedMode as "minimal" | "standard" | "recovery") ?? "standard",
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    availableCapabilities: (overrides.availableCapabilities as SalesAgentRuntimeInput["salesAgentInput"]["availableCapabilities"]) ?? [
      "searchKnowledge",
      "getConversationHistory",
      "searchProducts",
      "getOrderByInvoice"
    ],
    policyContext: overrides.policyContext as SalesAgentRuntimeInput["salesAgentInput"]["policyContext"],
    metadata: overrides.metadata as Record<string, unknown> | undefined
  });

  assert.equal(result.status, "success");
  return result.salesAgentInput;
}

function makeValidRawOutput(overrides: Record<string, unknown> = {}) {
  return {
    runId: "corr-001",
    contractVersion: SALES_AGENT_CONTRACT_VERSION,
    outcome: "response_proposed",
    analysis: {
      summary: "Consulta de producto con intencion comercial explicita.",
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
    evidence: [
      {
        source: "customer_message",
        summary: "El cliente pregunto por producto.",
        verified: true,
        confidence: "high",
        reference: "msg-001",
        capturedAt: FIXED_TIME,
        expiresAt: null
      }
    ],
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

function makeRuntimeInput(overrides: Record<string, unknown> = {}): SalesAgentRuntimeInput {
  const salesAgentInput = (overrides.salesAgentInput as SalesAgentRuntimeInput["salesAgentInput"]) ?? makeSalesAgentInput();
  const provider = (overrides.provider as SalesAgentProvider) ?? createFakeSalesAgentProvider({ behavior: "valid" });
  const enabled = typeof overrides.enabled === "boolean" ? overrides.enabled : false;
  const strictValidation = typeof overrides.strictValidation === "boolean" ? overrides.strictValidation : true;
  const captureRawOutput = typeof overrides.captureRawOutput === "boolean" ? overrides.captureRawOutput : false;
  const includePromptPreview = typeof overrides.includePromptPreview === "boolean" ? overrides.includePromptPreview : false;
  const dryRun = typeof overrides.dryRun === "boolean" ? overrides.dryRun : false;
  const options = {
    enabled,
    mode: (overrides.mode as "dry_run" | "fixture" | "shadow" | "live") ?? "live",
    timeoutMs: (overrides.timeoutMs as number | undefined) ?? 25,
    maxInputCharacters: (overrides.maxInputCharacters as number | undefined) ?? SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS,
    maxOutputCharacters: (overrides.maxOutputCharacters as number | undefined) ?? SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS,
    strictValidation,
    allowedCapabilities:
      (overrides.allowedCapabilities as SalesAgentRuntimeInput["salesAgentInput"]["availableCapabilities"]) ?? salesAgentInput.availableCapabilities,
    captureRawOutput,
    includePromptPreview,
    dryRun,
    abortSignal: (overrides.abortSignal as AbortSignal | null | undefined) ?? null
  };

  return {
    salesAgentInput,
    provider,
    options,
    expectedRunId: (overrides.expectedRunId as string | undefined) ?? "corr-001",
    contractVersion: (overrides.contractVersion as string | undefined) ?? SALES_AGENT_CONTRACT_VERSION,
    promptVersion: (overrides.promptVersion as typeof SALES_AGENT_PROMPT_VERSION | undefined) ?? SALES_AGENT_PROMPT_VERSION,
    currentTime: FIXED_TIME,
    correlationId: (overrides.correlationId as string | null | undefined) ?? "corr-001",
    metadata: (overrides.metadata as Record<string, unknown> | undefined) ?? { safeTraceId: "trace-001" },
    clock: (overrides.clock as SalesAgentRuntimeClock | undefined) ?? FIXED_CLOCK
  };
}

test("runtime disabled does not call provider", async () => {
  let invoked = 0;
  const provider: SalesAgentProvider = {
    name: "spy-provider",
    version: "spy.v1",
    async invoke() {
      invoked += 1;
      return {
        rawOutput: makeValidRawOutput(),
        model: "spy-model",
        inputTokens: 1,
        outputTokens: 1,
        estimatedCost: 0,
        providerRequestId: "spy-request",
        finishReason: "stop",
        metadata: {}
      };
    }
  };

  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: false,
      provider
    })
  );

  assert.equal(invoked, 0);
  assert.equal(result.status, "disabled");
  assert.equal(result.validation.status, "skipped");
  assert.equal(result.result.outcome, "failed_safe");
});

test("completes valid output from the fake provider", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({ behavior: "valid" })
    })
  );

  assert.equal(result.status, "completed_valid");
  assert.equal(result.mode, "live");
  assert.equal(result.dryRun, false);
  assert.equal(result.result.outcome, "response_proposed");
  assert.equal(result.validation.status, "valid");
  assert.equal(result.metrics.providerRequestId, "fake-provider-request-id");
  assert.equal(result.metrics.model, "fake-sales-agent-model");
});

test("invokes provider when dryRun is false", async () => {
  let invoked = 0;
  let observedDryRun: boolean | null = null;
  const provider: SalesAgentProvider = {
    name: "live-spy-provider",
    version: "spy.v1",
    async invoke(_request, options) {
      invoked += 1;
      observedDryRun = options.dryRun;
      return {
        rawOutput: makeValidRawOutput(),
        model: "spy-live-model",
        inputTokens: 1,
        outputTokens: 1,
        estimatedCost: 0,
        providerRequestId: "spy-live-request",
        finishReason: "stop",
        metadata: {}
      };
    }
  };

  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      dryRun: false,
      mode: "live",
      provider
    })
  );

  assert.equal(invoked, 1);
  assert.equal(observedDryRun, false);
  assert.equal(result.status, "completed_valid");
  assert.equal(result.dryRun, false);
  assert.equal(result.provider.model, "spy-live-model");
});

test("fails safe on invalid provider output", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({ behavior: "invalid" })
    })
  );

  assert.equal(result.status, "validation_failed_safe");
  assert.equal(result.validation.status, "failed_safe");
  assert.equal(result.result.outcome, "failed_safe");
});

test("fails safe when validator rejects a runId mismatch", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({ behavior: "run_id_mismatch" })
    })
  );

  assert.equal(result.status, "validation_failed_safe");
  assert.ok(result.validation.issues.some((issue: SalesAgentOutputValidationIssue) => issue.code === "run_id_mismatch"));
  assert.equal(result.result.outcome, "failed_safe");
});

test("fails safe when contractVersion mismatches", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({
        rawOutput: makeValidRawOutput({
          contractVersion: "brain.sales-agent.output.v0"
        })
      })
    })
  );

  assert.equal(result.status, "validation_failed_safe");
  assert.ok(result.validation.issues.some((issue: SalesAgentOutputValidationIssue) => issue.code === "unsupported_contract_version"));
});

test("fails safe when a tool request is not in allowed capabilities", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({
        rawOutput: makeValidRawOutput({
          outcome: "tool_required",
          shouldRespondNow: false,
          shouldRequestTool: true,
          responseProposal: null,
          decision: {
            type: "request_tool",
            reason: "Se requiere una herramienta.",
            confidence: "high",
            riskLevel: "low",
            requiresApproval: "review",
            errorCode: "none",
            reasonCodes: ["customer_message_present"],
            policyTags: ["commercial_reply"]
          },
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
        })
      }),
      allowedCapabilities: ["getConversationHistory"]
    })
  );

  assert.equal(result.status, "validation_failed_safe");
  assert.ok(result.validation.issues.some((issue: SalesAgentOutputValidationIssue) => issue.code === "invalid_tool_request"));
});

test("fails safe on hard-blocked actions", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({ behavior: "hard_blocked_action" })
    })
  );

  assert.equal(result.status, "validation_failed_safe");
  assert.ok(result.validation.issues.some((issue: SalesAgentOutputValidationIssue) => issue.code === "hard_blocked_action"));
});

test("fails safe on sensitive claims without evidence", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({ behavior: "sensitive_claim_without_evidence" })
    })
  );

  assert.equal(result.status, "validation_failed_safe");
  assert.ok(result.validation.issues.some((issue: SalesAgentOutputValidationIssue) => issue.code === "sensitive_claim_without_evidence"));
});

test("fails safe on claim stock without verification", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({
        rawOutput: makeValidRawOutput({
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
        })
      })
    })
  );

  assert.equal(result.status, "validation_failed_safe");
  assert.ok(result.validation.issues.some((issue: SalesAgentOutputValidationIssue) => issue.code === "sensitive_claim_without_evidence"));
});

test("accepts a general claim with valid evidence", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({
        rawOutput: makeValidRawOutput({
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
        })
      })
    })
  );

  assert.equal(result.status, "completed_valid");
  assert.equal(result.result.responseProposal?.claims[0]?.type, "general");
});

test("fails safe when the provider throws with a sensitive error message", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({ behavior: "provider_error" })
    })
  );

  assert.equal(result.status, "provider_error");
  assert.ok(result.error?.message.includes("sk-test-123") === false);
});

test("marks provider unavailable", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({ behavior: "provider_unavailable" })
    })
  );

  assert.equal(result.status, "provider_unavailable");
});

test("times out when the provider exceeds the deadline", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      timeoutMs: 5,
      provider: createFakeSalesAgentProvider({ behavior: "timeout" })
    })
  );

  assert.equal(result.status, "timeout");
  assert.equal(result.error?.code, "timeout");
});

test("cancels when the abort signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      abortSignal: controller.signal,
      provider: createFakeSalesAgentProvider({ behavior: "valid", delayMs: 100 })
    })
  );

  assert.equal(result.status, "cancelled");
  assert.equal(result.error?.code, "cancelled");
});

test("does not expose rawOutput by default", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      provider: createFakeSalesAgentProvider({ behavior: "valid" })
    })
  );

  assert.equal(result.rawOutputPreview, undefined);
});

test("sanitizes rawOutput when captureRawOutput is enabled", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      captureRawOutput: true,
      provider: createFakeSalesAgentProvider({
        rawOutput: makeValidRawOutput({
          metadata: {
            traceId: "trace-001",
            token: "secret-token",
            headers: {
              authorization: "Bearer hidden"
            }
          }
        })
      })
    })
  );

  assert.equal(result.status, "completed_valid");
  assert.equal(result.rawOutputPreview && typeof result.rawOutputPreview === "object", true);
  assert.equal(Object.prototype.hasOwnProperty.call((result.rawOutputPreview as Record<string, unknown>).metadata as Record<string, unknown>, "token"), false);
});

test("sanitizes runtime metadata and security payloads", async () => {
  const metadata: Record<string, unknown> = {
    traceId: "trace-001",
    orderId: 9007199254740993n,
    when: new Date(FIXED_TIME),
    map: new Map([["k", "v"]]),
    set: new Set(["v"]),
    fn: () => "noop",
    sym: Symbol("x"),
    ...JSON.parse('{"__proto__":{"polluted":true}}')
  };

  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      metadata,
      provider: createFakeSalesAgentProvider({ behavior: "valid" })
    })
  );

  assert.equal(result.status, "completed_valid");
  assert.equal(typeof result.metadata.safeMetadata.orderId, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(result.metadata.safeMetadata, "__proto__"), false);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("rejects excessive input length", async () => {
  const oversizedInput = makeSalesAgentInput({
    inboundMessage: {
      message_text: "x".repeat(12000)
    }
  });

  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      salesAgentInput: oversizedInput,
      maxInputCharacters: 200,
      provider: createFakeSalesAgentProvider({ behavior: "valid" })
    })
  );

  assert.equal(result.status, "invalid_input");
  assert.equal(result.error?.code, "input_too_large");
});

test("rejects excessive output length", async () => {
  const result = await runSalesAgentDryRun(
    makeRuntimeInput({
      enabled: true,
      maxOutputCharacters: 10,
      provider: createFakeSalesAgentProvider({
        rawOutput: makeValidRawOutput({
          responseProposal: {
            messageIntent: "answer",
            draftText: "x".repeat(5000),
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
          }
        })
      })
    })
  );

  assert.equal(result.status, "completed_failed_safe");
  assert.equal(result.error?.code, "invalid_response");
});

test("builds a deterministic prompt package", () => {
  const salesAgentInput = makeSalesAgentInput();
  const promptA = buildSalesAgentPromptPackage({
    salesAgentInput,
    contractVersion: SALES_AGENT_CONTRACT_VERSION,
    promptVersion: SALES_AGENT_PROMPT_VERSION,
    runtimeMode: "dry_run",
    currentTime: FIXED_TIME,
    allowedCapabilities: salesAgentInput.availableCapabilities
  });
  const promptB = buildSalesAgentPromptPackage({
    salesAgentInput,
    contractVersion: SALES_AGENT_CONTRACT_VERSION,
    promptVersion: SALES_AGENT_PROMPT_VERSION,
    runtimeMode: "dry_run",
    currentTime: FIXED_TIME,
    allowedCapabilities: salesAgentInput.availableCapabilities
  });

  assert.deepEqual(promptA, promptB);
  assert.equal(promptA.promptText.includes("Bearer hidden"), false);
});

test("does not mutate the salesAgentInput", async () => {
  const runtimeInput = makeRuntimeInput({
    enabled: true,
    provider: createFakeSalesAgentProvider({ behavior: "valid" })
  });
  const before = JSON.stringify(runtimeInput.salesAgentInput);

  await runSalesAgentDryRun(runtimeInput);

  assert.equal(JSON.stringify(runtimeInput.salesAgentInput), before);
});

test("returns deterministic output with a fixed clock and fake provider", async () => {
  const provider = createFakeSalesAgentProvider({ behavior: "valid" });
  const runtimeInput = makeRuntimeInput({
    enabled: true,
    provider,
    clock: FIXED_CLOCK
  });

  const first = await runSalesAgentDryRun(runtimeInput);
  const second = await runSalesAgentDryRun(makeRuntimeInput({ enabled: true, provider, clock: FIXED_CLOCK }));

  assert.deepEqual(first, second);
});
