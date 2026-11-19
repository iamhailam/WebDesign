# QA REPORT — TASK 14: QUALITY ASSURANCE

Ngày kiểm thử: 20/11/2026 (Asia/Bangkok).
Tài liệu liên quan: [SECURITY_REPORT.md](SECURITY_REPORT.md), [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md), [QUALITY_GATE_FINAL.md](QUALITY_GATE_FINAL.md), [FULL_PROJECT_AUDIT.md](FULL_PROJECT_AUDIT.md).

---

## 1. Tóm tắt Kết quả Tổng hợp

| Hạng mục nhiệm vụ | Trạng thái | Kết quả quan sát thực tế |
| --- | --- | --- |
| 1. Unit tests | **PASS** | Backend unit/auth/health (`11/11` trong 3 files) + Frontend Vitest (`29/29` trong 6 files, `jsdom` + mock `fetch`) |
| 2. Backend integration tests | **PASS** | `32/32` toàn suite Backend (`8/8` files, chạy trên PostgreSQL 17.9 thật, `4.06s`) |
| 3. PostgreSQL concurrency & schema tests | **PASS** | `npm.cmd run db:test`: **`94/94` tests passed** (`3.69s`) + `db:verify` PASS |
| 4. Playwright E2E tests | **BLOCKED / NOT RUN** | Playwright **chưa cấu hình** trong repo; thử kiểm tra thay thế bằng Chrome thật qua `browser` subagent (`chrome_devtools` MCP) thất bại vì `DevToolsActivePort` không tồn tại (Chrome remote debugging chưa bật). |
| 5. RBAC tất cả 5 vai trò | **PASS** | Kiểm chứng đầy đủ `CUSTOMER`, `SALES`, `WAREHOUSE`, `MARKETING`, `ADMIN` ở DB, Backend API và Frontend routes/sidebar |
| 6. SQLi, XSS, CSRF | **PASS** | Xem [SECURITY_REPORT.md](SECURITY_REPORT.md) (đã probe động trên API `:3000` & `:5173`) |
| 7. Authentication / Session | **PASS** | Argon2id, `HS256` 30m, `token_version` invalidation tức thì, `401` đồng nhất, `429` rate limit login |
| 8. Responsive `375px`, `768px`, `1440px` | **PARTIAL (Blocked live browser)** | Đã review Tailwind breakpoints/container & Vitest mobile drawer (`design-system.test.tsx`); **chưa đo được visual overflow thật trên Chrome** vì `chrome_devtools` chưa kết nối |
| 9. Accessibility | **PARTIAL (Blocked live browser)** | Đã sửa & regression test `<h1>` và `document.title` (`M-2`, `M-3`), skip-link `#main-content`, `aria-hidden` icons, dialog/form labels trong Vitest DOM; **chưa spot-check focus/contrast thật trên Chrome** |
| 10. Production build + `lint` + `typecheck` | **PASS** | `lint` (0 warn), `typecheck`, `vite build` (`5.74s`) & `tsc -p tsconfig.build.json` Exit 0 |
| 11. Benchmark 50k–100k orders | **PASS** | 60.001 orders / 120.001 order_items trên PG 17.9 — xem [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) |

---

## 2. Xác minh 7 Kịch bản Kiểm thử Bắt buộc

