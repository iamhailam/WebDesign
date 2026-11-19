-- Up Migration
SET LOCAL ROLE db_admin;

CREATE FUNCTION app.fn_calculate_voucher_discount(
  p_voucher_code TEXT,
  p_user_id INT,
  p_subtotal NUMERIC
) RETURNS NUMERIC(12,2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_code TEXT;
  v_voucher app.vouchers%ROWTYPE;
  v_now TIMESTAMPTZ;
  v_discount NUMERIC;
BEGIN
  IF p_user_id IS NULL OR p_user_id <= 0 THEN
    RAISE EXCEPTION 'Invalid user id' USING ERRCODE = 'P2001';
  END IF;
  IF p_subtotal IS NULL OR p_subtotal = 'NaN'::numeric OR p_subtotal < 0 OR p_subtotal > 9999999999.99 THEN
    RAISE EXCEPTION 'Order subtotal out of range' USING ERRCODE = 'P2002';
  END IF;

  v_code := NULLIF(upper(btrim(coalesce(p_voucher_code, ''))), '');
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Voucher code is required' USING ERRCODE = 'P1002', DETAIL = 'NOT_FOUND';
  END IF;

  SELECT * INTO v_voucher FROM app.vouchers WHERE code = v_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found' USING ERRCODE = 'P1002', DETAIL = 'NOT_FOUND';
  END IF;

  v_now := clock_timestamp();
  IF NOT v_voucher.is_active THEN
    RAISE EXCEPTION 'Voucher is inactive' USING ERRCODE = 'P1002', DETAIL = 'INACTIVE';
  END IF;
  IF v_now < v_voucher.start_date THEN
    RAISE EXCEPTION 'Voucher has not started' USING ERRCODE = 'P1002', DETAIL = 'NOT_STARTED';
  END IF;
  IF v_now > v_voucher.end_date THEN
    RAISE EXCEPTION 'Voucher has expired' USING ERRCODE = 'P1002', DETAIL = 'EXPIRED';
  END IF;
  IF p_subtotal < v_voucher.min_order_amount THEN
    RAISE EXCEPTION 'Order subtotal does not meet voucher minimum' USING ERRCODE = 'P1002', DETAIL = 'MIN_ORDER_NOT_MET';
  END IF;
  IF v_voucher.used_count >= v_voucher.usage_limit THEN
    RAISE EXCEPTION 'Voucher usage limit reached' USING ERRCODE = 'P1003', DETAIL = v_code;
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.voucher_usages vu
    WHERE vu.voucher_id = v_voucher.id
      AND vu.user_id = p_user_id
      AND vu.status = 'APPLIED'
  ) THEN
    RAISE EXCEPTION 'Voucher already applied by user' USING ERRCODE = 'P1004', DETAIL = v_code;
  END IF;

  IF v_voucher.discount_type = 'FIXED' THEN
    v_discount := LEAST(v_voucher.discount_value, p_subtotal);
  ELSE
    v_discount := round((p_subtotal * v_voucher.discount_value) / 100.0, 0);
    v_discount := LEAST(v_discount, COALESCE(v_voucher.max_discount_amount, p_subtotal), p_subtotal);
  END IF;

  RETURN GREATEST(0::numeric, LEAST(v_discount, p_subtotal))::NUMERIC(12,2);
END $$;

