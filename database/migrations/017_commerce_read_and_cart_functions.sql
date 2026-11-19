-- Up Migration
SET LOCAL ROLE db_admin;

CREATE FUNCTION app.fn_assert_customer_actor(p_actor_id INT) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_actor app.users%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'CUSTOMER' THEN
    RAISE EXCEPTION 'Only active CUSTOMER accounts may perform this action' USING ERRCODE = 'P3001';
  END IF;
END $$;

CREATE FUNCTION app.fn_read_cart(p_actor_id INT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_cart app.carts%ROWTYPE;
  v_items JSONB;
  v_subtotal NUMERIC(12,2);
  v_has_stock_issues BOOLEAN;
  v_has_unavailable BOOLEAN;
BEGIN
  PERFORM app.fn_assert_customer_actor(p_actor_id);

  SELECT * INTO v_cart FROM app.carts WHERE user_id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart not found' USING ERRCODE = 'P4001';
  END IF;

  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'variant_id', v.id,
        'sku', v.sku,
        'product_id', p.id,
        'product_name', p.name,
        'product_slug', p.slug,
        'options', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'attribute_id', a.id,
              'code', a.code,
              'label', CASE WHEN a.unit IS NOT NULL THEN a.name || ' (' || a.unit || ')' ELSE a.name END,
              'value_id', av.id,
              'value_code', av.code,
              'value_label', av.label
            ) ORDER BY a.id ASC
          )
          FROM app.variant_attribute_values vav
          JOIN app.attributes a ON a.id = vav.attribute_id
          JOIN app.attribute_values av ON av.id = vav.value_id
          WHERE vav.variant_id = v.id
        ), '[]'::jsonb),
        'image_url', COALESCE(
          (SELECT pi.asset_path::text FROM app.product_images pi
           WHERE pi.variant_id = v.id ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC LIMIT 1),
          (SELECT pi.asset_path::text FROM app.product_images pi
           WHERE pi.product_id = p.id AND pi.variant_id IS NULL ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC LIMIT 1)
        ),
        'quantity', ci.quantity,
        'unit_price', v.price::numeric(12,2)::text,
        'list_price', v.list_price::numeric(12,2)::text,
        'line_amount', (v.price * ci.quantity)::numeric(12,2)::text,
        'stock_quantity', inv.quantity,
        'available', (b.is_active AND c.is_active AND p.is_active AND v.is_active),
        'issue_code', CASE
          WHEN NOT (b.is_active AND c.is_active AND p.is_active AND v.is_active) THEN 'ITEM_UNAVAILABLE'
          WHEN inv.quantity < ci.quantity THEN 'OUT_OF_STOCK'
          ELSE NULL
        END
      ) ORDER BY ci.added_at ASC, ci.id ASC
    ), '[]'::jsonb),
    COALESCE(SUM(v.price * ci.quantity), 0)::numeric(12,2),
    COALESCE(bool_or(b.is_active AND c.is_active AND p.is_active AND v.is_active AND inv.quantity < ci.quantity), FALSE),
    COALESCE(bool_or(NOT (b.is_active AND c.is_active AND p.is_active AND v.is_active)), FALSE)
  INTO v_items, v_subtotal, v_has_stock_issues, v_has_unavailable
  FROM app.cart_items ci
  JOIN app.product_variants v ON v.id = ci.variant_id
  JOIN app.products p ON p.id = v.product_id
  JOIN app.brands b ON b.id = p.brand_id
  JOIN app.categories c ON c.id = p.category_id
  JOIN app.inventory inv ON inv.variant_id = v.id
  WHERE ci.cart_id = v_cart.id;

  RETURN jsonb_build_object(
    'id', v_cart.id,
    'version', v_cart.version::text,
    'items', v_items,
    'subtotal_amount', v_subtotal::text,
    'has_stock_issues', v_has_stock_issues,
    'has_unavailable_items', v_has_unavailable
  );
END $$;

