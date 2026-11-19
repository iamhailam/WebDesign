# Hợp đồng REST API

Bản thiết kế 1.0 — 19/11/2026. Base path `/api`, JSON UTF-8, giữ các URL gốc SPEC §5. G/U/D theo [PRD](PRD.md); thay đổi preview, giá, SKU và quyền DB chưa được coi là đã duyệt cho tới khi chốt [DECISIONS](DECISIONS.md). Đây là hợp đồng mô tả, chưa có server/OpenAPI sinh tự động.

## 1. Quy tắc chung

- PUBLIC không cần token; C=CUSTOMER, S=SALES, W=WAREHOUSE, M=MARKETING, A=ADMIN. Nhóm quyền là allowlist, không coi A kế thừa C.
- Auth: `Authorization: Bearer <JWT>`. Verify chữ ký/exp/iss/aud; đọc active, role, token_version hiện hành; actor_id không lấy từ body. ID int dương, BIGINT/version serialize string; UUID là chuỗi canonical.
- Money M là decimal string có đúng 2 số lẻ, ví dụ `"1290000.00"`; VND phải .00 theo D-01. Không dùng JSON number cho tiền; numeric percentage cũng dùng string, có thể có 2 số lẻ. Time ISO8601 UTC có Z; date filter YYYY-MM-DD theo Asia/Ho_Chi_Minh.
- Giá/tiền từng đơn phải nằm trong NUMERIC(12,2); tổng báo cáo có thể lớn hơn miền một cột đơn và vẫn là decimal string, không cast về NUMERIC(12,2). Vượt miền lưu đơn hoặc lượng INT trả 400 AMOUNT_OUT_OF_RANGE.
- Chuỗi trim trước validation; voucher/SKU uppercase, email lowercase. Slug `[a-z0-9]+(?:-[a-z0-9]+)*`, 1..160 (product tới 220), không tùy ý Unicode URL ở v1.
- List: page mặc định 1, page_size 20, tối đa 100, order ổn định có id tie-breaker; không nhận SQL sort tùy ý. Mọi list gồm data.items và meta.pagination. Offset pagination là baseline, cursor là O khi cần.
- Write reject unknown fields/read-only fields; required/null/default theo từng DTO. `PUT` yêu cầu đầy đủ các field editable liệt kê, không thay toàn bộ read model; immutable field không gửi. `PATCH` chỉ dùng status có hợp đồng riêng. DELETE thành công trả 200 JSON, không 204 để giữ envelope.
- POST tạo mới trả 201, GET/PUT/PATCH/DELETE 200; 401 token thiếu/hết hạn/version sai/inactive, 403 sai role, 404 không tồn tại hoặc CUSTOMER truy đơn không sở hữu. Không trả object trước rồi mới kiểm ownership.
- proposed limits: JSON 64KiB, description theo dictionary, search≤100, note≤1000, quantity 1..999; UI không phải lớp validation duy nhất. HTTP 413 nếu body quá lớn, 429 với Retry-After khi rate limit.
- Request-ID UUID do server sinh hoặc chấp nhận UUID hợp lệ từ ingress tin cậy; trả meta.request_id. Không dùng request ID để dedup mutation.
- Đăng ký static routes như by-slug, available và my-orders trước route :id tương ứng; path ID chỉ nhận số dương. Không để tên route tĩnh bị parse thành ID.

Envelope thành công đơn:

```json
{"success":true,"data":{"id":101},"meta":{"request_id":"22222222-2222-4222-8222-222222222222"}}
```

Envelope list: `data={"items":[...]}`, `meta={"request_id":"...","pagination":{"page":1,"page_size":20,"total":42,"total_pages":3}}`. List rỗng total_pages=0. Error:

```json
{"success":false,"message":"Sản phẩm vừa hết hàng.","error":{"code":"OUT_OF_STOCK","details":{"variant_id":12,"available":0}},"meta":{"request_id":"22222222-2222-4222-8222-222222222222"}}
```

error.details là object, không SQL/stack/hash/PII. Validation trả details.fields array `{field,reason}`. Thêm error/meta không bỏ success/data/message của G.

