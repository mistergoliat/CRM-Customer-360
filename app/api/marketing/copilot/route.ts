import { errorResponse } from "@/lib/api-response";

const MAX_QUESTION_LENGTH = 4000;

type Config = {
  enabled: boolean;
  baseUrl: string;
  token: string;
  timeoutMs: number;
};

export async function POST(request: Request) {
  const config = readConfig();
  if (!config.enabled) {
    return errorResponse("marketing_copilot_disabled", "Marketing Copilot is disabled.", 404);
  }
  if (!config.baseUrl || !config.token) {
    return errorResponse("marketing_copilot_not_configured", "Marketing Copilot backend is not configured.", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be JSON.", 400);
  }

  if (!isRecord(body)) {
    return errorResponse("invalid_request", "Request body must be an object.", 400);
  }
  const allowed = new Set(["question", "featureSnapshotId"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return errorResponse("unsupported_field", "Unsupported request field.", 400);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return errorResponse("invalid_question", "Question is required and must be at most 4000 characters.", 400);
  }
  const featureSnapshotId = body.featureSnapshotId === undefined ? undefined : String(body.featureSnapshotId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const upstream = await fetch(`${config.baseUrl}/v1/customer-intelligence/copilot`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-copilot-token": config.token
      },
      body: JSON.stringify({ question, ...(featureSnapshotId ? { featureSnapshotId } : {}) }),
      signal: controller.signal,
      cache: "no-store"
    });
    const responseBody = await readJson(upstream);
    return Response.json(responseBody, { status: upstream.status });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return errorResponse(
      "marketing_copilot_unavailable",
      isTimeout ? "Marketing Copilot backend timed out." : "Marketing Copilot backend is unavailable.",
      isTimeout ? 504 : 503
    );
  } finally {
    clearTimeout(timeout);
  }
}

function readConfig(): Config {
  const enabled = process.env.MARKETING_COPILOT_ENABLED?.trim().toLowerCase() === "true";
  const baseUrl = process.env.MARKETING_COPILOT_BACKEND_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const token = process.env.MARKETING_COPILOT_INTERNAL_TOKEN?.trim() ?? "";
  const timeoutMs = Number.parseInt(process.env.MARKETING_COPILOT_TIMEOUT_MS?.trim() ?? "", 10);
  return {
    enabled,
    baseUrl,
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { status: response.ok ? "answered" : "analytics_unavailable", message: "Backend returned non-JSON response." };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
