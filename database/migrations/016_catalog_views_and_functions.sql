-- Up Migration
SET LOCAL ROLE db_admin;

CREATE VIEW app.vw_catalog_variant_options WITH (security_barrier = true) AS
SELECT vav.variant_id,
       a.id AS attribute_id,
       a.code,
       CASE WHEN a.unit IS NOT NULL THEN a.name || ' (' || a.unit || ')' ELSE a.name END AS label,
       av.id AS value_id,
       av.code AS value_code,
       av.label AS value_label
FROM app.variant_attribute_values vav
JOIN app.vw_catalog_variants cv ON cv.id = vav.variant_id
JOIN app.attributes a ON a.id = vav.attribute_id
JOIN app.attribute_values av ON av.id = vav.value_id;

GRANT SELECT ON app.vw_catalog_variant_options TO app_rw_user;

CREATE FUNCTION app.fn_assert_admin_actor(p_actor_id INT) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_actor app.users%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Only active ADMIN accounts may perform this action' USING ERRCODE = 'P3001';
  END IF;
END $$;

-- Admin Brands
CREATE FUNCTION app.fn_read_admin_brands(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_search TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS TABLE(
  id INT,
  name VARCHAR(120),
  slug VARCHAR(160),
  description TEXT,
  logo_path TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_page INT;
  v_page_size INT;
  v_offset INT;
  v_search TEXT;
  v_pattern TEXT;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  v_page := GREATEST(1, COALESCE(p_page, 1));
  v_page_size := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset := (v_page - 1) * v_page_size;
  v_search := NULLIF(btrim(coalesce(p_search, '')), '');
  IF v_search IS NOT NULL THEN
    IF length(v_search) > 100 THEN RAISE EXCEPTION 'Search query too long' USING ERRCODE = 'P2001'; END IF;
    v_pattern := '%' || regexp_replace(v_search, '([\\%_])', '\\\1', 'g') || '%';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT b.id, b.name, b.slug, b.description, b.logo_path::text, b.is_active, b.created_at, b.updated_at
    FROM app.brands b
    WHERE (v_pattern IS NULL OR b.name ILIKE v_pattern ESCAPE '\')
      AND (p_is_active IS NULL OR b.is_active = p_is_active)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  )
  SELECT f.*, c.total_count
  FROM filtered f CROSS JOIN counted c
  ORDER BY f.id ASC
  LIMIT v_page_size OFFSET v_offset;
END $$;

CREATE FUNCTION app.fn_read_admin_brand(p_actor_id INT, p_brand_id INT)
RETURNS TABLE(
  id INT, name VARCHAR(120), slug VARCHAR(160), description TEXT,
  logo_path TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  RETURN QUERY
  SELECT b.id, b.name, b.slug, b.description, b.logo_path::text, b.is_active, b.created_at, b.updated_at
  FROM app.brands b WHERE b.id = p_brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brand not found' USING ERRCODE = 'P4001'; END IF;
END $$;

CREATE FUNCTION app.fn_upsert_brand(
  p_actor_id INT,
  p_id INT,
  p_name TEXT,
  p_slug TEXT,
  p_description TEXT,
  p_logo_path TEXT,
  p_is_active BOOLEAN,
  p_request_id UUID DEFAULT NULL
) RETURNS TABLE(
  id INT, name VARCHAR(120), slug VARCHAR(160), description TEXT,
  logo_path TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_name TEXT := btrim(coalesce(p_name, ''));
  v_slug TEXT := lower(btrim(coalesce(p_slug, '')));
  v_desc TEXT := CASE WHEN p_description IS NULL THEN NULL ELSE NULLIF(btrim(p_description), '') END;
  v_logo TEXT := CASE WHEN p_logo_path IS NULL THEN NULL ELSE NULLIF(btrim(p_logo_path), '') END;
  v_row app.brands%ROWTYPE;
  v_old app.brands%ROWTYPE;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF length(v_name) < 1 OR length(v_name) > 120 THEN RAISE EXCEPTION 'Invalid brand name' USING ERRCODE = 'P2001'; END IF;

  IF p_id IS NULL THEN
    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug) > 160 THEN
      RAISE EXCEPTION 'Invalid brand slug' USING ERRCODE = 'P2001';
    END IF;
    INSERT INTO app.brands(name, slug, description, logo_path, is_active)
    VALUES (v_name, v_slug, v_desc, v_logo::app.asset_path, COALESCE(p_is_active, TRUE))
    RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_old FROM app.brands b WHERE b.id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Brand not found' USING ERRCODE = 'P4001'; END IF;
    UPDATE app.brands b
    SET name = v_name,
        description = v_desc,
        logo_path = v_logo::app.asset_path,
        is_active = COALESCE(p_is_active, b.is_active)
    WHERE b.id = p_id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'BRAND', v_row.id::text,
    jsonb_build_object('name', v_row.name, 'slug', v_row.slug, 'is_active', v_row.is_active),
    p_request_id
  );

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.slug, v_row.description, v_row.logo_path::text, v_row.is_active, v_row.created_at, v_row.updated_at;
END $$;

-- Admin Categories
CREATE FUNCTION app.fn_read_admin_categories(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_search TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS TABLE(
  id INT, name VARCHAR(120), slug VARCHAR(160), description TEXT,
  is_active BOOLEAN, created_at TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_search TEXT := NULLIF(btrim(coalesce(p_search, '')), '');
  v_pattern TEXT;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF v_search IS NOT NULL THEN
    IF length(v_search) > 100 THEN RAISE EXCEPTION 'Search query too long' USING ERRCODE = 'P2001'; END IF;
    v_pattern := '%' || regexp_replace(v_search, '([\\%_])', '\\\1', 'g') || '%';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT c.id, c.name, c.slug, c.description, c.is_active, c.created_at
    FROM app.categories c
    WHERE (v_pattern IS NULL OR c.name ILIKE v_pattern ESCAPE '\')
      AND (p_is_active IS NULL OR c.is_active = p_is_active)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  )
  SELECT f.*, cnt.total_count
  FROM filtered f CROSS JOIN counted cnt
  ORDER BY f.id ASC
  LIMIT v_page_size OFFSET v_offset;
END $$;

CREATE FUNCTION app.fn_read_admin_category(p_actor_id INT, p_category_id INT)
RETURNS TABLE(
  id INT, name VARCHAR(120), slug VARCHAR(160), description TEXT,
  is_active BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  RETURN QUERY
  SELECT c.id, c.name, c.slug, c.description, c.is_active, c.created_at
  FROM app.categories c WHERE c.id = p_category_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P4001'; END IF;
END $$;

CREATE FUNCTION app.fn_upsert_category(
  p_actor_id INT,
  p_id INT,
  p_name TEXT,
  p_slug TEXT,
  p_description TEXT,
  p_is_active BOOLEAN,
  p_request_id UUID DEFAULT NULL
) RETURNS TABLE(
  id INT, name VARCHAR(120), slug VARCHAR(160), description TEXT,
  is_active BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_name TEXT := btrim(coalesce(p_name, ''));
  v_slug TEXT := lower(btrim(coalesce(p_slug, '')));
  v_desc TEXT := CASE WHEN p_description IS NULL THEN NULL ELSE NULLIF(btrim(p_description), '') END;
  v_row app.categories%ROWTYPE;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF length(v_name) < 1 OR length(v_name) > 120 THEN RAISE EXCEPTION 'Invalid category name' USING ERRCODE = 'P2001'; END IF;

  IF p_id IS NULL THEN
    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug) > 160 THEN
      RAISE EXCEPTION 'Invalid category slug' USING ERRCODE = 'P2001';
    END IF;
    INSERT INTO app.categories(name, slug, description, is_active)
    VALUES (v_name, v_slug, v_desc, COALESCE(p_is_active, TRUE))
    RETURNING * INTO v_row;
  ELSE
    PERFORM 1 FROM app.categories c WHERE c.id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P4001'; END IF;
    UPDATE app.categories c
    SET name = v_name,
        description = v_desc,
        is_active = COALESCE(p_is_active, c.is_active)
    WHERE c.id = p_id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'CATEGORY', v_row.id::text,
    jsonb_build_object('name', v_row.name, 'slug', v_row.slug, 'is_active', v_row.is_active),
    p_request_id
  );

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.slug, v_row.description, v_row.is_active, v_row.created_at;
END $$;

-- Admin Products, Variants, Images
CREATE FUNCTION app.fn_read_admin_products(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_search TEXT DEFAULT NULL,
  p_brand_id INT DEFAULT NULL,
  p_category_id INT DEFAULT NULL,
  p_product_type VARCHAR(24) DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS TABLE(
  id INT,
  name VARCHAR(200),
  slug VARCHAR(220),
  brand_id INT,
  brand_name VARCHAR(120),
  brand_slug VARCHAR(160),
  category_id INT,
  category_name VARCHAR(120),
  category_slug VARCHAR(160),
  product_type_code VARCHAR(24),
  base_image_url TEXT,
  price_min NUMERIC(12,2),
  price_max NUMERIC(12,2),
  in_stock BOOLEAN,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
  v_search TEXT := NULLIF(btrim(coalesce(p_search, '')), '');
  v_pattern TEXT;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF v_search IS NOT NULL THEN
    IF length(v_search) > 100 THEN RAISE EXCEPTION 'Search query too long' USING ERRCODE = 'P2001'; END IF;
    v_pattern := '%' || regexp_replace(v_search, '([\\%_])', '\\\1', 'g') || '%';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT p.id, p.name, p.slug,
           b.id AS brand_id, b.name AS brand_name, b.slug AS brand_slug,
           c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
           p.product_type_code,
           (SELECT pi.asset_path::text FROM app.product_images pi
            WHERE pi.product_id = p.id
            ORDER BY (pi.variant_id IS NULL AND pi.is_primary) DESC, pi.sort_order ASC, pi.id ASC LIMIT 1) AS base_image_url,
           COALESCE(min(v.price) FILTER (WHERE v.is_active), min(v.price), 0.00)::numeric(12,2) AS price_min,
           COALESCE(max(v.price) FILTER (WHERE v.is_active), max(v.price), 0.00)::numeric(12,2) AS price_max,
           COALESCE(bool_or(i.quantity > 0) FILTER (WHERE v.is_active), FALSE) AS in_stock,
           p.is_active, p.created_at, p.updated_at
    FROM app.products p
    JOIN app.brands b ON b.id = p.brand_id
    JOIN app.categories c ON c.id = p.category_id
    LEFT JOIN app.product_variants v ON v.product_id = p.id
    LEFT JOIN app.inventory i ON i.variant_id = v.id
    WHERE (v_pattern IS NULL OR p.name ILIKE v_pattern ESCAPE '\')
      AND (p_brand_id IS NULL OR p.brand_id = p_brand_id)
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (p_product_type IS NULL OR p.product_type_code = p_product_type)
      AND (p_is_active IS NULL OR p.is_active = p_is_active)
    GROUP BY p.id, b.id, c.id
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  )
  SELECT f.*, cnt.total_count
  FROM filtered f CROSS JOIN counted cnt
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT v_page_size OFFSET v_offset;
END $$;

CREATE FUNCTION app.fn_read_admin_product(p_actor_id INT, p_product_id INT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);

  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'slug', p.slug,
    'description', p.description,
    'brand', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug),
    'category', jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug),
    'product_type_code', p.product_type_code,
    'is_active', p.is_active,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'base_image_url', (
      SELECT pi.asset_path::text FROM app.product_images pi
      WHERE pi.product_id = p.id
      ORDER BY (pi.variant_id IS NULL AND pi.is_primary) DESC, pi.sort_order ASC, pi.id ASC LIMIT 1
    ),
    'price_min', COALESCE((SELECT min(v.price)::numeric(12,2)::text FROM app.product_variants v WHERE v.product_id = p.id AND v.is_active), '0.00'),
    'price_max', COALESCE((SELECT max(v.price)::numeric(12,2)::text FROM app.product_variants v WHERE v.product_id = p.id AND v.is_active), '0.00'),
    'in_stock', COALESCE((SELECT bool_or(i.quantity > 0) FROM app.product_variants v JOIN app.inventory i ON i.variant_id = v.id WHERE v.product_id = p.id AND v.is_active), FALSE),
    'images', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pi.id,
          'product_id', pi.product_id,
          'variant_id', pi.variant_id,
          'asset_path', pi.asset_path::text,
          'alt_text', pi.alt_text,
          'sort_order', pi.sort_order,
          'is_primary', pi.is_primary,
          'created_at', pi.created_at
        ) ORDER BY pi.sort_order ASC, pi.id ASC
      )
      FROM app.product_images pi WHERE pi.product_id = p.id
    ), '[]'::jsonb),
    'variants', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'product_id', v.product_id,
          'sku', v.sku,
          'price', v.price::numeric(12,2)::text,
          'list_price', v.list_price::numeric(12,2)::text,
          'stock_quantity', i.quantity,
          'is_active', v.is_active,
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
          'images', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', pi.id,
                'product_id', pi.product_id,
                'variant_id', pi.variant_id,
                'asset_path', pi.asset_path::text,
                'alt_text', pi.alt_text,
                'sort_order', pi.sort_order,
                'is_primary', pi.is_primary,
                'created_at', pi.created_at
              ) ORDER BY pi.sort_order ASC, pi.id ASC
            )
            FROM app.product_images pi WHERE pi.variant_id = v.id
          ), '[]'::jsonb)
        ) ORDER BY v.id ASC
      )
      FROM app.product_variants v
      JOIN app.inventory i ON i.variant_id = v.id
      WHERE v.product_id = p.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM app.products p
  JOIN app.brands b ON b.id = p.brand_id
  JOIN app.categories c ON c.id = p.category_id
  WHERE p.id = p_product_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P4001';
  END IF;
  RETURN v_result;
