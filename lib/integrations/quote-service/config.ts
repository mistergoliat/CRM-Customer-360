// External Quote Service (SALES-AGENT-R1-T1) - genuinely separate system,
// own env namespace, Bearer token auth (real contract: README
// "Authentication" - every /v1/quotes... endpoint requires
// `Authorization: Bearer <SERVICE_AUTH_TOKEN>`). Same absent-config-means-
// unconfigured convention as CATALOG_SERVICE_BASE_URL/CARRIER_SERVICE_BASE_URL
// (lib/catalog/httpCatalogAdapter.ts, lib/integrations/carrier-service/config.ts) -
// no separate "_ENABLED" flag: config presence is the enablement signal.

export type QuoteServiceConfig = {
  baseUrl: string;
  authToken: string;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 5000;

export function readQuoteServiceConfig(env: Record<string, string | undefined> = process.env): QuoteServiceConfig | null {
  const baseUrl = env.QUOTE_SERVICE_BASE_URL?.trim();
  const authToken = env.QUOTE_SERVICE_AUTH_TOKEN?.trim();
  if (!baseUrl || !authToken) return null;
  const timeoutMs = Number.parseInt(env.QUOTE_SERVICE_TIMEOUT_MS?.trim() ?? "", 10);
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    authToken,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}
