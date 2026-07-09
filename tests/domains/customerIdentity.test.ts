import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  createCustomerIdentityResolutionService,
  createLocalCustomerIdentityAdapter,
  type CustomerIdentityLookupResult,
  type CustomerIdentityPort,
  type ResolveCustomerIdentityInput
} from "../../lib/domains/customer-identity";
import { getPool } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { upsertExternalIdentity } from "@/lib/integrations/customer-external-identity";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

// ---------------------------------------------------------------------------
// Unit tests: service decision logic against a fake, in-memory port.
// ---------------------------------------------------------------------------

function okLookup(candidateCustomerIds: string[]): CustomerIdentityLookupResult {
  return { ok: true, candidateCustomerIds };
}

function failLookup(error: string): CustomerIdentityLookupResult {
  return { ok: false, error };
}

type FakePortConfig = {
  external?: CustomerIdentityLookupResult;
  phone?: CustomerIdentityLookupResult;
};

function makeFakePort(config: FakePortConfig) {
  const calls = {
    external: [] as Array<{ provider: string; externalId: string }>,
    phone: [] as Array<{ normalizedPhone: string }>
  };
  const port: CustomerIdentityPort = {
    async findCustomerByExternalIdentity(input) {
      calls.external.push(input);
      return config.external ?? okLookup([]);
    },
    async findCustomersByNormalizedPhone(input) {
      calls.phone.push(input);
      return config.phone ?? okLookup([]);
    }
  };
  return { port, calls };
}

function baseInput(overrides: Partial<ResolveCustomerIdentityInput> = {}): ResolveCustomerIdentityInput {
  return { channel: "whatsapp", externalId: "56912345678", phoneNumber: null, ...overrides };
}

test("unit: wa_id unico resuelve customer", async () => {
  const { port } = makeFakePort({ external: okLookup(["1"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput());
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, "1");
  assert.equal(result.matchedBy, "external_identity");
  assert.equal(result.confidence, "verified");
  assert.deepEqual(result.conflicts, []);
});

test("unit: identidad WhatsApp y telefono historico coinciden", async () => {
  const { port } = makeFakePort({ external: okLookup(["1"]), phone: okLookup(["1"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ phoneNumber: "912345678" }));
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, "1");
  assert.equal(result.matchedBy, "external_identity");
  assert.equal(result.confidence, "verified");
});

test("unit: telefono historico sin vinculo WhatsApp resuelve con confianza strong", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup(["7"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000000", phoneNumber: "912345678" }));
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, "7");
  assert.equal(result.matchedBy, "phone");
  assert.equal(result.confidence, "strong");
});

test("unit: identidad WhatsApp y telefono historico contradicen produce conflict", async () => {
  const { port } = makeFakePort({ external: okLookup(["1"]), phone: okLookup(["2"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ phoneNumber: "922222222" }));
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  assert.equal(result.matchedBy, null);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, "external_identity_vs_phone");
  assert.deepEqual([...result.conflicts[0].candidateCustomerIds].sort(), ["1", "2"]);
});

test("unit: telefono apunta a multiples customers produce conflict", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup(["2", "3"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000001", phoneNumber: "933333333" }));
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  assert.equal(result.conflicts[0].type, "phone_ambiguous");
  assert.deepEqual([...result.conflicts[0].candidateCustomerIds].sort(), ["2", "3"]);
});

test("unit: ninguna coincidencia real produce identification_required", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup([]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000002" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
  assert.equal(result.confidence, "insufficient");
});

test("unit: fuente historica caida produce temporarily_unavailable, nunca identification_required ni cliente nuevo", async () => {
  const externalFailure = makeFakePort({ external: failLookup("customer_external_identity_unavailable") });
  const serviceA = createCustomerIdentityResolutionService({ port: externalFailure.port });
  const resultA = await serviceA.resolveIdentity(baseInput());
  assert.equal(resultA.status, "temporarily_unavailable");
  assert.equal(resultA.customerId, null);
  assert.ok(resultA.warnings.includes("customer_external_identity_unavailable"));

  const phoneFailure = makeFakePort({ external: okLookup([]), phone: failLookup("db_unavailable") });
  const serviceB = createCustomerIdentityResolutionService({ port: phoneFailure.port });
  const resultB = await serviceB.resolveIdentity(baseInput({ externalId: "56900000003", phoneNumber: "912345678" }));
  assert.equal(resultB.status, "temporarily_unavailable");
  assert.equal(resultB.customerId, null);
});

test("unit: wa_id invalido produce invalid_input y no toca el port", async () => {
  const { port, calls } = makeFakePort({});
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "" }));
  assert.equal(result.status, "invalid_input");
  assert.equal(result.customerId, null);
  assert.equal(result.matchedBy, null);
  assert.ok(result.warnings.includes("invalid_external_id"));
  assert.equal(calls.external.length, 0);
  assert.equal(calls.phone.length, 0);

  // invalid_input must stay distinct from every other status it could be
  // confused with - no match, conflict, and source-down all mean something
  // different downstream (onboarding trigger vs retry vs nothing at all).
  assert.notEqual(result.status, "identification_required");
  assert.notEqual(result.status, "conflict");
  assert.notEqual(result.status, "temporarily_unavailable");
});