END $$;

CREATE FUNCTION app.fn_upsert_product(
  p_actor_id INT,
  p_id INT,
  p_name TEXT,
  p_slug TEXT,
  p_category_id INT,
  p_brand_id INT,
  p_product_type_code VARCHAR(24),
  p_description TEXT,
  p_is_active BOOLEAN,
  p_request_id UUID DEFAULT NULL
) RETURNS TABLE(
  id INT, category_id INT, brand_id INT, product_type_code VARCHAR(24),
  name VARCHAR(200), slug VARCHAR(220), description TEXT,
  is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_name TEXT := btrim(coalesce(p_name, ''));
  v_slug TEXT := lower(btrim(coalesce(p_slug, '')));
  v_desc TEXT := CASE WHEN p_description IS NULL THEN NULL ELSE NULLIF(btrim(p_description), '') END;
  v_row app.products%ROWTYPE;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF length(v_name) < 1 OR length(v_name) > 200 THEN RAISE EXCEPTION 'Invalid product name' USING ERRCODE = 'P2001'; END IF;

  PERFORM 1 FROM app.brands b WHERE b.id = p_brand_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brand not found' USING ERRCODE = 'P2001'; END IF;
  PERFORM 1 FROM app.categories c WHERE c.id = p_category_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P2001'; END IF;

  IF p_id IS NULL THEN
    IF COALESCE(p_is_active, FALSE) THEN
      RAISE EXCEPTION 'New products must be created as draft' USING ERRCODE = 'P2001';
    END IF;
    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug) > 220 THEN
      RAISE EXCEPTION 'Invalid product slug' USING ERRCODE = 'P2001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.product_types pt WHERE pt.code = p_product_type_code) THEN
      RAISE EXCEPTION 'Invalid product_type_code' USING ERRCODE = 'P2001';
    END IF;
    INSERT INTO app.products(category_id, brand_id, product_type_code, name, slug, description, is_active)
    VALUES (p_category_id, p_brand_id, p_product_type_code, v_name, v_slug, v_desc, FALSE)
    RETURNING * INTO v_row;
  ELSE
    PERFORM 1 FROM app.products p WHERE p.id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P4001'; END IF;
    IF p_is_active IS NULL THEN RAISE EXCEPTION 'is_active is required' USING ERRCODE = 'P2001'; END IF;
    UPDATE app.products p
    SET category_id = p_category_id,
        brand_id = p_brand_id,
        name = v_name,
        description = v_desc,
        is_active = p_is_active
    WHERE p.id = p_id
    RETURNING * INTO v_row;
    SET CONSTRAINTS ALL IMMEDIATE;
  END IF;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'PRODUCT', v_row.id::text,
    jsonb_build_object('name', v_row.name, 'is_active', v_row.is_active, 'category_id', v_row.category_id, 'brand_id', v_row.brand_id),
    p_request_id
  );

  RETURN QUERY SELECT v_row.id, v_row.category_id, v_row.brand_id, v_row.product_type_code, v_row.name, v_row.slug, v_row.description, v_row.is_active, v_row.created_at, v_row.updated_at;
