-- Up Migration
SET LOCAL ROLE db_admin;
CREATE FUNCTION app.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['brands','products','product_variants','banners','inventory','carts','orders'] LOOP
    EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',t);
  END LOOP;
END $$;

CREATE FUNCTION app.create_dependent_row() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='users' THEN INSERT INTO app.carts(user_id) VALUES(NEW.id);
  ELSE INSERT INTO app.inventory(variant_id) VALUES(NEW.id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_create_cart AFTER INSERT ON app.users FOR EACH ROW EXECUTE FUNCTION app.create_dependent_row();
CREATE TRIGGER variants_create_inventory AFTER INSERT ON app.product_variants FOR EACH ROW EXECUTE FUNCTION app.create_dependent_row();
CREATE FUNCTION app.preserve_dependent_row() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='carts' THEN
    IF EXISTS(SELECT FROM app.users WHERE id=OLD.user_id) AND NOT EXISTS(SELECT FROM app.carts WHERE user_id=OLD.user_id) THEN
      RAISE EXCEPTION 'A user requires one cart' USING ERRCODE='23514',CONSTRAINT='users_require_cart';
    END IF;
  ELSE
    IF EXISTS(SELECT FROM app.product_variants WHERE id=OLD.variant_id) AND NOT EXISTS(SELECT FROM app.inventory WHERE variant_id=OLD.variant_id) THEN
      RAISE EXCEPTION 'A variant requires inventory' USING ERRCODE='23514',CONSTRAINT='variants_require_inventory';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER carts_preserve_one AFTER DELETE OR UPDATE ON app.carts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.preserve_dependent_row();
CREATE CONSTRAINT TRIGGER inventory_preserve_one AFTER DELETE OR UPDATE ON app.inventory DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.preserve_dependent_row();

CREATE FUNCTION app.canonical_variant_key(p_id INT) RETURNS TEXT LANGUAGE sql STABLE SET search_path=pg_catalog,app,pg_temp AS $$
  SELECT coalesce(string_agg(attribute_id::text || '=' || value_id::text, ',' ORDER BY attribute_id),'')
  FROM app.variant_attribute_values WHERE variant_id=p_id
$$;
CREATE FUNCTION app.guard_variant_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Deactivate variants instead of deleting them' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM app.products WHERE id=NEW.product_id FOR NO KEY UPDATE;
  IF TG_OP='INSERT' THEN
    NEW.created_xid := pg_current_xact_id();
    NEW.combo_key := 'pending:' || NEW.id::text;
  ELSE
    IF ROW(NEW.id,NEW.product_id,NEW.sku,NEW.created_xid) IS DISTINCT FROM ROW(OLD.id,OLD.product_id,OLD.sku,OLD.created_xid) THEN
      RAISE EXCEPTION 'Variant identity is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.combo_key IS DISTINCT FROM OLD.combo_key AND NEW.combo_key <> app.canonical_variant_key(NEW.id) THEN
      RAISE EXCEPTION 'Variant key must match its attributes' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER variants_identity BEFORE INSERT OR UPDATE OR DELETE ON app.product_variants FOR EACH ROW EXECUTE FUNCTION app.guard_variant_identity();
CREATE FUNCTION app.guard_variant_values() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE v app.product_variants; pid INT; type_code TEXT;
BEGIN
  SELECT * INTO v FROM app.product_variants WHERE id=coalesce(NEW.variant_id,OLD.variant_id);
  IF v.created_xid <> pg_current_xact_id() OR (TG_OP='UPDATE' AND NEW.variant_id<>OLD.variant_id) THEN
    RAISE EXCEPTION 'Create a new SKU instead of changing its options' USING ERRCODE='23514';
  END IF;
  SELECT id,product_type_code INTO pid,type_code FROM app.products WHERE id=v.product_id FOR NO KEY UPDATE;
  IF TG_OP<>'DELETE' AND NOT EXISTS(SELECT FROM app.product_type_attributes WHERE product_type_code=type_code AND attribute_id=NEW.attribute_id) THEN
    RAISE EXCEPTION 'Attribute is not allowed for this product type' USING ERRCODE='23514',CONSTRAINT='variant_type_attributes';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER variant_values_identity BEFORE INSERT OR UPDATE OR DELETE ON app.variant_attribute_values FOR EACH ROW EXECUTE FUNCTION app.guard_variant_values();
CREATE FUNCTION app.check_variant_options() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE vid INT; type_code TEXT; actual_key TEXT;
BEGIN
  IF TG_TABLE_NAME='product_variants' THEN vid:=NEW.id; ELSE vid:=coalesce(NEW.variant_id,OLD.variant_id); END IF;
  SELECT p.product_type_code INTO type_code FROM app.product_variants v JOIN app.products p ON p.id=v.product_id WHERE v.id=vid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS(SELECT FROM app.product_type_attributes a WHERE a.product_type_code=type_code AND a.is_required
            AND NOT EXISTS(SELECT FROM app.variant_attribute_values x WHERE x.variant_id=vid AND x.attribute_id=a.attribute_id)) THEN
    RAISE EXCEPTION 'Required SKU attributes are missing' USING ERRCODE='23514',CONSTRAINT='variant_required_attributes';
  END IF;
  actual_key:=app.canonical_variant_key(vid);
  UPDATE app.product_variants SET combo_key=actual_key WHERE id=vid AND combo_key IS DISTINCT FROM actual_key;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER variants_complete AFTER INSERT OR UPDATE ON app.product_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_variant_options();
CREATE CONSTRAINT TRIGGER variant_values_complete AFTER INSERT OR UPDATE OR DELETE ON app.variant_attribute_values DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_variant_options();

CREATE FUNCTION app.guard_product_type() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF NEW.product_type_code IS DISTINCT FROM OLD.product_type_code AND EXISTS(SELECT FROM app.product_variants WHERE product_id=OLD.id) THEN
    RAISE EXCEPTION 'Product type cannot change after SKU creation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_type_identity BEFORE UPDATE ON app.products FOR EACH ROW EXECUTE FUNCTION app.guard_product_type();
CREATE FUNCTION app.guard_type_schema() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT FROM app.products p JOIN app.product_variants v ON v.product_id=p.id
            WHERE p.product_type_code IN (NEW.product_type_code,OLD.product_type_code)) THEN
    RAISE EXCEPTION 'Used type schemas require an explicit data migration' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER type_schema_guard BEFORE INSERT OR UPDATE OR DELETE ON app.product_type_attributes FOR EACH ROW EXECUTE FUNCTION app.guard_type_schema();

