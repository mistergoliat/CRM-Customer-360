-- P1M vertical slice: durable sales need profile store for consultative AI SDR.
-- Manual application only.

CREATE TABLE IF NOT EXISTS crm_sales_need_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profile_key VARCHAR(191) NOT NULL,
  opportunity_id BIGINT UNSIGNED NULL,
  opportunity_key VARCHAR(191) NOT NULL,
  conversation_case_id VARCHAR(191) NULL,
  wa_id VARCHAR(64) NULL,
  customer_master_id VARCHAR(191) NULL,
  customer_candidate_id VARCHAR(191) NULL,
  lead_id VARCHAR(191) NULL,
  use_case TEXT NULL,
  customer_type VARCHAR(191) NULL,
  goals_json JSON NOT NULL,
  required_features_json JSON NOT NULL,
  preferred_features_json JSON NOT NULL,
  budget_min DECIMAL(18,2) NULL,
  budget_max DECIMAL(18,2) NULL,
  available_space_json JSON NULL,
  location_json JSON NULL,
  delivery_deadline VARCHAR(64) NULL,
  experience_level VARCHAR(64) NULL,
  purchase_urgency VARCHAR(64) NULL,
  decision_readiness VARCHAR(64) NULL,
  missing_information_json JSON NOT NULL,
  source_message_id VARCHAR(191) NULL,
  last_message_text TEXT NULL,
  profile_json JSON NOT NULL,
  profile_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_sales_need_profiles_profile_key (profile_key),
  KEY idx_crm_sales_need_profiles_opportunity_id (opportunity_id),
  KEY idx_crm_sales_need_profiles_opportunity_key (opportunity_key),
  KEY idx_crm_sales_need_profiles_wa_id (wa_id),
  KEY idx_crm_sales_need_profiles_customer_master_id (customer_master_id),
  KEY idx_crm_sales_need_profiles_customer_candidate_id (customer_candidate_id),
  KEY idx_crm_sales_need_profiles_lead_id (lead_id),
  KEY idx_crm_sales_need_profiles_updated_at (updated_at),
  CONSTRAINT fk_crm_sales_need_profiles_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

