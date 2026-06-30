import type { AgentProvider, AgentProviderDecision, AgentProviderRequest, AgentProviderResult } from "./types";

/**
 * Real LLM provider: any OpenAI-compatible chat-completions gateway.
 * Reuses the same BRAIN_MODEL_* contract as the existing knowledge agent
 * (lib/brain/agents/knowledge/runKnowledgeAgent.ts) rather than inventing a
 * second model configuration for the same underlying concept.
 *
 * The model is asked to return exactly one structured JSON action per call
 * (tool_call | respond | handoff) instead of relying on a specific provider's
 * native function-calling API, so this works against any OpenAI-compatible
 * endpoint without provider-specific assumptions.
 */
function buildToolMenuText(request: AgentProviderRequest) {
  return request.tools
    .map((tool) => `- ${tool.name}: ${tool.description}\n  input_schema: ${JSON.stringify(tool.inputSchema)}`)
    .join("\n");
}

function buildResponseFormatInstruction() {
  return [
    "Respond with exactly one JSON object, no prose outside the JSON, matching one of these shapes:",
    '{"action":"tool_call","tool_name":"<one of the listed tool names>","input":{...},"thought":"<short reasoning>"}',
    '{"action":"respond","message":"<natural reply to the customer>","thought":"<short reasoning>","finalize":true|false}',
    '{"action":"handoff","reason":"<why a human is needed now>","message":"<optional message to the customer>","mode":"exclusive_handoff"|"approval_request"|"internal_consultation"}',
    "Use \"finalize\": false only when you expect to act again after the customer's next message in the same turn is impossible; in nearly all cases finalize should be true once you produce a customer-facing message."
  ].join("\n");
}

function parseDecision(content: string): AgentProviderDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { type: "malformed", raw: content, error: error instanceof Error ? error.message : "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { type: "malformed", raw: content, error: "not_an_object" };
  }
  const record = parsed as Record<string, unknown>;
  if (record.action === "tool_call" && typeof record.tool_name === "string") {
    return {
      type: "tool_call",
      toolName: record.tool_name,
      input: (record.input && typeof record.input === "object" ? (record.input as Record<string, unknown>) : {}),
      thought: typeof record.thought === "string" ? record.thought : ""
    };
  }
  if (record.action === "respond" && typeof record.message === "string") {
    return {
      type: "respond",
      message: record.message,
      thought: typeof record.thought === "string" ? record.thought : "",
      finalize: record.finalize !== false
    };
  }
  if (record.action === "handoff" && typeof record.reason === "string") {
    const mode = record.mode === "approval_request" || record.mode === "internal_consultation" ? record.mode : "exclusive_handoff";
    return {
      type: "handoff",
      reason: record.reason,
      message: typeof record.message === "string" ? record.message : null,
      mode
    };
  }
  return { type: "malformed", raw: content, error: "unrecognized_action_shape" };
}

export function createHttpAgentProvider(): AgentProvider {
  return {
    name: "http",
    async complete(request: AgentProviderRequest): Promise<AgentProviderResult> {
      const endpoint = process.env.BRAIN_MODEL_API_URL?.trim();
      const apiKey = process.env.BRAIN_MODEL_API_KEY?.trim();
      const modelName = process.env.BRAIN_MODEL_NAME?.trim() || "brain-commercial-agent";
      const timeoutMs = Number(process.env.BRAIN_MODEL_TIMEOUT_MS ?? 15000);

      if (!endpoint || !apiKey) {
        throw new Error("BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY not configured");
      }

      const toolMenu = buildToolMenuText(request);
      const systemMessages = request.messages.filter((message) => message.role === "system");
      const conversationMessages = request.messages.filter((message) => message.role !== "system");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 15000);
      const startedAt = Date.now();

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
            temperature: request.temperature ?? 0.2,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: [...systemMessages.map((message) => message.content), "Available tools:", toolMenu, buildResponseFormatInstruction()].join("\n\n")
              },
              ...conversationMessages.map((message) => ({
                role: message.role === "tool" ? "user" : message.role,
                content: message.role === "tool" ? `Tool result from ${message.toolName ?? "tool"}: ${message.content}` : message.content
              }))
            ]
          })
        });

        const latencyMs = Date.now() - startedAt;
        if (!response.ok) {
          throw new Error(`model_http_${response.status}`);
        }
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("model_empty_response");
        }

        return {
          decision: parseDecision(content),
          modelName,
          latencyMs,
          rawTokensIn: data.usage?.prompt_tokens ?? null,
          rawTokensOut: data.usage?.completion_tokens ?? null
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