## 2. DTO chuẩn dùng trong các route

Ký hiệu R=bắt buộc, ?=nullable; trường không có ? là nonnull. Trường default có thể bỏ khi POST; PUT phải gửi đủ writable fields. Các response là field allowlist, không serialize row DB nguyên trạng.

| DTO | Các field response |
| --- | --- |
| UserSelf | id, full_name, email, phone?, role, is_active, created_at; không password_hash/token_version |
| Brand | id,name,slug,description?,logo_path?,is_active,created_at,updated_at |
| Category | id,name,slug,description?,is_active,created_at |
| Image | id,product_id,variant_id?,asset_path,alt_text,sort_order,is_primary,created_at |
| Option | attribute_id,code,label,value_id,value_code,value_label; label có unit khi cần |
| Variant | id,product_id,sku,options:Option[],price:M,list_price:M?,stock_quantity:int,is_active,images:Image[]; color/size alias? chỉ nếu tồn tại |
| ProductCard | id,name,slug,brand:{id,name,slug},category:{id,name,slug},product_type_code,base_image_url?,price_min:M,price_max:M,in_stock:boolean; giá từ active SKUs |
| ProductDetail | ProductCard + description?,images:Image[],variants:Variant[],option_schema:[{attribute_id,code,label,required,values:[{id,code,label}]}] |
| Cart | id,version:string,items:CartLine[],subtotal_amount:M,has_stock_issues:boolean,has_unavailable_items:boolean |
| CartLine | variant_id,sku,product_id,product_name,product_slug,options:Option[],image_url?,quantity,unit_price:M,list_price:M?,line_amount:M,stock_quantity,available:boolean,issue_code? |
| OrderSummary | id,order_code,status,payment_method,payment_status,subtotal_amount:M,discount_amount:M,final_amount:M,voucher_code?,created_at,updated_at,delivered_at? |
| OrderDetail | OrderSummary + user_id,recipient_name,recipient_phone,shipping_address,items:OrderLine[]; chỉ owner/S/A |
| OrderLine | id,variant_id,sku,product_name,brand_name,options_snapshot:array,quantity,unit_price:M,list_unit_price:M?,line_amount:M; toàn bộ từ snapshot |
| Voucher | id,code,discount_type,discount_value:string,max_discount_amount:M?,min_order_amount:M,usage_limit,used_count,start_date,end_date,is_active,created_at |
| InventoryRow | variant_id,sku,product_name,options:Option[],quantity,updated_at,is_active |
| InventoryTransaction | id:string,variant_id,sku,type,quantity_change,reference_type,reference_id?,order_code?,note?,created_by,created_at; không shipping data |
| Banner | id,title,desktop_path,mobile_path?,alt_text,placement,target_type,product_id?,category_id?,brand_id?,starts_at,ends_at,sort_order,is_active,target_path? |
| AuditEvent | id:string,actor_id?,actor_kind,action,entity_type,entity_id,changes:object,request_id?,created_at |

Product admin detail thêm is_active, created_at, updated_at và tất cả inactive variants/images; public detail không lộ SKU inactive. Product public chỉ khi brand/category/product active và có active variant; tồn 0 vẫn public. brand/category detail inactive trả 404 ở public.

## 3. Auth và quản lý người dùng

| Method path | Quyền/nguồn | Request | Success và lỗi đặc thù |
| --- | --- | --- | --- |
| POST /api/auth/register | PUBLIC, G | full_name R 1..120, email R≤254, password R 12..128, phone?≤20 | 201 UserSelf; 409 EMAIL_EXISTS; server tạo CUSTOMER + cart, không tự login |
| POST /api/auth/login | PUBLIC, G | email R,password R | 200 {access_token,token_type:"Bearer",expires_in:1800,user:UserSelf}; 401 INVALID_CREDENTIALS chung cho email/password/inactive |
| GET /api/auth/me | C/S/W/M/A, G | Không body | 200 UserSelf hiện hành |
| GET /api/users | A, D bổ sung G UI | page,page_size,search?,role?,is_active? | 200 list UserSelf |
| GET /api/users/:id | A, D | ID path | 200 UserSelf, 404 |
| PUT /api/users/:id | A, D | full_name R,phone?,role R,is_active R | 200 UserSelf; tăng token_version nếu role/active đổi; 409 LAST_ADMIN_PROTECTED |

