CREATE TABLE IF NOT EXISTS ai_orchestrator_shadow_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  wa_id VARCHAR(40) NULL,
  phone_number_id VARCHAR(80) NULL,
  message_id VARCHAR(180) NOT NULL,
  conversation_case_id BIGINT NULL,

  backend_decision_id VARCHAR(120) NULL,
  backend_intent VARCHAR(80) NULL,
  backend_department VARCHAR(80) NULL,
  backend_final_action VARCHAR(80) NULL,
  backend_requires_human TINYINT(1) NULL,
  backend_should_reply TINYINT(1) NULL,
  backend_confidence DECIMAL(5,4) NULL,
  backend_ok TINYINT(1) NOT NULL DEFAULT 0,
  backend_error VARCHAR(500) NULL,

  current_n8n_intent VARCHAR(80) NULL,
  current_n8n_department VARCHAR(80) NULL,
  current_n8n_final_action VARCHAR(80) NULL,

  matched_intent TINYINT(1) NULL,
  matched_department TINYINT(1) NULL,
  matched_final_action TINYINT(1) NULL,

  latency_ms INT UNSIGNED NULL,
  raw_request_json JSON NULL,
  raw_response_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ai_shadow_message_id (message_id),
  INDEX idx_ai_shadow_wa_created (wa_id, created_at),
  INDEX idx_ai_shadow_case_created (conversation_case_id, created_at),
  INDEX idx_ai_shadow_backend_decision (backend_decision_id),
  INDEX idx_ai_shadow_created_at (created_at)
);