CREATE FUNCTION app.fn_mutate_cart(
  p_actor_id INT,
  p_operation VARCHAR(16),
  p_variant_id INT,
  p_quantity INT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_cart app.carts%ROWTYPE;
  v_is_avail BOOLEAN;
  v_existing_qty INT;
BEGIN
  PERFORM app.fn_assert_customer_actor(p_actor_id);

  IF p_variant_id IS NULL OR p_variant_id <= 0 THEN
    RAISE EXCEPTION 'Invalid variant id' USING ERRCODE = 'P2001';
  END IF;

  SELECT * INTO v_cart FROM app.carts WHERE user_id = p_actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart not found' USING ERRCODE = 'P4001';
  END IF;

  IF p_operation IN ('ADD', 'SET') THEN
    IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 999 THEN
      RAISE EXCEPTION 'Quantity must be between 1 and 999' USING ERRCODE = 'P2001';
    END IF;

    SELECT (b.is_active AND c.is_active AND p.is_active AND v.is_active)
    INTO v_is_avail
    FROM app.product_variants v
    JOIN app.products p ON p.id = v.product_id
    JOIN app.brands b ON b.id = p.brand_id
    JOIN app.categories c ON c.id = p.category_id
    WHERE v.id = p_variant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'P4001';
    END IF;
    IF NOT v_is_avail THEN
      RAISE EXCEPTION 'Variant is unavailable for purchase' USING ERRCODE = 'P1008';
    END IF;

    IF p_operation = 'ADD' THEN
      SELECT ci.quantity INTO v_existing_qty
      FROM app.cart_items ci
      WHERE ci.cart_id = v_cart.id AND ci.variant_id = p_variant_id;

      IF FOUND THEN
        IF v_existing_qty + p_quantity > 999 THEN
          RAISE EXCEPTION 'Cart item quantity exceeds 999' USING ERRCODE = 'P2001';
        END IF;
        UPDATE app.cart_items
        SET quantity = quantity + p_quantity
        WHERE cart_id = v_cart.id AND variant_id = p_variant_id;
      ELSE
        INSERT INTO app.cart_items(cart_id, variant_id, quantity)
        VALUES (v_cart.id, p_variant_id, p_quantity);
      END IF;
    ELSE
      UPDATE app.cart_items
      SET quantity = p_quantity
      WHERE cart_id = v_cart.id AND variant_id = p_variant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Cart item not found'
          USING ERRCODE = 'P4001', CONSTRAINT = 'cart_item_not_found';
      END IF;
    END IF;
  ELSIF p_operation = 'REMOVE' THEN
    DELETE FROM app.cart_items
    WHERE cart_id = v_cart.id AND variant_id = p_variant_id;
  ELSE
    RAISE EXCEPTION 'Invalid cart operation' USING ERRCODE = 'P2001';
  END IF;

  UPDATE app.carts SET version = version + 1 WHERE id = v_cart.id;
  RETURN app.fn_read_cart(p_actor_id);
END $$;

CREATE FUNCTION app.fn_read_available_vouchers(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20
) RETURNS TABLE(
  id INT,
  code VARCHAR(40),
  discount_type VARCHAR(8),
  discount_value NUMERIC(12,2),
  max_discount_amount NUMERIC(12,2),
  min_order_amount NUMERIC(12,2),
  usage_limit INT,
  used_count INT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  eligible_for_cart BOOLEAN,
  ineligible_reason TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_cart_count INT := 0;
  v_has_unavailable BOOLEAN := FALSE;
  v_subtotal NUMERIC := 0;
BEGIN
  PERFORM app.fn_assert_customer_actor(p_actor_id);

  SELECT
    count(*)::int,
    COALESCE(bool_or(NOT (b.is_active AND c.is_active AND p.is_active AND pv.is_active)), FALSE),
    COALESCE(SUM(pv.price * ci.quantity), 0)
  INTO v_cart_count, v_has_unavailable, v_subtotal
  FROM app.carts ct
  JOIN app.cart_items ci ON ci.cart_id = ct.id
  JOIN app.product_variants pv ON pv.id = ci.variant_id
  JOIN app.products p ON p.id = pv.product_id
  JOIN app.brands b ON b.id = p.brand_id
  JOIN app.categories c ON c.id = p.category_id
  WHERE ct.user_id = p_actor_id;

  RETURN QUERY
  WITH open_vouchers AS (
    SELECT v.id, v.code, v.discount_type, v.discount_value, v.max_discount_amount,
           v.min_order_amount, v.usage_limit, v.used_count, v.start_date, v.end_date,
           v.is_active, v.created_at,
           EXISTS (
             SELECT 1 FROM app.voucher_usages vu
             WHERE vu.voucher_id = v.id AND vu.user_id = p_actor_id AND vu.status = 'APPLIED'
           ) AS already_used
    FROM app.vouchers v
    WHERE v.is_active
      AND v_now >= v.start_date
      AND v_now <= v.end_date
      AND v.used_count < v.usage_limit
  ), annotated AS (
    SELECT ov.id, ov.code, ov.discount_type, ov.discount_value, ov.max_discount_amount,
           ov.min_order_amount, ov.usage_limit, ov.used_count, ov.start_date, ov.end_date,
           ov.is_active, ov.created_at,
           (NOT ov.already_used AND v_cart_count > 0 AND NOT v_has_unavailable AND v_subtotal >= ov.min_order_amount) AS eligible_for_cart,
           CASE
             WHEN ov.already_used THEN 'VOUCHER_ALREADY_USED'
             WHEN v_cart_count = 0 THEN 'CART_EMPTY'
             WHEN v_has_unavailable THEN 'ITEM_UNAVAILABLE'
             WHEN v_subtotal < ov.min_order_amount THEN 'MIN_ORDER_NOT_MET'
             ELSE NULL
           END AS ineligible_reason
    FROM open_vouchers ov
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM annotated
  )
  SELECT a.*, cnt.total_count
  FROM annotated a CROSS JOIN counted cnt
  ORDER BY a.end_date ASC, a.id ASC
  LIMIT v_page_size OFFSET v_offset;
END $$;

CREATE FUNCTION app.fn_preview_voucher(
  p_actor_id INT,
  p_voucher_code TEXT,
  p_cart_version BIGINT,
  p_client_subtotal NUMERIC DEFAULT NULL
) RETURNS TABLE(
  voucher_code VARCHAR(40),
  cart_version TEXT,
  subtotal_amount NUMERIC(12,2),
  discount_amount NUMERIC(12,2),
  final_amount NUMERIC(12,2),
  preview_only BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_cart app.carts%ROWTYPE;
  v_count INT;
  v_has_unavailable BOOLEAN;
  v_subtotal NUMERIC;
  v_code VARCHAR(40);
  v_discount NUMERIC(12,2);
BEGIN
  PERFORM app.fn_assert_customer_actor(p_actor_id);

  SELECT * INTO v_cart FROM app.carts WHERE user_id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart not found' USING ERRCODE = 'P1005';
  END IF;

  IF p_cart_version IS NULL OR v_cart.version <> p_cart_version THEN
    RAISE EXCEPTION 'Cart version changed' USING ERRCODE = 'P1006', DETAIL = v_cart.version::text;
  END IF;

  SELECT
    count(*)::int,
    COALESCE(bool_or(NOT (b.is_active AND c.is_active AND p.is_active AND pv.is_active)), FALSE),
    COALESCE(SUM(pv.price * ci.quantity), 0)
  INTO v_count, v_has_unavailable, v_subtotal
  FROM app.cart_items ci
  JOIN app.product_variants pv ON pv.id = ci.variant_id
  JOIN app.products p ON p.id = pv.product_id
  JOIN app.brands b ON b.id = p.brand_id
  JOIN app.categories c ON c.id = p.category_id
  WHERE ci.cart_id = v_cart.id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cart is empty' USING ERRCODE = 'P1005';
  END IF;
  IF v_has_unavailable THEN
    RAISE EXCEPTION 'Cart contains unavailable item' USING ERRCODE = 'P1008';
  END IF;
  IF v_subtotal > 9999999999.99 THEN
    RAISE EXCEPTION 'Cart subtotal out of range' USING ERRCODE = 'P2002';
  END IF;
  IF p_client_subtotal IS NOT NULL AND p_client_subtotal <> v_subtotal::numeric(12,2) THEN
    RAISE EXCEPTION 'Cart subtotal changed' USING ERRCODE = 'P1007';
  END IF;

  v_code := NULLIF(upper(btrim(coalesce(p_voucher_code, ''))), '')::varchar(40);
  v_discount := app.fn_calculate_voucher_discount(v_code, p_actor_id, v_subtotal);

  voucher_code := v_code;
  cart_version := v_cart.version::text;
  subtotal_amount := v_subtotal::numeric(12,2);
  discount_amount := v_discount;
  final_amount := (v_subtotal::numeric(12,2) - v_discount)::numeric(12,2);
  preview_only := TRUE;
  RETURN NEXT;
END $$;

CREATE FUNCTION app.fn_read_my_orders(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_status VARCHAR(16) DEFAULT NULL
) RETURNS TABLE(
  order_json JSONB,
  total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
BEGIN
  PERFORM app.fn_assert_customer_actor(p_actor_id);
  IF p_status IS NOT NULL AND p_status NOT IN ('PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid order status filter' USING ERRCODE = 'P2001';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT o.*
    FROM app.orders o
    WHERE o.user_id = p_actor_id
      AND (p_status IS NULL OR o.status = p_status)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ), paged AS (
    SELECT f.* FROM filtered f ORDER BY f.created_at DESC, f.id DESC LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    jsonb_build_object(
      'id', p.id,
      'order_code', p.order_code,
      'status', p.status,
      'payment_method', p.payment_method,
      'payment_status', p.payment_status,
      'subtotal_amount', p.subtotal_amount::numeric(12,2)::text,
      'discount_amount', p.discount_amount::numeric(12,2)::text,
      'final_amount', p.final_amount::numeric(12,2)::text,
      'voucher_code', p.voucher_code_snapshot,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'delivered_at', p.delivered_at,
      'items', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', oi.id,
            'variant_id', oi.variant_id,
            'sku', oi.sku,
            'product_name', oi.product_name,
            'brand_name', oi.brand_name,
            'options_snapshot', oi.options_snapshot,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price::numeric(12,2)::text,
            'list_unit_price', oi.list_unit_price::numeric(12,2)::text,
            'line_amount', (oi.unit_price * oi.quantity)::numeric(12,2)::text
          ) ORDER BY oi.id ASC
        )
        FROM app.order_items oi WHERE oi.order_id = p.id
      ), '[]'::jsonb)
    ) AS order_json,
    cnt.total_count
  FROM paged p
  CROSS JOIN counted cnt
  ORDER BY p.created_at DESC, p.id DESC;
END $$;

CREATE FUNCTION app.fn_read_order_detail(p_actor_id INT, p_order_id INT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_actor app.users%ROWTYPE;
  v_order app.orders%ROWTYPE;
  v_items JSONB;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active THEN
    RAISE EXCEPTION 'Actor inactive or missing' USING ERRCODE = 'P3001';
  END IF;

  IF p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'Invalid order id' USING ERRCODE = 'P2001';
  END IF;

  SELECT * INTO v_order FROM app.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P4001';
  END IF;

  IF v_actor.role = 'CUSTOMER' THEN
    IF v_order.user_id <> p_actor_id THEN
      RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P4001';
    END IF;
  ELSIF v_actor.role NOT IN ('SALES', 'ADMIN') THEN
    RAISE EXCEPTION 'Role not permitted to read order details' USING ERRCODE = 'P3001';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'variant_id', oi.variant_id,
      'sku', oi.sku,
      'product_name', oi.product_name,
      'brand_name', oi.brand_name,
      'options_snapshot', oi.options_snapshot,
      'quantity', oi.quantity,
      'unit_price', oi.unit_price::numeric(12,2)::text,
      'list_unit_price', oi.list_unit_price::numeric(12,2)::text,
      'line_amount', (oi.unit_price * oi.quantity)::numeric(12,2)::text
    ) ORDER BY oi.id ASC
  ), '[]'::jsonb)
  INTO v_items
  FROM app.order_items oi
  WHERE oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_code', v_order.order_code,
    'user_id', v_order.user_id,
    'status', v_order.status,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'subtotal_amount', v_order.subtotal_amount::numeric(12,2)::text,
    'discount_amount', v_order.discount_amount::numeric(12,2)::text,
    'final_amount', v_order.final_amount::numeric(12,2)::text,
    'voucher_code', v_order.voucher_code_snapshot,
    'recipient_name', v_order.recipient_name,
    'recipient_phone', v_order.recipient_phone,
    'shipping_address', v_order.shipping_address,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'delivered_at', v_order.delivered_at,
    'items', v_items
  );