CREATE FUNCTION app.fn_place_order(
  p_user_id INT,
  p_shipping_info JSONB,
  p_voucher_code TEXT DEFAULT NULL,
  p_request_key UUID DEFAULT NULL,
  p_expected_cart_version BIGINT DEFAULT NULL,
  p_expected_items JSONB DEFAULT NULL
) RETURNS TABLE(order_id INT, order_code VARCHAR(32), replayed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user app.users%ROWTYPE;
  v_shipping_address TEXT;
  v_recipient_name TEXT;
  v_recipient_phone TEXT;
  v_voucher_code TEXT;
  v_payload JSONB;
  v_existing_req RECORD;
  v_cart app.carts%ROWTYPE;
  v_cart_count INT;
  v_exp_count INT;
  v_line RECORD;
  v_stock INT;
  v_subtotal NUMERIC := 0;
  v_discount NUMERIC(12,2) := 0.00;
  v_final NUMERIC(12,2);
  v_voucher_id INT;
  v_order_id INT;
  v_order_code VARCHAR(32);
  v_options JSONB;
BEGIN
  IF p_user_id IS NULL OR p_user_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_user FROM app.users WHERE id = p_user_id;
  IF NOT FOUND OR NOT v_user.is_active OR v_user.role <> 'CUSTOMER' THEN
    RAISE EXCEPTION 'Only active CUSTOMER accounts can place orders' USING ERRCODE = 'P3001';
  END IF;

  IF p_shipping_info IS NULL OR jsonb_typeof(p_shipping_info) <> 'object' THEN
    RAISE EXCEPTION 'Shipping info must be a JSON object' USING ERRCODE = 'P2001';
  END IF;
  v_shipping_address := btrim(coalesce(p_shipping_info->>'shipping_address', ''));
  v_recipient_name := btrim(coalesce(p_shipping_info->>'recipient_name', ''));
  v_recipient_phone := btrim(coalesce(p_shipping_info->>'recipient_phone', ''));
  IF length(v_shipping_address) < 10 OR length(v_shipping_address) > 500
     OR length(v_recipient_name) < 1 OR length(v_recipient_name) > 120
     OR v_recipient_phone !~ '^\+?[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'Invalid shipping details' USING ERRCODE = 'P2001';
  END IF;

  IF p_voucher_code IS NOT NULL THEN
    v_voucher_code := NULLIF(upper(btrim(p_voucher_code)), '');
    IF v_voucher_code IS NULL OR length(v_voucher_code) > 40 THEN
      RAISE EXCEPTION 'Invalid voucher code format' USING ERRCODE = 'P2001';
    END IF;
  END IF;

  IF p_expected_items IS NOT NULL THEN
    IF jsonb_typeof(p_expected_items) <> 'array'
       OR jsonb_array_length(p_expected_items) < 1
       OR jsonb_array_length(p_expected_items) > 100 THEN
      RAISE EXCEPTION 'expected_items must be an array of 1..100 items' USING ERRCODE = 'P2001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_expected_items) AS e(item)
      WHERE jsonb_typeof(e.item) <> 'object'
        OR coalesce(e.item->>'variant_id', '') !~ '^[1-9][0-9]*$'
        OR coalesce(e.item->>'quantity', '') !~ '^[1-9][0-9]{0,2}$'
        OR coalesce(e.item->>'unit_price', '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
    ) THEN
      RAISE EXCEPTION 'Invalid element in expected_items' USING ERRCODE = 'P2001';
    END IF;
    SELECT count(*) INTO v_exp_count FROM jsonb_array_elements(p_expected_items) AS e(item);
    IF v_exp_count <> (SELECT count(DISTINCT (e.item->>'variant_id')::int) FROM jsonb_array_elements(p_expected_items) AS e(item)) THEN
      RAISE EXCEPTION 'Duplicate variant_id in expected_items' USING ERRCODE = 'P2001';
    END IF;
  END IF;

  IF p_request_key IS NOT NULL THEN
    v_payload := jsonb_build_object(
      'shipping_address', v_shipping_address,
      'recipient_name', v_recipient_name,
      'recipient_phone', v_recipient_phone,
      'voucher_code', v_voucher_code,
      'cart_version', p_expected_cart_version,
      'expected_items', CASE
        WHEN p_expected_items IS NULL THEN 'null'::jsonb
        ELSE (
          SELECT jsonb_agg(
            jsonb_build_object(
              'variant_id', (e.item->>'variant_id')::int,
              'quantity', (e.item->>'quantity')::int,
              'unit_price', ((e.item->>'unit_price')::numeric(12,2))::text
            ) ORDER BY (e.item->>'variant_id')::int
          )
          FROM jsonb_array_elements(p_expected_items) AS e(item)
        )
      END
    );

    INSERT INTO app.checkout_requests(user_id, request_key, request_payload)
    VALUES (p_user_id, p_request_key, v_payload)
    ON CONFLICT (user_id, request_key) DO NOTHING;

    IF NOT FOUND THEN
      SELECT cr.request_payload, cr.order_id, o.order_code
      INTO v_existing_req
      FROM app.checkout_requests cr
      LEFT JOIN app.orders o ON o.id = cr.order_id
      WHERE cr.user_id = p_user_id AND cr.request_key = p_request_key;

      IF v_existing_req.request_payload IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'Idempotency key reused with different payload' USING ERRCODE = 'P1009';
      END IF;
      IF v_existing_req.order_id IS NULL THEN
        RAISE EXCEPTION 'Idempotency key state invalid' USING ERRCODE = 'P1009';
      END IF;

      order_id := v_existing_req.order_id;
      order_code := v_existing_req.order_code;
      replayed := TRUE;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Lock order 2: Customer cart FOR UPDATE
  SELECT * INTO v_cart FROM app.carts c WHERE c.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart not found for customer' USING ERRCODE = 'P1005';
  END IF;

  IF p_expected_cart_version IS NOT NULL AND v_cart.version <> p_expected_cart_version THEN
    RAISE EXCEPTION 'Cart version changed' USING ERRCODE = 'P1006', DETAIL = v_cart.version::text;
  END IF;

  SELECT count(*) INTO v_cart_count FROM app.cart_items ci WHERE ci.cart_id = v_cart.id;
  IF v_cart_count = 0 THEN
    RAISE EXCEPTION 'Cart is empty' USING ERRCODE = 'P1005';
  END IF;

  IF p_expected_items IS NOT NULL THEN
    IF v_cart_count <> v_exp_count OR EXISTS (
      SELECT 1
      FROM app.cart_items ci
      FULL OUTER JOIN (
        SELECT (e.item->>'variant_id')::int AS variant_id, (e.item->>'quantity')::int AS quantity
        FROM jsonb_array_elements(p_expected_items) AS e(item)
      ) ex ON ex.variant_id = ci.variant_id
      WHERE ci.cart_id = v_cart.id AND (ex.variant_id IS NULL OR ci.quantity <> ex.quantity)
    ) OR EXISTS (
      SELECT 1
      FROM (
        SELECT (e.item->>'variant_id')::int AS variant_id, (e.item->>'quantity')::int AS quantity
        FROM jsonb_array_elements(p_expected_items) AS e(item)
      ) ex
      LEFT JOIN app.cart_items ci ON ci.cart_id = v_cart.id AND ci.variant_id = ex.variant_id
      WHERE ci.variant_id IS NULL OR ci.quantity <> ex.quantity
    ) THEN
      RAISE EXCEPTION 'Cart items changed since checkout preview' USING ERRCODE = 'P1006', DETAIL = v_cart.version::text;
    END IF;
  END IF;

  -- Lock order 3: Catalog FOR SHARE in deterministic ascending order (brands -> categories -> products -> variants)
  PERFORM 1 FROM app.brands b
  WHERE b.id IN (
    SELECT DISTINCT p.brand_id
    FROM app.cart_items ci
    JOIN app.product_variants v ON v.id = ci.variant_id
    JOIN app.products p ON p.id = v.product_id
    WHERE ci.cart_id = v_cart.id
  )
  ORDER BY b.id ASC
  FOR SHARE;

  PERFORM 1 FROM app.categories c
  WHERE c.id IN (
    SELECT DISTINCT p.category_id
    FROM app.cart_items ci
    JOIN app.product_variants v ON v.id = ci.variant_id
    JOIN app.products p ON p.id = v.product_id
    WHERE ci.cart_id = v_cart.id
  )
  ORDER BY c.id ASC
  FOR SHARE;

  PERFORM 1 FROM app.products p
  WHERE p.id IN (
    SELECT DISTINCT v.product_id
    FROM app.cart_items ci
    JOIN app.product_variants v ON v.id = ci.variant_id
    WHERE ci.cart_id = v_cart.id
  )
  ORDER BY p.id ASC
  FOR SHARE;

  PERFORM 1 FROM app.product_variants v
  WHERE v.id IN (
    SELECT ci.variant_id FROM app.cart_items ci WHERE ci.cart_id = v_cart.id
  )
  ORDER BY v.id ASC
  FOR SHARE;

  IF EXISTS (
    SELECT 1
    FROM app.cart_items ci
    JOIN app.product_variants v ON v.id = ci.variant_id
    JOIN app.products p ON p.id = v.product_id
    JOIN app.brands b ON b.id = p.brand_id
    JOIN app.categories c ON c.id = p.category_id
    WHERE ci.cart_id = v_cart.id
      AND NOT (b.is_active AND c.is_active AND p.is_active AND v.is_active)
  ) THEN
    RAISE EXCEPTION 'Cart contains inactive or unavailable item' USING ERRCODE = 'P1008';
  END IF;

  IF p_expected_items IS NOT NULL AND EXISTS (
    SELECT 1
    FROM (
      SELECT (e.item->>'variant_id')::int AS variant_id, (e.item->>'unit_price')::numeric(12,2) AS unit_price
      FROM jsonb_array_elements(p_expected_items) AS e(item)
    ) ex
    JOIN app.product_variants v ON v.id = ex.variant_id
    WHERE v.price <> ex.unit_price
  ) THEN
    RAISE EXCEPTION 'Item price changed before checkout' USING ERRCODE = 'P1007';
  END IF;

  -- Lock order 4: Inventory sorted by variant_id ASC (FOR UPDATE row-by-row) & deduct stock
  FOR v_line IN
    SELECT ci.variant_id, ci.quantity, v.price, v.list_price, v.sku,
           p.name AS product_name, b.name AS brand_name
    FROM app.cart_items ci
    JOIN app.product_variants v ON v.id = ci.variant_id
    JOIN app.products p ON p.id = v.product_id
    JOIN app.brands b ON b.id = p.brand_id
    WHERE ci.cart_id = v_cart.id
    ORDER BY ci.variant_id ASC
  LOOP
    SELECT i.quantity INTO v_stock
    FROM app.inventory i
    WHERE i.variant_id = v_line.variant_id
    FOR UPDATE;

    IF NOT FOUND OR v_stock < v_line.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', v_line.variant_id
        USING ERRCODE = 'P1001', DETAIL = format('variant_id=%s,available=%s', v_line.variant_id, COALESCE(v_stock, 0));
    END IF;

    UPDATE app.inventory
    SET quantity = quantity - v_line.quantity
    WHERE variant_id = v_line.variant_id;

    v_subtotal := v_subtotal + (v_line.price * v_line.quantity);
  END LOOP;

  IF v_subtotal > 9999999999.99 THEN
    RAISE EXCEPTION 'Order subtotal exceeds numeric(12,2) limit' USING ERRCODE = 'P2002';
  END IF;

  -- Lock order 5: Voucher FOR UPDATE & calculate discount
  IF v_voucher_code IS NOT NULL THEN
    SELECT v.id INTO v_voucher_id
    FROM app.vouchers v
    WHERE v.code = v_voucher_code
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Voucher not found' USING ERRCODE = 'P1002', DETAIL = 'NOT_FOUND';
    END IF;

    v_discount := app.fn_calculate_voucher_discount(v_voucher_code, p_user_id, v_subtotal);

    UPDATE app.vouchers
    SET used_count = used_count + 1
    WHERE id = v_voucher_id;
  END IF;

  v_final := (v_subtotal - v_discount)::NUMERIC(12,2);

  -- Lock order 6: Insert order, order_items snapshots, ledger EXPORT_ORDER, voucher usage, clear cart
  INSERT INTO app.orders(
    user_id, shipping_address, recipient_name, recipient_phone,
    subtotal_amount, discount_amount, final_amount, voucher_code_snapshot
  ) VALUES (
    p_user_id, v_shipping_address, v_recipient_name, v_recipient_phone,
    v_subtotal::NUMERIC(12,2), v_discount, v_final, v_voucher_code
  )
  RETURNING id, orders.order_code INTO v_order_id, v_order_code;

  FOR v_line IN
    SELECT ci.variant_id, ci.quantity, v.price, v.list_price, v.sku,
           p.name AS product_name, b.name AS brand_name
    FROM app.cart_items ci
    JOIN app.product_variants v ON v.id = ci.variant_id
    JOIN app.products p ON p.id = v.product_id
    JOIN app.brands b ON b.id = p.brand_id
    WHERE ci.cart_id = v_cart.id
    ORDER BY ci.variant_id ASC
  LOOP
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'code', a.code,
          'label', a.name,
          'value_code', av.code,
          'value_label', av.label
        ) ORDER BY a.id
      ),
      '[]'::jsonb
    )
    INTO v_options
    FROM app.variant_attribute_values vav
    JOIN app.attributes a ON a.id = vav.attribute_id
    JOIN app.attribute_values av ON av.id = vav.value_id
    WHERE vav.variant_id = v_line.variant_id;

    INSERT INTO app.order_items(
      order_id, variant_id, quantity, unit_price, list_unit_price,
      product_name, brand_name, sku, options_snapshot
    ) VALUES (
      v_order_id, v_line.variant_id, v_line.quantity, v_line.price, v_line.list_price,
      v_line.product_name, v_line.brand_name, v_line.sku, v_options
    );

    INSERT INTO app.inventory_transactions(
      variant_id, type, quantity_change, reference_type, reference_id, note, created_by
    ) VALUES (
      v_line.variant_id, 'EXPORT_ORDER', -v_line.quantity, 'ORDER', v_order_id,
      'Order checkout ' || v_order_code, p_user_id
    );
  END LOOP;

  IF v_voucher_id IS NOT NULL THEN
    INSERT INTO app.voucher_usages(voucher_id, user_id, order_id, status)
    VALUES (v_voucher_id, p_user_id, v_order_id, 'APPLIED');
  END IF;

  DELETE FROM app.cart_items WHERE cart_id = v_cart.id;
  UPDATE app.carts SET version = version + 1 WHERE id = v_cart.id;

  IF p_request_key IS NOT NULL THEN
    UPDATE app.checkout_requests cr
    SET order_id = v_order_id
    WHERE cr.user_id = p_user_id AND cr.request_key = p_request_key;
  END IF;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes)
  VALUES (
    p_user_id,
    'USER',
    'ORDER_PLACED',
    'ORDER',
    v_order_code,
    jsonb_build_object(
      'order_id', v_order_id,
      'status', 'PENDING',
      'subtotal_amount', (v_subtotal::NUMERIC(12,2))::text,
      'discount_amount', v_discount::text,
      'final_amount', v_final::text,
      'voucher_code', v_voucher_code
    )
  );

  order_id := v_order_id;
  order_code := v_order_code;
  replayed := FALSE;
  RETURN NEXT;
