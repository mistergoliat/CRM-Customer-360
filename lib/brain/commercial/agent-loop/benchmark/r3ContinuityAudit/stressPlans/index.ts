import type { ContinuityConversationLabel, ContinuityPlannedTurn } from "../types";
import type { Beat, BeatContext } from "./shared";
import {
  ambiguousReference,
  askShipping,
  browse,
  casual,
  changeQuantity,
  farewellPartial,
  giveDestination,
  greeting,
  memoryProbe,
  objectiveDetour,
  objectiveResumeProbe,
  oldStateResurrectionProbe,
  addSecondLine,
  replaceProduct,
  requestQuote,
  reQuestionProbe,
  returnGreeting,
  selectProduct,
  stateConflictProbe,
  toolPolicyProbe
} from "./shared";

/**
 * P7.13 (task sections 10-18). Five frozen, deterministic stress plans - one
 * per persona. Every plan is 215 turns: opening beats + fixed-index probes
 * (memory survival at +10/25/50/100/150/200, tool-policy every ~25 turns
 * offset from the memory-probe depths so they never collide) + a filler
 * rotation of casual/browse/detour beats. Built once here and frozen by
 * freeze.ts's content hash - never regenerated or adapted mid-run (section
 * 12/43).
 */

const TARGET_LENGTH = 215;
const MEMORY_PROBE_DEPTHS = [10, 25, 50, 100, 150, 200];
const TOOL_POLICY_DEPTHS = [15, 40, 65, 90, 115, 140, 165, 190];

function buildPlan(conversation: ContinuityConversationLabel, specialBeatsByIndex: Map<number, Beat>, fillerBeats: readonly Beat[]): ContinuityPlannedTurn[] {
  const turns: ContinuityPlannedTurn[] = [];
  let fillerCursor = 0;
  for (let localIndex = 0; localIndex < TARGET_LENGTH; localIndex += 1) {
    const ctx: BeatContext = { conversation, localIndex, variant: localIndex };
    const special = specialBeatsByIndex.get(localIndex);
    if (special) {
      turns.push(special(ctx));
      continue;
    }
    turns.push(fillerBeats[fillerCursor % fillerBeats.length](ctx));
    fillerCursor += 1;
  }
  return turns;
}

const FILLER_ROTATION: readonly Beat[] = [casual, casual, objectiveDetour, casual, browse, casual, objectiveDetour, casual];

// ---------------------------------------------------------------------------
// A - SIMPLE_BUYER (control, linear)
// ---------------------------------------------------------------------------

function buildSimpleBuyerPlan(): ContinuityPlannedTurn[] {
  const conversation: ContinuityConversationLabel = "A";
  const specials = new Map<number, Beat>();
  specials.set(0, greeting);
  specials.set(1, browse);
  specials.set(2, (ctx) => selectProduct(ctx, "classic", 1)); // selection origin = 2
  specials.set(3, (ctx) => giveDestination(ctx, 0)); // destination origin = 3
  specials.set(4, askShipping);
  specials.set(5, requestQuote);
  for (const depth of MEMORY_PROBE_DEPTHS) {
    const factKey = depth <= 25 ? "selection" : depth <= 75 ? "destination" : depth <= 125 ? "shipping" : depth <= 175 ? "quote" : "selection";
    const originTurn = factKey === "selection" ? 2 : factKey === "destination" ? 3 : factKey === "shipping" ? 4 : 5;
    specials.set(depth, (ctx) => memoryProbe(ctx, factKey, originTurn, depth));
  }
  for (const depth of TOOL_POLICY_DEPTHS) specials.set(depth, (ctx) => toolPolicyProbe(ctx, 2 + (depth % 3)));
  specials.set(205, farewellPartial);
  specials.set(206, (ctx) => returnGreeting(ctx, 45));
  specials.set(207, (ctx) => reQuestionProbe(ctx, "selection"));
  return buildPlan(conversation, specials, FILLER_ROTATION);
}