END $$;

CREATE FUNCTION app.fn_create_variant(
  p_actor_id INT,
  p_product_id INT,
  p_sku TEXT,
  p_price NUMERIC,
  p_list_price NUMERIC,
  p_options JSONB,
  p_is_active BOOLEAN DEFAULT TRUE,
  p_request_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_sku TEXT := upper(btrim(coalesce(p_sku, '')));
  v_prod app.products%ROWTYPE;
  v_vid INT;
  v_opt_count INT;
  v_distinct_attr INT;
  v_result JSONB;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);

  IF v_sku !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' OR length(v_sku) > 64 THEN
    RAISE EXCEPTION 'Invalid SKU format' USING ERRCODE = 'P2001', CONSTRAINT = 'variant_options_invalid';
  END IF;
  IF p_price IS NULL OR p_price = 'NaN'::numeric OR p_price < 0 OR p_price > 9999999999.99 THEN
    RAISE EXCEPTION 'Price out of range' USING ERRCODE = 'P2002';
  END IF;
  IF p_list_price IS NOT NULL AND (p_list_price = 'NaN'::numeric OR p_list_price < p_price OR p_list_price > 9999999999.99) THEN
    RAISE EXCEPTION 'list_price must be >= price' USING ERRCODE = 'P2001';
  END IF;
  IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array' THEN
    RAISE EXCEPTION 'options must be an array' USING ERRCODE = 'P2001', CONSTRAINT = 'variant_options_invalid';
  END IF;

  SELECT * INTO v_prod FROM app.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P4001'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_options) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
      OR coalesce(e.item->>'attribute_id', '') !~ '^[1-9][0-9]*$'
      OR coalesce(e.item->>'value_id', '') !~ '^[1-9][0-9]*$'
  ) THEN
    RAISE EXCEPTION 'Invalid variant option element' USING ERRCODE = 'P2001', CONSTRAINT = 'variant_options_invalid';
  END IF;

  SELECT count(*), count(DISTINCT (e.item->>'attribute_id')::int)
  INTO v_opt_count, v_distinct_attr
  FROM jsonb_array_elements(p_options) AS e(item);

  IF v_opt_count <> v_distinct_attr THEN
    RAISE EXCEPTION 'Duplicate attribute in variant options' USING ERRCODE = 'P2001', CONSTRAINT = 'variant_options_invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_options) AS e(item)
    WHERE NOT EXISTS (
      SELECT 1 FROM app.product_type_attributes pta
      WHERE pta.product_type_code = v_prod.product_type_code
        AND pta.attribute_id = (e.item->>'attribute_id')::int
    ) OR NOT EXISTS (
      SELECT 1 FROM app.attribute_values av
      WHERE av.attribute_id = (e.item->>'attribute_id')::int
        AND av.id = (e.item->>'value_id')::int
    )
  ) THEN
    RAISE EXCEPTION 'Attribute or value not valid for product type' USING ERRCODE = 'P2001', CONSTRAINT = 'variant_options_invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM app.product_type_attributes pta
    WHERE pta.product_type_code = v_prod.product_type_code
      AND pta.is_required
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_options) AS e(item)
        WHERE (e.item->>'attribute_id')::int = pta.attribute_id
      )
  ) THEN
    RAISE EXCEPTION 'Required variant attributes are missing' USING ERRCODE = 'P2001', CONSTRAINT = 'variant_options_invalid';
  END IF;

  INSERT INTO app.product_variants(product_id, sku, price, list_price, is_active)
  VALUES (p_product_id, v_sku, p_price::numeric(12,2), p_list_price::numeric(12,2), COALESCE(p_is_active, TRUE))
  RETURNING id INTO v_vid;

  INSERT INTO app.variant_attribute_values(variant_id, attribute_id, value_id)
  SELECT v_vid, (e.item->>'attribute_id')::int, (e.item->>'value_id')::int
  FROM jsonb_array_elements(p_options) AS e(item);

  SET CONSTRAINTS ALL IMMEDIATE;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'VARIANT', v_vid::text,
    jsonb_build_object('product_id', p_product_id, 'sku', v_sku, 'price', (p_price::numeric(12,2))::text),
    p_request_id
  );

  SELECT jsonb_build_object(
    'id', v.id,
    'product_id', v.product_id,
    'sku', v.sku,
    'price', v.price::numeric(12,2)::text,
    'list_price', v.list_price::numeric(12,2)::text,
    'stock_quantity', i.quantity,
    'is_active', v.is_active,
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
    'images', '[]'::jsonb
  ) INTO v_result
  FROM app.product_variants v JOIN app.inventory i ON i.variant_id = v.id
  WHERE v.id = v_vid;

  RETURN v_result;
