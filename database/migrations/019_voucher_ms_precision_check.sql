-- Up Migration
SET LOCAL ROLE db_admin;

CREATE OR REPLACE FUNCTION app.fn_manage_voucher(
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
      p_usage_limit, date_trunc('milliseconds', p_start_date), date_trunc('milliseconds', p_end_date), COALESCE(p_is_active, TRUE)
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
    -- JSON round-trips timestamps at millisecond precision; match truncated values and preserve stored timestamps
    IF v_existing.discount_type <> v_type
       OR v_existing.discount_value <> p_discount_value
       OR v_existing.max_discount_amount IS DISTINCT FROM p_max_discount_amount
       OR v_existing.min_order_amount <> p_min_order_amount
       OR date_trunc('milliseconds', v_existing.start_date) <> date_trunc('milliseconds', p_start_date)
       OR date_trunc('milliseconds', v_existing.end_date) <> date_trunc('milliseconds', p_end_date)
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
      start_date = CASE WHEN v_has_usage THEN v_existing.start_date ELSE date_trunc('milliseconds', p_start_date) END,
      end_date = CASE WHEN v_has_usage THEN v_existing.end_date ELSE date_trunc('milliseconds', p_end_date) END,
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

-- Down Migration
SET LOCAL ROLE db_admin;
CREATE OR REPLACE FUNCTION app.fn_manage_voucher(
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
