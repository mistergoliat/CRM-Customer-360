import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test, { after } from "node:test";
import { getColumns, getPool, hasTable, queryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { createCustomerOnboardingService } from "@/lib/domains/customer-onboarding/service";
import { createSqlCustomerOnboardingRepository } from "@/lib/domains/customer-onboarding/repository";
import type {
  CustomerOnboardingPendingField,
  CustomerOnboardingState,
  CustomerOnboardingStatus
} from "@/lib/domains/customer-onboarding/types";
import type {
  CustomerOnboardingStoragePort,
  NewOnboardingStateRow,
  OnboardingStateUpdatePatch,
  OnboardingUpdateResult
} from "@/lib/domains/customer-onboarding/ports";

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
// Unit tests: service transitions and normalization against a fake,
// in-memory storage port. No SQL/DB is touched here - the section below
// proves the real SQL repository (migrations/023) behaves the same way.
// ---------------------------------------------------------------------------

function makeFakePort() {
  const rows = new Map<string, CustomerOnboardingState>();
  let nextId = 1;

  const port: CustomerOnboardingStoragePort = {
    async findByConversationId(conversationId: string) {
      return { ok: true, row: rows.get(conversationId) ?? null };
    },

    async insert(input: NewOnboardingStateRow) {
      if (rows.has(input.conversationId)) {
        return { ok: false, reason: "duplicate", error: "onboarding_state_duplicate" };
      }
      const now = new Date().toISOString();
      const row: CustomerOnboardingState = {
        id: nextId++,
        conversationId: input.conversationId,
        opportunityId: input.opportunityId,
        status: input.status,
        purpose: input.purpose,
        collected: input.collected,
        pendingFields: input.pendingFields,
        customerId: input.customerId,
        failedVerificationAttempts: input.failedVerificationAttempts,
        version: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      };
      rows.set(input.conversationId, row);
      return { ok: true, row };
    },

    async updateWithVersion(conversationId: string, expectedVersion: number, patch: OnboardingStateUpdatePatch): Promise<OnboardingUpdateResult> {
      const existing = rows.get(conversationId);
      if (!existing) return { ok: false, reason: "not_found" };
      if (existing.version !== expectedVersion) return { ok: false, reason: "version_conflict" };

      const updated: CustomerOnboardingState = {
        ...existing,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.collected !== undefined ? { collected: patch.collected } : {}),
        ...(patch.pendingFields !== undefined ? { pendingFields: patch.pendingFields } : {}),
        ...(patch.customerId !== undefined ? { customerId: patch.customerId } : {}),
        ...(patch.failedVerificationAttempts !== undefined ? { failedVerificationAttempts: patch.failedVerificationAttempts } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        version: existing.version + 1,
        updatedAt: new Date().toISOString()
      };
      rows.set(conversationId, updated);
      return { ok: true, row: updated };
    }
  };

  return { port, rows };
}

function uniqueConversationId(label: string) {
  return `conv-${label}-${Date.now()}-${randomInt(0, 1_000_000)}`;
}

async function requireStatus(
  service: ReturnType<typeof createCustomerOnboardingService>,
  conversationId: string,
  status: CustomerOnboardingStatus
) {
  const state = await service.getState(conversationId);
  assert.ok(state);
  assert.equal(state?.status, status);
  return state as CustomerOnboardingState;
}

test("unit 1: ausencia de fila devuelve null", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const state = await service.getState(uniqueConversationId("absent"));
  assert.equal(state, null);
});

test("unit 2: startOnboarding inicia el onboarding en required", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("start");

  const result = await service.startOnboarding({
    conversationId,
    opportunityId: null,
    purpose: "quote",
    pendingFields: ["firstName", "email"]
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.status, "created");
  assert.equal(result.ok && result.state.status, "required");
  assert.equal(result.ok && result.state.purpose, "quote");
  assert.equal(result.ok && result.state.version, 1);
  assert.deepEqual(result.ok ? result.state.pendingFields : null, ["firstName", "email"]);
});

test("unit 3: inicio repetido con el mismo proposito es idempotente", async () => {
  const { port, rows } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("idempotent-start");

  const first = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  const second = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["orderReference"] });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.status, "unchanged");
  assert.equal(first.ok && second.ok && first.state.id === second.state.id, true);
  // Second call must not have altered the row (still the first pendingFields).
  assert.deepEqual(second.ok ? second.state.pendingFields : null, ["email"]);
  assert.equal(rows.size, 1);
});

