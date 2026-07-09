import assert from "node:assert/strict";
import test from "node:test";
import { createCustomerService } from "../../lib/domains/customers/service";
import { createMysqlCustomerRepository } from "../../lib/domains/customers/repository";
import { isPlatformOrigin, parsePlatformOrigin } from "../../lib/domains/customers/platform-origin";
import { validateCreateCustomerPayload } from "../../lib/domains/customers/validation";
import { mapMasterCustomerRow } from "../../lib/integrations/customer-master/mappers";

test("customers list maps repository data into a read model", async () => {
  const service = createCustomerService({
    repository: {
      list: async () => ({
        items: [
          {
            id: "1",
            firstname: "Camila",
            lastname: "Rojas",
            email: "camila@example.com",
            platformOrigin: "hub",
            displayName: "Camila Rojas",
            identityState: "real",
            source: "master_customer",
            lastActivity: null,
            relatedConversations: 0,
            relatedCases: 0,
            ltv: null,
            risk: null
          }
        ],
        pagination: { page: 1, pageSize: 25, total: 1 },
        meta: { mode: "real", source: "master_customer", warnings: [] }
      }),
      getById: async () => ({ customer: null, warnings: [] }),
      findByEmail: async () => ({ customer: null, warnings: [] }),
      create: async () => ({ customer: null, warnings: [] })
    }
  });

  const result = await service.list({ page: 1 });
  assert.equal(result.items[0].displayName, "Camila Rojas");
  assert.equal(result.items[0].platformOrigin, "hub");
  assert.equal(result.meta.source, "master_customer");
});

test("customers repository degrades list and detail reads when master customer queries fail", async () => {
  const repository = createMysqlCustomerRepository({
    listMasterCustomers: async () => ({
      ok: false,
      error: "Access denied for user 'crm_app'@'172.21.0.1' (using password: YES)",
      warnings: []
    }),
    getMasterCustomerById: async () => ({
      ok: false,
      error: "Access denied for user 'crm_app'@'172.21.0.1' (using password: YES)",
      warnings: []
    }),
    findMasterCustomerByEmail: async () => ({
      ok: false,
      error: "Access denied for user 'crm_app'@'172.21.0.1' (using password: YES)",
      warnings: []
    }),
    createMasterCustomer: async () => ({
      ok: false,
      error: "customer_create_failed",
      warnings: []
    })
  });

  const listResult = await repository.list({ page: 2, pageSize: 10 });
  assert.equal(listResult.items.length, 0);
  assert.equal(listResult.pagination.page, 2);
  assert.equal(listResult.pagination.pageSize, 10);
  assert.equal(listResult.pagination.total, 0);
  assert.equal(listResult.meta.mode, "error");
  assert.deepEqual(listResult.meta.warnings, ["Access denied for user 'crm_app'@'172.21.0.1' (using password: YES)"]);

  const detailResult = await repository.getById("10");
  assert.equal(detailResult.customer, null);
  assert.deepEqual(detailResult.warnings, ["Access denied for user 'crm_app'@'172.21.0.1' (using password: YES)"]);
});

test("customers detail returns null when the repository cannot find the row", async () => {
  const service = createCustomerService({
    repository: {
      list: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 25, total: 0 },
        meta: { mode: "real", source: "master_customer", warnings: [] }
      }),
      getById: async () => ({ customer: null, warnings: [] }),
      findByEmail: async () => ({ customer: null, warnings: [] }),
      create: async () => ({ customer: null, warnings: [] })
    }
  });

  const result = await service.getById("999");
  assert.equal(result, null);
});

test("customers detail includes platform origin", async () => {
  const service = createCustomerService({
    repository: {
      list: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 25, total: 0 },
        meta: { mode: "real", source: "master_customer", warnings: [] }
      }),
      getById: async () => ({
        customer: {
          id: "10",
          firstname: "Camila",
          lastname: "Rojas",
          email: "camila@example.com",
          platformOrigin: "whatsapp"
        },
        warnings: ["platform_origin:whatsapp"]
      }),
      findByEmail: async () => ({ customer: null, warnings: [] }),
      create: async () => ({ customer: null, warnings: [] })
    }
  });

  const result = await service.getById("10");
  assert.equal(result?.customer?.platformOrigin, "whatsapp");
  assert.ok(result?.warnings.includes("platform_origin:whatsapp"));
});

test("customers create forwards platformOrigin=hub", async () => {
  let auditPayload: unknown = null;
  let receivedInput: unknown = null;
  const service = createCustomerService({
    writeEnabled: true,
    hasTable: async () => true,
    auditLog: async (input) => {
      auditPayload = input;
    },
    repository: {
      list: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 25, total: 0 },
        meta: { mode: "real", source: "master_customer", warnings: [] }
      }),
      getById: async () => ({ customer: null, warnings: [] }),
      findByEmail: async () => ({ customer: null, warnings: [] }),
      create: async (input) => {
        receivedInput = input;
        return {
          customer: {
            id: "10",
            firstname: input.firstname,
            lastname: input.lastname,
            email: input.email,
            platformOrigin: input.platformOrigin
          },
          warnings: []
        };
      }
    }
  });

  const result = await service.create({ firstname: "Camila", lastname: "Rojas", email: "camila@example.com", platformOrigin: "hub" });
  assert.equal(result.customer.platformOrigin, "hub");
  assert.deepEqual(receivedInput, { firstname: "Camila", lastname: "Rojas", email: "camila@example.com", platformOrigin: "hub" });
  assert.deepEqual((auditPayload as { after?: { changedFields?: string[]; platformOrigin?: string } } | null)?.after?.changedFields, [
    "firstname",
    "lastname",
    "email",
    "platform_origin"
  ]);
  assert.equal((auditPayload as { after?: { platformOrigin?: string } } | null)?.after?.platformOrigin, "hub");
});

