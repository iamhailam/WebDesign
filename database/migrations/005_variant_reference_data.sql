-- Up Migration
SET LOCAL ROLE db_admin;
INSERT INTO app.product_types(code,name) VALUES
 ('CLOTHING','Quần áo'),('SHOES','Giày'),('BAGS','Túi'),('WATCHES','Đồng hồ'),('ACCESSORIES','Phụ kiện'),('PERFUME','Nước hoa');
INSERT INTO app.attributes(code,name,unit) VALUES
 ('color','Màu sắc',NULL),('clothing_size','Kích cỡ quần áo',NULL),('shoe_size','Cỡ giày và hệ size',NULL),
 ('bag_size','Kích thước túi',NULL),('model','Mẫu',NULL),('strap_color','Màu dây',NULL),
 ('case_size','Đường kính','mm'),('accessory_size','Kích thước phụ kiện',NULL),
 ('volume_ml','Dung tích','ml'),('concentration','Nồng độ',NULL);
INSERT INTO app.product_type_attributes(product_type_code,attribute_id,is_required,sort_order)
 SELECT x.type_code,a.id,x.required,x.position FROM (VALUES
 ('CLOTHING','color',TRUE,0),('CLOTHING','clothing_size',TRUE,1),
 ('SHOES','color',TRUE,0),('SHOES','shoe_size',TRUE,1),
 ('BAGS','color',TRUE,0),('BAGS','bag_size',FALSE,1),
 ('WATCHES','model',TRUE,0),('WATCHES','strap_color',TRUE,1),('WATCHES','case_size',FALSE,2),
 ('ACCESSORIES','model',TRUE,0),('ACCESSORIES','color',TRUE,1),('ACCESSORIES','accessory_size',FALSE,2),
 ('PERFUME','volume_ml',TRUE,0),('PERFUME','concentration',TRUE,1)
 ) AS x(type_code,attribute_code,required,position) JOIN app.attributes a ON a.code=x.attribute_code;
INSERT INTO app.attribute_values(attribute_id,code,label,sort_order)
 SELECT a.id,x.code,x.label,x.position FROM (VALUES
 ('color','black','Đen',0),('color','white','Trắng',1),('color','burgundy','Đỏ trầm',2),('color','red','Đỏ',3),
 ('clothing_size','s','S',0),('clothing_size','m','M',1),('clothing_size','l','L',2),('clothing_size','xl','XL',3),
 ('shoe_size','eu-40','EU 40',0),('shoe_size','eu-42','EU 42',1),('shoe_size','us-9','US 9',2),
 ('bag_size','small','Nhỏ',0),('bag_size','medium','Vừa',1),
 ('model','watch-a','Watch A',0),('model','belt-a','Belt A',1),
 ('strap_color','black','Đen',0),('strap_color','silver','Bạc',1),
 ('case_size','40-mm','40 mm',0),('case_size','42-mm','42 mm',1),
 ('accessory_size','100-cm','100 cm',0),
 ('volume_ml','50-ml','50 ml',0),('volume_ml','100-ml','100 ml',1),
 ('concentration','edp','Eau de Parfum',0),('concentration','edt','Eau de Toilette',1)
 ) AS x(attribute_code,code,label,position) JOIN app.attributes a ON a.code=x.attribute_code;

-- Down Migration
SET LOCAL ROLE db_admin;
-- RESTRICT FKs/guards intentionally reject rollback while catalog data uses these definitions.
DELETE FROM app.attribute_values;
DELETE FROM app.product_type_attributes;
DELETE FROM app.attributes;
DELETE FROM app.product_types;
