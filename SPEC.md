<!-- Chuyển nguyên nội dung từ ĐẶC TẢ KỸ THUẬT SẢN PHẨM.docx; chỉ đổi định dạng sang Markdown. Nhận xét và đề xuất nằm trong docs/WORKSPACE_AUDIT.md. -->

# ĐẶC TẢ KỸ THUẬT SẢN PHẨM (TECHNICAL SPECIFICATION)

Tên hệ thống: Hệ thống Thương mại Điện tử Thời trang tích hợp Quản lý Đơn hàng, Voucher và Tồn kho 



Mô hình vận hành: Cửa hàng bán lẻ trực tuyến B2C (1 cửa hàng, 1 kho vật lý, thanh toán COD). 



Triết lý kiến trúc: Database-Centric — Toàn bộ tính toàn vẹn dữ liệu, kiểm soát xung đột đồng thời (concurrency), chốt giá lịch sử và quy tắc nghiệp vụ cốt lõi được thực thi trực tiếp tại tầng PostgreSQL; Backend và Frontend đóng vai trò giao tiếp API và hiển thị trực quan. 




## 1. Tech Stack & Kiến trúc Hệ thống

- Database: PostgreSQL (sử dụng thuần SQL & PL/pgSQL; không dùng ORM để kiểm soát trực tiếp Transaction, Locking và Execution Plan).

- Migration: node-pg-migrate (quản lý phiên bản lược đồ bằng tệp SQL thuần).

- Backend: Node.js, Express.js, thư viện pg (sử dụng connection pool và truy vấn tham số hóa $1, $2... để chống SQL Injection).

- Frontend: React (SPA), HTML5, CSS3 (giao tiếp hoàn toàn qua REST API của Express, không kết nối trực tiếp CSDL).

- Phạm vi loại trừ (Out of Scope): Không tích hợp cổng thanh toán trực tuyến thực tế, không tích hợp API đơn vị vận chuyển bên thứ ba, không hỗ trợ đa kho/đa nhà bán, không tự động hoàn tiền/đổi trả sau khi đã giao, không làm AI gợi ý sản phẩm.

Cấu trúc thư mục chuẩn (Monorepo)

Plaintext

```text
fashion-ecommerce/
├── database/
│   ├── migrations/          # Các file SQL tạo bảng, index, function, procedure, trigger, view
│   ├── seeds/               # Script sinh dữ liệu mẫu & dữ liệu lớn (50k-100k đơn) để benchmark
│   └── roles_backup.sql     # Script phân quyền PostgreSQL roles & hướng dẫn pg_dump/pg_restore
├── backend/
│   ├── src/
│   │   ├── config/          # Cấu hình pg Pool
│   │   ├── middlewares/     # Xác thực JWT & kiểm tra phân quyền 5 vai trò
│   │   ├── controllers/     # Xử lý request/response
│   │   ├── services/        # Gọi SQL queries, DB Functions, Procedures
│   │   └── routes/          # Định tuyến REST API
├── frontend/
│   ├── src/
│   │   ├── pages/storefront/ # Giao diện khách hàng (Home, Product Detail, Cart, Checkout, Orders)
│   │   ├── pages/admin/      # Giao diện quản trị (Orders, Inventory, Products, Vouchers, Dashboard)
│   │   └── context/          # Quản lý Auth state & Cart state
└── SPEC.md
```

## 2. Thiết kế Cơ sở dữ liệu (PostgreSQL — Chuẩn hóa 3NF)

Hệ thống gồm 12 bảng chính với các ràng buộc toàn vẹn chặt chẽ: 