END $$;

CREATE FUNCTION app.fn_update_variant(
  p_actor_id INT,
  p_variant_id INT,
  p_price NUMERIC,
  p_list_price NUMERIC,
  p_is_active BOOLEAN,
  p_request_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_old app.product_variants%ROWTYPE;
  v_new app.product_variants%ROWTYPE;
  v_action VARCHAR(64);
  v_result JSONB;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF p_price IS NULL OR p_price = 'NaN'::numeric OR p_price < 0 OR p_price > 9999999999.99 THEN
    RAISE EXCEPTION 'Price out of range' USING ERRCODE = 'P2002';
  END IF;
  IF p_list_price IS NOT NULL AND (p_list_price = 'NaN'::numeric OR p_list_price < p_price OR p_list_price > 9999999999.99) THEN
    RAISE EXCEPTION 'list_price must be >= price' USING ERRCODE = 'P2001';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'is_active is required' USING ERRCODE = 'P2001';
  END IF;

  SELECT * INTO v_old FROM app.product_variants WHERE id = p_variant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'P4001'; END IF;

  UPDATE app.product_variants
  SET price = p_price::numeric(12,2),
      list_price = p_list_price::numeric(12,2),
      is_active = p_is_active
  WHERE id = p_variant_id
  RETURNING * INTO v_new;

  SET CONSTRAINTS ALL IMMEDIATE;

  v_action := CASE WHEN (v_old.price IS DISTINCT FROM v_new.price OR v_old.list_price IS DISTINCT FROM v_new.list_price)
                   THEN 'PRICE_CHANGED' ELSE 'CONTENT_CHANGED' END;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', v_action, 'VARIANT', p_variant_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('price', v_old.price::text, 'list_price', v_old.list_price::text, 'is_active', v_old.is_active),
      'after', jsonb_build_object('price', v_new.price::text, 'list_price', v_new.list_price::text, 'is_active', v_new.is_active)
    ),
    p_request_id
  );

  SELECT jsonb_build_object(
    'id', v.id,
    'product_id', v.product_id,
    'sku', v.sku,
    'price', v.price::numeric(12,2)::text,
    'list_price', v.list_price::numeric(12,2)::text,
    'stock_quantity', i.quantity,
    'is_active', v.is_active,
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
    'images', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pi.id,
          'product_id', pi.product_id,
          'variant_id', pi.variant_id,
          'asset_path', pi.asset_path::text,
          'alt_text', pi.alt_text,
          'sort_order', pi.sort_order,
          'is_primary', pi.is_primary,
          'created_at', pi.created_at
        ) ORDER BY pi.sort_order ASC, pi.id ASC
      )
      FROM app.product_images pi WHERE pi.variant_id = v.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM app.product_variants v JOIN app.inventory i ON i.variant_id = v.id
  WHERE v.id = p_variant_id;

  RETURN v_result;
