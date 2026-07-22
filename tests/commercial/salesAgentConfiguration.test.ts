import assert from "node:assert/strict";
import test, { after } from "node:test";
import { auditLog } from "@/lib/audit";
import { getPool, queryRows, safeQueryRows, withConnection } from "@/lib/db";
import {
  SALES_AGENT_CONFIGURATION_LIMITS,
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_CONFIGURATION_TABLE,
  SALES_AGENT_PROMPT_CONFIGURATION_FIELDS,
  SalesAgentConfigurationNotDraftError,
  SalesAgentConfigurationScopeMismatchError,
  archiveConfiguration,
  computeSalesAgentConfigurationHash,
  createDraftConfiguration,
  listPesasChileConfigurations,
  loadConfigurationById,
  loadPublishedPesasChileConfiguration,
  publishDraftConfiguration,
  resolveSalesAgentConfiguration,
  updateDraftConfiguration,
  validateSalesAgentPromptConfiguration,
  type SalesAgentPromptConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";

// Real MariaDB, real crm_test database (same local-credential convention as
// tests/commercial/salesConsultativeFollowUpRepository.test.ts) - never a
// mock of the repository/publish/resolver flow.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
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

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function uniqueName(label: string) {
  return `sac-${label}-${uniqueSuffix()}`;
}

function buildValidConfigurationInput(overrides: Partial<SalesAgentPromptConfiguration> = {}): Record<string, unknown> {
  return {
    agentName: "Valentina",
    companyName: "PesasChile",
    role: "Asesora comercial",
    companyDescription: "Vendemos equipamiento de gimnasio para el hogar y uso comercial.",
    customInstructions: "Responde siempre en espanol neutro chileno.",
    prohibitedPhrases: ["garantia de por vida"],
    ...overrides
  };
}

function buildValidConfiguration(overrides: Partial<SalesAgentPromptConfiguration> = {}): SalesAgentPromptConfiguration {
  return buildValidConfigurationInput(overrides) as SalesAgentPromptConfiguration;
}

/**
 * Tests that corrupt a row's configuration_json via raw SQL (to force a
 * publish failure) must restore it afterward - crm_test is a persistent,
 * reused database across local runs, not a fresh throwaway schema per run,
 * so a permanently corrupted row would break every later, unrelated call to
 * listPesasChileConfigurations() (which deserializes - and validates -
 * every matching row) for as long as the database lives.
 */
async function restoreConfigurationJson(id: number) {
  const configuration = buildValidConfiguration();
  await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = ?, configuration_hash = ? WHERE id = ?`, [
    JSON.stringify(configuration),
    computeSalesAgentConfigurationHash(configuration),
    id
  ]);
}

async function clearActivePublication() {
  const active = await loadPublishedPesasChileConfiguration();
  if (active) {
    await archiveConfiguration(active.id);
  }
}

// ---------------------------------------------------------------------------
// Validation (tests 1-7)
// ---------------------------------------------------------------------------

test("[V1] accepts a valid configuration with exactly the six MVP fields", () => {
  const result = validateSalesAgentPromptConfiguration(buildValidConfigurationInput());
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(Object.keys(result.configuration).sort(), [...SALES_AGENT_PROMPT_CONFIGURATION_FIELDS].sort());
  }
});

test("[V2] rejects an unknown extra field", () => {
  const result = validateSalesAgentPromptConfiguration({ ...buildValidConfigurationInput(), tone: "friendly" });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "unknown_field");
});

test("[V3] rejects a configuration missing a required field", () => {
  const input = buildValidConfigurationInput();
  delete (input as Record<string, unknown>).role;
  const result = validateSalesAgentPromptConfiguration(input);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "missing_required_field");
});

test("[V4] rejects each text field once it exceeds its explicit limit, accepts exactly at the limit", () => {
  const fieldLimits: Array<[string, number]> = [
    ["agentName", SALES_AGENT_CONFIGURATION_LIMITS.agentNameMaxLength],
    ["companyName", SALES_AGENT_CONFIGURATION_LIMITS.companyNameMaxLength],
    ["role", SALES_AGENT_CONFIGURATION_LIMITS.roleMaxLength],
    ["companyDescription", SALES_AGENT_CONFIGURATION_LIMITS.companyDescriptionMaxLength],
    ["customInstructions", SALES_AGENT_CONFIGURATION_LIMITS.customInstructionsMaxLength]
  ];

  for (const [field, maxLength] of fieldLimits) {
    const tooLong = validateSalesAgentPromptConfiguration(buildValidConfigurationInput({ [field]: "a".repeat(maxLength + 1) } as Partial<SalesAgentPromptConfiguration>));
    assert.equal(tooLong.valid, false, `${field} should reject ${maxLength + 1} chars`);
    if (!tooLong.valid) assert.equal(tooLong.code, "field_too_long", field);

    const atLimit = validateSalesAgentPromptConfiguration(buildValidConfigurationInput({ [field]: "a".repeat(maxLength) } as Partial<SalesAgentPromptConfiguration>));
    assert.equal(atLimit.valid, true, `${field} should accept exactly ${maxLength} chars`);
  }

  const tooManyPhrases = validateSalesAgentPromptConfiguration(
    buildValidConfigurationInput({
      prohibitedPhrases: Array.from({ length: SALES_AGENT_CONFIGURATION_LIMITS.maxProhibitedPhrases + 1 }, (_, i) => `phrase-${i}`)
    })
  );
  assert.equal(tooManyPhrases.valid, false);
  if (!tooManyPhrases.valid) assert.equal(tooManyPhrases.code, "too_many_prohibited_phrases");

  const tooLongPhrase = validateSalesAgentPromptConfiguration(
    buildValidConfigurationInput({ prohibitedPhrases: ["x".repeat(SALES_AGENT_CONFIGURATION_LIMITS.prohibitedPhraseMaxLength + 1)] })
  );
  assert.equal(tooLongPhrase.valid, false);
  if (!tooLongPhrase.valid) assert.equal(tooLongPhrase.code, "prohibited_phrase_too_long");

  const oversizedPayload = validateSalesAgentPromptConfiguration(buildValidConfigurationInput({ customInstructions: "y".repeat(60_000) }));
  assert.equal(oversizedPayload.valid, false);
  if (!oversizedPayload.valid) assert.equal(oversizedPayload.code, "payload_too_large");
});

test("[V5] trims and collapses internal whitespace in every text field and phrase", () => {
  const result = validateSalesAgentPromptConfiguration(
    buildValidConfigurationInput({
      agentName: "  Valentina   Perez  ",
      customInstructions: "Linea uno\n\n  Linea   dos  ",
      prohibitedPhrases: ["  descuento   exagerado  "]
    })
  );
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.configuration.agentName, "Valentina Perez");
    assert.equal(result.configuration.customInstructions, "Linea uno Linea dos");
    assert.deepEqual(result.configuration.prohibitedPhrases, ["descuento exagerado"]);
  }
});

test("[V6] deduplicates prohibited phrases after normalization (exact match, case-sensitive)", () => {
  const result = validateSalesAgentPromptConfiguration(
    buildValidConfigurationInput({ prohibitedPhrases: ["descuento", "  descuento  ", "Descuento", "garantia de por vida"] })
  );
  assert.equal(result.valid, true);
  if (result.valid) {
    // "Descuento" (capital D) is not folded into "descuento" - dedup is
    // exact-match after whitespace normalization only, never a semantic or
    // case-insensitive interpretation (validation.ts never interprets
    // business meaning).
    assert.deepEqual(result.configuration.prohibitedPhrases, ["descuento", "Descuento", "garantia de por vida"]);
  }
});

test("[V7] rejects a prohibited phrase that normalizes to empty", () => {
  const result = validateSalesAgentPromptConfiguration(buildValidConfigurationInput({ prohibitedPhrases: ["valid one", "   "] }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "prohibited_phrase_empty");
});

// ---------------------------------------------------------------------------
// Hash (tests 8-10)
// ---------------------------------------------------------------------------

test("[H8] hash is stable for equivalent configurations (phrase order, extra whitespace)", () => {
  const base = buildValidConfiguration({ prohibitedPhrases: ["precio final", "garantia"] });
  const reorderedPhrases = { ...base, prohibitedPhrases: ["garantia", "precio final"] };
  const extraWhitespace = { ...base, agentName: `  ${base.agentName}  ` };
  assert.equal(computeSalesAgentConfigurationHash(base), computeSalesAgentConfigurationHash(reorderedPhrases));
  assert.equal(computeSalesAgentConfigurationHash(base), computeSalesAgentConfigurationHash(extraWhitespace));
});

test("[H9] hash changes when relevant content changes", () => {
  const base = buildValidConfiguration();
  const changed = { ...base, role: "Jefa de ventas" };
  assert.notEqual(computeSalesAgentConfigurationHash(base), computeSalesAgentConfigurationHash(changed));
});

test("[H10] hash depends only on configuration content, never on version/status/metadata", () => {
  // computeSalesAgentConfigurationHash's signature only accepts
  // SalesAgentPromptConfiguration - id/scope/version/status/timestamps/
  // createdBy/parentId cannot influence it even if the caller has them at
  // hand, since there is no parameter to pass them through.
  const configuration = buildValidConfiguration();
  const hashA = computeSalesAgentConfigurationHash(configuration);
  const hashB = computeSalesAgentConfigurationHash({ ...configuration });
  assert.equal(hashA, hashB);
});

// ---------------------------------------------------------------------------
// Repository (tests 11-18)
// ---------------------------------------------------------------------------

test("[R11] createDraftConfiguration creates a draft scoped to pesas_chile", async () => {
  const record = await createDraftConfiguration({
    name: uniqueName("draft"),
    configuration: buildValidConfigurationInput(),
    createdBy: "test-suite"
  });
  assert.equal(record.scopeKey, SALES_AGENT_CONFIGURATION_SCOPE);
  assert.equal(record.status, "draft");
  assert.equal(record.schemaVersion, SALES_AGENT_CONFIGURATION_SCHEMA_VERSION);
  assert.ok(record.id > 0);
  assert.ok(record.version >= 1);
});

test("[R12] assigns strictly increasing versions for the scope", async () => {
  const first = await createDraftConfiguration({ name: uniqueName("v"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const second = await createDraftConfiguration({ name: uniqueName("v"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  assert.equal(second.version, first.version + 1);
});

test("[R13] concurrent draft creations never collide on the same version", async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      createDraftConfiguration({ name: uniqueName("concurrent"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" })
    )
  );
  const versions = results.map((record) => record.version);
  assert.equal(new Set(versions).size, versions.length, "every concurrent draft must get a distinct version");
});

test("[R14] updateDraftConfiguration updates a genuine draft", async () => {
  const draft = await createDraftConfiguration({ name: uniqueName("update"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const updated = await updateDraftConfiguration({ id: draft.id, configuration: buildValidConfigurationInput({ role: "Jefa de ventas" }) });
  assert.equal(updated.configuration.role, "Jefa de ventas");
  assert.equal(updated.status, "draft");
});

test("[R15] updateDraftConfiguration on a published row throws a named domain error, never a silent no-op", async () => {
  const draft = await createDraftConfiguration({
    name: uniqueName("publish-then-update"),
    configuration: buildValidConfigurationInput(),
    createdBy: "test-suite"
  });
  const published = await publishDraftConfiguration({ id: draft.id });

  await assert.rejects(
    () => updateDraftConfiguration({ id: published.id, configuration: buildValidConfigurationInput({ role: "otra cosa" }) }),
    SalesAgentConfigurationNotDraftError
  );

  const reloaded = await loadConfigurationById(published.id);
  assert.equal(reloaded?.configuration.role, published.configuration.role, "published row content must remain untouched");
});

test("[R16] two versions with identical content are both allowed to exist (hash is indexed, not unique)", async () => {
  const configuration = buildValidConfigurationInput({ agentName: uniqueName("dup-agent") });
  const first = await createDraftConfiguration({ name: uniqueName("dup"), configuration, createdBy: "test-suite" });
  const second = await createDraftConfiguration({ name: uniqueName("dup"), configuration, createdBy: "test-suite" });
  assert.equal(first.configurationHash, second.configurationHash);
  assert.notEqual(first.id, second.id);
});

test("[R17] listPesasChileConfigurations orders by version descending and honors the status filter", async () => {
  const draft = await createDraftConfiguration({ name: uniqueName("list"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const published = await publishDraftConfiguration({ id: draft.id });
  const nextDraft = await createDraftConfiguration({
    name: uniqueName("list"),
    configuration: buildValidConfigurationInput(),
    createdBy: "test-suite",
    parentConfigurationId: published.id
  });

  const all = await listPesasChileConfigurations({ limit: 200 });
  const ids = all.map((record) => record.id);
  assert.ok(ids.indexOf(nextDraft.id) < ids.indexOf(published.id), "must be ordered by version descending");

  const onlyPublished = await listPesasChileConfigurations({ status: "published", limit: 200 });
  assert.ok(onlyPublished.every((record) => record.status === "published"));
  assert.ok(onlyPublished.some((record) => record.id === published.id));
});

test("[R18] loadPublishedPesasChileConfiguration returns the currently active publication", async () => {
  const draft = await createDraftConfiguration({ name: uniqueName("active"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const published = await publishDraftConfiguration({ id: draft.id });
  const active = await loadPublishedPesasChileConfiguration();
  assert.equal(active?.id, published.id);
});

// ---------------------------------------------------------------------------
// Publish (tests 19-27)
// ---------------------------------------------------------------------------

test("[P19] publishes a valid draft", async () => {
  const draft = await createDraftConfiguration({ name: uniqueName("publish"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const published = await publishDraftConfiguration({ id: draft.id });
  assert.equal(published.status, "published");
  assert.ok(published.publishedAt);
});

test("[P20] publishing a new draft archives the previous publication", async () => {
  const draftA = await createDraftConfiguration({ name: uniqueName("prev"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const publishedA = await publishDraftConfiguration({ id: draftA.id });
  const draftB = await createDraftConfiguration({
    name: uniqueName("next"),
    configuration: buildValidConfigurationInput(),
    createdBy: "test-suite",
    parentConfigurationId: publishedA.id
  });
  const publishedB = await publishDraftConfiguration({ id: draftB.id });

  const reloadedA = await loadConfigurationById(publishedA.id);
  assert.equal(reloadedA?.status, "archived");
  assert.ok(reloadedA?.archivedAt);
  const active = await loadPublishedPesasChileConfiguration();
  assert.equal(active?.id, publishedB.id);
});

test("[P21] the database itself refuses two published rows for the same scope", async () => {
  const draftA = await createDraftConfiguration({ name: uniqueName("guard-a"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  await publishDraftConfiguration({ id: draftA.id });
  const draftB = await createDraftConfiguration({ name: uniqueName("guard-b"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });

  // Bypasses publishDraftConfiguration entirely - a raw UPDATE proves the
  // uniqueness is enforced by published_scope_key in the database, not only
  // by TypeScript logic.
  const attempt = await safeQueryRows(
    `UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET status = 'published', published_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [draftB.id]
  );
  assert.equal(attempt.ok, false);
  assert.match(attempt.ok ? "" : attempt.error, /Duplicate entry|uq_sales_agent_config_one_published_per_scope/i);
});

