-- Up Migration
SET LOCAL ROLE db_admin;
-- PostgreSQL's default PUBLIC EXECUTE is global within this database.
-- A per-schema REVOKE alone cannot remove that built-in global default.
ALTER DEFAULT PRIVILEGES FOR ROLE db_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Down Migration
-- Keep this database-local hardening on rollback; never silently reopen PUBLIC EXECUTE.
SELECT 1;
