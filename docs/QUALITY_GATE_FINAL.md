# QUALITY GATE FINAL REPORT (TASK 00–13)

Ngày nghiệm thu QA: 20/11/2026 (Asia/Bangkok).
Phạm vi kiểm tra: Toàn bộ workspace `c:\Đồ án CSDL` sau khi sửa lỗi **Nhóm 1** (asset `/media/styleweb.png`, heading `<h1>` trên `HomePage`, hook `document.title` động) đối chiếu với [SPEC.md](../SPEC.md), [TASKS.md](../TASKS.md), [FULL_PROJECT_AUDIT.md](FULL_PROJECT_AUDIT.md), [FOUNDATION_VERIFICATION.md](FOUNDATION_VERIFICATION.md) và [SCHEMA_VERIFICATION.md](SCHEMA_VERIFICATION.md).

---

## 1. Kết luận Tổng thể & Production Readiness Assessment

> [!WARNING]
> **TRẠNG THÁI NGHIỆM THU: CHƯA ĐẠT CỔNG PHÁT HÀNH PRODUCTION (NO-GO cho Production; PASS ở mức Dev/Integration cho Core DB + API + Unit/Component UI).**
> Không tuyên bố dự án đã hoàn thành phát hành cuối cùng vì các cổng `T01`, `T23` (Playwright/Browser E2E thật), `T24` (Benchmark 50k–100k đơn), `T25` (Pilot hardening + Backup/Restore rehearsal) và `T26` (PO UAT) **chưa được thực thi/chốt**.

1. **Mức độ hoàn thiện lõi nghiệp vụ (Task 00–13)**:
   - **0 lỗi Critical, 0 lỗi High**.
   - **3 lỗi Medium (`M-1`, `M-2`, `M-3`) từ audit đã được sửa và có regression test đạt**.
   - Toàn bộ 12 luồng nghiệp vụ chính và ma trận RBAC 5 vai trò (`CUSTOMER`, `SALES`, `WAREHOUSE`, `MARKETING`, `ADMIN`) **đạt 100%** ở tầng PostgreSQL 17.9 thật (`94/94` DB tests), tầng Express HTTP + PostgreSQL 17.9 (`32/32` backend tests), và tầng React Component UI (`29/29` frontend Vitest tests với `fetch` mock).
2. **Rào cản trước khi phát hành Production**:
   - **Thiếu Playwright / Live Browser E2E (`T23`)**: Repo chưa cài hoặc cấu hình Playwright; toàn bộ kiểm thử UI hiện chạy trên `jsdom` với `fetch` mock, chưa xác minh end-to-end qua trình duyệt thật nối Backend + PostgreSQL (`360px`–`1440px` layout thật, focus, contrast).
   - **Thiếu Barrier Concurrency mở rộng (`V16`, `V17`)**: Chưa có bài test barrier riêng cho 2 session `ADMIN` cùng hạ quyền nhau (`V17`) và tổ hợp đồng thời `IMPORT + CANCEL + CHECKOUT` trên cùng SKU (`V16`).
   - **Thiếu Benchmark & Restore (`T24`, `T25`)**: Chưa có dữ liệu/đo lường `EXPLAIN (ANALYZE, BUFFERS)` quy mô 50k–100k đơn và chưa diễn tập `pg_dump`/`pg_restore` sang DB mới đo RPO/RTO.
   - **Thiếu bảo mật vận hành trước Pilot (`T25`) & Truy vết (`L-3`)**: Chưa có rate limit cho `/api/auth/register` & `/api/orders/checkout`, chưa cấu hình `trust proxy`/Redis rate limiter cho multi-instance, `server.ts` dùng chung pool `app_rw_user` cho reports, và 4 hàm migration `013` chưa ghi `audit_events.request_id` (`L-3`).
   - **Chính sách kinh doanh `D-01`..`D-14` (`T01`)**: Vẫn giữ trạng thái chờ PO chốt chính thức trong [DECISIONS.md](DECISIONS.md).

