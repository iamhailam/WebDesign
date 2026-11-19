-- Up Migration
-- Roles are cluster-wide: preserve existing passwords and never drop roles on rollback.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'db_admin') THEN
    CREATE ROLE db_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw_user') THEN
    CREATE ROLE app_rw_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'report_ro_user') THEN
    CREATE ROLE report_ro_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('app_rw_user','report_ro_user')
             AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Runtime/report roles must not have administrative attributes';
  END IF;
END $$;
SET LOCAL ROLE db_admin;
CREATE SCHEMA app AUTHORIZATION db_admin;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_rw_user, report_ro_user;

CREATE DOMAIN app.asset_path AS TEXT
  CHECK (VALUE IS NULL OR (length(VALUE) <= 500
    AND VALUE ~ '^/(images|media)/[A-Za-z0-9/_-]+\.(png|jpg|jpeg|webp|avif|svg)$'
    AND position('//' IN VALUE) = 0));

-- Down Migration
SET LOCAL ROLE db_admin;
DROP DOMAIN app.asset_path;
DROP SCHEMA app;
-- Deliberately leave cluster roles/passwords/memberships intact.
