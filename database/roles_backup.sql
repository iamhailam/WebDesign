-- PostgreSQL Roles, Grants Baseline & Backup/Restore Guide (Task 03)
-- No passwords or secrets are stored in this file.
-- Set role passwords out-of-band via environment/vault or interactive psql \password.
-- Run sections 1-4 after schema migrations (or split sections 1-2 before pg_restore on an empty DB).

BEGIN;

-- 1. Cluster-wide role creation (idempotent, least-privilege attributes)
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
  IF EXISTS (
    SELECT FROM pg_roles
    WHERE rolname IN ('app_rw_user', 'report_ro_user')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Runtime/report roles must not have administrative attributes';
  END IF;
END $$;

-- 2. Database & schema baseline grants (replace <db_name> when executing outside psql variable)
-- GRANT CONNECT ON DATABASE <db_name> TO app_rw_user, report_ro_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_rw_user, report_ro_user;

-- 3. Default function privileges for db_admin in target database
SET LOCAL ROLE db_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE db_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 4. Least-privilege grants (Task 03 baseline: fail-closed on base tables)
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC, app_rw_user, report_ro_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC, app_rw_user, report_ro_user;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, app_rw_user, report_ro_user;

GRANT SELECT ON
  app.vw_public_brands,
  app.vw_public_categories,
  app.vw_catalog_products,
  app.vw_catalog_variants,
  app.vw_catalog_variant_options,
  app.vw_catalog_images,
  app.vw_product_type_options,
  app.vw_public_banners
TO app_rw_user;

GRANT SELECT ON
  app.vw_revenue_summary,
  app.vw_best_selling_products
TO report_ro_user;

GRANT EXECUTE ON FUNCTION
  app.fn_calculate_voucher_discount(TEXT, INT, NUMERIC),
  app.fn_place_order(INT, JSONB, TEXT, UUID, BIGINT, JSONB),
  app.fn_cancel_order(INT, INT, TEXT),
  app.fn_transition_order(INT, INT, VARCHAR, VARCHAR),
  app.fn_register_customer(TEXT, TEXT, TEXT, TEXT),
  app.fn_get_login_record(TEXT),
  app.fn_get_actor(INT),
  app.fn_read_users(INT, INT, INT, TEXT, VARCHAR, BOOLEAN),
  app.fn_read_user(INT, INT),
  app.fn_manage_user(INT, INT, TEXT, TEXT, VARCHAR, BOOLEAN, UUID),
  app.fn_read_admin_brands(INT, INT, INT, TEXT, BOOLEAN),
  app.fn_read_admin_brand(INT, INT),
  app.fn_upsert_brand(INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID),
  app.fn_read_admin_categories(INT, INT, INT, TEXT, BOOLEAN),
  app.fn_read_admin_category(INT, INT),
  app.fn_upsert_category(INT, INT, TEXT, TEXT, TEXT, BOOLEAN, UUID),
  app.fn_read_admin_products(INT, INT, INT, TEXT, INT, INT, VARCHAR, BOOLEAN),
  app.fn_read_admin_product(INT, INT),
  app.fn_upsert_product(INT, INT, TEXT, TEXT, INT, INT, VARCHAR, TEXT, BOOLEAN, UUID),
  app.fn_create_variant(INT, INT, TEXT, NUMERIC, NUMERIC, JSONB, BOOLEAN, UUID),
  app.fn_update_variant(INT, INT, NUMERIC, NUMERIC, BOOLEAN, UUID),
  app.fn_add_product_image(INT, INT, INT, TEXT, TEXT, INT, BOOLEAN, UUID),
  app.fn_update_product_image(INT, INT, TEXT, TEXT, INT, BOOLEAN, UUID),
  app.fn_delete_product_image(INT, INT, UUID),
  app.fn_read_admin_banners(INT, INT, INT, VARCHAR, BOOLEAN),
  app.fn_read_admin_banner(INT, INT),
  app.fn_manage_banner(INT, INT, TEXT, TEXT, TEXT, TEXT, VARCHAR, VARCHAR, INT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, BOOLEAN, UUID),
  app.fn_read_cart(INT),
  app.fn_mutate_cart(INT, VARCHAR, INT, INT),
  app.fn_read_available_vouchers(INT, INT, INT),
  app.fn_preview_voucher(INT, TEXT, BIGINT, NUMERIC),
  app.fn_read_my_orders(INT, INT, INT, VARCHAR),
  app.fn_read_order_detail(INT, INT),
  app.fn_read_orders(INT, INT, INT, VARCHAR, TEXT, INT),
  app.fn_read_inventory(INT, INT, INT, TEXT, INT),
  app.fn_read_inventory_transaction(INT, BIGINT),
  app.fn_read_inventory_transactions(INT, INT, INT, INT, VARCHAR, INT, DATE, DATE),
  app.fn_read_vouchers(INT, INT, INT, TEXT, BOOLEAN),
  app.fn_read_voucher_by_id(INT, INT),
  app.fn_manage_voucher(INT, INT, VARCHAR, VARCHAR, NUMERIC, NUMERIC, NUMERIC, INT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, UUID),
  app.fn_read_voucher_usages(INT, INT, INT, INT, VARCHAR),
  app.fn_read_revenue_report(INT, DATE, DATE, VARCHAR, INT, INT),
  app.fn_read_best_sellers_report(INT, DATE, DATE, VARCHAR, INT, INT),
  app.fn_read_audit_events(INT, INT, INT, INT, VARCHAR, TEXT, VARCHAR, DATE, DATE)
TO app_rw_user;

GRANT EXECUTE ON PROCEDURE
  app.sp_import_inventory(INT, INT, TEXT, INT, UUID, OUT BIGINT, OUT BOOLEAN),
  app.sp_import_inventory(INT, INT, TEXT, INT)
TO app_rw_user;

COMMIT;

-- 5. Backup & Restore Rehearsal Reference (run from shell, NOT inside SQL transaction)
-- Docker local backup (custom format, schema + data + pgmigrations, excluding cluster globals):
--   docker compose exec -T postgres pg_dump -U db_admin -d fashion_dev --format=custom --no-owner --no-acl -f /tmp/fashion_backup.dump
--   docker compose cp postgres:/tmp/fashion_backup.dump ./fashion_backup.dump   (store outside git repo!)
--
-- Restore rehearsal into a fresh disposable database:
--   docker compose exec -T postgres psql -U db_admin -d postgres -c "CREATE DATABASE fashion_restore_test TEMPLATE template0;"
--   Execute roles setup (section 1-2 above) and ensure db_admin owns schema app.
--   docker compose exec -T postgres pg_restore -U db_admin -d fashion_restore_test --no-owner --role=db_admin /tmp/fashion_backup.dump
--   Re-apply grants from section 4 and verify table counts, constraints, and views.