---

## 2. Kết quả Thực thi Kiểm thử (Test Results — Chạy trực tiếp ngày 20/11/2026)

| Hạng mục / Lệnh | Môi trường thực thi | Kết quả quan sát | Chi tiết kiểm chứng |
| --- | --- | --- | --- |
| `npm.cmd run lint` | Toàn repo (`eslint . --max-warnings 0`) | **PASS (Exit 0)** | 0 errors, 0 warnings |
| `npm.cmd run typecheck` | Backend + Frontend (`tsc --noEmit`) | **PASS (Exit 0)** | Strict TypeScript đạt trên cả 2 workspaces |
| `npm.cmd run build` | Backend `tsc` + Frontend `vite build` | **PASS (Exit 0)** | Frontend build `5.74s`; còn 2 warning Rollup (`pages/auth.tsx` & `index-*.js` `721.58 kB` — ghi ở `L-1`) |
| `npm.cmd run db:verify` | DB tạm `foundation_verify_*` (PG 17.9 Docker) | **PASS (Exit 0)** | `PASS PostgreSQL 17.9 (Debian 17.9-1.pgdg12+1): SQL up/down, fixture rollback and PL/pgSQL` |
| `npm.cmd run db:test` | 2 DB trống từ `template0` (`schema_test_*`, `logic_test_*`, nhiều `pg.Client` thật) | **PASS (Exit 0) — 94/94** | 85 schema/constraint/trigger/privilege tests + 8 concurrency/rollback/snapshot tests + suite (`3.69s`) |
| `npm.cmd test --workspace=backend` | Vitest + Supertest + Fetch HTTP trên PG 17.9 thật (`db` riêng mỗi suite) | **PASS (Exit 0) — 8/8 files, 32/32 tests** | `jwt` (2), `password-rbac.unit` (5), `health` (4), `auth-rbac` (5), `catalog` (4), `commerce` (6), `backoffice` (5), `shopping-flow.e2e` (1) (`4.06s`) |
| `npm.cmd test --workspace=frontend` | Vitest + React Testing Library (`jsdom`, mock `fetch`) | **PASS (Exit 0) — 6/6 files, 29/29 tests** | `app` (3), `design-system` (6), `home-catalog` (6), `shopping-flow` (2), `customer-account` (5), `backoffice-ui` (7) (`9.85s`) |
| Playwright E2E | Toàn repo | **NOT CONFIGURED / NOT RUN** | Không tìm thấy `playwright.config.*`, thư mục E2E hoặc dependency Playwright trong `package.json` gốc / workspaces |

> [!NOTE]
> Trong Windows sandbox chuẩn, kết nối TCP tới `127.0.0.1:5432` bị chặn (`EACCES`). Do đó `db:test`, `db:verify` và `backend` integration tests được chạy trực tiếp bằng `BypassSandbox: true` trên PostgreSQL 17.9 thật (Docker Compose) với database test tạo mới và tự dọn dẹp sau khi chạy.

---

## 3. Kiểm tra lại Các Lỗi Đã Sửa & Regression Check (Nhóm 1)

