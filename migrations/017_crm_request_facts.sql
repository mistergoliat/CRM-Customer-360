-- 017: Versioned facts scoped to a ConversationRequest.
-- The DB itself guarantees at most ONE active fact per (request_id, fact_key):
-- active_marker is 1 while the row is current and NULL once superseded, and
-- MariaDB/InnoDB treats each NULL as distinct inside a unique key, so only
-- active rows can collide. Updating a fact is never in-place: the current row
-- is superseded and a new version is inserted.

CREATE TABLE IF NOT EXISTS crm_request_facts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  fact_id VARCHAR(191) NOT NULL,
  request_id VARCHAR(191) NOT NULL,

  fact_key VARCHAR(64) NOT NULL,
  value_json JSON NOT NULL,

  status VARCHAR(24) NOT NULL DEFAULT 'inferred',
  -- inferred | confirmed | verified | rejected | superseded

  source_message_id VARCHAR(191) NULL,
  source_tool_execution_id VARCHAR(191) NULL,

  confidence DECIMAL(5,4) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  superseded_at DATETIME(3) NULL,

  active_marker TINYINT GENERATED ALWAYS AS (IF(superseded_at IS NULL, 1, NULL)) STORED,

  PRIMARY KEY (id),
  UNIQUE KEY uq_request_fact_id (fact_id),
  UNIQUE KEY uq_request_fact_active (request_id, fact_key, active_marker),

  KEY idx_request_fact_request (request_id, fact_key, superseded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_request_facts;