END $$;

CREATE FUNCTION app.fn_cancel_order(
  p_order_id INT,
  p_actor_id INT,
  p_reason TEXT DEFAULT NULL
) RETURNS app.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_actor app.users%ROWTYPE;
  v_order app.orders%ROWTYPE;
  v_updated app.orders%ROWTYPE;
  v_item RECORD;
  v_usage RECORD;
  v_reason TEXT;
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'Invalid order id' USING ERRCODE = 'P2001';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;

  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active THEN
    RAISE EXCEPTION 'Actor account is inactive or missing' USING ERRCODE = 'P3001';
  END IF;

  -- Lock order first (consistent with ARCHITECTURE lock order step 2)
  SELECT * INTO v_order FROM app.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P4001';
  END IF;

  IF v_actor.role = 'CUSTOMER' THEN
    IF v_order.user_id <> p_actor_id THEN
      RAISE EXCEPTION 'Customer cannot cancel another user order' USING ERRCODE = 'P3001';
    END IF;
  ELSIF v_actor.role NOT IN ('SALES', 'ADMIN') THEN
    RAISE EXCEPTION 'Role not permitted to cancel orders' USING ERRCODE = 'P3001';
  END IF;

  IF v_order.status NOT IN ('PENDING', 'CONFIRMED') THEN
    RAISE EXCEPTION 'Order in status % cannot be cancelled', v_order.status
      USING ERRCODE = 'P1010', DETAIL = v_order.status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM app.inventory_transactions it
    WHERE it.reference_type = 'ORDER'
      AND it.reference_id = p_order_id
      AND it.type = 'RETURN_CANCEL'
  ) THEN
    RAISE EXCEPTION 'Order inventory already returned' USING ERRCODE = 'P1010', DETAIL = v_order.status;
  END IF;

  v_reason := NULLIF(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Cancellation reason too long' USING ERRCODE = 'P2001';
  END IF;

  -- Lock & restore inventory in variant_id ASC order
  FOR v_item IN
    SELECT oi.variant_id, oi.quantity
    FROM app.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.variant_id ASC
  LOOP
    PERFORM 1 FROM app.inventory i WHERE i.variant_id = v_item.variant_id FOR UPDATE;

    UPDATE app.inventory
    SET quantity = quantity + v_item.quantity
    WHERE variant_id = v_item.variant_id;

    INSERT INTO app.inventory_transactions(
      variant_id, type, quantity_change, reference_type, reference_id, note, created_by
    ) VALUES (
      v_item.variant_id, 'RETURN_CANCEL', v_item.quantity, 'ORDER', p_order_id,
      COALESCE(v_reason, 'Order cancelled ' || v_order.order_code), p_actor_id
    );
  END LOOP;

  -- Lock voucher BEFORE voucher_usages (consistent with ARCHITECTURE lock order step 5)
  SELECT vu.id, vu.voucher_id, vu.status
  INTO v_usage
  FROM app.voucher_usages vu
  WHERE vu.order_id = p_order_id;

  IF FOUND THEN
    PERFORM 1 FROM app.vouchers v WHERE v.id = v_usage.voucher_id FOR UPDATE;
    SELECT vu.id, vu.voucher_id, vu.status
    INTO v_usage
    FROM app.voucher_usages vu
    WHERE vu.order_id = p_order_id
    FOR UPDATE;

    IF v_usage.status = 'APPLIED' THEN
      UPDATE app.voucher_usages
      SET status = 'RELEASED'
      WHERE id = v_usage.id;

      UPDATE app.vouchers
      SET used_count = used_count - 1
      WHERE id = v_usage.voucher_id;
    END IF;
  END IF;

  UPDATE app.orders
  SET status = 'CANCELLED'
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes)
  VALUES (
    p_actor_id,
    'USER',
    'ORDER_CANCELLED',
    'ORDER',
    v_order.order_code,
    jsonb_build_object(
      'order_id', p_order_id,
      'from_status', v_order.status,
      'to_status', 'CANCELLED',
      'reason', v_reason
    )
  );

  RETURN v_updated;
