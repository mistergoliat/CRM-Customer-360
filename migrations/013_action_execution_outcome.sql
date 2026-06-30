-- 013: ActionExecution and ActionOutcome tables for the autonomous commercial cycle.
-- Keeps CommercialAction (crm_agent_actions), ActionExecution, OutboxMessage, and
-- ActionOutcome as distinct entities so retry attempts never duplicate actions,
-- and provider delivery status is tracked independently of the action lifecycle.
--
-- action:     ready -> executing -> completed | failed
-- execution:  requested -> executing -> succeeded | failed
-- outbox:     planned -> claimed -> sent | failed   (brain_message_outbox, migration 003)
-- outcome:    queued -> sent -> delivered | read | failed

CREATE TABLE IF NOT EXISTS crm_action_executions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  execution_id      VARCHAR(191) NOT NULL,
  action_id         VARCHAR(191) NOT NULL,
  action_row_id     BIGINT UNSIGNED NULL,

  outbox_message_id BIGINT UNSIGNED NULL,
  outbox_dedupe_key VARCHAR(191) NULL,

  attempt_number    INT UNSIGNED NOT NULL DEFAULT 1,
  status            VARCHAR(32)  NOT NULL DEFAULT 'requested',
  -- requested | executing | succeeded | failed | cancelled

  requested_at  DATETIME(3) NOT NULL,
  started_at    DATETIME(3) NULL,
  completed_at  DATETIME(3) NULL,

  error_code    VARCHAR(64)  NULL,
  error_message TEXT         NULL,
  retryable     TINYINT(1)   NOT NULL DEFAULT 0,

  provider_request_id  VARCHAR(255) NULL,
  provider_response_json JSON        NULL,

  correlation_id VARCHAR(191) NULL,
  source         VARCHAR(64)  NOT NULL DEFAULT 'autonomous_worker',

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_action_executions_execution_id (execution_id),
  KEY idx_crm_action_executions_action_id (action_id),
  KEY idx_crm_action_executions_action_row_id (action_row_id),
  KEY idx_crm_action_executions_outbox_message_id (outbox_message_id),
  KEY idx_crm_action_executions_status (status),
  KEY idx_crm_action_executions_requested_at (requested_at),

  CONSTRAINT fk_crm_action_executions_action
    FOREIGN KEY (action_row_id)
    REFERENCES crm_agent_actions(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_action_outcomes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  outcome_id          VARCHAR(191) NOT NULL,
  action_id           VARCHAR(191) NOT NULL,
  action_row_id       BIGINT UNSIGNED NULL,
  execution_id        VARCHAR(191) NULL,
  outbox_message_id   BIGINT UNSIGNED NULL,
  provider_message_id VARCHAR(255) NULL,

  outcome_type  VARCHAR(32) NOT NULL DEFAULT 'queued',
  -- queued | sent | delivered | read | failed | unknown

  occurred_at   DATETIME(3) NOT NULL,
  recorded_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  provider_event_json JSON NULL,
  metadata_json       JSON NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_action_outcomes_outcome_id (outcome_id),
  KEY idx_crm_action_outcomes_action_id (action_id),
  KEY idx_crm_action_outcomes_action_row_id (action_row_id),
  KEY idx_crm_action_outcomes_execution_id (execution_id),
  KEY idx_crm_action_outcomes_provider_message_id (provider_message_id),
  KEY idx_crm_action_outcomes_outcome_type (outcome_type),
  KEY idx_crm_action_outcomes_occurred_at (occurred_at),

  CONSTRAINT fk_crm_action_outcomes_action
    FOREIGN KEY (action_row_id)
    REFERENCES crm_agent_actions(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
