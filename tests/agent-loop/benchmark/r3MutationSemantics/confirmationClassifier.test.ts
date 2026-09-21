import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CONFIRMATION_CLASSES, CONFIRMATION_CLASSIFIER_VERSION, classifyConfirmation, classifyMissingFactKind, MISSING_FACT_KINDS, type ConfirmationClass, type MissingFactKind } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/confirmationClassifier";

/**
 * SALES-AGENT-R3-P7.10. The pre-registered confirmation classifier against a hand-labelled
 * golden set (labels written BEFORE the classifier was run against them; on a disagreement the
 * classifier is fixed, never the label, and only before the freeze). The P7.9 batch artifacts
 * are not available in this checkout, so the P7.9 failure phrasings in the golden set are the
 * ones the P7.9 audit documents (source `p7.9-documented-phrasing`), not verbatim replies.
 */
type GoldenEntry = { id: string; source: "spec-example" | "p7.9-documented-phrasing" | "p7.10-authored"; reply: string | null; selectCompleted: boolean; label: ConfirmationClass; missingKind?: MissingFactKind };
export const GOLDEN_PATH = join(process.cwd(), "tests/agent-loop/benchmark/r3MutationSemantics/goldenConfirmations.json");
const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenEntry[];

test("P7.10 classifier: golden set has >= 70 hand-labelled phrases, every class, only declared labels, unique ids", () => {
  assert.equal(CONFIRMATION_CLASSIFIER_VERSION, "p7.10-confirmation-classifier-v1");
  assert.ok(golden.length >= 70, `golden has ${golden.length} entries (65 original + 5 added for the missing-fact split, all labelled by hand before the classifier ran)`);
  assert.equal(new Set(golden.map((entry) => entry.id)).size, golden.length);
  for (const entry of golden) assert.ok((CONFIRMATION_CLASSES as readonly string[]).includes(entry.label), entry.id);
  for (const klass of CONFIRMATION_CLASSES) assert.ok(golden.filter((entry) => entry.label === klass).length >= 5, `${klass} has >= 5 golden entries`);
});

test("P7.10 classifier: 0 discrepancies against the golden set", () => {
  const mismatches = golden.filter((entry) => classifyConfirmation({ reply: entry.reply, selectCompleted: entry.selectCompleted }) !== entry.label).map((entry) => `${entry.id}: expected ${entry.label}, got ${classifyConfirmation({ reply: entry.reply, selectCompleted: entry.selectCompleted })} <- ${JSON.stringify(entry.reply)}`);
  assert.deepEqual(mismatches, []);
});

test("P7.10 classifier: the task statement's examples", () => {
  const c = (reply: string, selectCompleted = false) => classifyConfirmation({ reply, selectCompleted });
  assert.equal(c("¿confirmas las dos?"), "UNNECESSARY_CONFIRMATION");
  assert.equal(c("¿cuántas unidades quieres?"), "MISSING_FACT_QUESTION");
  assert.equal(c("Perfecto, dejé dos seleccionadas", true), "ACTION_EXECUTED");
});

test("P7.10 classifier: a text claim of action is never ACTION_EXECUTED without a completed select_products (durable-state backing)", () => {
  for (const reply of ["Perfecto, dejé dos seleccionadas", "Listo, agregué 3 barras Classic a tu selección.", "Ya quedó guardado tu pedido."]) {
    assert.equal(classifyConfirmation({ reply, selectCompleted: false }), "OTHER", reply);
    assert.equal(classifyConfirmation({ reply, selectCompleted: true }), "ACTION_EXECUTED", reply);
  }
});

test("P7.10 classifier: every MISSING_FACT_QUESTION golden entry carries a hand-labelled sub-kind and the classifier reproduces it (residual taxonomy: quantity vs product vs other fact)", () => {
  const missing = golden.filter((entry) => entry.label === "MISSING_FACT_QUESTION");
  assert.ok(missing.length >= 19);
  for (const entry of missing) assert.ok(entry.missingKind && (MISSING_FACT_KINDS as readonly string[]).includes(entry.missingKind), entry.id);
  for (const kind of MISSING_FACT_KINDS) assert.ok(missing.filter((entry) => entry.missingKind === kind).length >= 1, `${kind} has at least one golden entry`);
  const mismatches = missing.filter((entry) => classifyMissingFactKind(entry.reply) !== entry.missingKind).map((entry) => `${entry.id}: expected ${entry.missingKind}, got ${classifyMissingFactKind(entry.reply)}`);
  assert.deepEqual(mismatches, []);
});

test("P7.10 classifier: the missing-fact sub-kind is null for any other class, and a quantity request wins over a product question in the same reply", () => {
  for (const entry of golden.filter((candidate) => candidate.label !== "MISSING_FACT_QUESTION" && !candidate.selectCompleted)) assert.equal(classifyMissingFactKind(entry.reply), null, entry.id);
  assert.equal(classifyMissingFactKind("¿Cuántas quieres y de cuál modelo?"), "QUANTITY_REQUESTION");
  assert.equal(classifyMissingFactKind("¿Cuál de las dos prefieres?"), "PRODUCT_REQUESTION");
  assert.equal(classifyMissingFactKind("¿A qué comuna despachamos?"), "OTHER_FACT_REQUEST");
  assert.equal(classifyMissingFactKind(null), null);
});
