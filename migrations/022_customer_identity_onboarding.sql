-- 022: Durable customer identity onboarding without provisional master_customer creation.
-- Non-destructive: opens external identities to unresolved contact rows and
-- adds durable onboarding state for identity resolution and customer creation
-- consent.

ALTER TABLE customer_external_identity
  MODIFY COLUMN customer_id BIGINT UNSIGNED NULL;

ALTER TABLE crm_customer_onboarding
  ADD COLUMN identity_resolution_status VARCHAR(64) NULL,
  ADD COLUMN identity_provider VARCHAR(32) NULL,
  ADD COLUMN identity_type VARCHAR(32) NULL,
  ADD COLUMN identity_external_id VARCHAR(191) NULL,
  ADD COLUMN identity_normalized_value VARCHAR(191) NULL,
  ADD COLUMN customer_creation_consent_email VARCHAR(191) NULL,
  ADD COLUMN customer_creation_consent_source_message_id VARCHAR(191) NULL,
  ADD COLUMN customer_creation_consent_channel VARCHAR(32) NULL,
  ADD COLUMN customer_creation_consent_granted_at DATETIME(3) NULL,
  ADD COLUMN customer_creation_consent_granted TINYINT(1) NULL;

CREATE INDEX idx_crm_customer_onboarding_identity_resolution_status
  ON crm_customer_onboarding (identity_resolution_status);

CREATE INDEX idx_crm_customer_onboarding_identity_external_id
  ON crm_customer_onboarding (identity_external_id);

CREATE INDEX idx_crm_customer_onboarding_identity_normalized_value
  ON crm_customer_onboarding (identity_normalized_value);

CREATE INDEX idx_crm_customer_onboarding_creation_consent_email
  ON crm_customer_onboarding (customer_creation_consent_email);
