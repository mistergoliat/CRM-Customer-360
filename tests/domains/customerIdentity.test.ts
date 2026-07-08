import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createCustomerIdentityResolutionService,
  createLocalCustomerIdentityAdapter,
  type CustomerIdentityLookupResult,
  type CustomerIdentityPort,
  type ResolveCustomerIdentityInput
} from "../../lib/domains/customer-identity";

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
    phone: [] as Array<{ provider: string; normalizedPhone: string }>
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

test("1. wa_id unico resuelve customer", async () => {
  const { port } = makeFakePort({ external: okLookup(["1"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput());
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, "1");
  assert.equal(result.matchedBy, "external_identity");
  assert.equal(result.confidence, "verified");
  assert.deepEqual(result.conflicts, []);
});

test("2. wa_id y telefono apuntan al mismo customer", async () => {
  const { port } = makeFakePort({ external: okLookup(["1"]), phone: okLookup(["1"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ phoneNumber: "912345678" }));
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, "1");
  assert.equal(result.matchedBy, "external_identity");
  assert.equal(result.confidence, "verified");
});

test("3. telefono unico sin vinculo previo resuelve con confianza strong", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup(["7"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000000", phoneNumber: "912345678" }));
  assert.equal(result.status, "identified");
  assert.equal(result.customerId, "7");
  assert.equal(result.matchedBy, "phone");
  assert.equal(result.confidence, "strong");
});

test("4. wa_id y telefono apuntan a customers distintos produce conflict", async () => {
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

test("5. telefono apunta a multiples customers produce conflict", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup(["2", "3"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000001", phoneNumber: "933333333" }));
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  assert.equal(result.conflicts[0].type, "phone_ambiguous");
  assert.deepEqual([...result.conflicts[0].candidateCustomerIds].sort(), ["2", "3"]);
});

test("6. ninguna coincidencia produce identification_required", async () => {
  const { port } = makeFakePort({ external: okLookup([]), phone: okLookup([]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000002" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
  assert.equal(result.confidence, "insufficient");
});

test("7. fallo de fuente produce temporarily_unavailable, nunca identification_required ni cliente nuevo", async () => {
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

test("8. input invalido no se interpreta como cliente nuevo", async () => {
  const { port, calls } = makeFakePort({});
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "" }));
  assert.equal(result.status, "identification_required");
  assert.equal(result.customerId, null);
  assert.ok(result.warnings.includes("invalid_external_id"));
  assert.equal(calls.external.length, 0);
  assert.equal(calls.phone.length, 0);
});

test("9. customer A nunca recibe informacion de customer B en un conflicto", async () => {
  const { port } = makeFakePort({ external: okLookup(["A"]), phone: okLookup(["B"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ phoneNumber: "922222222" }));
  assert.equal(result.status, "conflict");
  assert.equal(result.customerId, null);
  const conflict = result.conflicts[0] as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(conflict).sort(), ["candidateCustomerIds", "type"]);
  assert.deepEqual([...(conflict.candidateCustomerIds as string[])].sort(), ["A", "B"]);
});

test("10. resolver no ejecuta INSERT, UPDATE, DELETE ni vinculacion - el port es de solo lectura", () => {
  const adapter = createLocalCustomerIdentityAdapter();
  assert.deepEqual(Object.keys(adapter).sort(), ["findCustomerByExternalIdentity", "findCustomersByNormalizedPhone"]);

  const adapterSource = readFileSync(join(__dirname, "../../lib/domains/customer-identity/local-adapter.ts"), "utf8");
  assert.equal(/\b(INSERT|UPDATE|DELETE|upsert|createMasterCustomer|linkExternalIdentity)\b/i.test(adapterSource), false);
});

test("11. telefono se maneja como string normalizado antes de consultar", async () => {
  const { port, calls } = makeFakePort({ external: okLookup([]), phone: okLookup(["9"]) });
  const service = createCustomerIdentityResolutionService({ port });
  const result = await service.resolveIdentity(baseInput({ externalId: "56900000004", phoneNumber: "9 1234 5678" }));
  assert.equal(result.status, "identified");
  assert.equal(calls.phone.length, 1);
  assert.equal(calls.phone[0].normalizedPhone, "56912345678");
  assert.equal(typeof calls.phone[0].normalizedPhone, "string");
});

test("12. no existe dependencia de tablas n8n_* en el modulo de identidad", () => {
  const dir = join(__dirname, "../../lib/domains/customer-identity");
  for (const file of ["types.ts", "ports.ts", "local-adapter.ts", "service.ts", "index.ts"]) {
    const source = readFileSync(join(dir, file), "utf8");
    assert.equal(/n8n_/i.test(source), false, `${file} must not reference n8n_* tables`);
  }
});
