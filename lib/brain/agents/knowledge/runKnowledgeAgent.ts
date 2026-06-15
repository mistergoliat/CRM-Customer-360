import { buildKnowledgeAgentPrompt } from "./prompt";
import { getKnowledgePolicy, getStaticBusinessInfo, searchKnowledge } from "../../tools/knowledge";
import { validateKnowledgeAgentOutput } from "./validate";
import { makeBrainTraceId } from "../../instructions";
import type {
  BrainKnowledgeAgentDecision,
  BrainKnowledgeAgentOutput,
  BrainKnowledgeAgentRequest,
  BrainKnowledgeAgentRunResponse,
  BrainKnowledgeAnswerType
} from "./types";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hasAny(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function isHumanRequest(text: string) {
  return hasAny(text, ["humano", "ejecutivo", "asesor", "persona", "agente", "operator"]);
}

function isSalesRequest(text: string) {
  return hasAny(text, ["precio", "costo", "valor", "stock", "disponible", "disponibilidad", "cotizacion", "cotización", "comprar", "compra"]);
}

function isSupportRequest(text: string) {
  return hasAny(text, ["reclamo", "problema", "falla", "error", "garantia", "garantía", "devolucion", "devolución"]);
}

function isPostventaRequest(text: string) {
  return hasAny(text, ["pedido", "estado de pedido", "armado", "mantencion", "mantención", "instalacion", "instalación"]);
}

function isBusinessInfoRequest(text: string) {
  return hasAny(text, ["horario", "atencion", "atención", "ubicacion", "ubicación", "retiro", "pago", "medios de pago", "faq", "politica", "política", "politicas", "políticas"]);
}

function mapDecisionToAnswerType(decision: BrainKnowledgeAgentDecision, query: string): BrainKnowledgeAnswerType {
  if (decision === "route_to_sales") return "generic";
  if (decision === "route_to_sac") return "generic";
  if (decision === "route_to_postventa") return "generic";
  if (isBusinessInfoRequest(query)) {
    if (hasAny(query, ["horario", "atencion", "atención"])) return "business_info";
    if (hasAny(query, ["ubicacion", "ubicación", "retiro"])) return "location";
    if (hasAny(query, ["pago", "medios de pago"])) return "payment";
    if (hasAny(query, ["politica", "política", "faq"])) return "policy";
  }
  return decision === "answer" ? "faq" : "none";
}

function buildToolRequests(query: string) {
  return [
    {
      toolName: "getKnowledgePolicy" as const,
      status: "planned" as const,
      reason: "Load knowledge policy before answering.",
      blockedReasons: [] as string[],
      input: {}
    },
    {
      toolName: "getStaticBusinessInfo" as const,
      status: "planned" as const,
      reason: "Check static business information before answering.",
      blockedReasons: [] as string[],
      input: { query }
    },
    {
      toolName: "searchKnowledge" as const,
      status: "planned" as const,
      reason: "Search safe knowledge snippets relevant to the customer question.",
      blockedReasons: [] as string[],
      input: { query }
    }
  ];
}

function createAbstainDraft(request: BrainKnowledgeAgentRequest, reason: string, warnings: string[]): BrainKnowledgeAgentOutput {
  const query = request.inputEvent.message_text;
  return {
    outputSchema: "brain.agent.knowledge.output.v1",
    agentName: "knowledge",
    agentVersion: "brain.agent.knowledge.v2",
    decision: "abstain",
    answer_type: mapDecisionToAnswerType("abstain", query),
    message: reason,
    confidence: 0.38,
    sources_used: ["knowledge_policy"],
    safety_flags: ["read_only", "no_db_writes", "no_whatsapp", "no_llm", "real_model_unavailable"],
    tool_requests: buildToolRequests(query),
    warnings
  };
}

function buildMockDraft(request: BrainKnowledgeAgentRequest): BrainKnowledgeAgentOutput {
  const query = request.inputEvent.message_text;
  const staticBusinessInfo = getStaticBusinessInfo();
  const knowledgeHit = searchKnowledge(query);
  const warnings: string[] = [];
  const safetyFlags = ["read_only", "no_db_writes", "no_whatsapp", "no_llm"];

  if (request.actionPolicy.decision === "blocked" || request.actionPolicy.requires_human) {
    return {
      outputSchema: "brain.agent.knowledge.output.v1",
      agentName: "knowledge",
      agentVersion: "brain.agent.knowledge.v2",
      decision: request.actionPolicy.decision === "blocked" ? "abstain" : "handoff_recommended",
      answer_type: "none",
      message: request.actionPolicy.reason,
      confidence: request.actionPolicy.decision === "blocked" ? 0.12 : 0.5,
      sources_used: ["knowledge_policy"],
      safety_flags: [...safetyFlags, "policy_blocked"],
      tool_requests: buildToolRequests(query),
      warnings: [...request.context.warnings.slice(0, 3), ...warnings]
    };
  }

  if (isHumanRequest(query)) {
    return {
      outputSchema: "brain.agent.knowledge.output.v1",
      agentName: "knowledge",
      agentVersion: "brain.agent.knowledge.v2",
      decision: "handoff_recommended",
      answer_type: "none",
      message: "This request should be handled by a human agent.",
      confidence: 0.56,
      sources_used: ["knowledge_policy"],
      safety_flags: [...safetyFlags, "human_handoff_recommended"],
      tool_requests: buildToolRequests(query),
      warnings
    };
  }

  if (isSalesRequest(query)) {
    return {
      outputSchema: "brain.agent.knowledge.output.v1",
      agentName: "knowledge",
      agentVersion: "brain.agent.knowledge.v2",
      decision: "route_to_sales",
      answer_type: "none",
      message: "This request belongs to sales because it asks about price, stock or quotation.",
      confidence: 0.72,
      sources_used: ["knowledge_policy"],
      safety_flags: [...safetyFlags, "route_to_sales"],
      tool_requests: buildToolRequests(query),
      warnings
    };
  }

  if (isSupportRequest(query)) {
    return {
      outputSchema: "brain.agent.knowledge.output.v1",
      agentName: "knowledge",
      agentVersion: "brain.agent.knowledge.v2",
      decision: "route_to_sac",
      answer_type: "none",
      message: "This request belongs to SAC or support because it is a complaint or issue.",
      confidence: 0.7,
      sources_used: ["knowledge_policy"],
      safety_flags: [...safetyFlags, "route_to_sac"],
      tool_requests: buildToolRequests(query),
      warnings
    };
  }

  if (isPostventaRequest(query)) {
    return {
      outputSchema: "brain.agent.knowledge.output.v1",
      agentName: "knowledge",
      agentVersion: "brain.agent.knowledge.v2",
      decision: "route_to_postventa",
      answer_type: "none",
      message: "This request belongs to post-sale operations.",
      confidence: 0.68,
      sources_used: ["knowledge_policy"],
      safety_flags: [...safetyFlags, "route_to_postventa"],
      tool_requests: buildToolRequests(query),
      warnings
    };
  }

  if (hasAny(query, ["horario", "atencion", "atención"]) && staticBusinessInfo.businessHours) {
    return {
      outputSchema: "brain.agent.knowledge.output.v1",
      agentName: "knowledge",
      agentVersion: "brain.agent.knowledge.v2",
      decision: "answer",
      answer_type: "business_info",
      message: `Atencion humana disponible ${staticBusinessInfo.businessHours}.`,
      confidence: 0.86,
      sources_used: ["static_business_info"],
      safety_flags: safetyFlags,
      tool_requests: buildToolRequests(query),
      warnings
    };
  }

  if (hasAny(query, ["pago", "medios de pago"]) && staticBusinessInfo.paymentMethods.length > 0) {
    return {
      outputSchema: "brain.agent.knowledge.output.v1",
      agentName: "knowledge",
      agentVersion: "brain.agent.knowledge.v2",
      decision: "answer",
      answer_type: "payment",
      message: `Medios de pago disponibles: ${staticBusinessInfo.paymentMethods.join(", ")}.`,
      confidence: 0.76,
      sources_used: ["static_business_info"],
      safety_flags: safetyFlags,
      tool_requests: buildToolRequests(query),
      warnings
    };
  }

  if (hasAny(query, ["politica", "política", "faq"])) {
    const faq = knowledgeHit.hits[0];
    if (faq) {
      return {
        outputSchema: "brain.agent.knowledge.output.v1",
        agentName: "knowledge",
        agentVersion: "brain.agent.knowledge.v2",
        decision: "answer",
        answer_type: "faq",
        message: faq.answer,
        confidence: 0.7,
        sources_used: faq.sources,
        safety_flags: safetyFlags,
        tool_requests: buildToolRequests(query),
        warnings
      };
    }
  }

  return {
    outputSchema: "brain.agent.knowledge.output.v1",
    agentName: "knowledge",
    agentVersion: "brain.agent.knowledge.v2",
    decision: "abstain",
    answer_type: "none",
    message: "No safe knowledge answer is available for this question.",
    confidence: 0.42,
    sources_used: ["knowledge_policy"],
    safety_flags: [...safetyFlags, "insufficient_static_knowledge"],
    tool_requests: buildToolRequests(query),
    warnings
  };
}

async function callRealKnowledgeModel(request: BrainKnowledgeAgentRequest): Promise<BrainKnowledgeAgentOutput | null> {
  const endpoint = process.env.BRAIN_MODEL_API_URL?.trim();
  const apiKey = process.env.BRAIN_MODEL_API_KEY?.trim();
  const modelName = process.env.BRAIN_MODEL_NAME?.trim() || "brain-knowledge";
  const timeoutMs = Number(process.env.BRAIN_MODEL_TIMEOUT_MS ?? 15000);

  if (!endpoint || !apiKey) return null;

  const prompt = buildKnowledgeAgentPrompt(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 15000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.system },
          {
            role: "user",
            content: JSON.stringify({
              inputEvent: request.inputEvent,
              context: request.context,
              contextPack: request.contextPack,
              policy: getKnowledgePolicy(),
              businessInfo: getStaticBusinessInfo()
            })
          }
        ]
      })
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as Partial<BrainKnowledgeAgentOutput>;
    return {
      outputSchema: "brain.agent.knowledge.output.v1",
      agentName: "knowledge",
      agentVersion: "brain.agent.knowledge.v2",
      decision: parsed.decision ?? "abstain",
      answer_type: parsed.answer_type ?? "none",
      message: typeof parsed.message === "string" ? parsed.message : "Knowledge model returned an empty response.",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.4,
      sources_used: Array.isArray(parsed.sources_used) ? parsed.sources_used.filter((item): item is string => typeof item === "string") : ["knowledge_policy"],
      safety_flags: Array.isArray(parsed.safety_flags) ? parsed.safety_flags.filter((item): item is string => typeof item === "string") : ["real_model"],
      tool_requests: Array.isArray(parsed.tool_requests) ? parsed.tool_requests.filter((item) => item && typeof item === "object") : buildToolRequests(request.inputEvent.message_text),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === "string") : []
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildResponse(request: BrainKnowledgeAgentRequest, output: BrainKnowledgeAgentOutput, startedAt: number, runtimeMode: "mock" | "real" | "disabled"): BrainKnowledgeAgentRunResponse {
  const requestId = request.requestId ?? request.context.traceId ?? makeBrainTraceId({
    source: request.context.source,
    messageId: request.context.messageId,
    waId: request.context.waId
  });

  return {
    ok: true,
    requestId,
    ...output,
    validationErrors: [],
    metadata: {
      version: "brain.agent.knowledge.runtime.v1",
      generatedAt: new Date().toISOString(),
      processingMs: Date.now() - startedAt,
      dryRun: request.options.dryRun,
      debug: request.options.debug,
      modelName: runtimeMode === "real" ? "real" : runtimeMode === "mock" ? "mock" : "disabled",
      modelVersion: runtimeMode === "real" ? process.env.BRAIN_MODEL_NAME?.trim() || "brain-knowledge" : runtimeMode === "mock" ? "brain.model.mock.v2" : "brain.model.disabled.v1",
      promptVersion: "brain.knowledge.prompt.v1",
      runtimeMode
    }
  };
}

