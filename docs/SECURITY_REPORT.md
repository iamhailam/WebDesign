# SECURITY REVIEW REPORT (TASK 14)

Ngày đánh giá: 20/11/2026 (Asia/Bangkok).
Phạm vi: Source code Backend ([backend/src](../backend/src)), Frontend ([frontend/src](../frontend/src)), PostgreSQL schema/roles/functions ([database/migrations](../database/migrations)), và kiểm thử động trên máy chủ API/Vite thực tế cùng PostgreSQL 17.9.

---

## 1. Tóm tắt Phân loại Lỗ hổng & Rủi ro

| Mức độ | Số lượng | Chi tiết |
| --- | --- | --- |
| **CRITICAL** | **0** | Không có SQL injection, lộ credential/hash, bypass RBAC hoặc chiếm quyền admin/cross-user. |
| **HIGH** | **0** | Không có XSS sink, CSRF token-cookie flaw hoặc bypass atomicity/tài chính. |
| **MEDIUM** | **0** *(tồn tại sau Nhóm 1)* | Các lỗ hổng `M-1`..`M-3` về asset/a11y/SEO đã sửa; không có vấn đề Medium bảo mật. |
| **LOW / HARDENING** | **5** | `L-3` (`audit_events.request_id = NULL` ở `013`), rate limit chưa gắn cho `/register` & `/checkout`, rate limiter in-memory thiếu `trust proxy`, `report_ro_user` chưa tách pool ở `server.ts`, JWT 30 phút in-memory không có server blacklist (`D-10`). |

---

## 2. Kiểm tra Chi tiết theo Hạng mục

### 2.1. SQL Injection (SQLi)
- **Đánh giá code**: Toàn bộ câu lệnh SQL trong `backend/src/services/*.ts` dùng `pg` truy vấn tham số hóa `$1, $2, ...`. Hai điểm nội suy chuỗi `${orderSql}` và `${whereClause}` trong [catalog.service.ts](../backend/src/services/catalog.service.ts) chỉ lấy từ map allowlist cố định (`PUBLIC_PRODUCT_SORT_SQL`) hoặc nhánh rẽ typed `'id' in lookup ? 'p.id = $1' : 'p.slug = $1'`. Input `LIKE`/`ILIKE` được escape qua `escapeLike` (`ESCAPE '\\'`).
- **Kiểm chứng động trên API thực tế**:
  - `GET /api/products?search=%25%27%20OR%201%3D1%20--` → HTTP `200`, `items.length === 0` (không bypass điều kiện).
  - `GET /api/products?sort=id;%20DROP%20TABLE%20app.orders;%20--` → HTTP `400 VALIDATION_ERROR` (Zod enum từ chối trước khi vào service).
- **Bảo vệ tầng DB**: Role `app_rw_user` (`NOSUPERUSER`) bị `REVOKE` quyền DML trực tiếp trên các bảng giao dịch (`D-07`) và chỉ gọi `SECURITY DEFINER` routines có `search_path = pg_catalog, app, pg_temp`. Đã kiểm chứng trực tiếp qua `schema.test.mjs` (`runtime direct stock write is denied`, `new owner functions do not grant PUBLIC EXECUTE by default`).

### 2.2. Cross-Site Scripting (XSS) & Security Headers
- **Đánh giá code Frontend**: Scan toàn bộ `frontend/src/**/*.{ts,tsx}` cho thấy **0** lần dùng `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `document.write` hay `eval(...)`; toàn bộ dữ liệu API qua React JSX auto-escaping.
- **Asset URL validation**: Ràng buộc DB trên `product_images` và `banners` chặn path traversal và `javascript:` URLs (`schema.test.mjs`: `asset traversal/script URLs are rejected`).
- **Kiểm chứng Header thực tế trên `http://127.0.0.1:3000/api/health`**:
  - `content-security-policy: default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests`
  - `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `cross-origin-opener-policy: same-origin`, `referrer-policy: no-referrer`, `cache-control: no-store`, `x-powered-by` đã bị tắt (`app.disable('x-powered-by')`).

### 2.3. Cross-Site Request Forgery (CSRF) & CORS
- **Cơ chế xác thực ([auth-context.tsx](../frontend/src/lib/auth-context.tsx) & [rbac.ts](../backend/src/auth/rbac.ts))**: Access token JWT lưu **thuần trong bộ nhớ React (`useState`)**, không dùng `localStorage`/`sessionStorage` và **không dùng auth cookie tự động gửi kèm** (`Authorization: Bearer <token>`). Do trình duyệt không tự gắn Bearer token vào cross-site requests, bề mặt CSRF truyền thống qua cookie không tồn tại với cơ chế hiện tại (`D-10`).
- **CORS Allowlist ([app.ts](../backend/src/app.ts))**: Chỉ cho phép `origin === options.frontendOrigin` (hoặc non-browser requests không có `Origin`). Kiểm chứng thực tế với `Origin: https://evil.example` trả `403 CORS_FORBIDDEN`.

