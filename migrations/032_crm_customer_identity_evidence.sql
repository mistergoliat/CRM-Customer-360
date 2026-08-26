-- 032: Durable customer identity evidence (SALES-AGENT-R2-ID-R2-A03).
--
-- Persists the per-signal IdentityEvidence[] the canonical resolver
-- (lib/domains/customer-identity, ID-R2-A02) already computes every turn,
-- but only in memory. This is NOT a second identity engine: it never
-- decides identity, never writes master_customer/customer_external_identity,
-- and is never exposed as an LLM tool. It only remembers "what signal was
-- observed, from where, how strong, and is it still current" across turns,
-- restarts and corrections.
--
-- Why a new table instead of reusing existing persistence (release spec,
-- section 1, has the full audit):
--   - commercial_event already records turn-level identity/onboarding
--     OUTCOMES (customer_identity_resolution_recorded, etc. - ACS-R1-04-T07),
--     but those are one aggregate row per turn, not one queryable row per
--     signal with a lifecycle (no supersede, no "current evidence for this
--     signal type" query without JSON functions).
--   - crm_capability_executions audits Gateway CALLS (resolve_customer/
--     create_customer/link_external_identity), not the resolver's own
--     local wa_id/phone/email/prestashop evidence, which runs every turn
--     regardless of whether a Gateway capability executes.
--   - crm_customer_onboarding_state is explicitly documented (migration 023)
--     as NOT an audit log - collectFields merges/overwrites collected_json,
--     so a correction silently loses the prior value today.
--   - customer_external_identity is the canonical CURRENT link, with no
--     history/supersede column, and was never meant to hold unverified
--     candidate signals (email/PrestaShop) that never became a link.
--
-- Decision: Option C (hybrid) from the release spec - this table is the
-- durable evidence store; commercial_event is unchanged and keeps recording
-- turn-level outcomes. No new commercial_event type was added for this
-- table, to avoid duplicating the same fact in two audit systems.
--
-- Privacy: never stores raw email/phone. signal_hash is a one-way SHA-256
-- of the normalized value (correction/dedup detection only, never
-- reversible); signal_display is a fixed-format redacted string for
-- read-only audit UI. wa_id itself is not hashed - it is already the
-- customer_external_identity.external_id exact-match key elsewhere in the
-- schema, so this table only ever references it via source_record_ref.

CREATE TABLE IF NOT EXISTS crm_customer_identity_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  evidence_id CHAR(36) NOT NULL,

  conversation_id BIGINT UNSIGNED NOT NULL,
  message_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NOT NULL,

  channel VARCHAR(32) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  channel_evidence VARCHAR(16) NULL,
  -- observed | controlled | verified (PARTE 10) - nullable, only meaningful
  -- for channel-identity signal types (wa_id today).

  signal_type VARCHAR(32) NOT NULL,
  -- wa_id | phone | email | prestashop_customer_id | order_reference | manual_verification
  source VARCHAR(32) NOT NULL,
  -- customer_external_identity | prestashop | order | manual | customer_service
  source_record_ref VARCHAR(191) NULL,
  signal_hash CHAR(64) NULL,
  signal_display VARCHAR(64) NULL,

  master_customer_id BIGINT UNSIGNED NULL,
  prestashop_customer_id VARCHAR(64) NULL,

  strength VARCHAR(16) NOT NULL,
  -- observed | candidate | strong | verified | conflict (ID-R2-A02 vocabulary)
  status VARCHAR(16) NOT NULL,
  -- OBSERVED | CANDIDATE | VERIFIED | CONFLICTED | SUPERSEDED | STALE | REVOKED

  conflict_group_id CHAR(36) NULL,
  conflict_code VARCHAR(64) NULL,

  observed_at DATETIME(3) NOT NULL,
  verified_at DATETIME(3) NULL,
  superseded_at DATETIME(3) NULL,
  superseded_by_evidence_id CHAR(36) NULL,
  stale_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,

  idempotency_key VARCHAR(191) NOT NULL,
  metadata_json JSON NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_customer_identity_evidence_evidence_id (evidence_id),
  UNIQUE KEY uq_crm_customer_identity_evidence_idempotency_key (idempotency_key),
  KEY idx_crm_customer_identity_evidence_conv_signal_status (conversation_id, signal_type, status),
  KEY idx_crm_customer_identity_evidence_master_customer (master_customer_id),
  KEY idx_crm_customer_identity_evidence_prestashop_customer (prestashop_customer_id),
  KEY idx_crm_customer_identity_evidence_conflict_group (conflict_group_id),
  KEY idx_crm_customer_identity_evidence_status (status),
  KEY idx_crm_customer_identity_evidence_correlation_id (correlation_id),

  CONSTRAINT fk_crm_customer_identity_evidence_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_crm_customer_identity_evidence_master_customer
    FOREIGN KEY (master_customer_id)
    REFERENCES master_customer(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_customer_identity_evidence;
