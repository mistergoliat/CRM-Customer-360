import { randomUUID } from "node:crypto";
import { executeGovernedCapability } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import { createQuoteCapability } from "@/lib/brain/commercial/capability-gateway/createQuoteCapability";
import type { QuoteServicePort, QuoteServiceQuote } from "@/lib/domains/quote-service";
import type { CapabilityCallLogEntry, CommercialWorkFaultPlan, R2FaultInjectableCapability } from "./types";

/**
 * SALES-AGENT-R2-A07.5. The one small benchmark-only adapter this harness
 * needs at the Capability Gateway boundary: create_quote's real
 * assembleQuoteInput() resolves pricing via the real Catalog port (already
 * faked by setupBenchmarkEnvironment) but resolves the customer snapshot via
 * the real external Quote Service HTTP port, which nothing in this repo's
 * test suite fakes over HTTP - every existing test
 * (tests/commercial/createQuoteCapability.test.ts) instead constructs
 * createQuoteCapability() directly with an injected QuoteServicePort, the
 * exact same pattern reused here. Every other capability
 * (select_products/set_shipping_destination/calculate_shipping/...) goes
 * through the real, unmodified registry via executeGovernedCapability.
 */

function fakeQuoteServicePort(): QuoteServicePort {
  return {
    async createQuote(input) {
      const now = new Date().toISOString();
      const quote: QuoteServiceQuote = {
        quoteId: randomUUID(),
        quoteNumber: `R2-BENCH-${Date.now()}`,
        opportunityId: input.opportunityId,
        customerId: input.customerId ?? null,
        conversationId: input.conversationId ?? null,
        actor: input.actor,
        source: { system: input.source.system, correlationId: input.source.correlationId ?? null },
        status: "draft",
        currency: input.currency,
        customerSnapshot: { name: input.customerSnapshot.name, businessName: null, email: input.customerSnapshot.email ?? null, phone: input.customerSnapshot.phone ?? null, address: null, district: null, region: null },
        items: input.items.map((item, index) => ({
          lineId: `line-${index + 1}`,
          type: item.type,
          externalSource: item.externalSource ?? null,
          externalItemId: item.externalItemId ?? null,
          externalVariantId: item.externalVariantId ?? null,
          sku: item.sku ?? null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxIncluded: item.taxIncluded,
          taxRate: item.taxRate,
          lineSubtotal: item.unitPrice,
          lineTax: "0",
          lineTotal: item.unitPrice
        })),
        pricing: { subtotal: "0", taxAmount: "0", total: "0" },
        validUntil: input.validUntil,
        version: 1,
        revision: { rootId: randomUUID(), previousRevisionId: null, supersedesQuoteId: null, supersededByQuoteId: null },
        issuedDocument: { available: false, contentHash: null, renderVersion: null, generatedAt: null, pdf: { documentRef: null, sha256: null }, html: { documentRef: null, sha256: null } },
        timestamps: { createdAt: now, updatedAt: now, issuedAt: null, acceptedAt: null, paidAt: null, cancelledAt: null, expiredAt: null }
      };
      return { ok: true, value: quote };
    },
    async updateDraft() {
      throw new Error("R2 benchmark fixture: updateDraft not used");
    },
    async issueQuote() {
      throw new Error("R2 benchmark fixture: issueQuote not used");
    },
    async sendQuoteEmail() {
      throw new Error("R2 benchmark fixture: sendQuoteEmail not used");
    },
    async getQuote() {
      throw new Error("R2 benchmark fixture: getQuote not used");
    },
    async getQuoteByNumber() {
      throw new Error("R2 benchmark fixture: getQuoteByNumber not used");
    },
    async getQuoteDelivery() {
      throw new Error("R2 benchmark fixture: getQuoteDelivery not used");
    },
    async listQuoteDeliveries() {
      throw new Error("R2 benchmark fixture: listQuoteDeliveries not used");
    }
  };
}

const benchmarkCreateQuoteDefinition = createQuoteCapability(fakeQuoteServicePort);

