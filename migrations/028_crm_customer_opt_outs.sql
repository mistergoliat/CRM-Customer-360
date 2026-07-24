-- 028: Customer opt-out registry (ACS-R1-05.1-T02.3D, decision 11).
--
-- Minimal, channel-scoped "this identity must never receive another
-- autonomous outbound message" record. Deliberately NOT part of
-- crm_agent_actions or the follow-up domain - an opt-out cancels every
-- future autonomous send (inbound replies AND follow-ups), not just
-- scheduled follow-ups, so it lives as its own small table checked at
-- native-cycle Step 0.5 (before the LLM ever runs) and by the follow-up
-- worker's cancellation checks.
--
-- One row per (wa_id, channel) - recordCustomerOptOut is an idempotent
-- INSERT IGNORE (a customer sending "STOP" twice is not two opt-outs).
-- wa_id VARCHAR(64) matches the majority convention across this codebase
-- (migrations 003/004/007/009) - migration 005's VARCHAR(32) on
-- crm_agent_actions.wa_id is the one outlier, not the norm.

CREATE TABLE IF NOT EXISTS crm_customer_opt_outs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  wa_id VARCHAR(64) NOT NULL,
  channel VARCHAR(32) NOT NULL DEFAULT 'whatsapp',

  -- explicit_customer_command (only source implemented by this task) -
  -- reserved for a future operator-initiated opt-out, never inferred.
  reason VARCHAR(64) NOT NULL,
  source_message_id VARCHAR(191) NULL,

  opted_out_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_customer_opt_outs_wa_id_channel (wa_id, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_customer_opt_outs;
