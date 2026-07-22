import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import {
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_CONFIGURATION_TABLE,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  archiveConfiguration,
  computeSalesAgentConfigurationHash,
  createDraftConfiguration,
  deserializeConfigurationRow,
  loadConfigurationById,
  loadPublishedPesasChileConfiguration,
  publishDraftConfiguration,
  resolveSalesAgentConfiguration,
  SalesAgentConfigurationNotDraftError,
  SalesAgentConfigurationNotFoundError,
  validateSalesAgentConfigurationDocument,
  validateSalesAgentLoopConfiguration,
  validateSalesAgentModelConfiguration,
  type SalesAgentLoopConfiguration,
  type SalesAgentModelConfiguration,
  type SalesAgentPromptConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";

// Real MariaDB, real crm_test database - same convention as
// tests/commercial/salesAgentConfiguration.test.ts.
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

function uniqueName(label: string) {
  return `sac-rt-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function buildValidPromptConfiguration(overrides: Partial<SalesAgentPromptConfiguration> = {}): SalesAgentPromptConfiguration {
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

function buildValidModelConfiguration(overrides: Partial<SalesAgentModelConfiguration> = {}): SalesAgentModelConfiguration {
  return {
    model: "deepseek-v4-flash",
    temperature: 0.2,
    maxOutputTokens: 900,
    timeoutMs: 25000,
    maxModelRetries: 3,
    ...overrides
  };
}

function buildValidLoopConfiguration(overrides: Partial<SalesAgentLoopConfiguration> = {}): SalesAgentLoopConfiguration {
  return {
    maxAgentStepsPerTurn: 4,
    maxToolCallsPerTurn: 3,
    ...overrides
  };
}

/**
 * Best-effort: the read (find the active row) and the write (archive it)
 * are not atomic, so a concurrently-running test file (this scope is real,
 * shared, live state - crm_test has no per-test-run reset) can legitimately
 * archive or publish over the same row in between. Either race outcome
 * already satisfies this helper's actual goal ("nothing of ours is left
 * dangling as published"), so both are swallowed - only a genuine,
 * unrelated failure propagates.
 */
async function clearActivePublication() {
  const active = await loadPublishedPesasChileConfiguration();
  if (!active) return;
  try {
    await archiveConfiguration(active.id);
  } catch (error) {
    if (error instanceof SalesAgentConfigurationNotDraftError || error instanceof SalesAgentConfigurationNotFoundError) return;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Model/loop configuration validation
// ---------------------------------------------------------------------------

test("[M1] validateSalesAgentModelConfiguration accepts a valid configuration", () => {
  const result = validateSalesAgentModelConfiguration(buildValidModelConfiguration());
  assert.equal(result.valid, true);
});

test("[M2] validateSalesAgentModelConfiguration rejects an unknown field", () => {
  const result = validateSalesAgentModelConfiguration({ ...buildValidModelConfiguration(), provider: "openai" });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "unknown_field");
});

test("[M3] validateSalesAgentModelConfiguration rejects a missing field", () => {
  const input = { ...buildValidModelConfiguration() } as Record<string, unknown>;
  delete input.timeoutMs;
  const result = validateSalesAgentModelConfiguration(input);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "missing_required_field");
});

test("[M4] validateSalesAgentModelConfiguration enforces platform bounds on every numeric field", () => {
  const cases: Array<[keyof SalesAgentModelConfiguration, number]> = [
    ["temperature", 1.5],
    ["temperature", -0.1],
    ["maxOutputTokens", 127],
    ["maxOutputTokens", 2049],
    ["timeoutMs", 4999],
    ["timeoutMs", 60001],
    ["maxModelRetries", -1],
    ["maxModelRetries", 6]
  ];
  for (const [field, value] of cases) {
    const result = validateSalesAgentModelConfiguration(buildValidModelConfiguration({ [field]: value } as Partial<SalesAgentModelConfiguration>));
    assert.equal(result.valid, false, `${field}=${value} should be rejected`);
    if (!result.valid) assert.equal(result.code, "out_of_range", `${field}=${value}`);
  }

  // Exactly at the boundary must be accepted.
  const atBounds = validateSalesAgentModelConfiguration(
    buildValidModelConfiguration({ temperature: 1, maxOutputTokens: 2048, timeoutMs: 60000, maxModelRetries: 5 })
  );
  assert.equal(atBounds.valid, true);
});

test("[M5] validateSalesAgentModelConfiguration rejects a non-integer where an integer is required", () => {
  const result = validateSalesAgentModelConfiguration(buildValidModelConfiguration({ maxOutputTokens: 900.5 }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "invalid_type");
});

test("[L1] validateSalesAgentLoopConfiguration accepts a valid configuration and enforces bounds", () => {
  const valid = validateSalesAgentLoopConfiguration(buildValidLoopConfiguration());
  assert.equal(valid.valid, true);

  const tooLow = validateSalesAgentLoopConfiguration(buildValidLoopConfiguration({ maxAgentStepsPerTurn: 0 }));
  assert.equal(tooLow.valid, false);
  if (!tooLow.valid) assert.equal(tooLow.code, "out_of_range");

  const tooHigh = validateSalesAgentLoopConfiguration(buildValidLoopConfiguration({ maxToolCallsPerTurn: 13 }));
  assert.equal(tooHigh.valid, false);
  if (!tooHigh.valid) assert.equal(tooHigh.code, "out_of_range");

  // maxToolCallsPerTurn=0 is explicitly allowed (a configuration that never calls tools).
  const zeroToolCalls = validateSalesAgentLoopConfiguration(buildValidLoopConfiguration({ maxToolCallsPerTurn: 0 }));
  assert.equal(zeroToolCalls.valid, true);
});

// ---------------------------------------------------------------------------
// Document validator (v1/v2 compatibility)
// ---------------------------------------------------------------------------

test("[D1] a v1-shaped document (no model/loop config) validates exactly like the plain prompt configuration", () => {
  const prompt = buildValidPromptConfiguration();
  const result = validateSalesAgentConfigurationDocument(prompt);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.configuration.modelConfiguration, undefined);
    assert.equal(result.configuration.loopConfiguration, undefined);
    assert.equal(result.configuration.agentName, prompt.agentName);
  }
});

test("[D2] a v2 document with modelConfiguration and loopConfiguration validates and preserves both sections", () => {
  const document = {
    ...buildValidPromptConfiguration(),
    modelConfiguration: buildValidModelConfiguration(),
    loopConfiguration: buildValidLoopConfiguration()
  };
  const result = validateSalesAgentConfigurationDocument(document);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.configuration.modelConfiguration, buildValidModelConfiguration());
    assert.deepEqual(result.configuration.loopConfiguration, buildValidLoopConfiguration());
  }
});

test("[D3] an invalid modelConfiguration fails the whole document, never silently dropped", () => {
  const document = { ...buildValidPromptConfiguration(), modelConfiguration: { ...buildValidModelConfiguration(), temperature: 5 } };
  const result = validateSalesAgentConfigurationDocument(document);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "out_of_range");
});

test("[D4] an unknown top-level field is still rejected at the document level", () => {
  const document = { ...buildValidPromptConfiguration(), unknownTopLevelField: "x" };
  const result = validateSalesAgentConfigurationDocument(document);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "unknown_field");
});

// ---------------------------------------------------------------------------
// Hash: v1 compatibility + v2 content sensitivity
// ---------------------------------------------------------------------------

test("[H1] a document with no model/loop config hashes identically to the plain v1 prompt configuration (reproducible historical hash)", () => {
  const prompt = buildValidPromptConfiguration();
  const hashFromPlainPrompt = computeSalesAgentConfigurationHash(prompt);
  const hashFromDocumentWithoutRuntimeConfig = computeSalesAgentConfigurationHash({ ...prompt });
  assert.equal(hashFromPlainPrompt, hashFromDocumentWithoutRuntimeConfig);
});

test("[H2] adding model/loop configuration changes the hash even if the prompt fields are unchanged", () => {
  const prompt = buildValidPromptConfiguration();
  const withoutRuntimeConfig = computeSalesAgentConfigurationHash(prompt);
  const withRuntimeConfig = computeSalesAgentConfigurationHash({
    ...prompt,
    modelConfiguration: buildValidModelConfiguration(),
    loopConfiguration: buildValidLoopConfiguration()
  });
  assert.notEqual(withoutRuntimeConfig, withRuntimeConfig);
});

test("[H3] hash changes when only the model configuration changes", () => {
  const document = { ...buildValidPromptConfiguration(), modelConfiguration: buildValidModelConfiguration() };
  const changed = { ...document, modelConfiguration: buildValidModelConfiguration({ temperature: 0.9 }) };
  assert.notEqual(computeSalesAgentConfigurationHash(document), computeSalesAgentConfigurationHash(changed));
});

// ---------------------------------------------------------------------------
// Repository + backward compatibility with real v1 rows
// ---------------------------------------------------------------------------

test("[R1] createDraftConfiguration accepts and stores modelConfiguration/loopConfiguration", async () => {
  const draft = await createDraftConfiguration({
    name: uniqueName("with-runtime-config"),
    configuration: {
      ...buildValidPromptConfiguration(),
      modelConfiguration: buildValidModelConfiguration(),
      loopConfiguration: buildValidLoopConfiguration()
    },
    createdBy: "test-suite"
  });

  assert.deepEqual(draft.configuration.modelConfiguration, buildValidModelConfiguration());
  assert.deepEqual(draft.configuration.loopConfiguration, buildValidLoopConfiguration());

  const reloaded = await loadConfigurationById(draft.id);
  assert.deepEqual(reloaded?.configuration.modelConfiguration, buildValidModelConfiguration());
});

test("[R2] deserializing a real pre-T02.3B v1 row (schema_version v1, no model/loop keys) still succeeds", () => {
  // Pure, in-memory - no DB write. Fabricates exactly the row shape the
  // original T02.3A code would have produced (flat configuration_json, no
  // modelConfiguration/loopConfiguration keys, schema_version tagged v1) and
  // feeds it straight to the same deserializer the repository uses on every
  // read, proving compatibility without contending for a real version
  // number in the shared, live 'pesas_chile' scope (crm_test has no
  // per-test-run reset, and other test files create real drafts for this
  // same scope concurrently).
  const prompt = buildValidPromptConfiguration({ agentName: "Legacy Agent" });
  const row = {
    id: 999999001,
    scope_key: SALES_AGENT_CONFIGURATION_SCOPE,
    name: "legacy-row-fixture",
    version: 1,
    status: "published",
    schema_version: SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1,
    configuration_json: JSON.stringify(prompt),
    configuration_hash: computeSalesAgentConfigurationHash(prompt),
    parent_configuration_id: null,
    created_by: "legacy",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    published_at: new Date("2026-01-01T00:00:00.000Z"),
    archived_at: null
  };

  const record = deserializeConfigurationRow(row);
  assert.equal(record.schemaVersion, SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1);
  assert.equal(record.configuration.agentName, "Legacy Agent");
  assert.equal(record.configuration.modelConfiguration, undefined);
  assert.equal(record.configuration.loopConfiguration, undefined);
});

test("[R3] resolver falls back to the safe model/loop defaults for a published row that never had runtime config", async () => {
  await clearActivePublication();
  const draft = await createDraftConfiguration({
    name: uniqueName("no-runtime-config"),
    configuration: buildValidPromptConfiguration({ agentName: uniqueName("no-runtime-agent") }),
    createdBy: "test-suite"
  });
  const published = await publishDraftConfiguration({ id: draft.id });
  assert.equal(published.configuration.modelConfiguration, undefined);

  const resolved = await resolveSalesAgentConfiguration();
  assert.equal(resolved.source, "published");
  assert.equal(resolved.recordId, published.id);
  assert.deepEqual(resolved.effectiveModelConfiguration, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT);
  assert.deepEqual(resolved.effectiveLoopConfiguration, SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT);
});

// ---------------------------------------------------------------------------
// Resolver: effective configuration + platform clamps
// ---------------------------------------------------------------------------

test("[E1] resolver uses the published row's own model/loop configuration when present", async () => {
  await clearActivePublication();
  const draft = await createDraftConfiguration({
    name: uniqueName("effective-published"),
    configuration: {
      ...buildValidPromptConfiguration(),
      modelConfiguration: buildValidModelConfiguration({ model: "deepseek-v4-flash", temperature: 0.4 }),
      loopConfiguration: buildValidLoopConfiguration({ maxAgentStepsPerTurn: 5, maxToolCallsPerTurn: 4 })
    },
    createdBy: "test-suite"
  });
  await publishDraftConfiguration({ id: draft.id });

  const resolved = await resolveSalesAgentConfiguration();
  assert.equal(resolved.effectiveModelConfiguration.model, "deepseek-v4-flash");
  assert.equal(resolved.effectiveModelConfiguration.temperature, 0.4);
  assert.equal(resolved.effectiveLoopConfiguration.maxAgentStepsPerTurn, 5);
  assert.equal(resolved.effectiveLoopConfiguration.maxToolCallsPerTurn, 4);
});

test("[E2] resolver falls back to the safe model/loop defaults when nothing is published", async () => {
  // Bounded retry: crm_test's 'pesas_chile' scope is shared, live state
  // across concurrently-running test files (this table has no
  // per-test-run reset) - another file can publish something new in the
  // narrow window between clearActivePublication() and the resolve call
  // below (observed in practice: a concurrent run of
  // tests/commercial/salesAgentConfiguration.test.ts publishing a draft of
  // its own). Re-clearing and re-resolving a few times is the standard,
  // honest way to tame this kind of shared-mutable-state flakiness without
  // adding a fake isolation mechanism this domain does not otherwise have.
  const resolved = await (async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await clearActivePublication();
      const candidate = await resolveSalesAgentConfiguration();
      if (candidate.source === "safe_default") return candidate;
    }
    return resolveSalesAgentConfiguration();
  })();

  assert.equal(resolved.source, "safe_default");
  assert.deepEqual(resolved.effectiveModelConfiguration, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT);
  assert.deepEqual(resolved.effectiveLoopConfiguration, SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT);
});

test("[E3] resolver clamps an out-of-range persisted value to platform limits (defense in depth, not just write-time validation)", async () => {
  await clearActivePublication();
  const draft = await createDraftConfiguration({
    name: uniqueName("clamp-test"),
    configuration: {
      ...buildValidPromptConfiguration(),
      modelConfiguration: buildValidModelConfiguration({ timeoutMs: 45000 }),
      loopConfiguration: buildValidLoopConfiguration({ maxToolCallsPerTurn: 4 })
    },
    createdBy: "test-suite"
  });
  const published = await publishDraftConfiguration({ id: draft.id });

  // Bypass validation directly (simulates a platform cap tightening after
  // this row was written, or a corrupted row) - a real value that would be
  // rejected by validateSalesAgentModelConfiguration today.
  const corruptedConfiguration = {
    ...published.configuration,
    modelConfiguration: { ...published.configuration.modelConfiguration, timeoutMs: 999999, maxModelRetries: 99 },
    loopConfiguration: { ...published.configuration.loopConfiguration, maxToolCallsPerTurn: 999 }
  };
  await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = ? WHERE id = ?`, [
    JSON.stringify(corruptedConfiguration),
    published.id
  ]);

  const resolved = await resolveSalesAgentConfiguration();
  assert.equal(resolved.effectiveModelConfiguration.timeoutMs, 60000, "timeoutMs must be clamped to the platform max");
  assert.equal(resolved.effectiveModelConfiguration.maxModelRetries, 5, "maxModelRetries must be clamped to the platform max");
  assert.equal(resolved.effectiveLoopConfiguration.maxToolCallsPerTurn, 12, "maxToolCallsPerTurn must be clamped to the platform max");
});
