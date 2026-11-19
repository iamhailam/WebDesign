# FULL PROJECT QUALITY AUDIT (TASK 00–13)

Ngày kiểm toán: 20/11/2026 (Asia/Bangkok).
Phạm vi: Toàn bộ repository `c:\Đồ án CSDL` ở trạng thái commit `1fb496ff5924dfe74728a5edf7ff6f0687f8291f` (nhánh `main`, working tree sạch trước khi tạo báo cáo này).
Phương pháp: Đọc trực tiếp tài liệu thiết kế, Git history, toàn bộ SQL migrations/seeds/tests, source backend, source frontend và chạy thực tế các lệnh kiểm thử (`lint`, `typecheck`, `build`, `audit --omit=dev`, `db:verify`, `db:test`, backend Vitest + PostgreSQL 17.9, frontend Vitest + Testing Library). Không sửa mã nguồn, không sửa migration đã áp dụng và không xóa/reset dữ liệu `fashion_dev`.

---

## 1. Executive Summary

- **Tổng quan kỹ thuật**: Kiến trúc PostgreSQL Database-Centric (`22` bảng trong schema `app`, `19` SQL migrations thuần `001`–`019`, `app_rw_user` fail-closed + `SECURITY DEFINER` actor/role checks + explicit row locking), tầng API Express + TypeScript (`pg` tham số hóa, Zod `strictObject`, mapped SQLSTATEs), và frontend React + Vite + TypeScript (Storefront, Checkout COD, Customer Account, Back-Office theo 5 vai trò RBAC) đã được triển khai đồng bộ và hoạt động nhất quán với nhau.
- **Kết quả kiểm thử thực tế trong phiên audit**:
  - `npm.cmd run lint` (`--max-warnings 0`): **PASS** (0 lỗi, 0 cảnh báo).
  - `npm.cmd run typecheck` (backend + frontend `tsc --noEmit` strict): **PASS**.
  - `npm.cmd run build` (backend `tsc` + frontend `vite build`): **PASS**.
  - `npm.cmd run db:verify` (trên DB tạm `foundation_verify_*` PostgreSQL 17.9): **PASS**.
  - `npm.cmd run db:test` (trên 2 DB trống tách biệt từ `template0`): **PASS — 94/94 tests** (85 schema/constraint/privilege tests + 8 concurrency/rollback/snapshot tests + suite).
  - `npm.cmd test --workspace=backend` (Vitest + Supertest + PostgreSQL 17.9 thật): **PASS — 8/8 files, 32/32 tests**.
  - `npm.cmd test --workspace=frontend` (Vitest + React Testing Library + `fetch` mock): **PASS — 6/6 files, 28/28 tests**.
  - `npm.cmd audit --omit=dev`: **PASS — 0 vulnerabilities**.
- **Nhận định cổng nghiệm thu (Quality Gate)**:
  - **Không phát hiện lỗi Critical hoặc High** ở tính đúng giao dịch (checkout atomicity, tranh chấp tồn/voucher, hủy đơn một lần, giá lịch sử, RBAC fail-closed).
  - Tuy nhiên, dự án **chưa đạt cổng phát hành cuối (Production Release Gate)** theo [TASKS.md](../TASKS.md) vì còn:
    1. Thiếu một ảnh tĩnh được seed (`styleweb.png` chưa có bản sao trong `frontend/public/media/`, gây fallback trên HERO banner khi chạy thật).
    2. Lỗi phân cấp heading (`<h1>` bị thiếu trên `HomePage` khi có HERO banner) và chưa cập nhật `document.title` động (`NFR-14`).
    3. Các hạng mục hậu-triển khai trong [TASKS.md](../TASKS.md) chưa thực thi/kiểm chứng: quyết định `D-01`..`D-14` (`T01`), kiểm thử trình duyệt thật E2E + WCAG (`T23`), benchmark 50k–100k đơn (`T24`), backup/restore rehearsal & cấu hình pilot production (`T25`–`T26`).

---

## 2. Phân biệt Yêu cầu gốc (SPEC) vs Mở rộng đa thương hiệu & Trạng thái Git