| STT | Tên bảng | Cột chính & Kiểu dữ liệu | Ràng buộc & Ghi chú thiết kế |
| --- | --- | --- | --- |
| 1 | users | id (SERIAL PK), full_name (VARCHAR), email (VARCHAR), password_hash (TEXT), phone (VARCHAR), role (VARCHAR), is_active (BOOLEAN), created_at (TIMESTAMPTZ) | email UNIQUE, NOT NULL; role CHECK IN ('CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN'). |
| 2 | categories | id (SERIAL PK), name (VARCHAR), slug (VARCHAR), description (TEXT), created_at (TIMESTAMPTZ) | name, slug UNIQUE, NOT NULL. |
| 3 | products | id (SERIAL PK), category_id (INT FK), name (VARCHAR), slug (VARCHAR), description (TEXT), base_image_url (TEXT), is_active (BOOLEAN), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ) | category_id REFERENCES categories(id) ON DELETE RESTRICT. |
| 4 | product_variants | id (SERIAL PK), product_id (INT FK), sku (VARCHAR), color (VARCHAR), size (VARCHAR), price (NUMERIC(12,2)), image_url (TEXT), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ) | sku UNIQUE, NOT NULL (VD: ATB-DEN-S); price >= 0; UNIQUE (product_id, color, size). |
| 5 | inventory | variant_id (INT PK, FK), quantity (INT), updated_at (TIMESTAMPTZ) | Quan hệ 1–1 với product_variants(id) để tách dữ liệu biến động cao khỏi bảng sản phẩm tĩnh, giảm tranh chấp khóa mức dòng; CHECK (quantity >= 0). |
| 6 | inventory_transactions | id (BIGSERIAL PK), variant_id (INT FK), type (VARCHAR), quantity_change (INT), reference_type (VARCHAR), reference_id (INT), note (TEXT), created_by (INT FK), created_at (TIMESTAMPTZ) | type CHECK IN ('IMPORT', 'EXPORT_ORDER', 'RETURN_CANCEL'); quantity_change <> 0; reference_id lưu order_id khi xuất/hoàn đơn. |
| 7 | carts | id (SERIAL PK), user_id (INT FK), updated_at (TIMESTAMPTZ) | Quan hệ 1–1 với users(id) (user_id UNIQUE). |
| 8 | cart_items | id (SERIAL PK), cart_id (INT FK), variant_id (INT FK), quantity (INT), added_at (TIMESTAMPTZ) | UNIQUE (cart_id, variant_id); CHECK (quantity > 0). Thêm vào giỏ không trừ tồn kho. |
| 9 | orders | id (SERIAL PK), order_code (VARCHAR), user_id (INT FK), shipping_address (TEXT), recipient_name (VARCHAR), recipient_phone (VARCHAR), subtotal_amount (NUMERIC(12,2)), discount_amount (NUMERIC(12,2)), final_amount (NUMERIC(12,2)), status (VARCHAR), payment_method (VARCHAR), payment_status (VARCHAR), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ) | order_code UNIQUE; status CHECK IN ('PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED'); payment_method DEFAULT 'COD'; payment_status CHECK IN ('UNPAID', 'PAID'); các cột tiền >= 0. |
| 10 | order_items | id (SERIAL PK), order_id (INT FK), variant_id (INT FK), quantity (INT), unit_price (NUMERIC(12,2)) | unit_price lưu cứng giá tại thời điểm đặt hàng để độc lập với biến động giá sau này; CHECK (quantity > 0 AND unit_price >= 0). |
| 11 | vouchers | id (SERIAL PK), code (VARCHAR), discount_type (VARCHAR), discount_value (NUMERIC(12,2)), max_discount_amount (NUMERIC(12,2)), min_order_amount (NUMERIC(12,2)), usage_limit (INT), used_count (INT), start_date (TIMESTAMPTZ), end_date (TIMESTAMPTZ), is_active (BOOLEAN), created_at (TIMESTAMPTZ) | code UNIQUE; discount_type CHECK IN ('PERCENT', 'FIXED'); CHECK (used_count >= 0 AND used_count <= usage_limit); CHECK (end_date > start_date). |
| 12 | voucher_usages | id (SERIAL PK), voucher_id (INT FK), user_id (INT FK), order_id (INT FK), status (VARCHAR), used_at (TIMESTAMPTZ) | status CHECK IN ('APPLIED', 'RELEASED'); Partial Unique Index UNIQUE (voucher_id, user_id) WHERE status = 'APPLIED' đảm bảo mỗi tài khoản chỉ dùng tối đa 1 lần (và được dùng lại nếu đơn cũ hủy hợp lệ). <br> |

## 3. Lập trình Cơ sở dữ liệu (PL/pgSQL & Database Objects)

Toàn bộ logic nghiệp vụ nhạy cảm phải được đóng gói trong PostgreSQL: 




### 3.1. Functions & Transactions (Xử lý đồng thời)

1. fn_calculate_voucher_discount(p_voucher_code, p_user_id, p_subtotal):

    - Kiểm tra voucher tồn tại, is_active = TRUE, thời gian hiện tại nằm trong [start_date, end_date], p_subtotal >= min_order_amount, used_count < usage_limit, và user_id chưa có bản ghi 'APPLIED' trong voucher_usages.

    - Tính mức giảm: nếu 'FIXED' trả về LEAST(discount_value, p_subtotal); nếu 'PERCENT' trả về LEAST(p_subtotal * discount_value / 100, COALESCE(max_discount_amount, p_subtotal)). Trả về lỗi cụ thể (RAISE EXCEPTION) nếu không hợp lệ.