| ID | Lỗi từ Audit | Bằng chứng xác minh lại | Không Regression |
| --- | --- | --- | --- |
| **M-1** | Thiếu asset `/media/styleweb.png` trong `frontend/public/media/` | Tệp [frontend/public/media/styleweb.png](../frontend/public/media/styleweb.png) (`240.615` bytes) tồn tại cùng `sanphamdemo1.jpg`..`6.jpg`; tệp gốc [styleweb.png](../styleweb.png) giữ nguyên | `home-catalog.test.tsx` test 6 (`existsSync`) **PASS** |
| **M-2** | `HomePage` thiếu `<h1>` khi HERO banner hoạt động | [home.tsx](../frontend/src/pages/home.tsx) render `<h1 className="sr-only">Cửa hàng thời trang đa thương hiệu</h1>` khi pending hoặc có `HeroBanner`, fallback giữ `<h1>` hiển thị | `home-catalog.test.tsx` test 6 xác nhận đúng `1` thẻ `<h1>` **PASS** |
| **M-3** | Thiếu `document.title` động theo route/sản phẩm (`NFR-14`) | Hook [use-page-title.ts](../frontend/src/lib/use-page-title.ts) được gắn trên các trang storefront, checkout, auth, account và admin | `home-catalog.test.tsx` test 6 xác nhận `document.title` đổi đúng (`Trang chủ \| Fashion Retail`, `Sản phẩm \| Fashion Retail`, tên sản phẩm) **PASS** |
| **Tổng hợp** | Không phá vỡ tính năng cũ | Toàn bộ `lint` (0 warn), `typecheck`, `build`, `db:test` (94/94), `backend` (32/32) và `frontend` (29/29) **PASS** | Đạt ở các lớp kiểm thử hiện có |

---

## 4. Kiểm chứng 12 Luồng Nghiệp vụ & Ma trận RBAC 5 Vai trò

### 4.1. Độ phủ kiểm thử 12 Luồng Nghiệp vụ

| Luồng nghiệp vụ | DB Test (`94/94`) | Backend Integration + HTTP (`32/32`) | Frontend UI (`29/29`, mock `fetch`) | Live Browser E2E (Playwright) |
| --- | --- | --- | --- | --- |
| 1. Register / Login | `schema.test.mjs` (email/role/cart auto-create) | `auth-rbac.integration.test.ts` (Argon2id, role injection block, 429 rate limit, JWT invalidate) & `shopping-flow.e2e.test.ts` | `customer-account.test.tsx` (RHF+Zod), `shopping-flow.test.tsx` | NOT RUN |
| 2. Product Search / Filter | `schema.test.mjs` (inactive brand/product views) | `catalog.integration.test.ts` (search, category, brand, same-SKU `min_price`/`max_price`+`in_stock`, sort, pagination) | `home-catalog.test.tsx` (URL query params sync, chips, pagination) | NOT RUN |
| 3. SKU Selection | `schema.test.mjs` (6 `product_types`, `combo_key`, invalid axes) | `catalog.integration.test.ts`, `shopping-flow.e2e.test.ts` | `shopping-flow.test.tsx` (variant selection, stock) | NOT RUN |
| 4. Add to Cart | `schema.test.mjs` (100 lines, unique SKU, positive qty) | `commerce.integration.test.ts` (DB price, non-deduct stock, stock warnings, client total rejected) | `shopping-flow.test.tsx` | NOT RUN |
| 5. Voucher Preview | `business_logic.test.mjs` (`fn_calculate_voucher_discount`, inclusive dates, rounding) | `commerce.integration.test.ts` (read-only preview, `409 PRICE_CHANGED`, eligibility), `shopping-flow.e2e.test.ts` | `shopping-flow.test.tsx` | NOT RUN |
| 6. COD Checkout | `business_logic.test.mjs` (**A**: 5-way stock race; **B**: 5-way voucher race; **C**: 2-item rollback; **E**: snapshot) | `commerce.integration.test.ts` (idempotency replay/conflict, OOS rollback), `shopping-flow.e2e.test.ts` | `shopping-flow.test.tsx` (`Idempotency-Key` retry, 409 conflict display) | NOT RUN |
| 7. Order History | `business_logic.test.mjs` (**E**: price/catalog change snapshot preserved) | `commerce.integration.test.ts`, `shopping-flow.e2e.test.ts` | `customer-account.test.tsx` (snapshot prices, status timeline, 404 IDOR conceal) | NOT RUN |
| 8. Order Cancellation | `business_logic.test.mjs` (**D**: 4-way concurrent cancel restores stock + releases voucher once) | `commerce.integration.test.ts` & `backoffice.integration.test.ts` | `customer-account.test.tsx` & `backoffice-ui.test.tsx` (cancel modal) | NOT RUN |
| 9. Order Status Management | `business_logic.test.mjs` (`fn_transition_order`, `trg_protect_finalized_orders`, `PAID`/`delivered_at`) | `backoffice.integration.test.ts` (concurrent transition `409 STALE_ORDER_STATUS`, sequential delivery) | `backoffice-ui.test.tsx` (SALES confirm/ship/deliver & 409 refresh) | NOT RUN |
| 10. Inventory Import | `business_logic.test.mjs` (`sp_import_inventory` idempotency, overflow, ledger reconcile) | `backoffice.integration.test.ts` (low-stock filter, idempotent import, PII-free ledger) | `backoffice-ui.test.tsx` (`Idempotency-Key` retry, PII omitted) | NOT RUN |
| 11. Voucher Management | `schema.test.mjs` (used<=limit, FIXED no cap, immutable code) | `backoffice.integration.test.ts` (CRUD, terms-lock guard after usage, masked usages) | `backoffice-ui.test.tsx` (locked-terms ISO preservation, masked emails) | NOT RUN |
| 12. Admin Dashboard | `business_logic.test.mjs` (`vw_revenue_summary`, `vw_best_selling_products` DELIVERED-only & RANK ties) | `backoffice.integration.test.ts` (Revenue/Best-Sellers, Users/Roles, Catalog/Banner admin, Audit Events) | `backoffice-ui.test.tsx` (Dashboard date range, ADMIN publish/SKU/users/banners) | NOT RUN |

