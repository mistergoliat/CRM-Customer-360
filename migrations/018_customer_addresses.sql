-- 018: Customer addresses as an independent entity owned by master_customer.
-- A customer holds zero..N active addresses; none lives inside master_customer.
-- is_default only SUGGESTS - selecting and confirming an address is always a
-- per-request decision recorded as a request fact, never inherited between
-- requests. created_by_action_id makes creation idempotent per agent action.

CREATE TABLE IF NOT EXISTS customer_addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  address_id VARCHAR(191) NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,

  created_by_action_id VARCHAR(191) NULL,
  -- Detects likely duplicates (same normalized street/number/commune); not unique
  -- because customers legitimately re-register similar addresses.
  normalized_address_hash VARCHAR(64) NULL,

  address_label VARCHAR(64) NULL,
  recipient_name VARCHAR(191) NULL,
  recipient_phone VARCHAR(32) NULL,

  street_name VARCHAR(191) NOT NULL,
  street_number VARCHAR(32) NOT NULL,
  unit VARCHAR(64) NULL,

  commune VARCHAR(128) NOT NULL,
  city VARCHAR(128) NULL,
  region VARCHAR(128) NOT NULL,
  postal_code VARCHAR(32) NULL,

  delivery_notes TEXT NULL,

  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_address_id (address_id),
  UNIQUE KEY uq_customer_address_action (created_by_action_id),

  KEY idx_customer_addresses_customer (customer_id, is_active, updated_at),
  KEY idx_customer_address_hash (customer_id, normalized_address_hash),

  CONSTRAINT fk_customer_addresses_customer
    FOREIGN KEY (customer_id)
    REFERENCES master_customer(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS customer_addresses;
