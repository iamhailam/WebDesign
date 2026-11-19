-- Read-only verification; run as db_admin after migrate/restore on the target DB.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('app_rw_user','report_ro_user')
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unsafe runtime attributes';
  END IF;
  IF EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname IN ('app_rw_user','report_ro_user')) THEN
    RAISE EXCEPTION 'Runtime role membership is not allowed';
  END IF;
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='app' AND table_type='BASE TABLE') <> 22 THEN
    RAISE EXCEPTION 'Expected 22 app tables';
  END IF;
  IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='app' AND c.relkind='r' AND
      (has_table_privilege('app_rw_user',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
       OR has_table_privilege('report_ro_user',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'))) THEN
    RAISE EXCEPTION 'Unexpected direct base table privileges';
  END IF;
  IF EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app' AND has_function_privilege('report_ro_user',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'Reporting role must not execute application routines';
  END IF;
  IF has_table_privilege('app_rw_user','app.users','SELECT')
    OR has_schema_privilege('app_rw_user','app','CREATE')
    OR has_schema_privilege('app_rw_user','public','CREATE') THEN
    RAISE EXCEPTION 'Runtime has sensitive SELECT or DDL privileges';
  END IF;
  IF EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app' AND p.prosecdef AND
      (pg_get_userbyid(p.proowner) <> 'db_admin'
       OR NOT COALESCE(p.proconfig @> ARRAY['search_path=pg_catalog, app, pg_temp'],false)
       OR EXISTS (SELECT FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
                  WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))) THEN
    RAISE EXCEPTION 'Unsafe SECURITY DEFINER owner/search_path/PUBLIC ACL';
  END IF;
  IF EXISTS (SELECT FROM app.inventory i WHERE i.quantity <> COALESCE(
    (SELECT sum(t.quantity_change) FROM app.inventory_transactions t WHERE t.variant_id=i.variant_id),0)) THEN
    RAISE EXCEPTION 'Inventory reconciliation failed';
  END IF;
  IF EXISTS (SELECT FROM app.vouchers v WHERE v.used_count <> (
    SELECT count(*) FROM app.voucher_usages u WHERE u.voucher_id=v.id AND u.status='APPLIED')) THEN
    RAISE EXCEPTION 'Voucher reconciliation failed';
  END IF;
  IF EXISTS (SELECT FROM app.orders o WHERE o.subtotal_amount <> (
    SELECT sum(i.quantity*i.unit_price) FROM app.order_items i WHERE i.order_id=o.id)
    OR NOT EXISTS (SELECT FROM app.order_items i WHERE i.order_id=o.id))
    OR EXISTS (SELECT FROM app.checkout_requests WHERE order_id IS NULL) THEN
    RAISE EXCEPTION 'Order/idempotency reconciliation failed';
  END IF;
END $$;
SELECT 'Production DB verification passed (counts, ACL, routines, reconciliation)' AS result;
