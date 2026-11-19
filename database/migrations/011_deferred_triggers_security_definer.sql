-- Up Migration
SET LOCAL ROLE db_admin;
ALTER FUNCTION app.preserve_dependent_row() SECURITY DEFINER;
ALTER FUNCTION app.check_variant_options() SECURITY DEFINER;
ALTER FUNCTION app.check_product_published() SECURITY DEFINER;
ALTER FUNCTION app.check_order_total() SECURITY DEFINER;
ALTER FUNCTION app.check_usage_order_link() SECURITY DEFINER;
REVOKE ALL ON FUNCTION
  app.preserve_dependent_row(),
  app.check_variant_options(),
  app.check_product_published(),
  app.check_order_total(),
  app.check_usage_order_link()
FROM PUBLIC, app_rw_user, report_ro_user;

-- Down Migration
SET LOCAL ROLE db_admin;
ALTER FUNCTION app.check_usage_order_link() SECURITY INVOKER;
ALTER FUNCTION app.check_order_total() SECURITY INVOKER;
ALTER FUNCTION app.check_product_published() SECURITY INVOKER;
ALTER FUNCTION app.check_variant_options() SECURITY INVOKER;
ALTER FUNCTION app.preserve_dependent_row() SECURITY INVOKER;
