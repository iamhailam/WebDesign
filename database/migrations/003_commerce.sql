-- Up Migration
SET LOCAL ROLE db_admin;
CREATE TABLE app.users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL CHECK (length(btrim(full_name)) > 0),
  email VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  phone VARCHAR(20) CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  role VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','SALES','WAREHOUSE','MARKETING','ADMIN')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INT NOT NULL DEFAULT 0 CHECK (token_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE app.carts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES app.users(id) ON DELETE RESTRICT,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE app.cart_items (
  id SERIAL PRIMARY KEY,
  cart_id INT NOT NULL REFERENCES app.carts(id) ON DELETE RESTRICT,
  variant_id INT NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);
CREATE TABLE app.inventory (
  variant_id INT PRIMARY KEY REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE app.vouchers (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  discount_type VARCHAR(8) NOT NULL CHECK (discount_type IN ('FIXED','PERCENT')),
  discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0 AND discount_value <= 9999999999.99),
  max_discount_amount NUMERIC(12,2) CHECK (max_discount_amount > 0 AND max_discount_amount <= 9999999999.99),
  min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_order_amount BETWEEN 0 AND 9999999999.99),
  usage_limit INT NOT NULL CHECK (usage_limit > 0),
  used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= usage_limit),
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  CHECK ((discount_type='PERCENT' AND discount_value <= 100) OR
         (discount_type='FIXED' AND max_discount_amount IS NULL))
);
CREATE TABLE app.orders (
  id SERIAL PRIMARY KEY,
  order_code VARCHAR(32) NOT NULL UNIQUE CHECK (length(btrim(order_code)) > 0),
  user_id INT NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  shipping_address TEXT NOT NULL CHECK (length(btrim(shipping_address)) BETWEEN 10 AND 500),
  recipient_name VARCHAR(120) NOT NULL CHECK (length(btrim(recipient_name)) > 0),
  recipient_phone VARCHAR(20) NOT NULL CHECK (recipient_phone ~ '^\+?[0-9]{8,15}$'),
  subtotal_amount NUMERIC(12,2) NOT NULL CHECK (subtotal_amount BETWEEN 0 AND 9999999999.99),
  discount_amount NUMERIC(12,2) NOT NULL CHECK (discount_amount BETWEEN 0 AND 9999999999.99),
  final_amount NUMERIC(12,2) NOT NULL CHECK (final_amount BETWEEN 0 AND 9999999999.99),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','SHIPPING','DELIVERED','CANCELLED')),
  payment_method VARCHAR(8) NOT NULL DEFAULT 'COD' CHECK (payment_method='COD'),
  payment_status VARCHAR(8) NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PAID')),
  voucher_code_snapshot VARCHAR(40),
  delivered_at TIMESTAMPTZ,
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CHECK (discount_amount <= subtotal_amount AND final_amount = subtotal_amount-discount_amount),
  CHECK ((status='DELIVERED' AND payment_status='PAID' AND delivered_at IS NOT NULL) OR
         (status<>'DELIVERED' AND payment_status='UNPAID' AND delivered_at IS NULL))
);
CREATE TABLE app.order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  variant_id INT NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price BETWEEN 0 AND 9999999999.99),
  list_unit_price NUMERIC(12,2) CHECK (list_unit_price BETWEEN 0 AND 9999999999.99 AND list_unit_price >= unit_price),
  product_name VARCHAR(200) NOT NULL CHECK (length(btrim(product_name)) > 0),
  brand_name VARCHAR(200) NOT NULL CHECK (length(btrim(brand_name)) > 0),
  sku VARCHAR(64) NOT NULL CHECK (length(btrim(sku)) > 0),
  options_snapshot JSONB NOT NULL CHECK (jsonb_typeof(options_snapshot)='array'),
  UNIQUE (order_id, variant_id)
);
CREATE TABLE app.inventory_transactions (
  id BIGSERIAL PRIMARY KEY,
  variant_id INT NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  type VARCHAR(16) NOT NULL CHECK (type IN ('IMPORT','EXPORT_ORDER','RETURN_CANCEL')),
  quantity_change INT NOT NULL CHECK (quantity_change <> 0),
  reference_type VARCHAR(16) NOT NULL,
  reference_id INT REFERENCES app.orders(id) ON DELETE RESTRICT,
  note TEXT CHECK (length(note) <= 1000),
  created_by INT NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  request_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((type='IMPORT' AND quantity_change>0 AND reference_type='IMPORT' AND reference_id IS NULL AND request_key IS NOT NULL) OR
         (type='EXPORT_ORDER' AND quantity_change<0 AND reference_type='ORDER' AND reference_id IS NOT NULL AND request_key IS NULL) OR
         (type='RETURN_CANCEL' AND quantity_change>0 AND reference_type='ORDER' AND reference_id IS NOT NULL AND request_key IS NULL))
);
CREATE UNIQUE INDEX ledger_order_variant_type ON app.inventory_transactions(reference_id,variant_id,type)
  WHERE type IN ('EXPORT_ORDER','RETURN_CANCEL');
CREATE UNIQUE INDEX ledger_import_actor_key ON app.inventory_transactions(created_by,request_key) WHERE type='IMPORT';
CREATE TABLE app.voucher_usages (
  id SERIAL PRIMARY KEY,
  voucher_id INT NOT NULL REFERENCES app.vouchers(id) ON DELETE RESTRICT,
  user_id INT NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  order_id INT NOT NULL UNIQUE,
  status VARCHAR(8) NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','RELEASED')),
  used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id,user_id) REFERENCES app.orders(id,user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX voucher_one_applied_per_user ON app.voucher_usages(voucher_id,user_id) WHERE status='APPLIED';

-- Down Migration
SET LOCAL ROLE db_admin;
DROP TABLE app.voucher_usages;
DROP TABLE app.inventory_transactions;
DROP TABLE app.order_items;
DROP TABLE app.orders;
DROP TABLE app.vouchers;
DROP TABLE app.inventory;
DROP TABLE app.cart_items;
DROP TABLE app.carts;
DROP TABLE app.users;