2. fn_place_order(p_user_id, p_shipping_info, p_voucher_code) (Atomic Checkout):

    - Thực thi trọn vẹn trong một Transaction:

    - Lấy danh sách cart_items của user, sắp xếp theo variant_id ASC (tránh Deadlock) và chạy SELECT quantity FROM inventory WHERE variant_id = ... FOR UPDATE.

    - Kiểm tra từng biến thể có inventory.quantity >= cart_items.quantity; nếu thiếu dù chỉ 1 món, lập tức RAISE EXCEPTION để ROLLBACK toàn bộ.

    - Nếu có p_voucher_code: chạy SELECT ... FROM vouchers WHERE code = p_voucher_code FOR UPDATE, gọi fn_calculate_voucher_discount, tăng used_count = used_count + 1.

    - Tạo bản ghi orders, chép dữ liệu sang order_items kèm giá niêm yết hiện tại từ product_variants.price.

    - Trừ tồn kho trong inventory, chèn log 'EXPORT_ORDER' vào inventory_transactions, chèn bản ghi 'APPLIED' vào voucher_usages (nếu có) và xóa các dòng đã mua trong cart_items.

3. fn_cancel_order(p_order_id, p_actor_id) (Idempotent Cancellation):

    - Khóa dòng orders bằng SELECT ... FOR UPDATE.

    - Kiểm tra status IN ('PENDING', 'CONFIRMED'); nếu ở trạng thái khác (SHIPPING, DELIVERED, CANCELLED), báo lỗi từ chối hủy.

    - Kiểm tra chống hoàn kho 2 lần: xác nhận chưa tồn tại bản ghi 'RETURN_CANCEL' với reference_id = p_order_id trong inventory_transactions.

    - Cập nhật orders.status = 'CANCELLED'; cộng hoàn số lượng vào inventory; chèn log 'RETURN_CANCEL' vào inventory_transactions; nếu đơn có dùng voucher, cập nhật voucher_usages.status = 'RELEASED' và giảm vouchers.used_count = used_count - 1.

### 3.2. Stored Procedures & Triggers

- Procedure sp_import_inventory(p_variant_id, p_quantity, p_note, p_staff_id): Kiểm tra p_quantity > 0, khóa dòng inventory, cộng dồn quantity và ghi log 'IMPORT' vào inventory_transactions.

- Trigger trg_protect_finalized_orders (BEFORE UPDATE OR DELETE ON orders): Chặn tuyệt đối thao tác DELETE trên bảng orders và chặn UPDATE nếu OLD.status IN ('DELIVERED', 'CANCELLED').

- Trigger trg_set_updated_at: Tự động cập nhật NEW.updated_at = NOW() trước khi UPDATE trên các bảng products, product_variants, inventory, carts, orders.

### 3.3. Views, Indexing & Bảo mật tầng DB

- Views:

    - vw_revenue_summary: Thống kê doanh thu theo ngày/tháng, tổng số đơn thành công, tổng tiền chiết khấu (chỉ lọc status = 'DELIVERED').

    - vw_best_selling_products: Xếp hạng sản phẩm và SKU bán chạy nhất bằng Window Function (RANK() OVER (ORDER BY SUM(quantity) DESC)) từ các đơn 'DELIVERED'.

- Indexes: B-Tree Index cho các khóa ngoại (product_id, order_id, variant_id), Composite Index idx_orders_user_created ON orders(user_id, created_at DESC), Partial Index idx_orders_active_status ON orders(status) WHERE status IN ('PENDING', 'CONFIRMED', 'SHIPPING').

- PostgreSQL Roles: Tách 3 user DB: app_rw_user (chỉ có quyền SELECT, INSERT, UPDATE, DELETE trên các bảng cần thiết và EXECUTE các Function/Procedure), report_ro_user (chỉ SELECT trên các View thống kê), và db_admin (sở hữu lược đồ, chạy migration và pg_dump).

## 4. Ma trận Phân quyền Nghiệp vụ (5 Vai trò)

