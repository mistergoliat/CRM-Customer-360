import { parseModelJson } from "../../shared/parseModelJsonOutput";
import type {
  AgentLoopProvider,
  AgentLoopProviderInvokeOptions,
  AgentLoopProviderRequest,
  AgentLoopProviderResponse
} from "../agentLoopProviderTypes";

type HttpAgentLoopProviderConfig = {
  endpoint?: string | null;
  apiKey?: string | null;
  model?: string | null;
  temperature?: number;
  fetchImpl?: typeof fetch;
};

type OpenAiChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null } | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function getConfigValue(value: string | null | undefined, fallback: string | undefined) {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  return fallback?.trim() || null;
}

/**
 * Same OpenAI-compatible calling convention as httpSalesAgentProvider.ts,
 * reused deliberately (shared JSON-extraction helpers) rather than
 * duplicated end to end - but a distinct, lighter request shape (see
 * agentLoopProviderTypes.ts) so this loop never depends on SalesAgentInput.
 */
export function createHttpAgentLoopProvider(config: HttpAgentLoopProviderConfig = {}): AgentLoopProvider {
  const endpoint = getConfigValue(config.endpoint, process.env.BRAIN_MODEL_API_URL);
  const apiKey = getConfigValue(config.apiKey, process.env.BRAIN_MODEL_API_KEY);
  const model = getConfigValue(config.model, process.env.BRAIN_MODEL_NAME) ?? "brain-agent-loop";
  const fetchImpl = config.fetchImpl ?? fetch;
  const temperature = config.temperature ?? 0;

  return {
    name: "http-agent-loop-provider",
    version: "http-openai-compatible.v1",
    async invoke(request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse> {
      if (!endpoint || !apiKey) {
        throw new Error("Agent loop HTTP provider unavailable: missing endpoint or API key.");
      }

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: options.signal ?? undefined,
        body: JSON.stringify({
          model,
          temperature,
          response_format: { type: "json_object" },
          messages: request.messages
        })
      });

      if (!response.ok) {
        throw new Error(`Agent loop HTTP provider failed with status ${response.status}.`);
      }

      const data = (await response.json()) as OpenAiChatCompletionResponse;
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new Error("Agent loop HTTP provider returned an empty response.");
      }

      return {
        rawOutput: parseModelJson(content),
        model: data.model ?? model,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
        providerRequestId: data.id ?? response.headers.get("x-request-id"),
        finishReason: choice?.finish_reason ?? null
      };
    }
  };
}
