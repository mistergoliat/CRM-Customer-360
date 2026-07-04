-- 015: ConversationRequest tracking for the multi-request conversational runtime.
-- A conversation can hold many independent requests (several of the same
-- intent_type included). The request is the unit of autonomous work;
-- crm_opportunities remains the commercial projection and is referenced,
-- never replaced. Events are append-only; message links are many-to-many.

CREATE TABLE IF NOT EXISTS crm_conversation_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  request_id VARCHAR(191) NOT NULL,
  -- Idempotency by detection event (sha256 of turn_plan_id + detection_id),
  -- never by business intent: a retry of the same turn cannot create a second
  -- request, but a new message can always create another request of the same type.
  creation_key VARCHAR(191) NOT NULL,

  conversation_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NULL,

  intent_type VARCHAR(64) NOT NULL,
  intent_domain VARCHAR(32) NOT NULL,

  status VARCHAR(32) NOT NULL DEFAULT 'detected',
  -- detected | active | waiting_customer | waiting_system | waiting_human
  -- | partially_resolved | resolved | cancelled | unresolvable
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',

  parent_request_id VARCHAR(191) NULL,

  created_from_message_id VARCHAR(191) NOT NULL,

  resolution_type VARCHAR(64) NULL,
  resolution_entity_type VARCHAR(32) NULL,
  resolution_entity_id VARCHAR(191) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_conversation_request_id (request_id),
  UNIQUE KEY uq_conversation_request_creation_key (creation_key),

  KEY idx_conversation_request_conversation (conversation_id, status, updated_at),
  KEY idx_conversation_request_opportunity (opportunity_id),
  KEY idx_conversation_request_intent (intent_type, status),

  CONSTRAINT fk_conversation_request_opportunity
    FOREIGN KEY (opportunity_id)
    REFERENCES crm_opportunities(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_request_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  request_event_id VARCHAR(191) NOT NULL,
  -- Identity of the event WITHOUT occurred_at: a retry of the same semantic
  -- event (same request + type + source) collapses to one row.
  dedupe_key VARCHAR(191) NOT NULL,

  request_id VARCHAR(191) NOT NULL,

  event_type VARCHAR(64) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  -- customer_message | planner | tool_execution | operator | system | migration
  source_id VARCHAR(191) NULL,

  payload_json JSON NULL,

  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_request_event_id (request_event_id),
  UNIQUE KEY uq_request_event_dedupe (dedupe_key),

  KEY idx_request_event_request (request_id, occurred_at),
  KEY idx_request_event_type (event_type, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_request_message_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  request_id VARCHAR(191) NOT NULL,
  -- Internal conversation_message id, never the provider message id.
  message_id VARCHAR(191) NOT NULL,

  relation_type VARCHAR(32) NOT NULL,
  -- created | continued | modified | answered | confirmed | cancelled | reopened | mentioned

  confidence DECIMAL(5,4) NULL,
  linked_by VARCHAR(32) NOT NULL,
  -- deterministic | planner | operator | migration

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_request_message_relation (request_id, message_id, relation_type),

  KEY idx_request_message_request (request_id, created_at),
  KEY idx_request_message_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_request_message_links;
-- DROP TABLE IF EXISTS crm_request_events;
-- DROP TABLE IF EXISTS crm_conversation_requests;