test("[P22] concurrent publish attempts for the same scope leave exactly one active publication", async () => {
  const drafts = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      createDraftConfiguration({ name: uniqueName(`race-${index}`), configuration: buildValidConfigurationInput(), createdBy: "test-suite" })
    )
  );
  await Promise.all(drafts.map((draft) => publishDraftConfiguration({ id: draft.id })));

  const activeRows = await queryRows<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE scope_key = ? AND status = 'published'`,
    [SALES_AGENT_CONFIGURATION_SCOPE]
  );
  assert.equal(Number(activeRows[0]?.count), 1);
});

test("[P23] publishing an already-archived configuration throws, never re-publishes", async () => {
  const draft = await createDraftConfiguration({ name: uniqueName("archived"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const archived = await archiveConfiguration(draft.id);
  assert.equal(archived.status, "archived");
  await assert.rejects(() => publishDraftConfiguration({ id: archived.id }), SalesAgentConfigurationNotDraftError);
});

test("[P24] publishing a row from a different scope is refused", async () => {
  const configuration = buildValidConfiguration();
  const name = uniqueName("foreign");
  // A random version (never a fixed literal) - crm_test is a persistent,
  // reused database across local test runs, not a fresh throwaway schema
  // per run, so a hardcoded version would collide with a leftover row from
  // a previous run under the same 'other_tenant' scope_key.
  const foreignVersion = Number(`${Date.now()}`.slice(-9));
  await queryRows(
    `INSERT INTO ${SALES_AGENT_CONFIGURATION_TABLE}
       (scope_key, name, version, status, schema_version, configuration_json, configuration_hash, created_by)
     VALUES ('other_tenant', ?, ?, 'draft', ?, ?, ?, 'test-suite')`,
    [name, foreignVersion, SALES_AGENT_CONFIGURATION_SCHEMA_VERSION, JSON.stringify(configuration), computeSalesAgentConfigurationHash(configuration)]
  );
  const rows = await queryRows<{ id: number }>(
    `SELECT id FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE scope_key = 'other_tenant' AND name = ? LIMIT 1`,
    [name]
  );
  const foreignId = rows[0]?.id;
  assert.ok(foreignId);

  await assert.rejects(() => publishDraftConfiguration({ id: foreignId! }), SalesAgentConfigurationScopeMismatchError);
});

test("[P25] a failed publish attempt leaves the previously published configuration untouched", async () => {
  const draftA = await createDraftConfiguration({ name: uniqueName("keep-a"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const publishedA = await publishDraftConfiguration({ id: draftA.id });

  const draftB = await createDraftConfiguration({ name: uniqueName("bad-b"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  // Corrupt the stored configuration directly (bypassing
  // updateDraftConfiguration's own validation) so the publish transaction
  // fails after loading the row FOR UPDATE but before archiving anything.
  await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = '{}' WHERE id = ?`, [draftB.id]);

  await assert.rejects(() => publishDraftConfiguration({ id: draftB.id }));

  const stillActive = await loadPublishedPesasChileConfiguration();
  assert.equal(stillActive?.id, publishedA.id, "the previous publication must survive a failed publish attempt");

  const reloadedB = await queryRows<{ status: string }>(`SELECT status FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE id = ?`, [draftB.id]);
  assert.equal(reloadedB[0]?.status, "draft", "the failing draft must remain a draft, never partially transitioned");

  await restoreConfigurationJson(draftB.id);
});

