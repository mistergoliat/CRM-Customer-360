-- 023: Canonical multi-turn customer onboarding state (ACS-R1-04-T03).
--
-- Contract: docs/data/customer-onboarding-identity-contract.md, section 11
-- (CustomerOnboardingState). This table is the persistence for that
-- contract - one row per active conversation onboarding, surviving between
-- messages and process restarts.
--
-- Not a reuse of crm_customer_onboarding (migration 007): that table is the
-- P1M/local-ai-sdr email-lookup flow. It is keyed by conversation_case_id
-- (a legacy string case id, not conversation.id), its state enum
-- (unresolved/email_requested/customer_found/...) does not match the
-- contract's CustomerOnboardingStatus, it has no purpose field, no version
-- column for optimistic locking, and - unlike this table, which keeps
-- firstname/lastname/email/orderReference inside collected_json exactly as
-- the contract's CustomerOnboardingCollectedData allows (section 11) - it
-- exposes firstname/lastname/email as separate top-level plain columns and
-- additionally stores last_response_text, context_json and warnings_json,
-- which contract section 12 (Privacidad) does forbid here (messages,
-- prompts, arbitrary payloads). It is left intact and untouched by this
-- migration; no dual-write and no fallback are added between the two
-- tables.
--
-- Column types mirror the real referenced tables:
--   conversation_id  -> conversation.id             (BIGINT UNSIGNED, migration 008)
--   opportunity_id   -> crm_opportunities.id         (BIGINT UNSIGNED, migration 004)
--   customer_id      -> master_customer.id           (BIGINT UNSIGNED, migration 006)
--
-- "Unica fila activa por conversation_id" is enforced with a UNIQUE key -
-- there is no append-only transition history in this increment (T03 scope
-- excludes it explicitly), so exactly one row exists per conversation.
--
-- ACS-R1-04-T03.1: customer_id uses ON DELETE RESTRICT, not SET NULL. The
-- "completed" invariant (contract section 11 + 14) requires a non-null,
-- resolved customerId - silently nulling it out on a master_customer
-- deletion would leave a completed row that no longer satisfies its own
-- invariant. Deleting a master_customer that has a completed onboarding
-- must fail loudly instead. conversation_id (CASCADE) and opportunity_id
-- (SET NULL) are unaffected: neither carries a "must stay non-null once
-- completed" invariant.
--
-- A row-level CHECK (status <> 'completed' OR customer_id IS NOT NULL) was
-- attempted as well, but MariaDB 11.4 (infra/docker-compose.dev.yml)
-- rejects it: "Function or expression 'customer_id' cannot be used in the
-- CHECK clause" (error 1901) - MariaDB does not allow a column that
-- participates in a FOREIGN KEY to also be referenced by a CHECK
-- constraint on the same table, confirmed by direct reproduction (a
-- standalone CHECK on customer_id works; adding the FK on the same column,
-- via CREATE TABLE or a later ALTER TABLE, makes the identical CHECK fail
-- with the same error either way). Adding it would make this migration
-- fail to install from a clean database, which is exactly the invariant
-- ACS-R1-04-T03.1 exists to protect - so it is intentionally not present.
-- The invariant is instead enforced by ON DELETE RESTRICT above (no
-- customer referenced by a completed row can be deleted) and by the
-- domain layer (lib/domains/customer-onboarding/service.ts:
-- completeOnboarding is the only path that sets status = 'completed', and
-- it requires a non-empty customerId before doing so).

CREATE TABLE IF NOT EXISTS crm_customer_onboarding_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  conversation_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NULL,

  status VARCHAR(32) NOT NULL,
  -- required | collecting | resolving | completed | conflict |
  -- temporarily_blocked | temporarily_unavailable
  purpose VARCHAR(32) NOT NULL,
  -- quote | purchase | order_inquiry | complaint | warranty | return | account_update

  collected_json JSON NOT NULL,
  pending_fields_json JSON NOT NULL,

  customer_id BIGINT UNSIGNED NULL,
  failed_verification_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,

  version INT UNSIGNED NOT NULL DEFAULT 1,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_customer_onboarding_state_conversation_id (conversation_id),
  KEY idx_crm_customer_onboarding_state_status (status),
  KEY idx_crm_customer_onboarding_state_opportunity_id (opportunity_id),
  KEY idx_crm_customer_onboarding_state_customer_id (customer_id),

  CONSTRAINT fk_crm_customer_onboarding_state_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES conversation(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_crm_customer_onboarding_state_opportunity
    FOREIGN KEY (opportunity_id)
    REFERENCES crm_opportunities(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_crm_customer_onboarding_state_customer
    FOREIGN KEY (customer_id)
    REFERENCES master_customer(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS crm_customer_onboarding_state;
