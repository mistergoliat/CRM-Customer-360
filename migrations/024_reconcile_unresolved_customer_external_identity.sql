-- 024: Reconcile the native WhatsApp inbound identity fix after PR #43
-- (ACS-R1-04-T06.2). Originally shipped as 022_customer_identity_onboarding.sql,
-- which collided with 022_crm_capability_executions.sql (both resolved to
-- schema_migrations.version = '022', the runner's UNIQUE KEY). Renumbered
-- here; content reconciled to the canonical ACS-R1-04 architecture (T02-T06.1):
-- crm_customer_onboarding_state is the only canonical onboarding persistence,
-- via CustomerOnboardingService. Physically idempotent so it converges a
-- clean database and one where the original 022 file's DDL already partially
-- ran (MariaDB autocommits each DDL statement, so on at least one local
-- environment the ALTER below already applied before the duplicate-version
-- INSERT failed and rolled back only the schema_migrations bookkeeping).

-- Kept: lets a WhatsApp contact with no resolved customer persist an
-- unresolved customer_external_identity row (customer_id = NULL) instead of
-- fabricating a provisional master_customer with a wa-<phone>@local.invalid
-- email. See lib/brain/native-whatsapp/service.ts,
-- resolveOrPersistNativeExternalIdentity.
ALTER TABLE customer_external_identity
  MODIFY COLUMN customer_id BIGINT UNSIGNED NULL;

-- The columns/indexes below were added to the legacy crm_customer_onboarding
-- table (P1M/local-ai-sdr, migration 007) by the original 022 file. They are
-- NOT canonical: nothing in ACS writes to crm_customer_onboarding, and they
-- do not replace crm_customer_onboarding_state (migration 023). Kept as
-- inert compatibility, not dropped, only to converge the physical schema of
-- environments where the original file's DDL already ran - not reintroduced
-- as active architecture.
ALTER TABLE crm_customer_onboarding
  ADD COLUMN IF NOT EXISTS identity_resolution_status VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS identity_provider VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS identity_type VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS identity_external_id VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS identity_normalized_value VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS customer_creation_consent_email VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS customer_creation_consent_source_message_id VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS customer_creation_consent_channel VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS customer_creation_consent_granted_at DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS customer_creation_consent_granted TINYINT(1) NULL;

CREATE INDEX IF NOT EXISTS idx_crm_customer_onboarding_identity_resolution_status
  ON crm_customer_onboarding (identity_resolution_status);

CREATE INDEX IF NOT EXISTS idx_crm_customer_onboarding_identity_external_id
  ON crm_customer_onboarding (identity_external_id);

CREATE INDEX IF NOT EXISTS idx_crm_customer_onboarding_identity_normalized_value
  ON crm_customer_onboarding (identity_normalized_value);

CREATE INDEX IF NOT EXISTS idx_crm_customer_onboarding_creation_consent_email
  ON crm_customer_onboarding (customer_creation_consent_email);

-- Rollback:
-- ALTER TABLE customer_external_identity MODIFY COLUMN customer_id BIGINT UNSIGNED NOT NULL;
-- (only safe once every customer_id = NULL row has been resolved or removed)
