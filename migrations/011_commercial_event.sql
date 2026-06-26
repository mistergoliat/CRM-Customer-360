-- Commercial event store for normalized inbound and internal commercial events.
-- Manual application through the normal migration runner.

CREATE TABLE IF NOT EXISTS commercial_event (
  id VARCHAR(64) NOT NULL,
  contract_name VARCHAR(64) NOT NULL,
  schema_version VARCHAR(16) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  source VARCHAR(64) NOT NULL,
  source_event_id VARCHAR(191) NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  correlation_id VARCHAR(191) NOT NULL,
  causation_id VARCHAR(191) NULL,
  customer_id VARCHAR(64) NULL,
  conversation_id VARCHAR(64) NULL,
  opportunity_id VARCHAR(64) NULL,
  channel VARCHAR(64) NULL,
  provider VARCHAR(64) NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  payload_json JSON NOT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_commercial_event_dedupe_key (dedupe_key),
  KEY idx_commercial_event_correlation_id (correlation_id),
  KEY idx_commercial_event_conversation_id (conversation_id),
  KEY idx_commercial_event_opportunity_id (opportunity_id),
  KEY idx_commercial_event_event_type (event_type),
  KEY idx_commercial_event_occurred_at (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