test("unit 4: reload conserva el estado persistido", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("reload");

  await service.startOnboarding({ conversationId, purpose: "order_inquiry", pendingFields: ["orderReference"] });

  // Simulate a new process/turn reading state fresh.
  const reloadedService = createCustomerOnboardingService({ port });
  const state = await reloadedService.getState(conversationId);
  assert.ok(state);
  assert.equal(state?.purpose, "order_inquiry");
  assert.equal(state?.status, "required");
});

test("unit 5: collectFields actualiza los campos recopilados", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("collect");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["firstName", "email"] });
  assert.equal(started.ok, true);
  const version = started.ok ? started.state.version : 0;

  const collected = await service.collectFields({
    conversationId,
    expectedVersion: version,
    collectedPatch: { firstName: "Ana" },
    pendingFields: ["email"]
  });

  assert.equal(collected.ok, true);
  assert.equal(collected.ok && collected.state.status, "collecting");
  assert.equal(collected.ok && collected.state.collected.firstName, "Ana");
  assert.deepEqual(collected.ok ? collected.state.pendingFields : null, ["email"]);
});

test("unit 6: normaliza el email a trim + lowercase", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("email-normalize");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  const version = started.ok ? started.state.version : 0;

  const collected = await service.collectFields({
    conversationId,
    expectedVersion: version,
    collectedPatch: { email: "  Foo@Example.COM  " },
    pendingFields: []
  });

  assert.equal(collected.ok, true);
  assert.equal(collected.ok && collected.state.collected.email, "foo@example.com");
});

test("unit 7: rechaza claves no permitidas en collectedPatch", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("unknown-key");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["firstName"] });
  const version = started.ok ? started.state.version : 0;

  const result = await service.collectFields({
    conversationId,
    expectedVersion: version,
    collectedPatch: { firstName: "Ana", notAllowed: "x" } as unknown as Record<string, unknown>,
    pendingFields: []
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, "invalid_input");

  const state = await service.getState(conversationId);
  assert.equal(state?.collected.firstName, undefined);
  assert.equal(state?.version, version);
});

test("unit 8: deduplica y ordena pendingFields deterministicamente", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("dedup-pending");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  const version = started.ok ? started.state.version : 0;

  const collected = await service.collectFields({
    conversationId,
    expectedVersion: version,
    collectedPatch: {},
    pendingFields: ["email", "email", "firstName", "email", "lastName"]
  });

  assert.equal(collected.ok, true);
  // Canonical order is firstName, lastName, email, orderReference.
  assert.deepEqual(collected.ok ? collected.state.pendingFields : null, ["firstName", "lastName", "email"]);
});

test("unit 9: transicion valida required -> collecting", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("required-to-collecting");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  await requireStatus(service, conversationId, "required");
  const version = started.ok ? started.state.version : 0;

  const collected = await service.collectFields({ conversationId, expectedVersion: version, collectedPatch: { email: "a@b.cl" }, pendingFields: [] });
  assert.equal(collected.ok, true);
  await requireStatus(service, conversationId, "collecting");
});

test("unit 10: transicion valida collecting -> resolving", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("collecting-to-resolving");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  const v1 = started.ok ? started.state.version : 0;
  const collected = await service.collectFields({ conversationId, expectedVersion: v1, collectedPatch: { email: "a@b.cl" }, pendingFields: [] });
  const v2 = collected.ok ? collected.state.version : 0;

  const resolving = await service.markResolving({ conversationId, expectedVersion: v2 });
  assert.equal(resolving.ok, true);
  await requireStatus(service, conversationId, "resolving");
});

test("unit 11: transicion invalida es rechazada", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("invalid-transition");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  const version = started.ok ? started.state.version : 0;

  // completeOnboarding is only legal from "resolving"; the state is still "required".
  const result = await service.completeOnboarding({ conversationId, expectedVersion: version, customerId: "cust-1" });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, "invalid_transition");
  await requireStatus(service, conversationId, "required");
});

async function driveToResolving(
  service: ReturnType<typeof createCustomerOnboardingService>,
  conversationId: string,
  pendingFields: CustomerOnboardingPendingField[] = ["email"]
) {
  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields });
  const v1 = started.ok ? started.state.version : 0;
  const collected = await service.collectFields({ conversationId, expectedVersion: v1, collectedPatch: { email: "a@b.cl" }, pendingFields: [] });
  const v2 = collected.ok ? collected.state.version : 0;
  const resolving = await service.markResolving({ conversationId, expectedVersion: v2 });
  const v3 = resolving.ok ? resolving.state.version : 0;
  return v3;
}