Không public reset password/email verification/refresh/session API ở v1. Logout xóa token trong memory; D-10 nêu giới hạn thu hồi. Password không ghi log; chọn thuật toán adaptive và parameters ở T04, không lưu plaintext. Hai admin cùng hạ quyền nhau phải được DB serialize, còn ít nhất một ADMIN active.

## 4. Catalog public và catalog admin

| Method path | Quyền/nguồn | Query/body | Success |
| --- | --- | --- | --- |
| GET /api/categories | PUBLIC, G | page,page_size | List Category active |
| GET /api/brands | PUBLIC, U | page,page_size,search? | List Brand active |
| GET /api/categories/by-slug/:slug | PUBLIC, D | Slug path | Category active hoặc 404 |
| GET /api/brands/by-slug/:slug | PUBLIC, D | Slug path | Brand active hoặc 404 |
| GET /api/product-types | PUBLIC, D-02 | Không | {items:[{code,name,attributes:[{id,code,name,unit?,is_required,values:[{id,code,label}]}]}]}; metadata seed không CRUD v1; pagination toàn bộ 6 types trong một response |
| GET /api/products | PUBLIC, G+U | Catalog query bên dưới | List ProductCard |
| GET /api/products/:id | PUBLIC, G | ID số | ProductDetail active hoặc 404 |
| GET /api/products/by-slug/:slug | PUBLIC, D | Route static trước :id | ProductDetail active hoặc 404 |
| GET /api/admin/products | A, D | page,page_size,search?,brand_id?,category_id?,product_type?,is_active? | List card + is_active, cho cả draft/inactive |
| GET /api/admin/products/:id | A, D | ID | Product admin detail |
| GET /api/admin/brands | A, D | page,page_size,search?,is_active? | List mọi Brand |
| GET /api/admin/brands/:id | A, D | ID | Brand |
| GET /api/admin/categories | A, D | page,page_size,search?,is_active? | List mọi Category |
| GET /api/admin/categories/:id | A, D | ID | Category |
| POST /api/products | A, G+U | ProductCreate | 201 {id,...ProductEditable,is_active:false} |
| PUT /api/products/:id | A, G+U | ProductEditable | 200 {id,...ProductEditable}; 409 PRODUCT_NOT_PUBLISHABLE |
| POST /api/products/:id/variants | A, G+D-02 | VariantCreate | 201 Variant, inventory=0 |
| PUT /api/variants/:id | A, G+D-01 | VariantEditable | 200 Variant; không sửa options/SKU/product |
| POST /api/categories | A, D bổ sung G UI | CategoryCreate | 201 Category |
| PUT /api/categories/:id | A, D | CategoryEditable | 200 Category |
| POST /api/brands | A, U | BrandCreate | 201 Brand |
| PUT /api/brands/:id | A, U | BrandEditable | 200 Brand |
| POST /api/products/:id/images | A, U | ImageCreate | 201 Image |
| PUT /api/product-images/:id | A, U | ImageEditable | 200 Image |
| DELETE /api/product-images/:id | A, U | Không body | 200 {removed:true}; 409 LAST_PRODUCT_IMAGE nếu active product mất gallery |

Catalog query: page/page_size, category_id?, brand_id?, product_type? (6 code), search?≤100, min_price?:M, max_price?:M, in_stock?:true/false, sort?=newest/price_asc/price_desc/name_asc (default newest). Reject min>max, boolean sai hoặc sort lạ với 400. Nếu lọc giá và in_stock=true, phải có **cùng một active SKU** thỏa cả hai; không ghép SKU giá rẻ hết hàng với SKU đắt còn hàng. Card price_min/max vẫn lấy toàn bộ active SKU của product, không giả giá khuyến mãi từ SKU khác; in_stock là tồn active SKU bất kỳ. Sort price dựa min/max card được công bố (price_asc=min, price_desc=max), tie id. Stock hiển thị không phải reservation.

