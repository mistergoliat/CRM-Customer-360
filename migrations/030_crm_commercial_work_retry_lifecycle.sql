-- 030: CommercialWork retry lifecycle (SALES-AGENT-R2-A06).
--
-- Adds step-level scheduling/lease metadata for the dev/test CommercialWork
-- continuation worker. Work-level scheduling is intentionally not duplicated:
-- the due unit is a concrete step.
--
-- Rollback:
--   ALTER TABLE crm_commercial_work_steps DROP INDEX idx_crm_commercial_work_step_due_retry;
--   ALTER TABLE crm_commercial_work_steps DROP INDEX idx_crm_commercial_work_step_lock_until;
--   ALTER TABLE crm_commercial_work_steps DROP COLUMN lock_until;
--   ALTER TABLE crm_commercial_work_steps DROP COLUMN lock_owner;
--   ALTER TABLE crm_commercial_work_steps DROP COLUMN last_attempt_at;
--   ALTER TABLE crm_commercial_work_steps DROP COLUMN started_at;
--   ALTER TABLE crm_commercial_work_steps DROP COLUMN next_attempt_at;
--   ALTER TABLE crm_commercial_work_steps DROP COLUMN max_attempts;
--   ALTER TABLE crm_commercial_work_steps DROP COLUMN attempt_count;
--   ALTER TABLE crm_commercial_work_steps DROP CONSTRAINT chk_crm_commercial_work_step_status;
--   ALTER TABLE crm_commercial_work_steps ADD CONSTRAINT chk_crm_commercial_work_step_status
--     CHECK (status IN ('PENDING', 'READY', 'COMPLETED', 'BLOCKED', 'WAITING_CUSTOMER', 'WAITING_SYSTEM', 'RETRY_SCHEDULED', 'CANCELLED', 'SUPERSEDED', 'FAILED'));

ALTER TABLE crm_commercial_work_steps
  DROP CONSTRAINT chk_crm_commercial_work_step_status;

ALTER TABLE crm_commercial_work_steps
  ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER retry_candidate,
  ADD COLUMN max_attempts INT UNSIGNED NULL AFTER attempt_count,
  ADD COLUMN next_attempt_at DATETIME(3) NULL AFTER max_attempts,
  ADD COLUMN started_at DATETIME(3) NULL AFTER next_attempt_at,
  ADD COLUMN last_attempt_at DATETIME(3) NULL AFTER started_at,
  ADD COLUMN lock_owner VARCHAR(191) NULL AFTER last_attempt_at,
  ADD COLUMN lock_until DATETIME(3) NULL AFTER lock_owner,
  ADD KEY idx_crm_commercial_work_step_due_retry (status, next_attempt_at, commercial_work_id),
  ADD KEY idx_crm_commercial_work_step_lock_until (status, lock_until);

ALTER TABLE crm_commercial_work_steps
  ADD CONSTRAINT chk_crm_commercial_work_step_status
    CHECK (status IN ('PENDING', 'READY', 'RUNNING', 'COMPLETED', 'BLOCKED', 'WAITING_CUSTOMER', 'WAITING_SYSTEM', 'RETRY_SCHEDULED', 'CANCELLED', 'SUPERSEDED', 'FAILED'));