### 4.2. Độ phủ Ma trận RBAC 5 Vai trò

| Vai trò | Kiểm chứng Backend (`auth-rbac` & `backoffice` & `commerce` trên PG 17.9) | Kiểm chứng Frontend (`customer-account` & `backoffice-ui`) | Kết quả |
| --- | --- | --- | --- |
| **CUSTOMER** | Tạo giỏ/đơn/hủy đơn của mình; chặn `404` khi xem đơn user khác; chặn `403` toàn bộ routes Back-Office (`orders`, `inventory`, `vouchers`, `reports`, `users`, `admin/*`) | Truy cập Account/Orders/Checkout; bị chặn `403` tại Back-Office routes | **PASS** |
| **SALES** | Xem list/chi tiết đơn, chuyển trạng thái tuần tự & hủy đơn `PENDING`/`CONFIRMED`; bị chặn `403` tại Cart/Checkout, Inventory, Vouchers, Reports, Admin | Sidebar chỉ hiện Orders; bị chặn `403` ở module Back-Office khác & Account checkout | **PASS** |
| **WAREHOUSE** | Xem tồn kho, nhập kho, xem sổ cái PII-free; bị chặn `403` tại Cart/Checkout, Orders (`GET /api/orders` và `/api/orders/:id`), Vouchers, Reports, Admin | Sidebar chỉ hiện Inventory; không lộ địa chỉ/SĐT khách hàng; bị chặn `403` module khác | **PASS** |
| **MARKETING** | CRUD Voucher, xem Usages (masked email), xem Reports Revenue & Best-Sellers; bị chặn `403` tại Cart/Checkout, Orders, Inventory, Admin | Sidebar hiện Dashboard/Reports & Vouchers; bị chặn `403` ở Orders/Inventory/Users | **PASS** |
| **ADMIN** | Toàn quyền Back-Office (Orders, Inventory, Vouchers, Reports, Users/Roles với `LAST_ADMIN_PROTECTED`, Catalog/Banners, Audit Events); **không kế thừa** giỏ/checkout của CUSTOMER (`403`) | Sidebar đầy đủ Back-Office, publish checklist, dynamic SKU, users, banners | **PASS** |

---

## 5. Task Verification Matrix (Task 00–13 & `TASKS.md` T01–T26)