END $$;

REVOKE ALL ON FUNCTION
  app.fn_assert_customer_actor(INT),
  app.fn_read_cart(INT),
  app.fn_mutate_cart(INT, VARCHAR, INT, INT),
  app.fn_read_available_vouchers(INT, INT, INT),
  app.fn_preview_voucher(INT, TEXT, BIGINT, NUMERIC),
  app.fn_read_my_orders(INT, INT, INT, VARCHAR),
  app.fn_read_order_detail(INT, INT)
FROM PUBLIC, report_ro_user;

GRANT EXECUTE ON FUNCTION
  app.fn_read_cart(INT),
  app.fn_mutate_cart(INT, VARCHAR, INT, INT),
  app.fn_read_available_vouchers(INT, INT, INT),
  app.fn_preview_voucher(INT, TEXT, BIGINT, NUMERIC),
  app.fn_read_my_orders(INT, INT, INT, VARCHAR),
  app.fn_read_order_detail(INT, INT)
TO app_rw_user;

-- Down Migration
SET LOCAL ROLE db_admin;
DROP FUNCTION app.fn_read_order_detail(INT, INT);
DROP FUNCTION app.fn_read_my_orders(INT, INT, INT, VARCHAR);
DROP FUNCTION app.fn_preview_voucher(INT, TEXT, BIGINT, NUMERIC);
DROP FUNCTION app.fn_read_available_vouchers(INT, INT, INT);
DROP FUNCTION app.fn_mutate_cart(INT, VARCHAR, INT, INT);
DROP FUNCTION app.fn_read_cart(INT);
DROP FUNCTION app.fn_assert_customer_actor(INT);
