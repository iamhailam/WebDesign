-- Up Migration
SET LOCAL ROLE db_admin;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['brands','categories','attributes','attribute_values','products','product_variants','product_images','banners',
    'users','carts','cart_items','vouchers','orders','order_items','inventory_transactions','voucher_usages'] LOOP
    EXECUTE format('ALTER TABLE app.%I ADD CONSTRAINT %I CHECK (id > 0)',t,t||'_positive_id');
  END LOOP;
END $$;
CREATE FUNCTION app.check_usage_order_link() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE oid INT; o app.orders; u RECORD;
BEGIN
  IF TG_TABLE_NAME='orders' THEN oid:=NEW.id; ELSE oid:=NEW.order_id; END IF;
  SELECT * INTO o FROM app.orders WHERE id=oid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT x.status,v.code INTO u FROM app.voucher_usages x JOIN app.vouchers v ON v.id=x.voucher_id WHERE x.order_id=oid;
  IF o.voucher_code_snapshot IS NULL THEN
    IF FOUND THEN RAISE EXCEPTION 'Usage requires the order voucher snapshot' USING ERRCODE='23514'; END IF;
  ELSE
    IF NOT FOUND OR u.code IS DISTINCT FROM o.voucher_code_snapshot OR
       (o.status='CANCELLED' AND u.status<>'RELEASED') OR (o.status<>'CANCELLED' AND u.status<>'APPLIED') THEN
      RAISE EXCEPTION 'Order and voucher usage must agree at commit' USING ERRCODE='23514',CONSTRAINT='usage_order_link';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER usage_order_link AFTER INSERT OR UPDATE ON app.voucher_usages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_usage_order_link();
CREATE CONSTRAINT TRIGGER order_usage_link AFTER INSERT OR UPDATE ON app.orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_usage_order_link();
REVOKE ALL ON FUNCTION app.check_usage_order_link() FROM PUBLIC,app_rw_user,report_ro_user;

-- Down Migration
SET LOCAL ROLE db_admin;
DROP TRIGGER order_usage_link ON app.orders;
DROP TRIGGER usage_order_link ON app.voucher_usages;
DROP FUNCTION app.check_usage_order_link();
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['brands','categories','attributes','attribute_values','products','product_variants','product_images','banners',
    'users','carts','cart_items','vouchers','orders','order_items','inventory_transactions','voucher_usages'] LOOP
    EXECUTE format('ALTER TABLE app.%I DROP CONSTRAINT %I',t,t||'_positive_id');
  END LOOP;
END $$;
