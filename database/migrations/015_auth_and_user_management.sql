-- Up Migration
SET LOCAL ROLE db_admin;

CREATE FUNCTION app.fn_register_customer(
  p_full_name TEXT,
  p_email TEXT,
  p_password_hash TEXT,
  p_phone TEXT DEFAULT NULL
) RETURNS TABLE(
  id INT,
  full_name VARCHAR(120),
  email VARCHAR(254),
  phone VARCHAR(20),
  role VARCHAR(16),
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_full_name TEXT;
  v_email TEXT;
  v_phone TEXT;
BEGIN
  v_full_name := btrim(coalesce(p_full_name, ''));
  v_email := lower(btrim(coalesce(p_email, '')));
  v_phone := CASE WHEN p_phone IS NULL THEN NULL ELSE NULLIF(btrim(p_phone), '') END;

  IF length(v_full_name) < 1 OR length(v_full_name) > 120 THEN
    RAISE EXCEPTION 'Invalid full_name' USING ERRCODE = 'P2001';
  END IF;
  IF length(v_email) < 3 OR length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = 'P2001';
  END IF;
  IF p_password_hash IS NULL OR length(p_password_hash) = 0 THEN
    RAISE EXCEPTION 'Password hash is required' USING ERRCODE = 'P2001';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'Invalid phone format' USING ERRCODE = 'P2001';
  END IF;

  RETURN QUERY
  INSERT INTO app.users(full_name, email, password_hash, phone, role, is_active, token_version)
  VALUES (v_full_name, v_email, p_password_hash, v_phone, 'CUSTOMER', TRUE, 0)
  RETURNING
    users.id,
    users.full_name,
    users.email,
    users.phone,
    users.role,
    users.is_active,
    users.created_at;
END $$;

CREATE FUNCTION app.fn_get_login_record(p_email TEXT)
RETURNS TABLE(
  id INT,
  full_name VARCHAR(120),
  email VARCHAR(254),
  password_hash TEXT,
  phone VARCHAR(20),
  role VARCHAR(16),
  is_active BOOLEAN,
  token_version INT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT u.id, u.full_name, u.email, u.password_hash, u.phone, u.role, u.is_active, u.token_version, u.created_at
  FROM app.users u
  WHERE u.email = lower(btrim(coalesce(p_email, '')))
  LIMIT 1;
$$;

CREATE FUNCTION app.fn_get_actor(p_user_id INT)
RETURNS TABLE(
  id INT,
  full_name VARCHAR(120),
  email VARCHAR(254),
  phone VARCHAR(20),
  role VARCHAR(16),
  is_active BOOLEAN,
  token_version INT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.token_version, u.created_at
  FROM app.users u
  WHERE u.id = p_user_id
  LIMIT 1;
$$;

CREATE FUNCTION app.fn_read_users(
  p_actor_id INT,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20,
  p_search TEXT DEFAULT NULL,
  p_role VARCHAR(16) DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS TABLE(
  id INT,
  full_name VARCHAR(120),
  email VARCHAR(254),
  phone VARCHAR(20),
  role VARCHAR(16),
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_page INT;
  v_page_size INT;
  v_offset INT;
  v_search TEXT;
  v_pattern TEXT;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE users.id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Only active ADMIN accounts may list users' USING ERRCODE = 'P3001';
  END IF;

  v_page := GREATEST(1, COALESCE(p_page, 1));
  v_page_size := LEAST(100, GREATEST(1, COALESCE(p_page_size, 20)));
  v_offset := (v_page - 1) * v_page_size;

  v_search := NULLIF(btrim(coalesce(p_search, '')), '');
  IF v_search IS NOT NULL THEN
    IF length(v_search) > 100 THEN
      RAISE EXCEPTION 'Search query too long' USING ERRCODE = 'P2001';
    END IF;
    v_pattern := '%' || regexp_replace(v_search, '([\\%_])', '\\\1', 'g') || '%';
  END IF;

  IF p_role IS NOT NULL AND p_role NOT IN ('CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN') THEN
    RAISE EXCEPTION 'Invalid role filter' USING ERRCODE = 'P2001';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at
    FROM app.users u
    WHERE (v_pattern IS NULL OR u.full_name ILIKE v_pattern ESCAPE '\' OR u.email ILIKE v_pattern ESCAPE '\')
      AND (p_role IS NULL OR u.role = p_role)
      AND (p_is_active IS NULL OR u.is_active = p_is_active)
  ),
  counted AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  )
  SELECT f.id, f.full_name, f.email, f.phone, f.role, f.is_active, f.created_at, c.total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT v_page_size OFFSET v_offset;
END $$;

CREATE FUNCTION app.fn_read_user(
  p_actor_id INT,
  p_target_user_id INT
) RETURNS TABLE(
  id INT,
  full_name VARCHAR(120),
  email VARCHAR(254),
  phone VARCHAR(20),
  role VARCHAR(16),
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE users.id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Only active ADMIN accounts may read user details' USING ERRCODE = 'P3001';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id <= 0 THEN
    RAISE EXCEPTION 'Invalid user id' USING ERRCODE = 'P2001';
  END IF;

  RETURN QUERY
  SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at
  FROM app.users u
  WHERE u.id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P4001';
  END IF;
END $$;

CREATE FUNCTION app.fn_manage_user(
  p_actor_id INT,
  p_target_user_id INT,
  p_full_name TEXT,
  p_phone TEXT,
  p_role VARCHAR(16),
  p_is_active BOOLEAN,
  p_request_id UUID DEFAULT NULL
) RETURNS TABLE(
  id INT,
  full_name VARCHAR(120),
  email VARCHAR(254),
  phone VARCHAR(20),
  role VARCHAR(16),
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_actor app.users%ROWTYPE;
  v_target app.users%ROWTYPE;
  v_full_name TEXT;
  v_phone TEXT;
  v_other_admins INT;
  v_auth_changed BOOLEAN;
  v_action VARCHAR(64);
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Actor not authorized' USING ERRCODE = 'P3001';
  END IF;
  SELECT * INTO v_actor FROM app.users WHERE users.id = p_actor_id;
  IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Only active ADMIN accounts may manage users' USING ERRCODE = 'P3001';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id <= 0 THEN
    RAISE EXCEPTION 'Invalid target user id' USING ERRCODE = 'P2001';
  END IF;

  v_full_name := btrim(coalesce(p_full_name, ''));
  v_phone := CASE WHEN p_phone IS NULL THEN NULL ELSE NULLIF(btrim(p_phone), '') END;
  IF length(v_full_name) < 1 OR length(v_full_name) > 120 THEN
    RAISE EXCEPTION 'Invalid full_name' USING ERRCODE = 'P2001';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'Invalid phone format' USING ERRCODE = 'P2001';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN') THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = 'P2001';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'is_active is required' USING ERRCODE = 'P2001';
  END IF;

  -- Serialize concurrent admin privilege updates to protect the last active ADMIN
  PERFORM pg_advisory_xact_lock(71005, 1);

  SELECT * INTO v_target FROM app.users WHERE users.id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P4001';
  END IF;

  IF v_target.role = 'ADMIN' AND v_target.is_active AND (p_role <> 'ADMIN' OR NOT p_is_active) THEN
    SELECT count(*)::int INTO v_other_admins
    FROM app.users u
    WHERE u.role = 'ADMIN' AND u.is_active AND u.id <> p_target_user_id;

    IF v_other_admins = 0 THEN
      RAISE EXCEPTION 'Cannot demote or deactivate the last active admin' USING ERRCODE = 'P1013';
    END IF;
  END IF;

  v_auth_changed := (v_target.role IS DISTINCT FROM p_role) OR (v_target.is_active IS DISTINCT FROM p_is_active);
  v_action := CASE WHEN v_auth_changed THEN 'ROLE_CHANGED' ELSE 'CONTENT_CHANGED' END;

  UPDATE app.users u
  SET full_name = v_full_name,
      phone = v_phone,
      role = p_role,
      is_active = p_is_active,
      token_version = CASE WHEN v_auth_changed THEN u.token_version + 1 ELSE u.token_version END
  WHERE u.id = p_target_user_id;

  INSERT INTO app.audit_events(actor_id, actor_kind, action, entity_type, entity_id, changes, request_id)
  VALUES (
    p_actor_id,
    'USER',
    v_action,
    'USER',
    p_target_user_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('full_name', v_target.full_name, 'role', v_target.role, 'is_active', v_target.is_active),
      'after', jsonb_build_object('full_name', v_full_name, 'role', p_role, 'is_active', p_is_active)
    ),
    p_request_id
  );

  RETURN QUERY
  SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at
  FROM app.users u
  WHERE u.id = p_target_user_id;
END $$;

REVOKE ALL ON FUNCTION
  app.fn_register_customer(TEXT, TEXT, TEXT, TEXT),
  app.fn_get_login_record(TEXT),
  app.fn_get_actor(INT),
  app.fn_read_users(INT, INT, INT, TEXT, VARCHAR, BOOLEAN),
  app.fn_read_user(INT, INT),
  app.fn_manage_user(INT, INT, TEXT, TEXT, VARCHAR, BOOLEAN, UUID)
FROM PUBLIC, report_ro_user;

GRANT EXECUTE ON FUNCTION
  app.fn_register_customer(TEXT, TEXT, TEXT, TEXT),
  app.fn_get_login_record(TEXT),
  app.fn_get_actor(INT),
  app.fn_read_users(INT, INT, INT, TEXT, VARCHAR, BOOLEAN),
  app.fn_read_user(INT, INT),
  app.fn_manage_user(INT, INT, TEXT, TEXT, VARCHAR, BOOLEAN, UUID)
TO app_rw_user;

-- Down Migration
SET LOCAL ROLE db_admin;
DROP FUNCTION app.fn_manage_user(INT, INT, TEXT, TEXT, VARCHAR, BOOLEAN, UUID);
DROP FUNCTION app.fn_read_user(INT, INT);
DROP FUNCTION app.fn_read_users(INT, INT, INT, TEXT, VARCHAR, BOOLEAN);
DROP FUNCTION app.fn_get_actor(INT);
DROP FUNCTION app.fn_get_login_record(TEXT);
DROP FUNCTION app.fn_register_customer(TEXT, TEXT, TEXT, TEXT);