### 2.1. Đối chiếu Yêu cầu gốc (`G`) vs Mở rộng (`U`/`D`)
- **Yêu cầu gốc giữ nguyên từ [SPEC.md](../SPEC.md)** (`12` bảng lõi, `CUSTOMER/SALES/WAREHOUSE/MARKETING/ADMIN`, COD, giỏ không giữ kho, checkout nguyên tử 5-way concurrency, hủy đơn hoàn kho/voucher một lần, giá lịch sử bất biến, sequential order transitions, `vw_revenue_summary` & `vw_best_selling_products`): đã bảo toàn nguyên vẹn và không sửa `SPEC.md`.
- **Mở rộng đã được phê duyệt thiết kế trong [PRD.md](PRD.md) & [DECISIONS.md](DECISIONS.md)**:
  - `3` bảng nội dung thương mại (`brands`, `product_images`, `banners`), `5` bảng thuộc tính SKU đa ngành (`CLOTHING`, `SHOES`, `BAGS`, `WATCHES`, `ACCESSORIES`, `PERFUME`), `2` bảng vận hành (`checkout_requests`, `audit_events`).
  - Siết quyền `D-07` (`app_rw_user` không còn DML trực tiếp lên bảng giao dịch, thay bằng `SECURITY DEFINER` routines có actor checks), `D-03` (`Idempotency-Key` + `expected_items` + `cart_version`), `D-04` (server-authoritative voucher preview + khóa điều khoản sau khi có usage), `D-10` (JWT 30 phút in-memory + `token_version` + bảo vệ admin cuối).
  - **Lưu ý quy trình**: Các chính sách kinh doanh đánh nhãn `D-01`..`D-14` trong [DECISIONS.md](DECISIONS.md) vẫn giữ trạng thái chờ PO chốt chính thức (`T01`); các implementation Task 02–13 chạy theo phương án khuyến nghị được ghi nhận tại đó.

### 2.2. Kiểm tra Git (`PHẦN 2`)
- `git status`: `On branch main`, `nothing to commit, working tree clean`. Toàn bộ thay đổi của Task 00–13 đã được commit tại `1fb496ff5924dfe74728a5edf7ff6f0687f8291f`.
- Lịch sử commit gần nhất:
  - `1fb496f`: `Cap nhat frontend, backend va tai lieu du an` (66 files, +15.813 / -44 dòng).
  - `d2eb4f0` / `52d3167` / `0fc10e1`: `feat: initialize fullstack monorepo foundation`.
  - `4bbfc43`: `chore: initialize project workspace`.
- Kiểm tra secrets / tệp nhạy cảm:
  - `.gitignore` ignore `.env` và `.env.*` (trừ `.env.example`).
  - `git check-ignore -v .env` xác nhận `.env` bị ignore; `git log --all -- .env` trả rỗng (`.env` chưa từng bị commit vào lịch sử Git).
  - `.env.example` để trống `DB_PASSWORD`, `POSTGRES_PASSWORD`, `MIGRATION_DATABASE_URL`, `JWT_SECRET`.
  - Scan `backend/src` và `frontend/src` không thấy hardcode credential, không đưa secret vào `VITE_*`, không ghi `password_hash`/token vào `localStorage` hay response/log.

---

## 3. Task Completion Matrix (Task 00–13 & Đối chiếu T01–T26)