test("unit: telefono invalido no consulta la fuente telefonica pero no invalida todo el input", async () => {
  const { port, calls } = makeFakePort({ external: okLookup([]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000005", phoneNumber: "abc" }));
  assert.equal(calls.phone.length, 0);
  assert.equal(result.status, "identification_required");
  assert.ok(result.warnings.includes("phone_number_not_normalizable"));
});

test("unit: customer A nunca recibe informacion de customer B en un conflicto", async () => {
  const { port } = makeFakePort({ external: okLookup(["A"]), phone: okLookup(["B"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ phoneNumber: "922222222" }));
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  const conflict = result.conflicts[0] as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(conflict).sort(), ["candidateCustomerIds", "type"]);
  assert.deepEqual([...(conflict.candidateCustomerIds as string[])].sort(), ["A", "B"]);
});

test("unit: resolver no ejecuta INSERT, UPDATE, DELETE ni vinculacion - el port es de solo lectura", () => {
  const adapter = createLocalCustomerIdentityAdapter();
  assert.deepEqual(Object.keys(adapter).sort(), ["findCustomerByExternalIdentity", "findCustomersByNormalizedPhone"]);

  const dir = join(__dirname, "../../lib/domains/customer-identity");
  for (const file of ["types.ts", "ports.ts", "local-adapter.ts", "service.ts", "index.ts"]) {
    const source = readFileSync(join(dir, file), "utf8");
    assert.equal(/\bupsert\w*\(|\bcreateMasterCustomer\(|\blinkExternalIdentity\(/i.test(source), false, `${file} must not call a write operation`);
  }
});

test("unit: telefono se maneja como string normalizado antes de consultar", async () => {
  const { port, calls } = makeFakePort({ external: okLookup([]), phone: okLookup(["9"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000004", phoneNumber: "9 1234 5678" }));
  assert.equal(result.status, "identified");
  assert.equal(calls.phone.length, 1);
  assert.equal(calls.phone[0].normalizedPhone, "56912345678");
  assert.equal(typeof calls.phone[0].normalizedPhone, "string");
});

test("unit: no existe dependencia de tablas n8n_* en el modulo de identidad", () => {
  const dir = join(__dirname, "../../lib/domains/customer-identity");
  for (const file of ["types.ts", "ports.ts", "local-adapter.ts", "service.ts", "index.ts"]) {
    const source = readFileSync(join(dir, file), "utf8");
    assert.equal(/n8n_/i.test(source), false, `${file} must not reference n8n_* tables`);
  }
});

// ---------------------------------------------------------------------------
// Integration tests: the real LocalCustomerIdentityAdapter against the dev DB.
// Fakes above prove the service's decision table; these prove the actual SQL
// and row mapping in lib/integrations/customer-external-identity actually
// finds a historical phone across providers and dedupes by customerId.
// ---------------------------------------------------------------------------

function uniqueDigits(length: number) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += randomInt(0, 10).toString();
  return out;
}

function uniqueNormalizedPhone() {
  return `569${uniqueDigits(8)}`;
}

async function makeCustomer(label: string) {
  const result = await createMasterCustomer({
    firstname: "IdentityT02.1",
    lastname: label,
    email: `identity-t02-1-${label}-${Date.now()}-${uniqueDigits(4)}@local.invalid`,
    platformOrigin: "whatsapp"
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.data.id);
}

test("integration: telefono encontrado unicamente en fuente historica (otro provider) resuelve el customer", async () => {
  const customerId = await makeCustomer("HistoricalOnly");
  const phone = uniqueNormalizedPhone();
  await upsertExternalIdentity({
    customerId,
    provider: "hub_operator",
    identityType: "phone",
    externalId: `manual-${phone}`,
    normalizedValue: phone,
    isVerified: true
  });

  const adapter = createLocalCustomerIdentityAdapter();
  const neverSeenWaId = uniqueNormalizedPhone();
  const externalLookup = await adapter.findCustomerByExternalIdentity({ provider: "whatsapp", externalId: neverSeenWaId });
  assert.ok(externalLookup.ok);
  assert.deepEqual(externalLookup.candidateCustomerIds, []);

  const service = createCustomerIdentityResolutionService();
  const result = await service.resolveIdentity({ channel: "whatsapp", externalId: neverSeenWaId, phoneNumber: phone });
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, String(customerId));
  assert.equal(result.matchedBy, "phone");
  assert.equal(result.confidence, "strong");
});

test("integration: mismo customer encontrado por varias fuentes no se duplica", async () => {
  const customerId = await makeCustomer("MultiSource");
  const phone = uniqueNormalizedPhone();
  await upsertExternalIdentity({
    customerId,
    provider: "whatsapp",
    identityType: "phone_number",
    externalId: phone,
    normalizedValue: phone,
    isVerified: false
  });
  await upsertExternalIdentity({
    customerId,
    provider: "import",
    identityType: "phone",
    externalId: `legacy-${phone}`,
    normalizedValue: phone,
    isVerified: false
  });

  const adapter = createLocalCustomerIdentityAdapter();
  const phoneLookup = await adapter.findCustomersByNormalizedPhone({ normalizedPhone: phone });
  assert.ok(phoneLookup.ok);
  assert.deepEqual(phoneLookup.candidateCustomerIds, [String(customerId)]);
});

test("integration: fuentes consistentes (wa_id + telefono historico apuntan al mismo customer) resuelve identified", async () => {
  const customerId = await makeCustomer("Consistent");
  const waId = uniqueNormalizedPhone();
  const phone = uniqueNormalizedPhone();
  await upsertExternalIdentity({
    customerId,
    provider: "whatsapp",
    identityType: "phone_number",
    externalId: waId,
    normalizedValue: waId,
    isVerified: true
  });
  await upsertExternalIdentity({
    customerId,
    provider: "hub_operator",
    identityType: "phone",
    externalId: `manual-${phone}`,
    normalizedValue: phone,
    isVerified: true
  });

  const service = createCustomerIdentityResolutionService();
  const result = await service.resolveIdentity({ channel: "whatsapp", externalId: waId, phoneNumber: phone });
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, String(customerId));
  assert.equal(result.matchedBy, "external_identity");
  assert.equal(result.confidence, "verified");
});

test("integration: fuentes contradictorias (wa_id de A, telefono historico de B) producen conflict", async () => {
  const customerA = await makeCustomer("ContradictA");
  const customerB = await makeCustomer("ContradictB");
  const waId = uniqueNormalizedPhone();
  const phone = uniqueNormalizedPhone();
  await upsertExternalIdentity({
    customerId: customerA,
    provider: "whatsapp",
    identityType: "phone_number",
    externalId: waId,
    normalizedValue: waId,
    isVerified: true
  });
  await upsertExternalIdentity({
    customerId: customerB,
    provider: "hub_operator",
    identityType: "phone",
    externalId: `manual-${phone}`,
    normalizedValue: phone,
    isVerified: true
  });

  const service = createCustomerIdentityResolutionService();
  const result = await service.resolveIdentity({ channel: "whatsapp", externalId: waId, phoneNumber: phone });
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  assert.equal(result.conflicts[0].type, "external_identity_vs_phone");
  assert.deepEqual([...result.conflicts[0].candidateCustomerIds].sort(), [String(customerA), String(customerB)].sort());
});

test("integration: telefono historico ambiguo entre dos customers produce conflict", async () => {
  const customerA = await makeCustomer("AmbiguousA");
  const customerB = await makeCustomer("AmbiguousB");
  const phone = uniqueNormalizedPhone();
  await upsertExternalIdentity({
    customerId: customerA,
    provider: "hub_operator",
    identityType: "phone",
    externalId: `manual-a-${phone}`,
    normalizedValue: phone,
    isVerified: true
  });
  await upsertExternalIdentity({
    customerId: customerB,
    provider: "import",
    identityType: "phone",
    externalId: `manual-b-${phone}`,
    normalizedValue: phone,
    isVerified: true
  });

  const adapter = createLocalCustomerIdentityAdapter();
  const phoneLookup = await adapter.findCustomersByNormalizedPhone({ normalizedPhone: phone });
  assert.ok(phoneLookup.ok);
  assert.deepEqual([...phoneLookup.candidateCustomerIds].sort(), [String(customerA), String(customerB)].sort());

  const neverSeenWaId = uniqueNormalizedPhone();
  const service = createCustomerIdentityResolutionService();
  const result = await service.resolveIdentity({ channel: "whatsapp", externalId: neverSeenWaId, phoneNumber: phone });
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  assert.equal(result.conflicts[0].type, "phone_ambiguous");
});
