-- Up Migration
SET LOCAL ROLE db_admin;

CREATE OR REPLACE FUNCTION app.check_checkout_request_completed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  v_order_id INT;
BEGIN
  SELECT cr.order_id INTO v_order_id
  FROM app.checkout_requests cr
  WHERE cr.user_id = NEW.user_id AND cr.request_key = NEW.request_key;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_order_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM app.orders o WHERE o.id = v_order_id AND o.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Checkout request must bind to a committed order of the same user'
      USING ERRCODE = '23514', CONSTRAINT = 'checkout_requests_completed';
  END IF;
  RETURN NULL;
END $$;

-- Down Migration
SET LOCAL ROLE db_admin;

CREATE OR REPLACE FUNCTION app.check_checkout_request_completed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
BEGIN
  IF NEW.order_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM app.orders o WHERE o.id = NEW.order_id AND o.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Checkout request must bind to a committed order of the same user'
      USING ERRCODE = '23514', CONSTRAINT = 'checkout_requests_completed';
  END IF;
  RETURN NULL;
END $$;