CREATE FUNCTION app.lock_image_product() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.product_id,NEW.variant_id) IS DISTINCT FROM ROW(OLD.product_id,OLD.variant_id) THEN
    RAISE EXCEPTION 'Image scope is immutable' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM app.products WHERE id=coalesce(NEW.product_id,OLD.product_id) FOR NO KEY UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER images_lock_parent BEFORE INSERT OR UPDATE OR DELETE ON app.product_images FOR EACH ROW EXECUTE FUNCTION app.lock_image_product();
CREATE FUNCTION app.check_product_published() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE pid INT;
BEGIN
  IF TG_TABLE_NAME='products' THEN pid:=NEW.id; ELSE pid:=coalesce(NEW.product_id,OLD.product_id); END IF;
  IF EXISTS(SELECT FROM app.products WHERE id=pid AND is_active) AND
     (NOT EXISTS(SELECT FROM app.product_variants WHERE product_id=pid AND is_active) OR
      NOT EXISTS(SELECT FROM app.product_images WHERE product_id=pid)) THEN
    RAISE EXCEPTION 'Published products need an active SKU and an image' USING ERRCODE='23514',CONSTRAINT='product_publishable';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER products_publishable AFTER INSERT OR UPDATE ON app.products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_product_published();
CREATE CONSTRAINT TRIGGER variants_product_publishable AFTER INSERT OR UPDATE OR DELETE ON app.product_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_product_published();
CREATE CONSTRAINT TRIGGER images_product_publishable AFTER INSERT OR UPDATE OR DELETE ON app.product_images DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_product_published();

CREATE FUNCTION app.guard_order() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Orders cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' THEN RAISE EXCEPTION 'Orders start PENDING' USING ERRCODE='23514'; END IF;
    NEW.created_xid:=pg_current_xact_id();
    NEW.order_code:=coalesce(NEW.order_code,'F-'||NEW.id::text);
    RETURN NEW;
  END IF;
  IF OLD.status IN ('DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'Finalized orders are immutable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.order_code,NEW.user_id,NEW.shipping_address,NEW.recipient_name,NEW.recipient_phone,
         NEW.subtotal_amount,NEW.discount_amount,NEW.final_amount,NEW.voucher_code_snapshot,NEW.created_xid,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.order_code,OLD.user_id,OLD.shipping_address,OLD.recipient_name,OLD.recipient_phone,
         OLD.subtotal_amount,OLD.discount_amount,OLD.final_amount,OLD.voucher_code_snapshot,OLD.created_xid,OLD.created_at) THEN
    RAISE EXCEPTION 'Order snapshots are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='PENDING' AND NEW.status IN ('CONFIRMED','CANCELLED')) OR
    (OLD.status='CONFIRMED' AND NEW.status IN ('SHIPPING','CANCELLED')) OR
    (OLD.status='SHIPPING' AND NEW.status='DELIVERED')) THEN
    RAISE EXCEPTION 'Invalid order state transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_guard BEFORE INSERT OR UPDATE OR DELETE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.guard_order();