Write DTO:

| DTO | Các field writable và required |
| --- | --- |
| ProductCreate | name R≤200,slug R≤220,category_id R,brand_id R,product_type_code R,description?; tạo draft; reject is_active=true |
| ProductEditable | name R,category_id R,brand_id R,description?,is_active R; slug/type immutable sau tạo ở v1 |
| VariantCreate | sku R≤64,price R:M,list_price?:M,options R array {attribute_id,value_id},is_active default true; options có thể [] chỉ khi schema loại cho phép |
| VariantEditable | price R:M,list_price?:M,is_active R; list_price null để bỏ giá niêm yết |
| CategoryCreate | name R≤120,slug R≤160,description?,is_active default true |
| CategoryEditable | name R,description?,is_active R; slug immutable |
| BrandCreate | name R≤120,slug R≤160,description?,logo_path?,is_active default true |
| BrandEditable | name R,description?,logo_path?,is_active R; slug immutable |
| ImageCreate | variant_id?,asset_path R,alt_text R≤200,sort_order default 0,is_primary default false |
| ImageEditable | asset_path R,alt_text R,sort_order R≥0,is_primary R; product_id/variant_id immutable |

Optional nullable fields POST bỏ thì null; PUT phải có key và có thể null. Asset paths chỉ `/media/...` hoặc `/images/...` đã cấp, ≤500, không `..`, query, protocol hay executable suffix. API chỉ lưu metadata, không multipart upload. Khi đổi primary, function demote ảnh cũ cùng scope trước promote ảnh mới trong cùng transaction. Không có DELETE product/category/brand/variant; deactivate bằng PUT.

Variant example PERFUME:

```json
{"sku":"DEMO-PERFUME-100-EDP","price":"1500000.00","list_price":"1800000.00","options":[{"attribute_id":9,"value_id":101},{"attribute_id":10,"value_id":102}],"is_active":true}
```

ID chỉ minh họa; phải lấy metadata thật từ /product-types. Thiếu required, axis/value không hợp type hoặc duplicate axis →400 VARIANT_OPTIONS_INVALID. Trùng tổ hợp trong product hoặc SKU toàn hệ thống →409 DUPLICATE_VARIANT; không dùng NULL color/size để phân biệt.

## 5. Giỏ và voucher preview

| Method path | Quyền | Request | Response/lỗi |
| --- | --- | --- | --- |
| GET /api/cart | C, G | Không body | 200 Cart hiện tại; giá/tồn mới nhất |
| POST /api/cart/items | C, G | {variant_id:int,quantity:int 1..999} | 200 Cart; quantity cộng dồn, tổng không vượt 999; không trừ kho |
| PUT /api/cart/items/:variantId | C, G | {quantity:int 1..999} | 200 Cart; 404 CART_ITEM_NOT_FOUND |
| DELETE /api/cart/items/:variantId | C, G | Không body | 200 Cart; không có dòng thì vẫn 200 Cart hiện hành |
| GET /api/vouchers/available | C, G | page,page_size | List Voucher terms + {eligible_for_cart:boolean,ineligible_reason?:code}; đang active/còn lượt/trong lịch, không bảo đảm đủ giỏ hoặc chưa dùng |
| POST /api/vouchers/preview | C, G+D-04 | {voucher_code:string,cart_version:string,subtotal?:M} | 200 {voucher_code,cart_version,subtotal_amount,discount_amount,final_amount,preview_only:true} |

Preview server tính subtotal từ giỏ đã kiểm active; subtotal client là field tương thích G tùy chọn, nếu gửi phải bằng subtotal server, khác →409 PRICE_CHANGED. cart_version lệch →409 CART_CHANGED. Giỏ trống →409 CART_EMPTY; inactive item →409 ITEM_UNAVAILABLE. Preview không update used_count/usages, không khóa lượt. Invalid voucher →409 với code bên dưới. Cart có thể giữ dòng đã inactive/hết hàng để giải thích và cho xóa; không lặng lẽ loại khỏi tổng checkout.

## 6. Checkout và orders

