#!/bin/sh
set -eu

if [ -z "${MARIADB_ROOT_PASSWORD:-}" ]; then
  echo "MARIADB_ROOT_PASSWORD is required" >&2
  exit 1
fi

if [ -z "${CRM_DEV_ADMIN_PASSWORD:-}" ]; then
  echo "CRM_DEV_ADMIN_PASSWORD is required" >&2
  exit 1
fi

if [ -z "${DB_PASSWORD:-}" ]; then
  echo "DB_PASSWORD is required" >&2
  exit 1
fi

mysql --protocol=socket -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
ALTER USER 'crm_app'@'%' IDENTIFIED BY '${DB_PASSWORD}';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'crm_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON main_management.* TO 'crm_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_dev.* TO 'crm_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_test.* TO 'crm_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_legacy_fixture.* TO 'crm_app'@'%';
ALTER USER 'crm_dev_admin'@'%' IDENTIFIED BY '${CRM_DEV_ADMIN_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW, TRIGGER ON main_management.* TO 'crm_dev_admin'@'%';
FLUSH PRIVILEGES;
SQL
