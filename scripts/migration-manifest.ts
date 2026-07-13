export type MigrationManifestEntry = {
  filename: string;
  version: string;
};

const VERSION_PATTERN = /^(\d+)/;

/**
 * Pure manifest check the migration runner calls before touching any
 * database. Two files that resolve to the same numeric version (e.g.
 * `022_a.sql` and `022_b.sql`) would both try to claim schema_migrations'
 * `UNIQUE KEY uq_schema_migrations_version` - failing only after the second
 * file's DDL has already run (ACS-R1-04-T06.2 incident). Catching it here,
 * before any SQL executes, keeps a bad manifest from partially applying.
 */
export function validateMigrationManifest(filenames: string[]): MigrationManifestEntry[] {
  const seenVersions = new Map<string, string>();
  const entries: MigrationManifestEntry[] = [];

  for (const filename of filenames) {
    const version = filename.match(VERSION_PATTERN)?.[1] ?? "";
    if (!version) {
      throw new Error(`invalid_migration_version:${filename}`);
    }

    const existing = seenVersions.get(version);
    if (existing) {
      const [first, second] = [existing, filename].sort((a, b) => a.localeCompare(b));
      throw new Error(`duplicate_migration_version:${version}:${first}:${second}`);
    }

    seenVersions.set(version, filename);
    entries.push({ filename, version });
  }

  return entries;
}