function buildFailedResponse(request: BrainKnowledgeAgentRequest, reason: string, startedAt: number, warnings: string[] = []): BrainKnowledgeAgentRunResponse {
  const requestId = request.requestId ?? request.context.traceId ?? makeBrainTraceId({
    source: request.context.source,
    messageId: request.context.messageId,
    waId: request.context.waId
  });

  return {
    ok: false,
    requestId,
    outputSchema: "brain.agent.knowledge.output.v1",
    agentName: "knowledge",
    agentVersion: "brain.agent.knowledge.v2",
    decision: "abstain",
    answer_type: "none",
    message: reason,
    confidence: 0,
    sources_used: ["knowledge_policy"],
    safety_flags: ["read_only", "no_db_writes", "no_whatsapp", "no_llm", "knowledge_runtime_blocked"],
    tool_requests: buildToolRequests(request.inputEvent.message_text),
    warnings,
    validationErrors: [
      {
        code: "INVALID_INPUT",
        message: reason,
        retryable: false
      }
    ],
    metadata: {
      version: "brain.agent.knowledge.runtime.v1",
      generatedAt: new Date().toISOString(),
      processingMs: Date.now() - startedAt,
      dryRun: request.options.dryRun,
      debug: request.options.debug,
      modelName: "disabled",
      modelVersion: "brain.model.disabled.v1",
      promptVersion: "brain.knowledge.prompt.v1",
      runtimeMode: "disabled"
    }
  };
}