POST /api/orders/checkout (C, G+D-03) yêu cầu header `Idempotency-Key: <UUID>`. Body:

```json
{
  "shipping_address":"123 Đường Mẫu, phường Mẫu, TP Hồ Chí Minh",
  "recipient_name":"Khách Demo",
  "recipient_phone":"0900000000",
  "voucher_code":"DEMO10",
  "cart_version":"7",
  "expected_items":[{"variant_id":12,"quantity":1,"unit_price":"900000.00"}]
}
```

shipping_address R 10..500; recipient_name R 1..120; recipient_phone R 8..15 digits với + optional đầu; voucher_code? null hoặc 1..40, không chuỗi rỗng; cart_version R string integer≥0; expected_items R 1..100 dòng, không duplicate variant, mỗi quantity 1..999, unit_price:M. Giỏ tối đa 100 dòng được enforce ở cart mutation/DB. Body không nhận user_id, payment_method, status, subtotal, discount hay final.

201 mới: `data={order:OrderDetail,replayed:false}`. 200 replay cùng key/payload: `data={order:OrderDetail,replayed:true}`, cùng order_id và snapshot tiền, status đọc hiện hành. Khác payload cùng key →409 IDEMPOTENCY_KEY_REUSED. Thành công trả Location `/api/orders/:id`. Không trả thành công trước commit.

Giá/giỏ/stock/voucher được xác minh lại trong fn_place_order, không tin expected_items làm nguồn giá; expected chỉ để phát hiện thay đổi. Stock thiếu →409 OUT_OF_STOCK, price khác →409 PRICE_CHANGED, giỏ khác →409 CART_CHANGED; client refresh giỏ và xác nhận lại, dùng key mới. Mất kết nối không rõ commit →retry đúng key/body, không tạo key mới. Key thất bại rollback, không lưu FAILED bền vững.

| Method path | Quyền/nguồn | Request | Success/lỗi |
| --- | --- | --- | --- |
| GET /api/orders/my-orders | C, G | page,page_size,status? | List OrderSummary kèm items:OrderLine[] (giữ G yêu cầu chi tiết items); chỉ user hiện tại |
| GET /api/orders | S/A, G | page,page_size,status?,order_code?,user_id? | List OrderSummary + user_id,recipient_name; không full address trong list |
| GET /api/orders/:id | C owner/S/A, D bổ sung UI | ID | OrderDetail; CUSTOMER đơn người khác trả 404 |
| PATCH /api/orders/:id/status | S/A, G+D-07 | {expected_status:status,target_status:CONFIRMED/SHIPPING/DELIVERED} | 200 OrderDetail; expected lệch hoặc nhảy bước →409 |
| POST /api/orders/:id/cancel | C owner/S/A, G+D-06 | {reason:string 1..500} | 200 OrderDetail; trạng thái không hủy được (kể cả CANCELLED)→409 ORDER_NOT_CANCELLABLE |

reason là D audit, không thêm luồng đổi trả. Status/cancel share row lock. Cancel trước hay sau status được xác định bởi lock winner; không tự retry intent cancel khi đã SHIPPING. Không DELETE đơn, không sửa tiền/address/payment hoặc items qua API.

## 7. Kho

| Method path | Quyền/nguồn | Request | Success |
| --- | --- | --- | --- |
| GET /api/inventory | W/A, G | page,page_size,search?,low_stock_threshold?:int≥0 | List InventoryRow; threshold lọc quantity≤threshold |
| POST /api/inventory/import | W/A, G+D | Idempotency-Key UUID R; {variant_id:int,quantity:1..999999,note:string 1..1000} | 201 {transaction:InventoryTransaction,replayed:false}; cùng payload/key 200 replay |
| GET /api/inventory/transactions | W/A, G | page,page_size,variant_id?,type?,order_id?,from?:date,to?:date | List InventoryTransaction |

Nhập dùng CALL sp_import_inventory, trả OUT transaction_id/replayed; DB giới hạn INT overflow. Key scope actor, payload khác cùng key →409 IDEMPOTENCY_KEY_REUSED. Không quantity PATCH/stock adjustment/warehouse API. Variant inactive vẫn được xem/nhập để xử lý tồn nhưng không bán cho đến active. W không có quyền OrderDetail; order_code chỉ reference text.

