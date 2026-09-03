-- 035: Inbound turn settlement (SALES-AGENT-R3-V1.8.1).
--
-- Durable technical state for debouncing rapid WhatsApp inbound fragments
-- ("hola" / "como" / "estas" as three separate webhook deliveries) into one
-- cognitive R3 turn. conversation_message stays the sole canonical inbound
-- transcript - this table never stores message bodies, never rewrites a
-- conversation_message row, and never represents a commercial/cognitive
-- decision. status is an execution state (did the settle-and-run-R3 attempt
-- happen, and did its dispatch survive supersession), never a business
-- state like intent/topic/nextStep - see the release doc's Section G/AB for
-- the audit that ruled out reusing agent_sessions/crm_commercial_work/
-- brain_message_outbox before adding this table.
--
-- One row = one candidate turn for one conversation. At most one PENDING row
-- may exist per conversation at a time, enforced at the DB level (not just in
-- application code) via a generated column that is NULL for every non-PENDING
-- row - MariaDB unique indexes never collide on NULL, so COMPLETED/SUPERSEDED
-- history and a concurrently-PROCESSING row never block a fresh PENDING row
-- for the same conversation (same generated-unique-column technique already
-- used by migration 026's published_scope_key).
--
-- first_inbound_message_id/latest_inbound_message_id/superseded_by_message_id
-- deliberately reference conversation_message.id by value only, never by FK -
-- this table's lifecycle (a debounce window measured in seconds) must never
-- be entangled with conversation_message's own FK/cascade graph.
--
-- Rollback:
--   DROP TABLE IF EXISTS crm_inbound_turn_settlements;

CREATE TABLE IF NOT EXISTS crm_inbound_turn_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  wa_id VARCHAR(64) NOT NULL,
  phone_number_id VARCHAR(64) NOT NULL,
  first_inbound_message_id BIGINT UNSIGNED NOT NULL,
  latest_inbound_message_id BIGINT UNSIGNED NOT NULL,
  -- Meta wamid of the latest fragment - the typing-indicator/mark-read call
  -- targets this id, never conversation_message.id (Section M of the release
  -- doc).
  latest_inbound_provider_message_id VARCHAR(191) NULL,
  fragment_count INT UNSIGNED NOT NULL DEFAULT 1,
  first_inbound_at DATETIME(3) NOT NULL,
  last_inbound_at DATETIME(3) NOT NULL,
  -- Closes when either the quiet window or the absolute max window expires,
  -- whichever is first: settle_after = LEAST(last_inbound_at + quietDelay,
  -- max_settle_at). Recomputed on every fragment that extends this row;
  -- max_settle_at itself never moves after the row is created.
  settle_after DATETIME(3) NOT NULL,
  max_settle_at DATETIME(3) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  -- conversation_message.id of the newer inbound fragment that made this
  -- turn's own dispatched response stale (Section K/L) - set only when
  -- status transitions to SUPERSEDED, null otherwise. Observability only,
  -- never read by any code path that decides behavior.
  superseded_by_message_id BIGINT UNSIGNED NULL,
  -- correlationId of the webhook delivery that most recently touched this
  -- row (trace anchor only) - the settle execution itself mints its own
  -- fresh correlationId, never reuses this one as its own.
  last_correlation_id VARCHAR(191) NULL,
  pending_scope_key VARCHAR(32) AS (CASE WHEN status = 'PENDING' THEN CONCAT('c:', conversation_id) ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_turn_settlement_pending_scope (pending_scope_key),
  KEY idx_turn_settlement_due (status, settle_after),
  KEY idx_turn_settlement_conversation_status (conversation_id, status),

  CONSTRAINT chk_turn_settlement_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'SUPERSEDED')),

  CONSTRAINT fk_turn_settlement_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
