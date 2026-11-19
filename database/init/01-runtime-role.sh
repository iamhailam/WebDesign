#!/bin/sh
set -eu

# psql variables quote values as SQL literals; passwords are never echoed.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --set runtime_password="$APP_DB_PASSWORD" \
  --set database_name="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE app_rw_user LOGIN PASSWORD %L', :'runtime_password') \gexec
GRANT CONNECT ON DATABASE :"database_name" TO app_rw_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_rw_user;
SQL