| Kịch bản bắt buộc | Bằng chứng tại PostgreSQL thật (`db:test`) | Bằng chứng tại HTTP API + PG 17.9 (`backend`) | Kết quả |
| --- | --- | --- | --- |
| **5 checkout cùng 1 SKU còn 1 sản phẩm** | `business_logic.test.mjs` **Test A** (5 session qua barrier): `1` thành công, `4` lỗi `P1001`, tồn = `0`, giỏ thua nguyên vẹn | `commerce.integration.test.ts:681-724`: `1 × 201`, `4 × 409 OUT_OF_STOCK`, `quantity = 0` | **PASS** |
| **5 checkout tranh 1 voucher còn 1 lượt** | `business_logic.test.mjs` **Test B** (5 session qua barrier): `1` thành công, `4` lỗi `P1003`, `used_count = 1` | `commerce.integration.test.ts:726-770`: `1 × 201`, `4 × 409 VOUCHER_EXHAUSTED`, `used_count = 1` | **PASS** |
| **Rollback khi 1 cart item lỗi** | `business_logic.test.mjs` **Test C**: lỗi ở món 2 hoàn tác trừ kho món 1, voucher và order hoàn toàn | `commerce.integration.test.ts:474-506`: món 2 OOS → `409 OUT_OF_STOCK`, tồn món 1 giữ `20`, `used_count = 0` | **PASS** |
| **Không hoàn kho kép** | `business_logic.test.mjs` **Test D** (4 session hủy đồng thời): `1` thành công, `3` lỗi `P1010`, hoàn kho + voucher đúng `1` lần | `commerce.integration.test.ts:642-670`: 2 cancel đồng thời → `1 × 200`, `1 × 409 ORDER_NOT_CANCELLABLE`, kho/voucher hoàn 1 lần | **PASS** |
| **Giá lịch sử không thay đổi** | `business_logic.test.mjs` **Test E**: sửa giá/tên/brand sau mua không làm đổi `order_items` cũ | `commerce.integration.test.ts:591-608`: đổi giá `500000` → `888000` sau đặt đơn, đơn cũ giữ `'500000.00'` | **PASS** |
| **User không truy cập được đơn user khác** | DB owner check trong `fn_read_order_detail` & `fn_cancel_order` | `commerce.integration.test.ts:610-626`: Customer B xem/hủy đơn A nhận `404 NOT_FOUND`; `my-orders` rỗng | **PASS** |
| **Admin role permission isolation** | `schema.test.mjs` (`app_rw_user` / `report_ro_user` privilege checks) + DB actor checks | `password-rbac.unit.test.ts`, `auth-rbac.integration.test.ts`, `commerce` (`403` ADMIN checkout/cart), `backoffice` (`403` non-ADMIN) | **PASS** |

---

## 3. Phân loại Lỗi & Hạng mục Mở (CRITICAL / HIGH / MEDIUM / LOW)

- **CRITICAL (0)**: Không phát hiện.
- **HIGH (0)**: Không phát hiện.
- **MEDIUM (0 còn mở)**: Các lỗi Medium `M-1` (`/media/styleweb.png`), `M-2` (`<h1>` HomePage) và `M-3` (`document.title` động) từ audit trước đã được sửa, xác nhận phục vụ HTTP `200 image/png (240615 bytes)` trên Vite dev server và có regression test PASS.
- **LOW (còn mở — giữ nguyên theo quy tắc không tự ý sửa khi ngoài scope an toàn / cần migration)**:
  - **L-1**: Cảnh báo Vite chunk `index-*.js` (`721.58 kB` > 500 kB) và static+dynamic import trùng `pages/auth.tsx` (`app.tsx` vs `protected-route.tsx`/`cart.tsx`/`checkout.tsx`).
  - **L-2**: `CheckoutPage` dùng `useState` + `validateForm` thủ công thay vì RHF + Zod đồng nhất.
  - **L-3**: 4 hàm trong `013_business_functions_and_procedures.sql` ghi `audit_events.request_id = NULL` (cần migration SQL mới).
  - **SEC-01..SEC-05**: Chi tiết tại [SECURITY_REPORT.md](SECURITY_REPORT.md) (`T25` hardening).
  - **QA-GAP-01 (Môi trường Browser E2E — Chưa kiểm chứng live Chrome)**: Playwright chưa cấu hình và `chrome_devtools` không kết nối được vì thiếu `C:\Users\OS\AppData\Local\Google\Chrome\User Data\DevToolsActivePort`. Khi môi trường bật Chrome remote debugging hoặc cài runner E2E chính thức (`T23`), cần chạy bổ sung E2E trình duyệt thật + đo overflow ở `375px`, `768px`, `1440px` + kiểm accessibility thực tế.
  - **QA-GAP-02 (`V16`, `V17`)**: Chưa tách barrier test riêng cho 2-`ADMIN` hạ quyền đồng thời (`V17`) và tổ hợp `IMPORT+CANCEL+CHECKOUT` trên cùng SKU (`V16`).

---

## 4. Kết luận Nhiệm vụ Task 14

- Toàn bộ kiểm thử tự động có thể chạy trong phiên (`lint`, `typecheck`, `build`, `94/94` DB tests, `32/32` Backend integration tests, `29/29` Frontend Vitest tests, probe động SQLi/CORS/Helmet/Asset và benchmark 60.001 đơn hàng) **đều PASS 100%**.
- **Chưa tuyên bố hoàn thành kiểm thử trình duyệt thật (Playwright E2E / Responsive `375px–1440px` / Accessibility live Chrome)** do thiếu cấu hình Playwright và Chrome remote debugging chưa mở (`DevToolsActivePort` missing). Tài liệu [TASKS.md](../TASKS.md) giữ nguyên `T23`, `T24`..`T26` (chờ PO/môi trường) cho tới khi hoàn tất các cổng còn lại.