async function executeCreateQuoteViaBenchmarkGateway(input: Record<string, unknown>, context: CapabilityGatewayContext): Promise<CapabilityGatewayResult> {
  const startedAt = new Date().toISOString();
  const availability = await benchmarkCreateQuoteDefinition.checkAvailability(context);
  if (availability.status !== "available") {
    const completedAt = new Date().toISOString();
    return {
      capability: "create_quote",
      version: benchmarkCreateQuoteDefinition.version,
      availability: availability.status,
      status: availability.status === "unavailable" ? "temporarily_blocked" : availability.status,
      data: null,
      errorCode: availability.reason,
      retryable: availability.status === "unavailable" || availability.status === "temporarily_blocked",
      evidence: [],
      warnings: [],
      retryCount: 0,
      startedAt,
      completedAt,
      executionPublicId: null
    };
  }
  const outcome = await benchmarkCreateQuoteDefinition.execute(input as Record<string, never>, context);
  const completedAt = new Date().toISOString();
  return {
    capability: "create_quote",
    version: benchmarkCreateQuoteDefinition.version,
    availability: availability.status,
    status: outcome.status,
    data: outcome.data,
    errorCode: outcome.errorCode,
    retryable: outcome.retryable,
    evidence: outcome.evidence,
    warnings: outcome.warnings ?? [],
    retryCount: 0,
    startedAt,
    completedAt,
    // A real executionPublicId, not null - evidenceForCapability() (the
    // executor's own capability-execution evidence builder) only attaches
    // evidence when this is truthy, and a COMPLETED step with zero evidence
    // is exactly what unbackedCommercialMutationClaimRate flags. The real
    // executeGovernedCapability always returns a real persisted row's
    // publicId here (crm_capability_executions); this benchmark bypass
    // deliberately never writes that audit table (see the module docstring),
    // so a fresh id is the honest equivalent, not a real audit row id.
    executionPublicId: randomUUID()
  };
}

export class CommercialWorkBenchmarkSimulatedCrashError extends Error {
  constructor(capabilityName: string) {
    super(`R2 benchmark: simulated process crash immediately after ${capabilityName}'s real side effect completed`);
    this.name = "CommercialWorkBenchmarkSimulatedCrashError";
  }
}

function syntheticTemporarilyBlockedResult(capabilityName: string): CapabilityGatewayResult {
  const now = new Date().toISOString();
  return {
    capability: capabilityName,
    version: "r2-benchmark-fault-injection",
    availability: "temporarily_blocked",
    status: "temporarily_blocked",
    data: null,
    errorCode: "benchmark_injected_temporary_failure",
    retryable: true,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: now,
    completedAt: now,
    executionPublicId: null
  };
}

export type BuildR2CapabilityGatewayOptions = {
  /** R2-05/R2-06 only - see faultPlan handling in scoring.ts's expectations for these scenarios. */
  faultPlan?: CommercialWorkFaultPlan;
};

/**
 * The single executeCapability the R2 harness passes to executeCommercialWork/
 * runCommercialWorkTick: always logs every call (Part 12 observability, never
 * reasoning_content/PII), always routes create_quote through the injected
 * benchmark Quote Service port, and optionally injects deterministic faults
 * for calculate_shipping (temporarily_blockOnce) / create_quote
 * (crashAfterSideEffect) - never LLM-decided.
 */
export function buildR2ExecuteCapability(options: BuildR2CapabilityGatewayOptions = {}): { executeCapability: typeof executeGovernedCapability; callLog: CapabilityCallLogEntry[] } {
  const callLog: CapabilityCallLogEntry[] = [];
  const blockOnce = new Set(options.faultPlan?.temporarilyBlockOnce ?? []);
  const crashAfter = new Set(options.faultPlan?.crashAfterSideEffect ?? []);

  const executeCapability = async (capabilityName: string, input: Record<string, unknown>, context: CapabilityGatewayContext): Promise<CapabilityGatewayResult> => {
    const injectable = capabilityName as R2FaultInjectableCapability;

    if (blockOnce.has(injectable)) {
      blockOnce.delete(injectable);
      const result = syntheticTemporarilyBlockedResult(capabilityName);
      callLog.push({ capabilityName, status: result.status, stepId: context.actionId ?? null, objectiveIds: [], injectedFault: "temporarily_blocked", atIso: result.completedAt });
      return result;
    }

    const result = capabilityName === "create_quote" ? await executeCreateQuoteViaBenchmarkGateway(input, context) : await executeGovernedCapability(capabilityName, input, context);

    callLog.push({ capabilityName, status: result.status, stepId: context.actionId ?? null, objectiveIds: [], injectedFault: null, atIso: result.completedAt });

    if (crashAfter.has(injectable) && result.status === "completed") {
      crashAfter.delete(injectable);
      throw new CommercialWorkBenchmarkSimulatedCrashError(capabilityName);
    }

    return result;
  };

  return { executeCapability, callLog };
}
