-- 022: Capability Gateway v1 tool-execution audit trail (ACS-R1-01).
--
-- Distinct from ai_tool_execution (migration 008): that table's FK requires a
-- row in ai_agent_execution/ai_agent_decision, which belong to the unrelated
-- local-ai-sdr subsystem (lib/brain/local-ai-sdr). The native/commercial
-- runtime has no such rows per turn, so reusing ai_tool_execution would force
-- fake local-ai-sdr rows just to satisfy its FK. This table correlates
-- instead with the commercial-domain identifiers the native cycle already
-- has: commercial_event, crm_opportunities, conversation, crm_agent_actions,
-- and (loosely, no FK - different runtime) crm_conversation_requests.
--
-- Follows the crm_action_executions convention (migration 013): logical
-- VARCHAR ids for cross-table correlation without FK, plus an optional
-- `_row_id` numeric column with FK where the target table uses a bigint PK.

CREATE TABLE IF NOT EXISTS crm_capability_executions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  public_id CHAR(36) NOT NULL,
  correlation_id VARCHAR(191) NOT NULL,

  capability_name VARCHAR(100) NOT NULL,
  capability_version VARCHAR(32) NOT NULL,

  availability_status VARCHAR(32) NOT NULL,
  -- available | unavailable | denied | requires_approval | temporarily_blocked

  execution_status VARCHAR(32) NOT NULL,
  -- completed | missing_information | denied | requires_approval |
  -- temporarily_blocked | invalid_arguments | failed | not_executed

  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  retryable TINYINT(1) NOT NULL DEFAULT 0,
  error_code VARCHAR(100) NULL,

  request_summary_json JSON NULL,
  response_summary_json JSON NULL,
  evidence_json JSON NULL,

  commercial_event_id VARCHAR(64) NULL,
  decision_id VARCHAR(191) NULL,
  action_id VARCHAR(191) NULL,
  action_row_id BIGINT UNSIGNED NULL,
  opportunity_id BIGINT UNSIGNED NULL,
  conversation_id BIGINT UNSIGNED NULL,
  request_id VARCHAR(191) NULL,

  started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_capability_executions_public_id (public_id),
  KEY idx_crm_capability_executions_correlation_id (correlation_id),
  KEY idx_crm_capability_executions_capability_name (capability_name),
  KEY idx_crm_capability_executions_execution_status (execution_status),
  KEY idx_crm_capability_executions_opportunity_id (opportunity_id),
  KEY idx_crm_capability_executions_conversation_id (conversation_id),
  KEY idx_crm_capability_executions_action_row_id (action_row_id),
  KEY idx_crm_capability_executions_request_id (request_id),

  CONSTRAINT fk_crm_capability_executions_action
    FOREIGN KEY (action_row_id)
    REFERENCES crm_agent_actions(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_crm_capability_executions_opportunity
    FOREIGN KEY (opportunity_id)
    REFERENCES crm_opportunities(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_crm_capability_executions_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_capability_executions;
