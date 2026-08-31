// SALES-AGENT-R2-A13-H0 bake-off. Shared, runtime-agnostic READ-ONLY tool
// bodies, reused unchanged by BOTH the R2 runner and the Harness runner so
// the comparison's independent variable is orchestration architecture, not
// tool implementation. Every function here calls the SAME production domain
// boundary R2 itself uses (lib/catalog, lib/integrations/carrier-service,
// lib/brain/commercial/commercial-customer-context) - no raw DB access, no
// second implementation of catalog/shipping/customer-profile logic.
//
// Plain relative imports (not the repo's `@/` tsconfig alias): this module
// is loaded both directly by tsx (which resolves `@/`) and indirectly
// through the Harness's own dynamic plugin loader (@deepseek-ai/cordis-
// plugin-loader), which does not honor tsx's alias-resolution hook for
// nested imports - relative paths work identically under both.
import { createCatalogPort } from "../../../lib/catalog";
import { createCarrierService } from "../../../lib/integrations/carrier-service";
import { loadCommercialCustomerContext } from "../../../lib/brain/commercial/commercial-customer-context/loadCommercialCustomerContext";
import type { RuntimeIdentityContext } from "../../../lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";

let catalogUnavailableOverride = false;
let customerProfileUnavailableOverride = false;

/** Bake-off-only fault injection switches (scenario metadata `injectFault`), never a production concern. */
export function setBakeoffFaultInjection(faults: { catalogUnavailable?: boolean; customerProfileUnavailable?: boolean }): void {
  catalogUnavailableOverride = faults.catalogUnavailable ?? false;
  customerProfileUnavailableOverride = faults.customerProfileUnavailable ?? false;
}

export type ToolOutcome<T> = { ok: true; data: T } | { ok: false; reason: string };

export async function searchProducts(query: string): Promise<ToolOutcome<unknown>> {
  if (catalogUnavailableOverride) return { ok: false, reason: "catalog_service_unavailable" };
  const port = createCatalogPort();
  if (!port) return { ok: false, reason: "catalog_service_not_configured" };
  const result = await port.resolveProductIntent({ query }, { correlationId: `bakeoff-${Date.now()}` });
  if (!result.ok) return { ok: false, reason: result.error.code };
  return { ok: true, data: result.value };
}

/**
 * Fixture-backed identity resolution ONLY (per scenario's `seedIdentityLevel`
 * -- mirrors the exact `buildRuntimeIdentity`/`runtimeIdentityAtLevel`
 * pattern the existing A13 test fixtures already use). This bake-off never
 * calls the real Customer Service (its base URL is empty in this
 * environment anyway, a documented PAUSED_EXTERNAL blocker) and never
 * invents a customer_master identity, per AGENTS.md.
 */
export function buildBakeoffRuntimeIdentity(level: "LEVEL_0_ANONYMOUS" | "LEVEL_3_PRESTASHOP_LINKED"): RuntimeIdentityContext {
  if (level === "LEVEL_3_PRESTASHOP_LINKED") {
    return {
      status: "PRESTASHOP_LINKED",
      identityLevel: "LEVEL_3_PRESTASHOP_LINKED",
      masterCustomerId: "bakeoff-fixture-master-1",
      prestashopCustomerId: "4242",
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: "BAKEOFF_FIXTURE_LEVEL_3",
      evidenceRefs: []
    };
  }
  return {
    status: "ANONYMOUS",
    identityLevel: "LEVEL_0_ANONYMOUS",
    masterCustomerId: null,
    prestashopCustomerId: null,
    verificationRequired: false,
    requiredEvidence: [],
    readyToLink: false,
    conflictCode: null,
    policyCode: "NO_CHANNEL_EVIDENCE",
    evidenceRefs: []
  };
}

export async function getCustomerContext(runtimeIdentity: RuntimeIdentityContext): Promise<ToolOutcome<unknown>> {
  if (customerProfileUnavailableOverride) return { ok: false, reason: "customer_profile_unavailable" };
  const result = await loadCommercialCustomerContext({ runtimeIdentity, historyNeeds: ["GENERAL_PROFILE"] });
  if (result.status === "AVAILABLE") return { ok: true, data: { status: result.status, prestashopCustomerId: result.prestashopCustomerId } };
  return { ok: false, reason: result.status.toLowerCase() };
}

export async function getPurchaseHistory(runtimeIdentity: RuntimeIdentityContext): Promise<ToolOutcome<unknown>> {
  if (customerProfileUnavailableOverride) return { ok: false, reason: "customer_profile_unavailable" };
  const result = await loadCommercialCustomerContext({ runtimeIdentity, historyNeeds: ["RECENT_ORDERS_CONTEXT"] });
  if (result.status === "AVAILABLE" || result.status === "PARTIAL") return { ok: true, data: result.commercialHistory };
  return { ok: false, reason: result.status.toLowerCase() };
}

export async function getShippingOptions(destination: string, totalWeightKg: number, totalBoleta: number): Promise<ToolOutcome<unknown>> {
  const service = createCarrierService();
  if (!service) return { ok: false, reason: "carrier_service_not_configured" };
  const result = await service.quoteAll({ destination, totalWeightKg, totalBoleta });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, data: result.options };
}
