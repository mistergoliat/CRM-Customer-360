export const REQUEST_FACT_STATUSES = ["inferred", "confirmed", "verified", "rejected", "superseded"] as const;
export type RequestFactStatus = (typeof REQUEST_FACT_STATUSES)[number];

export function isRequestFactsEnabled(): boolean {
  return process.env.BRAIN_REQUEST_FACTS_ENABLED?.trim().toLowerCase() === "true";
}
