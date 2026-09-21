/**
 * SALES-AGENT-R3-P7.8-R. Benchmark-only chat-completions client with NATIVE
 * function calling (OpenAI-compatible `tools`), used by the true autonomous
 * harness (variants B/C). It talks to the LLM only - never to a Catalog/Quote/
 * DB. No AgentStep, no JSON-mode step protocol: the model either returns
 * tool_calls or plain text.
 *
 * Retry/timeout discipline mirrors the production HTTP provider so the model
 * configuration is genuinely identical across A/B/C: retry only transport
 * failures and retryable statuses, bounded by `maxModelRetries` and by the
 * turn deadline; an external deadline always wins.
 */

export type NativeToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };

export type NativeToolCall = { id: string; name: string; arguments: string };

export type NativeChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type NativeModelCallResult =
  | {
      kind: "ok";
      content: string | null;
      toolCalls: NativeToolCall[];
      finishReason: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      reasoningTokens: number | null;
      elapsedMs: number;
    }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "error"; reason: "http_error" | "network_error" | "invalid_response"; httpStatus: number | null; elapsedMs: number };

export type NativeModelCaller = (input: { messages: NativeChatMessage[]; tools: NativeToolDefinition[]; deadlineMs: number }) => Promise<NativeModelCallResult>;

export type NativeToolClientConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  maxModelRetries: number;
  thinking?: "enabled" | "disabled";
};

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type ChatCompletionResponse = {
  choices?: { finish_reason?: string | null; message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
};

export function createNativeToolCaller(config: NativeToolClientConfig, fetchImpl: typeof fetch = fetch): NativeModelCaller {
  return async ({ messages, tools, deadlineMs }) => {
    const startedAt = Date.now();
    for (let attempt = 0; attempt <= config.maxModelRetries; attempt += 1) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) return { kind: "timeout", elapsedMs: Date.now() - startedAt };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remainingMs);
      try {
        const response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model,
            temperature: config.temperature,
            ...(config.maxOutputTokens !== undefined ? { max_tokens: config.maxOutputTokens } : {}),
            ...(config.thinking !== undefined ? { thinking: { type: config.thinking } } : {}),
            messages,
            tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
            tool_choice: "auto"
          })
        });
        if (!response.ok) {
          if (RETRYABLE_STATUSES.has(response.status) && attempt < config.maxModelRetries) {
            clearTimeout(timer);
            await sleep(Math.min(500 * 2 ** attempt, 8000, Math.max(0, deadlineMs - Date.now())));
            continue;
          }
          return { kind: "error", reason: "http_error", httpStatus: response.status, elapsedMs: Date.now() - startedAt };
        }
        const data = (await response.json()) as ChatCompletionResponse;
        const choice = data.choices?.[0];
        if (!choice?.message) return { kind: "error", reason: "invalid_response", httpStatus: response.status, elapsedMs: Date.now() - startedAt };
        return {
          kind: "ok",
          content: choice.message.content ?? null,
          toolCalls: (choice.message.tool_calls ?? []).map((call, index) => ({ id: call.id ?? `call_${index}`, name: call.function?.name ?? "", arguments: call.function?.arguments ?? "{}" })),
          finishReason: choice.finish_reason ?? null,
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null,
          reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
          elapsedMs: Date.now() - startedAt
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return { kind: "timeout", elapsedMs: Date.now() - startedAt };
        if (attempt < config.maxModelRetries) {
          clearTimeout(timer);
          await sleep(Math.min(500 * 2 ** attempt, 8000, Math.max(0, deadlineMs - Date.now())));
          continue;
        }
        return { kind: "error", reason: "network_error", httpStatus: null, elapsedMs: Date.now() - startedAt };
      } finally {
        clearTimeout(timer);
      }
    }
    return { kind: "error", reason: "network_error", httpStatus: null, elapsedMs: Date.now() - startedAt };
  };
}
