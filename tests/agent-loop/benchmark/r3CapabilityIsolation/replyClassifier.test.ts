import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { asksForQuantity, classifyReply, REPLY_CLASSES, REPLY_DETECTOR_VERSION, type ReplyClass } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/replyClassifier";

/**
 * SALES-AGENT-R3-P7.9. The pre-registered detector, checked against a golden set:
 * the 54 real P7.8-R Q- replies (labelled by hand, read message by message, BEFORE
 * the classifier was run against them) plus the examples in the task statement.
 * Changing a label or the classifier after a P7.9 batch is a post-hoc fix: the
 * original result stays and the correction is exploratory only.
 */
type GoldenEntry = { id: string; source: "p7.8r-real" | "spec-example" | "p7.9-smoke"; reply: string | null; label: ReplyClass };
const golden = JSON.parse(readFileSync(join(process.cwd(), "tests/agent-loop/benchmark/r3CapabilityIsolation/goldenReplies.json"), "utf8")) as GoldenEntry[];

test("P7.9 detector: golden set is intact (54 real P7.8-R Q- replies + spec examples) and only uses declared classes", () => {
  assert.equal(REPLY_DETECTOR_VERSION, "p7.9-reply-detector-v1");
  assert.equal(golden.filter((entry) => entry.source === "p7.8r-real").length, 54);
  assert.ok(golden.filter((entry) => entry.source === "spec-example").length >= 10);
  for (const entry of golden) assert.ok((REPLY_CLASSES as readonly string[]).includes(entry.label), entry.id);
  // the real set reproduces the P7.8-R corrected counts: 3 (A) + 5 (B) + 11 (C1) quantity requests
  assert.equal(golden.filter((entry) => entry.source === "p7.8r-real" && entry.label === "CORRECT_QUANTITY_REQUEST").length, 19);
});

test("P7.9 detector: every golden entry is classified as labelled (no disagreement)", () => {
  const mismatches = golden.filter((entry) => classifyReply(entry.reply) !== entry.label).map((entry) => `${entry.id}: expected ${entry.label}, got ${classifyReply(entry.reply)}`);
  assert.deepEqual(mismatches, []);
});

test("P7.9 detector: the spec's negative examples never count as a quantity request", () => {
  for (const reply of ["Quedan 15 unidades. ¿Quieres el link?", "¿Quieres que lo agregue?", "¿Quieres revisarlo?", "¿Avanzamos?"]) assert.equal(asksForQuantity(reply), false, reply);
  assert.equal(classifyReply("Quedan 15 unidades. ¿Quieres el link?"), "LINK_OFFER");
  assert.equal(classifyReply("¿Quieres que lo agregue?"), "GENERIC_CONFIRMATION");
  assert.equal(classifyReply("¿Avanzamos?"), "GENERIC_CONFIRMATION");
});

test("P7.9 detector: the spec's positive examples count as a quantity request", () => {
  for (const reply of ["¿Cuántas unidades necesitas?", "¿Qué cantidad quieres?", "¿Una o dos unidades?"]) assert.equal(asksForQuantity(reply), true, reply);
});

test("P7.9 detector: a stock statement is information, a stated quantity without a question is not a request, empty is NO_REPLY", () => {
  assert.equal(classifyReply("Hay cantidad de unidades suficientes para tu pedido."), "PRODUCT_INFORMATION");
  assert.equal(classifyReply("La Classic cuesta $89.990 y quedan 15 unidades disponibles."), "PRODUCT_INFORMATION");
  assert.equal(classifyReply("¿Cuánto cuesta el despacho a Ñuñoa?"), "OTHER_QUESTION"); // singular "cuánto" is a price question
  assert.equal(classifyReply(null), "NO_REPLY");
  assert.equal(classifyReply("   "), "NO_REPLY");
});

test("P7.9 detector: an add offer wins over a link mention, a quantity request wins over an add offer", () => {
  assert.equal(classifyReply("¿Quieres que te confirme precio, stock y link, o la agregamos directo a tu compra?"), "GENERIC_CONFIRMATION");
  assert.equal(classifyReply("¿Quieres que la agregue a tu pedido? Si es así, indícame cuántas unidades y a qué comuna."), "CORRECT_QUANTITY_REQUEST");
});
