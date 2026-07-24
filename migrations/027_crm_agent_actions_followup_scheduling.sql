-- 027: Native follow-up scheduling support on crm_agent_actions
-- (ACS-R1-05.1-T02.3D).
--
-- Context: the native runtime (runCommercialExecutionBridge ->
-- buildAgentActionFromNextAction) has persisted every `schedule_followup`
-- row with scheduled_for = NULL and a hardcoded max_attempts = 1 - since
-- runFollowupTick.selectDueFollowUps requires
-- `status = 'planned' AND scheduled_for <= UTC_TIMESTAMP()`, and
-- `NULL <= anything` is NULL (never true) in SQL, every native-path
-- follow-up row created before this migration has been permanently
-- unreachable by the worker. This migration adds what real, configured
-- scheduling needs; the application-side fix (computing a real
-- scheduled_for) ships in the same task, not here.
--
-- followup_sequence_key: deterministic identity for "this opportunity's (or,
-- lacking one, this conversation's) follow-up sequence" - never includes a
-- timestamp, unlike idempotency_key's digest (which includes createdAt and
-- therefore differs turn to turn for what is logically the same sequence).
-- Only ever set for action_type = 'schedule_followup'; every other action
-- type leaves it NULL.
--
-- active_followup_sequence_key: a stored generated column, mirroring the
-- published_scope_key pattern already used by
-- migrations/026_sales_agent_configurations.sql - NULL unless this is a
-- schedule_followup row in an active status (planned, requires_review,
-- executing). MariaDB allows unlimited NULLs in a UNIQUE KEY, so every
-- non-follow-up row and every terminal follow-up row never collides; only
-- two SIMULTANEOUSLY ACTIVE rows for the same sequence would, which is
-- exactly the "no duplicar follow-up por la misma accion" invariant this
-- enforces at the database level, not just in TypeScript.
--
-- followup_configuration_source/id/version/hash: a snapshot of which Sales
-- Agent Configuration (published / deployment_default / safe_default)
-- governed this row's scheduling at creation time - source is required
-- (never omitted) because deployment_default/safe_default never have a real
-- record id/version/hash to snapshot. Mirrors the existing
-- lifecycle_version/policy_version/runtime_version convention (plain
-- nullable columns), not a new JSON blob.
--
-- Rollback (additive-only, safe before any application code depends on it):
--   ALTER TABLE crm_agent_actions
--     DROP KEY uq_crm_agent_actions_active_followup_sequence,
--     DROP COLUMN active_followup_sequence_key,
--     DROP COLUMN followup_sequence_key,
--     DROP COLUMN followup_configuration_source,
--     DROP COLUMN followup_configuration_id,
--     DROP COLUMN followup_configuration_version,
--     DROP COLUMN followup_configuration_hash;

ALTER TABLE crm_agent_actions
  ADD COLUMN followup_sequence_key VARCHAR(191) NULL AFTER max_attempts,
  ADD COLUMN followup_configuration_source VARCHAR(32) NULL AFTER followup_sequence_key,
  ADD COLUMN followup_configuration_id BIGINT UNSIGNED NULL AFTER followup_configuration_source,
  ADD COLUMN followup_configuration_version INT UNSIGNED NULL AFTER followup_configuration_id,
  ADD COLUMN followup_configuration_hash CHAR(64) NULL AFTER followup_configuration_version;

ALTER TABLE crm_agent_actions
  ADD COLUMN active_followup_sequence_key VARCHAR(191)
    GENERATED ALWAYS AS (
      CASE
        WHEN action_type = 'schedule_followup' AND status IN ('planned', 'requires_review', 'executing')
          THEN followup_sequence_key
        ELSE NULL
      END
    ) STORED
    AFTER followup_configuration_hash;

ALTER TABLE crm_agent_actions
  ADD UNIQUE KEY uq_crm_agent_actions_active_followup_sequence (active_followup_sequence_key);

CREATE INDEX idx_crm_agent_actions_followup_sequence_key
  ON crm_agent_actions (followup_sequence_key);

-- Reconciliation (idempotent, non-destructive): rows this migration's own
-- schema fix makes irrelevant going forward - a pre-existing `planned`
-- schedule_followup row with no schedule can never legitimately execute and
-- was never going to be selected by the worker anyway. Reclassified to the
-- existing `failed` status with a fixed, named failure_reason - never
-- deleted, never given an invented scheduled_for. attempt_number/max_attempts
-- are left exactly as they were (typically 1/1), which naturally keeps
-- `attempt_number < max_attempts` false, so selectDueFollowUps's own
-- 'failed' branch never re-selects these rows either - no code change
-- required to keep them terminal. Re-running this UPDATE is always safe: a
-- row it already reclassified no longer matches `status = 'planned'`.
UPDATE crm_agent_actions
  SET status = 'failed',
      failure_reason = 'missing_schedule',
      updated_at = UTC_TIMESTAMP(3)
  WHERE action_type = 'schedule_followup'
    AND status = 'planned'
    AND scheduled_for IS NULL;
