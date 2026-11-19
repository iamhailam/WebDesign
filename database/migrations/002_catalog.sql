-- Up Migration
SET LOCAL ROLE db_admin;
CREATE TABLE app.brands (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE CHECK (name = btrim(name) AND length(name) > 0),
  slug VARCHAR(160) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description TEXT CHECK (length(description) <= 10000),
  logo_path app.asset_path,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE app.categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE CHECK (name = btrim(name) AND length(name) > 0),
  slug VARCHAR(160) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description TEXT CHECK (length(description) <= 10000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE app.product_types (
  code VARCHAR(24) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]*$'),
  name VARCHAR(80) NOT NULL CHECK (length(btrim(name)) > 0)
);
CREATE TABLE app.attributes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name VARCHAR(80) NOT NULL CHECK (length(btrim(name)) > 0),
  unit VARCHAR(16) CHECK (length(btrim(unit)) > 0)
);
CREATE TABLE app.product_type_attributes (
  product_type_code VARCHAR(24) NOT NULL REFERENCES app.product_types(code) ON DELETE RESTRICT,
  attribute_id INT NOT NULL REFERENCES app.attributes(id) ON DELETE RESTRICT,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  PRIMARY KEY (product_type_code, attribute_id)
);
CREATE TABLE app.attribute_values (
  id SERIAL PRIMARY KEY,
  attribute_id INT NOT NULL REFERENCES app.attributes(id) ON DELETE RESTRICT,
  code VARCHAR(64) NOT NULL CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label VARCHAR(100) NOT NULL CHECK (length(btrim(label)) > 0),
  sort_order INT NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  UNIQUE (attribute_id, code),
  UNIQUE (attribute_id, id)
);
CREATE TABLE app.products (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES app.categories(id) ON DELETE RESTRICT,
  brand_id INT NOT NULL REFERENCES app.brands(id) ON DELETE RESTRICT,
  product_type_code VARCHAR(24) NOT NULL REFERENCES app.product_types(code) ON DELETE RESTRICT,
  name VARCHAR(200) NOT NULL CHECK (length(btrim(name)) > 0),
  slug VARCHAR(220) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description TEXT CHECK (length(description) <= 20000),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE app.product_variants (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES app.products(id) ON DELETE RESTRICT,
  sku VARCHAR(64) NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  combo_key TEXT NOT NULL DEFAULT '',
  price NUMERIC(12,2) NOT NULL CHECK (price BETWEEN 0 AND 9999999999.99),
  list_price NUMERIC(12,2) CHECK (list_price BETWEEN 0 AND 9999999999.99 AND list_price >= price),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, id),
  CONSTRAINT variants_product_combo_key UNIQUE (product_id, combo_key) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE app.variant_attribute_values (
  variant_id INT NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  attribute_id INT NOT NULL REFERENCES app.attributes(id) ON DELETE RESTRICT,
  value_id INT NOT NULL,
  PRIMARY KEY (variant_id, attribute_id),
  FOREIGN KEY (attribute_id, value_id) REFERENCES app.attribute_values(attribute_id, id) ON DELETE RESTRICT
);
CREATE TABLE app.product_images (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES app.products(id) ON DELETE RESTRICT,
  variant_id INT,
  asset_path app.asset_path NOT NULL,
  alt_text VARCHAR(200) NOT NULL CHECK (length(btrim(alt_text)) > 0),
  sort_order INT NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, variant_id) REFERENCES app.product_variants(product_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX images_primary_product ON app.product_images(product_id) WHERE variant_id IS NULL AND is_primary;
CREATE UNIQUE INDEX images_primary_variant ON app.product_images(variant_id) WHERE variant_id IS NOT NULL AND is_primary;
CREATE TABLE app.banners (
  id SERIAL PRIMARY KEY,
  title VARCHAR(160) NOT NULL CHECK (length(btrim(title)) > 0),
  desktop_path app.asset_path NOT NULL,
  mobile_path app.asset_path,
  alt_text VARCHAR(200) NOT NULL CHECK (length(btrim(alt_text)) > 0),
  placement VARCHAR(16) NOT NULL CHECK (placement IN ('HERO','PROMO')),
  target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('NONE','PRODUCT','CATEGORY','BRAND')),
  product_id INT REFERENCES app.products(id) ON DELETE RESTRICT,
  category_id INT REFERENCES app.categories(id) ON DELETE RESTRICT,
  brand_id INT REFERENCES app.brands(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  sort_order INT NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CONSTRAINT banners_exact_target CHECK (
    (target_type='NONE' AND product_id IS NULL AND category_id IS NULL AND brand_id IS NULL) OR
    (target_type='PRODUCT' AND product_id IS NOT NULL AND category_id IS NULL AND brand_id IS NULL) OR
    (target_type='CATEGORY' AND category_id IS NOT NULL AND product_id IS NULL AND brand_id IS NULL) OR
    (target_type='BRAND' AND brand_id IS NOT NULL AND product_id IS NULL AND category_id IS NULL)
  )
);

-- Down Migration
SET LOCAL ROLE db_admin;
DROP TABLE app.banners;
DROP TABLE app.product_images;
DROP TABLE app.variant_attribute_values;
DROP TABLE app.product_variants;
DROP TABLE app.products;
DROP TABLE app.attribute_values;
DROP TABLE app.product_type_attributes;
DROP TABLE app.attributes;
DROP TABLE app.product_types;
DROP TABLE app.categories;
DROP TABLE app.brands;