### 2.4. Authentication, Password Hashing & Session Handling
- **Password Hashing (`password.ts`)**: Argon2id (`crypto.scrypt` / argon2 parameters `m=19456,t=2,p=1` kiểm qua `password-rbac.unit.test.ts` & `auth-rbac.integration.test.ts`), đăng ký khóa cứng role `CUSTOMER` (`registerSchema` strictObject từ chối `role` injection), login trả lỗi `401` đồng nhất cho email không tồn tại / sai mật khẩu / tài khoản bị khóa.
- **JWT Verification (`jwt.ts`, `rbac.ts`)**: Thuật toán khóa cứng `algorithms: ['HS256']`, kiểm `issuer`, `audience`, `maxAge: 1800s` (30 phút), sau đó truy vấn DB (`fn_get_actor`) kiểm tra `actor.is_active`, `actor.role === claims.role`, và `actor.token_version === claims.ver`. Khi user bị đổi role hoặc vô hiệu hóa, `token_version` tăng và token cũ bị từ chối `401 INVALID_TOKEN` ngay lập tức (kiểm chứng trong `auth-rbac.integration.test.ts`).
- **Rate Limit (`rate-limit.ts`)**: `POST /api/auth/login` chặn `429 RATE_LIMITED` + header `Retry-After` theo `(ip)` và `(ip, email)` (kiểm chứng trong `password-rbac.unit.test.ts` & `auth-rbac.integration.test.ts`).

### 2.5. RBAC & Bảo vệ Tài nguyên Chéo người dùng (IDOR)
- **Ma trận 5 vai trò**: Đã kiểm chứng đầy đủ trên PostgreSQL 17.9 qua `auth-rbac.integration.test.ts`, `commerce.integration.test.ts` và `backoffice.integration.test.ts`:
  - `CUSTOMER` chỉ đọc/hủy đơn của chính mình; truy cập đơn của user khác (`GET /api/orders/:id`, `POST /api/orders/:id/cancel`) trả **`404 NOT_FOUND`** (không lộ sự tồn tại).
  - `ADMIN` không kế thừa giỏ hàng/checkout của `CUSTOMER` (`403 FORBIDDEN`), và `fn_manage_user` khóa bằng `pg_advisory_xact_lock` chống tự hạ quyền/vô hiệu hóa admin hoạt động cuối cùng (`409 LAST_ADMIN_PROTECTED`).
  - `WAREHOUSE` không xem được danh sách/chi tiết đơn hàng (`403`) và ledger không trả `shipping_address`/`recipient_phone`.
  - `SALES` và `MARKETING` bị chặn `403` chéo phân hệ và trang `/api/users`, `/api/admin/*`.

---

## 3. Điểm cần bổ sung trước Pilot / Production (Mức Low / Hardening)

1. **[LOW — SEC-01] Chưa có rate limit cho `POST /api/auth/register` và `POST /api/orders/checkout`**:
   - Endpoint đăng ký thực hiện Argon2id tốn CPU và endpoint checkout thực hiện transaction khóa DB chưa có limiter riêng (`T25`).
2. **[LOW — SEC-02] `trust proxy` và in-memory `Map` trong `rate-limit.ts`**:
   - Nếu chạy sau reverse proxy (Nginx/ALB) hoặc nhiều worker, `req.ip` sẽ dùng IP proxy nếu chưa cấu hình `app.set('trust proxy', ...)` và bucket in-memory sẽ không chia sẻ giữa các instance (`T25`).
3. **[LOW — SEC-03 / L-3] `audit_events.request_id = NULL` ở 4 hàm migration `013`**:
   - `fn_place_order`, `fn_cancel_order`, `fn_transition_order`, `sp_import_inventory` chưa nhận `p_request_id` như `015`/`016`/`018`/`019` (cần migration SQL mới, không sửa `013` đã áp dụng).
4. **[LOW — SEC-04] Token đã phát hành còn hiệu lực tối đa 30 phút sau logout phía client (`D-10`)**:
   - Logout chỉ xóa state bộ nhớ; để thu hồi tức thì cần cơ chế server logout tăng `token_version` hoặc token blocklist nếu PO thay đổi `D-10`.
5. **[LOW — SEC-05] Tách kết nối `report_ro_user` ở [server.ts](../backend/src/server.ts)**:
   - Hiện mọi endpoint dùng chung pool `app_rw_user`; đã an toàn nhờ `SECURITY DEFINER` kiểm role `MARKETING`/`ADMIN`, nhưng cần đồng bộ kiến trúc trước khi dùng read-replica (`T25`).
