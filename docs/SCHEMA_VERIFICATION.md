# Kiểm chứng Task 03–08 PostgreSQL Schema, Business Logic, Commerce & Back-Office API

Ngày 20/11/2026, Asia/Bangkok. Thực hiện trên Windows/PowerShell tại `C:\Đồ án CSDL` với PostgreSQL `17.9 (Debian 17.9-1.pgdg12+1)` chạy qua Docker Compose và `node-pg-migrate@9.0.0`. Kết quả xác nhận đủ 22 bảng, constraints, roles/grants, business functions/procedures, triggers, reporting views, Auth/Users, Catalog/Banners, Commerce (Cart/Vouchers/Checkout/Orders) và Back-Office (Orders Management, Inventory/Ledger, Voucher Admin, Revenue/Best-Sellers Reports, Audit Events) trên PostgreSQL thật; chưa triển khai frontend storefront/admin UI hoàn chỉnh.

## 1. Phạm vi đã triển khai

- **19 SQL migrations thuần** (`001`–`019`) tại [database/migrations](../database/migrations/001_namespace_roles.sql), không dùng ORM hoặc schema-sync:
  - **12 bảng bắt buộc từ SPEC**: `users`, `categories`, `products`, `product_variants`, `inventory`, `inventory_transactions`, `carts`, `cart_items`, `orders`, `order_items`, `vouchers`, `voucher_usages`.
  - **3 bảng mở rộng đã phê duyệt**: `brands`, `product_images`, `banners`.
  - **5 bảng thuộc tính SKU đa ngành hàng**: `product_types`, `attributes`, `product_type_attributes`, `attribute_values`, `variant_attribute_values` (seed metadata 6 loại: `CLOTHING`, `SHOES`, `BAGS`, `WATCHES`, `ACCESSORIES`, `PERFUME`).
  - **2 bảng vận hành (Task 04)**: `checkout_requests` (idempotency D-03 + deferred completion trigger) và `audit_events` (append-only D-13).
- **Database Business Logic (Task 04, migrations `012`–`014`)**:
  - `fn_calculate_voucher_discount(p_voucher_code, p_user_id, p_subtotal)`: kiểm tra tồn tại, `is_active`, `[start_date, end_date]` inclusive theo `clock_timestamp()`, `min_order_amount`, `used_count < usage_limit`, chưa có `'APPLIED'` trong `voucher_usages`; tính `FIXED` và `PERCENT` làm tròn half-up đến đồng, clamp `[0, p_subtotal]`.
  - `fn_place_order(p_user_id, p_shipping_info, p_voucher_code, p_request_key, p_expected_cart_version, p_expected_items)`: transaction atomic, hỗ trợ cả chữ ký 3 tham số SPEC và 6 tham số idempotency/version/expected_items; khóa theo thứ tự `checkout_requests` → `carts FOR UPDATE` → catalog `FOR SHARE` tăng dần (`brands → categories → products → product_variants`) → `inventory` theo `variant_id ASC` (`FOR UPDATE`) → `vouchers FOR UPDATE`; kiểm tra tồn kho, voucher, chốt snapshot `unit_price`/`list_unit_price`/`product_name`/`brand_name`/`sku`/`options_snapshot`, trừ kho, ghi `EXPORT_ORDER`, ghi `voucher_usages`, xóa `cart_items`, ghi `audit_events`; rollback toàn bộ khi có lỗi.
  - `fn_cancel_order(p_order_id, p_actor_id, p_reason)`: khóa `orders FOR UPDATE`, kiểm tra quyền (customer owner hoặc `SALES`/`ADMIN`), kiểm tra trạng thái `PENDING`/`CONFIRMED` (`P1010` khi đã hủy hoặc đang giao/đã giao), chống hoàn kho kép (`RETURN_CANCEL` + unique index), hoàn kho theo `variant_id ASC`, giải phóng `voucher_usages` (`APPLIED → RELEASED`) và giảm `used_count` một lần, ghi `audit_events`.
  - `fn_transition_order(p_order_id, p_actor_id, p_expected_status, p_target_status)`: chuyển trạng thái tuần tự `PENDING → CONFIRMED → SHIPPING → DELIVERED`, gắn `payment_status = 'PAID'` và `delivered_at` nguyên tử khi `DELIVERED`.
  - `sp_import_inventory` (4 tham số SPEC và 7 tham số idempotent `OUT p_transaction_id, OUT p_replayed`): kiểm tra `WAREHOUSE`/`ADMIN`, advisory lock theo `(actor, request_key)`, cộng tồn kho và ghi `IMPORT` + `audit_events`.
  - Triggers & Views: `trg_protect_finalized_orders`, `trg_set_updated_at`, `vw_revenue_summary`, `vw_best_selling_products`.