test("unit 12: completed exige customerId", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("complete-needs-customer");
  const version = await driveToResolving(service, conversationId);

  const result = await service.completeOnboarding({ conversationId, expectedVersion: version, customerId: "  " });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, "invalid_input");
  await requireStatus(service, conversationId, "resolving");
});

test("unit 13: completed exige pendingFields vacio", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("complete-empty-pending");
  // Drive to resolving while pendingFields is still non-empty (markResolving
  // does not require pendingFields to be empty by itself).
  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email", "firstName"] });
  const v1 = started.ok ? started.state.version : 0;
  const resolving = await service.markResolving({ conversationId, expectedVersion: v1 });
  const v2 = resolving.ok ? resolving.state.version : 0;
  assert.notDeepEqual(resolving.ok ? resolving.state.pendingFields : null, []);

  const completed = await service.completeOnboarding({ conversationId, expectedVersion: v2, customerId: "cust-42" });
  assert.equal(completed.ok, true);
  assert.deepEqual(completed.ok ? completed.state.pendingFields : null, []);
  assert.equal(completed.ok ? completed.state.customerId : null, "cust-42");
  assert.ok(completed.ok && completed.state.completedAt);
});

test("unit 14: conflict limpia customerId", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("conflict-clears-customer");
  const version = await driveToResolving(service, conversationId);

  const conflict = await service.markConflict({ conversationId, expectedVersion: version });
  assert.equal(conflict.ok, true);
  assert.equal(conflict.ok && conflict.state.status, "conflict");
  assert.equal(conflict.ok && conflict.state.customerId, null);
});

test("unit 15: temporarily_unavailable no se interpreta como cliente nuevo", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("unavailable-not-new-customer");
  const version = await driveToResolving(service, conversationId);

  const unavailable = await service.markTemporarilyUnavailable({ conversationId, expectedVersion: version });
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.ok && unavailable.state.status, "temporarily_unavailable");
  assert.equal(unavailable.ok && unavailable.state.customerId, null);
  assert.equal(unavailable.ok && unavailable.state.completedAt, null);
  assert.equal(unavailable.ok && unavailable.state.failedVerificationAttempts, 0);
});

test("unit 16: primer fallo de verificacion incrementa a 1", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("first-failure");
  const version = await driveToResolving(service, conversationId);

  const failed = await service.recordVerificationFailure({ conversationId, expectedVersion: version });
  assert.equal(failed.ok, true);
  assert.equal(failed.ok && failed.state.failedVerificationAttempts, 1);
  assert.equal(failed.ok && failed.state.status, "resolving");
});

test("unit 17: tercer fallo cambia a temporarily_blocked", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("third-failure");
  let version = await driveToResolving(service, conversationId);

  const first = await service.recordVerificationFailure({ conversationId, expectedVersion: version });
  assert.equal(first.ok, true);
  version = first.ok ? first.state.version : 0;

  const second = await service.recordVerificationFailure({ conversationId, expectedVersion: version });
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.state.status, "resolving");
  version = second.ok ? second.state.version : 0;

  const third = await service.recordVerificationFailure({ conversationId, expectedVersion: version });
  assert.equal(third.ok, true);
  assert.equal(third.ok && third.state.failedVerificationAttempts, 3);
  assert.equal(third.ok && third.state.status, "temporarily_blocked");
});

test("unit 18: optimistic locking rechaza version obsoleta", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("stale-version");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  const staleVersion = started.ok ? started.state.version : 0;

  // A concurrent writer advances the version first.
  await service.collectFields({ conversationId, expectedVersion: staleVersion, collectedPatch: { email: "a@b.cl" }, pendingFields: [] });

  const stale = await service.collectFields({
    conversationId,
    expectedVersion: staleVersion,
    collectedPatch: { firstName: "Ana" },
    pendingFields: []
  });

  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.status, "onboarding_state_version_conflict");
});

