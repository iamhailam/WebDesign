-- Multi-brand Demo Catalog Seed (Task 06)
-- Idempotent synthetic metadata covering Fashion, Shoes, Bags, Watches, Accessories, and Perfumes.
-- Requires 001_demo.sql (for warehouse@seed-demo.invalid actor) or runs safely after 001_demo.sql.
SELECT pg_advisory_xact_lock(71006, 1);
SET LOCAL ROLE db_admin;

INSERT INTO app.brands(name, slug, description, logo_path, is_active) VALUES
  ('Nordic Peak', 'nordic-peak', 'Outerwear & technical apparel demo brand', '/media/sanphamdemo1.jpg', TRUE),
  ('Urban Stride', 'urban-stride', 'Streetwear & footwear demo brand', '/media/sanphamdemo2.jpg', TRUE),
  ('Maison Atelier', 'maison-atelier', 'Luxury bags & ready-to-wear demo brand', '/media/sanphamdemo4.jpg', TRUE),
  ('Chronos Studio', 'chronos-studio', 'Timepieces & metallic accessories demo brand', NULL, TRUE),
  ('Essence Lab', 'essence-lab', 'Artisan fragrance house demo brand', NULL, TRUE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app.categories(name, slug, description, is_active) VALUES
  ('Fashion', 'fashion', 'Thời trang may mặc nhiều phong cách', TRUE),
  ('Shoes', 'shoes', 'Giày thể thao và giày thường ngày', TRUE),
  ('Bags', 'bags', 'Túi xách và phụ kiện mang theo', TRUE),
  ('Watches', 'watches', 'Đồng hồ đeo tay nhiều kích cỡ mặt', TRUE),
  ('Accessories', 'accessories', 'Thắt lưng và phụ kiện thời trang', TRUE),
  ('Perfumes', 'perfumes', 'Nước hoa nhiều dung tích và nồng độ', TRUE)
ON CONFLICT (slug) DO NOTHING;

WITH prod_defs(cat_slug, brand_slug, type_code, name, slug, descr) AS (VALUES
  ('fashion', 'nordic-peak', 'CLOTHING', 'Áo Phao Mùa Đông Nordic Peak', 'ao-phao-nordic-peak', 'Áo phao giữ ấm dáng gọn, chất liệu synthetic demo.'),
  ('fashion', 'urban-stride', 'CLOTHING', 'Áo Hoodie Nỉ Urban Stride', 'ao-hoodie-urban-stride', 'Áo hoodie nỉ cotton phom rộng demo.'),
  ('fashion', 'maison-atelier', 'CLOTHING', 'Áo Hoodie Maison Classic', 'ao-hoodie-maison-classic', 'Áo hoodie phom cơ bản nhiều phối màu demo.'),
  ('shoes', 'urban-stride', 'SHOES', 'Giày Sneaker Urban Runner', 'giay-sneaker-urban-runner', 'Giày sneaker đế nhẹ dùng size hệ EU/US demo.'),
  ('bags', 'maison-atelier', 'BAGS', 'Túi Tote Da Maison Atelier', 'tui-tote-maison-atelier', 'Túi đeo hàng ngày tối giản demo.'),
  ('watches', 'chronos-studio', 'WATCHES', 'Đồng Hồ Chronos Minimalist', 'dong-ho-chronos-minimalist', 'Đồng hồ dây kim loại/da nhiều đường kính mặt demo.'),
  ('accessories', 'chronos-studio', 'ACCESSORIES', 'Thắt Lưng Da Chronos Classic', 'that-lung-chronos-classic', 'Thắt lưng khóa kim loại demo.'),
  ('perfumes', 'essence-lab', 'PERFUME', 'Nước Hoa Essence Amber Woods', 'nuoc-hoa-essence-amber-woods', 'Hương gỗ hổ phách nhiều dung tích và nồng độ demo.')
)
INSERT INTO app.products(category_id, brand_id, product_type_code, name, slug, description, is_active)
SELECT c.id, b.id, d.type_code, d.name, d.slug, d.descr, FALSE
FROM prod_defs d
JOIN app.categories c ON c.slug = d.cat_slug
JOIN app.brands b ON b.slug = d.brand_slug
ON CONFLICT (slug) DO NOTHING;

WITH sku_defs(prod_slug, sku, price, list_price) AS (VALUES
  ('ao-phao-nordic-peak', 'NP-PUFFER-BURG-M', 1890000.00, 2290000.00),
  ('ao-phao-nordic-peak', 'NP-PUFFER-BURG-L', 1890000.00, 2290000.00),
  ('ao-hoodie-urban-stride', 'US-HOODIE-WHT-M', 890000.00, 1050000.00),
  ('ao-hoodie-urban-stride', 'US-HOODIE-BLK-L', 920000.00, NULL),
  ('ao-hoodie-maison-classic', 'MA-HOODIE-WHT-M', 1450000.00, 1750000.00),
  ('ao-hoodie-maison-classic', 'MA-HOODIE-RED-M', 1490000.00, 1750000.00),
  ('giay-sneaker-urban-runner', 'US-SHOE-BLK-EU40', 1650000.00, 1990000.00),
  ('giay-sneaker-urban-runner', 'US-SHOE-BLK-EU42', 1650000.00, 1990000.00),
  ('giay-sneaker-urban-runner', 'US-SHOE-WHT-US9', 1750000.00, NULL),
  ('tui-tote-maison-atelier', 'MA-BAG-BLK-S', 2400000.00, 2800000.00),
  ('tui-tote-maison-atelier', 'MA-BAG-BLK-M', 2650000.00, NULL),
  ('dong-ho-chronos-minimalist', 'CS-WATCH-A-SLV-40', 3200000.00, 3800000.00),
  ('dong-ho-chronos-minimalist', 'CS-WATCH-A-BLK-42', 3450000.00, NULL),
  ('that-lung-chronos-classic', 'CS-BELT-A-BLK-100', 650000.00, 790000.00),
  ('nuoc-hoa-essence-amber-woods', 'EL-PERF-50-EDT', 1550000.00, NULL),
  ('nuoc-hoa-essence-amber-woods', 'EL-PERF-100-EDP', 2350000.00, 2650000.00)
)
INSERT INTO app.product_variants(product_id, sku, price, list_price, is_active)
SELECT p.id, s.sku, s.price, s.list_price, TRUE
FROM sku_defs s
JOIN app.products p ON p.slug = s.prod_slug
ON CONFLICT (sku) DO NOTHING;

WITH opt_defs(sku, attr_code, val_code) AS (VALUES
  ('NP-PUFFER-BURG-M', 'color', 'burgundy'), ('NP-PUFFER-BURG-M', 'clothing_size', 'm'),
  ('NP-PUFFER-BURG-L', 'color', 'burgundy'), ('NP-PUFFER-BURG-L', 'clothing_size', 'l'),
  ('US-HOODIE-WHT-M', 'color', 'white'), ('US-HOODIE-WHT-M', 'clothing_size', 'm'),
  ('US-HOODIE-BLK-L', 'color', 'black'), ('US-HOODIE-BLK-L', 'clothing_size', 'l'),
  ('MA-HOODIE-WHT-M', 'color', 'white'), ('MA-HOODIE-WHT-M', 'clothing_size', 'm'),
  ('MA-HOODIE-RED-M', 'color', 'red'), ('MA-HOODIE-RED-M', 'clothing_size', 'm'),
  ('US-SHOE-BLK-EU40', 'color', 'black'), ('US-SHOE-BLK-EU40', 'shoe_size', 'eu-40'),
  ('US-SHOE-BLK-EU42', 'color', 'black'), ('US-SHOE-BLK-EU42', 'shoe_size', 'eu-42'),
  ('US-SHOE-WHT-US9', 'color', 'white'), ('US-SHOE-WHT-US9', 'shoe_size', 'us-9'),
  ('MA-BAG-BLK-S', 'color', 'black'), ('MA-BAG-BLK-S', 'bag_size', 'small'),
  ('MA-BAG-BLK-M', 'color', 'black'), ('MA-BAG-BLK-M', 'bag_size', 'medium'),
  ('CS-WATCH-A-SLV-40', 'model', 'watch-a'), ('CS-WATCH-A-SLV-40', 'strap_color', 'silver'), ('CS-WATCH-A-SLV-40', 'case_size', '40-mm'),
  ('CS-WATCH-A-BLK-42', 'model', 'watch-a'), ('CS-WATCH-A-BLK-42', 'strap_color', 'black'), ('CS-WATCH-A-BLK-42', 'case_size', '42-mm'),
  ('CS-BELT-A-BLK-100', 'model', 'belt-a'), ('CS-BELT-A-BLK-100', 'color', 'black'), ('CS-BELT-A-BLK-100', 'accessory_size', '100-cm'),
  ('EL-PERF-50-EDT', 'volume_ml', '50-ml'), ('EL-PERF-50-EDT', 'concentration', 'edt'),
  ('EL-PERF-100-EDP', 'volume_ml', '100-ml'), ('EL-PERF-100-EDP', 'concentration', 'edp')
)
INSERT INTO app.variant_attribute_values(variant_id, attribute_id, value_id)
SELECT pv.id, a.id, av.id
FROM opt_defs o
JOIN app.product_variants pv ON pv.sku = o.sku
JOIN app.attributes a ON a.code = o.attr_code
JOIN app.attribute_values av ON av.attribute_id = a.id AND av.code = o.val_code
WHERE NOT EXISTS (
  SELECT 1 FROM app.variant_attribute_values existing
  WHERE existing.variant_id = pv.id AND existing.attribute_id = a.id
);

WITH img_defs(prod_slug, variant_sku, asset_path, alt_text, is_primary) AS (VALUES
  ('ao-phao-nordic-peak', NULL, '/media/sanphamdemo1.jpg', 'Áo phao Nordic Peak đỏ trầm', TRUE),
  ('ao-hoodie-urban-stride', NULL, '/media/sanphamdemo2.jpg', 'Áo hoodie Urban Stride trắng kem', TRUE),
  ('ao-hoodie-maison-classic', NULL, '/media/sanphamdemo4.jpg', 'Áo hoodie Maison Classic trắng', TRUE),
  ('ao-hoodie-maison-classic', 'MA-HOODIE-RED-M', '/media/sanphamdemo5.jpg', 'Áo hoodie Maison Classic đỏ', TRUE),
  ('giay-sneaker-urban-runner', NULL, '/media/sanphamdemo3.jpg', 'Giày Sneaker Urban Runner demo', TRUE),
  ('tui-tote-maison-atelier', NULL, '/media/sanphamdemo4.jpg', 'Túi Tote Maison Atelier demo', TRUE),
  ('dong-ho-chronos-minimalist', NULL, '/media/sanphamdemo6.jpg', 'Đồng hồ Chronos Minimalist demo', TRUE),
  ('that-lung-chronos-classic', NULL, '/media/sanphamdemo6.jpg', 'Thắt lưng Chronos Classic demo', TRUE),
  ('nuoc-hoa-essence-amber-woods', NULL, '/media/sanphamdemo2.jpg', 'Nước hoa Essence Amber Woods demo', TRUE)
)
INSERT INTO app.product_images(product_id, variant_id, asset_path, alt_text, sort_order, is_primary)
SELECT p.id, pv.id, d.asset_path, d.alt_text, 0, d.is_primary
FROM img_defs d
JOIN app.products p ON p.slug = d.prod_slug
LEFT JOIN app.product_variants pv ON pv.sku = d.variant_sku
WHERE NOT EXISTS (
  SELECT 1 FROM app.product_images pi
  WHERE pi.product_id = p.id
    AND pi.variant_id IS NOT DISTINCT FROM pv.id
    AND pi.asset_path = d.asset_path
);

-- Publish all 8 catalog demo products after variants & images exist
UPDATE app.products
SET is_active = TRUE
WHERE slug IN (
  'ao-phao-nordic-peak', 'ao-hoodie-urban-stride', 'ao-hoodie-maison-classic',
  'giay-sneaker-urban-runner', 'tui-tote-maison-atelier', 'dong-ho-chronos-minimalist',
  'that-lung-chronos-classic', 'nuoc-hoa-essence-amber-woods'
) AND NOT is_active;

-- Seed initial stock via ledger IMPORT (leaving US-SHOE-WHT-US9 at 0 stock to exercise out-of-stock filters)
WITH stock_defs(sku, qty) AS (VALUES
  ('NP-PUFFER-BURG-M', 15), ('NP-PUFFER-BURG-L', 8),
  ('US-HOODIE-WHT-M', 20), ('US-HOODIE-BLK-L', 12),
  ('MA-HOODIE-WHT-M', 10), ('MA-HOODIE-RED-M', 6),
  ('US-SHOE-BLK-EU40', 14), ('US-SHOE-BLK-EU42', 9),
  ('MA-BAG-BLK-S', 5), ('MA-BAG-BLK-M', 7),
  ('CS-WATCH-A-SLV-40', 4), ('CS-WATCH-A-BLK-42', 3),
  ('CS-BELT-A-BLK-100', 18),
  ('EL-PERF-50-EDT', 11), ('EL-PERF-100-EDP', 7)
), imported AS (
  INSERT INTO app.inventory_transactions(variant_id, type, quantity_change, reference_type, note, created_by, request_key)
  SELECT pv.id, 'IMPORT', sd.qty, 'IMPORT', 'Initial multi-brand demo catalog stock', u.id, md5('multibrand-seed:' || pv.sku)::uuid
  FROM stock_defs sd
  JOIN app.product_variants pv ON pv.sku = sd.sku
  CROSS JOIN app.users u
  WHERE u.email = 'warehouse@seed-demo.invalid'
  ON CONFLICT (created_by, request_key) WHERE type = 'IMPORT' DO NOTHING
  RETURNING variant_id, quantity_change
)
UPDATE app.inventory i
SET quantity = i.quantity + imp.quantity_change
FROM imported imp
WHERE i.variant_id = imp.variant_id;

INSERT INTO app.banners(title, desktop_path, mobile_path, alt_text, placement, target_type, category_id, starts_at, ends_at, sort_order, is_active)
SELECT 'Bộ Sưu Tập Thu Đông Đa Thương Hiệu', '/media/styleweb.png', NULL, 'Banner Hero Thu Đông', 'HERO', 'CATEGORY', c.id,
       '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z', 0, TRUE
FROM app.categories c WHERE c.slug = 'fashion'
AND NOT EXISTS (SELECT 1 FROM app.banners WHERE title = 'Bộ Sưu Tập Thu Đông Đa Thương Hiệu');

INSERT INTO app.banners(title, desktop_path, mobile_path, alt_text, placement, target_type, brand_id, starts_at, ends_at, sort_order, is_active)
SELECT 'Khám Phá Essence Lab', '/media/sanphamdemo2.jpg', NULL, 'Banner Promo Essence Lab', 'PROMO', 'BRAND', b.id,
       '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z', 1, TRUE
FROM app.brands b WHERE b.slug = 'essence-lab'
AND NOT EXISTS (SELECT 1 FROM app.banners WHERE title = 'Khám Phá Essence Lab');