| Task thực thi | Ánh xạ TASKS.md | Trạng thái | Tóm tắt bằng chứng & Khoảng trống |
| --- | --- | --- | --- |
| Task 00–02 | `T02` (Foundation) | **VERIFIED PASS** | Monorepo workspaces, Express/Vite/TS/ESLint, Compose PG 17.9, `db:verify` PASS, `lint`/`typecheck`/`build` PASS, `audit --omit=dev` 0 lỗ hổng. |
| Task 03 | `T03` (DB Schema) | **VERIFIED PASS** | `22` bảng `app.*`, `NUMERIC(12,2)`, PK/FK/UNIQUE/CHECK/deferred triggers, `roles_backup.sql`, `schema.test.mjs` PASS trên DB trống `template0`. |
| Task 04 | `T04–T11` (DB Logic) | **VERIFIED PASS** | `fn_calculate_voucher_discount`, `fn_place_order`, `fn_cancel_order`, `fn_transition_order`, `sp_import_inventory`, `trg_protect_finalized_orders`, `trg_set_updated_at`, `vw_revenue_summary`, `vw_best_selling_products` đạt `business_logic.test.mjs`. |
| Task 05 | `T04`, `T13` (Auth/RBAC) | **VERIFIED PASS** | Argon2id (`password.ts`), HS256 JWT + `token_version`, login rate limit (`429`), 5-role allowlist, Users API + `LAST_ADMIN_PROTECTED`; `auth-rbac.integration.test.ts` (5/5) + unit tests (7/7) PASS. |
| Task 06 | `T05`, `T12`, `T14` (Catalog & Seed) | **VERIFIED PASS** *(cập nhật sau Nhóm 1)* | Catalog REST + Admin CRUD + `002_multibrand_demo.sql` 6 ngành hàng PASS (`catalog.integration.test.ts` 4/4). Bản sao `styleweb.png` đã được bổ sung tại `frontend/public/media/styleweb.png` mà không sửa file gốc. |
| Task 07 | `T06–T10`, `T13` (Commerce API) | **VERIFIED PASS** | Cart, Voucher available/preview, Atomic COD Checkout + `Idempotency-Key`, My Orders, Cancel; `commerce.integration.test.ts` (6/6) + `shopping-flow.e2e.test.ts` (1/1) PASS trên PG thật. |
| Task 08 | `T10–T13` (Back-Office API) | **VERIFIED PASS** | Orders, Inventory/Import/Ledger, Vouchers/Usages, Revenue/Best-Sellers Reports, Audit Events; `backoffice.integration.test.ts` (5/5) PASS. Ghi chú kiến trúc: `server.ts` dùng chung pool `app_rw_user` cho `SECURITY DEFINER` reports thay vì pool `report_ro_user` riêng. |
| Task 09 | `T15` (Design System) | **VERIFIED PASS** | Tokens trắng/đỏ/xám, AppLayout, Header, SearchBar, CategoryNav, MobileNav drawer, UI primitives (`Button`, `Dialog`, `Toast`, `Badge`, `Input`, `Select`); `design-system.test.tsx` (6/6) PASS. |
| Task 10 | `T16` (Home & Catalog UI) | **VERIFIED PASS (Vitest DOM)** *(cập nhật sau Nhóm 1; chờ T23 live browser)* | API thật, URL filter sync, skeleton/empty/error; đã sửa `<h1>` trên Home khi có `HeroBanner`, `/media/styleweb.png` sẵn sàng, và `document.title` động (`home-catalog.test.tsx` 6/6 PASS). |
| Task 11 | `T17` (Shopping Flow UI) | **VERIFIED PASS** | Gallery, 6-type SKU selector, tồn kho 0 khóa nút, Cart & COD Checkout (`Idempotency-Key` retry, voucher/stock/price 409 handling); `shopping-flow.test.tsx` (2/2) PASS (với fetch mock). |
| Task 12 | `T18` (Customer Account UI) | **VERIFIED PASS** | Register/Login (RHF+Zod), ProtectedRoute, Account Profile, Order History + Invoice snapshot + StatusTimeline + Cancel modal; `customer-account.test.tsx` (5/5) PASS (với fetch mock). |
| Task 13 | `T19` (Back-Office UI) | **VERIFIED PASS** | AdminLayout riêng, role sidebar/redirect, Dashboard, Orders, Inventory/Ledger, Products/SKU/Gallery/Categories/Brands, Vouchers/Usages, Users, Banners, Audit Events; `backoffice-ui.test.tsx` (7/7) PASS (với fetch mock). |
| Còn lại | `T01`, `T23`–`T26` | **NOT VERIFIED** | `T01` (PO duyệt `D-01`..`D-14`), `T23` (Browser E2E thật + a11y + 360..1440 visual), `T24` (Benchmark 50k–100k orders `EXPLAIN ANALYZE`), `T25`–`T26` (Pilot ops, backup/restore rehearsal, PO UAT) **chưa chạy**. |

