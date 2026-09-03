-- 036: ASSIMILATED status for crm_inbound_turn_settlements (SALES-AGENT-R3-V1.8.1b-A).
--
-- Additive only - no backfill, no data migration. A sibling settlement row
-- whose entire inbound range was folded into a DIFFERENT row's active
-- cognitive run (live turn assimilation) transitions to ASSIMILATED instead
-- of COMPLETED (which would falsely imply it ran its own cognition) or
-- SUPERSEDED (which would falsely imply its content was discarded/stale -
-- the opposite of what happened: it was successfully answered by another
-- row's response). superseded_by_message_id is reused (not a new column) to
-- record the consuming run's final assimilated anchor - honest for both
-- meanings: "the message id up to which this row's own responsibility
-- ended."
--
-- Rollback:
--   ALTER TABLE crm_inbound_turn_settlements DROP CONSTRAINT chk_turn_settlement_status;
--   ALTER TABLE crm_inbound_turn_settlements ADD CONSTRAINT chk_turn_settlement_status
--     CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'SUPERSEDED'));
--   (only safe once no row has status = 'ASSIMILATED')

ALTER TABLE crm_inbound_turn_settlements
  DROP CONSTRAINT chk_turn_settlement_status;

ALTER TABLE crm_inbound_turn_settlements
  ADD CONSTRAINT chk_turn_settlement_status
  CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'SUPERSEDED', 'ASSIMILATED'));