CREATE FUNCTION app.guard_order_item() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Order item snapshots are immutable' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT FROM app.orders WHERE id=NEW.order_id AND created_xid=pg_current_xact_id() AND status='PENDING') THEN
    RAISE EXCEPTION 'Items must be inserted in the order creation transaction' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_items_guard BEFORE INSERT OR UPDATE OR DELETE ON app.order_items FOR EACH ROW EXECUTE FUNCTION app.guard_order_item();
CREATE FUNCTION app.check_order_total() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE oid INT; subtotal NUMERIC; item_total NUMERIC; item_count INT;
BEGIN
  IF TG_TABLE_NAME='orders' THEN oid:=NEW.id; ELSE oid:=NEW.order_id; END IF;
  SELECT subtotal_amount INTO subtotal FROM app.orders WHERE id=oid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*),coalesce(sum(quantity*unit_price),0) INTO item_count,item_total FROM app.order_items WHERE order_id=oid;
  IF item_count=0 OR subtotal<>item_total THEN
    RAISE EXCEPTION 'Order subtotal must match at least one snapshot item' USING ERRCODE='23514',CONSTRAINT='order_items_total';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER orders_total AFTER INSERT OR UPDATE ON app.orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_order_total();
CREATE CONSTRAINT TRIGGER order_items_total AFTER INSERT ON app.order_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_order_total();

CREATE FUNCTION app.guard_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Inventory ledger is append only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON app.inventory_transactions FOR EACH ROW EXECUTE FUNCTION app.guard_append_only();
CREATE FUNCTION app.guard_usage() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Voucher usages cannot be deleted' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.voucher_id,NEW.user_id,NEW.order_id,NEW.used_at) IS DISTINCT FROM ROW(OLD.id,OLD.voucher_id,OLD.user_id,OLD.order_id,OLD.used_at)
     OR OLD.status<>'APPLIED' OR NEW.status<>'RELEASED' THEN
    RAISE EXCEPTION 'Voucher usage only transitions APPLIED to RELEASED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER usages_immutable BEFORE UPDATE OR DELETE ON app.voucher_usages FOR EACH ROW EXECUTE FUNCTION app.guard_usage();
CREATE FUNCTION app.lock_cart_items() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.cart_id<>OLD.cart_id THEN RAISE EXCEPTION 'Cart item cannot move carts' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM app.carts WHERE id=coalesce(NEW.cart_id,OLD.cart_id) FOR UPDATE;
  IF TG_OP='INSERT' AND (SELECT count(*) FROM app.cart_items WHERE cart_id=NEW.cart_id)>=100 THEN
    RAISE EXCEPTION 'Cart line limit exceeded' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cart_items_lock BEFORE INSERT OR UPDATE OR DELETE ON app.cart_items FOR EACH ROW EXECUTE FUNCTION app.lock_cart_items();
-- Trigger helpers are internal, not an application authentication API.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC,app_rw_user,report_ro_user;

-- Down Migration
SET LOCAL ROLE db_admin;
DROP TRIGGER cart_items_lock ON app.cart_items;
DROP TRIGGER usages_immutable ON app.voucher_usages;
DROP TRIGGER ledger_append_only ON app.inventory_transactions;
DROP TRIGGER order_items_total ON app.order_items;
DROP TRIGGER orders_total ON app.orders;
DROP TRIGGER order_items_guard ON app.order_items;
DROP TRIGGER orders_guard ON app.orders;
DROP TRIGGER images_product_publishable ON app.product_images;
DROP TRIGGER variants_product_publishable ON app.product_variants;
DROP TRIGGER products_publishable ON app.products;
DROP TRIGGER images_lock_parent ON app.product_images;
DROP TRIGGER type_schema_guard ON app.product_type_attributes;
DROP TRIGGER products_type_identity ON app.products;
DROP TRIGGER variant_values_complete ON app.variant_attribute_values;
DROP TRIGGER variants_complete ON app.product_variants;
DROP TRIGGER variant_values_identity ON app.variant_attribute_values;
DROP TRIGGER variants_identity ON app.product_variants;
DROP TRIGGER inventory_preserve_one ON app.inventory;
DROP TRIGGER carts_preserve_one ON app.carts;
DROP TRIGGER variants_create_inventory ON app.product_variants;
DROP TRIGGER users_create_cart ON app.users;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['brands','products','product_variants','banners','inventory','carts','orders'] LOOP
    EXECUTE format('DROP TRIGGER trg_set_updated_at ON app.%I',t);
  END LOOP;
END $$;
DROP FUNCTION app.lock_cart_items(),app.guard_usage(),app.guard_append_only(),app.check_order_total(),app.guard_order_item(),app.guard_order(),app.check_product_published(),app.lock_image_product(),app.guard_type_schema(),app.guard_product_type(),app.check_variant_options(),app.guard_variant_values(),app.guard_variant_identity(),app.canonical_variant_key(INT),app.preserve_dependent_row(),app.create_dependent_row(),app.set_updated_at();
