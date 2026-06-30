-- MVP-02: durable state for the genuine multi-turn Commercial Agent Runtime.
-- Commercial truth (goal, facts, pending/completed actions) lives here, in crm_*,
-- not in ai_* observability tables (ADR-001/ADR-002). Manual application through
-- the normal migration runner.

CREATE TABLE IF NOT EXISTS crm_agent_conversation_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NULL,
  customer_goal TEXT NULL,
  conversation_state VARCHAR(32) NOT NULL DEFAULT 'active',
  known_facts_json JSON NOT NULL,
  missing_information_json JSON NOT NULL,
  active_hypotheses_json JSON NOT NULL,
  constraints_json JSON NOT NULL,
  recommended_next_step TEXT NULL,
  pending_actions_json JSON NOT NULL,
  completed_actions_json JSON NOT NULL,
  unresolved_questions_json JSON NOT NULL,
  confidence DECIMAL(4,3) NOT NULL DEFAULT 0,
  toolset VARCHAR(32) NOT NULL DEFAULT 'sales',
  human_owner_active TINYINT(1) NOT NULL DEFAULT 0,
  handoff_mode VARCHAR(32) NULL,
  turn_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_turn_correlation_id VARCHAR(191) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_agent_conversation_state_conversation_id (conversation_id),
  KEY idx_crm_agent_conversation_state_opportunity_id (opportunity_id),
  KEY idx_crm_agent_conversation_state_state (conversation_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_agent_turn (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  turn_id VARCHAR(64) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  inbound_message_id BIGINT UNSIGNED NULL,
  correlation_id VARCHAR(191) NOT NULL,
  iterations INT UNSIGNED NOT NULL DEFAULT 0,
  tool_calls_json JSON NOT NULL,
  final_decision VARCHAR(32) NOT NULL,
  response_text TEXT NULL,
  grounded TINYINT(1) NOT NULL DEFAULT 1,
  evaluation_json JSON NULL,
  model_name VARCHAR(64) NULL,
  started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_agent_turn_turn_id (turn_id),
  KEY idx_crm_agent_turn_conversation_id (conversation_id),
  KEY idx_crm_agent_turn_correlation_id (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
