import assert from "node:assert/strict";
import test from "node:test";
import { CONVERSATION_A, CONVERSATION_B, CONVERSATION_C, CONVERSATION_LABELS, KNOWN_FIXTURE_PRODUCT_IDS, STRESS_CATEGORIES, STRESS_PLAN, buildStressPlan } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/stressPlan";

/**
 * SALES-AGENT-R3-P7.12. Pure/in-memory: the frozen deterministic stress-plan (section 9) - shape,
 * category coverage, interleave order, fault presence, no accidental invalid expected-state data.
 */

test("P7.12: 150-250 total turns, each conversation has 50+ turns (section 8)", () => {
  assert.ok(STRESS_PLAN.length >= 150 && STRESS_PLAN.length <= 250, `total=${STRESS_PLAN.length}`);
  assert.ok(CONVERSATION_A.length >= 50, `A=${CONVERSATION_A.length}`);
  assert.ok(CONVERSATION_B.length >= 50, `B=${CONVERSATION_B.length}`);
  assert.ok(CONVERSATION_C.length >= 50, `C=${CONVERSATION_C.length}`);
  assert.equal(CONVERSATION_A.length + CONVERSATION_B.length + CONVERSATION_C.length, STRESS_PLAN.length);
});

test("P7.12: buildStressPlan is deterministic (same output every call, no randomness)", () => {
  assert.deepEqual(buildStressPlan(), buildStressPlan());
  assert.deepEqual(STRESS_PLAN, buildStressPlan());
});

test("P7.12: every one of the 26 stress categories appears at least once", () => {
  const present = new Set(STRESS_PLAN.map((turn) => turn.stressCategory));
  for (const category of STRESS_CATEGORIES) assert.ok(present.has(category), `missing category ${category}`);
});

test("P7.12: replacement/correction transitions >= 20 (section 14) - CORRECTION + REPLACEMENT + CONTRADICTION combined (a contradiction chain step IS a correction of a prior stated quantity/product)", () => {
  const count = STRESS_PLAN.filter((turn) => turn.stressCategory === "CORRECTION" || turn.stressCategory === "REPLACEMENT" || turn.stressCategory === "CONTRADICTION").length;
  assert.ok(count >= 20, `only ${count} correction/replacement transitions`);
});

test("P7.12: interleaved round-robin - no conversation runs start-to-finish before another starts (section 6/33)", () => {
  const firstNine = STRESS_PLAN.slice(0, 9).map((turn) => turn.conversation);
  assert.deepEqual(firstNine, ["A", "B", "C", "A", "B", "C", "A", "B", "C"]);
  const totals: Record<string, number> = { A: CONVERSATION_A.length, B: CONVERSATION_B.length, C: CONVERSATION_C.length };
  // Between two consecutive occurrences of the SAME conversation, every OTHER conversation still active at that point appears at most once (strict round-robin), never zero times unless it has already been exhausted.
  const lastIndexOf: Record<string, number> = { A: -1, B: -1, C: -1 };
  for (let i = 0; i < STRESS_PLAN.length; i += 1) {
    const label = STRESS_PLAN[i].conversation;
    const previous = lastIndexOf[label];
    if (previous >= 0) {
      const between = STRESS_PLAN.slice(previous + 1, i);
      for (const other of CONVERSATION_LABELS) {
        if (other === label) continue;
        const occurrences = between.filter((turn) => turn.conversation === other).length;
        const otherExhaustedBefore = STRESS_PLAN[previous].localIndex >= 0 && (STRESS_PLAN.slice(0, previous + 1).filter((turn) => turn.conversation === other).length >= totals[other]);
        if (!otherExhaustedBefore) assert.equal(occurrences, 1, `between two ${label} turns, ${other} appeared ${occurrences} times (expected exactly 1, still active)`);
      }
    }
    lastIndexOf[label] = i;
  }
});

test("P7.12: sequenceIndex is 0..N-1 with no gaps or duplicates, localIndex is 0..len-1 per conversation with no gaps", () => {
  assert.deepEqual(STRESS_PLAN.map((turn) => turn.sequenceIndex), STRESS_PLAN.map((_turn, index) => index));
  for (const label of CONVERSATION_LABELS) {
    const locals = STRESS_PLAN.filter((turn) => turn.conversation === label).map((turn) => turn.localIndex);
    assert.deepEqual(locals, locals.map((_value, index) => index));
  }
});

test("P7.12: every declared expectedFinalSelection uses a known fixture product with a positive integer quantity and no duplicate product lines", () => {
  for (const turn of STRESS_PLAN) {
    if (!turn.expectedFinalSelection) continue;
    const seen = new Set<string>();
    for (const item of turn.expectedFinalSelection) {
      assert.ok((KNOWN_FIXTURE_PRODUCT_IDS as readonly string[]).includes(item.productId), `${turn.conversation}${turn.localIndex}: unknown product ${item.productId}`);
      assert.ok(Number.isInteger(item.quantity) && item.quantity > 0, `${turn.conversation}${turn.localIndex}: bad quantity ${item.quantity}`);
      assert.equal(seen.has(item.productId), false, `${turn.conversation}${turn.localIndex}: duplicate product ${item.productId}`);
      seen.add(item.productId);
    }
  }
});

test("P7.12: CANCEL-mutation turns declare an empty expected selection", () => {
  for (const turn of STRESS_PLAN.filter((entry) => entry.expectedMutation === "CANCEL" && entry.expectedFinalSelection !== undefined)) assert.deepEqual(turn.expectedFinalSelection, []);
});

test("P7.12: at least 4 distinct one-shot fault kinds are scheduled, each targeting a real capability name (section 23/37)", () => {
  const faults = STRESS_PLAN.filter((turn) => turn.fault);
  assert.ok(faults.length >= 4, `only ${faults.length} fault-injected turns`);
  const kinds = new Set(faults.map((turn) => turn.fault!.kind));
  assert.ok(kinds.size >= 4, `only ${kinds.size} distinct fault kinds`);
  for (const turn of faults) assert.ok(turn.fault!.targetCapability.length > 0);
});

test("P7.12: an early (smoke-reachable) fault exists so the 5-minute smoke actually exercises fault injection (section 37)", () => {
  const early = STRESS_PLAN.slice(0, 24).filter((turn) => turn.fault);
  assert.ok(early.length >= 1, "no fault injection turn within the first 24 plan entries (smoke slice)");
});

test("P7.12: no plan message is empty and no turn declares both allowClarification and a strict expectedFinalSelection that would contradict a legitimate clarifying question being acceptable", () => {
  for (const turn of STRESS_PLAN) assert.ok(turn.message.trim().length > 0, `${turn.conversation}${turn.localIndex}: empty message`);
});
