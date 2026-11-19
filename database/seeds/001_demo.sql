-- Development fixtures only. Accounts are inactive, hashes deliberately unusable.
-- All writes are scoped to reserved DEMO/seed-demo identifiers; no TRUNCATE or reset.
SELECT pg_advisory_xact_lock(71003,1);
SET LOCAL ROLE db_admin;
INSERT INTO app.users(full_name,email,password_hash,role,is_active)
 SELECT 'Seed Demo '||r,lower(r)||'@seed-demo.invalid','!disabled-demo-no-login!',r,FALSE
 FROM unnest(ARRAY['CUSTOMER','SALES','WAREHOUSE','MARKETING','ADMIN']) r
 ON CONFLICT(email) DO NOTHING;
INSERT INTO app.brands(name,slug,description) VALUES('Seed Demo Brand','seed-demo-brand','Synthetic fixture, not verified commercial metadata') ON CONFLICT(slug) DO NOTHING;
INSERT INTO app.categories(name,slug) VALUES('Seed Demo Catalog','seed-demo-catalog') ON CONFLICT(slug) DO NOTHING;
INSERT INTO app.products(category_id,brand_id,product_type_code,name,slug,description)
 SELECT c.id,b.id,t.code,'Seed Demo '||t.code,'seed-demo-'||lower(t.code),'Synthetic test product; not available for purchase'
 FROM app.product_types t CROSS JOIN app.brands b CROSS JOIN app.categories c
 WHERE b.slug='seed-demo-brand' AND c.slug='seed-demo-catalog'
 ON CONFLICT(slug) DO NOTHING;

WITH variants(sku,type_code) AS (VALUES
 ('DEMO-CLOTHING-M','CLOTHING'),('DEMO-CLOTHING-L','CLOTHING'),('DEMO-SHOES-42','SHOES'),
 ('DEMO-BAG-M','BAGS'),('DEMO-WATCH-A','WATCHES'),('DEMO-BELT-A','ACCESSORIES'),('DEMO-PERFUME-100-EDP','PERFUME'))
INSERT INTO app.product_variants(product_id,sku,price,list_price)
 SELECT p.id,v.sku,100.25,120.50 FROM variants v JOIN app.products p ON p.slug='seed-demo-'||lower(v.type_code)
 ON CONFLICT(sku) DO NOTHING;

WITH options(sku,attribute_code,value_code) AS (VALUES
 ('DEMO-CLOTHING-M','color','black'),('DEMO-CLOTHING-M','clothing_size','m'),
 ('DEMO-CLOTHING-L','color','black'),('DEMO-CLOTHING-L','clothing_size','l'),
 ('DEMO-SHOES-42','color','black'),('DEMO-SHOES-42','shoe_size','eu-42'),
 ('DEMO-BAG-M','color','black'),('DEMO-BAG-M','bag_size','medium'),
 ('DEMO-WATCH-A','model','watch-a'),('DEMO-WATCH-A','strap_color','silver'),('DEMO-WATCH-A','case_size','40-mm'),
 ('DEMO-BELT-A','model','belt-a'),('DEMO-BELT-A','color','black'),('DEMO-BELT-A','accessory_size','100-cm'),
 ('DEMO-PERFUME-100-EDP','volume_ml','100-ml'),('DEMO-PERFUME-100-EDP','concentration','edp'))
INSERT INTO app.variant_attribute_values(variant_id,attribute_id,value_id)
 SELECT v.id,a.id,x.id FROM options o JOIN app.product_variants v ON v.sku=o.sku
 JOIN app.attributes a ON a.code=o.attribute_code JOIN app.attribute_values x ON x.attribute_id=a.id AND x.code=o.value_code
 WHERE NOT EXISTS(SELECT FROM app.variant_attribute_values z WHERE z.variant_id=v.id AND z.attribute_id=a.id);

