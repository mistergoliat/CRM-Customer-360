-- Idempotent migration for master_customer.platform_origin.
-- Safe to run on environments where the column and index already exist.

CREATE TABLE IF NOT EXISTS master_customer (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  firstname VARCHAR(191) NOT NULL,
  lastname VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  platform_origin VARCHAR(32) NOT NULL DEFAULT 'unknown',
  UNIQUE KEY uq_master_customer_email (email),
  KEY idx_master_customer_platform_origin (platform_origin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @db_name := DATABASE();

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'master_customer'
    AND COLUMN_NAME = 'platform_origin'
);

SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `master_customer` ADD COLUMN `platform_origin` VARCHAR(32) NOT NULL DEFAULT ''unknown'' AFTER `email`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'master_customer'
    AND INDEX_NAME = 'idx_master_customer_platform_origin'
);

SET @sql := IF(
  @index_exists = 0,
  'CREATE INDEX `idx_master_customer_platform_origin` ON `master_customer` (`platform_origin`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
