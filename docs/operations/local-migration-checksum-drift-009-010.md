# Local migration checksum drift for 009/010

## Scope

This document records the mismatch between the checksums stored in `schema_migrations` and the current repository files for migrations `009` and `010`.

It is documentation only. No runtime reconciliation is introduced here, and no migration file is modified.

## Observed checksums

### `009_crm_sales_need_profiles.sql`

- Recorded in `schema_migrations`: `80ca9d752d6a7abf8c1ddfe504e3c7423542eb0ce48cc05e857397f3de7feaac`
- Current repository file: `f8bed9cbab3a16170e6b5d12a253eb63ae2c568f233d28cc17f362c4038013d2`

### `010_native_whatsapp_identity_and_conversation_controls.sql`

- Recorded in `schema_migrations`: `d177d9a285fb804c4236a44813d97d3d510f8c81e10ae6e27f41bf1a0c813518`
- Current repository file: `9b9369ec32082323a839d03c1b90b3268d49a3dfe2cd4fc90200ec05faddd3f9`

## Probable cause

The migration files were edited after the local database had already recorded earlier checksums in `schema_migrations`.

That produces checksum drift even if the visible SQL intent is compatible with the current schema.

## Impact

- `db:migrate` detects a checksum mismatch and stops before applying later migrations.
- Existing databases created before the file edits need metadata rebaseline or reset before continuing.
- Fresh installations that start from the current repository state should see the current file contents as the canonical migration text.

## Procedure

### Fresh local installs

- Apply the migrations in order using the normal runner.
- No special reconciliation step is required if the database has no prior `schema_migrations` history for these files.

### Existing local databases with old metadata

- Recreate the local database, or rebaseline the migration metadata outside the runtime path.
- Do not add reconciliation logic to the product runtime or deployment flow.
- Do not treat a checksum mismatch as a signal to silently rewrite migration history.

## Validation note

The local dev database was rebaselined only to continue validation of the current branch in this workspace. That is a local maintenance step, not a product behavior.
