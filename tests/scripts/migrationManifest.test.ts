import assert from "node:assert/strict";
import test from "node:test";
import { validateMigrationManifest } from "@/scripts/migration-manifest";

test("accepts a manifest with unique versions and returns filename/version pairs in order", () => {
  const entries = validateMigrationManifest(["001_a.sql", "002_b.sql", "010_c.sql"]);
  assert.deepEqual(entries, [
    { filename: "001_a.sql", version: "001" },
    { filename: "002_b.sql", version: "002" },
    { filename: "010_c.sql", version: "010" }
  ]);
});

test("rejects two filenames that resolve to the same version, before any SQL would run", () => {
  assert.throws(
    () => validateMigrationManifest(["022_crm_capability_executions.sql", "022_customer_identity_onboarding.sql"]),
    /^Error: duplicate_migration_version:022:022_crm_capability_executions\.sql:022_customer_identity_onboarding\.sql$/
  );
});

test("the duplicate-version error names files in a deterministic order regardless of manifest order", () => {
  const forward = () => validateMigrationManifest(["022_a.sql", "022_b.sql"]);
  const backward = () => validateMigrationManifest(["022_b.sql", "022_a.sql"]);
  assert.throws(forward, /duplicate_migration_version:022:022_a\.sql:022_b\.sql/);
  assert.throws(backward, /duplicate_migration_version:022:022_a\.sql:022_b\.sql/);
});

test("rejects a filename with no leading numeric version", () => {
  assert.throws(() => validateMigrationManifest(["readme.sql"]), /invalid_migration_version:readme\.sql/);
});

test("rejects an empty filename", () => {
  assert.throws(() => validateMigrationManifest([""]), /invalid_migration_version:/);
});

test("an empty manifest is valid", () => {
  assert.deepEqual(validateMigrationManifest([]), []);
});