END $$;

CREATE FUNCTION app.fn_transition_order(
  p_order_id INT,
  p_actor_id INT,
  p_expected_status VARCHAR(16),
  p_target_status VARCHAR(16)
) RETURNS app.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_actor app.users%ROWTYPE;
  v_order app.orders%ROWTYPE;
  v_updated app.orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'Invalid order id' USING ERRCODE = 'P2001';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;

  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('SALES', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active SALES or ADMIN accounts may transition orders' USING ERRCODE = 'P3001';
  END IF;

  SELECT * INTO v_order FROM app.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P4001';
  END IF;

  IF v_order.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Stale order status' USING ERRCODE = 'P1011', DETAIL = v_order.status;
  END IF;

  IF NOT (
    (v_order.status = 'PENDING' AND p_target_status = 'CONFIRMED') OR
    (v_order.status = 'CONFIRMED' AND p_target_status = 'SHIPPING') OR
    (v_order.status = 'SHIPPING' AND p_target_status = 'DELIVERED')
  ) THEN
    RAISE EXCEPTION 'Invalid status transition' USING ERRCODE = 'P1011', DETAIL = v_order.status;
  END IF;

  IF p_target_status = 'DELIVERED' THEN
    UPDATE app.orders
    SET status = 'DELIVERED', payment_status = 'PAID', delivered_at = clock_timestamp()
    WHERE id = p_order_id
    RETURNING * INTO v_updated;
  ELSE
    UPDATE app.orders
    SET status = p_target_status
    WHERE id = p_order_id
    RETURNING * INTO v_updated;
  END IF;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes)
  VALUES (
    p_actor_id,
    'USER',
    'ORDER_STATUS_CHANGED',
    'ORDER',
    v_order.order_code,
    jsonb_build_object(
      'order_id', p_order_id,
      'from_status', v_order.status,
      'to_status', p_target_status,
      'payment_status', v_updated.payment_status
    )
  );

  RETURN v_updated;