| Chức năng | Customer | Sales | Warehouse | Marketing | Admin |
| --- | --- | --- | --- | --- | --- |
| Xem & lọc sản phẩm, chọn SKU | ✅ | ✅ | ✅ | ✅ | ✅ |
| Quản lý giỏ hàng cá nhân | ✅ | ❌ | ❌ | ❌ | ❌ |
| Đặt hàng COD & áp dụng Voucher | ✅ | ❌ | ❌ | ❌ | ❌ |
| Xem lịch sử đơn & tự hủy đơn (PENDING/CONFIRMED) | ✅ (của mình) | ❌ | ❌ | ❌ | ❌ |
| Duyệt đơn (PENDING → CONFIRMED → SHIPPING → DELIVERED) | ❌ | ✅ | ❌ | ❌ | ✅ |
| Hủy đơn hộ khách (PENDING/CONFIRMED) | ❌ | ✅ | ❌ | ❌ | ✅ |
| Nhập bổ sung tồn kho & xem sổ cái inventory_transactions | ❌ | ❌ | ✅ | ❌ | ✅ |
| Tạo/sửa/ngừng kích hoạt Voucher & xem lượt dùng | ❌ | ❌ | ❌ | ✅ | ✅ |
| Quản lý tài khoản, phân quyền, danh mục & sản phẩm/SKU | ❌ | ❌ | ❌ | ❌ | ✅ |
| Xem Dashboard báo cáo doanh thu & top bán chạy | ❌ | ❌ | ❌ | ✅ | ✅ |

## 5. Đặc tả REST API Endpoints (Backend Express)

Tất cả API trả về JSON thống nhất { success: boolean, data?: any, message?: string }. Lỗi nghiệp vụ đồng thời (hết hàng, hết lượt voucher) trả về HTTP 409 Conflict hoặc 400 Bad Request kèm thông báo rõ ràng từ PostgreSQL Exception.




- Auth (/api/auth):

    - POST /register — Đăng ký tài khoản mặc định role 'CUSTOMER'.

    - POST /login — Đăng nhập, trả về JWT chứa { id, role }.

    - GET /me — Lấy thông tin user hiện tại.

- Products & SKUs (/api/products, /api/categories):

    - GET /api/categories — Danh sách danh mục.

    - GET /api/products — Danh sách sản phẩm (hỗ trợ query ?category_id=&search=&min_price=&max_price=&in_stock=true).

    - GET /api/products/:id — Chi tiết sản phẩm kèm mảng variants và số lượng stock thời gian thực từ inventory.

    - POST /api/products, PUT /api/products/:id, POST /api/products/:id/variants, PUT /api/variants/:id — Dành cho ADMIN (tạo biến thể tự động khởi tạo dòng inventory với quantity = 0).

- Cart (/api/cart — Role CUSTOMER):

    - GET / — Lấy giỏ hàng kèm thông tin SKU, giá hiện tại và tồn kho thực tế để cảnh báo nếu vượt tồn.

    - POST /items — Thêm hoặc cộng dồn số lượng { variant_id, quantity }.

    - PUT /items/:variantId — Cập nhật số lượng.

    - DELETE /items/:variantId — Xóa món khỏi giỏ.

- Orders (/api/orders):

    - POST /checkout (CUSTOMER) — Body { shipping_address, recipient_name, recipient_phone, voucher_code? } → Gọi SELECT * FROM fn_place_order(...).

    - GET /my-orders (CUSTOMER) — Danh sách đơn hàng cá nhân + chi tiết order_items.

    - GET / (SALES, ADMIN) — Toàn bộ đơn hàng hệ thống (lọc theo status, order_code).

    - PATCH /:id/status (SALES, ADMIN) — Chuyển trạng thái tuần tự (CONFIRMED, SHIPPING, DELIVERED; khi DELIVERED tự động set payment_status = 'PAID').

    - POST /:id/cancel (CUSTOMER, SALES, ADMIN) — Gọi CALL/SELECT fn_cancel_order(...).

- Inventory (/api/inventory — Roles WAREHOUSE, ADMIN):

    - GET / — Danh sách tồn kho tất cả SKU (hỗ trợ lọc tồn thấp).

    - POST /import — Body { variant_id, quantity, note } → Gọi CALL sp_import_inventory(...).

    - GET /transactions — Lịch sử nhập, xuất, hoàn kho.

- Vouchers (/api/vouchers):

    - GET /available (CUSTOMER) — Các voucher đang mở và còn lượt.

    - POST /preview (CUSTOMER) — Body { voucher_code, subtotal } → Gọi fn_calculate_voucher_discount trả về số tiền giảm dự kiến.

    - GET /, POST /, PUT /:id, GET /:id/usages (MARKETING, ADMIN) — Quản lý chiến dịch và đối soát lượt dùng.

- Reports (/api/reports — Roles MARKETING, ADMIN):

    - GET /revenue — Truy vấn vw_revenue_summary.

    - GET /best-sellers — Truy vấn vw_best_selling_products.

