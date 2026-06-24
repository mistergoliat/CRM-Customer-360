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

mysql --protocol=socket -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
ALTER USER 'crm_dev_admin'@'%' IDENTIFIED BY '${CRM_DEV_ADMIN_PASSWORD}';
FLUSH PRIVILEGES;
SQL