---

## 4. Tests Đã Chạy và Kết Quả Thực Tế

Môi trường thực thi tại phiên audit: Windows (`c:\Đồ án CSDL`), Node/npm workspaces, PostgreSQL `17.9 (Debian 17.9-1.pgdg12+1)` chạy qua Docker Compose. Lưu ý: trong sandbox chuẩn Windows, các lệnh nối TCP tới `127.0.0.1` gặp `EACCES`, nên `db:verify`, `db:test` và backend integration tests được chạy trực tiếp bằng `BypassSandbox: true` trên các database test tách biệt tự dọn dẹp sau khi chạy.

| Lệnh | Phạm vi | Kết quả quan sát |
| --- | --- | --- |
| `npm.cmd run lint` | ESLint toàn repo (`--max-warnings 0`) | **Exit 0** — 0 errors, 0 warnings |
| `npm.cmd run typecheck` | `tsc --noEmit` backend & frontend strict | **Exit 0** |
| `npm.cmd run build` | Backend `tsc` + Frontend `vite build` | **Exit 0** (Frontend dist built 5.82s; có 2 warning Rollup về chunk `auth.tsx` & `index-*.js` 721.08 kB) |
| `npm.cmd audit --omit=dev` | Production runtime dependencies | **Exit 0** — `found 0 vulnerabilities` |
| `npm.cmd run db:verify` | Disposable DB `foundation_verify_*` | **Exit 0** — `PASS PostgreSQL 17.9: SQL up/down, fixture rollback and PL/pgSQL` |
| `npm.cmd run db:test` | 2 DB trống từ `template0` (`schema_test_*`, `logic_test_*`) | **Exit 0** — **94/94 tests passed** (0 failed, 0 skipped, 2.20s) |
| `npm.cmd test --workspace=backend` | Unit + Health + Auth/RBAC + Catalog + Commerce + Back-Office + E2E HTTP trên PG 17.9 | **Exit 0** — **8/8 files, 32/32 tests passed** (4.03s) |
| `npm.cmd test --workspace=frontend` | Vitest + React Testing Library + mock `fetch` | **Exit 0** — **6/6 files, 29/29 tests passed** (bao gồm regression test Nhóm 1 sau audit) |
| Browser E2E thật (`T23`) | Playwright / Chrome DevTools UI end-to-end | **NOT RUN** (chưa có bộ E2E browser runner trong repo) |
| Benchmark 50k–100k đơn (`T24`) | `EXPLAIN (ANALYZE, BUFFERS)` + load profile | **NOT RUN** (chưa có benchmark seed/script trong repo) |
| Restore rehearsal (`T25`) | `pg_dump` / `pg_restore` sang DB mới | **NOT RUN** |

> [!NOTE]
> Sau khi sửa **Nhóm 1 (Frontend Assets, SEO & Accessibility)**, `lint`, `typecheck`, `build` và `frontend` tests đã được chạy lại toàn bộ và đạt Exit 0. Các kiểm thử DB (`db:verify`, `db:test`) và `backend` integration tests (32/32, 94/94) thuộc phạm vi phiên audit không bị sửa mã nguồn trong Nhóm 1 nên giữ nguyên kết quả trước đó.

---

## 5. Danh sách Bugs & Sai lệch theo Mức độ

*(Không phát hiện lỗi Critical hoặc High ở dữ liệu giao dịch, RBAC hay SQL injection.)*

### Medium *(Nhóm 1 — Đã xử lý & kiểm thử trong lượt remediation #1)*
1. **[FIXED] Thiếu asset banner `/media/styleweb.png` trong `frontend/public/media/`** (`database/seeds/001_demo.sql:74`, `database/seeds/002_multibrand_demo.sql:152` vs `frontend/public/media/`):
   - Đã sao chép nguyên bản `styleweb.png` sang `frontend/public/media/styleweb.png` (240.615 bytes) giữ nguyên tệp gốc; kiểm chứng qua regression test `home-catalog.test.tsx`.
