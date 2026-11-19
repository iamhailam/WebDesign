-- Up Migration
SET LOCAL ROLE db_admin;
-- Permit a future UPSERT of an existing cart line even when the cart has 100 lines.
CREATE OR REPLACE FUNCTION app.lock_cart_items() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.cart_id<>OLD.cart_id THEN RAISE EXCEPTION 'Cart item cannot move carts' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM app.carts WHERE id=coalesce(NEW.cart_id,OLD.cart_id) FOR UPDATE;
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT FROM app.cart_items WHERE cart_id=NEW.cart_id AND variant_id=NEW.variant_id)
     AND (SELECT count(*) FROM app.cart_items WHERE cart_id=NEW.cart_id)>=100 THEN
    RAISE EXCEPTION 'Cart line limit exceeded' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION app.guard_voucher_code() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Voucher code identity is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER voucher_code_identity BEFORE UPDATE ON app.vouchers FOR EACH ROW EXECUTE FUNCTION app.guard_voucher_code();
CREATE FUNCTION app.valid_options_snapshot(value JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,app,pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(value)='array' THEN
    NOT EXISTS(SELECT FROM jsonb_array_elements(value) AS e(item)
      WHERE jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['code','label','value_code','value_label'])
      OR jsonb_typeof(item->'code') IS DISTINCT FROM 'string' OR length(item->>'code')=0
      OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR length(item->>'label')=0
      OR jsonb_typeof(item->'value_code') IS DISTINCT FROM 'string' OR length(item->>'value_code')=0
      OR jsonb_typeof(item->'value_label') IS DISTINCT FROM 'string' OR length(item->>'value_label')=0)
    AND (SELECT count(*)=count(DISTINCT item->>'code') FROM jsonb_array_elements(value) AS e(item))
  ELSE FALSE END
$$;
ALTER TABLE app.order_items ADD CONSTRAINT order_options_snapshot_shape CHECK(app.valid_options_snapshot(options_snapshot));
REVOKE ALL ON FUNCTION app.guard_voucher_code(),app.valid_options_snapshot(JSONB) FROM PUBLIC,app_rw_user,report_ro_user;

-- Down Migration
SET LOCAL ROLE db_admin;
ALTER TABLE app.order_items DROP CONSTRAINT order_options_snapshot_shape;
DROP FUNCTION app.valid_options_snapshot(JSONB);
DROP TRIGGER voucher_code_identity ON app.vouchers;
DROP FUNCTION app.guard_voucher_code();
CREATE OR REPLACE FUNCTION app.lock_cart_items() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.cart_id<>OLD.cart_id THEN RAISE EXCEPTION 'Cart item cannot move carts' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM app.carts WHERE id=coalesce(NEW.cart_id,OLD.cart_id) FOR UPDATE;
  IF TG_OP='INSERT' AND (SELECT count(*) FROM app.cart_items WHERE cart_id=NEW.cart_id)>=100 THEN
    RAISE EXCEPTION 'Cart line limit exceeded' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
