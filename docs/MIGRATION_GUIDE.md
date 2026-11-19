# Hướng dẫn migration và seed PostgreSQL

Ngày 20/11/2026. Raw SQL qua node-pg-migrate9.0.0 đã khóa; không ORM/schema sync. [ERD hiện tại](ERD.md), [dictionary mục tiêu và ghi chú Task03](DATABASE_DESIGN.md), [kết quả kiểm chứng](SCHEMA_VERIFICATION.md).

Production Task15: [bootstrap và chiến lược migration](DEPLOYMENT.md), [backup/restore/rollback](OPERATIONS.md), [bằng chứng mới nhất](FINAL_HANDOVER.md). `NODE_ENV=production` bắt buộc MIGRATION_DATABASE_URL riêng, luôn verify TLS, không fallback .env local/POSTGRES_PASSWORD; runner chặn down production. Migrations001–019 không sửa. `roles_backup.sql` reapply quyền bằng ALL ROUTINES (functions và procedures), đã kiểm qua `npm.cmd run db:restore:verify` trên hai DB tạm local.

## 1. Chạy local Windows

Từ root bằng PowerShell, giữ .env local đã có từ Task02:

```powershell
npm.cmd ci
npm.cmd run setup:env
npm.cmd run db:up
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run db:test
```

setup:env không ghi đè .env. db:migrate dùng MIGRATION_DATABASE_URL nếu có, nếu không dùng db_admin/POSTGRES_PASSWORD theo .env. Chỉ chạy seed trên dev/test; script chặn NODE_ENV=production nhưng người vận hành vẫn phải kiểm tra đích kết nối. Không in .env hoặc docker compose config chứa secret; kiểm cấu hình bằng docker compose config --quiet.

Không cần psql trên Windows host. Có thể kiểm số bảng bằng:

```powershell
docker compose exec -T postgres psql -U db_admin -d fashion_dev -c "SELECT tablename FROM pg_tables WHERE schemaname='app' ORDER BY tablename;"
```

## 2. Thứ tự dependency của migrations

