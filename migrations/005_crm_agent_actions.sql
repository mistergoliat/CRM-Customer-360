-- P1K-012A: durable agent action queue schema.
-- Manual application only.
-- This migration creates crm_agent_actions for controlled autonomy.
-- It does not enable execution, outbox writes, schedulers, or WhatsApp sends.

CREATE TABLE IF NOT EXISTS crm_agent_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  action_id VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,

  opportunity_id BIGINT UNSIGNED NULL,
  decision_id VARCHAR(191) NULL,
  decision_row_id BIGINT UNSIGNED NULL,

  conversation_case_id BIGINT UNSIGNED NULL,
  message_id VARCHAR(255) NULL,
  wa_id VARCHAR(32) NULL,
  channel VARCHAR(32) NOT NULL DEFAULT 'whatsapp',

  action_type VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'proposed',

  risk_level VARCHAR(32) NOT NULL DEFAULT 'unknown',
  approval_requirement VARCHAR(64) NOT NULL DEFAULT 'operator_review',

  draft_payload_json JSON NULL,
  final_payload_json JSON NULL,
  execution_payload_json JSON NULL,

  draft_message TEXT NULL,
  final_message TEXT NULL,

  scheduled_for DATETIME NULL,
  expires_at DATETIME NULL,

  attempt_number INT UNSIGNED NOT NULL DEFAULT 1,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 1,

  block_reasons_json JSON NULL,
  cancel_reason VARCHAR(64) NULL,
  failure_reason TEXT NULL,

  policy_status VARCHAR(64) NOT NULL DEFAULT 'unknown',
  policy_notes_json JSON NULL,

  source VARCHAR(64) NOT NULL DEFAULT 'ai_sdr',
  created_by VARCHAR(64) NOT NULL DEFAULT 'ai',
  approved_by VARCHAR(191) NULL,
  approved_at DATETIME NULL,

  executed_at DATETIME NULL,
  cancelled_at DATETIME NULL,

  outbox_message_id BIGINT UNSIGNED NULL,

  lifecycle_version VARCHAR(64) NULL,
  policy_version VARCHAR(64) NULL,
  runtime_version VARCHAR(64) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  UNIQUE KEY uq_crm_agent_actions_action_id (action_id),
  UNIQUE KEY uq_crm_agent_actions_idempotency_key (idempotency_key),

  KEY idx_crm_agent_actions_opportunity_id (opportunity_id),
  KEY idx_crm_agent_actions_decision_id (decision_id),
  KEY idx_crm_agent_actions_decision_row_id (decision_row_id),
  KEY idx_crm_agent_actions_conversation_case_id (conversation_case_id),
  KEY idx_crm_agent_actions_message_id (message_id),
  KEY idx_crm_agent_actions_wa_id (wa_id),
  KEY idx_crm_agent_actions_channel (channel),
  KEY idx_crm_agent_actions_action_type (action_type),
  KEY idx_crm_agent_actions_status (status),
  KEY idx_crm_agent_actions_risk_level (risk_level),
  KEY idx_crm_agent_actions_approval_requirement (approval_requirement),
  KEY idx_crm_agent_actions_scheduled_for (scheduled_for),
  KEY idx_crm_agent_actions_expires_at (expires_at),
  KEY idx_crm_agent_actions_policy_status (policy_status),
  KEY idx_crm_agent_actions_created_at (created_at),
  KEY idx_crm_agent_actions_updated_at (updated_at),

  CONSTRAINT fk_crm_agent_actions_opportunity
    FOREIGN KEY (opportunity_id)
    REFERENCES crm_opportunities(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,

  CONSTRAINT fk_crm_agent_actions_decision_row
    FOREIGN KEY (decision_row_id)
    REFERENCES crm_agent_decisions(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