2. **[FIXED] Homepage thiếu thẻ `<h1>` khi có HERO banner hoạt động** (`frontend/src/pages/home.tsx`):
   - Đã thêm `<h1 className="sr-only">Cửa hàng thời trang đa thương hiệu</h1>` khi đang tải hoặc hiển thị `HeroBanner` (nhánh fallback giữ nguyên `<h1>` hiển thị); kiểm chứng qua regression test `home-catalog.test.tsx`.
3. **[FIXED] Chưa cập nhật `document.title` theo trang / tên sản phẩm** (`NFR-14`):
   - Đã thêm hook `frontend/src/lib/use-page-title.ts` và gắn trên `HomePage`, `ProductsPage`, `BrandsPage`, `ProductDetailPage`, `CartPage`, `CheckoutPage`, `OrderSuccessPage`, `LoginPage`, `RegisterPage`, `ForbiddenPage`, `AccountLayout` và `AdminLayout`; kiểm chứng qua regression test `home-catalog.test.tsx`.

### Low *(OPEN — Nhóm 2 & Nhóm 3)*
4. **[OPEN — Nhóm 2] Cảnh báo Vite code-splitting chunk size và static/dynamic import trùng** (`frontend/src/app.tsx`, `protected-route.tsx`, `cart.tsx`, `checkout.tsx`):
   - `pages/auth.tsx` vừa được `lazy()` import trong `app.tsx`, vừa được static import trực tiếp để lấy `ForbiddenPage` trong `protected-route.tsx`, `cart.tsx`, `checkout.tsx`; đồng thời `index-*.js` đạt `721.08 kB` (> ngưỡng cảnh báo 500 kB của Vite).
5. **[OPEN — Nhóm 3 — Cần migration SQL mới]** **Audit events từ migration `013` không ghi `request_id`** (`database/migrations/013_business_functions_and_procedures.sql:423, 559, 633, 740`):
   - Khác với `015`/`016`/`018`/`019` (đã nhận `p_request_id UUID DEFAULT NULL`), `fn_place_order`, `fn_cancel_order`, `fn_transition_order` và `sp_import_inventory` lưu `audit_events.request_id` là `NULL`, giảm khả năng truy vết chéo log HTTP → DB cho đơn hàng và nhập kho (`NFR-11`).
6. **[OPEN — Nhóm 2] `CheckoutPage` chưa dùng React Hook Form + Zod đồng nhất với phần còn lại của frontend** (`frontend/src/pages/checkout.tsx:34-37, 228-244`):
   - Sử dụng `useState` + `validateForm` thủ công thay vì `useForm` + `zodResolver`. Hoạt động đúng trong test hiện tại nhưng kém đồng nhất và `recipientName`/`recipientPhone` khởi tạo từ `user` chỉ ở lần mount đầu.

> **Trạng thái các nhóm rủi ro & backlog còn lại (đều `[OPEN]`):**
> - Security Risks #1–4 (`trust proxy` / rate limiter Redis, rate limit `register` & `checkout`, `D-10` TTL 30 phút, `report_ro_user` pool) → **OPEN (Nhóm 3 / `T25`)**.
> - Database Risks #1–3 (`checkout_requests` retention `D-13`, `COUNT(*)`/`ILIKE` p95 `T24`, đồng nhất views báo cáo) → **OPEN (Nhóm 4 / `T24`)**.
> - Missing Tests #1–4 (Browser E2E thật `T23`, `V17` & `V16` barrier tests, Benchmark 50k–100k đơn `T24`, Backup/Restore `T25`) → **OPEN (Nhóm 4 / `T23`–`T25`)**.

---

## 6. Security Risks

1. **In-memory Login Rate Limiter & thiếu cấu hình `trust proxy` (`backend/src/middlewares/rate-limit.ts`, `backend/src/app.ts`)**:
   - Rate limiter lưu `Map` trong bộ nhớ process và dựa vào `req.ip`; khi chạy nhiều instance hoặc sau reverse proxy (`nginx`/load balancer) mà chưa bật `trust proxy` đúng chuẩn (`T25`), mọi request có thể dùng chung IP proxy hoặc bypass giữa các worker.
