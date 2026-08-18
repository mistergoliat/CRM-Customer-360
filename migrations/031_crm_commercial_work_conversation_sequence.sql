-- 031: Conversation-scoped CommercialWork sequencing (SALES-AGENT-R2-A08).
--
-- A commercial_sequence orders external/commercial triggers for one
-- conversation. It is deliberately separate from crm_commercial_work.version:
-- sequence orders triggers, version protects aggregate mutations.
--
-- Rollback:
--   ALTER TABLE crm_commercial_work DROP INDEX idx_crm_commercial_work_source_sequence;
--   ALTER TABLE crm_commercial_work DROP INDEX idx_crm_commercial_work_lineage;
--   ALTER TABLE crm_commercial_work DROP COLUMN supersedes_work_public_id;
--   ALTER TABLE crm_commercial_work DROP COLUMN previous_work_public_id;
--   ALTER TABLE crm_commercial_work DROP COLUMN last_reconciled_sequence;
--   ALTER TABLE crm_commercial_work DROP COLUMN source_sequence;
--   DROP TABLE IF EXISTS crm_commercial_trigger_sequences;
--   DROP TABLE IF EXISTS crm_commercial_conversation_sequences;

CREATE TABLE IF NOT EXISTS crm_commercial_conversation_sequences (
  conversation_id BIGINT UNSIGNED NOT NULL,
  current_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (conversation_id),

  CONSTRAINT fk_crm_commercial_conversation_sequences_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_commercial_trigger_sequences (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  trigger_dedupe_key VARCHAR(191) NOT NULL,
  trigger_type VARCHAR(64) NOT NULL,
  source_message_id BIGINT UNSIGNED NULL,
  commercial_sequence BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_commercial_trigger_sequence_dedupe (conversation_id, trigger_dedupe_key),
  UNIQUE KEY uq_crm_commercial_trigger_sequence_value (conversation_id, commercial_sequence),
  KEY idx_crm_commercial_trigger_sequence_source_message (source_message_id),

  CONSTRAINT fk_crm_commercial_trigger_sequences_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE crm_commercial_work
  ADD COLUMN source_sequence BIGINT UNSIGNED NULL AFTER source_message_id,
  ADD COLUMN last_reconciled_sequence BIGINT UNSIGNED NULL AFTER source_sequence,
  ADD COLUMN previous_work_public_id VARCHAR(64) NULL AFTER cancel_reason,
  ADD COLUMN supersedes_work_public_id VARCHAR(64) NULL AFTER previous_work_public_id,
  ADD KEY idx_crm_commercial_work_source_sequence (conversation_id, source_sequence),
  ADD KEY idx_crm_commercial_work_lineage (previous_work_public_id, supersedes_work_public_id);