END $$;

CREATE FUNCTION app.fn_add_product_image(
  p_actor_id INT,
  p_product_id INT,
  p_variant_id INT,
  p_asset_path TEXT,
  p_alt_text TEXT,
  p_sort_order INT DEFAULT 0,
  p_is_primary BOOLEAN DEFAULT FALSE,
  p_request_id UUID DEFAULT NULL
) RETURNS TABLE(
  id INT, product_id INT, variant_id INT, asset_path TEXT,
  alt_text VARCHAR(200), sort_order INT, is_primary BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_alt TEXT := btrim(coalesce(p_alt_text, ''));
  v_path TEXT := btrim(coalesce(p_asset_path, ''));
  v_row app.product_images%ROWTYPE;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF length(v_alt) < 1 OR length(v_alt) > 200 THEN RAISE EXCEPTION 'Invalid alt_text' USING ERRCODE = 'P2001'; END IF;
  IF COALESCE(p_sort_order, 0) < 0 THEN RAISE EXCEPTION 'sort_order must be >= 0' USING ERRCODE = 'P2001'; END IF;

  PERFORM 1 FROM app.products p WHERE p.id = p_product_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P4001'; END IF;

  IF p_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.product_variants pv WHERE pv.id = p_variant_id AND pv.product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Variant does not belong to product' USING ERRCODE = 'P2001';
  END IF;

  IF COALESCE(p_is_primary, FALSE) THEN
    UPDATE app.product_images pi
    SET is_primary = FALSE
    WHERE pi.is_primary
      AND ((p_variant_id IS NULL AND pi.product_id = p_product_id AND pi.variant_id IS NULL)
           OR (p_variant_id IS NOT NULL AND pi.variant_id = p_variant_id));
  END IF;

  INSERT INTO app.product_images(product_id, variant_id, asset_path, alt_text, sort_order, is_primary)
  VALUES (p_product_id, p_variant_id, v_path::app.asset_path, v_alt, COALESCE(p_sort_order, 0), COALESCE(p_is_primary, FALSE))
  RETURNING * INTO v_row;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'PRODUCT', p_product_id::text,
    jsonb_build_object('image_added', v_row.id, 'variant_id', v_row.variant_id, 'is_primary', v_row.is_primary),
    p_request_id
  );

  RETURN QUERY SELECT v_row.id, v_row.product_id, v_row.variant_id, v_row.asset_path::text, v_row.alt_text, v_row.sort_order, v_row.is_primary, v_row.created_at;
