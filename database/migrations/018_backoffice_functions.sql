-- Up Migration
SET LOCAL ROLE db_admin;

-- 1. Orders listing for SALES & ADMIN (no full shipping_address / recipient_phone in list projection)
CREATE FUNCTION app.fn_read_orders(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_status VARCHAR(16) DEFAULT NULL,
  p_order_code TEXT DEFAULT NULL,
  p_user_id INT DEFAULT NULL
) RETURNS TABLE(order_json JSONB, total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_status VARCHAR(16) := NULLIF(upper(btrim(coalesce(p_status, ''))), '');
  v_code_pattern TEXT := NULLIF(btrim(coalesce(p_order_code, '')), '');
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('SALES', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active SALES or ADMIN accounts may read orders' USING ERRCODE = 'P3001';
  END IF;

  IF v_status IS NOT NULL AND v_status NOT IN ('PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid order status filter' USING ERRCODE = 'P2001';
  END IF;

  IF v_code_pattern IS NOT NULL THEN
    v_code_pattern := '%' || replace(replace(replace(upper(v_code_pattern), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT o.id, o.order_code, o.user_id, o.recipient_name, o.status,
           o.payment_method, o.payment_status,
           o.subtotal_amount, o.discount_amount, o.final_amount,
           o.voucher_code_snapshot, o.created_at, o.updated_at, o.delivered_at
    FROM app.orders o
    WHERE (v_status IS NULL OR o.status = v_status)
      AND (v_code_pattern IS NULL OR upper(o.order_code) LIKE v_code_pattern ESCAPE '\')
      AND (p_user_id IS NULL OR o.user_id = p_user_id)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ), paged AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    jsonb_build_object(
      'id', p.id,
      'order_code', p.order_code,
      'user_id', p.user_id,
      'recipient_name', p.recipient_name,
      'status', p.status,
      'payment_method', p.payment_method,
      'payment_status', p.payment_status,
      'subtotal_amount', p.subtotal_amount::numeric(12,2)::text,
      'discount_amount', p.discount_amount::numeric(12,2)::text,
      'final_amount', p.final_amount::numeric(12,2)::text,
      'voucher_code', p.voucher_code_snapshot,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'delivered_at', p.delivered_at
    ) AS order_json,
    cnt.total_count
  FROM paged p
  CROSS JOIN counted cnt
  ORDER BY p.created_at DESC, p.id DESC;
END $$;

-- 2. Inventory stock listing for WAREHOUSE & ADMIN (no customer/shipping PII)
CREATE FUNCTION app.fn_read_inventory(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_search TEXT DEFAULT NULL,
  p_low_stock_threshold INT DEFAULT NULL
) RETURNS TABLE(row_json JSONB, total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_search TEXT := NULLIF(btrim(coalesce(p_search, '')), '');
  v_pattern TEXT := NULL;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('WAREHOUSE', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active WAREHOUSE or ADMIN accounts may read inventory' USING ERRCODE = 'P3001';
  END IF;

  IF p_low_stock_threshold IS NOT NULL AND p_low_stock_threshold < 0 THEN
    RAISE EXCEPTION 'low_stock_threshold must be non-negative' USING ERRCODE = 'P2001';
  END IF;

  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT i.variant_id, pv.sku, p.name AS product_name, i.quantity, i.updated_at, pv.is_active
    FROM app.inventory i
    JOIN app.product_variants pv ON pv.id = i.variant_id
    JOIN app.products p ON p.id = pv.product_id
    WHERE (v_pattern IS NULL OR pv.sku ILIKE v_pattern ESCAPE '\' OR p.name ILIKE v_pattern ESCAPE '\')
      AND (p_low_stock_threshold IS NULL OR i.quantity <= p_low_stock_threshold)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ), paged AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.quantity ASC, f.variant_id ASC
    LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    jsonb_build_object(
      'variant_id', r.variant_id,
      'sku', r.sku,
      'product_name', r.product_name,
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
        WHERE vav.variant_id = r.variant_id
      ), '[]'::jsonb),
      'quantity', r.quantity,
      'updated_at', r.updated_at,
      'is_active', r.is_active
    ) AS row_json,
    cnt.total_count
  FROM paged r
  CROSS JOIN counted cnt
  ORDER BY r.quantity ASC, r.variant_id ASC;
END $$;

-- 3. Single inventory transaction projection for import response (WAREHOUSE & ADMIN, no PII)
CREATE FUNCTION app.fn_read_inventory_transaction(p_actor_id INT, p_transaction_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_actor app.users%ROWTYPE;
  v_row JSONB;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('WAREHOUSE', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active WAREHOUSE or ADMIN accounts may read inventory transactions' USING ERRCODE = 'P3001';
  END IF;

  SELECT jsonb_build_object(
    'id', it.id::text,
    'variant_id', it.variant_id,
    'sku', pv.sku,
    'type', it.type,
    'quantity_change', it.quantity_change,
    'reference_type', it.reference_type,
    'reference_id', it.reference_id,
    'order_code', o.order_code,
    'note', it.note,
    'created_by', it.created_by,
    'created_at', it.created_at
  )
  INTO v_row
  FROM app.inventory_transactions it
  JOIN app.product_variants pv ON pv.id = it.variant_id
  LEFT JOIN app.orders o ON o.id = it.reference_id AND it.reference_type = 'ORDER'
  WHERE it.id = p_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory transaction not found' USING ERRCODE = 'P4001';
  END IF;

  RETURN v_row;
END $$;

-- 4. Inventory transaction ledger listing (WAREHOUSE & ADMIN, no shipping PII)
CREATE FUNCTION app.fn_read_inventory_transactions(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_variant_id INT DEFAULT NULL,
  p_type VARCHAR(16) DEFAULT NULL,
  p_order_id INT DEFAULT NULL,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
) RETURNS TABLE(tx_json JSONB, total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_type VARCHAR(16) := NULLIF(upper(btrim(coalesce(p_type, ''))), '');
  v_from_ts TIMESTAMPTZ := CASE WHEN p_from IS NULL THEN NULL ELSE (p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END;
  v_to_excl_ts TIMESTAMPTZ := CASE WHEN p_to IS NULL THEN NULL ELSE ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('WAREHOUSE', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active WAREHOUSE or ADMIN accounts may read inventory ledger' USING ERRCODE = 'P3001';
  END IF;

  IF v_type IS NOT NULL AND v_type NOT IN ('IMPORT', 'EXPORT_ORDER', 'RETURN_CANCEL') THEN
    RAISE EXCEPTION 'Invalid inventory transaction type' USING ERRCODE = 'P2001';
  END IF;

  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = 'P2001';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT it.id, it.variant_id, pv.sku, it.type, it.quantity_change,
           it.reference_type, it.reference_id, o.order_code, it.note,
           it.created_by, it.created_at
    FROM app.inventory_transactions it
    JOIN app.product_variants pv ON pv.id = it.variant_id
    LEFT JOIN app.orders o ON o.id = it.reference_id AND it.reference_type = 'ORDER'
    WHERE (p_variant_id IS NULL OR it.variant_id = p_variant_id)
      AND (v_type IS NULL OR it.type = v_type)
      AND (p_order_id IS NULL OR (it.reference_type = 'ORDER' AND it.reference_id = p_order_id))
      AND (v_from_ts IS NULL OR it.created_at >= v_from_ts)
      AND (v_to_excl_ts IS NULL OR it.created_at < v_to_excl_ts)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ), paged AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    jsonb_build_object(
      'id', p.id::text,
      'variant_id', p.variant_id,
      'sku', p.sku,
      'type', p.type,
      'quantity_change', p.quantity_change,
      'reference_type', p.reference_type,
      'reference_id', p.reference_id,
      'order_code', p.order_code,
      'note', p.note,
      'created_by', p.created_by,
      'created_at', p.created_at
    ) AS tx_json,
    cnt.total_count
  FROM paged p
  CROSS JOIN counted cnt
  ORDER BY p.created_at DESC, p.id DESC;
END $$;

-- 5. Voucher management & usage inspection for MARKETING & ADMIN
CREATE FUNCTION app.fn_read_vouchers(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_search TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS TABLE(voucher_json JSONB, total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_search TEXT := NULLIF(btrim(coalesce(p_search, '')), '');
  v_pattern TEXT := NULL;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('MARKETING', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active MARKETING or ADMIN accounts may manage vouchers' USING ERRCODE = 'P3001';
  END IF;

  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(upper(v_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT v.*
    FROM app.vouchers v
    WHERE (v_pattern IS NULL OR upper(v.code) LIKE v_pattern ESCAPE '\')
      AND (p_is_active IS NULL OR v.is_active = p_is_active)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ), paged AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    jsonb_build_object(
      'id', p.id,
      'code', p.code,
      'discount_type', p.discount_type,
      'discount_value', p.discount_value::numeric(12,2)::text,
      'max_discount_amount', p.max_discount_amount::numeric(12,2)::text,
      'min_order_amount', p.min_order_amount::numeric(12,2)::text,
      'usage_limit', p.usage_limit,
      'used_count', p.used_count,
      'start_date', p.start_date,
      'end_date', p.end_date,
      'is_active', p.is_active,
      'created_at', p.created_at
    ) AS voucher_json,
    cnt.total_count
  FROM paged p
  CROSS JOIN counted cnt
  ORDER BY p.created_at DESC, p.id DESC;
END $$;

CREATE FUNCTION app.fn_read_voucher_by_id(p_actor_id INT, p_voucher_id INT)
RETURNS app.vouchers
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_actor app.users%ROWTYPE;
  v_voucher app.vouchers%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('MARKETING', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active MARKETING or ADMIN accounts may manage vouchers' USING ERRCODE = 'P3001';
  END IF;

  IF p_voucher_id IS NULL OR p_voucher_id <= 0 THEN
    RAISE EXCEPTION 'Invalid voucher id' USING ERRCODE = 'P2001';
  END IF;

  SELECT * INTO v_voucher FROM app.vouchers WHERE id = p_voucher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found' USING ERRCODE = 'P4001';
  END IF;
  RETURN v_voucher;
END $$;

CREATE FUNCTION app.fn_manage_voucher(
  p_actor_id INT,
  p_voucher_id INT,
  p_code VARCHAR(40),
  p_discount_type VARCHAR(8),
  p_discount_value NUMERIC(12,2),
  p_max_discount_amount NUMERIC(12,2),
  p_min_order_amount NUMERIC(12,2),
  p_usage_limit INT,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_is_active BOOLEAN,
  p_request_id UUID DEFAULT NULL
) RETURNS app.vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_actor app.users%ROWTYPE;
  v_existing app.vouchers%ROWTYPE;
  v_saved app.vouchers%ROWTYPE;
  v_code VARCHAR(40);
  v_type VARCHAR(8) := upper(btrim(coalesce(p_discount_type, '')));
  v_has_usage BOOLEAN;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('MARKETING', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active MARKETING or ADMIN accounts may manage vouchers' USING ERRCODE = 'P3001';
  END IF;

  IF v_type NOT IN ('FIXED', 'PERCENT') THEN
    RAISE EXCEPTION 'Invalid discount_type' USING ERRCODE = 'P2001';
  END IF;
  IF p_discount_value IS NULL OR p_discount_value <= 0 OR p_discount_value > 9999999999.99 THEN
    RAISE EXCEPTION 'discount_value out of range' USING ERRCODE = 'P2002';
  END IF;
  IF v_type = 'FIXED' AND p_max_discount_amount IS NOT NULL THEN
    RAISE EXCEPTION 'FIXED voucher forbids max_discount_amount' USING ERRCODE = 'P2001';
  END IF;
  IF v_type = 'PERCENT' AND p_discount_value > 100 THEN
    RAISE EXCEPTION 'PERCENT discount_value cannot exceed 100' USING ERRCODE = 'P2001';
  END IF;
  IF p_max_discount_amount IS NOT NULL AND (p_max_discount_amount <= 0 OR p_max_discount_amount > 9999999999.99) THEN
    RAISE EXCEPTION 'max_discount_amount out of range' USING ERRCODE = 'P2002';
  END IF;
  IF p_min_order_amount IS NULL OR p_min_order_amount < 0 OR p_min_order_amount > 9999999999.99 THEN
    RAISE EXCEPTION 'min_order_amount out of range' USING ERRCODE = 'P2002';
  END IF;
  IF p_usage_limit IS NULL OR p_usage_limit <= 0 THEN
    RAISE EXCEPTION 'usage_limit must be positive' USING ERRCODE = 'P2001';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'end_date must be after start_date' USING ERRCODE = 'P2001';
  END IF;

  IF p_voucher_id IS NULL THEN
    v_code := NULLIF(upper(btrim(coalesce(p_code, ''))), '');
    IF v_code IS NULL OR length(v_code) > 40 OR v_code !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' THEN
      RAISE EXCEPTION 'Invalid voucher code' USING ERRCODE = 'P2001';
    END IF;

    INSERT INTO app.vouchers(
      code, discount_type, discount_value, max_discount_amount, min_order_amount,
      usage_limit, start_date, end_date, is_active
    ) VALUES (
      v_code, v_type, p_discount_value, p_max_discount_amount, p_min_order_amount,
      p_usage_limit, p_start_date, p_end_date, COALESCE(p_is_active, TRUE)
    )
    RETURNING * INTO v_saved;

    INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
    VALUES (
      p_actor_id, 'USER', 'CONTENT_CHANGED', 'VOUCHER', v_saved.code,
      jsonb_build_object(
        'operation', 'CREATE',
        'voucher_id', v_saved.id,
        'discount_type', v_saved.discount_type,
        'discount_value', v_saved.discount_value::text,
        'usage_limit', v_saved.usage_limit,
        'is_active', v_saved.is_active
      ),
      p_request_id
    );
    RETURN v_saved;
  END IF;

  IF p_voucher_id <= 0 THEN
    RAISE EXCEPTION 'Invalid voucher id' USING ERRCODE = 'P2001';
  END IF;

  SELECT * INTO v_existing FROM app.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found' USING ERRCODE = 'P4001';
  END IF;

  v_has_usage := v_existing.used_count > 0 OR EXISTS (
    SELECT 1 FROM app.voucher_usages vu WHERE vu.voucher_id = v_existing.id
  );

  IF v_has_usage THEN
    IF v_existing.discount_type <> v_type
       OR v_existing.discount_value <> p_discount_value
       OR v_existing.max_discount_amount IS DISTINCT FROM p_max_discount_amount
       OR v_existing.min_order_amount <> p_min_order_amount
       OR v_existing.start_date <> p_start_date
       OR v_existing.end_date <> p_end_date
       OR p_usage_limit < v_existing.usage_limit THEN
      RAISE EXCEPTION 'Used voucher terms are locked' USING ERRCODE = 'P1012';
    END IF;
  END IF;

  UPDATE app.vouchers
  SET discount_type = v_type,
      discount_value = p_discount_value,
      max_discount_amount = p_max_discount_amount,
      min_order_amount = p_min_order_amount,
      usage_limit = p_usage_limit,
      start_date = p_start_date,
      end_date = p_end_date,
      is_active = COALESCE(p_is_active, v_existing.is_active)
  WHERE id = p_voucher_id
  RETURNING * INTO v_saved;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'VOUCHER', v_saved.code,
    jsonb_build_object(
      'operation', 'UPDATE',
      'voucher_id', v_saved.id,
      'before_active', v_existing.is_active,
      'after_active', v_saved.is_active,
      'before_limit', v_existing.usage_limit,
      'after_limit', v_saved.usage_limit
    ),
    p_request_id
  );
  RETURN v_saved;
END $$;

CREATE FUNCTION app.fn_read_voucher_usages(
  p_actor_id INT,
  p_voucher_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_status VARCHAR(8) DEFAULT NULL
) RETURNS TABLE(usage_json JSONB, total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_status VARCHAR(8) := NULLIF(upper(btrim(coalesce(p_status, ''))), '');
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('MARKETING', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active MARKETING or ADMIN accounts may read voucher usages' USING ERRCODE = 'P3001';
  END IF;

  IF p_voucher_id IS NULL OR p_voucher_id <= 0 THEN
    RAISE EXCEPTION 'Invalid voucher id' USING ERRCODE = 'P2001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.vouchers WHERE id = p_voucher_id) THEN
    RAISE EXCEPTION 'Voucher not found' USING ERRCODE = 'P4001';
  END IF;

  IF v_status IS NOT NULL AND v_status NOT IN ('APPLIED', 'RELEASED') THEN
    RAISE EXCEPTION 'Invalid voucher usage status filter' USING ERRCODE = 'P2001';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT vu.id, vu.voucher_id, vu.user_id, u.full_name, u.email,
           vu.order_id, o.order_code, vu.status, vu.used_at
    FROM app.voucher_usages vu
    JOIN app.users u ON u.id = vu.user_id
    JOIN app.orders o ON o.id = vu.order_id
    WHERE vu.voucher_id = p_voucher_id
      AND (v_status IS NULL OR vu.status = v_status)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ), paged AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.used_at DESC, f.id DESC
    LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    jsonb_build_object(
      'id', p.id,
      'voucher_id', p.voucher_id,
      'user_id', p.user_id,
      'user_display_name', p.full_name,
      'email_masked', left(split_part(p.email, '@', 1), LEAST(2, length(split_part(p.email, '@', 1)))) || '***@' || split_part(p.email, '@', 2),
      'order_id', p.order_id,
      'order_code', p.order_code,
      'status', p.status,
      'used_at', p.used_at
    ) AS usage_json,
    cnt.total_count
  FROM paged p
  CROSS JOIN counted cnt
  ORDER BY p.used_at DESC, p.id DESC;
END $$;

-- 6. Reports (MARKETING & ADMIN): revenue via vw_revenue_summary and best-sellers
CREATE FUNCTION app.fn_read_revenue_report(
  p_actor_id INT,
  p_from DATE,
  p_to DATE,
  p_group_by VARCHAR(8) DEFAULT 'day',
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 100
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_actor app.users%ROWTYPE;
  v_group VARCHAR(8) := lower(btrim(coalesce(p_group_by, 'day')));
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(366, GREATEST(1, COALESCE(p_page_size, 100)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_items JSONB;
  v_totals JSONB;
  v_total_buckets INT;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('MARKETING', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active MARKETING or ADMIN accounts may read revenue reports' USING ERRCODE = 'P3001';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR (p_to - p_from) >= 366 THEN
    RAISE EXCEPTION 'Invalid report date range (max 366 days)' USING ERRCODE = 'P2001';
  END IF;
  IF v_group NOT IN ('day', 'month') THEN
    RAISE EXCEPTION 'Invalid group_by (must be day or month)' USING ERRCODE = 'P2001';
  END IF;

  WITH buckets AS (
    SELECT
      CASE
        WHEN v_group = 'month' THEN date_trunc('month', vr.revenue_date)::date
        ELSE vr.revenue_date
      END AS period_date,
      SUM(vr.order_count)::bigint AS order_count,
      SUM(vr.gross_amount)::numeric::numeric(18,2) AS gross_amount,
      SUM(vr.discount_amount)::numeric::numeric(18,2) AS discount_amount,
      SUM(vr.revenue_amount)::numeric::numeric(18,2) AS revenue_amount
    FROM app.vw_revenue_summary vr
    WHERE vr.revenue_date BETWEEN p_from AND p_to
    GROUP BY 1
  ), totals AS (
    SELECT
      COALESCE(SUM(order_count), 0)::bigint AS order_count,
      COALESCE(SUM(gross_amount), 0)::numeric(18,2) AS gross_amount,
      COALESCE(SUM(discount_amount), 0)::numeric(18,2) AS discount_amount,
      COALESCE(SUM(revenue_amount), 0)::numeric(18,2) AS revenue_amount,
      count(*)::int AS bucket_count
    FROM buckets
  ), paged AS (
    SELECT * FROM buckets ORDER BY period_date ASC LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'period_start', to_char(pg.period_date, 'YYYY-MM-DD'),
          'order_count', pg.order_count,
          'gross_amount', pg.gross_amount::text,
          'discount_amount', pg.discount_amount::text,
          'revenue_amount', pg.revenue_amount::text
        ) ORDER BY pg.period_date ASC
      )
      FROM paged pg
    ), '[]'::jsonb),
    jsonb_build_object(
      'order_count', t.order_count,
      'gross_amount', t.gross_amount::text,
      'discount_amount', t.discount_amount::text,
      'revenue_amount', t.revenue_amount::text
    ),
    t.bucket_count
  INTO v_items, v_totals, v_total_buckets
  FROM totals t;

  RETURN jsonb_build_object(
    'items', v_items,
    'totals', v_totals,
    'total', v_total_buckets,
    'page', v_page,
    'page_size', v_page_size
  );
END $$;

CREATE FUNCTION app.fn_read_best_sellers_report(
  p_actor_id INT,
  p_from DATE,
  p_to DATE,
  p_level VARCHAR(16) DEFAULT 'product',
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20
) RETURNS TABLE(row_json JSONB, total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_level VARCHAR(16) := lower(btrim(coalesce(p_level, 'product')));
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_from_ts TIMESTAMPTZ;
  v_to_excl_ts TIMESTAMPTZ;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role NOT IN ('MARKETING', 'ADMIN') THEN
    RAISE EXCEPTION 'Only active MARKETING or ADMIN accounts may read best sellers' USING ERRCODE = 'P3001';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR (p_to - p_from) >= 366 THEN
    RAISE EXCEPTION 'Invalid report date range (max 366 days)' USING ERRCODE = 'P2001';
  END IF;
  IF v_level NOT IN ('product', 'sku') THEN
    RAISE EXCEPTION 'Invalid level (must be product or sku)' USING ERRCODE = 'P2001';
  END IF;

  v_from_ts := (p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_to_excl_ts := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');

  IF v_level = 'sku' THEN
    RETURN QUERY
    WITH agg AS (
      SELECT
        pv.id AS variant_id,
        pv.sku,
        p.id AS product_id,
        p.name AS product_name,
        SUM(oi.quantity)::bigint AS quantity_sold,
        SUM(oi.unit_price * oi.quantity)::numeric(18,2) AS gross_item_amount
      FROM app.order_items oi
      JOIN app.orders o ON o.id = oi.order_id
      JOIN app.product_variants pv ON pv.id = oi.variant_id
      JOIN app.products p ON p.id = pv.product_id
      WHERE o.status = 'DELIVERED'
        AND o.delivered_at >= v_from_ts
        AND o.delivered_at < v_to_excl_ts
      GROUP BY pv.id, pv.sku, p.id, p.name
    ), ranked AS (
      SELECT
        rank() OVER (ORDER BY a.quantity_sold DESC) AS sales_rank,
        a.*
      FROM agg a
    ), counted AS (
      SELECT count(*)::bigint AS total_count FROM ranked
    ), paged AS (
      SELECT r.*
      FROM ranked r
      ORDER BY r.sales_rank ASC, r.variant_id ASC
      LIMIT v_page_size OFFSET v_offset
    )
    SELECT
      jsonb_build_object(
        'rank', pg.sales_rank::int,
        'product_id', pg.product_id,
        'product_name', pg.product_name,
        'variant_id', pg.variant_id,
        'sku', pg.sku,
        'quantity_sold', pg.quantity_sold::text,
        'gross_item_amount', pg.gross_item_amount::text
      ) AS row_json,
      cnt.total_count
    FROM paged pg
    CROSS JOIN counted cnt
    ORDER BY pg.sales_rank ASC, pg.variant_id ASC;
  ELSE
    RETURN QUERY
    WITH agg AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        SUM(oi.quantity)::bigint AS quantity_sold,
        SUM(oi.unit_price * oi.quantity)::numeric(18,2) AS gross_item_amount
      FROM app.order_items oi
      JOIN app.orders o ON o.id = oi.order_id
      JOIN app.product_variants pv ON pv.id = oi.variant_id
      JOIN app.products p ON p.id = pv.product_id
      WHERE o.status = 'DELIVERED'
        AND o.delivered_at >= v_from_ts
        AND o.delivered_at < v_to_excl_ts
      GROUP BY p.id, p.name
    ), ranked AS (
      SELECT
        rank() OVER (ORDER BY a.quantity_sold DESC) AS sales_rank,
        a.*
      FROM agg a
    ), counted AS (
      SELECT count(*)::bigint AS total_count FROM ranked
    ), paged AS (
      SELECT r.*
      FROM ranked r
      ORDER BY r.sales_rank ASC, r.product_id ASC
      LIMIT v_page_size OFFSET v_offset
    )
    SELECT
      jsonb_build_object(
        'rank', pg.sales_rank::int,
        'product_id', pg.product_id,
        'product_name', pg.product_name,
        'quantity_sold', pg.quantity_sold::text,
        'gross_item_amount', pg.gross_item_amount::text
      ) AS row_json,
      cnt.total_count
    FROM paged pg
    CROSS JOIN counted cnt
    ORDER BY pg.sales_rank ASC, pg.product_id ASC;
  END IF;
END $$;

-- 7. Audit events reader for ADMIN
CREATE FUNCTION app.fn_read_audit_events(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_filter_actor_id INT DEFAULT NULL,
  p_entity_type VARCHAR(32) DEFAULT NULL,
  p_entity_id TEXT DEFAULT NULL,
  p_action VARCHAR(64) DEFAULT NULL,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
) RETURNS TABLE(event_json JSONB, total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_entity_type VARCHAR(32) := NULLIF(upper(btrim(coalesce(p_entity_type, ''))), '');
  v_entity_id TEXT := NULLIF(btrim(coalesce(p_entity_id, '')), '');
  v_action VARCHAR(64) := NULLIF(upper(btrim(coalesce(p_action, ''))), '');
  v_from_ts TIMESTAMPTZ := CASE WHEN p_from IS NULL THEN NULL ELSE (p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END;
  v_to_excl_ts TIMESTAMPTZ := CASE WHEN p_to IS NULL THEN NULL ELSE ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Only active ADMIN accounts may read audit events' USING ERRCODE = 'P3001';
  END IF;

  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = 'P2001';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT ae.*
    FROM app.audit_events ae
    WHERE (p_filter_actor_id IS NULL OR ae.actor_id = p_filter_actor_id)
      AND (v_entity_type IS NULL OR ae.entity_type = v_entity_type)
      AND (v_entity_id IS NULL OR ae.entity_id = v_entity_id)
      AND (v_action IS NULL OR ae.action = v_action)
      AND (v_from_ts IS NULL OR ae.created_at >= v_from_ts)
      AND (v_to_excl_ts IS NULL OR ae.created_at < v_to_excl_ts)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ), paged AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    jsonb_build_object(
      'id', p.id::text,
      'actor_id', p.actor_id,
      'actor_kind', p.actor_kind,
      'action', p.action,
      'entity_type', p.entity_type,
      'entity_id', p.entity_id,
      'changes', p.changes,
      'request_id', p.request_id::text,
      'created_at', p.created_at
    ) AS event_json,
    cnt.total_count
  FROM paged p
  CROSS JOIN counted cnt
  ORDER BY p.created_at DESC, p.id DESC;
END $$;

REVOKE ALL ON FUNCTION
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
FROM PUBLIC, report_ro_user;

GRANT EXECUTE ON FUNCTION
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

-- Down Migration
SET LOCAL ROLE db_admin;
DROP FUNCTION app.fn_read_audit_events(INT, INT, INT, INT, VARCHAR, TEXT, VARCHAR, DATE, DATE);
DROP FUNCTION app.fn_read_best_sellers_report(INT, DATE, DATE, VARCHAR, INT, INT);
DROP FUNCTION app.fn_read_revenue_report(INT, DATE, DATE, VARCHAR, INT, INT);
DROP FUNCTION app.fn_read_voucher_usages(INT, INT, INT, INT, VARCHAR);
DROP FUNCTION app.fn_manage_voucher(INT, INT, VARCHAR, VARCHAR, NUMERIC, NUMERIC, NUMERIC, INT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, UUID);
DROP FUNCTION app.fn_read_voucher_by_id(INT, INT);
DROP FUNCTION app.fn_read_vouchers(INT, INT, INT, TEXT, BOOLEAN);
DROP FUNCTION app.fn_read_inventory_transactions(INT, INT, INT, INT, VARCHAR, INT, DATE, DATE);
DROP FUNCTION app.fn_read_inventory_transaction(INT, BIGINT);
DROP FUNCTION app.fn_read_inventory(INT, INT, INT, TEXT, INT);
DROP FUNCTION app.fn_read_orders(INT, INT, INT, VARCHAR, TEXT, INT);
