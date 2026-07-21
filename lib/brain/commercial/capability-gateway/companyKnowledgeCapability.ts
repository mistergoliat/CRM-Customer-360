import type { CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";
import { COMPANY_KNOWLEDGE_FIXTURES, type CompanyKnowledgeEntry } from "./companyKnowledgeFixtures";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;
const MAX_RESULTS = 3;

export type CompanyKnowledgeMatch = {
  topic: string;
  answer: string;
  source: string;
};

export type CompanyKnowledgeSearchResult = {
  query: string;
  entries: CompanyKnowledgeMatch[];
};

const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICAL_MARKS, "");
}

/**
 * Simple lexical search MVP (ACS-R1-05.1-T02.1, spec section 6): no
 * embeddings, no vector database, no RAG. Scores each fixture entry by how
 * many of its keywords appear in the normalized query text; ties broken by
 * fixture order. Deliberately not a general-purpose search algorithm - swap
 * for a real search backend only when the business supplies real content and
 * this heuristic measurably falls short.
 */
function scoreEntry(entry: CompanyKnowledgeEntry, normalizedQuery: string): number {
  return entry.keywords.reduce((score, keyword) => (normalizedQuery.includes(normalizeText(keyword)) ? score + 1 : score), 0);
}

export function searchCompanyKnowledgeFixtures(query: string): CompanyKnowledgeSearchResult {
  const normalizedQuery = normalizeText(query);
  const matches = COMPANY_KNOWLEDGE_FIXTURES.map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((candidate) => ({ topic: candidate.entry.topic, answer: candidate.entry.answer, source: candidate.entry.source }));

  return { query, entries: matches };
}

function asQueryText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/**
 * ACS-R1-05.1-T02.1. Registered like every other Capability Gateway
 * definition - no second registry, no keyword routing outside this
 * capability's own execute() (the model decides to call this tool; this
 * function only decides which fixture entries answer the query it receives).
 * Always available (no external service), read_only/autonomous/low, same
 * governance shape as search_products/get_product_details.
 */
export function companyKnowledgeCapability(): CapabilityGatewayDefinition<{ query: string }, CompanyKnowledgeSearchResult> {
  return {
    capability: "search_company_knowledge",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Search company-provided informational knowledge (hours, channels, coverage, payment methods, policies, dispatch, human contact) via a simple lexical fixture search.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 0,
    async checkAvailability(_context: CapabilityGatewayContext) {
      return { status: "available", reason: null };
    },
    async execute(input) {
      const query = asQueryText(input.query);
      if (!query) {
        return { status: "invalid_arguments", data: null, errorCode: "query_required", retryable: false, evidence: [] };
      }

      const result = searchCompanyKnowledgeFixtures(query);
      return {
        status: "completed",
        data: result,
        errorCode: null,
        retryable: false,
        evidence: result.entries.map((entry) => ({
          source: entry.source,
          summary: `search_company_knowledge matched fixture topic "${entry.topic}" (non-productive, unverified).`,
          capturedAt: new Date().toISOString()
        }))
      };
    }
  };
}
