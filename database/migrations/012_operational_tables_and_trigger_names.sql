-- Up Migration
SET LOCAL ROLE db_admin;

CREATE TABLE app.checkout_requests (
  user_id INT NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  request_key UUID NOT NULL,
  request_payload JSONB NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  order_id INT UNIQUE REFERENCES app.orders(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_key)
);

CREATE FUNCTION app.check_checkout_request_completed() RETURNS trigger
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

CREATE CONSTRAINT TRIGGER checkout_requests_completed
  AFTER INSERT OR UPDATE ON app.checkout_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_checkout_request_completed();

CREATE TABLE app.audit_events (
  id BIGSERIAL PRIMARY KEY CHECK (id > 0),
  actor_id INT REFERENCES app.users(id) ON DELETE RESTRICT,
  actor_kind VARCHAR(8) NOT NULL CHECK (actor_kind IN ('USER', 'SYSTEM')),
  action VARCHAR(64) NOT NULL CHECK (action IN (
    'ORDER_PLACED', 'ORDER_CANCELLED', 'ORDER_STATUS_CHANGED',
    'INVENTORY_IMPORTED', 'PRICE_CHANGED', 'ROLE_CHANGED', 'CONTENT_CHANGED'
  )),
  entity_type VARCHAR(32) NOT NULL CHECK (entity_type IN (
    'ORDER', 'INVENTORY', 'VOUCHER', 'PRODUCT', 'VARIANT', 'BRAND', 'CATEGORY', 'BANNER', 'USER'
  )),
  entity_id VARCHAR(64) NOT NULL CHECK (length(btrim(entity_id)) > 0),
  changes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes) = 'object'),
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((actor_kind = 'USER' AND actor_id IS NOT NULL) OR (actor_kind = 'SYSTEM' AND actor_id IS NULL))
);

CREATE INDEX idx_audit_entity ON app.audit_events(entity_type, entity_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_actor ON app.audit_events(actor_id, created_at DESC, id DESC) WHERE actor_id IS NOT NULL;

CREATE FUNCTION app.guard_audit_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append only' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON app.audit_events
  FOR EACH ROW EXECUTE FUNCTION app.guard_audit_append_only();

ALTER TRIGGER orders_guard ON app.orders RENAME TO trg_protect_finalized_orders;

REVOKE ALL ON TABLE app.checkout_requests, app.audit_events FROM PUBLIC, app_rw_user, report_ro_user;
REVOKE ALL ON SEQUENCE app.audit_events_id_seq FROM PUBLIC, app_rw_user, report_ro_user;
REVOKE ALL ON FUNCTION app.check_checkout_request_completed(), app.guard_audit_append_only()
  FROM PUBLIC, app_rw_user, report_ro_user;

-- Down Migration
SET LOCAL ROLE db_admin;
ALTER TRIGGER trg_protect_finalized_orders ON app.orders RENAME TO orders_guard;
DROP TRIGGER audit_events_append_only ON app.audit_events;
DROP FUNCTION app.guard_audit_append_only();
DROP TABLE app.audit_events;
DROP TRIGGER checkout_requests_completed ON app.checkout_requests;
DROP FUNCTION app.check_checkout_request_completed();
DROP TABLE app.checkout_requests;