END $$;

CREATE PROCEDURE app.sp_import_inventory(
  p_variant_id INT,
  p_quantity INT,
  p_note TEXT,
  p_staff_id INT,
  p_request_key UUID,
  OUT p_transaction_id BIGINT,
  OUT p_replayed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_staff app.users%ROWTYPE;
  v_note TEXT;
  v_existing app.inventory_transactions%ROWTYPE;
  v_current_qty INT;
BEGIN
  IF p_variant_id IS NULL OR p_variant_id <= 0 THEN
    RAISE EXCEPTION 'Invalid variant id' USING ERRCODE = 'P2001';
  END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;

  SELECT * INTO v_staff FROM app.users WHERE id = p_staff_id;
  IF NOT FOUND OR NOT v_staff.is_active OR v_staff.role NOT IN ('WAREHOUSE', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active WAREHOUSE or ADMIN accounts may import inventory' USING ERRCODE = 'P3001';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 999999 THEN
    RAISE EXCEPTION 'Import quantity out of range' USING ERRCODE = 'P2002';
  END IF;

  v_note := NULLIF(btrim(coalesce(p_note, '')), '');
  IF v_note IS NULL OR length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Import note is required (1..1000 chars)' USING ERRCODE = 'P2001';
  END IF;

  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'Import request_key is required' USING ERRCODE = 'P2001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('import:' || p_staff_id::text || ':' || p_request_key::text, 0)
  );

  SELECT * INTO v_existing
  FROM app.inventory_transactions it
  WHERE it.type = 'IMPORT'
    AND it.created_by = p_staff_id
    AND it.request_key = p_request_key;

  IF FOUND THEN
    IF v_existing.variant_id = p_variant_id
       AND v_existing.quantity_change = p_quantity
       AND v_existing.note = v_note THEN
      p_transaction_id := v_existing.id;
      p_replayed := TRUE;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Import idempotency key reused with different payload' USING ERRCODE = 'P1009';
  END IF;

  SELECT i.quantity INTO v_current_qty
  FROM app.inventory i
  WHERE i.variant_id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant inventory not found' USING ERRCODE = 'P4001';
  END IF;

  IF v_current_qty::bigint + p_quantity::bigint > 2147483647 THEN
    RAISE EXCEPTION 'Inventory quantity exceeds integer limit' USING ERRCODE = 'P2002';
  END IF;

  UPDATE app.inventory
  SET quantity = quantity + p_quantity
  WHERE variant_id = p_variant_id;

  INSERT INTO app.inventory_transactions(
    variant_id, type, quantity_change, reference_type, note, created_by, request_key
  ) VALUES (
    p_variant_id, 'IMPORT', p_quantity, 'IMPORT', v_note, p_staff_id, p_request_key
  )
  RETURNING id INTO p_transaction_id;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes)
  VALUES (
    p_staff_id,
    'USER',
    'INVENTORY_IMPORTED',
    'INVENTORY',
    p_variant_id::text,
    jsonb_build_object(
      'transaction_id', p_transaction_id,
      'variant_id', p_variant_id,
      'quantity_change', p_quantity
    )
  );

  p_replayed := FALSE;
