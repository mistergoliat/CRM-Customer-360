-- 019: Escalations scoped to one ConversationRequest (ADR-007 made durable).
-- Escalating ONE request never blocks the conversation's other requests.
-- Every escalation has a target (invariant: "toda derivacion tiene target").
-- active_marker is 1 while the escalation is open and NULL once terminal, so
-- the unique key allows at most ONE open escalation per request while keeping
-- full history.

CREATE TABLE IF NOT EXISTS crm_request_escalations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  escalation_id VARCHAR(191) NOT NULL,
  request_id VARCHAR(191) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,

  category VARCHAR(32) NOT NULL,
  -- sales | customer_service | post_sale | logistics | finance
  -- | technical_support | policy_approval | technical_failure | other
  mode VARCHAR(32) NOT NULL,
  -- exclusive_handoff | approval_request | internal_consultation | technical_recovery

  target_type VARCHAR(32) NOT NULL,
  -- team | queue | role | user | external_system
  target_id VARCHAR(191) NOT NULL,

  status VARCHAR(32) NOT NULL DEFAULT 'created',
  -- created | assigned | accepted | in_progress | resolved | cancelled | expired

  reason VARCHAR(255) NOT NULL,
  created_by VARCHAR(32) NOT NULL,
  -- planner | system | operator

  assigned_operator_id VARCHAR(191) NULL,
  resolution_outcome VARCHAR(32) NULL,
  -- resolved_request | returned_to_ai | cancelled | expired
  resolution_note TEXT NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,

  active_marker TINYINT GENERATED ALWAYS AS (IF(status IN ('created','assigned','accepted','in_progress'), 1, NULL)) STORED,

  PRIMARY KEY (id),
  UNIQUE KEY uq_request_escalation_id (escalation_id),
  UNIQUE KEY uq_request_escalation_active (request_id, active_marker),

  KEY idx_request_escalation_status (status, created_at),
  KEY idx_request_escalation_conversation (conversation_id, status),
  KEY idx_request_escalation_target (target_type, target_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_request_escalations;
