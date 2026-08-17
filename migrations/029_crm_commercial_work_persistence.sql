-- 029: Durable CommercialWork persistence (SALES-AGENT-R2-A04).
--
-- Commercial facts stay in crm_request_facts. Capability evidence stays in
-- crm_capability_executions. Actions stay in crm_agent_actions and transport
-- stays in brain_message_outbox. These tables persist only the commercial
-- work aggregate: which objectives/steps exist, their status, dependencies,
-- evidence references, blockers, and aggregate optimistic-concurrency version.
--
-- Rollback:
--   DROP TABLE IF EXISTS crm_commercial_work_steps;
--   DROP TABLE IF EXISTS crm_commercial_work_objectives;
--   DROP TABLE IF EXISTS crm_commercial_work;

CREATE TABLE IF NOT EXISTS crm_commercial_work (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  public_id VARCHAR(64) NOT NULL,
  correlation_key VARCHAR(191) NOT NULL,
  projection_id VARCHAR(255) NULL,

  opportunity_id BIGINT UNSIGNED NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  source_message_id BIGINT UNSIGNED NULL,

  trigger_type VARCHAR(64) NOT NULL,
  trigger_json JSON NOT NULL,

  status VARCHAR(32) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  projection_version INT UNSIGNED NOT NULL DEFAULT 1,
  payload_version VARCHAR(16) NOT NULL DEFAULT '1.0',

  blockers_json JSON NOT NULL,
  metrics_json JSON NOT NULL,

  derived_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  cancel_reason VARCHAR(64) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_commercial_work_public_id (public_id),
  UNIQUE KEY uq_crm_commercial_work_correlation_key (correlation_key),

  KEY idx_crm_commercial_work_status (status),
  KEY idx_crm_commercial_work_opportunity_status (opportunity_id, status),
  KEY idx_crm_commercial_work_conversation_status (conversation_id, status),
  KEY idx_crm_commercial_work_source_message (source_message_id),
  KEY idx_crm_commercial_work_updated_at (updated_at),

  CONSTRAINT fk_crm_commercial_work_opportunity
    FOREIGN KEY (opportunity_id)
    REFERENCES crm_opportunities(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,

  CONSTRAINT fk_crm_commercial_work_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT chk_crm_commercial_work_status
    CHECK (status IN ('ACTIVE', 'WAITING_CUSTOMER', 'WAITING_SYSTEM', 'COMPLETED', 'CANCELLED', 'SUPERSEDED', 'HANDOFF', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_commercial_work_objectives (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  public_id VARCHAR(255) NOT NULL,
  commercial_work_id BIGINT UNSIGNED NOT NULL,

  type VARCHAR(64) NOT NULL,
  origin VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,

  inputs_json JSON NOT NULL,
  resolved_inputs_json JSON NOT NULL,
  missing_requirements_json JSON NOT NULL,
  supersedes_objective_ids_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  blockers_json JSON NOT NULL,
  payload_version VARCHAR(16) NOT NULL DEFAULT '1.0',

  completed_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  superseded_at DATETIME(3) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_commercial_work_objective_public (commercial_work_id, public_id),
  KEY idx_crm_commercial_work_objective_work_status (commercial_work_id, status),
  KEY idx_crm_commercial_work_objective_type_status (type, status),

  CONSTRAINT fk_crm_commercial_work_objective_work
    FOREIGN KEY (commercial_work_id)
    REFERENCES crm_commercial_work(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT chk_crm_commercial_work_objective_status
    CHECK (status IN ('PENDING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'WAITING_CUSTOMER', 'WAITING_SYSTEM', 'BLOCKED', 'CANCELLED', 'SUPERSEDED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_commercial_work_steps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  public_id VARCHAR(255) NOT NULL,
  commercial_work_id BIGINT UNSIGNED NOT NULL,

  primary_objective_public_id VARCHAR(255) NULL,
  objective_ids_json JSON NOT NULL,

  step_type VARCHAR(64) NOT NULL,
  capability_name VARCHAR(100) NULL,
  status VARCHAR(32) NOT NULL,

  dependencies_json JSON NOT NULL,
  input_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  blockers_json JSON NOT NULL,

  retryable TINYINT(1) NOT NULL DEFAULT 0,
  retry_candidate TINYINT(1) NOT NULL DEFAULT 0,
  idempotency_key VARCHAR(191) NULL,
  payload_version VARCHAR(16) NOT NULL DEFAULT '1.0',

  completed_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  superseded_at DATETIME(3) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_commercial_work_step_public (commercial_work_id, public_id),
  UNIQUE KEY uq_crm_commercial_work_step_idempotency (idempotency_key),

  KEY idx_crm_commercial_work_step_work_status (commercial_work_id, status),
  KEY idx_crm_commercial_work_step_status_type (status, step_type),
  KEY idx_crm_commercial_work_step_capability_status (capability_name, status),
  KEY idx_crm_commercial_work_step_primary_objective (primary_objective_public_id),

  CONSTRAINT fk_crm_commercial_work_step_work
    FOREIGN KEY (commercial_work_id)
    REFERENCES crm_commercial_work(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT chk_crm_commercial_work_step_status
    CHECK (status IN ('PENDING', 'READY', 'COMPLETED', 'BLOCKED', 'WAITING_CUSTOMER', 'WAITING_SYSTEM', 'RETRY_SCHEDULED', 'CANCELLED', 'SUPERSEDED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
