import type {
  SalesAgentProvider,
  SalesAgentProviderInvokeOptions,
  SalesAgentProviderRequest,
  SalesAgentProviderResponse
} from "../runtimeTypes";

type HttpSalesAgentProviderConfig = {
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
    message?: {
      content?: string | null;
    } | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

function getConfigValue(value: string | null | undefined, fallback: string | undefined) {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  return fallback?.trim() || null;
}

function stripJsonFence(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]?.trim() ?? "" : trimmed;
}

function extractFirstJsonObject(value: string) {
  const stripped = stripJsonFence(value);
  const start = stripped.indexOf("{");
  if (start < 0) return stripped;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < stripped.length; index += 1) {
    const char = stripped[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(start, index + 1);
    }
  }

  return stripped;
}

function parseModelJson(content: string) {
  try {
    return JSON.parse(extractFirstJsonObject(content)) as unknown;
  } catch {
    throw new Error("Provider returned invalid response JSON.");
  }
}

export function createHttpSalesAgentProvider(config: HttpSalesAgentProviderConfig = {}): SalesAgentProvider {
  const endpoint = getConfigValue(config.endpoint, process.env.BRAIN_MODEL_API_URL);
  const apiKey = getConfigValue(config.apiKey, process.env.BRAIN_MODEL_API_KEY);
  const model = getConfigValue(config.model, process.env.BRAIN_MODEL_NAME) ?? "brain-sales-agent";
  const fetchImpl = config.fetchImpl ?? fetch;
  const temperature = config.temperature ?? 0;

  return {
    name: "http-sales-agent-provider",
    version: "http-openai-compatible.v1",
    async invoke(request: SalesAgentProviderRequest, options: SalesAgentProviderInvokeOptions): Promise<SalesAgentProviderResponse> {
      if (!endpoint || !apiKey) {
        throw new Error("Sales Agent HTTP provider unavailable: missing endpoint or API key.");
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
          messages: request.promptPackage.messages
        })
      });

      if (!response.ok) {
        throw new Error(`Sales Agent HTTP provider failed with status ${response.status}.`);
      }

      const data = (await response.json()) as OpenAiChatCompletionResponse;
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new Error("Sales Agent HTTP provider returned an empty response.");
      }

      return {
        rawOutput: parseModelJson(content),
        model: data.model ?? model,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
        estimatedCost: null,
        providerRequestId: data.id ?? response.headers.get("x-request-id"),
        finishReason: choice?.finish_reason ?? null,
        metadata: {
          endpointHost: new URL(endpoint).host,
          runtimeMode: request.runtimeMode,
          dryRun: options.dryRun
        }
      };
    }
  };
}

export type { HttpSalesAgentProviderConfig };
