import assert from "node:assert/strict";
import test from "node:test";
import { createHttpSalesAgentProvider } from "../../lib/brain/commercial/sales-agent/providers";
import {
  SALES_AGENT_CONTRACT_VERSION,
  SALES_AGENT_PROMPT_VERSION,
  type SalesAgentProviderRequest
} from "../../lib/brain/commercial/sales-agent/runtimeTypes";

function makeRawOutput() {
  return {
    runId: "corr-http-001",
    contractVersion: SALES_AGENT_CONTRACT_VERSION,
    outcome: "response_proposed",
    analysis: {
      summary: "Consulta comercial.",
      qualificationState: "qualified",
      customerReadiness: "ready",
      productFit: "good",
      confidence: "high",
      riskLevel: "low",
      reasonCodes: ["customer_message_present"]
    },
    decision: {
      type: "respond_now",
      reason: "Responder con informacion disponible.",
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
      draftText: "Hola, te ayudo con esa cotizacion.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [],
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
      summary: "Razonamiento operacional breve.",
      evidence: [],
      counterEvidence: [],
      assumptions: [],
      riskFlags: [],
      missingInformation: [],
      policyRulesApplied: ["validation"]
    },
    metadata: {}
  };
}

function makeRequest(): SalesAgentProviderRequest {
  return {
    promptPackage: {
      promptVersion: SALES_AGENT_PROMPT_VERSION,
      contractVersion: SALES_AGENT_CONTRACT_VERSION,
      runtimeMode: "live",
      requestedMode: "standard",
      systemInstructions: ["Return JSON."],
      contractInstructions: [],
      commercialContext: {},
      responseSchemaSummary: [],
      safetyConstraints: [],
      messages: [
        { role: "system", content: "Return JSON." },
        { role: "user", content: "Quote request." }
      ],
      promptText: "Return JSON.\nQuote request."
    },
    salesAgentInput: {} as SalesAgentProviderRequest["salesAgentInput"],
    contractVersion: SALES_AGENT_CONTRACT_VERSION,
    promptVersion: SALES_AGENT_PROMPT_VERSION,
    runtimeMode: "live",
    requestedMode: "standard",
    allowedCapabilities: [],
    correlationId: "corr-http-001",
    metadata: {}
  };
}

test("HTTP sales agent provider calls OpenAI-compatible endpoint and parses JSON content", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  let capturedAuthorization: string | null = null;
  const provider = createHttpSalesAgentProvider({
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey: "sk-test",
    model: "deepseek-test",
    fetchImpl: async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      capturedAuthorization = init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
        ? String((init.headers as Record<string, string>).Authorization ?? "")
        : null;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "deepseek-test",
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(makeRawOutput()) }
            }
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 22
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const response = await provider.invoke(makeRequest(), {
    timeoutMs: 15000,
    currentTime: "2026-06-30T00:00:00.000Z",
    dryRun: false,
    strictValidation: true,
    metadata: {}
  });

  assert.equal(capturedAuthorization, "Bearer sk-test");
  assert.ok(capturedBody);
  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.model, "deepseek-test");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(response.providerRequestId, "chatcmpl-test");
  assert.equal(response.model, "deepseek-test");
  assert.equal(response.inputTokens, 11);
  assert.equal(response.outputTokens, 22);
  assert.deepEqual(response.rawOutput, makeRawOutput());
});

test("HTTP sales agent provider extracts JSON object from wrapped content", async () => {
  const provider = createHttpSalesAgentProvider({
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey: "sk-test",
    model: "deepseek-test",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-wrapped",
          model: "deepseek-test",
          choices: [
            {
              finish_reason: "stop",
              message: { content: `Aqui va el JSON:\n\n\`\`\`json\n${JSON.stringify(makeRawOutput())}\n\`\`\`` }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  });

  const response = await provider.invoke(makeRequest(), {
    timeoutMs: 15000,
    currentTime: "2026-06-30T00:00:00.000Z",
    dryRun: false,
    strictValidation: true,
    metadata: {}
  });

  assert.equal(response.providerRequestId, "chatcmpl-wrapped");
  assert.deepEqual(response.rawOutput, makeRawOutput());
});

test("HTTP sales agent provider fails when credentials are missing", async () => {
  const provider = createHttpSalesAgentProvider({
    endpoint: "",
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    }
  });

  await assert.rejects(
    () =>
      provider.invoke(makeRequest(), {
        timeoutMs: 15000,
        currentTime: "2026-06-30T00:00:00.000Z",
        dryRun: false,
        strictValidation: true,
        metadata: {}
      }),
    /missing endpoint or API key/
  );
});