END $$;

-- SPEC §3.2 4-argument overload delegating to the idempotent procedure
CREATE PROCEDURE app.sp_import_inventory(
  p_variant_id INT,
  p_quantity INT,
  p_note TEXT,
  p_staff_id INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_tx_id BIGINT;
  v_replayed BOOLEAN;
BEGIN
  CALL app.sp_import_inventory(
    p_variant_id,
    p_quantity,
    p_note,
    p_staff_id,
    gen_random_uuid(),
    v_tx_id,
    v_replayed
  );
END $$;

REVOKE ALL ON FUNCTION
  app.fn_calculate_voucher_discount(TEXT, INT, NUMERIC),
  app.fn_place_order(INT, JSONB, TEXT, UUID, BIGINT, JSONB),
  app.fn_cancel_order(INT, INT, TEXT),
  app.fn_transition_order(INT, INT, VARCHAR, VARCHAR)
FROM PUBLIC, report_ro_user;

REVOKE ALL ON PROCEDURE
  app.sp_import_inventory(INT, INT, TEXT, INT, UUID, OUT BIGINT, OUT BOOLEAN),
  app.sp_import_inventory(INT, INT, TEXT, INT)
FROM PUBLIC, report_ro_user;

GRANT EXECUTE ON FUNCTION
  app.fn_calculate_voucher_discount(TEXT, INT, NUMERIC),
  app.fn_place_order(INT, JSONB, TEXT, UUID, BIGINT, JSONB),
  app.fn_cancel_order(INT, INT, TEXT),
  app.fn_transition_order(INT, INT, VARCHAR, VARCHAR)
TO app_rw_user;

GRANT EXECUTE ON PROCEDURE
  app.sp_import_inventory(INT, INT, TEXT, INT, UUID, OUT BIGINT, OUT BOOLEAN),
  app.sp_import_inventory(INT, INT, TEXT, INT)
TO app_rw_user;

-- Down Migration
SET LOCAL ROLE db_admin;
DROP PROCEDURE app.sp_import_inventory(INT, INT, TEXT, INT);
DROP PROCEDURE app.sp_import_inventory(INT, INT, TEXT, INT, UUID, OUT BIGINT, OUT BOOLEAN);
DROP FUNCTION app.fn_transition_order(INT, INT, VARCHAR, VARCHAR);
DROP FUNCTION app.fn_cancel_order(INT, INT, TEXT);
DROP FUNCTION app.fn_place_order(INT, JSONB, TEXT, UUID, BIGINT, JSONB);
DROP FUNCTION app.fn_calculate_voucher_discount(TEXT, INT, NUMERIC);