- **Auth & User Management DB Functions (Task 05, migration `015`)**:
  - `fn_register_customer`, `fn_get_login_record`, `fn_get_actor`, `fn_read_users`, `fn_read_user`, `fn_manage_user` (`SECURITY DEFINER`, bảo vệ admin cuối bằng `pg_advisory_xact_lock`, tăng `token_version` khi đổi role/active, ghi `audit_events`, cấp `EXECUTE` cho `app_rw_user`).
- **Catalog Views & Admin Functions (Task 06, migration `016` & `002_multibrand_demo.sql`)**:
  - View `vw_catalog_variant_options` (cấp `SELECT` cho `app_rw_user`); các hàm `fn_read_admin_*`, `fn_upsert_*`, `fn_create_variant`, `fn_update_variant`, `fn_add/update/delete_product_image`, `fn_manage_banner` (cấp `EXECUTE` cho `app_rw_user`, kiểm tra `ADMIN` trong DB).
  - Seed đa thương hiệu [002_multibrand_demo.sql](../database/seeds/002_multibrand_demo.sql) cho 6 ngành hàng: `Fashion`, `Shoes`, `Bags`, `Watches`, `Accessories`, `Perfumes`.
- **Commerce Read & Cart Functions (Task 07, migration `017`)**:
  - `fn_assert_customer_actor`, `fn_read_cart`, `fn_mutate_cart`, `fn_read_available_vouchers`, `fn_preview_voucher`, `fn_read_my_orders`, `fn_read_order_detail` (`SECURITY DEFINER`, `search_path = pg_catalog, app, pg_temp`, cấp `EXECUTE` cho `app_rw_user`; checkout và cancel gọi trực tiếp `fn_place_order` và `fn_cancel_order`).
- **Back-Office Functions (Task 08, migrations `018`–`019`)**:
  - `fn_read_orders`, `fn_read_inventory`, `fn_read_inventory_transaction`, `fn_read_inventory_transactions`, `fn_read_vouchers`, `fn_read_voucher_by_id`, `fn_manage_voucher` (`019` giữ tương thích round-trip millisecond cho `start_date`/`end_date`), `fn_read_voucher_usages`, `fn_read_revenue_report`, `fn_read_best_sellers_report`, `fn_read_audit_events` (`SECURITY DEFINER`, kiểm tra role `SALES`/`WAREHOUSE`/`MARKETING`/`ADMIN` trong DB, cấp `EXECUTE` cho `app_rw_user`).

## 2. Đối tượng database đã xác minh trên `fashion_dev`

| Thành phần | Kết quả kiểm tra thực tế |
| --- | --- |
| Schema & owner | Schema `app`, owner `db_admin`; 22 `BASE TABLE` trong `app` + `public.pgmigrations` |
| Migrations | 19/19 bản ghi `001_namespace_roles` .. `019_voucher_ms_precision_check` trong `public.pgmigrations` |
| Views | 10 views (`vw_public_brands`, `vw_public_categories`, `vw_catalog_products`, `vw_catalog_variants`, `vw_catalog_variant_options`, `vw_catalog_images`, `vw_product_type_options`, `vw_public_banners`, `vw_revenue_summary`, `vw_best_selling_products`) |
| Indexes | 73 indexes trong schema `app` |
| Routines & Grants | 70 routines trong schema `app`; toàn bộ routines giao dịch, auth, catalog, commerce và back-office đã phê duyệt cấp `EXECUTE` cho `app_rw_user`; `PUBLIC` và `report_ro_user` không có `EXECUTE`; toàn bộ deferred constraint triggers chạy `SECURITY DEFINER` (`search_path=pg_catalog, app, pg_temp`) |
| Roles | `db_admin` (owner local container); `app_rw_user` (`NOSUPERUSER`, chỉ `USAGE` schema `app`, `SELECT` 8 public/catalog views và `EXECUTE` các routines đã phê duyệt); `report_ro_user` (`NOSUPERUSER`, chỉ `USAGE` schema `app` và `SELECT` 2 report views) |