| File | Nội dung | Phụ thuộc |
| --- | --- | --- |
| 001_namespace_roles.sql | 3 roles, schema app owner db_admin, domain asset_path | DB và quyền quản trị role đã sẵn sàng |
| 002_catalog.sql | Brands/categories, 5 bảng type/options, products/SKUs, images/banners | 001 |
| 003_commerce.sql | Users/cart, inventory, voucher, orders/items, ledger/usages | 002 |
| 004_integrity_guards.sql | Required/combo SKU, 1–1 auto rows, publication, snapshots/state/totals, append-only | 003 |
| 005_variant_reference_data.sql | Metadata 6 loại và enum values ban đầu | 004 |
| 006_indexes_views_grants.sql | Index query, public/report views, quyền hiện tại tối thiểu | 005 |
| 007_usage_links_and_positive_ids.sql | ID dương, link voucher usage/order/code/status ở commit | 006 |
| 008_function_default_privileges.sql | Mặc định không PUBLIC EXECUTE hàm mới của db_admin trong DB này | 007 |
| 009_constraint_edge_cases.sql | Cart100 UPSERT, voucher code identity, snapshot option shape | 008 |
| 010_ledger_reference_and_order_indexes.sql | Index cho `inventory_transactions(reference_id, variant_id)`, `inventory_transactions(created_at DESC, id DESC)`, `orders(created_at DESC, id DESC)` | 009 |
| 011_deferred_triggers_security_definer.sql | Chuyển 5 deferred constraint trigger functions sang `SECURITY DEFINER` giữ `search_path` tin cậy và thu hồi `EXECUTE` | 010 |
| 012_operational_tables_and_trigger_names.sql | Tạo `checkout_requests`, `audit_events` (append-only) và chuẩn hóa tên trigger `trg_protect_finalized_orders` | 011 |
| 013_business_functions_and_procedures.sql | Triển khai `fn_calculate_voucher_discount`, `fn_place_order`, `fn_cancel_order`, `fn_transition_order`, `sp_import_inventory` và cấp `EXECUTE` cho `app_rw_user` | 012 |
| 014_fix_checkout_request_trigger_live_lookup.sql | Sửa `check_checkout_request_completed()` tra cứu `order_id` hiện hành tại COMMIT thay vì `NEW.order_id` cũ từ lúc `INSERT` | 013 |
| 015_auth_and_user_management.sql | Triển khai `fn_register_customer`, `fn_get_login_record`, `fn_get_actor`, `fn_read_users`, `fn_read_user`, `fn_manage_user` (last-admin lock, `token_version`, `audit_events`) và cấp `EXECUTE` cho `app_rw_user` | 014 |
| 016_catalog_views_and_functions.sql | Thêm view `vw_catalog_variant_options` và các hàm admin catalog/variant/image/banner (`fn_read_admin_*`, `fn_upsert_*`, `fn_create_variant`, `fn_update_variant`, `fn_add/update/delete_product_image`, `fn_manage_banner`) | 015 |
| 017_commerce_read_and_cart_functions.sql | Thêm `fn_assert_customer_actor`, `fn_read_cart`, `fn_mutate_cart`, `fn_read_available_vouchers`, `fn_preview_voucher`, `fn_read_my_orders`, `fn_read_order_detail` (`SECURITY DEFINER`) và cấp `EXECUTE` cho `app_rw_user` | 016 |
| 018_backoffice_functions.sql | Thêm `fn_read_orders`, `fn_read_inventory`, `fn_read_inventory_transaction(s)`, `fn_read_vouchers`, `fn_read_voucher_by_id`, `fn_manage_voucher`, `fn_read_voucher_usages`, `fn_read_revenue_report`, `fn_read_best_sellers_report`, `fn_read_audit_events` (`SECURITY DEFINER`) và cấp `EXECUTE` cho `app_rw_user` | 017 |
| 019_voucher_ms_precision_check.sql | Sửa so sánh `start_date`/`end_date` trong `fn_manage_voucher` theo độ chính xác millisecond khi JSON round-trip voucher đã có lượt dùng | 018 |

Mỗi file có `-- Up Migration` và `-- Down Migration`. Runner quản lý transaction/history; không thêm BEGIN/COMMIT trong SQL function, không tạo bảng bằng backend. Các migration 007–014 là bổ sung tuần tự sau khi các bản trước đã chạy local; không sửa ngược file đã áp dụng để che lịch sử. Trong task này không thay SQL probe của Task02.

Migrations tạo **22 bảng app**, không tính `public.pgmigrations`. Seed là thao tác riêng, không trộn dữ liệu demo vào schema migration (trừ metadata type/attribute có phiên bản).

## 3. Transaction và deferred constraints

Tạo product draft, tạo SKU, thêm các required options trong **cùng transaction**; trigger tạo inventory0. SKU thiếu axis, trùng combo hoặc product active thiếu ảnh sẽ bị từ chối tại COMMIT. Có thể dùng SET CONSTRAINTS ALL IMMEDIATE để phát hiện sớm khi đã hoàn tất dữ liệu, không bật ngay trước khi xây một aggregate chưa đầy đủ.

Order insert phải kèm order_items trong cùng transaction; created_xid do DB ấn định, không lấy từ timestamp. Trước COMMIT subtotal phải khớp SUM(quantity*unit_price), có ít nhất một item và voucher linkage hợp lệ. Một lỗi deferred làm rollback cả transaction. Sau khi tạo, SKU identity và snapshot item bất biến; không sửa tay để “khớp test”.

