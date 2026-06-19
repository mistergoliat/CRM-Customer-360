-- P1K-010D: physical table naming consolidated to crm_* before production application.
-- This migration is intended for manual application only.

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  opportunity_key VARCHAR(191) NOT NULL,
  customer_candidate_id VARCHAR(191) NULL,
  customer_master_id VARCHAR(191) NULL,
  lead_id VARCHAR(191) NULL,
  conversation_case_id VARCHAR(191) NULL,
  wa_id VARCHAR(64) NULL,
  channel VARCHAR(32) NOT NULL DEFAULT 'unknown',
  primary_intent VARCHAR(64) NOT NULL DEFAULT 'unknown',
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  stage VARCHAR(32) NULL,
  temperature VARCHAR(16) NOT NULL DEFAULT 'unknown',
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  current_summary TEXT NULL,
  requirements_json JSON NOT NULL,
  missing_requirements_json JSON NOT NULL,
  product_interests_json JSON NOT NULL,
  objections_json JSON NOT NULL,
  signals_json JSON NOT NULL,
  last_customer_message_id VARCHAR(191) NULL,
  last_agent_decision_id VARCHAR(191) NULL,
  waiting_for VARCHAR(64) NULL,
  next_action_type VARCHAR(64) NULL,
  next_action_due_at DATETIME NULL,
  human_owner_active TINYINT(1) NOT NULL DEFAULT 0,
  ai_blocked TINYINT(1) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  UNIQUE KEY uq_crm_opportunities_opportunity_key (opportunity_key),
  KEY idx_crm_opportunities_customer_candidate_id (customer_candidate_id),
  KEY idx_crm_opportunities_wa_id (wa_id),
  KEY idx_crm_opportunities_conversation_case_id (conversation_case_id),
  KEY idx_crm_opportunities_status (status),
  KEY idx_crm_opportunities_updated_at (updated_at),
  KEY idx_crm_opportunities_last_activity_at (last_activity_at),
  KEY idx_crm_opportunities_customer_master_id (customer_master_id),
  KEY idx_crm_opportunities_lead_id (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_agent_decisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  decision_id VARCHAR(191) NOT NULL,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  correlation_id VARCHAR(191) NOT NULL,
  process_inbound_run_id VARCHAR(191) NULL,
  sales_agent_run_id VARCHAR(191) NULL,
  message_id VARCHAR(191) NULL,
  previous_status VARCHAR(32) NULL,
  next_status VARCHAR(32) NOT NULL,
  previous_stage VARCHAR(32) NULL,
  next_stage VARCHAR(32) NULL,
  detected_signals_json JSON NOT NULL,
  state_changes_json JSON NOT NULL,
  missing_information_json JSON NOT NULL,
  next_action_json JSON NOT NULL,
  policy_status VARCHAR(32) NOT NULL,
  risk_level VARCHAR(32) NOT NULL,
  approval_requirement VARCHAR(32) NOT NULL,
  decision_status VARCHAR(32) NOT NULL,
  rationale TEXT NOT NULL,
  warnings_json JSON NOT NULL,
  contract_version VARCHAR(64) NULL,
  policy_version VARCHAR(64) NULL,
  runtime_version VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_agent_decisions_decision_id (decision_id),
  KEY idx_crm_agent_decisions_opportunity_id (opportunity_id),
  KEY idx_crm_agent_decisions_correlation_id (correlation_id),
  KEY idx_crm_agent_decisions_process_inbound_run_id (process_inbound_run_id),
  KEY idx_crm_agent_decisions_sales_agent_run_id (sales_agent_run_id),
  KEY idx_crm_agent_decisions_message_id (message_id),
  KEY idx_crm_agent_decisions_created_at (created_at),
  CONSTRAINT fk_crm_agent_decisions_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_agent_decisions;
-- DROP TABLE IF EXISTS crm_opportunities;