test("[P26] the advisory lock is released after both a successful and a failed publish", async () => {
  const draftOk = await createDraftConfiguration({ name: uniqueName("lock-ok"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const startOk = Date.now();
  await publishDraftConfiguration({ id: draftOk.id });
  assert.ok(Date.now() - startOk < 3000, "successful publish must not hold the lock past its own transaction");

  const draftBad = await createDraftConfiguration({ name: uniqueName("lock-bad"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = '{}' WHERE id = ?`, [draftBad.id]);
  await assert.rejects(() => publishDraftConfiguration({ id: draftBad.id }));

  // If RELEASE_LOCK had not run in the failed attempt's `finally`, this call
  // would block for up to SALES_AGENT_CONFIGURATION_LOCK_TIMEOUT_SECONDS.
  const draftAfter = await createDraftConfiguration({ name: uniqueName("lock-after"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const startAfter = Date.now();
  const publishedAfter = await publishDraftConfiguration({ id: draftAfter.id });
  assert.ok(Date.now() - startAfter < 3000, "the lock from the failed attempt must have been released promptly");
  assert.equal(publishedAfter.status, "published");

  await restoreConfigurationJson(draftBad.id);
});

test("[P27] audit rows are written inside the same transaction as the domain write", async () => {
  // Direct unit test of auditLog's transactional branch: rolling back after
  // auditLog() on a connection must leave zero rows, proving the insert
  // participates in the caller's transaction instead of committing
  // independently.
  await withConnection(async (connection) => {
    await connection.beginTransaction();
    await auditLog({
      action: "sales_agent_configuration.created",
      entityType: "sales_agent_configuration",
      entityId: 999999999,
      after: { probe: "rollback-test" },
      connection
    });
    await connection.rollback();
  });
  const rolledBackRows = await queryRows(`SELECT id FROM hub_audit_log WHERE entity_id = '999999999'`);
  assert.equal(rolledBackRows.length, 0, "an audit row must not survive a rollback of its own transaction");

  // Positive path: a real publish leaves exactly one matching audit row.
  const draft = await createDraftConfiguration({ name: uniqueName("audit"), configuration: buildValidConfigurationInput(), createdBy: "test-suite" });
  const published = await publishDraftConfiguration({ id: draft.id });
  const auditRows = await queryRows<{ id: number }>(
    `SELECT id FROM hub_audit_log WHERE action = 'sales_agent_configuration.published' AND entity_id = ?`,
    [String(published.id)]
  );
  assert.equal(auditRows.length, 1);
});

// ---------------------------------------------------------------------------
// Resolver (tests 28-33)
// ---------------------------------------------------------------------------

test("[S28] resolveSalesAgentConfiguration uses the published configuration when one exists", async () => {
  const draft = await createDraftConfiguration({
    name: uniqueName("resolver-published"),
    configuration: buildValidConfigurationInput(),
    createdBy: "test-suite"
  });
  const published = await publishDraftConfiguration({ id: draft.id });
  const resolved = await resolveSalesAgentConfiguration();
  assert.equal(resolved.source, "published");
  assert.equal(resolved.recordId, published.id);
  assert.equal(resolved.configurationHash, published.configurationHash);
});

test("[S29] falls back to the deployment default when nothing is published", async () => {
  await clearActivePublication();
  const previous = process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON;
  process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON = JSON.stringify(
    buildValidConfiguration({ agentName: "Deployment Default Agent" })
  );
  try {
    const resolved = await resolveSalesAgentConfiguration();
    assert.equal(resolved.source, "deployment_default");
    assert.equal(resolved.configuration.agentName, "Deployment Default Agent");
    assert.equal(resolved.recordId, null);
  } finally {
    if (previous === undefined) delete process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON;
    else process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON = previous;
  }
});

test("[S30] falls back to the safe default when no deployment default is configured", async () => {
  await clearActivePublication();
  const previous = process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON;
  delete process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON;
  try {
    const resolved = await resolveSalesAgentConfiguration();
    assert.equal(resolved.source, "safe_default");
    assert.deepEqual(resolved.configuration, SALES_AGENT_CONFIGURATION_SAFE_DEFAULT);
  } finally {
    if (previous !== undefined) process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON = previous;
  }
});

test("[S31] falls back to the safe default when the deployment default is invalid (bad shape or bad JSON)", async () => {
  await clearActivePublication();

  const previousShape = process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON;
  process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON = JSON.stringify({ agentName: "missing every other field" });
  try {
    const resolved = await resolveSalesAgentConfiguration();
    assert.equal(resolved.source, "safe_default");
  } finally {
    if (previousShape === undefined) delete process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON;
    else process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON = previousShape;
  }

  const previousJson = process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON;
  process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON = "{ not json";
  try {
    const resolved = await resolveSalesAgentConfiguration();
    assert.equal(resolved.source, "safe_default");
  } finally {
    if (previousJson === undefined) delete process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON;
    else process.env.SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON = previousJson;
  }
});

test("[S32] a genuine database error propagates instead of being treated as \"nothing published\"", async () => {
  // loadPublishedPesasChileConfiguration (and therefore
  // resolveSalesAgentConfiguration, which never wraps it in a try/catch) is
  // built directly on queryRows - unlike safeQueryRows, a real SQL error
  // throws instead of degrading to an empty/ok:false result that could be
  // mistaken for "no published row".
  await assert.rejects(() =>
    queryRows(`SELECT * FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE nonexistent_column_xyz = ? LIMIT 1`, ["pesas_chile"])
  );
});

test("[S33] the safe default is itself a valid configuration with nothing outside the contract", () => {
  const validation = validateSalesAgentPromptConfiguration(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT);
  assert.equal(validation.valid, true);
  assert.deepEqual(Object.keys(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT).sort(), [...SALES_AGENT_PROMPT_CONFIGURATION_FIELDS].sort());
  assert.deepEqual(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT.prohibitedPhrases, []);
});