## 8. Voucher management và báo cáo

| Method path | Quyền/nguồn | Request | Success |
| --- | --- | --- | --- |
| GET /api/vouchers | M/A, G | page,page_size,search?,is_active? | List Voucher |
| GET /api/vouchers/:id | M/A, D | ID | Voucher |
| POST /api/vouchers | M/A, G | VoucherCreate | 201 Voucher |
| PUT /api/vouchers/:id | M/A, G | VoucherEditable | 200 Voucher; 409 VOUCHER_TERMS_LOCKED nếu sửa terms đã dùng |
| GET /api/vouchers/:id/usages | M/A, G | page,page_size,status?:APPLIED/RELEASED | List {id,voucher_id,user_id,user_display_name,email_masked,order_id,order_code,status,used_at}; không địa chỉ/phone |
| GET /api/reports/revenue | M/A, G+D-11 | from R date,to R date,group_by?:day/month (default day) | List {period_start,order_count:int,gross_amount:M,discount_amount:M,revenue_amount:M}; data.totals cùng fields trừ period_start |
| GET /api/reports/best-sellers | M/A, G+D-11 | from R,to R,level?:product/sku (default product),page,page_size | List {rank:int,product_id,product_name,variant_id?,sku?,quantity_sold:string,gross_item_amount:M} |

VoucherCreate R: code,discount_type,discount_value,min_order_amount,usage_limit,start_date,end_date; max_discount_amount?; is_active default true. VoucherEditable đủ các field create trừ code immutable; used_count/id/created_at bị reject. Mọi nullable cap phải gửi key với null nếu không dùng; FIXED yêu cầu null. PERCENT 0<value≤100, FIXED>0 nguyên đồng; min≥0, cap>0 nếu có, limit>0, end>start. Khi đã có usage, chỉ đổi active/tăng limit; các field khác gửi phải đúng giá trị cũ. Lỗi syntax/constraints 400, bị terms lock 409.

Reports from/to inclusive local dates, tối đa 366 ngày và from≤to; server đổi sang [đầu ngày from, đầu ngày sau to) theo Asia/Ho_Chi_Minh. Revenue theo delivered_at, chỉ DELIVERED; gross=SUM(subtotal), discount=SUM(discount), revenue=SUM(final), order_count=COUNT orders; không join items. Best sellers theo thời điểm delivered_at, gross_item_amount=SUM(unit_price×quantity), **chưa phân bổ voucher**, không gọi đó là doanh thu thuần SKU. RANK quantity có ties, sort rank,id ổn định. Summary không cần pagination (≤366 buckets) nhưng vẫn dùng list envelope với pagination tương ứng toàn bộ buckets. Không có dữ liệu trả 0/[] thay null tiền.

## 9. Banners, audit và health

| Method path | Quyền/nguồn | Request | Success |
| --- | --- | --- | --- |
| GET /api/banners | PUBLIC, U | placement?:HERO/PROMO,page,page_size | List Banner đang active/lịch/target active; target_path server derive |
| GET /api/admin/banners | A, U+D-09 | page,page_size,placement?,is_active? | List mọi Banner |
| GET /api/admin/banners/:id | A, U | ID | Banner |
| POST /api/admin/banners | A, U | BannerCreate | 201 Banner |
| PUT /api/admin/banners/:id | A, U | BannerEditable | 200 Banner |
| GET /api/admin/audit-events | A, D-13 | page,page_size,actor_id?,entity_type?,entity_id?,action?,from?,to? | List AuditEvent đã whitelist |
| GET /api/health/live | PUBLIC, D vận hành | Không | 200 {status:"ok"}; không DB details |
| GET /api/health | PUBLIC, U Task02 | Alias liveness | 200 {status:"ok",service:"fashion-api"} trong data; không query DB |
| GET /api/health/ready | Ingress vận hành, D | Không | 200 data {status:"ready",database:"up"} hoặc 503 error.code DATABASE_UNAVAILABLE; bảo vệ truy cập ngoài bằng ingress |

