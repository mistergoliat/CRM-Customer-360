import assert from "node:assert/strict";
import test from "node:test";
import { buildContinuityFallbackMessage } from "../../lib/brain/commercial/continuity/buildContinuityFallbackMessage";
import { CONTINUITY_FALLBACK_CLASSES } from "../../lib/brain/commercial/continuity/salesTurnDisposition";

const KNOWN_NEED = { productQuery: "jaula de potencia", usage: "entrenar en casa", budgetMax: 800000, currency: "CLP" };
const NO_NEED = { productQuery: null, usage: null, budgetMax: null, currency: null };

test("ACS-R1-05-T06.2: every fallback class produces non-empty, distinct text and never a bare administrative placeholder", () => {
  const messages = CONTINUITY_FALLBACK_CLASSES.map((fallbackClass) => buildContinuityFallbackMessage(fallbackClass, NO_NEED));
  for (const message of messages) {
    assert.ok(message.trim().length > 0);
    assert.notEqual(message.trim(), "Recibí tu consulta.");
  }
  assert.equal(new Set(messages).size, messages.length, "each fallback class should produce distinct text");
});

test("known commercial need (product, usage, budget) is preserved verbatim in every fallback class", () => {
  for (const fallbackClass of CONTINUITY_FALLBACK_CLASSES) {
    const message = buildContinuityFallbackMessage(fallbackClass, KNOWN_NEED);
    assert.match(message, /jaula de potencia/);
    assert.match(message, /entrenar en casa/);
    assert.match(message, /800.000|800,000/);
  }
});

test("catalog_unavailable: preserves need and budget, never claims a price or stock", () => {
  const message = buildContinuityFallbackMessage("catalog_unavailable", KNOWN_NEED);
  assert.match(message, /catálogo/i);
  assert.doesNotMatch(message, /\$\d/, "must never fabricate a price");
});

test("handoff_acknowledgement: mentions connecting to the team, preserves known need", () => {
  const message = buildContinuityFallbackMessage("handoff_acknowledgement", KNOWN_NEED);
  assert.match(message, /equipo/i);
});

test("no known need: message still reads as a coherent sentence, not a dangling clause", () => {
  for (const fallbackClass of CONTINUITY_FALLBACK_CLASSES) {
    const message = buildContinuityFallbackMessage(fallbackClass, NO_NEED);
    assert.equal(message.startsWith(" "), false);
    assert.ok(/^[A-ZÁÉÍÓÚÑ]/.test(message), `"${message}" should start with a capital letter`);
  }
});