test("customers create forwards platformOrigin=whatsapp", async () => {
  let receivedInput: unknown = null;
  const service = createCustomerService({
    writeEnabled: true,
    hasTable: async () => true,
    auditLog: async () => {},
    repository: {
      list: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 25, total: 0 },
        meta: { mode: "real", source: "master_customer", warnings: [] }
      }),
      getById: async () => ({ customer: null, warnings: [] }),
      findByEmail: async () => ({ customer: null, warnings: [] }),
      create: async (input) => {
        receivedInput = input;
        return {
          customer: {
            id: "11",
            firstname: input.firstname,
            lastname: input.lastname,
            email: input.email,
            platformOrigin: input.platformOrigin
          },
          warnings: []
        };
      }
    }
  });

  const result = await service.create({ firstname: "Sofía", lastname: "Pérez", email: "sofia@example.com", platformOrigin: "whatsapp" });
  assert.equal(result.customer.platformOrigin, "whatsapp");
  assert.deepEqual(receivedInput, { firstname: "Sofía", lastname: "Pérez", email: "sofia@example.com", platformOrigin: "whatsapp" });
});

test("customers create fails closed when writes are disabled", async () => {
  let createCalled = false;
  const service = createCustomerService({
    writeEnabled: false,
    repository: {
      list: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 25, total: 0 },
        meta: { mode: "real", source: "master_customer", warnings: [] }
      }),
      getById: async () => ({ customer: null, warnings: [] }),
      findByEmail: async () => ({ customer: null, warnings: [] }),
      create: async () => {
        createCalled = true;
        return {
          customer: {
            id: "10",
            firstname: "Camila",
            lastname: "Rojas",
            email: "camila@example.com",
            platformOrigin: "hub"
          },
          warnings: []
        };
      }
    }
  });

  await assert.rejects(() => service.create({ firstname: "Camila", lastname: "Rojas", email: "camila@example.com", platformOrigin: "hub" }), /DB_WRITE_DISABLED/);
  assert.equal(createCalled, false);
});

test("customers create propagates duplicate email errors", async () => {
  const service = createCustomerService({
    writeEnabled: true,
    hasTable: async () => true,
    auditLog: async () => {},
    repository: {
      list: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 25, total: 0 },
        meta: { mode: "real", source: "master_customer", warnings: [] }
      }),
      getById: async () => ({ customer: null, warnings: [] }),
      findByEmail: async () => ({ customer: null, warnings: [] }),
      create: async () => {
        throw new Error("customer_email_duplicate");
      }
    }
  });

  await assert.rejects(() => service.create({ firstname: "Camila", lastname: "Rojas", email: "camila@example.com", platformOrigin: "hub" }), /customer_email_duplicate/);
});

test("platform origin validator accepts known values", () => {
  assert.equal(isPlatformOrigin("hub"), true);
  assert.equal(isPlatformOrigin("whatsapp"), true);
  assert.equal(isPlatformOrigin("prestashop"), true);
  assert.equal(isPlatformOrigin("unknown"), true);
});

test("platform origin validator rejects invalid values", () => {
  assert.equal(isPlatformOrigin("email"), false);
  assert.equal(isPlatformOrigin(""), false);
  assert.equal(isPlatformOrigin(null), false);
  assert.equal(isPlatformOrigin(undefined), false);
});

test("create payload validation rejects invalid or missing platform origin", () => {
  const invalid = validateCreateCustomerPayload({
    firstname: "Camila",
    lastname: "Rojas",
    email: "camila@example.com",
    platformOrigin: "not_allowed"
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.failure.error, "invalid_platform_origin");
  }

  const missing = validateCreateCustomerPayload({
    firstname: "Camila",
    lastname: "Rojas",
    email: "camila@example.com"
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.failure.error, "platform_origin_required");
  }

  const unknownFields = validateCreateCustomerPayload({
    firstname: "Camila",
    lastname: "Rojas",
    email: "camila@example.com",
    platformOrigin: "hub",
    extra: true
  });
  assert.equal(unknownFields.ok, false);
  if (!unknownFields.ok) {
    assert.equal(unknownFields.failure.error, "unknown_payload_fields");
  }
});

test("master customer mapper normalizes platform origin", () => {
  const nullMapped = mapMasterCustomerRow({
    id: 1,
    firstname: "Camila",
    lastname: "Rojas",
    email: "Camila@example.com",
    platform_origin: null
  });
  assert.equal(nullMapped.customer.platformOrigin, "unknown");
  assert.equal(nullMapped.warnings.length, 0);

  const invalidMapped = mapMasterCustomerRow({
    id: 2,
    firstname: "Sofía",
    lastname: "Pérez",
    email: "Sofia@example.com",
    platform_origin: "legacy_portal"
  });
  assert.equal(invalidMapped.customer.platformOrigin, "unknown");
  assert.deepEqual(invalidMapped.warnings, ["invalid_platform_origin:legacy_portal"]);
});

test("master customer platform origin parser preserves valid values", () => {
  const parsed = parsePlatformOrigin("whatsapp");
  assert.equal(parsed.platformOrigin, "whatsapp");
  assert.equal(parsed.warning, null);
});
