import assert from "node:assert/strict";
import test from "node:test";
import { hasUnsupportedCommercialCommitment } from "../../lib/brain/commercial/autonomy-sandbox/detectUnsupportedCommercialCommitment";

// ACS-R1-05-T06.2 (P1 correction). Pure, isolated coverage of the
// evidence-independent commitment classifier, separate from the full
// sandbox pipeline (see tests/commercial/autonomySandbox.test.ts for the
// end-to-end version through evaluateAgentActionForSandbox).

const ALLOWED = [
  "¿Quieres que revise el precio?",
  "Voy a consultar el stock.",
  "Necesito confirmar el despacho.",
  "Dejaré el precio pendiente de validación.",
  "Voy a consultar las condiciones de garantía.",
  "Necesito verificar la garantía.",
  "El precio informado por catálogo es $500.000.",
  "El catálogo informa disponibilidad.",
  "La ficha indica una garantía de 12 meses.",
  "El producto soporta hasta 150 kg según su especificación.",
  "Puedo confirmar el stock.",
  "No puedo garantizarte disponibilidad sin revisarla.",
  "Antes de confirmar el precio debo consultar el catálogo.",
  "Hay stock asegurado para hoy."
];

const BLOCKED = [
  "Te garantizo stock.",
  "Llega mañana con seguridad.",
  "Te mantengo ese precio.",
  "Te confirmo un descuento.",
  "El despacho está asegurado.",
  "La garantía cubrirá cualquier falla.",
  "No tendrás ningún problema con la garantía.",
  "Este equipo te servirá con total seguridad.",
  "Te garantizamos que habrá stock.",
  "Aseguramos que no tendrás problemas.",
  "Confirmamos el descuento para ti.",
  "Te prometemos entrega mañana.",
  "Sin duda alguna, tendrás el descuento.",
  "Cien por ciento seguro que llega mañana.",
  "Le garantizo que no tendrá inconvenientes."
];

for (const phrase of ALLOWED) {
  test(`allows: "${phrase}"`, () => {
    assert.equal(hasUnsupportedCommercialCommitment(phrase), false);
  });
}

for (const phrase of BLOCKED) {
  test(`blocks: "${phrase}"`, () => {
    assert.equal(hasUnsupportedCommercialCommitment(phrase), true);
  });
}

test("a commitment in one sentence blocks the whole message even if other sentences are safe", () => {
  const text = "Gracias por tu mensaje. Te garantizo stock. Cualquier otra duda, avísame.";
  assert.equal(hasUnsupportedCommercialCommitment(text), true);
});

test("a bare topic word alone never triggers a block", () => {
  const bareTopicPhrases = [
    "El precio del producto varía según la comuna.",
    "El stock se actualiza diariamente.",
    "El despacho tiene distintas opciones.",
    "La garantía cubre defectos de fábrica.",
    "Aplican descuentos por volumen."
  ];
  for (const phrase of bareTopicPhrases) {
    assert.equal(hasUnsupportedCommercialCommitment(phrase), false, `expected "${phrase}" to be allowed`);
  }
});

test("empty text never blocks (no commercial content to misclassify)", () => {
  assert.equal(hasUnsupportedCommercialCommitment(""), false);
});