END $$;

CREATE FUNCTION app.fn_update_product_image(
  p_actor_id INT,
  p_image_id INT,
  p_asset_path TEXT,
  p_alt_text TEXT,
  p_sort_order INT,
  p_is_primary BOOLEAN,
  p_request_id UUID DEFAULT NULL
) RETURNS TABLE(
  id INT, product_id INT, variant_id INT, asset_path TEXT,
  alt_text VARCHAR(200), sort_order INT, is_primary BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_alt TEXT := btrim(coalesce(p_alt_text, ''));
  v_path TEXT := btrim(coalesce(p_asset_path, ''));
  v_existing app.product_images%ROWTYPE;
  v_row app.product_images%ROWTYPE;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF length(v_alt) < 1 OR length(v_alt) > 200 THEN RAISE EXCEPTION 'Invalid alt_text' USING ERRCODE = 'P2001'; END IF;
  IF p_sort_order IS NULL OR p_sort_order < 0 THEN RAISE EXCEPTION 'sort_order must be >= 0' USING ERRCODE = 'P2001'; END IF;
  IF p_is_primary IS NULL THEN RAISE EXCEPTION 'is_primary is required' USING ERRCODE = 'P2001'; END IF;

  SELECT * INTO v_existing FROM app.product_images pi WHERE pi.id = p_image_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Image not found' USING ERRCODE = 'P4001'; END IF;

  PERFORM 1 FROM app.products p WHERE p.id = v_existing.product_id FOR NO KEY UPDATE;

  IF p_is_primary THEN
    UPDATE app.product_images pi
    SET is_primary = FALSE
    WHERE pi.id <> p_image_id
      AND pi.is_primary
      AND ((v_existing.variant_id IS NULL AND pi.product_id = v_existing.product_id AND pi.variant_id IS NULL)
           OR (v_existing.variant_id IS NOT NULL AND pi.variant_id = v_existing.variant_id));
  END IF;

  UPDATE app.product_images pi
  SET asset_path = v_path::app.asset_path,
      alt_text = v_alt,
      sort_order = p_sort_order,
      is_primary = p_is_primary
  WHERE pi.id = p_image_id
  RETURNING * INTO v_row;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'PRODUCT', v_row.product_id::text,
    jsonb_build_object('image_updated', v_row.id, 'is_primary', v_row.is_primary),
    p_request_id
  );

  RETURN QUERY SELECT v_row.id, v_row.product_id, v_row.variant_id, v_row.asset_path::text, v_row.alt_text, v_row.sort_order, v_row.is_primary, v_row.created_at;
END $$;

CREATE FUNCTION app.fn_delete_product_image(
  p_actor_id INT,
  p_image_id INT,
  p_request_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_existing app.product_images%ROWTYPE;
  v_prod_active BOOLEAN;
  v_remaining INT;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);

  SELECT * INTO v_existing FROM app.product_images WHERE id = p_image_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Image not found' USING ERRCODE = 'P4001'; END IF;

  SELECT is_active INTO v_prod_active FROM app.products WHERE id = v_existing.product_id FOR NO KEY UPDATE;
  SELECT count(*)::int INTO v_remaining FROM app.product_images WHERE product_id = v_existing.product_id AND id <> p_image_id;

  IF v_prod_active AND v_remaining = 0 THEN
    RAISE EXCEPTION 'Cannot remove last image of active product'
      USING ERRCODE = 'P1014', CONSTRAINT = 'last_product_image';
  END IF;

  DELETE FROM app.product_images WHERE id = p_image_id;
  SET CONSTRAINTS ALL IMMEDIATE;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'PRODUCT', v_existing.product_id::text,
    jsonb_build_object('image_removed', p_image_id),
    p_request_id
  );

  RETURN TRUE;
