import type {
  CreateCustomerIntelligenceCopilotSessionResult,
  CustomerIntelligenceCopilotResponse,
  CustomerIntelligenceCopilotSessionTurnResponse,
  CustomerIntelligenceCopilotUiContext,
  DeleteCustomerIntelligenceCopilotSessionResult,
  RefreshCustomerIntelligenceCopilotSessionResult,
  ResetCustomerIntelligenceCopilotSessionResult
} from "@/lib/marketing/customerIntelligenceCopilot";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_QUESTION_LENGTH = 4000;

export type MarketingCopilotClientConfig = {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;
};

export type JsonUpstreamResult<T> = {
  readonly status: number;
  readonly body: T;
};

export type BinaryUpstreamResult = {
  readonly status: number;
  readonly body: ArrayBuffer;
  readonly contentType: string;
  readonly contentDisposition: string | null;
};

export class MarketingCopilotClientConfigurationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MarketingCopilotClientConfigurationError";
    this.code = code;
    this.status = status;
  }
}

export class MarketingCopilotUpstreamError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MarketingCopilotUpstreamError";
    this.code = code;
    this.status = status;
  }
}

export function readMarketingCopilotClientConfig(env: NodeJS.ProcessEnv = process.env): MarketingCopilotClientConfig {
  const enabled = env.MARKETING_COPILOT_ENABLED?.trim().toLowerCase() === "true";
  const baseUrl = env.MARKETING_COPILOT_BACKEND_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const token = env.MARKETING_COPILOT_INTERNAL_TOKEN?.trim() ?? "";
  const timeoutMs = Number.parseInt(env.MARKETING_COPILOT_TIMEOUT_MS?.trim() ?? "", 10);
  return {
    enabled,
    baseUrl,
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

export async function createCopilotSession(input: { readonly featureSnapshotId?: string | null } = {}): Promise<JsonUpstreamResult<CreateCustomerIntelligenceCopilotSessionResult>> {
  return callCustomerProfileJson<CreateCustomerIntelligenceCopilotSessionResult>("/v1/customer-intelligence/copilot/sessions", {
    method: "POST",
    body: input.featureSnapshotId ? { featureSnapshotId: input.featureSnapshotId } : {}
  });
}

export async function sendCopilotMessage(sessionId: string, question: string, uiContext?: CustomerIntelligenceCopilotUiContext): Promise<JsonUpstreamResult<CustomerIntelligenceCopilotSessionTurnResponse>> {
  return callCustomerProfileJson<CustomerIntelligenceCopilotSessionTurnResponse>(`/v1/customer-intelligence/copilot/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: uiContext ? { question, uiContext } : { question }
  });
}

export async function refreshCopilotSession(sessionId: string): Promise<JsonUpstreamResult<RefreshCustomerIntelligenceCopilotSessionResult>> {
  return callCustomerProfileJson<RefreshCustomerIntelligenceCopilotSessionResult>(`/v1/customer-intelligence/copilot/sessions/${encodeURIComponent(sessionId)}/refresh`, {
    method: "POST",
    body: {}
  });
}

export async function resetCopilotSession(sessionId: string): Promise<JsonUpstreamResult<ResetCustomerIntelligenceCopilotSessionResult>> {
  return callCustomerProfileJson<ResetCustomerIntelligenceCopilotSessionResult>(`/v1/customer-intelligence/copilot/sessions/${encodeURIComponent(sessionId)}/reset`, {
    method: "POST",
    body: {}
  });
}

export async function deleteCopilotSession(sessionId: string): Promise<JsonUpstreamResult<DeleteCustomerIntelligenceCopilotSessionResult>> {
  return callCustomerProfileJson<DeleteCustomerIntelligenceCopilotSessionResult>(`/v1/customer-intelligence/copilot/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });
}

export async function exportCopilotSessionResult(sessionId: string, input: { readonly queryId: string; readonly format: "xlsx" }): Promise<BinaryUpstreamResult> {
  const response = await callCustomerProfile(`/v1/customer-intelligence/copilot/sessions/${encodeURIComponent(sessionId)}/export`, {
    method: "POST",
    body: input
  });
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const contentDisposition = response.headers.get("content-disposition");
  if (!response.ok) {
    throw new MarketingCopilotUpstreamError("marketing_copilot_export_failed", await safeErrorMessage(response), response.status);
  }
  return {
    status: response.status,
    body: await response.arrayBuffer(),
    contentType,
    contentDisposition
  };
}

export async function askCopilotQuestion(input: { readonly question: string; readonly featureSnapshotId?: string | null }): Promise<JsonUpstreamResult<CustomerIntelligenceCopilotResponse>> {
  return callCustomerProfileJson<CustomerIntelligenceCopilotResponse>("/v1/customer-intelligence/copilot", {
    method: "POST",
    body: { question: input.question, ...(input.featureSnapshotId ? { featureSnapshotId: input.featureSnapshotId } : {}) }
  });
}

export async function callCustomerProfileJson<T>(path: string, input: { readonly method: "GET" | "POST" | "DELETE"; readonly body?: unknown }): Promise<JsonUpstreamResult<T>> {
  const response = await callCustomerProfile(path, input);
  return {
    status: response.status,
    body: (await readJson(response)) as T
  };
}

export async function callCustomerProfile(path: string, input: { readonly method: "GET" | "POST" | "DELETE"; readonly body?: unknown }): Promise<Response> {
  const config = readMarketingCopilotClientConfig();
  assertConfig(config);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await fetch(`${config.baseUrl}${path}`, {
      method: input.method,
      headers: {
        "content-type": "application/json",
        "x-internal-copilot-token": config.token
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
      cache: "no-store"
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    throw new MarketingCopilotUpstreamError(
      "marketing_copilot_unavailable",
      isTimeout ? "Marketing Copilot backend timed out." : "Marketing Copilot backend is unavailable.",
      isTimeout ? 504 : 503
    );
  } finally {
    clearTimeout(timeout);
  }
}

function assertConfig(config: MarketingCopilotClientConfig): void {
  if (!config.enabled) {
    throw new MarketingCopilotClientConfigurationError("marketing_copilot_disabled", "Marketing Copilot is disabled.", 404);
  }
  if (!config.baseUrl || !config.token) {
    throw new MarketingCopilotClientConfigurationError("marketing_copilot_not_configured", "Marketing Copilot backend is not configured.", 503);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return response.ok ? { status: "answered", message: "Backend returned non-JSON response." } : { code: "marketing_copilot_bad_response", message: "Backend returned non-JSON response." };
  }
}

async function safeErrorMessage(response: Response): Promise<string> {
  const body = await readJson(response);
  if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") return body.message;
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return "Marketing Copilot export failed.";
}

export function isMarketingCopilotClientError(error: unknown): error is MarketingCopilotClientConfigurationError | MarketingCopilotUpstreamError {
  return error instanceof MarketingCopilotClientConfigurationError || error instanceof MarketingCopilotUpstreamError;
}

export function isValidQuestion(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_QUESTION_LENGTH;
}
