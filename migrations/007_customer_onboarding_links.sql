-- P1M customer onboarding runtime state and explicit conversation link.
-- Idempotent, non-destructive migration.

CREATE TABLE IF NOT EXISTS crm_customer_onboarding (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_case_id VARCHAR(191) NOT NULL,
  wa_id VARCHAR(64) NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'unresolved',
  pending_action VARCHAR(64) NULL,
  pending_customer_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  email VARCHAR(191) NULL,
  firstname VARCHAR(191) NULL,
  lastname VARCHAR(191) NULL,
  customer_id VARCHAR(191) NULL,
  customer_platform_origin VARCHAR(32) NULL,
  link_status VARCHAR(32) NULL,
  last_decision_id VARCHAR(191) NULL,
  last_tool_name VARCHAR(64) NULL,
  last_tool_status VARCHAR(32) NULL,
  last_tool_result_json JSON NULL,
  last_response_text TEXT NULL,
  reason TEXT NULL,
  confidence DECIMAL(5,4) NULL,
  warnings_json JSON NOT NULL,
  context_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_customer_onboarding_conversation_case_id (conversation_case_id),
  KEY idx_crm_customer_onboarding_wa_id (wa_id),
  KEY idx_crm_customer_onboarding_state (state),
  KEY idx_crm_customer_onboarding_customer_id (customer_id),
  KEY idx_crm_customer_onboarding_email (email),
  KEY idx_crm_customer_onboarding_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_conversation_link (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id VARCHAR(191) NOT NULL,
  conversation_case_id VARCHAR(191) NOT NULL,
  link_status VARCHAR(32) NOT NULL DEFAULT 'confirmed',
  link_source VARCHAR(32) NOT NULL DEFAULT 'ai_sdr',
  confidence VARCHAR(16) NOT NULL DEFAULT 'high',
  linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customer_conversation_link_case_id (conversation_case_id),
  KEY idx_customer_conversation_link_customer_id (customer_id),
  KEY idx_customer_conversation_link_status (link_status),
  KEY idx_customer_conversation_link_linked_at (linked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