test("unit 19: dos conversaciones no mezclan estados", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationA = uniqueConversationId("isolation-a");
  const conversationB = uniqueConversationId("isolation-b");

  await service.startOnboarding({ conversationId: conversationA, purpose: "quote", pendingFields: ["email"] });
  await service.startOnboarding({ conversationId: conversationB, purpose: "complaint", pendingFields: ["orderReference"] });

  const stateA = await service.getState(conversationA);
  const stateB = await service.getState(conversationB);
  assert.equal(stateA?.purpose, "quote");
  assert.equal(stateB?.purpose, "complaint");
  assert.notEqual(stateA?.id, stateB?.id);
});

test("unit 20: completed es idempotente para el mismo customerId", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("complete-idempotent-same");
  const version = await driveToResolving(service, conversationId);

  const first = await service.completeOnboarding({ conversationId, expectedVersion: version, customerId: "cust-7" });
  assert.equal(first.ok, true);

  const second = await service.completeOnboarding({ conversationId, expectedVersion: version, customerId: "cust-7" });
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.status, "unchanged");
  assert.equal(second.ok && second.state.customerId, "cust-7");
});

test("unit 21: completed rechaza otro customerId", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("complete-rejects-other");
  const version = await driveToResolving(service, conversationId);

  const first = await service.completeOnboarding({ conversationId, expectedVersion: version, customerId: "cust-7" });
  assert.equal(first.ok, true);

  const second = await service.completeOnboarding({ conversationId, expectedVersion: version, customerId: "cust-8" });
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.status, "customer_conflict");

  const state = await service.getState(conversationId);
  assert.equal(state?.customerId, "cust-7");
});

test("unit 22: no persiste datos arbitrarios", async () => {
  const { port } = makeFakePort();
  const service = createCustomerOnboardingService({ port });
  const conversationId = uniqueConversationId("no-arbitrary-data");

  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["firstName"] });
  const version = started.ok ? started.state.version : 0;

  const result = await service.collectFields({
    conversationId,
    expectedVersion: version,
    collectedPatch: { firstName: "Ana", message: "hola, cotizame esto", rawPrompt: "system prompt leak" } as unknown as Record<string, unknown>,
    pendingFields: []
  });

  assert.equal(result.ok, false);
  const state = await service.getState(conversationId);
  assert.deepEqual(Object.keys(state?.collected ?? {}), []);
  const allowedKeys = new Set(["firstName", "lastName", "email", "orderReference"]);
  for (const key of Object.keys(state?.collected ?? {})) {
    assert.ok(allowedKeys.has(key));
  }
});

// ---------------------------------------------------------------------------
// Integration tests: the real SQL repository (migrations/023) and the
// default service (createCustomerOnboardingService() with no port override)
// against the dev DB. Fakes above prove the transition table; these prove
// the actual SQL, optimistic locking and foreign keys.
// ---------------------------------------------------------------------------

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${randomInt(0, 1_000_000)}`;
}

async function makeConversationId(label: string): Promise<string> {
  const accountId = `acct-${uniqueSuffix(label)}`;
  const contactId = `contact-${uniqueSuffix(label)}`;
  await queryRows(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id) VALUES (UUID(), 'whatsapp', 'meta', ?, ?)`,
    [accountId, contactId]
  );
  const rows = await queryRows<{ id: number }>(
    `SELECT id FROM conversation WHERE channel_account_id = ? AND external_contact_id = ? LIMIT 1`,
    [accountId, contactId]
  );
  return String(rows[0].id);
}

async function makeOpportunityId(label: string): Promise<string> {
  const key = uniqueSuffix(label);
  await queryRows(
    `INSERT INTO crm_opportunities (opportunity_key, requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json)
     VALUES (?, '{}', '[]', '[]', '[]', '[]')`,
    [key]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1`, [key]);
  return String(rows[0].id);
}

async function makeCustomerId(label: string): Promise<string> {
  const result = await createMasterCustomer({
    firstname: "OnboardingT03",
    lastname: label,
    email: `onboarding-t03-${label}-${Date.now()}-${randomInt(0, 100000)}@local.invalid`,
    platformOrigin: "whatsapp"
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return String(result.data.id);
}

async function legacyOnboardingRowCount(): Promise<number> {
  const rows = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM crm_customer_onboarding`);
  return Number(rows[0]?.total ?? 0);
}

