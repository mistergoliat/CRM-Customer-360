-- Native WhatsApp identity and conversation control fields.
-- Manual application through the normal migration runner.

ALTER TABLE conversation
  ADD COLUMN external_thread_id VARCHAR(191) NULL AFTER external_contact_id,
  ADD COLUMN human_owner_active TINYINT(1) NOT NULL DEFAULT 0 AFTER ai_enabled;

ALTER TABLE brain_message_outbox
  ADD COLUMN provider_status VARCHAR(32) NULL AFTER provider_message_id,
  ADD COLUMN provider_status_updated_at DATETIME NULL AFTER provider_status;

CREATE TABLE IF NOT EXISTS customer_external_identity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(32) NOT NULL,
  identity_type VARCHAR(32) NOT NULL,
  external_id VARCHAR(191) NOT NULL,
  normalized_value VARCHAR(191) NOT NULL,
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_external_identity_provider_external_id (provider, external_id),
  KEY idx_customer_external_identity_customer_id (customer_id),
  KEY idx_customer_external_identity_normalized_value (normalized_value),
  CONSTRAINT fk_customer_external_identity_customer
    FOREIGN KEY (customer_id)
    REFERENCES master_customer(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