BannerCreate/Editable: title R≤160,desktop_path R,mobile_path?,alt_text R≤200,placement R,target_type R,product_id?,category_id?,brand_id?,starts_at R,ends_at R,sort_order default0 ở POST/R ở PUT,is_active defaultfalse ở POST/R ở PUT. Chọn đúng FK theo target_type, còn lại null; NONE tất cả null. Schedule [start,end), khác voucher inclusive G có chủ ý. target_path read-only derive `/products/:slug`, `/categories/:slug`, `/brands/:slug`; không input external URL/HTML. Banner deactivate bằng PUT, không DELETE v1.

## 10. Mã lỗi và SQLSTATE

SQLSTATE P10xx dưới đây là namespace **dự án đề xuất**, implementation phải RAISE đúng code và mapping allowlist; không dùng nguyên văn SQL exception làm message public. Validation JSON/query trả 400 trước DB nhưng DB vẫn chặn bypass.

| SQLSTATE/domain | HTTP | error.code | Chi tiết cho phép |
| --- | --- | --- | --- |
| P1001 | 409 | OUT_OF_STOCK | variant_id,available |
| P1002 | 409 | VOUCHER_INVALID | reason:NOT_FOUND/INACTIVE/NOT_STARTED/EXPIRED/MIN_ORDER_NOT_MET |
| P1003 | 409 | VOUCHER_EXHAUSTED | code |
| P1004 | 409 | VOUCHER_ALREADY_USED | code |
| P1005 | 409 | CART_EMPTY | Không |
| P1006 | 409 | CART_CHANGED | current_version |
| P1007 | 409 | PRICE_CHANGED | variant_ids; client GET cart để xem lại giá |
| P1008 | 409 | ITEM_UNAVAILABLE | variant_ids |
| P1009 | 409 | IDEMPOTENCY_KEY_REUSED | Không payload/PII |
| P1010 | 409 | ORDER_NOT_CANCELLABLE | current_status |
| P1011 | 409 | INVALID_STATUS_TRANSITION hoặc STALE_ORDER_STATUS | current_status,allowed_targets |
| P1012 | 409 | VOUCHER_TERMS_LOCKED | fields |
| P1013 | 409 | LAST_ADMIN_PROTECTED | Không |
| P1014 | 409 | PRODUCT_NOT_PUBLISHABLE hoặc LAST_PRODUCT_IMAGE | missing_requirements |
| P2001 | 400 | VALIDATION_ERROR hoặc VARIANT_OPTIONS_INVALID | fields |
| P2002 | 400 | AMOUNT_OUT_OF_RANGE | field, không SQL nội bộ |
| P3001 | 403/404 | FORBIDDEN hoặc NOT_FOUND | 404 cho resource ownership conceal |
| P4001 | 404 | NOT_FOUND hoặc CART_ITEM_NOT_FOUND | Không |
| 23505 allowlisted constraint | 409 | EMAIL_EXISTS/DUPLICATE_VARIANT/DUPLICATE_CODE | field; unknown constraint→500 |
| 23503/23514 đã nhận diện | 400/409 | INVALID_REFERENCE/VALIDATION_ERROR/RESOURCE_CONFLICT | Map theo operation; không trả tên bảng nội bộ |
| 40P01/40001 | Retry rồi 503 | RETRYABLE_TRANSACTION | Retry-After:1 nếu vẫn lỗi |
| 55P03/57014 | 503 | RESOURCE_BUSY | Retry-After:1 |
| Không xác định | 500 | INTERNAL_ERROR | Chỉ request_id, log nội bộ có redaction |

## 11. Test contracts bắt buộc

Test envelope/types/money strings, schema unknown-field reject, static route trước :id, pagination tie; C/S/W/M/A allow/deny; IDOR 404; inactive/token_version401; public không lộ draft. Stock/voucher race, cart same-key/same-cart, price mismatch, duplicate options, images cross-product, multi-SKU cancel, finalized order, report SUM/ties/timezone đều nối task T20–T25 trong [TASKS](../TASKS.md). Không viết hoặc chạy API trong task tài liệu này.
