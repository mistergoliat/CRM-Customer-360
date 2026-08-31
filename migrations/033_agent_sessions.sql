-- 033: Agent Session Store (SALES-AGENT-R3-A01).
--
-- Durable conversational memory for the future SalesAgentHarness
-- (docs/architecture/SALES-AGENT-R3-A00-target-architecture.md Phase 2.B).
-- Not a second business-truth store: identity, customer profile, selected
-- products, shipping, quote, order and follow-up schedule stay owned by
-- their existing tables (master_customer, crm_request_facts, crm_quotes,
-- crm_agent_actions, ...). A session may only record that something was
-- discussed or that an action occurred.
--
-- Two small tables, same engine (MariaDB, per ADR-009 - no dual-write, no
-- second persistence engine), mirroring commercial_event's proven
-- dedupe/correlation/causation/JSON-payload pattern (migration 011) rather
-- than reusing that table directly: commercial_event's event_type is a
-- closed enum already serving ~15 unrelated audit concerns and it has no
-- session-grouping column, so entangling a new, ordered per-session log into
-- it would widen its blast radius for what this task requires to stay a
-- narrow, additive slice (see docs/releases/SALES-AGENT-R3-A01-agent-session-store.md
-- Phase 1 audit for the full comparison).

CREATE TABLE IF NOT EXISTS agent_sessions (
  id VARCHAR(64) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  summary_json JSON NULL,
  summary_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  summary_updated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- Enforces the permanent "conversation 1 --- 1 active AgentSession"
  -- invariant (R3-A01 task brief, Phase 2) at the DB level, not just in code.
  UNIQUE KEY uq_agent_sessions_conversation_id (conversation_id),
  CONSTRAINT fk_agent_sessions_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_session_events (
  id VARCHAR(64) NOT NULL,
  -- Monotonic append-order tiebreaker, distinct from `id` (a content hash of
  -- dedupe_key, never an ordering signal) and from `occurred_at` (business
  -- time, which a caller may legitimately supply out of order - e.g. a
  -- delayed redelivery - so it cannot be the sole ORDER BY key either). SQL
  -- ORDER BY has no stability guarantee, so two events inserted within the
  -- same millisecond need a real tiebreaker column, not an assumption.
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(64) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  correlation_id VARCHAR(191) NOT NULL,
  causation_id VARCHAR(191) NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  payload_json JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- Append-only, database-level dedupe - a repeat appendEvent() call with the
  -- same dedupeKey can never create a second row (Phase 4/11 of the task brief).
  UNIQUE KEY uq_agent_session_events_dedupe_key (dedupe_key),
  UNIQUE KEY uq_agent_session_events_seq (seq),
  KEY idx_agent_session_events_session_created (session_id, occurred_at, seq),
  KEY idx_agent_session_events_correlation_id (correlation_id),
  KEY idx_agent_session_events_conversation_id (conversation_id),
  CONSTRAINT fk_agent_session_events_session
    FOREIGN KEY (session_id)
    REFERENCES agent_sessions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS agent_session_events;
-- DROP TABLE IF EXISTS agent_sessions;
