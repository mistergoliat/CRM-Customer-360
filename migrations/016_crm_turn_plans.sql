-- 016: Durable TurnPlan storage for the multi-request runtime.
-- One planning LLM call per turn produces one TurnPlan; a retry of the same
-- inbound message reuses the persisted plan instead of re-invoking the
-- planner (UNIQUE on inbound_message_id + planner_schema_version), so request
-- creation_keys derived from turn_plan_id + detection_id stay stable.

CREATE TABLE IF NOT EXISTS crm_turn_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  turn_plan_id VARCHAR(191) NOT NULL,

  correlation_id VARCHAR(191) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  -- Internal conversation_message id of the inbound turn, never the provider id.
  inbound_message_id VARCHAR(191) NOT NULL,

  planner_schema_version VARCHAR(32) NOT NULL,
  input_hash VARCHAR(64) NOT NULL,

  status VARCHAR(32) NOT NULL DEFAULT 'planned',
  -- planned | partially_executed | executed | failed | superseded

  plan_json JSON NOT NULL,

  error_code VARCHAR(64) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_turn_plan_id (turn_plan_id),
  UNIQUE KEY uq_turn_plan_message_version (inbound_message_id, planner_schema_version),

  KEY idx_turn_plan_correlation (correlation_id),
  KEY idx_turn_plan_conversation (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_turn_plans;