export async function runKnowledgeAgent(request: BrainKnowledgeAgentRequest, startedAt = Date.now()): Promise<BrainKnowledgeAgentRunResponse> {
  if (!request.options.dryRun) {
    return buildFailedResponse(request, "Knowledge Agent is only runnable in dry-run mode.", startedAt, ["dry_run_required"]);
  }

  if (request.options.executeActions) {
    return buildFailedResponse(request, "executeActions=true is not allowed for Knowledge Agent.", startedAt, ["execute_actions_disabled"]);
  }

  const runtimeMode = process.env.BRAIN_ENABLE_REAL_MODEL === "true" ? "real" : "mock";
  let output: BrainKnowledgeAgentOutput | null = null;
  const warnings: string[] = [];

  if (runtimeMode === "real") {
    output = await callRealKnowledgeModel(request);
    if (!output) {
      warnings.push("Real model flag enabled but credentials or provider were unavailable; fell back to abstain.");
      output = createAbstainDraft(request, "Real knowledge model is unavailable.", warnings);
    }
  } else {
    output = buildMockDraft(request);
  }

  const validation = validateKnowledgeAgentOutput(output);
  if (!validation.ok) {
    return buildFailedResponse(request, validation.errors[0]?.message ?? "Knowledge Agent output is invalid.", startedAt, validation.errors.map((item) => item.message));
  }

  const mergedWarnings = [...warnings, ...validation.value.warnings];
  const normalizedOutput: BrainKnowledgeAgentOutput = {
    ...validation.value,
    warnings: mergedWarnings
  };

  return buildResponse(request, normalizedOutput, startedAt, runtimeMode);
}
