-- 025: outcome idempotency key + opportunity delivery projection.
--
-- ACS-R1-05-T04 (P1-3, P1-4). Forward-only, additive, data-preserving.
--
-- 1) crm_action_outcomes gets a deterministic dedupe key
--    (sha256("delivery|<provider>|<provider_message_id>|<outcome_type>"), 64
--    hex chars) so two concurrent/duplicate webhooks for the same provider
--    message + outcome type leave exactly one row. Nullable so existing
--    outcomes without a key remain valid and readable; a unique index over a
--    nullable column allows any number of NULLs in MariaDB (legacy rows never
--    collide with each other or with new keyed rows).
--
-- 2) crm_opportunities gets a queryable projection of the last relevant
--    outbound delivery status, so delivery outcomes stop being a dead end at
--    crm_action_outcomes/brain_message_outbox. This is a projection only -
--    it never drives status/stage/temperature/next_action.
--
-- Rollback (additive, safe to reverse without data loss on pre-existing columns):
--   ALTER TABLE crm_action_outcomes DROP KEY uq_crm_action_outcomes_dedupe_key, DROP COLUMN outcome_dedupe_key;
--   ALTER TABLE crm_opportunities
--     DROP COLUMN last_outbound_outbox_message_id,
--     DROP COLUMN last_outbound_provider_message_id,
--     DROP COLUMN last_outbound_delivery_status,
--     DROP COLUMN last_outbound_delivery_status_at;

ALTER TABLE crm_action_outcomes
  ADD COLUMN IF NOT EXISTS outcome_dedupe_key VARCHAR(64) NULL AFTER outcome_type,
  ADD UNIQUE KEY IF NOT EXISTS uq_crm_action_outcomes_dedupe_key (outcome_dedupe_key);

ALTER TABLE crm_opportunities
  ADD COLUMN IF NOT EXISTS last_outbound_outbox_message_id BIGINT UNSIGNED NULL AFTER next_action_due_at,
  ADD COLUMN IF NOT EXISTS last_outbound_provider_message_id VARCHAR(255) NULL AFTER last_outbound_outbox_message_id,
  ADD COLUMN IF NOT EXISTS last_outbound_delivery_status VARCHAR(32) NULL AFTER last_outbound_provider_message_id,
  ADD COLUMN IF NOT EXISTS last_outbound_delivery_status_at DATETIME(3) NULL AFTER last_outbound_delivery_status,
  ADD KEY IF NOT EXISTS idx_crm_opportunities_last_outbound_outbox_message_id (last_outbound_outbox_message_id);
