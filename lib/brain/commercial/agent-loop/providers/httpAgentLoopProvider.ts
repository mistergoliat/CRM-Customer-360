import {
  SALES_AGENT_MODEL_CONFIGURATION_GENERIC_FALLBACK_MODEL,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT
} from "../../sales-agent-configuration";
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
  maxOutputTokens?: number;
  /** Technical HTTP/model retries only - never a second model decision or a finalization attempt (those live in runAgentToolLoop.ts). */
  maxModelRetries?: number;
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
 * 429 and a fixed set of transient 5xx - never a blanket "any non-2xx".
 * 400/401/403 and any other 4xx are authored/auth problems a retry cannot
 * fix, so they are deliberately absent here and fall through to the
 * non-retryable throw in invoke() below.
 */
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 2000;

function computeBackoffMs(attemptIndex: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attemptIndex);
}

function buildAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/**
 * ACS-R1-05.1-T02.3B (correction). The backoff wait between retries must be
 * cancelable by the caller's own external (turn-level) deadline signal - a
 * bare setTimeout previously let a retry sleep run to completion even after
 * the whole turn had already been aborted, wasting the rest of the budget
 * doing nothing useful before finally giving up.
 */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(buildAbortError("Agent loop HTTP provider backoff aborted."));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Combines the caller's own deadline signal (runAgentToolLoop.ts's
 * invokeProviderWithDeadline, turn-level) with a per-attempt timer so one
 * hung attempt cannot silently consume the whole remaining turn budget
 * without ever giving a later attempt a chance.
 */
function buildAttemptSignal(externalSignal: AbortSignal | null | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }
  };
}

/**
 * Same OpenAI-compatible calling convention as httpSalesAgentProvider.ts,
 * reused deliberately (shared JSON-extraction helpers) rather than
 * duplicated end to end - but a distinct, lighter request shape (see
 * agentLoopProviderTypes.ts) so this loop never depends on SalesAgentInput.
 *
 * `max_tokens` (not `max_output_tokens`) - confirmed against the real
 * response shape this provider already parses (choices[].message.content,
 * usage.prompt_tokens/completion_tokens, top-level id/model/finish_reason):
 * the classic OpenAI Chat Completions contract, which is exactly what
 * .env.example documents for this integration (DeepSeek's
 * /chat/completions, an OpenAI-compatible endpoint that uses `max_tokens`).
 */
export function createHttpAgentLoopProvider(config: HttpAgentLoopProviderConfig = {}): AgentLoopProvider {
  const endpoint = getConfigValue(config.endpoint, process.env.BRAIN_MODEL_API_URL);
  const apiKey = getConfigValue(config.apiKey, process.env.BRAIN_MODEL_API_KEY);
  const model = getConfigValue(config.model, process.env.BRAIN_MODEL_NAME) ?? SALES_AGENT_MODEL_CONFIGURATION_GENERIC_FALLBACK_MODEL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const temperature = config.temperature ?? 0;
  // ACS-R1-05.1-T02.3B (correction). Never defaulted - an unconfigured
  // deployment (no published maxOutputTokens) omits max_tokens from the
  // request entirely below, exactly like the pre-T02.3B provider did,
  // instead of silently capping every call at an invented number.
  const maxOutputTokens = config.maxOutputTokens;
  const maxModelRetries = config.maxModelRetries ?? SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.maxModelRetries;

  return {
    name: "http-agent-loop-provider",
    version: "http-openai-compatible.v1",
    async invoke(request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse> {
      if (!endpoint || !apiKey) {
        throw new Error("Agent loop HTTP provider unavailable: missing endpoint or API key.");
      }

      const deadline = Date.now() + options.timeoutMs;

      for (let attempt = 0; ; attempt += 1) {
        // ACS-R1-05.1-T02.3B (correction). Never start a new attempt once
        // the deadline has already passed - the old Math.max(1, ...) clamp
        // forced at least a 1ms budget and silently made one more network
        // call anyway, even with zero real time left.
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw options.signal?.aborted
            ? buildAbortError("Agent loop HTTP provider aborted before starting an attempt.")
            : new Error("Agent loop HTTP provider deadline exceeded before starting an attempt.");
        }
        const attemptSignal = buildAttemptSignal(options.signal, remainingMs);

        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            signal: attemptSignal.signal,
            body: JSON.stringify({
              model,
              temperature,
              ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
              response_format: { type: "json_object" },
              messages: request.messages
            })
          });
        } catch (error) {
          attemptSignal.cleanup();
          // The external (turn-level) deadline firing is never retried -
          // there is no time left, and the caller already treats this as a
          // timeout. Any other thrown error here (per-attempt timeout, a
          // genuine connection failure) is a technical, transient failure.
          if (isAbortError(error) && options.signal?.aborted) {
            throw error;
          }
          const remainingBudget = deadline - Date.now();
          if (attempt < maxModelRetries && remainingBudget > 0) {
            await sleep(Math.min(computeBackoffMs(attempt), remainingBudget), options.signal);
            continue;
          }
          throw error;
        }
        attemptSignal.cleanup();

        if (!response.ok) {
          const statusError = new Error(`Agent loop HTTP provider failed with status ${response.status}.`);
          const remainingBudget = deadline - Date.now();
          if (RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < maxModelRetries && remainingBudget > 0) {
            await sleep(Math.min(computeBackoffMs(attempt), remainingBudget), options.signal);
            continue;
          }
          throw statusError;
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
    }
  };
}
