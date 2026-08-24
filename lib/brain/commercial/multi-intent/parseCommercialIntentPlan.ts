import { MAX_INTENTS_PER_PLAN, MAX_INTENT_TEXT_FIELD_LENGTH, MAX_QUANTITY, CANCEL_SCOPES } from "./types";
import type { CommercialIntent, CommercialIntentCancelScope } from "./types";

function asCancelScope(value: unknown): CommercialIntentCancelScope | undefined {
  return typeof value === "string" && (CANCEL_SCOPES as readonly string[]).includes(value) ? (value as CommercialIntentCancelScope) : undefined;
}

const MAX_ADDITIONAL_CANCEL_SCOPES = 3;

/**
 * SALES-AGENT-R2-A08.7, Part 7. Bounded, deduped, never "all" (a specific
 * additional target and an untargeted-everything scope are contradictory -
 * "all" here is silently dropped rather than trusted, same fail-closed
 * discipline as an unrecognized scope elsewhere in this file), never repeats
 * the primary scope.
 */
function asAdditionalCancelScopes(value: unknown, primaryScope: CommercialIntentCancelScope): Exclude<CommercialIntentCancelScope, "all">[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<CommercialIntentCancelScope>([primaryScope]);
  const result: Exclude<CommercialIntentCancelScope, "all">[] = [];
  for (const entry of value) {
    const scope = asCancelScope(entry);
    if (!scope || scope === "all" || seen.has(scope)) continue;
    seen.add(scope);
    result.push(scope);
    if (result.length >= MAX_ADDITIONAL_CANCEL_SCOPES) break;
  }
  return result.length > 0 ? result : undefined;
}

/**
 * LLM-R1-T09A, Part 2/20. Hand-rolled bounded validation for the planner
 * LLM's raw JSON output - no Zod/schema-validation library exists anywhere
 * in this repository today (validateAgentStep.ts and every Capability
 * Gateway input schema follow this same narrow-parse-function convention),
 * so this follows the established local pattern rather than introducing a
 * new dependency for one contract. Every check below is still exactly what
 * a schema validator would enforce: array bounds, string length/trim,
 * integer bounds, no arbitrary/unlisted fields (only known keys are ever
 * read off the raw object).
 *
 * Part 3. An intent object with an unrecognized `type` (or malformed enough
 * that its known fields cannot be trusted) degrades to `{type:"unsupported"}`
 * instead of failing the whole plan - "una intencion no reconocida NO debe
 * transformarse en error tecnico". Only a structurally broken top-level
 * plan (not an object, no `intents` array, empty array) is a genuine parse
 * failure - see CommercialIntentPlanParseResult below.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBoundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_INTENT_TEXT_FIELD_LENGTH);
}

function asPositiveQuantity(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_QUANTITY) return undefined;
  return value;
}

/** Never trusts an unlisted field - only the exact keys each known intent type declares are ever read. */
function parseKnownIntent(raw: Record<string, unknown>): CommercialIntent | null {
  if (raw.type === "select_products") {
    const productReference = asBoundedText(raw.productReference);
    const quantity = asPositiveQuantity(raw.quantity);
    return { type: "select_products", ...(productReference !== undefined ? { productReference } : {}), ...(quantity !== undefined ? { quantity } : {}) };
  }
  if (raw.type === "get_shipping_quote") {
    const destination = asBoundedText(raw.destination);
    return { type: "get_shipping_quote", ...(destination !== undefined ? { destination } : {}) };
  }
  if (raw.type === "create_quote") {
    return { type: "create_quote" };
  }
  if (raw.type === "select_shipping_option") {
    // SALES-AGENT-R2-A11.4. The model supplies only the customer's raw
    // reference words - never an index/number, structurally cannot (this
    // type has no numeric field at all) - resolveShippingOptionRequirement/
    // buildCommercialWorkProjection.ts's applyObjectiveState resolve it
    // deterministically against real evidence, never the model.
    const optionReference = asBoundedText(raw.optionReference);
    return { type: "select_shipping_option", ...(optionReference !== undefined ? { optionReference } : {}) };
  }
  if (raw.type === "cancel") {
    // A cancel without a recognizable scope is not trusted as "all" by
    // default (Part 3: no unsafe broad cancellation) - it degrades to
    // unsupported instead, same discipline as any other malformed intent.
    const scope = asCancelScope(raw.scope);
    if (!scope) return null;
    const additionalScopes = asAdditionalCancelScopes(raw.additionalScopes, scope);
    return { type: "cancel", scope, ...(additionalScopes ? { additionalScopes } : {}) };
  }
  if (raw.type === "unsupported") {
    const description = asBoundedText(raw.description);
    return { type: "unsupported", ...(description !== undefined ? { description } : {}) };
  }
  return null;
}

/** Exported so pendingIntentState.ts can parse one durably-persisted intent back with the exact same bounded rules, never a second, drifted parser. */
export function parseCommercialIntent(raw: unknown): CommercialIntent {
  if (!isRecord(raw)) return { type: "unsupported" };
  const known = parseKnownIntent(raw);
  if (known) return known;
  // Part 3. An unrecognized type survives as "unsupported" - its own free-text
  // `type` (if any) becomes the bounded description, never executed as a tool.
  const fallbackDescription = typeof raw.type === "string" ? asBoundedText(raw.type) : asBoundedText(raw.description);
  return { type: "unsupported", ...(fallbackDescription !== undefined ? { description: fallbackDescription } : {}) };
}

export type CommercialIntentPlanParseResult =
  | { status: "valid"; intents: CommercialIntent[]; droppedDuplicateTypes: string[] }
  | { status: "invalid"; reason: string };

/**
 * Part 10 (test "duplicate intents"). At most one intent per known type
 * survives - a second select_products/get_shipping_quote in the same plan
 * cannot be represented distinctly by this task's single-productReference/
 * single-destination shape, so the FIRST occurrence of each type wins and
 * the rest are dropped with an observable, bounded reason (never silently).
 * `unsupported` intents are never deduped - each may describe a different
 * unmet request and all deserve their own clarification.
 */
function dedupeByType(intents: CommercialIntent[]): { intents: CommercialIntent[]; droppedDuplicateTypes: string[] } {
  const seenTypes = new Set<string>();
  const kept: CommercialIntent[] = [];
  const droppedDuplicateTypes: string[] = [];
  for (const intent of intents) {
    if (intent.type !== "unsupported") {
      if (seenTypes.has(intent.type)) {
        droppedDuplicateTypes.push(intent.type);
        continue;
      }
      seenTypes.add(intent.type);
    }
    kept.push(intent);
  }
  return { intents: kept, droppedDuplicateTypes };
}

export function parseCommercialIntentPlan(raw: unknown): CommercialIntentPlanParseResult {
  if (!isRecord(raw)) {
    return { status: "invalid", reason: "commercial_intent_plan_root_not_object" };
  }
  if (!Array.isArray(raw.intents) || raw.intents.length === 0) {
    return { status: "invalid", reason: "commercial_intent_plan_intents_missing_or_empty" };
  }

  const bounded = raw.intents.slice(0, MAX_INTENTS_PER_PLAN).map(parseCommercialIntent);
  const { intents, droppedDuplicateTypes } = dedupeByType(bounded);
  return { status: "valid", intents, droppedDuplicateTypes };
}