END $$;

-- Admin Banners
CREATE FUNCTION app.fn_read_admin_banners(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_placement VARCHAR(16) DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS TABLE(
  id INT, title VARCHAR(160), desktop_path TEXT, mobile_path TEXT, alt_text VARCHAR(200),
  placement VARCHAR(16), target_type VARCHAR(16), product_id INT, category_id INT, brand_id INT,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, sort_order INT, is_active BOOLEAN,
  target_path TEXT, total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_page INT := GREATEST(1, COALESCE(p_page, 1));
  v_page_size INT := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset INT := (v_page - 1) * v_page_size;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  RETURN QUERY
  WITH filtered AS (
    SELECT b.id, b.title, b.desktop_path::text, b.mobile_path::text, b.alt_text,
           b.placement, b.target_type, b.product_id, b.category_id, b.brand_id,
           b.starts_at, b.ends_at, b.sort_order, b.is_active,
           CASE
             WHEN b.target_type = 'PRODUCT' THEN '/products/' || p.slug
             WHEN b.target_type = 'CATEGORY' THEN '/categories/' || c.slug
             WHEN b.target_type = 'BRAND' THEN '/brands/' || br.slug
             ELSE NULL
           END AS target_path
    FROM app.banners b
    LEFT JOIN app.products p ON p.id = b.product_id
    LEFT JOIN app.categories c ON c.id = b.category_id
    LEFT JOIN app.brands br ON br.id = b.brand_id
    WHERE (p_placement IS NULL OR b.placement = p_placement)
      AND (p_is_active IS NULL OR b.is_active = p_is_active)
  ), counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  )
  SELECT f.*, cnt.total_count
  FROM filtered f CROSS JOIN counted cnt
  ORDER BY f.sort_order ASC, f.id ASC
  LIMIT v_page_size OFFSET v_offset;
END $$;

CREATE FUNCTION app.fn_read_admin_banner(p_actor_id INT, p_banner_id INT)
RETURNS TABLE(
  id INT, title VARCHAR(160), desktop_path TEXT, mobile_path TEXT, alt_text VARCHAR(200),
  placement VARCHAR(16), target_type VARCHAR(16), product_id INT, category_id INT, brand_id INT,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, sort_order INT, is_active BOOLEAN, target_path TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  RETURN QUERY
  SELECT b.id, b.title, b.desktop_path::text, b.mobile_path::text, b.alt_text,
         b.placement, b.target_type, b.product_id, b.category_id, b.brand_id,
         b.starts_at, b.ends_at, b.sort_order, b.is_active,
         CASE
           WHEN b.target_type = 'PRODUCT' THEN '/products/' || p.slug
           WHEN b.target_type = 'CATEGORY' THEN '/categories/' || c.slug
           WHEN b.target_type = 'BRAND' THEN '/brands/' || br.slug
           ELSE NULL
         END AS target_path
  FROM app.banners b
  LEFT JOIN app.products p ON p.id = b.product_id
  LEFT JOIN app.categories c ON c.id = b.category_id
  LEFT JOIN app.brands br ON br.id = b.brand_id
  WHERE b.id = p_banner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Banner not found' USING ERRCODE = 'P4001'; END IF;
END $$;

CREATE FUNCTION app.fn_manage_banner(
  p_actor_id INT,
  p_id INT,
  p_title TEXT,
  p_desktop_path TEXT,
  p_mobile_path TEXT,
  p_alt_text TEXT,
  p_placement VARCHAR(16),
  p_target_type VARCHAR(16),
  p_product_id INT,
  p_category_id INT,
  p_brand_id INT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_sort_order INT DEFAULT 0,
  p_is_active BOOLEAN DEFAULT FALSE,
  p_request_id UUID DEFAULT NULL
) RETURNS TABLE(
  id INT, title VARCHAR(160), desktop_path TEXT, mobile_path TEXT, alt_text VARCHAR(200),
  placement VARCHAR(16), target_type VARCHAR(16), product_id INT, category_id INT, brand_id INT,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, sort_order INT, is_active BOOLEAN, target_path TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_title TEXT := btrim(coalesce(p_title, ''));
  v_alt TEXT := btrim(coalesce(p_alt_text, ''));
  v_desk TEXT := btrim(coalesce(p_desktop_path, ''));
  v_mob TEXT := CASE WHEN p_mobile_path IS NULL THEN NULL ELSE NULLIF(btrim(p_mobile_path), '') END;
  v_bid INT;
BEGIN
  PERFORM app.fn_assert_admin_actor(p_actor_id);
  IF length(v_title) < 1 OR length(v_title) > 160 THEN RAISE EXCEPTION 'Invalid banner title' USING ERRCODE = 'P2001'; END IF;
  IF length(v_alt) < 1 OR length(v_alt) > 200 THEN RAISE EXCEPTION 'Invalid banner alt_text' USING ERRCODE = 'P2001'; END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'ends_at must be after starts_at' USING ERRCODE = 'P2001';
  END IF;
  IF COALESCE(p_sort_order, 0) < 0 THEN RAISE EXCEPTION 'sort_order must be >= 0' USING ERRCODE = 'P2001'; END IF;

  IF p_target_type = 'PRODUCT' THEN
    IF p_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM app.products WHERE products.id = p_product_id) THEN
      RAISE EXCEPTION 'Target product not found' USING ERRCODE = 'P2001';
    END IF;
  ELSIF p_target_type = 'CATEGORY' THEN
    IF p_category_id IS NULL OR NOT EXISTS (SELECT 1 FROM app.categories WHERE categories.id = p_category_id) THEN
      RAISE EXCEPTION 'Target category not found' USING ERRCODE = 'P2001';
    END IF;
  ELSIF p_target_type = 'BRAND' THEN
    IF p_brand_id IS NULL OR NOT EXISTS (SELECT 1 FROM app.brands WHERE brands.id = p_brand_id) THEN
      RAISE EXCEPTION 'Target brand not found' USING ERRCODE = 'P2001';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO app.banners(
      title, desktop_path, mobile_path, alt_text, placement, target_type,
      product_id, category_id, brand_id, starts_at, ends_at, sort_order, is_active
    ) VALUES (
      v_title, v_desk::app.asset_path, v_mob::app.asset_path, v_alt, p_placement, p_target_type,
      p_product_id, p_category_id, p_brand_id, p_starts_at, p_ends_at, COALESCE(p_sort_order, 0), COALESCE(p_is_active, FALSE)
    ) RETURNING banners.id INTO v_bid;
  ELSE
    PERFORM 1 FROM app.banners b WHERE b.id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Banner not found' USING ERRCODE = 'P4001'; END IF;
    UPDATE app.banners b
    SET title = v_title,
        desktop_path = v_desk::app.asset_path,
        mobile_path = v_mob::app.asset_path,
        alt_text = v_alt,
        placement = p_placement,
        target_type = p_target_type,
        product_id = p_product_id,
        category_id = p_category_id,
        brand_id = p_brand_id,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        sort_order = COALESCE(p_sort_order, 0),
        is_active = COALESCE(p_is_active, b.is_active)
    WHERE b.id = p_id
    RETURNING b.id INTO v_bid;
  END IF;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id, 'USER', 'CONTENT_CHANGED', 'BANNER', v_bid::text,
    jsonb_build_object('title', v_title, 'placement', p_placement, 'target_type', p_target_type),
    p_request_id
  );

  RETURN QUERY SELECT * FROM app.fn_read_admin_banner(p_actor_id, v_bid);
END $$;

REVOKE ALL ON FUNCTION
  app.fn_assert_admin_actor(INT),
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
  app.fn_manage_banner(INT, INT, TEXT, TEXT, TEXT, TEXT, VARCHAR, VARCHAR, INT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, BOOLEAN, UUID)
FROM PUBLIC, report_ro_user;

GRANT EXECUTE ON FUNCTION
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
  app.fn_manage_banner(INT, INT, TEXT, TEXT, TEXT, TEXT, VARCHAR, VARCHAR, INT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, BOOLEAN, UUID)
TO app_rw_user;

-- Down Migration
SET LOCAL ROLE db_admin;
DROP FUNCTION app.fn_manage_banner(INT, INT, TEXT, TEXT, TEXT, TEXT, VARCHAR, VARCHAR, INT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, BOOLEAN, UUID);
DROP FUNCTION app.fn_read_admin_banner(INT, INT);
DROP FUNCTION app.fn_read_admin_banners(INT, INT, INT, VARCHAR, BOOLEAN);
DROP FUNCTION app.fn_delete_product_image(INT, INT, UUID);
DROP FUNCTION app.fn_update_product_image(INT, INT, TEXT, TEXT, INT, BOOLEAN, UUID);
DROP FUNCTION app.fn_add_product_image(INT, INT, INT, TEXT, TEXT, INT, BOOLEAN, UUID);
DROP FUNCTION app.fn_update_variant(INT, INT, NUMERIC, NUMERIC, BOOLEAN, UUID);
DROP FUNCTION app.fn_create_variant(INT, INT, TEXT, NUMERIC, NUMERIC, JSONB, BOOLEAN, UUID);
DROP FUNCTION app.fn_upsert_product(INT, INT, TEXT, TEXT, INT, INT, VARCHAR, TEXT, BOOLEAN, UUID);
DROP FUNCTION app.fn_read_admin_product(INT, INT);
DROP FUNCTION app.fn_read_admin_products(INT, INT, INT, TEXT, INT, INT, VARCHAR, BOOLEAN);
DROP FUNCTION app.fn_upsert_category(INT, INT, TEXT, TEXT, TEXT, BOOLEAN, UUID);
DROP FUNCTION app.fn_read_admin_category(INT, INT);
DROP FUNCTION app.fn_read_admin_categories(INT, INT, INT, TEXT, BOOLEAN);
DROP FUNCTION app.fn_upsert_brand(INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID);
DROP FUNCTION app.fn_read_admin_brand(INT, INT);
DROP FUNCTION app.fn_read_admin_brands(INT, INT, INT, TEXT, BOOLEAN);
DROP FUNCTION app.fn_assert_admin_actor(INT);
DROP VIEW app.vw_catalog_variant_options;
