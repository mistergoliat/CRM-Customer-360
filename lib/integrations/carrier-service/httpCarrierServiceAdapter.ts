/**
 * HTTP adapter for the real Carrier MS (CRM-R1-T13E.2). Contract captured
 * live against http://ms.pesaschile.cl (not designed from hypothesis - see
 * docs/releases/CRM-R1-T13E-shipping-calculation.md for the raw captures):
 *
 *   GET /api/pc-carrier/carrier/v1/all?destino=...&alto=1&ancho=1&largo=1&kilos=...&total_boleta=...
 *
 * Success (observed HTTP 202, not 200 - any 2xx is treated as success):
 *   {"options":[{"carrier_name":"Blue Express","service_type":"EXPRESS","total_cost":20994,"estimated_delivery":"17-08-2026"}]}
 * No carrier serves the destination (still a 2xx, not an error):
 *   {"options":[]}
 * Client error (observed 400 for a missing/empty destino):
 *   {"error":"destination is required"}
 *
 * No authentication required (confirmed live: unauthenticated requests
 * returned real quotes) - never inventing a credential the real service
 * doesn't ask for.
 */
import type { CarrierOption, CarrierQuoteInput, CarrierQuoteResult } from "@/lib/domains/carrier-service";
import type { CarrierServiceConfig } from "./config";

/** Contractually fixed by Carrier MS - CRM never derives these from product dimensions (T13E.2 section 1/11). */
export const CARRIER_DEFAULT_HEIGHT = 1;
export const CARRIER_DEFAULT_WIDTH = 1;
export const CARRIER_DEFAULT_LENGTH = 1;

const CARRIER_QUOTE_PATH = "/api/pc-carrier/carrier/v1/all";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOption(value: unknown): CarrierOption | null {
  if (!isRecord(value)) return null;
  const carrierName = value.carrier_name;
  const serviceType = value.service_type;
  const totalCost = value.total_cost;
  const estimatedDelivery = value.estimated_delivery;
  if (typeof carrierName !== "string" || typeof serviceType !== "string") return null;
  if (typeof totalCost !== "number" || !Number.isFinite(totalCost)) return null;
  if (typeof estimatedDelivery !== "string") return null;
  return { carrierName, serviceType, totalCost, estimatedDelivery };
}

/** Malformed items fail the whole response closed (K: "malformed response -> fail closed") rather than silently dropping the bad entry and presenting a partial, unverified list. */
function parseOptions(value: unknown): CarrierOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: CarrierOption[] = [];
  for (const entry of value) {
    const option = parseOption(entry);
    if (!option) return null;
    options.push(option);
  }
  return options;
}

export function buildCarrierQuoteQuery(input: CarrierQuoteInput): URLSearchParams {
  return new URLSearchParams({
    destino: input.destination,
    alto: String(CARRIER_DEFAULT_HEIGHT),
    ancho: String(CARRIER_DEFAULT_WIDTH),
    largo: String(CARRIER_DEFAULT_LENGTH),
    kilos: String(input.totalWeightKg),
    total_boleta: String(input.totalBoleta)
  });
}

export function createHttpCarrierServiceAdapter(config: CarrierServiceConfig) {
  return {
    async quoteAll(input: CarrierQuoteInput): Promise<CarrierQuoteResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      let response: Response;
      try {
        const query = buildCarrierQuoteQuery(input);
        response = await fetch(`${config.baseUrl}${CARRIER_QUOTE_PATH}?${query.toString()}`, {
          method: "GET",
          signal: controller.signal
        });
      } catch (error) {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          return { ok: false, reason: "carrier_service_timeout", detail: "Carrier MS request timed out." };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: "carrier_service_unavailable", detail: message };
      }
      clearTimeout(timer);

      let body: unknown = null;
      const text = await response.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return { ok: false, reason: "carrier_invalid_response", detail: "Carrier MS returned a non-JSON body." };
        }
      }

      if (response.status < 200 || response.status >= 300) {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
        return response.status >= 500
          ? { ok: false, reason: "carrier_service_unavailable", detail: message }
          : { ok: false, reason: "carrier_invalid_response", detail: message };
      }

      if (!isRecord(body)) {
        return { ok: false, reason: "carrier_invalid_response", detail: "Carrier MS response was not a JSON object." };
      }
      const options = parseOptions(body.options);
      if (options === null) {
        return { ok: false, reason: "carrier_invalid_response", detail: "Carrier MS response had a malformed options array." };
      }

      return { ok: true, options };
    }
  };
}