Ở tầng nghiệp vụ DB (Task 04), `fn_place_order`, `fn_cancel_order`, `fn_transition_order`, `fn_calculate_voucher_discount` và `sp_import_inventory` chạy `SECURITY DEFINER` (owner `db_admin`, `search_path=pg_catalog, app, pg_temp`), thực hiện khóa tuần tự và kiểm tra actor/role/ownership trong DB; các deferred constraint triggers cũng chạy `SECURITY DEFINER` để tương thích `COMMIT` khi `app_rw_user` không có DML trực tiếp trên bảng gốc. Admin có quyền owner vẫn có thể trực tiếp thao tác bảng trong miền CHECK; runtime không được cấp quyền đó.

## 4. Roles và bảo mật

| Role | Hiện tại | Còn cần sau Task03 |
| --- | --- | --- |
| db_admin | Owner schema/tables/functions/sequences; chạy migrations, seed, kiểm tra | Production dùng owner/migrator không superuser, cấp CREATE DB/schema phù hợp theo vận hành |
| app_rw_user | LOGIN có credential local từ Task02; USAGE app, SELECT 8 views catalog/banner public (`vw_catalog_variant_options` bổ sung ở `016`) và `EXECUTE` các routines đã phê duyệt (giao dịch lõi, auth/users, catalog/banner admin, commerce, back-office orders/inventory/vouchers/reports/audit); không SELECT users/order tables, không direct DML | Duy trì least-privilege fail-closed qua `SECURITY DEFINER` routines; tách credential riêng ở production |
| report_ro_user | LOGIN, mặc định không password khi mới tạo; USAGE app và SELECT hai aggregate views | Provision credential ngoài repo và nối report pool/API sau khi role ứng dụng được kiểm |

Không ghi password trong SQL. Migrations và [roles_backup.sql](../database/roles_backup.sql) giữ password/membership đã có; nếu runtime/report có thuộc tính superuser/createdb/createrole/replication/bypassrls thì từ chối thay vì tự sửa quyền cluster khác. Không tự cấp membership `db_admin` cho runtime. Roles là đối tượng **toàn cluster**, không thuộc riêng database nên rollback không DROP ROLE. [roles_backup.sql](../database/roles_backup.sql) đồng thời ghi nhận câu lệnh `pg_dump`/`pg_restore` tham chiếu cho bước diễn tập phục hồi sau này.

Local Docker hiện dùng db_admin làm bootstrap superuser từ Task02; không demote hoặc đổi password tùy ý vì đó là tài khoản quản trị container đang dùng. Production không dùng cấu hình đó: quản trị viên provision roles trước, db_admin cần quyền sở hữu/CREATE schema ở đúng database; credential bootstrap không cho backend. report_ro_user phải được đặt credential qua kênh vận hành an toàn trước khi đăng nhập; SET ROLE trong tests chỉ kiểm grants, không phải test password login report.

Quyền app_rw_user đang fail-closed vì chưa có business functions. Câu DML rộng trong SPEC và D-07 vẫn cần chốt khi triển khai functions; không coi Task03 là cấp phép runtime sửa trực tiếp orders/inventory/usages. PUBLIC không có schema access/helper EXECUTE; hàm mới do db_admin tạo cũng không tự cấp EXECUTE cho PUBLIC. ALTER DEFAULT PRIVILEGES trong 008 là default **database-local**, không global toàn cluster; per-schema REVOKE không đủ để bỏ default PUBLIC vốn có.

## 5. Seed thử nghiệm

`db:seed` mở một transaction chạy database/seeds/001_demo.sql. Seed có prefix reserved seed-demo-/DEMO-/SEED-, lock chống chạy song song, ON CONFLICT/NOT EXISTS để chạy lặp không nhân đôi hoặc reset dữ liệu đã có. Không TRUNCATE, không reset sequence; sequence gaps khi insert conflict là bình thường.

