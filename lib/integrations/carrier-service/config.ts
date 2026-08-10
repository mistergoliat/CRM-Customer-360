// Carrier MS (CRM-R1-T13E.2) - genuinely separate system, own env namespace,
// no auth today (confirmed by live probe: real requests without any
// Authorization/x-api-key header returned real quotes) - never inventing a
// credential the real service doesn't require.

export type CarrierServiceConfig = { baseUrl: string; timeoutMs: number };

const DEFAULT_TIMEOUT_MS = 5000;

export function readCarrierServiceConfig(env: Record<string, string | undefined> = process.env): CarrierServiceConfig | null {
  const baseUrl = env.CARRIER_SERVICE_BASE_URL?.trim();
  if (!baseUrl) return null;
  const timeoutMs = Number.parseInt(env.CARRIER_SERVICE_TIMEOUT_MS?.trim() ?? "", 10);
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}
