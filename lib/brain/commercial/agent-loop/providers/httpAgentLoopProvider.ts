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
import { classifyHttpStatusFailure, classifyRawProviderError, markAgentLoopProviderFailure } from "./providerFailureClassification";

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
        throw markAgentLoopProviderFailure(new Error("Agent loop HTTP provider unavailable: missing endpoint or API key."), {
          model,
          attemptCount: 0,
          maxAttempts: maxModelRetries + 1,
          httpStatus: null,
          errorCode: "provider_not_configured",
          errorClass: "ConfigurationError",
          normalizedReason: "unknown_provider_error",
          retryable: false
        });
      }

      const deadline = Date.now() + options.timeoutMs;

      /**
       * LLM-R1-T08A. Shared classification for a transport-level failure at
       * ANY point within one attempt - fetch() itself, or consuming the
       * response body (response.json()) once headers already arrived. An
       * external (turn-level) abort is never retried - there is no time
       * left, and the caller already treats this as a timeout - so it
       * always rethrows as-is. Anything else is either retry-eligible
       * (backs off, caller starts a fresh attempt) or a final classified
       * throw (an AbortError here means the per-attempt deadline itself
       * expired mid-flight - classifyRawProviderError maps that to
       * normalizedReason "provider_timeout", never "invalid_response").
       * Never called for a fully-received-but-malformed body
       * (invalid_json_response/invalid_model_json/empty_response) - those
       * are content problems, not transport ones, and stay non-retryable at
       * their own call sites below, never routed through this.
       */
      async function handleTransportFailure(error: unknown, attempt: number): Promise<"retry"> {
        if (isAbortError(error) && options.signal?.aborted) {
          throw error;
        }
        const remainingBudget = deadline - Date.now();
        if (attempt < maxModelRetries && remainingBudget > 0) {
          await sleep(Math.min(computeBackoffMs(attempt), remainingBudget), options.signal);
          return "retry";
        }
        throw markAgentLoopProviderFailure(error, classifyRawProviderError(error, { model, attemptCount: attempt + 1, maxAttempts: maxModelRetries + 1 }));
      }

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

        // LLM-R1-T08A. attemptSignal must stay armed for the WHOLE attempt -
        // fetch() AND response.json() - not just fetch(). Cleaning it up the
        // moment fetch() resolves (the pre-T08A bug) tears down the deadline
        // timer and the external-abort listener before the response body is
        // ever read, so a slow/hung response.json() (where a non-streaming
        // completion's real generation time actually lives) had zero timeout
        // protection: a real call was observed running 83641ms against a
        // 20000ms deadline, still classified "success" (see
        // docs/audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md section 8).
        // cleanup() now runs exactly once per attempt, in this finally,
        // covering every exit path below (success return, retry continue, or
        // throw).
        try {
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
            await handleTransportFailure(error, attempt);
            continue;
          }

          if (!response.ok) {
            const statusError = new Error(`Agent loop HTTP provider failed with status ${response.status}.`);
            const remainingBudget = deadline - Date.now();
            const retryable = RETRYABLE_HTTP_STATUSES.has(response.status);
            if (retryable && attempt < maxModelRetries && remainingBudget > 0) {
              await sleep(Math.min(computeBackoffMs(attempt), remainingBudget), options.signal);
              continue;
            }
            throw markAgentLoopProviderFailure(
              statusError,
              classifyHttpStatusFailure(response.status, retryable, { model, attemptCount: attempt + 1, maxAttempts: maxModelRetries + 1 })
            );
          }

          let data: OpenAiChatCompletionResponse;
          try {
            data = (await response.json()) as OpenAiChatCompletionResponse;
          } catch (error) {
            // LLM-R1-T08A. A pending body read that the deadline/external
            // signal just aborted is a transport failure (provider_timeout),
            // never the same thing as a fully-received-but-malformed body -
            // the two used to collapse into the same "invalid JSON" throw
            // below because cleanup() had already disarmed the signal by
            // this point, so an abort here previously could not even happen.
            if (isAbortError(error)) {
              await handleTransportFailure(error, attempt);
              continue;
            }
            throw markAgentLoopProviderFailure(new Error("Agent loop HTTP provider returned invalid JSON."), {
              model,
              attemptCount: attempt + 1,
              maxAttempts: maxModelRetries + 1,
              httpStatus: response.status,
              errorCode: "invalid_json_response",
              errorClass: "InvalidProviderResponseError",
              normalizedReason: "invalid_response",
              retryable: false
            });
          }

          const choice = data.choices?.[0];
          const content = choice?.message?.content;
          // LLM-R1-T02. `data` (and `choice`, when present) is already a
          // successfully parsed response envelope at this point, even on the
          // empty_response/invalid_model_json failure paths below - the exact
          // same usage/finish_reason/id fields the success return already
          // reads are available here too, never re-fetched, never guessed.
          // Absent (undefined) only above, at the invalid_json_response throw,
          // where no envelope was ever parsed at all.
          const availableResponseMetadata = {
            finishReason: choice?.finish_reason ?? null,
            inputTokens: data.usage?.prompt_tokens ?? null,
            outputTokens: data.usage?.completion_tokens ?? null,
            providerRequestId: data.id ?? response.headers.get("x-request-id")
          };
          if (!content) {
            throw markAgentLoopProviderFailure(new Error("Agent loop HTTP provider returned an empty response."), {
              model,
              attemptCount: attempt + 1,
              maxAttempts: maxModelRetries + 1,
              httpStatus: response.status,
              errorCode: "empty_response",
              errorClass: "InvalidProviderResponseError",
              normalizedReason: "invalid_response",
              retryable: false,
              ...availableResponseMetadata
            });
          }

          let rawOutput: unknown;
          try {
            rawOutput = parseModelJson(content);
          } catch {
            throw markAgentLoopProviderFailure(new Error("Agent loop HTTP provider returned invalid response JSON."), {
              model,
              attemptCount: attempt + 1,
              maxAttempts: maxModelRetries + 1,
              httpStatus: response.status,
              errorCode: "invalid_model_json",
              errorClass: "InvalidProviderResponseError",
              normalizedReason: "invalid_response",
              retryable: false,
              ...availableResponseMetadata
            });
          }

          return {
            rawOutput,
            model: data.model ?? model,
            inputTokens: availableResponseMetadata.inputTokens,
            outputTokens: availableResponseMetadata.outputTokens,
            providerRequestId: availableResponseMetadata.providerRequestId,
            finishReason: availableResponseMetadata.finishReason
          };
        } finally {
          attemptSignal.cleanup();
        }
      }
    }
  };
}