test("integration 1: la migracion 023 crea crm_customer_onboarding_state con las columnas del contrato", async () => {
  const exists = await hasTable("crm_customer_onboarding_state");
  assert.equal(exists, true);

  const columns = await getColumns("crm_customer_onboarding_state");
  for (const expected of [
    "id",
    "conversation_id",
    "opportunity_id",
    "status",
    "purpose",
    "collected_json",
    "pending_fields_json",
    "customer_id",
    "failed_verification_attempts",
    "version",
    "created_at",
    "updated_at",
    "completed_at"
  ]) {
    assert.ok(columns.includes(expected), `missing column ${expected}`);
  }
});

test("integration 2: create + reload contra la base real", async () => {
  const conversationId = await makeConversationId("create-reload");
  const service = createCustomerOnboardingService();

  const created = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["firstName", "email"] });
  assert.equal(created.ok, true);

  const reloadedService = createCustomerOnboardingService();
  const reloaded = await reloadedService.getState(conversationId);
  assert.ok(reloaded);
  assert.equal(reloaded?.conversationId, conversationId);
  assert.equal(reloaded?.status, "required");
  assert.equal(reloaded?.purpose, "quote");
  assert.deepEqual(reloaded?.pendingFields, ["firstName", "email"]);
});

test("integration 3: update incrementa version en la fila real", async () => {
  const conversationId = await makeConversationId("version-increment");
  const service = createCustomerOnboardingService();
  const created = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  assert.equal(created.ok, true);
  const v1 = created.ok ? created.state.version : 0;
  assert.equal(v1, 1);

  const updated = await service.collectFields({ conversationId, expectedVersion: v1, collectedPatch: { email: "real@db.cl" }, pendingFields: [] });
  assert.equal(updated.ok, true);
  assert.equal(updated.ok ? updated.state.version : 0, 2);

  const rows = await queryRows<{ version: number; collected_json: unknown }>(
    `SELECT version, collected_json FROM crm_customer_onboarding_state WHERE conversation_id = ?`,
    [conversationId]
  );
  assert.equal(Number(rows[0].version), 2);
});

test("integration 4: version obsoleta no sobreescribe la fila real", async () => {
  const conversationId = await makeConversationId("stale-no-overwrite");
  const service = createCustomerOnboardingService();
  const created = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: ["email"] });
  const v1 = created.ok ? created.state.version : 0;

  await service.collectFields({ conversationId, expectedVersion: v1, collectedPatch: { email: "first@db.cl" }, pendingFields: [] });

  const stale = await service.collectFields({ conversationId, expectedVersion: v1, collectedPatch: { email: "stale@db.cl" }, pendingFields: [] });
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.status, "onboarding_state_version_conflict");

  const rows = await queryRows<{ version: number; collected_json: string }>(
    `SELECT version, collected_json FROM crm_customer_onboarding_state WHERE conversation_id = ?`,
    [conversationId]
  );
  assert.equal(Number(rows[0].version), 2);
  const collected = typeof rows[0].collected_json === "string" ? JSON.parse(rows[0].collected_json) : rows[0].collected_json;
  assert.equal((collected as { email?: string }).email, "first@db.cl");
});