INSERT INTO app.product_images(product_id,asset_path,alt_text,is_primary)
 SELECT p.id,'/media/sanphamdemo1.jpg','Ảnh fixture áo khoác, metadata sản phẩm chưa được xác minh',TRUE
 FROM app.products p WHERE p.slug='seed-demo-clothing'
 AND NOT EXISTS(SELECT FROM app.product_images i WHERE i.product_id=p.id AND i.variant_id IS NULL AND i.is_primary);

WITH imported AS (
 INSERT INTO app.inventory_transactions(variant_id,type,quantity_change,reference_type,note,created_by,request_key)
 SELECT v.id,'IMPORT',12,'IMPORT','Initial synthetic seed stock',u.id,md5('seed-demo-import:'||v.sku)::uuid
 FROM app.product_variants v CROSS JOIN app.users u
 WHERE v.sku LIKE 'DEMO-%' AND u.email='warehouse@seed-demo.invalid'
 ON CONFLICT(created_by,request_key) WHERE type='IMPORT' DO NOTHING
 RETURNING variant_id,quantity_change)
UPDATE app.inventory i SET quantity=i.quantity+x.quantity_change FROM imported x WHERE i.variant_id=x.variant_id;

WITH new_order AS (
 INSERT INTO app.orders(order_code,user_id,shipping_address,recipient_name,recipient_phone,subtotal_amount,discount_amount,final_amount)
 SELECT 'DEMO-ORDER-001',u.id,'Synthetic fixture address 001','Demo Customer','0900000000',v.price*2,0,v.price*2
 FROM app.users u CROSS JOIN app.product_variants v
 WHERE u.email='customer@seed-demo.invalid' AND v.sku='DEMO-CLOTHING-M'
 AND NOT EXISTS(SELECT FROM app.orders WHERE order_code='DEMO-ORDER-001')
 RETURNING id),
new_items AS (
 INSERT INTO app.order_items(order_id,variant_id,quantity,unit_price,list_unit_price,product_name,brand_name,sku,options_snapshot)
 SELECT o.id,v.id,2,v.price,v.list_price,p.name,b.name,v.sku,
   (SELECT jsonb_agg(jsonb_build_object('code',a.code,'label',a.name,'value_code',x.code,'value_label',x.label) ORDER BY a.id)
    FROM app.variant_attribute_values z JOIN app.attributes a ON a.id=z.attribute_id JOIN app.attribute_values x ON x.id=z.value_id WHERE z.variant_id=v.id)
 FROM new_order o CROSS JOIN app.product_variants v JOIN app.products p ON p.id=v.product_id JOIN app.brands b ON b.id=p.brand_id
 WHERE v.sku='DEMO-CLOTHING-M' RETURNING order_id,variant_id,quantity),
exported AS (
 INSERT INTO app.inventory_transactions(variant_id,type,quantity_change,reference_type,reference_id,note,created_by)
 SELECT i.variant_id,'EXPORT_ORDER',-i.quantity,'ORDER',i.order_id,'Synthetic seed order',u.id
 FROM new_items i CROSS JOIN app.users u WHERE u.email='customer@seed-demo.invalid' RETURNING variant_id,quantity_change)
UPDATE app.inventory i SET quantity=i.quantity+x.quantity_change FROM exported x WHERE i.variant_id=x.variant_id;

INSERT INTO app.vouchers(code,discount_type,discount_value,max_discount_amount,min_order_amount,usage_limit,start_date,end_date)
 VALUES('SEED-DEMO10','PERCENT',10,50,100,100,'2026-01-01T00:00:00Z','2030-01-01T00:00:00Z') ON CONFLICT(code) DO NOTHING;
INSERT INTO app.banners(title,desktop_path,alt_text,placement,target_type,starts_at,ends_at)
 SELECT 'Seed Demo Banner','/media/styleweb.png','Draft fixture banner','HERO','NONE','2026-01-01T00:00:00Z','2030-01-01T00:00:00Z'
 WHERE NOT EXISTS(SELECT FROM app.banners WHERE title='Seed Demo Banner');