// ---------------------------------------------------------------------------
// B - INDECISIVE_BUYER (repeated product/quantity changes, state conflicts)
// ---------------------------------------------------------------------------

function buildIndecisiveBuyerPlan(): ContinuityPlannedTurn[] {
  const conversation: ContinuityConversationLabel = "B";
  const specials = new Map<number, Beat>();
  specials.set(0, greeting);
  specials.set(1, browse);
  specials.set(2, (ctx) => selectProduct(ctx, "classic", 2)); // T2: Classic x2
  specials.set(3, (ctx) => giveDestination(ctx, 1));
  specials.set(20, (ctx) => changeQuantity(ctx, 3));
  specials.set(35, (ctx) => replaceProduct(ctx, "pro", 1)); // T50-equivalent early: Pro x1
  specials.set(50, (ctx) => changeQuantity(ctx, 2));
  specials.set(70, stateConflictProbe); // "¿qué llevo?" - durable truth (Pro x2) must win over T2/T20 history
  specials.set(85, (ctx) => reQuestionProbe(ctx, "selection"));
  specials.set(120, (ctx) => replaceProduct(ctx, "classic", 1));
  specials.set(135, stateConflictProbe);
  specials.set(175, (ctx) => oldStateResurrectionProbe(ctx, "selection", { productId: "31", quantity: 2 }));
  for (const depth of MEMORY_PROBE_DEPTHS) {
    if (specials.has(depth)) continue;
    specials.set(depth, (ctx) => memoryProbe(ctx, "selection", 2, depth));
  }
  for (const depth of TOOL_POLICY_DEPTHS) {
    if (specials.has(depth)) continue;
    specials.set(depth, (ctx) => toolPolicyProbe(ctx, 1 + (depth % 4)));
  }
  return buildPlan(conversation, specials, FILLER_ROTATION);
}

// ---------------------------------------------------------------------------
// C - MULTI_PRODUCT (keeps multiple lines, partial corrections)
// ---------------------------------------------------------------------------

function buildMultiProductPlan(): ContinuityPlannedTurn[] {
  const conversation: ContinuityConversationLabel = "C";
  const specials = new Map<number, Beat>();
  specials.set(0, greeting);
  specials.set(1, browse);
  specials.set(2, (ctx) => selectProduct(ctx, "classic", 2));
  specials.set(3, (ctx) => addSecondLine(ctx, "pro", 1));
  specials.set(4, (ctx) => giveDestination(ctx, 2));
  specials.set(5, askShipping);
  specials.set(30, (ctx) => changeQuantity(ctx, 3)); // partial correction - only intends the Classic line
  specials.set(60, (ctx) => addSecondLine(ctx, "pro", 2));
  specials.set(95, stateConflictProbe);
  specials.set(130, (ctx) => oldStateResurrectionProbe(ctx, "selection", { productId: "32", quantity: 3 }));
  specials.set(160, requestQuote);
  for (const depth of MEMORY_PROBE_DEPTHS) {
    if (specials.has(depth)) continue;
    const factKey = depth <= 50 ? "selection" : depth <= 150 ? "destination" : "quote";
    specials.set(depth, (ctx) => memoryProbe(ctx, factKey, factKey === "selection" ? 2 : factKey === "destination" ? 4 : 160, depth));
  }
  for (const depth of TOOL_POLICY_DEPTHS) {
    if (specials.has(depth)) continue;
    specials.set(depth, (ctx) => toolPolicyProbe(ctx, 1 + (depth % 3)));
  }
  return buildPlan(conversation, specials, FILLER_ROTATION);
}

// ---------------------------------------------------------------------------
// D - CASUAL_RETURNING (pauses, farewells, resumes, re-greeting)
// ---------------------------------------------------------------------------