2. **Chưa có rate limit cho `POST /api/auth/register` và `POST /api/orders/checkout` (`NFR-04`)**:
   - Hiện chỉ có `createLoginRateLimiter` trên `/api/auth/login`; endpoint đăng ký tài khoản (tốn CPU Argon2id) và checkout chưa giới hạn tần suất.
3. **JWT in-memory `D-10` — Token bị lộ trước hạn 30 phút**:
   - `POST /api/auth/logout` không tồn tại ở server; logout phía client chỉ xóa state bộ nhớ. Nếu token bị sao chép, token còn hiệu lực tối đa 30 phút cho tới khi hết `exp` hoặc `token_version` thay đổi qua `fn_manage_user`. (Đã ghi nhận rõ trong `DECISIONS.md` D-10.)
4. **Phân tách pool `report_ro_user` chưa bật ở runtime (`backend/src/server.ts`, `ARCHITECTURE.md` §1)**:
   - Runtime hiện chỉ tạo 1 pool kết nối bằng `app_rw_user`; role `report_ro_user` mới được kiểm tra qua DB test. Hiện an toàn do các báo cáo chạy qua `SECURITY DEFINER` kiểm actor `MARKETING`/`ADMIN`, nhưng cần lưu ý khi tách read-replica hoặc reporting pool ở pilot `T25`.

---

## 7. Database Risks

1. **Bảng `checkout_requests` chưa có cơ chế dọn dẹp / retention (`012_operational_tables_and_trigger_names.sql`)**:
   - Phù hợp cho v1 (`D-13`), nhưng về dài hạn bảng giữ khóa idempotency và JSONB payload sẽ tăng tuyến tính theo số đơn, đòi hỏi chính sách lưu trữ/archive trước khi vận hành lâu dài.
2. **Chi phí `COUNT(*)` và `ILIKE '%...%'` trên bảng lớn (`018_backoffice_functions.sql`, `016_catalog_views_and_functions.sql`)**:
   - Các truy vấn admin (`fn_read_orders`, `fn_read_inventory_transactions`, `fn_read_audit_events`, `fn_read_admin_products`) đếm tổng dòng `count(*)` đầy đủ mỗi trang và dùng pattern `%...%` trên `order_code`/`sku`/`name`. Khi đạt 50k–100k đơn hoặc 10k SKU (`T24`), cần đo `EXPLAIN (ANALYZE, BUFFERS)` để kiểm chứng độ trễ p95.
3. **Báo cáo `fn_read_revenue_report` & `fn_read_best_sellers_report` trong `018` dùng CTE trên `app.orders`/`app.order_items` thay vì query trực tiếp `vw_revenue_summary`/`vw_best_selling_products`**:
   - Hai view `vw_revenue_summary` và `vw_best_selling_products` tồn tại và chuẩn logic, trong khi hàm đọc báo cáo trong `018` viết lại logic lọc ngày/mức sản phẩm-SKU để hỗ trợ phân trang và lọc `[from, to]`. Cả hai cần được giữ đồng nhất nếu công thức báo cáo thay đổi sau này.

---

## 8. Missing Tests (Khoảng trống kiểm thử)

1. **Kiểm thử trình duyệt thật E2E, Responsive (360px–1440px) và Accessibility (`T23`)**:
   - Toàn bộ 28 frontend tests hiện tại chạy trong `jsdom` với `fetch` mock; chưa chạy E2E trên trình duyệt thật nối live backend + PostgreSQL (để phát hiện lỗi ảnh 404 như `/media/styleweb.png`, overflow thực tế, contrast, keyboard focus, screen reader).
2. **Các kịch bản cạnh biên trong Verification Matrix (`TASKS.md` §3)**:
   - **`V17` concurrency**: 2 session `ADMIN` cùng lúc cố hạ quyền nhau (đã có `pg_advisory_xact_lock(71005, 1)` trong `015` và test đơn luồng trong `auth-rbac.integration.test.ts`, nhưng chưa có bài barrier 2-session đồng thời).
   - **`V16` hỗn hợp**: Test concurrent đồng thời `IMPORT` + `CANCEL` + `CHECKOUT` trên cùng một SKU chưa tách thành barrier test riêng.
