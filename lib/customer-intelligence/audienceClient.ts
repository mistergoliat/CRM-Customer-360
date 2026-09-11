import type { AudienceDefinitionV1, AudienceExportFormat, AudienceExportField } from "@/lib/marketing/customerIntelligenceAudience";

const DEFAULT_TIMEOUT_MS = 30000;

export type AudienceClientConfig = {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly evaluateToken: string;
  readonly exportToken: string;
  readonly piiExportToken: string;
  readonly timeoutMs: number;
};

export class AudienceClientConfigurationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AudienceClientConfigurationError";
    this.code = code;
    this.status = status;
  }
}

export class AudienceUpstreamError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AudienceUpstreamError";
    this.code = code;
    this.status = status;
  }
}

export function isAudienceClientError(error: unknown): error is AudienceClientConfigurationError | AudienceUpstreamError {
  return error instanceof AudienceClientConfigurationError || error instanceof AudienceUpstreamError;
}

// Reuses the Customer Intelligence backend connection already configured for Marketing Copilot /
// Dashboard (MARKETING_COPILOT_BACKEND_BASE_URL) - it is the same MS-pesaschile-customer-profile
// instance. Audiences get their own enable flag and their own internal tokens (least privilege:
// evaluate / bulk export / PII export are separate capabilities on the real backend).
export function readAudienceClientConfig(env: NodeJS.ProcessEnv = process.env): AudienceClientConfig {
  const enabled = env.CUSTOMER_INTELLIGENCE_AUDIENCE_ENABLED?.trim().toLowerCase() === "true";
  const baseUrl = env.MARKETING_COPILOT_BACKEND_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const evaluateToken = env.CUSTOMER_INTELLIGENCE_AUDIENCE_TOKEN?.trim() ?? "";
  const exportToken = env.CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_TOKEN?.trim() ?? "";
  const piiExportToken = env.CUSTOMER_INTELLIGENCE_AUDIENCE_PII_EXPORT_TOKEN?.trim() ?? "";
  const timeoutMs = Number.parseInt(env.MARKETING_COPILOT_TIMEOUT_MS?.trim() ?? "", 10);
  return {
    enabled,
    baseUrl,
    evaluateToken,
    exportToken,
    piiExportToken,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

export type JsonUpstreamResult<T> = { readonly status: number; readonly body: T };

export type BinaryUpstreamResult = {
  readonly status: number;
  readonly body: ArrayBuffer;
  readonly contentType: string;
  readonly contentDisposition: string | null;
  readonly contentLength: string | null;
  readonly matchedCount: string | null;
  readonly unknownCount: string | null;
};

function assertEvaluateConfig(config: AudienceClientConfig): void {
  if (!config.enabled) throw new AudienceClientConfigurationError("audience_workspace_disabled", "Audience Workspace is disabled.", 404);
  if (!config.baseUrl || !config.evaluateToken) throw new AudienceClientConfigurationError("audience_workspace_not_configured", "Audience backend is not configured.", 503);
}

function assertExportConfig(config: AudienceClientConfig, requiresPii: boolean): void {
  if (!config.enabled) throw new AudienceClientConfigurationError("audience_workspace_disabled", "Audience Workspace is disabled.", 404);
  if (!config.baseUrl || !config.exportToken) throw new AudienceClientConfigurationError("audience_workspace_not_configured", "Audience export backend is not configured.", 503);
  if (requiresPii && !config.piiExportToken) {
    throw new AudienceClientConfigurationError("audience_pii_export_not_configured", "PII export is not authorized for this environment.", 403);
  }
}

export async function evaluateAudience(input: { readonly definition: AudienceDefinitionV1; readonly previewLimit: number }): Promise<JsonUpstreamResult<unknown>> {
  const config = readAudienceClientConfig();
  assertEvaluateConfig(config);
  const response = await requestAudienceBackend(config, "/v1/customer-intelligence/audiences/evaluate", { "x-internal-customer-intelligence-token": config.evaluateToken }, {
    definition: input.definition,
    previewLimit: input.previewLimit
  });
  return { status: response.status, body: await readJson(response) };
}

// GET /v1/customer-intelligence/audiences/schema is gated behind the same token as evaluate
// (ensureAudienceRouteAvailable in Customer Profile's routes/index.ts) - not a separate capability.
export async function getAudienceSchema(): Promise<JsonUpstreamResult<unknown>> {
  const config = readAudienceClientConfig();
  assertEvaluateConfig(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/v1/customer-intelligence/audiences/schema`, {
      method: "GET",
      headers: { "x-internal-customer-intelligence-token": config.evaluateToken },
      signal: controller.signal,
      cache: "no-store"
    });
    return { status: response.status, body: await readJson(response) };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    throw new AudienceUpstreamError(
      "audience_backend_unavailable",
      isTimeout ? "Customer Profile audience backend timed out." : "Customer Profile audience backend is unavailable.",
      isTimeout ? 504 : 503
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function exportAudience(input: {
  readonly definition: AudienceDefinitionV1;
  readonly format: AudienceExportFormat;
  readonly fields: readonly AudienceExportField[];
  readonly requiresPii: boolean;
}): Promise<BinaryUpstreamResult> {
  const config = readAudienceClientConfig();
  assertExportConfig(config, input.requiresPii);

  const headers: Record<string, string> = { "x-internal-customer-intelligence-export-token": config.exportToken };
  if (input.requiresPii) headers["x-internal-customer-intelligence-pii-export-token"] = config.piiExportToken;

  const response = await requestAudienceBackend(config, "/v1/customer-intelligence/audiences/export", headers, {
    definition: input.definition,
    format: input.format,
    fields: input.fields
  });

  if (!response.ok) {
    throw new AudienceUpstreamError("audience_export_failed", await safeErrorMessage(response), response.status);
  }

  return {
    status: response.status,
    body: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    contentDisposition: response.headers.get("content-disposition"),
    contentLength: response.headers.get("content-length"),
    matchedCount: response.headers.get("x-audience-export-matched-count"),
    unknownCount: response.headers.get("x-audience-export-unknown-count")
  };
}

async function requestAudienceBackend(config: AudienceClientConfig, path: string, extraHeaders: Record<string, string>, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store"
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    throw new AudienceUpstreamError(
      "audience_backend_unavailable",
      isTimeout ? "Customer Profile audience backend timed out." : "Customer Profile audience backend is unavailable.",
      isTimeout ? 504 : 503
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return response.ok
      ? { status: "invalid_response", message: "Backend returned a non-JSON response." }
      : { code: "audience_bad_response", message: "Backend returned a non-JSON response." };
  }
}

async function safeErrorMessage(response: Response): Promise<string> {
  const body = await readJson(response);
  if (typeof body === "object" && body !== null && "message" in body && typeof (body as { message?: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  return "Audience export failed.";
}
