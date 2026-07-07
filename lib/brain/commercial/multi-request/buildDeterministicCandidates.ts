import type { ConversationRequest } from "../conversation-request";
import type { ConversationRequestDomain, ConversationRequestStatus } from "../conversation-request";

export type RequestCandidate = {
  requestId: string;
  intentType: string;
  intentDomain: ConversationRequestDomain;
  status: ConversationRequestStatus;
  updatedAt: string;
};

/**
 * Deterministic view of the active requests, most recently touched first.
 * This is both planner input (so the LLM sees what already exists) and the
 * linker's source of truth (so linking never depends on model output alone).
 */
export function buildDeterministicCandidates(activeRequests: readonly ConversationRequest[]): RequestCandidate[] {
  return [...activeRequests]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .map((request) => ({
      requestId: request.requestId,
      intentType: request.intentType,
      intentDomain: request.intentDomain,
      status: request.status,
      updatedAt: request.updatedAt
    }));
}
