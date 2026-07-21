import assert from "node:assert/strict";
import test from "node:test";
import { searchCompanyKnowledgeFixtures, companyKnowledgeCapability } from "@/lib/brain/commercial/capability-gateway/companyKnowledgeCapability";

test("matches an accented query against unaccented fixture keywords", () => {
  const result = searchCompanyKnowledgeFixtures("¿Atienden el sábado?");
  assert.ok(result.entries.some((entry) => entry.topic === "horarios_atencion"));
});

test("matches payment-method keywords", () => {
  const result = searchCompanyKnowledgeFixtures("qué medios de pago aceptan");
  assert.ok(result.entries.some((entry) => entry.topic === "medios_pago"));
});

test("returns no entries for an unrelated query", () => {
  const result = searchCompanyKnowledgeFixtures("cual es la capital de francia");
  assert.equal(result.entries.length, 0);
});

test("capability execute() returns completed with the query echoed back", async () => {
  const capability = companyKnowledgeCapability();
  const availability = await capability.checkAvailability({ correlationId: "test" });
  assert.equal(availability.status, "available");

  const outcome = await capability.execute({ query: "horario de atencion" }, { correlationId: "test" });
  assert.equal(outcome.status, "completed");
  assert.ok(outcome.data && outcome.data.entries.length > 0);
});

test("capability execute() fails closed on a missing query", async () => {
  const capability = companyKnowledgeCapability();
  const outcome = await capability.execute({ query: "" } as { query: string }, { correlationId: "test" });
  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "query_required");
});