3. **Benchmark & Load Profile 50k–100k đơn / 10k SKU (`T24`)**: Chưa có fixture/script benchmark và log `EXPLAIN (ANALYZE, BUFFERS)`.
4. **Backup & Restore Rehearsal (`T25`)**: Chưa thực nghiệm `pg_dump`/`pg_restore` sang DB trống để đo RPO/RTO và đối chiếu số dòng/constraints.

---

## 9. Regression Risks

- Sửa hoặc tách `ForbiddenPage` ra khỏi `pages/auth.tsx` cần kiểm tra tất cả import từ `protected-route.tsx`, `cart.tsx`, `checkout.tsx` và các test hiện tại để không làm gãy lazy route hoặc `403` guard.
- Mọi thay đổi ở các trang `frontend/src/pages/admin/*.tsx` hoặc `lib/admin-api.ts` phải bảo đảm không phá vỡ ràng buộc `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + ESLint `react-hooks/*` (`eslint-plugin-react-hooks` v7 React Compiler rules).
- Cảnh báo Git `LF will be replaced by CRLF` trên Windows: các script/CI đa nền tảng sau này nên có `.gitattributes` để giữ line ending đồng nhất giữa Linux container và Windows host.

---

## 10. Danh sách công việc cần sửa & Thứ tự Remediation đề xuất

1. **Bước 1 (Sửa nhanh Low/Medium frontend & asset — rủi ro thấp, hiệu quả ngay)**:
   - Đặt bản sao ảnh hợp lệ cho `/media/styleweb.png` tại `frontend/public/media/` (hoặc cập nhật banner demo sang asset nội bộ có sẵn nếu PO chốt) mà không xóa `styleweb.png` gốc.
   - Bổ sung thẻ `<h1>` (visually-hidden `sr-only` hoặc tiêu đề chính hợp lệ) trên `HomePage` khi `HeroBanner` hiển thị `<h2>`, và thêm quản lý `document.title` động theo route/sản phẩm (`NFR-14`).
   - Tách `ForbiddenPage` sang file component riêng (vd `src/components/auth/forbidden-page.tsx`) và cấu hình `manualChunks` trong `vite.config.ts` để xử lý cảnh báo Vite chunk > 500 kB.
2. **Bước 2 (Hoàn thiện kiểm thử trình duyệt thật & edge concurrency — `T23` / `V16`–`V17`)**:
   - Chạy `npm.cmd run db:seed` + `npm.cmd run dev` và thực thi kiểm thử E2E trên trình duyệt thật từ Storefront (6 ngành hàng) đến Back-Office (`360px`–`1440px`, keyboard/contrast audit).
   - Bổ sung barrier tests cho `V17` (2 `ADMIN` đồng thời) và `V16` (import + cancel + checkout hỗn hợp).
3. **Bước 3 (Bảo mật & Truy vết vận hành — trước Pilot `T25`)**:
   - Tạo migration mới (nếu mở rộng chữ ký) truyền `request_id` vào `audit_events` cho `fn_place_order`/`fn_cancel_order`/`fn_transition_order`/`sp_import_inventory`.
   - Bổ sung rate limiter cho `register` & `checkout`, cấu hình `trust proxy` theo env, và chuẩn hóa `report_ro_user` pool hoặc cập nhật `ARCHITECTURE.md` phản ánh đúng thực tế.
4. **Bước 4 (Hiệu năng & Cổng phát hành — `T01`, `T24`, `T25`, `T26`)**:
   - PO chốt chính thức các quyết định `D-01`..`D-14` (`T01`).
   - Tạo benchmark seed 50k–100k đơn & 10k SKU, ghi `EXPLAIN (ANALYZE, BUFFERS)` (`T24`).
   - Diễn tập `pg_dump`/`pg_restore`, đo RPO/RTO và nghiệm thu UAT (`T25`–`T26`).