## 6. Đặc tả Giao diện Người dùng (React Frontend)

### 6.1. Không gian Khách hàng (Storefront)

1. Trang Cửa hàng (Home / Catalog): Thanh tìm kiếm, bộ lọc danh mục, khoảng giá, checkbox "Chỉ hiện sản phẩm còn hàng", lưới thẻ sản phẩm hiển thị khoảng giá từ thấp đến cao của các SKU.

2. Trang Chi tiết Sản phẩm: Bộ chọn Màu sắc và Kích cỡ dạng nút bấm (pill buttons). Khi chọn đủ 2 thuộc tính, giao diện hiển thị mã SKU, giá chính xác, số lượng còn lại trong kho; tự động khóa nút "Thêm vào giỏ" nếu tồn kho = 0.

3. Trang Giỏ hàng & Thanh toán (Cart & Checkout): Bảng chỉnh sửa số lượng sản phẩm (đánh dấu đỏ nếu số lượng trong giỏ > tồn kho hiện tại), ô nhập mã Voucher kèm nút "Áp dụng" hiển thị ngay mức giảm giá, form địa chỉ giao nhận COD và nút "Đặt hàng".

4. Trang Đơn hàng của tôi: Danh sách đơn hàng chia tab theo trạng thái, xem chi tiết hóa đơn (hiển thị giá lịch sử lúc mua) và nút "Hủy đơn hàng" chỉ hiển thị ở tab Chờ xác nhận và Đã xác nhận.

### 6.2. Không gian Quản trị Nội bộ (Back-Office Layout)

Dùng chung một Sidebar tự động ẩn/hiện các mục theo user.role: 




1. Quản lý Đơn hàng (SALES, ADMIN): Bảng đơn hàng với các nút hành động nhanh theo luồng một chiều (Xác nhận đơn → Giao vận chuyển → Hoàn tất giao / Hủy đơn).

2. Quản lý Kho (WAREHOUSE, ADMIN): Tab 1 hiển thị tồn kho theo từng SKU kèm modal "Nhập kho"; Tab 2 hiển thị bảng lịch sử biến động kho (IMPORT, EXPORT_ORDER, RETURN_CANCEL) có gắn link tới mã đơn hàng liên quan.

3. Quản lý Voucher (MARKETING, ADMIN): Bảng danh sách mã giảm giá (tiến độ used_count / usage_limit), form tạo/sửa mã giảm giá và modal xem danh sách tài khoản đã sử dụng mã.

4. Quản lý Sản phẩm & Tài khoản (ADMIN): Giao diện thêm/sửa sản phẩm kèm bảng quản lý danh sách biến thể SKU; trang quản lý người dùng và gán vai trò.

5. Dashboard Thống kê (MARKETING, ADMIN): Các thẻ KPI tổng doanh thu thực tế (DELIVERED), tổng đơn thành công, biểu đồ doanh thu theo ngày và bảng Top sản phẩm bán chạy.

## 7. Kịch bản Kiểm thử Kỹ thuật (Verification & Benchmarking)

Sau khi hoàn thiện mã nguồn, hệ thống cần vượt qua 4 bài kiểm thử cốt lõi: 




1. Kiểm thử tranh chấp tồn kho (Concurrency Stock Test): Script gửi đồng thời 5 request POST /api/orders/checkout mua cùng 1 mã SKU khi inventory.quantity = 1 → Kết quả: đúng 1 request trả về HTTP 201, 4 request trả về HTTP 409, inventory.quantity = 0.

2. Kiểm thử tranh chấp lượt Voucher (Concurrency Voucher Test): Script gửi đồng thời 5 request từ 5 tài khoản khác nhau cùng áp 1 mã voucher khi usage_limit - used_count = 1 → Kết quả: đúng 1 đơn áp dụng thành công, used_count = usage_limit.

3. Kiểm thử Rollback & Chống hoàn kho kép: Giả lập lỗi ở món thứ 2 trong giỏ hàng khi đặt đơn → xác nhận món thứ 1 không bị trừ kho; gửi 2 request POST /api/orders/:id/cancel liên tiếp → xác nhận kho chỉ được cộng hoàn đúng 1 lần.

4. Benchmark Hiệu năng Index: Chạy script sinh 50.000 – 100.000 bản ghi vào orders và order_items, dùng EXPLAIN (ANALYZE, BUFFERS) đo thời gian thực thi truy vấn lọc đơn theo (user_id, created_at) và báo cáo doanh thu trước/sau khi đánh Index.

