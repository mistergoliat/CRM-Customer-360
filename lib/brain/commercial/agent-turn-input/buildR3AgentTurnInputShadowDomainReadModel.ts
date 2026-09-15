import { createCatalogPort, type CatalogPort } from "@/lib/catalog";
import { queryRows } from "@/lib/db";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import { getActiveSelectedShippingOptionForOpportunity } from "@/lib/domains/selected-shipping-option";
import { createQuoteServicePort } from "@/lib/integrations/quote-service";
import { buildCommercialDomainReadModel, type CommercialDomainReadModel } from "../domain-read-model";
import { loadRecentCommercialCapabilityExecutions } from "../work/capabilityExecutionReader";
import { findActiveCommercialWorks } from "../work/repository";
import type { CommercialWorkDatabaseAdapter } from "../work/persistenceTypes";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import type { CommercialContextSnapshot } from "../context/buildNativeCommercialContext";
import type { AgentTurnInputShadowReadMetrics } from "./shadow";

type BuildR3AgentTurnInputShadowDomainReadModelInput = {
  conversationId: number;
  opportunityId: number | null;
  correlationId: string;
  snapshot: CommercialContextSnapshot;
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  metrics: AgentTurnInputShadowReadMetrics;
};

function countedQueryRows(metrics: AgentTurnInputShadowReadMetrics) {
  return async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    metrics.dbReads += 1;
    return queryRows<T>(sql, params);
  };
}

async function readExistingWork(input: BuildR3AgentTurnInputShadowDomainReadModelInput): Promise<Awaited<ReturnType<typeof findActiveCommercialWorks>>[number] | null> {
  const adapter: CommercialWorkDatabaseAdapter = { queryRows: countedQueryRows(input.metrics) };
  const works = await findActiveCommercialWorks(
    { opportunityId: input.opportunityId, conversationId: input.conversationId, limit: 20 },
    adapter
  );
  return [...works].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.publicId.localeCompare(left.publicId))[0] ?? null;
}

function countDbRead<T>(metrics: AgentTurnInputShadowReadMetrics, reader: () => Promise<T>): Promise<T> {
  metrics.dbReads += 1;
  return reader();
}

function wrapHttpMethod<T extends object>(target: T, methodName: string, metrics: AgentTurnInputShadowReadMetrics): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (property !== methodName || typeof value !== "function") return value;
      return (...args: unknown[]) => {
        metrics.httpReads += 1;
        return value.apply(object, args);
      };
    }
  });
}

function projectCustomerProfile(snapshot: CommercialContextSnapshot) {
  if (snapshot.customer360State === "unavailable" || snapshot.customer360State === "partial") {
    return { status: "UNAVAILABLE" as const, retrievedAt: null, relationshipSummary: null };
  }
  if (!snapshot.customer360) return null;
  return {
    status: "AVAILABLE" as const,
    retrievedAt: null,
    relationshipSummary: {
      conversationCount: snapshot.customer360.relationshipSummary.conversationCount,
      opportunityCount: snapshot.customer360.relationshipSummary.opportunityCount,
      quoteCount: snapshot.customer360.relationshipSummary.quoteCount,
      orderCount: snapshot.customer360.relationshipSummary.orderCount,
      lastActivityAt: snapshot.customer360.relationshipSummary.lastActivityAt
    }
  };
}

/**
 * Runtime dependency wiring for P0. This module owns no projection logic: it
 * only reuses the already-loaded R3 snapshot where possible, delegates the
 * remaining authoritative reads to their existing services, and counts the
 * extra work introduced by shadow mode.
 */
export async function buildR3AgentTurnInputShadowDomainReadModel(
  input: BuildR3AgentTurnInputShadowDomainReadModelInput
): Promise<CommercialDomainReadModel> {
  const catalogPort = createCatalogPort();
  const quoteServicePort = createQuoteServicePort();
  const meteredCatalogPort = catalogPort ? wrapHttpMethod<CatalogPort>(catalogPort, "getProductDetails", input.metrics) : null;
  const meteredQuoteServicePort = quoteServicePort
    ? wrapHttpMethod(quoteServicePort, "getQuote", input.metrics)
    : null;

  return buildCommercialDomainReadModel({
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    correlationId: input.correlationId,
    trustedCustomerSession: input.trustedCustomerSession,
    dependencies: {
      // CommercialWork is deliberately read-only here. A missing row remains
      // an explicit P0 NOT_CREATED/NO_ACTIVE_WORK projection.
      readCommercialWork: () => readExistingWork(input),
      // These two facts already belong to the settled R3 snapshot; no second
      // DB read is introduced for them.
      readCart: async () => input.snapshot.commercialLineItems,
      readDestination: async () => input.snapshot.shippingDestination,
      readSelectedShipping: (opportunityId) => countDbRead(input.metrics, () => getActiveSelectedShippingOptionForOpportunity(opportunityId)),
      readCreatedQuote: (opportunityId) => countDbRead(input.metrics, () => getActiveCreatedQuoteForOpportunity(opportunityId)),
      readShippingCalculations: (opportunityId) => countDbRead(input.metrics, () => loadRecentCommercialCapabilityExecutions({ opportunityId, capabilityNames: ["calculate_shipping"], limit: 20 })),
      catalogPort: meteredCatalogPort,
      quoteServicePort: meteredQuoteServicePort,
      // Customer 360/profile was loaded upstream in the native cycle. Do not
      // call a second profile service for shadow mode.
      customerProfile: projectCustomerProfile(input.snapshot)
    }
  });
}
