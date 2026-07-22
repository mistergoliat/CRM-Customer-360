-- 026: Sales Agent Configuration domain (ACS-R1-05.1-T02.3A).
--
-- Editable Sales Agent prompt configuration, PesasChile only
-- (SALES_AGENT_CONFIGURATION_SCOPE = "pesas_chile" in
-- lib/brain/commercial/sales-agent-configuration/constants.ts). Draft ->
-- published -> archived lifecycle with immutable version history: a
-- publish never edits a previous row, it archives it and activates a new
-- one. No prompt builder, provider, or Hub UI wiring is added by this
-- migration - domain/persistence only.
--
-- No tenant/channel FK: scope_key is a plain string matched at the
-- application layer against the single constant above. Multi-tenant
-- resolution is explicitly out of scope for this task.
--
-- published_scope_key is a stored generated column, NULL unless
-- status = 'published'. MariaDB allows any number of NULLs in a UNIQUE
-- KEY, so draft/archived rows never collide with each other - only two
-- 'published' rows for the same scope_key would, which is exactly the
-- invariant this enforces at the database level (at most one published
-- configuration per scope), not just in TypeScript.
--
-- configuration_hash is indexed, not unique: rollback, cloning, and two
-- versions sharing identical content must all remain possible.
--
-- Rollback (additive-only, safe before any application code depends on it):
--   DROP TABLE IF EXISTS sales_agent_configurations;

CREATE TABLE IF NOT EXISTS sales_agent_configurations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope_key VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  version INT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  configuration_json JSON NOT NULL,
  configuration_hash CHAR(64) NOT NULL,
  parent_configuration_id BIGINT UNSIGNED NULL,
  created_by VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  archived_at DATETIME(3) NULL,

  published_scope_key VARCHAR(191)
    GENERATED ALWAYS AS (
      CASE
        WHEN status = 'published' THEN scope_key
        ELSE NULL
      END
    ) STORED,

  PRIMARY KEY (id),

  UNIQUE KEY uq_sales_agent_config_scope_version (
    scope_key,
    version
  ),

  UNIQUE KEY uq_sales_agent_config_one_published_per_scope (
    published_scope_key
  ),

  KEY idx_sales_agent_config_scope_status (
    scope_key,
    status
  ),

  KEY idx_sales_agent_config_hash (
    configuration_hash
  ),

  KEY idx_sales_agent_config_parent (
    parent_configuration_id
  ),

  KEY idx_sales_agent_config_published_at (
    published_at
  ),

  CONSTRAINT fk_sales_agent_config_parent
    FOREIGN KEY (parent_configuration_id)
    REFERENCES sales_agent_configurations(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,

  CONSTRAINT chk_sales_agent_config_status
    CHECK (status IN ('draft', 'published', 'archived'))
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
