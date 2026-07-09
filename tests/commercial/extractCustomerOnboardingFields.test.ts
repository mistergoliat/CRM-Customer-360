import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { extractCustomerOnboardingFields } from "@/lib/brain/commercial/native-cycle/customer-session/extractCustomerOnboardingFields";

// ACS-R1-04-T06.1, contract sections 9-11 (group "Extraccion", tests 6-15).

const SOURCE = readFileSync(join(__dirname, "..", "..", "lib", "brain", "commercial", "native-cycle", "customer-session", "extractCustomerOnboardingFields.ts"), "utf8");

test("6: an explicit, unambiguous email is extracted and normalized (trimmed, lowercased)", () => {
  assert.deepEqual(extractCustomerOnboardingFields("mi correo es Pedro@Example.COM "), { email: "pedro@example.com" });
  assert.deepEqual(extractCustomerOnboardingFields("puedes usar pedro@example.com"), { email: "pedro@example.com" });
  assert.deepEqual(extractCustomerOnboardingFields("email: pedro@example.com"), { email: "pedro@example.com" });
});

test("7: an invalid/spelled-out email is never extracted", () => {
  assert.equal(extractCustomerOnboardingFields("pedro arroba ejemplo").email, undefined);
  assert.equal(extractCustomerOnboardingFields("mi correo es el de siempre").email, undefined);
  assert.equal(extractCustomerOnboardingFields("usa el correo de mi cuenta").email, undefined);
});

test("8: an explicit name declaration is extracted (me llamo / mi nombre es / soy / nombre:)", () => {
  assert.deepEqual(extractCustomerOnboardingFields("me llamo Pedro Perez"), { firstName: "Pedro", lastName: "Perez" });
  assert.deepEqual(extractCustomerOnboardingFields("mi nombre es Pedro Perez"), { firstName: "Pedro", lastName: "Perez" });
  assert.deepEqual(extractCustomerOnboardingFields("soy Pedro Perez"), { firstName: "Pedro", lastName: "Perez" });
  assert.deepEqual(extractCustomerOnboardingFields("nombre: Pedro Perez"), { firstName: "Pedro", lastName: "Perez" });
});

test("9: an ambiguous phrase after 'soy' is never interpreted as a name", () => {
  assert.equal(extractCustomerOnboardingFields("soy cliente antiguo").firstName, undefined);
  assert.equal(extractCustomerOnboardingFields("soy de Santiago").firstName, undefined);
  assert.equal(extractCustomerOnboardingFields("soy el encargado de compras").firstName, undefined);
  assert.deepEqual(extractCustomerOnboardingFields("soy Pedro y necesito una maquina"), { firstName: "Pedro" });
});

test("10: a name candidate containing digits is rejected", () => {
  assert.equal(extractCustomerOnboardingFields("me llamo Pedro123").firstName, undefined);
  assert.equal(extractCustomerOnboardingFields("soy 12345").firstName, undefined);
});

test("11: a URL is never interpreted as a name", () => {
  assert.equal(extractCustomerOnboardingFields("me llamo http://evil.example").firstName, undefined);
  assert.equal(extractCustomerOnboardingFields("soy www.tienda.com").firstName, undefined);
});

test("12: an order reference with an explicit label is extracted", () => {
  assert.equal(extractCustomerOnboardingFields("mi pedido es 187125").orderReference, "187125");
  assert.equal(extractCustomerOnboardingFields("orden 187125").orderReference, "187125");
  assert.equal(extractCustomerOnboardingFields("referencia de compra ABC-1234").orderReference, "ABC-1234");
  assert.equal(extractCustomerOnboardingFields("numero de pedido: 187125").orderReference, "187125");
});

test("13: a bare number with no label cue is never interpreted as an order reference", () => {
  assert.equal(extractCustomerOnboardingFields("187125").orderReference, undefined);
  assert.equal(extractCustomerOnboardingFields("compre hace seis meses").orderReference, undefined);
  assert.equal(extractCustomerOnboardingFields("es el mismo pedido anterior").orderReference, undefined);
  assert.equal(extractCustomerOnboardingFields("la orden que aparece en mi cuenta").orderReference, undefined);
});

test("14: the extractor never reads Customer 360 - no import of that domain in its source", () => {
  assert.doesNotMatch(SOURCE, /customer-360/);
  assert.doesNotMatch(SOURCE, /Customer360/);
});

test("15: the extractor is a pure, read-only function - no db/repository import, deterministic on repeated calls", () => {
  assert.doesNotMatch(SOURCE, /from ["']@\/lib\/db["']/);
  assert.doesNotMatch(SOURCE, /repository/i);
  const text = "me llamo Pedro Perez, mi correo es pedro@example.com, mi pedido es 187125";
  const first = extractCustomerOnboardingFields(text);
  const second = extractCustomerOnboardingFields(text);
  assert.deepEqual(first, second);
});
