-- 014: retry/backoff support for brain_message_outbox.
--
-- A temporary Meta failure must not be terminal: the worker re-plans the row
-- with attempt_count+1 and next_attempt_at in the future, until the attempt
-- limit is reached (then it becomes a terminal 'failed' with escalation).
--
-- Incremental and data-preserving. Rollback: the columns are additive and can
-- be dropped (ALTER TABLE brain_message_outbox DROP COLUMN attempt_count,
-- DROP COLUMN next_attempt_at, DROP KEY idx_brain_outbox_status_next_attempt)
-- without any data loss on pre-existing columns.

ALTER TABLE brain_message_outbox
  ADD COLUMN IF NOT EXISTS attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER error_message,
  ADD COLUMN IF NOT EXISTS next_attempt_at DATETIME(3) NULL AFTER attempt_count,
  ADD KEY IF NOT EXISTS idx_brain_outbox_status_next_attempt (status, next_attempt_at);
