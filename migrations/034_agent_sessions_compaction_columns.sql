-- 034: Agent Session compaction columns (SALES-AGENT-R3-V1.8-D1).
--
-- Additive-only preparation for a future compacted historical-message
-- prefix (docs/releases/SALES-AGENT-R3-V1.8-C-NATIVE-PERSISTENT-AGENT-SESSION-MEMORY-DESIGN.md
-- section 14). D1 only adds three nullable columns to agent_sessions
-- (migration 033) - nothing writes or reads them yet; compaction itself is
-- a later slice (D7). summary_json/summary_version/summary_updated_at
-- (migration 033) are a distinct, already-scoped concept
-- (AgentSessionSummary's tool-activity/goal projection) and are
-- deliberately left untouched here - see V1.8-D0 section 14 and V1.8-C
-- section 14 for why the two are never merged.
--
-- Idempotent (information_schema guard + dynamic SQL), matching migration
-- 006's established ALTER TABLE ADD COLUMN pattern in this repo rather than
-- inventing a new one.

SET @db_name := DATABASE();

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'agent_sessions'
    AND COLUMN_NAME = 'compacted_prefix_json'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `agent_sessions` ADD COLUMN `compacted_prefix_json` JSON NULL AFTER `summary_updated_at`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'agent_sessions'
    AND COLUMN_NAME = 'compacted_through_seq'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `agent_sessions` ADD COLUMN `compacted_through_seq` BIGINT UNSIGNED NULL AFTER `compacted_prefix_json`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'agent_sessions'
    AND COLUMN_NAME = 'compacted_prefix_updated_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `agent_sessions` ADD COLUMN `compacted_prefix_updated_at` DATETIME(3) NULL AFTER `compacted_through_seq`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Rollback:
-- ALTER TABLE `agent_sessions` DROP COLUMN `compacted_prefix_updated_at`;
-- ALTER TABLE `agent_sessions` DROP COLUMN `compacted_through_seq`;
-- ALTER TABLE `agent_sessions` DROP COLUMN `compacted_prefix_json`;