Seed tạo 5 tài khoản role mẫu **inactive**, hash cố ý không dùng được, 1 brand và 1 category tổng hợp, 6 product draft, 7 SKU đủ 6 loại, 1 ảnh fixture, tồn đầu/log nhập, 1 đơn PENDING có snapshot/export log, 1 voucher và 1 banner draft. Giá 100.25/120.50 là fixture kiểm decimal, không là giá bán thật; không tự gộp ảnh4/5. Asset_path là logical URL cho bước phục vụ tài sản sau, seed không copy ảnh vào frontend hoặc chứng minh URL đang được serve.

Vì procedure nhập kho/checkout chưa có, seed dùng db_admin ghi stock+ledger và order+items trong cùng transaction. Đây là ngoại lệ fixture có kiểm đối soát, không đường ghi nghiệp vụ của backend. Lần đầu seed trừ stock đúng một lần cho đơn mẫu, chạy lại không trừ tiếp. Không bật tài khoản demo để đăng nhập vì chưa có password hash hợp lệ.

## 6. Kiểm thử database trống và rollback

`npm.cmd run db:test` dùng Node test runner + pg thật:

1. CREATE DATABASE schema_test_<random> TEMPLATE template0; không dùng database ứng dụng làm nơi xóa thử.
2. Áp toàn bộ migrations, xác nhận 20 bảng, down toàn bộ khi domain chưa có data rồi up lại và up lần nữa phải no-op.
3. Seed hai lần, kiểm counts/stock, chạy constraint/role/snapshot tests và race hai session cho SKU combo; test từng mutation có transaction rollback.
4. Đóng connection và DROP chỉ database tạm do test vừa tạo, kể cả khi lỗi. Roles cluster và defaults đã thiết lập được giữ theo thiết kế.

Credential test cần CREATEDB; cần CREATEROLE nếu cluster chưa có ba role. Container local bootstrap đáp ứng; production không cần trao CREATEDB cho runtime để chạy app. db:verify của Task02 vẫn là smoke test SQL up/down độc lập, không thay db:test.

`npm.cmd run db:migrate:down` rollback **một** migration. Down 008 cố ý giữ default EXECUTE hạn chế, roles/password cũng giữ lại; không khẳng định rollback khôi phục mọi thuộc tính role/default ACL như trước. Down 005 có RESTRICT và sẽ thất bại khi có catalog dùng metadata. Không force CASCADE/xóa volume để làm rollback pass. Với dữ liệu thật, backup, review và forward-fix migration là đường mặc định; test down/up đầy đủ trên DB tạm chưa seed như bộ test đã làm.

## 7. Tiền, index và giới hạn kiểm chứng

Tất cả cột tiền base table dùng NUMERIC(12,2), miền không âm và không NaN/Infinity. list_price null hoặc ≥price; unit_price/list_unit_price là snapshot. PostgreSQL tự làm tròn input quá hai số lẻ theo scale; API tương lai phải từ chối input sai scale nếu hợp đồng yêu cầu. Chưa áp CHECK phần lẻ .00 hay chốt phí ship/làm tròn voucher khi D-01 còn pending. SUM reporting là numeric rộng, không ép tổng về miền một đơn.

Index FK, composite `orders(user_id,created_at DESC,id DESC)`, `orders(created_at DESC,id DESC)`, partial active orders/delivered, price/catalog/ledger/date, `inventory_transactions(reference_id,variant_id)`, `audit_events` và partial unique nằm trong SQL `006`, `010`, `012`. Có 73 index tổng cộng bao gồm PK/UNIQUE hỗ trợ FK ghép. Chưa benchmark 50k–100k đơn và không cam kết planner chọn index trên seed nhỏ; benchmark thuộc T24.

Đã kiểm chứng 4 kịch bản tranh chấp/rollback/snapshot cốt lõi (A–E trong `database/tests/business_logic.test.mjs`) và ràng buộc schema (`database/tests/schema.test.mjs`) trên PostgreSQL 17.9 thật. Các endpoint REST, auth JWT/DB lookup, catalog/cart API và frontend UI vẫn thuộc các task tiếp theo; xem [SCHEMA_VERIFICATION](SCHEMA_VERIFICATION.md).
