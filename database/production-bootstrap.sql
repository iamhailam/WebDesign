-- psql -X -v ON_ERROR_STOP=1 -f database/production-bootstrap.sql
-- Run once as the managed provider administrator on the APPROVED, empty target DB.
-- Cluster-wide role names must be reserved for this application.
BEGIN;
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
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('db_admin','app_rw_user','report_ro_user')
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Production roles must not have administrative attributes';
  END IF;
  IF EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname IN ('db_admin','app_rw_user','report_ro_user')) THEN
    RAISE EXCEPTION 'Review unexpected production role memberships';
  END IF;
END $$;
SELECT current_database() AS target_database \gset
REVOKE ALL ON DATABASE :"target_database" FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE :"target_database" TO db_admin;
GRANT CONNECT ON DATABASE :"target_database" TO app_rw_user, report_ro_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO db_admin;
COMMIT;
-- Set passwords interactively outside logs with \password db_admin / app_rw_user.
-- report_ro_user needs no password until a reporting consumer is approved.
