-- Up Migration
SET LOCAL ROLE db_admin;
CREATE INDEX idx_products_brand_active ON app.products(brand_id,is_active,id);
CREATE INDEX idx_products_category_active ON app.products(category_id,is_active,id);
CREATE INDEX idx_products_type ON app.products(product_type_code);
CREATE INDEX idx_variants_product_price ON app.product_variants(product_id,is_active,price);
CREATE INDEX idx_images_product_order ON app.product_images(product_id,sort_order,id);
CREATE INDEX idx_images_variant_order ON app.product_images(variant_id,sort_order,id);
CREATE INDEX idx_type_attributes_attribute ON app.product_type_attributes(attribute_id);
CREATE INDEX idx_variant_values_value ON app.variant_attribute_values(attribute_id,value_id);
CREATE INDEX idx_cart_items_variant ON app.cart_items(variant_id);
CREATE INDEX idx_orders_user_created ON app.orders(user_id,created_at DESC,id DESC);
CREATE INDEX idx_orders_active_status ON app.orders(status) WHERE status IN ('PENDING','CONFIRMED','SHIPPING');
CREATE INDEX idx_orders_delivered ON app.orders(delivered_at,id) WHERE status='DELIVERED';
CREATE INDEX idx_order_items_variant ON app.order_items(variant_id);
CREATE INDEX idx_ledger_variant_created ON app.inventory_transactions(variant_id,created_at DESC,id DESC);
CREATE INDEX idx_ledger_actor ON app.inventory_transactions(created_by);
CREATE INDEX idx_usages_voucher_status ON app.voucher_usages(voucher_id,status,user_id);
CREATE INDEX idx_usages_user ON app.voucher_usages(user_id);
CREATE INDEX idx_banners_schedule ON app.banners(placement,is_active,starts_at,ends_at);
CREATE INDEX idx_banners_product ON app.banners(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_banners_category ON app.banners(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_banners_brand ON app.banners(brand_id) WHERE brand_id IS NOT NULL;

CREATE VIEW app.vw_public_brands WITH (security_barrier=true) AS
 SELECT id,name,slug,description,logo_path FROM app.brands WHERE is_active;
CREATE VIEW app.vw_public_categories WITH (security_barrier=true) AS
 SELECT id,name,slug,description FROM app.categories WHERE is_active;
CREATE VIEW app.vw_catalog_products WITH (security_barrier=true) AS
 SELECT p.id,p.name,p.slug,p.description,p.category_id,p.brand_id,p.product_type_code,p.created_at,
        min(v.price) AS price_min,max(v.price) AS price_max,bool_or(i.quantity>0) AS in_stock
 FROM app.products p JOIN app.brands b ON b.id=p.brand_id AND b.is_active
 JOIN app.categories c ON c.id=p.category_id AND c.is_active
 JOIN app.product_variants v ON v.product_id=p.id AND v.is_active
 JOIN app.inventory i ON i.variant_id=v.id WHERE p.is_active
 GROUP BY p.id;
CREATE VIEW app.vw_catalog_variants WITH (security_barrier=true) AS
 SELECT v.id,v.product_id,v.sku,v.price,v.list_price,i.quantity AS stock_quantity
 FROM app.product_variants v JOIN app.vw_catalog_products p ON p.id=v.product_id
 JOIN app.inventory i ON i.variant_id=v.id WHERE v.is_active;
CREATE VIEW app.vw_catalog_images WITH (security_barrier=true) AS
 SELECT i.* FROM app.product_images i JOIN app.vw_catalog_products p ON p.id=i.product_id
 WHERE i.variant_id IS NULL OR EXISTS(SELECT FROM app.vw_catalog_variants v WHERE v.id=i.variant_id);
CREATE VIEW app.vw_product_type_options AS
 SELECT t.code AS product_type_code,t.name AS product_type_name,a.id AS attribute_id,a.code AS attribute_code,
        a.name AS attribute_name,a.unit,m.is_required,m.sort_order,v.id AS value_id,v.code AS value_code,v.label AS value_label,v.sort_order AS value_sort_order
 FROM app.product_types t JOIN app.product_type_attributes m ON m.product_type_code=t.code
 JOIN app.attributes a ON a.id=m.attribute_id JOIN app.attribute_values v ON v.attribute_id=a.id;
CREATE VIEW app.vw_public_banners WITH (security_barrier=true) AS
 SELECT b.* FROM app.banners b WHERE b.is_active AND CURRENT_TIMESTAMP>=b.starts_at AND CURRENT_TIMESTAMP<b.ends_at
 AND (b.target_type='NONE' OR
      (b.target_type='PRODUCT' AND EXISTS(SELECT FROM app.vw_catalog_products p WHERE p.id=b.product_id)) OR
      (b.target_type='CATEGORY' AND EXISTS(SELECT FROM app.categories c WHERE c.id=b.category_id AND c.is_active)) OR
      (b.target_type='BRAND' AND EXISTS(SELECT FROM app.brands x WHERE x.id=b.brand_id AND x.is_active)));

-- Reporting views are a minimal schema projection; report API/timezone policy remains T11.
CREATE VIEW app.vw_revenue_summary AS
 SELECT (delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS revenue_date,
        count(*) AS order_count,sum(subtotal_amount) AS gross_amount,sum(discount_amount) AS discount_amount,
        sum(final_amount) AS revenue_amount
 FROM app.orders WHERE status='DELIVERED' GROUP BY 1;
CREATE VIEW app.vw_best_selling_products AS
 SELECT oi.variant_id,v.product_id,sum(oi.quantity) AS quantity_sold,
        sum(oi.unit_price*oi.quantity) AS gross_item_amount,
        rank() OVER(ORDER BY sum(oi.quantity) DESC) AS sales_rank
 FROM app.order_items oi JOIN app.orders o ON o.id=oi.order_id AND o.status='DELIVERED'
 JOIN app.product_variants v ON v.id=oi.variant_id GROUP BY oi.variant_id,v.product_id;

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC,app_rw_user,report_ro_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC,app_rw_user,report_ro_user;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC,app_rw_user,report_ro_user;
GRANT SELECT ON app.vw_public_brands,app.vw_public_categories,app.vw_catalog_products,
 app.vw_catalog_variants,app.vw_catalog_images,app.vw_product_type_options,app.vw_public_banners TO app_rw_user;
GRANT SELECT ON app.vw_revenue_summary,app.vw_best_selling_products TO report_ro_user;
-- Explicit existing-object revokes above are authoritative. Do not broaden future table/sequence grants.

-- Down Migration
SET LOCAL ROLE db_admin;
DROP VIEW app.vw_best_selling_products,app.vw_revenue_summary,app.vw_public_banners,
 app.vw_product_type_options,app.vw_catalog_images,app.vw_catalog_variants,app.vw_catalog_products,
 app.vw_public_categories,app.vw_public_brands;
DROP INDEX app.idx_products_brand_active,app.idx_products_category_active,app.idx_products_type,
 app.idx_variants_product_price,app.idx_images_product_order,app.idx_images_variant_order,
 app.idx_type_attributes_attribute,app.idx_variant_values_value,app.idx_cart_items_variant,
 app.idx_orders_user_created,app.idx_orders_active_status,app.idx_orders_delivered,
 app.idx_order_items_variant,app.idx_ledger_variant_created,app.idx_ledger_actor,
 app.idx_usages_voucher_status,app.idx_usages_user,app.idx_banners_schedule,
 app.idx_banners_product,app.idx_banners_category,app.idx_banners_brand;