| Task (`TASKS.md`) | Ánh xạ lộ trình gốc | Trạng thái QA | Căn cứ / Khoảng trống còn lại |
| --- | --- | --- | --- |
| **T01** | Tiền đề chốt `D-01`..`D-11,13` | **OPEN** | PO + Architect chưa ký chốt chính thức [DECISIONS.md](DECISIONS.md); implementation chạy theo phương án khuyến nghị |
| **T02** | Task 00–02 Foundation | **DONE** | [FOUNDATION_VERIFICATION.md](FOUNDATION_VERIFICATION.md) + `lint`/`typecheck`/`build`/`db:verify` PASS |
| **T03** | Task 03 PostgreSQL Schema | **DONE** | 22 bảng, `001`–`019`, 73 indexes, 10 views, `roles_backup.sql`, `schema.test.mjs` PASS trên DB `template0` |
| **T04** | Task 04–05 Auth/RBAC/Middleware | **DONE** | `auth-rbac` (5/5), `jwt` (2/2), `password-rbac.unit` (5/5), DB role/privilege PASS |
| **T05** | Task 06 Catalog DB & Options | **DONE** | `016`, 6 `product_types`, `schema.test.mjs` & `catalog.integration.test.ts` (4/4) PASS |
| **T06** | Task 07 Cart DB+API | **DONE** | `017`, `schema.test.mjs` (100 lines/qty) & `commerce.integration.test.ts` (6/6) PASS |
| **T07** | Task 04/07/08 Voucher DB | **DONE** | `019`, `fn_calculate_voucher_discount`, preview read-only, immutable terms, `business_logic` & `backoffice` PASS |
| **T08** | Task 04/08 Inventory DB+API | **DONE** | `sp_import_inventory` idempotent, ledger checks, `business_logic` & `backoffice` PASS |
| **T09** | Task 04/07 Atomic Checkout | **DONE** | `fn_place_order`, `checkout_requests`, 5-way stock/voucher race & rollback `business_logic` (A/B/C) + `commerce` PASS |
| **T10** | Task 04/07/08 Status & Cancel | **DONE** | `fn_cancel_order`, `fn_transition_order`, `trg_protect_finalized_orders`, `business_logic` (D/E) + `backoffice` PASS |
| **T11** | Task 04/08 Reports & Audit | **PARTIAL** | Reports views & audit read PASS; **còn `L-3`**: hàm `013` chưa ghi `audit_events.request_id` |
| **T12** | Task 06/08 Catalog & Banners API | **DONE** | `catalog.integration.test.ts` (4/4) & `backoffice.integration.test.ts` PASS |
| **T13** | Task 05/07/08 Core REST API | **DONE** | Toàn bộ Commerce/Inventory/Users REST, pagination, idempotency headers & static route precedence PASS |
| **T14** | Task 06 Demo Seed & Assets | **DONE** | `001_demo.sql` + `002_multibrand_demo.sql` (6 ngành hàng) idempotent + ảnh `frontend/public/media/` (`styleweb.png`, `sanphamdemo1..6.jpg`) |
| **T15** | Task 09 Frontend Shell & DS | **DONE (Vitest)** | `design-system` (6/6), `app` (3/3), `customer-account` (5/5), `backoffice-ui` (7/7) PASS *(chờ `T23` browser thật; còn `L-1`)* |
| **T16** | Task 10 Home & Catalog UI | **DONE (Vitest)** | `home-catalog.test.tsx` (6/6) + đã sửa M-1/M-2/M-3 *(chờ `T23` browser thật)* |
| **T17** | Task 11 Shopping Flow UI | **DONE (Vitest)** | `shopping-flow.test.tsx` (2/2) PASS *(chờ `T23` browser thật; còn `L-2`)* |
| **T18** | Task 12 Customer Account UI | **DONE (Vitest)** | `customer-account.test.tsx` (5/5) PASS *(chờ `T23` browser thật)* |
| **T19** | Task 13 Back-Office UI | **DONE (Vitest)** | `backoffice-ui.test.tsx` (7/7) PASS *(chờ `T23` browser thật)* |
| **T20** | QA DB Invariants (`V03,V05,V07–V14,V17–18`) | **PARTIAL** | `94/94` DB tests PASS cho `V03,V05,V07–V14,V18`; **thiếu bài barrier 2-ADMIN song song cho `V17`** |
| **T21** | QA Backend Contract + RBAC | **DONE** | `32/32` backend tests across 8 files trên PG 17.9 thật PASS |
| **T22** | QA DB Concurrency (`V01–V06,V15–16`) | **PARTIAL** | `V01–V06,V15` PASS; **thiếu bài barrier hỗn hợp `IMPORT+CANCEL+CHECKOUT` cho `V16`** |
| **T23** | QA Browser E2E, Responsive & A11y | **OPEN** | Playwright chưa cấu hình/chưa chạy; chưa kiểm visual/focus/contrast trên trình duyệt thật `360..1440px` |
| **T24** | Benchmark 50k–100k orders | **OPEN** | Chưa tạo script seed 50k–100k đơn & đo `EXPLAIN (ANALYZE, BUFFERS)` |
| **T25** | Pilot Ops, Security & Restore | **OPEN** | Chưa bật rate limit `register`/`checkout`, `trust proxy`, tách pool `report_ro_user`, diễn tập `pg_dump`/`pg_restore` |
| **T26** | PO UAT & Release Gate | **OPEN** | Phụ thuộc `T01` và `T25` |