function buildCasualReturningPlan(): ContinuityPlannedTurn[] {
  const conversation: ContinuityConversationLabel = "D";
  const specials = new Map<number, Beat>();
  specials.set(0, greeting);
  specials.set(1, browse);
  specials.set(2, (ctx) => selectProduct(ctx, "pro", 1));
  specials.set(3, (ctx) => giveDestination(ctx, 0));
  specials.set(18, farewellPartial);
  specials.set(19, (ctx) => returnGreeting(ctx, 5));
  specials.set(45, farewellPartial);
  specials.set(46, (ctx) => returnGreeting(ctx, 30));
  specials.set(47, (ctx) => reQuestionProbe(ctx, "selection"));
  specials.set(90, farewellPartial);
  specials.set(91, (ctx) => returnGreeting(ctx, 120));
  specials.set(92, objectiveResumeProbe);
  specials.set(155, farewellPartial);
  specials.set(156, (ctx) => returnGreeting(ctx, 1440));
  specials.set(157, objectiveResumeProbe);
  for (const depth of MEMORY_PROBE_DEPTHS) {
    if (specials.has(depth)) continue;
    specials.set(depth, (ctx) => memoryProbe(ctx, depth < 100 ? "selection" : "destination", depth < 100 ? 2 : 3, depth));
  }
  for (const depth of TOOL_POLICY_DEPTHS) {
    if (specials.has(depth)) continue;
    specials.set(depth, (ctx) => toolPolicyProbe(ctx, 1 + (depth % 3)));
  }
  return buildPlan(conversation, specials, FILLER_ROTATION);
}

// ---------------------------------------------------------------------------
// E - CHAOTIC_ADVERSARIAL (contradictions, ambiguity, out-of-order facts)
// ---------------------------------------------------------------------------

function buildChaoticAdversarialPlan(): ContinuityPlannedTurn[] {
  const conversation: ContinuityConversationLabel = "E";
  const specials = new Map<number, Beat>();
  specials.set(0, greeting);
  specials.set(1, (ctx) => selectProduct(ctx, "classic", 2));
  specials.set(2, ambiguousReference);
  specials.set(3, (ctx) => giveDestination(ctx, 0));
  specials.set(4, (ctx) => replaceProduct(ctx, "pro", 1));
  specials.set(5, ambiguousReference);
  specials.set(25 + 1, stateConflictProbe);
  specials.set(45, (ctx) => giveDestination(ctx, 1)); // contradicts T3 destination
  specials.set(55, (ctx) => changeQuantity(ctx, 4));
  specials.set(80, stateConflictProbe);
  specials.set(110, (ctx) => oldStateResurrectionProbe(ctx, "selection", { productId: "32", quantity: 4 }));
  specials.set(145, ambiguousReference);
  specials.set(170, (ctx) => replaceProduct(ctx, "classic", 3));
  specials.set(195, stateConflictProbe);
  for (const depth of MEMORY_PROBE_DEPTHS) {
    if (specials.has(depth)) continue;
    const factKey = depth <= 50 ? "selection" : depth <= 150 ? "destination" : "selection";
    specials.set(depth, (ctx) => memoryProbe(ctx, factKey, factKey === "selection" ? 1 : 3, depth));
  }
  for (const depth of TOOL_POLICY_DEPTHS) {
    if (specials.has(depth)) continue;
    specials.set(depth, (ctx) => toolPolicyProbe(ctx, 1 + (depth % 4)));
  }
  return buildPlan(conversation, specials, FILLER_ROTATION);
}

export function buildContinuityStressPlans(): Record<ContinuityConversationLabel, ContinuityPlannedTurn[]> {
  return {
    A: buildSimpleBuyerPlan(),
    B: buildIndecisiveBuyerPlan(),
    C: buildMultiProductPlan(),
    D: buildCasualReturningPlan(),
    E: buildChaoticAdversarialPlan()
  };
}

export { TARGET_LENGTH, MEMORY_PROBE_DEPTHS, TOOL_POLICY_DEPTHS };