## 3. Lệnh và kết quả kiểm chứng thực tế

| Lệnh | Phạm vi kiểm tra | Kết quả quan sát |
| --- | --- | --- |
| `npm.cmd run db:migrate` | `fashion_dev` (PostgreSQL 17.9 Docker) | Exit 0; 19/19 migrations áp dụng (`018`–`019` thành công) |
| `npm.cmd run db:seed` | `fashion_dev` | Exit 0; idempotent, không nhân đôi dữ liệu hay trừ kho thêm |
| `npm.cmd run db:test` | Hai DB trống tạo từ `template0` (`schema_test_*` và `logic_test_*`), chạy **không dùng mock** với nhiều `pg.Client` thật | Exit 0; **94/94 tests passed** (85 schema/constraint/role tests + 8 business logic/concurrency tests + 2 suite tổng = 94 kiểm chứng subtests) |
| Test A (trong `business_logic.test.mjs`) | 5 session `app_rw_user` qua barrier tranh 1 SKU tồn = 1 | Đúng 1 đơn thành công, 4 thất bại `P1001`, tồn = 0, 1 `EXPORT_ORDER`, 4 giỏ thua giữ nguyên |
| Test B (trong `business_logic.test.mjs`) | 5 session `app_rw_user` qua barrier tranh 1 voucher còn 1 lượt | Đúng 1 đơn thành công, 4 thất bại `P1003`, `used_count = 1`, tồn chỉ trừ 1 lần |
| Test C (trong `business_logic.test.mjs`) | Giỏ 2 SKU lỗi ở món thứ 2 / lỗi ở bước voucher sau khi trừ kho món 1 | Rollback hoàn toàn: tồn món 1 & 2 giữ nguyên, `used_count = 0`, 0 đơn/ledger/audit mới |
| Test D (trong `business_logic.test.mjs`) | 4 session `app_rw_user` hủy đồng thời đơn 2 SKU + voucher, kèm hủy lặp tuần tự | Đúng 1 hủy thành công, 3 thất bại `P1010`; hoàn kho 1 lần mỗi SKU, `voucher_usages = RELEASED`, `used_count = 0` |
| Test E (trong `business_logic.test.mjs`) | Cập nhật giá bán, giá niêm yết, tên SP và brand sau khi đặt đơn | Đơn lịch sử giữ nguyên `100000.00`/`150000.00` và tên cũ; đơn mới sau đó lấy giá mới `250000.00` |
| [roles_backup.sql](../database/roles_backup.sql) | Thực thi qua `psql -v ON_ERROR_STOP=1` trên `fashion_dev` | Exit 0; không lỗi/cảnh báo |
| `npm.cmd run db:verify` | DB tạm `foundation_verify_<random>` | Exit 0; `PASS PostgreSQL 17.9` |
| `npm.cmd test` | Backend unit + Supertest/PostgreSQL 17.9 integration (`auth-rbac`, `catalog`, `commerce`, `backoffice`, `health`) và Frontend Vitest | Exit 0; Backend `31/31` tests passed (7 files), Frontend `3/3` tests passed (1 file) |

## 4. Hạng mục còn lại sau Task 08

- **Frontend UI (`T15`–`T19`, `T23`)**: Chưa triển khai giao diện storefront/back-office ngoài foundation Home/System.
- **Benchmark & Restore Rehearsal (`T24`–`T25`)**: Chưa seed 50.000–100.000 đơn để chạy `EXPLAIN (ANALYZE, BUFFERS)` quy mô lớn và chưa diễn tập `pg_dump`/`pg_restore` sang DB khác.
- **Quyết định pending**: Các quyết định kinh doanh/vận hành trong [DECISIONS](DECISIONS.md) (`D-01`..`D-14`) chưa tự đánh dấu đã duyệt; các kiểm chứng trên dùng quy ước khuyến nghị (VND làm tròn đồng, fail-closed `app_rw_user`, idempotency `checkout_requests`).
