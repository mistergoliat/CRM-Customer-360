-- 020: Versioned commercial quotes scoped to one ConversationRequest.
-- A quote is a durable, auditable document: items and totals are snapshots
-- (never live references), the delivery address is an immutable copy, and
-- modifying a quote ALWAYS creates a new version - the DB allows at most one
-- current (non-terminal) version per request via active_marker.

CREATE TABLE IF NOT EXISTS crm_quotes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  quote_id VARCHAR(191) NOT NULL,
  request_id VARCHAR(191) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,

  -- Idempotency per governed action: a retried action never duplicates a quote.
  created_by_action_id VARCHAR(191) NULL,

  version INT UNSIGNED NOT NULL DEFAULT 1,

  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  -- draft | sent | accepted | rejected | expired | superseded

  items_json JSON NOT NULL,
  totals_json JSON NOT NULL,
  address_snapshot_json JSON NULL,

  expiry_at DATETIME(3) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  decided_at DATETIME(3) NULL,

  active_marker TINYINT GENERATED ALWAYS AS (IF(status IN ('draft','sent','accepted'), 1, NULL)) STORED,

  PRIMARY KEY (id),
  UNIQUE KEY uq_quote_id (quote_id),
  UNIQUE KEY uq_quote_action (created_by_action_id),
  UNIQUE KEY uq_quote_request_active (request_id, active_marker),

  KEY idx_quote_request (request_id, version),
  KEY idx_quote_conversation (conversation_id, status),
  KEY idx_quote_status (status, expiry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_quotes;
