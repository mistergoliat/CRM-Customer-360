import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  applyIdentityEvidence,
  classifyPrestashopCandidates,
  createCustomerIdentityResolutionService,
  createLocalCustomerIdentityAdapter,
  type CustomerIdentityLookupResult,
  type CustomerIdentityPort,
  type PrestashopCandidateLookupResult,
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

function okPsLookup(candidatePrestashopCustomerIds: string[]): PrestashopCandidateLookupResult {
  return { ok: true, candidatePrestashopCustomerIds };
}

function failPsLookup(error: string): PrestashopCandidateLookupResult {
  return { ok: false, error };
}

type FakePortConfig = {
  external?: CustomerIdentityLookupResult;
  phone?: CustomerIdentityLookupResult;
  // Bridge lookup: findCustomerByExternalIdentity({ provider: "prestashop", ... }).
  // Reuses the same method as `external` (provider "whatsapp") - branched
  // below exactly like the real port does, on `input.provider`.
  prestashopLink?: CustomerIdentityLookupResult;
  prestashopByEmail?: PrestashopCandidateLookupResult;
  prestashopByOrder?: PrestashopCandidateLookupResult;
};

function makeFakePort(config: FakePortConfig) {
  const calls = {
    external: [] as Array<{ provider: string; externalId: string }>,
    phone: [] as Array<{ normalizedPhone: string }>,
    prestashopByEmail: [] as Array<{ normalizedEmail: string }>,
    prestashopByOrder: [] as Array<{ orderReference: string }>
  };
  const port: CustomerIdentityPort = {
    async findCustomerByExternalIdentity(input) {
      calls.external.push(input);
      if (input.provider === "prestashop") return config.prestashopLink ?? okLookup([]);
      return config.external ?? okLookup([]);
    },
    async findCustomersByNormalizedPhone(input) {
      calls.phone.push(input);
      return config.phone ?? okLookup([]);
    },
    async findPrestashopCustomerIdsByEmail(input) {
      calls.prestashopByEmail.push(input);
      return config.prestashopByEmail ?? okPsLookup([]);
    },
    async findPrestashopCustomerIdsByOrderReference(input) {
      calls.prestashopByOrder.push(input);
      return config.prestashopByOrder ?? okPsLookup([]);
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
  assert.deepEqual(
    Object.keys(adapter).sort(),
    [
      "findCustomerByExternalIdentity",
      "findCustomersByNormalizedPhone",
      "findPrestashopCustomerIdsByEmail",
      "findPrestashopCustomerIdsByOrderReference"
    ].sort()
  );

  const dir = join(__dirname, "../../lib/domains/customer-identity");
  for (const file of ["types.ts", "ports.ts", "local-adapter.ts", "service.ts", "evidence.ts", "index.ts"]) {
    const source = readFileSync(join(dir, file), "utf8");
    assert.equal(/\bupsert\w*\(|\bcreateMasterCustomer\(|\blinkExternalIdentity\(/i.test(source), false, `${file} must not call a write operation`);
  }

  // IDR20: no new persistence, no master_customer writer, anywhere new.
  const psSource = readFileSync(join(__dirname, "../../lib/integrations/prestashop-mirror/repository.ts"), "utf8");
  assert.equal(/\bINSERT\s+INTO|\bUPDATE\s+`|\bDELETE\s+FROM/i.test(psSource), false, "prestashop-mirror repository must be read-only");
});

// IDR13: address is never used as a primary identity signal - no field,
// port method, or reader for ps_address anywhere in the resolver.
test("unit: el resolver nunca usa ps_address como prueba de identidad", () => {
  const dir = join(__dirname, "../../lib/domains/customer-identity");
  for (const file of ["types.ts", "ports.ts", "local-adapter.ts", "service.ts", "evidence.ts", "index.ts"]) {
    const source = readFileSync(join(dir, file), "utf8");
    assert.equal(/ps_address/i.test(source), false, `${file} must not reference ps_address`);
  }
  const psSource = readFileSync(join(__dirname, "../../lib/integrations/prestashop-mirror/repository.ts"), "utf8");
  assert.equal(/ps_address/i.test(psSource), false, "prestashop-mirror repository must not reference ps_address");
});

// IDR19/IDR21: the resolver never calls link_external_identity and never
// imports the legacy composite resolver as an authority.
test("unit: el resolver no llama link_external_identity ni importa el motor legacy", () => {
  const files = [
    join(__dirname, "../../lib/domains/customer-identity/service.ts"),
    join(__dirname, "../../lib/domains/customer-identity/evidence.ts"),
    join(__dirname, "../../lib/domains/customer-identity/local-adapter.ts"),
    join(__dirname, "../../lib/integrations/prestashop-mirror/repository.ts")
  ];
  const legacyImportPattern = /(?:from\s+["'][^"']*(?:resolveCustomerCandidate|sourceReaders)["']|require\(["'][^"']*(?:resolveCustomerCandidate|sourceReaders)["']\))/;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(/link_external_identity/i.test(source), false, `${file} must not call link_external_identity`);
    assert.equal(legacyImportPattern.test(source), false, `${file} must not import the legacy composite resolver`);
  }
});

// IDR22: the raw email/phone value the caller supplied never leaks into the
// result - only derived ids (prestashopCustomerId, masterCustomerId) do.
test("unit: el resultado nunca serializa el email o telefono crudo del input", async () => {
  const { port } = makeFakePort({
    external: okLookup([]),
    phone: okLookup([]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopLink: okLookup([])
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(
    baseInput({ externalId: "56900000010", phoneNumber: "912345678", email: "Camila.Rojas@Example.TEST" })
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.toLowerCase().includes("camila"), false);
  assert.equal(serialized.includes("912345678"), false);
  assert.equal(serialized.includes("example.test"), false);
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
  for (const file of ["types.ts", "ports.ts", "local-adapter.ts", "service.ts", "evidence.ts", "index.ts"]) {
    const source = readFileSync(join(dir, file), "utf8");
    assert.equal(/n8n_/i.test(source), false, `${file} must not reference n8n_* tables`);
  }
});

// ---------------------------------------------------------------------------
// ID-R2-A02: candidate resolver expansion + identity evidence contract.
// PARTE 19 test matrix (IDR01-IDR24). IDR01/IDR02/IDR14/IDR15/IDR19-IDR22
// are covered above by the pre-existing wa/phone tests and the static
// checks just added; the rest are below.
// ---------------------------------------------------------------------------

test("IDR03: email exacto unico produce PrestaShop candidate, nunca auto-link", async () => {
  const { port } = makeFakePort({
    external: okLookup([]),
    phone: okLookup([]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopLink: okLookup([]) // Case D: discoverable, not linked to any master yet.
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000100", email: "cliente@example.test" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
  assert.equal(result.detail?.status, "CANDIDATE");
  assert.equal(result.detail?.prestashopCustomerId, "7421");
  assert.equal(result.detail?.masterCustomerId, null);
});

test("IDR04: email inexistente produce NOT_FOUND como evidencia, no fallo tecnico", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup([]), prestashopByEmail: okPsLookup([]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000101", email: "nadie@example.test" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.detail?.status, "NOT_FOUND");
});

test("IDR05: multiples matches de email producen AMBIGUOUS, nunca se elige uno", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup([]), prestashopByEmail: okPsLookup(["1", "2"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000102", email: "compartido@example.test" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.detail?.status, "AMBIGUOUS");
  assert.ok(result.warnings.includes("email_ambiguous"));
});

test("IDR06: email con PrestaShop ya linkeado a un master produce candidate, sin auto-elevar", async () => {
  const { port } = makeFakePort({
    external: okLookup([]),
    phone: okLookup([]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopLink: okLookup(["55"])
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000103", email: "vinculado@example.test" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
  assert.equal(result.detail?.status, "NEEDS_VERIFICATION");
  assert.equal(result.detail?.masterCustomerId, "55");
});

test("IDR07: wa_id master A + email/PrestaShop master A convergen en RESOLVED", async () => {
  const { port } = makeFakePort({
    external: okLookup(["1"]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopLink: okLookup(["1"])
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000104", email: "camila@example.test" }));
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, "1");
  assert.equal(result.detail?.status, "RESOLVED");
  assert.equal(result.detail?.masterCustomerId, "1");
});

test("IDR08: wa_id master A + email/PrestaShop master B produce IDENTITY_CONFLICT", async () => {
  const { port } = makeFakePort({
    external: okLookup(["1"]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopLink: okLookup(["2"])
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000105", email: "otro@example.test" }));
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  assert.equal(result.conflicts[0].type, "prestashop_link_vs_wa_phone");
  assert.deepEqual([...result.conflicts[0].candidateCustomerIds].sort(), ["1", "2"]);
  assert.equal(result.detail?.status, "IDENTITY_CONFLICT");
});

test("IDR09: telefono master A + email/PrestaShop master B produce IDENTITY_CONFLICT", async () => {
  const { port } = makeFakePort({
    external: okLookup([]),
    phone: okLookup(["3"]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopLink: okLookup(["9"])
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(
    baseInput({ externalId: "56900000106", phoneNumber: "912345678", email: "otro@example.test" })
  );
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  assert.equal(result.conflicts[0].type, "prestashop_link_vs_wa_phone");
});

test("IDR10: email PS A + orden PS A convergen como evidencia fuerte/verificada (no master)", async () => {
  const { port } = makeFakePort({
    external: okLookup([]),
    phone: okLookup([]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopByOrder: okPsLookup(["7421"]),
    prestashopLink: okLookup([])
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(
    baseInput({ externalId: "56900000107", email: "camila@example.test", orderReference: "ORD-7421" })
  );
  assert.equal(result.status, "identification_required");
  assert.equal(result.detail?.status, "CANDIDATE");
  assert.equal(result.detail?.prestashopCustomerId, "7421");
  assert.ok(result.detail?.evidence.some((e) => e.signalType === "prestashop_customer_id" && e.source === "prestashop" && e.strength === "verified"));
});

test("IDR11: email PS A + orden PS B produce IDENTITY_CONFLICT", async () => {
  const { port } = makeFakePort({
    external: okLookup([]),
    phone: okLookup([]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopByOrder: okPsLookup(["9832"])
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(
    baseInput({ externalId: "56900000108", email: "camila@example.test", orderReference: "ORD-9832" })
  );
  assert.equal(result.status, "conflict");
  assert.equal(result.conflicts[0].type, "email_vs_order_prestashop_id");
  assert.equal(result.detail?.status, "IDENTITY_CONFLICT");
});

test("IDR12: orden inexistente no produce verificacion ni candidate fabricado", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup([]), prestashopByOrder: okPsLookup([]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000109", orderReference: "ORD-000000" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
  assert.equal(result.detail?.status, "NOT_FOUND");
});

test("IDR16: mismo PrestaShop id vinculado a multiples masters falla cerrado", async () => {
  const { port } = makeFakePort({
    external: okLookup([]),
    phone: okLookup([]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopLink: okLookup(["1", "2"]) // data-integrity corruption simulated via the fake.
  });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000110", email: "corrupto@example.test" }));
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  assert.equal(result.conflicts[0].type, "prestashop_id_multi_master");
  assert.deepEqual([...result.conflicts[0].candidateCustomerIds].sort(), ["1", "2"]);
});

test("IDR17: email invalido produce INVALID_INPUT en el detalle, sin tocar el status externo", async () => {
  const { port, calls } = makeFakePort({ external: okLookup([]), phone: okLookup([]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000111", email: "no-es-un-email" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.detail?.status, "INVALID_INPUT");
  assert.ok(result.warnings.includes("email_invalid_input"));
  assert.equal(calls.prestashopByEmail.length, 0, "invalid email must never be queried");
});

test("IDR18: fuente PrestaShop caida produce SYSTEM_FAILURE/temporarily_unavailable, no un fallo silencioso", async () => {
  const down = makeFakePort({ external: okLookup([]), phone: okLookup([]), prestashopByEmail: failPsLookup("prestashop_mirror_unavailable") });
  const service = createCustomerIdentityResolutionService({ port: down.port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000112", email: "camila@example.test" }));
  assert.equal(result.status, "temporarily_unavailable");
  assert.equal(result.customerId, null);
  assert.equal(result.detail?.status, "SYSTEM_FAILURE");
  assert.ok(result.warnings.includes("prestashop_evidence_unavailable"));

  // A resolved wa_id/phone identity is never downgraded by a PrestaShop-side
  // outage - only the detail notes it, the top-level result stays resolved.
  const resolved = makeFakePort({ external: okLookup(["1"]), prestashopByEmail: failPsLookup("prestashop_mirror_unavailable") });
  const serviceB = createCustomerIdentityResolutionService({ port: resolved.port });
  const resultB = await serviceB.resolveIdentity(baseInput({ externalId: "56900000113", email: "camila@example.test" }));
  assert.equal(resultB.status, "identified");
  assert.equal(resultB.customerId, "1");
  assert.equal(resultB.detail?.status, "RESOLVED");
});

test("IDR23: el resultado es deterministico para el mismo estado/input", async () => {
  const fixedNow = () => new Date("2026-08-24T12:00:00.000Z");
  const { port } = makeFakePort({
    external: okLookup(["1"]),
    prestashopByEmail: okPsLookup(["7421"]),
    prestashopLink: okLookup(["1"])
  });
  const service = createCustomerIdentityResolutionService({ port, now: fixedNow });
  const input = baseInput({ externalId: "56900000114", email: "camila@example.test" });
  const resultA = await service.resolveIdentity(input);
  const resultB = await service.resolveIdentity(input);
  assert.deepEqual(resultA, resultB);
});

test("IDR24: campos no soportados en el input (masterCustomerId/verified inyectados) nunca fuerzan una resolucion", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup([]) });
  const service = createCustomerIdentityResolutionService({ port });
  const forgedInput = {
    ...baseInput({ externalId: "56900000115" }),
    masterCustomerId: "999",
    prestashopCustomerId: "1",
    verified: true
  } as unknown as ResolveCustomerIdentityInput;
  const result = await service.resolveIdentity(forgedInput);
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
});

test("evidence.ts unit: classifyPrestashopCandidates cubre las 8 reglas deterministicas de PARTE 10", () => {
  assert.equal(classifyPrestashopCandidates({ emailInvalid: false, emailQueryFailed: false, orderQueryFailed: false, emailCandidateIds: null, orderCandidateIds: null }).kind, "none");
  assert.equal(classifyPrestashopCandidates({ emailInvalid: true, emailQueryFailed: false, orderQueryFailed: false, emailCandidateIds: null, orderCandidateIds: null }).kind, "invalid_email");
  assert.equal(classifyPrestashopCandidates({ emailInvalid: false, emailQueryFailed: true, orderQueryFailed: false, emailCandidateIds: null, orderCandidateIds: null }).kind, "system_failure");
  assert.equal(classifyPrestashopCandidates({ emailInvalid: false, emailQueryFailed: false, orderQueryFailed: false, emailCandidateIds: [], orderCandidateIds: null }).kind, "not_found");
  assert.equal(classifyPrestashopCandidates({ emailInvalid: false, emailQueryFailed: false, orderQueryFailed: false, emailCandidateIds: ["1", "2"], orderCandidateIds: null }).kind, "ambiguous");
  const converged = classifyPrestashopCandidates({ emailInvalid: false, emailQueryFailed: false, orderQueryFailed: false, emailCandidateIds: ["7421"], orderCandidateIds: ["7421"] });
  assert.deepEqual(converged, { kind: "resolved", prestashopCustomerId: "7421", strength: "verified" });
  assert.equal(classifyPrestashopCandidates({ emailInvalid: false, emailQueryFailed: false, orderQueryFailed: false, emailCandidateIds: ["7421"], orderCandidateIds: ["9832"] }).kind, "cross_source_conflict");
});

test("evidence.ts unit: applyIdentityEvidence nunca produce status identified para un master nuevo", () => {
  const base = { status: "identification_required" as const, customerId: null, matchedBy: null, confidence: "insufficient" as const, conflicts: [] };
  const outcome = applyIdentityEvidence({
    base,
    prestashop: { kind: "resolved", prestashopCustomerId: "7421", strength: "candidate" },
    bridge: { checked: true, ok: true, masterCustomerIds: ["55"] },
    observedAt: "2026-08-24T12:00:00.000Z"
  });
  assert.equal(outcome.detail.status, "NEEDS_VERIFICATION");
  assert.equal(outcome.overrideToConflict, false);
  assert.equal(outcome.overrideToSystemFailure, false);
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

test("integration (regression, ACS-R1-04-T08): a not-yet-resolved external identity row (customer_id NULL) must never count as a match", async () => {
  // resolveOrPersistNativeExternalIdentity (T06.2) persists an unresolved
  // row (customer_id NULL) for a first-contact sender with no match yet.
  // findCustomerByExternalIdentity used to return [String(null)] ("null" as
  // a literal candidate id) for that row, making resolveIdentity report the
  // sender as "identified" with a bogus customerId instead of
  // "identification_required" - discovered while building the T08 E2E
  // suite (new customer scenario), which is the first place this exact
  // sequence (persist unresolved row, then resolve through the real port)
  // is exercised end to end.
  const waId = `56900${uniqueDigits(6)}`;
  await upsertExternalIdentity({
    customerId: null,
    provider: "whatsapp",
    identityType: "phone_number",
    externalId: waId,
    normalizedValue: waId,
    isVerified: false
  });

  const adapter = createLocalCustomerIdentityAdapter();
  const lookup = await adapter.findCustomerByExternalIdentity({ provider: "whatsapp", externalId: waId });
  assert.ok(lookup.ok, lookup.ok ? "" : lookup.error);
  assert.deepEqual(lookup.candidateCustomerIds, []);

  const service = createCustomerIdentityResolutionService();
  const result = await service.resolveIdentity({ channel: "whatsapp", externalId: waId, phoneNumber: waId });
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
});

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

// ---------------------------------------------------------------------------
// ID-R2-A02 integration: the real ps_customer/ps_orders mirror tables
// against the dev DB seed (database/fixtures/legacy-n8n-schema.sql -
// camila.rojas@example.test -> id_customer 1, order REF-1001/INV-1001 ->
// id_customer 1). No customer_external_identity row with provider
// "prestashop" is ever seeded, so the bridge always comes back unlinked
// here (Case D / CANDIDATE) - proving real SQL + row mapping, not the
// evidence combination logic already covered by the fake-port tests above.
// ---------------------------------------------------------------------------

test("IDR03/IDR10 integration: findPrestashopCustomerIdsByEmail y findPrestashopCustomerIdsByOrderReference contra datos reales", async () => {
  const adapter = createLocalCustomerIdentityAdapter();

  const byEmail = await adapter.findPrestashopCustomerIdsByEmail({ normalizedEmail: "camila.rojas@example.test" });
  assert.ok(byEmail.ok, byEmail.ok ? "" : byEmail.error);
  assert.deepEqual(byEmail.candidatePrestashopCustomerIds, ["1"]);

  // Collation is case-insensitive at the DB level, but the service always
  // normalizes to lowercase before querying (see normalizeCustomerEmail).
  const byEmailUpper = await adapter.findPrestashopCustomerIdsByEmail({ normalizedEmail: "CAMILA.ROJAS@EXAMPLE.TEST".toLowerCase() });
  assert.deepEqual(byEmailUpper.ok ? byEmailUpper.candidatePrestashopCustomerIds : [], ["1"]);

  const byMissingEmail = await adapter.findPrestashopCustomerIdsByEmail({ normalizedEmail: `nadie-${Date.now()}@example.test` });
  assert.ok(byMissingEmail.ok);
  assert.deepEqual(byMissingEmail.candidatePrestashopCustomerIds, []);

  const byOrderRef = await adapter.findPrestashopCustomerIdsByOrderReference({ orderReference: "REF-1001" });
  assert.ok(byOrderRef.ok, byOrderRef.ok ? "" : byOrderRef.error);
  assert.deepEqual(byOrderRef.candidatePrestashopCustomerIds, ["1"]);

  const byInvoice = await adapter.findPrestashopCustomerIdsByOrderReference({ orderReference: "INV-1001" });
  assert.ok(byInvoice.ok);
  assert.deepEqual(byInvoice.candidatePrestashopCustomerIds, ["1"]);

  const byMissingOrder = await adapter.findPrestashopCustomerIdsByOrderReference({ orderReference: `MISSING-${Date.now()}` });
  assert.ok(byMissingOrder.ok);
  assert.deepEqual(byMissingOrder.candidatePrestashopCustomerIds, []);
});

test("IDR03 integration: resolveIdentity con email real produce CANDIDATE, nunca auto-link, wa_id/phone sin tocar", async () => {
  const waId = uniqueNormalizedPhone();
  const service = createCustomerIdentityResolutionService();
  const result = await service.resolveIdentity({ channel: "whatsapp", externalId: waId, phoneNumber: null, email: "camila.rojas@example.test" });
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
  assert.equal(result.detail?.status, "CANDIDATE");
  assert.equal(result.detail?.prestashopCustomerId, "1");
  assert.equal(result.detail?.masterCustomerId, null);
});
