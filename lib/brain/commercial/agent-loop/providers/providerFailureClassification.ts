import type { AgentLoopProviderFailure, AgentLoopProviderFailureNormalizedReason } from "../agentStepTypes";

/**
 * Sanitized classification of a raw provider error - never carries the raw
 * error message, a stack trace, headers, or any part of a provider response
 * body. `model`/`attemptCount`/`maxAttempts` are provider-known context the
 * classifier itself cannot infer, so callers that have it (httpAgentLoopProvider.ts)
 * attach it explicitly; everything else falls back to a conservative default.
 */
export type AgentLoopProviderFailureCause = Omit<AgentLoopProviderFailure, "provider" | "elapsedMs">;

const failureCauseByError = new WeakMap<object, AgentLoopProviderFailureCause>();

/** Tags a thrown error with its sanitized cause, without altering when/whether it is thrown or retried. */
export function markAgentLoopProviderFailure<E>(error: E, cause: AgentLoopProviderFailureCause): E {
  if (error && typeof error === "object") failureCauseByError.set(error, cause);
  return error;
}

function extractSystemErrorCode(error: unknown): string | null {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/**
 * Classifies an error that was never tagged with an explicit cause (a plain
 * AbortError, a fetch-level network failure, or anything unrecognized).
 * Reused both as the fallback path below and by httpAgentLoopProvider.ts at
 * its own fetch-catch site, where real attempt/model context is available.
 */
export function classifyRawProviderError(
  error: unknown,
  context: { model?: string | null; attemptCount?: number; maxAttempts?: number | null } = {}
): AgentLoopProviderFailureCause {
  const model = context.model ?? null;
  const attemptCount = context.attemptCount ?? 1;
  const maxAttempts = context.maxAttempts ?? null;

  if (error instanceof Error && error.name === "AbortError") {
    return { model, attemptCount, maxAttempts, httpStatus: null, errorCode: null, errorClass: "AbortError", normalizedReason: "provider_timeout", retryable: true };
  }

  const errorCode = extractSystemErrorCode(error);
  const isFetchFailure = error instanceof TypeError && /fetch failed/i.test(error.message);
  if (errorCode || isFetchFailure) {
    return {
      model,
      attemptCount,
      maxAttempts,
      httpStatus: null,
      errorCode,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      normalizedReason: "network_error",
      retryable: true
    };
  }

  return {
    model,
    attemptCount,
    maxAttempts,
    httpStatus: null,
    errorCode: null,
    errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    normalizedReason: "unknown_provider_error",
    retryable: false
  };
}

/** HTTP-status-only classification, used by httpAgentLoopProvider.ts at its non-2xx throw site. */
export function classifyHttpStatusFailure(
  status: number,
  retryable: boolean,
  context: { model?: string | null; attemptCount?: number; maxAttempts?: number | null } = {}
): AgentLoopProviderFailureCause {
  const model = context.model ?? null;
  const attemptCount = context.attemptCount ?? 1;
  const maxAttempts = context.maxAttempts ?? null;
  const errorCode = `http_${status}`;
  const errorClass = "HttpStatusError";

  let normalizedReason: AgentLoopProviderFailureNormalizedReason = "unknown_provider_error";
  if (status === 401 || status === 403) normalizedReason = "authentication_error";
  else if (status === 429) normalizedReason = "rate_limited";
  else if (status === 404) normalizedReason = "model_unavailable";
  else if (status >= 500) normalizedReason = "provider_server_error";

  return { model, attemptCount, maxAttempts, httpStatus: status, errorCode, errorClass, normalizedReason, retryable };
}

/** Entry point for runAgentToolLoop.ts: returns the tagged cause if present, otherwise classifies generically. */
export function classifyAgentLoopProviderFailure(error: unknown): AgentLoopProviderFailureCause {
  if (error && typeof error === "object") {
    const marked = failureCauseByError.get(error);
    if (marked) return marked;
  }
  return classifyRawProviderError(error);
}

/** Requirement: a structured, sanitized log line on every provider_unavailable outcome - stderr, never the raw error. */
export function logAgentLoopProviderFailure(correlationId: string, providerFailure: AgentLoopProviderFailure): void {
  console.error("agent_tool_loop_provider_failure", JSON.stringify({ correlationId, ...providerFailure }));
}
