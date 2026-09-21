import { queryRows } from "@/lib/db";
import { resolveLiveBenchmarkProviderConfig } from "../liveProvider";
import type { BenchmarkE2EDependencyCheck, BenchmarkE2EEnvironmentHealth, BenchmarkE2EEnvironmentStatus } from "./types";

/**
 * SALES-AGENT-R3-P7.4 (Section "ENVIRONMENT HEALTH PRECHECK"). This harness
 * fakes Catalog/Carrier/commune locally regardless of real config
 * (setupR3BenchmarkEnvironment) and injects trustedCustomerSession directly
 * rather than ever calling the real Customer Service (it enters at
 * runSalesAgentRuntimeCycle, never runNativeAutonomousCycle's
 * resolveNativeCustomerSession) - both are structurally unreachable, marked
 * NOT_REQUIRED rather than a misleading READY. Only MariaDB (always), Quote
 * Service (only when the corpus batch includes a quote-creating case) and
 * the provider endpoint (only in live mode) are real, checkable
 * dependencies.
 */
export function aggregateEnvironmentHealth(dependencies: readonly BenchmarkE2EDependencyCheck[], checkedAt: string): BenchmarkE2EEnvironmentHealth {
  const required = dependencies.filter((dependency) => dependency.status !== "NOT_REQUIRED");
  let status: BenchmarkE2EEnvironmentStatus = "READY";
  if (required.some((dependency) => dependency.status === "BLOCKED")) status = "BLOCKED";
  else if (required.some((dependency) => dependency.status === "DEGRADED")) status = "DEGRADED";
  return { status, checkedAt, dependencies };
}

async function checkMariaDb(): Promise<BenchmarkE2EDependencyCheck> {
  try {
    await queryRows("SELECT 1 AS ok");
    return { name: "mariadb", status: "READY", detail: "SELECT 1 succeeded" };
  } catch (error) {
    return { name: "mariadb", status: "BLOCKED", detail: error instanceof Error ? error.message : "unknown connection failure" };
  }
}

function checkQuoteServiceConfigured(): BenchmarkE2EDependencyCheck {
  const baseUrl = process.env.QUOTE_SERVICE_BASE_URL?.trim();
  // Same variable the real client reads (lib/integrations/quote-service/config.ts); QUOTE_SERVICE_API_KEY is not one of them.
  const apiKey = process.env.QUOTE_SERVICE_AUTH_TOKEN?.trim();
  if (baseUrl && apiKey) return { name: "quoteService", status: "READY", detail: "QUOTE_SERVICE_BASE_URL/AUTH_TOKEN configured" };
  return { name: "quoteService", status: "BLOCKED", detail: "QUOTE_SERVICE_BASE_URL/QUOTE_SERVICE_AUTH_TOKEN not configured - create_quote/get_quote cases cannot execute" };
}

function checkProviderEndpoint(mode: "offline" | "live"): BenchmarkE2EDependencyCheck {
  if (mode === "offline") return { name: "providerEndpoint", status: "NOT_REQUIRED", detail: "offline mode uses the deterministic scripted provider" };
  const resolution = resolveLiveBenchmarkProviderConfig();
  if (resolution.ok) return { name: "providerEndpoint", status: "READY", detail: `live provider configured (model=${resolution.config.model})` };
  return { name: "providerEndpoint", status: "BLOCKED", detail: `live mode requested but unconfigured: ${resolution.reason}` };
}

export async function checkEnvironmentHealth(input: { mode: "offline" | "live"; corpusRequiresQuote: boolean }): Promise<BenchmarkE2EEnvironmentHealth> {
  const checkedAt = new Date().toISOString();
  const dependencies: BenchmarkE2EDependencyCheck[] = [
    await checkMariaDb(),
    { name: "catalogService", status: "NOT_REQUIRED", detail: "fully stubbed locally by setupR3BenchmarkEnvironment (HTTP fake), never the real Catalog Service" },
    input.corpusRequiresQuote
      ? checkQuoteServiceConfigured()
      : { name: "quoteService", status: "NOT_REQUIRED", detail: "no case in this batch requires create_quote/get_quote" },
    { name: "customerService", status: "NOT_REQUIRED", detail: "trustedCustomerSession is injected directly - this harness never calls resolveNativeCustomerSession" },
    { name: "carrierService", status: "NOT_REQUIRED", detail: "fully stubbed locally by setupR3BenchmarkEnvironment (in-process fake), never the real Carrier MS" },
    checkProviderEndpoint(input.mode)
  ];
  return aggregateEnvironmentHealth(dependencies, checkedAt);
}