test("integration 5: conversation_id es unico a nivel de base de datos", async () => {
  const conversationId = await makeConversationId("unique-conversation");
  const repository = createSqlCustomerOnboardingRepository();

  const first = await repository.insert({
    conversationId,
    opportunityId: null,
    status: "required",
    purpose: "quote",
    collected: {},
    pendingFields: [],
    customerId: null,
    failedVerificationAttempts: 0
  });
  assert.equal(first.ok, true);

  const second = await repository.insert({
    conversationId,
    opportunityId: null,
    status: "required",
    purpose: "purchase",
    collected: {},
    pendingFields: [],
    customerId: null,
    failedVerificationAttempts: 0
  });
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.reason, "duplicate");

  const rows = await queryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM crm_customer_onboarding_state WHERE conversation_id = ?`,
    [conversationId]
  );
  assert.equal(Number(rows[0].total), 1);
});

test("integration 6: aislamiento entre conversaciones en la tabla real", async () => {
  const conversationA = await makeConversationId("isolation-real-a");
  const conversationB = await makeConversationId("isolation-real-b");
  const service = createCustomerOnboardingService();

  await service.startOnboarding({ conversationId: conversationA, purpose: "quote", pendingFields: ["email"] });
  await service.startOnboarding({ conversationId: conversationB, purpose: "warranty", pendingFields: ["orderReference"] });

  const stateA = await service.getState(conversationA);
  const stateB = await service.getState(conversationB);
  assert.equal(stateA?.purpose, "quote");
  assert.equal(stateB?.purpose, "warranty");
  assert.notEqual(stateA?.conversationId, stateB?.conversationId);
});

test("integration 7: failedVerificationAttempts se incrementa atomicamente en la fila real", async () => {
  const conversationId = await makeConversationId("verification-attempts");
  const service = createCustomerOnboardingService();

  const created = await service.startOnboarding({ conversationId, purpose: "order_inquiry", pendingFields: ["orderReference"] });
  let version = created.ok ? created.state.version : 0;
  const collected = await service.collectFields({ conversationId, expectedVersion: version, collectedPatch: { orderReference: "OC-1" }, pendingFields: [] });
  version = collected.ok ? collected.state.version : 0;
  const resolving = await service.markResolving({ conversationId, expectedVersion: version });
  version = resolving.ok ? resolving.state.version : 0;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const failed = await service.recordVerificationFailure({ conversationId, expectedVersion: version });
    assert.equal(failed.ok, true);
    version = failed.ok ? failed.state.version : 0;
  }

  const rows = await queryRows<{ failed_verification_attempts: number; status: string }>(
    `SELECT failed_verification_attempts, status FROM crm_customer_onboarding_state WHERE conversation_id = ?`,
    [conversationId]
  );
  assert.equal(Number(rows[0].failed_verification_attempts), 3);
  assert.equal(rows[0].status, "temporarily_blocked");
});

test("integration 8: ninguna escritura ocurre en la tabla legacy crm_customer_onboarding", async () => {
  const legacyAvailable = await hasTable("crm_customer_onboarding");
  if (!legacyAvailable) return;

  const before = await legacyOnboardingRowCount();

  const conversationId = await makeConversationId("legacy-untouched");
  const service = createCustomerOnboardingService();
  const created = await service.startOnboarding({ conversationId, purpose: "complaint", pendingFields: ["orderReference"] });
  const v1 = created.ok ? created.state.version : 0;
  const collected = await service.collectFields({ conversationId, expectedVersion: v1, collectedPatch: { orderReference: "OC-2" }, pendingFields: [] });
  const v2 = collected.ok ? collected.state.version : 0;
  await service.markResolving({ conversationId, expectedVersion: v2 });

  const after = await legacyOnboardingRowCount();
  assert.equal(after, before);
});

test("integration 9: foreign keys son validas cuando existen las entidades relacionadas", async () => {
  const conversationId = await makeConversationId("fk-valid");
  const opportunityId = await makeOpportunityId("fk-valid");
  const customerId = await makeCustomerId("FkValid");
  const service = createCustomerOnboardingService();

  const created = await service.startOnboarding({ conversationId, opportunityId, purpose: "purchase", pendingFields: ["email"] });
  assert.equal(created.ok, true);
  let version = created.ok ? created.state.version : 0;

  const collected = await service.collectFields({ conversationId, expectedVersion: version, collectedPatch: { email: "fk@db.cl" }, pendingFields: [] });
  version = collected.ok ? collected.state.version : 0;
  const resolving = await service.markResolving({ conversationId, expectedVersion: version });
  version = resolving.ok ? resolving.state.version : 0;
  const completed = await service.completeOnboarding({ conversationId, expectedVersion: version, customerId });
  assert.equal(completed.ok, true);

  const joined = await queryRows<{ opportunity_key: string; customer_email: string }>(
    `SELECT o.opportunity_key AS opportunity_key, mc.email AS customer_email
     FROM crm_customer_onboarding_state s
     JOIN crm_opportunities o ON o.id = s.opportunity_id
     JOIN master_customer mc ON mc.id = s.customer_id
     WHERE s.conversation_id = ?`,
    [conversationId]
  );
  assert.equal(joined.length, 1);
  assert.ok(joined[0].opportunity_key);
  assert.ok(joined[0].customer_email);

  // The FK is enforced, not decorative: a nonexistent opportunity_id must fail at the DB level.
  const otherConversationId = await makeConversationId("fk-invalid");
  const repository = createSqlCustomerOnboardingRepository();
  const invalid = await repository.insert({
    conversationId: otherConversationId,
    opportunityId: "999999999",
    status: "required",
    purpose: "purchase",
    collected: {},
    pendingFields: [],
    customerId: null,
    failedVerificationAttempts: 0
  });
  assert.equal(invalid.ok, false);
});