---

## 6. Known Limitations & Outstanding Issues

### 6.1. Known Limitations
1. **Chưa có Browser E2E Runner (Playwright)**: Các kiểm thử UI hiện tại (`29/29`) sử dụng `jsdom` + mock `fetch`; luồng full-stack trên trình duyệt thật nối trực tiếp Express + PostgreSQL chưa được tự động hóa.
2. **Kiểm thử kết nối DB trên Windows Sandbox**: Sandbox mặc định chặn TCP tới `127.0.0.1:5432` (`EACCES`), đòi hỏi chạy `db:verify`, `db:test` và `backend` tests với `BypassSandbox: true`.
3. **Chưa kiểm chứng tải lớn & phục hồi thảm họa**: Chưa có benchmark 50k–100k đơn (`T24`) và chưa đo RPO/RTO qua `pg_restore` (`T25`).
4. **Dữ liệu/chính sách chờ PO (`D-01`..`D-14`)**: Giá ship, thương hiệu/tên cửa hàng chính thức, mapping `sanphamdemo4/5.jpg` và chính sách lưu trữ PII (`checkout_requests`, `audit_events`) đang dùng giá trị giả định khuyến nghị.

### 6.2. Outstanding Issues (Nhóm 2–4 còn mở)
- **Low (`L-1`)**: `pages/auth.tsx` vừa dynamic import (`app.tsx`) vừa static import (`ForbiddenPage` ở `protected-route.tsx`, `cart.tsx`, `checkout.tsx`), và Vite bundle `index-*.js` đạt `721.58 kB` (> ngưỡng cảnh báo 500 kB).
- **Low (`L-2`)**: `CheckoutPage` dùng `useState` + `validateForm` thủ công thay vì `React Hook Form + Zod` như phần còn lại.
- **Low (`L-3`)**: 4 hàm trong `database/migrations/013_business_functions_and_procedures.sql` ghi `audit_events.request_id = NULL` (cần migration SQL mới, không sửa trực tiếp migration đã áp dụng).
- **Security / Architecture (`T25`)**: Rate limiter in-memory (`Map`), thiếu `trust proxy`, chưa có rate limit cho `/api/auth/register` & `/api/orders/checkout`, `report_ro_user` chưa tách pool ở `backend/src/server.ts`, JWT in-memory `30 phút` chưa có server revocation ngoài `token_version`/`is_active` (`D-10`).
- **Missing Tests (`T20`, `T22`, `T23`–`T25`)**: Thiếu barrier tests `V16` & `V17`, Playwright E2E thật (`T23`), Benchmark `T24`, Restore rehearsal `T25`.
