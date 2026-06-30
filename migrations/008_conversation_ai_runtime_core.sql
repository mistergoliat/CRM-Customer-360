CREATE TABLE IF NOT EXISTS conversation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  channel_account_id VARCHAR(191) NOT NULL,
  external_contact_id VARCHAR(191) NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  owner_type VARCHAR(32) NOT NULL DEFAULT 'ai_sdr',
  owner_id VARCHAR(191) NULL,
  ai_enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_message_at DATETIME(3) NULL,
  last_inbound_at DATETIME(3) NULL,
  last_outbound_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversation_public_id (public_id),
  UNIQUE KEY uq_conversation_channel_contact (channel, channel_account_id, external_contact_id),
  KEY idx_conversation_customer_id (customer_id),
  KEY idx_conversation_status (status),
  KEY idx_conversation_last_message_at (last_message_at),
  CONSTRAINT fk_conversation_customer
    FOREIGN KEY (customer_id)
    REFERENCES master_customer(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_message (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_message_id VARCHAR(191) NULL,
  direction VARCHAR(16) NOT NULL,
  sender_type VARCHAR(32) NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  body TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'received',
  reply_to_message_id BIGINT UNSIGNED NULL,
  provider_timestamp DATETIME(3) NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversation_message_public_id (public_id),
  UNIQUE KEY uq_provider_message (provider, provider_message_id),
  KEY idx_message_conversation_created (conversation_id, created_at),
  KEY idx_message_direction (direction),
  KEY idx_message_status (status),
  CONSTRAINT fk_message_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_message_reply
    FOREIGN KEY (reply_to_message_id)
    REFERENCES conversation_message(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_agent_execution (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  trigger_message_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,
  agent_type VARCHAR(64) NOT NULL,
  trigger_type VARCHAR(32) NOT NULL,
  execution_mode VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  error_code VARCHAR(100) NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_execution_public_id (public_id),
  KEY idx_ai_execution_conversation (conversation_id, created_at),
  KEY idx_ai_execution_status (status),
  CONSTRAINT fk_execution_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_execution_trigger_message
    FOREIGN KEY (trigger_message_id)
    REFERENCES conversation_message(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_execution_customer
    FOREIGN KEY (customer_id)
    REFERENCES master_customer(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_agent_decision (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  execution_id BIGINT UNSIGNED NOT NULL,
  intent VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  tool_name VARCHAR(100) NULL,
  confidence DECIMAL(5,4) NULL,
  requires_customer_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  requires_human_approval TINYINT(1) NOT NULL DEFAULT 0,
  policy_tags_json JSON NULL,
  arguments_json JSON NULL,
  reason_summary TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_decision_public_id (public_id),
  KEY idx_ai_decision_execution (execution_id),
  CONSTRAINT fk_decision_execution
    FOREIGN KEY (execution_id)
    REFERENCES ai_agent_execution(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_tool_execution (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  execution_id BIGINT UNSIGNED NOT NULL,
  decision_id BIGINT UNSIGNED NULL,
  tool_name VARCHAR(100) NOT NULL,
  input_json JSON NULL,
  output_json JSON NULL,
  status VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  error_code VARCHAR(100) NULL,
  error_message TEXT NULL,
  started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_tool_public_id (public_id),
  UNIQUE KEY uq_ai_tool_idempotency (idempotency_key),
  KEY idx_ai_tool_execution (execution_id),
  KEY idx_ai_tool_status (status),
  CONSTRAINT fk_tool_execution
    FOREIGN KEY (execution_id)
    REFERENCES ai_agent_execution(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_tool_decision
    FOREIGN KEY (decision_id)
    REFERENCES ai_agent_decision(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_conversation_state (
  conversation_id BIGINT UNSIGNED NOT NULL,
  agent_type VARCHAR(64) NOT NULL,
  state VARCHAR(64) NOT NULL,
  pending_action VARCHAR(100) NULL,
  state_data_json JSON NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (conversation_id, agent_type),
  CONSTRAINT fk_ai_state_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
