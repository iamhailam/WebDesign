# Kiểm chứng Task 02 Project Foundation

Ngày 20/11/2026, Asia/Bangkok. Thực hiện trên Windows/PowerShell tại C:\Đồ án CSDL. Kết quả là foundation chạy local, không phải nghiệm thu ứng dụng bán hàng hoặc production deployment.

## 1. Phạm vi hoàn thành

- npm workspaces backend/frontend, database SQL, exact dependencies và lockfile; Node/npm hiện có không bị cài lại/nâng cấp toàn máy.
- Frontend React/Vite/TypeScript, React Router với Home/System/404, Tailwind Vite plugin, shadcn/ui local Button/aliases/theme, TanStack Query gọi health. RHF + Zod resolver đã cài để dùng ở task form sau, chưa thêm form nghiệp vụ.
- Backend Express/TypeScript, pg Pool, env Zod validation, middleware body validation, error envelope/request ID, CORS allowlist/Helmet và JWT verification primitive. Không login/register, role DB actor lookup hoặc business route.
- PostgreSQL 17.9 qua Compose; bootstrap runtime role không superuser. Runner node-pg-migrate 9 raw SQL và up/down spike trên database tạm.
- .env.example không có credentials; setup:env sinh .env local bị ignore, không ghi đè file sẵn có hoặc in secret. README PowerShell và scripts đầy đủ.

## 2. Công cụ đã kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| git status --short | Repo có sẵn, giữ nguyên các tài liệu untracked từ task trước; không init lại, không commit |
| node --version | v26.13.0 |
| npm.cmd --version | 11.20.0 |
| docker --version | 29.9.3 |
| docker compose version | v5.7.0 |
| docker info --format '{{.ServerVersion}}' | 29.9.3, daemon hoạt động |
| npm.cmd view ... và registry metadata | Kiểm tra stable versions, engines và peer ranges trước khi khóa manifest; không npm update |

psql host chưa có trong PATH; kiểm DB bằng pg và psql trong container. Docker đã có tại lần kiểm tra này, khác snapshot WORKSPACE_AUDIT cũ.

## 3. Lệnh cài đặt và kiểm tra chính

| Lệnh đã chạy | Kết quả cuối |
| --- | --- |
| docker pull postgres:17.9-bookworm | Thành công; image digest sha256:47f917f7409eacd22fc5dfb1dee634e1b55cf0c01d1a7eb701be2227a03e0641 |
| npm.cmd install | Thành công, package-lock sinh và cập nhật đúng manifests; không audit fix --force |
| npm.cmd install-scripts approve esbuild | Cho phép đúng esbuild@0.28.2, lưu pinned approval để ci tái lập |
| npm.cmd ci | Exit0; 461 packages installed, 470 audited; lockfile dùng được khi cài sạch |
| node scripts/setup-env.mjs | Tạo .env local, không in giá trị; create-only |
| docker compose config --quiet | Exit0, Compose hợp lệ; không in config chứa passwords |
| docker compose up -d --wait postgres | Exit0, service healthy, bind 127.0.0.1:5432 |
| npm.cmd run db:migrate | Exit0; 0 SQL migrations nghiệp vụ được áp dụng, metadata pgmigrations được tạo |
| npm.cmd run db:verify | Exit0; SQL up/down, rollback fixture và PL/pgSQL đạt trên DB tạm, DB tạm được xóa sau kiểm tra |
| npm.cmd run build | Exit0 cả hai workspaces; backend dist và frontend dist được tạo |
| npm.cmd run lint | Exit0, max-warnings=0 |
| npm.cmd run typecheck | Exit0 TS strict cho src/tests/config hai workspaces |
| npm.cmd test | Exit0; 3 test files, **9 tests passed** (backend6, frontend3) |
| npm.cmd ls vite eslint --all | Một Vite7.3.8 được dedupe/override cho plugin và Vitest; ESLint10.15.0 |
| npm.cmd run dev | Cả tsx watch API3000 và Vite5173 start thành công; đã gọi HTTP thực tế |
| npm.cmd run start --workspace backend | Backend đã build chạy bằng Node, health/readiness thật đạt |
| npm.cmd run preview --workspace frontend -- --port 4173 --strictPort | Preview build start; deep-link và API proxy HTTP đạt |
| npm.cmd audit --omit=dev | Exit0, 0 vulnerabilities runtime |
| npm.cmd audit --json | 3 moderate trong development tooling, chi tiết mục 6 |
| git check-ignore .env | .env được ignore |
| git diff --check | Exit0; Git có thông báo LF/CRLF với .gitignore theo cấu hình host, không whitespace error |

Các lần kiểm tra đầu phát hiện lỗi frontend types do đồng thời Vite7 và Vite8 trong tree. Đã khóa override Vite7.3.8 thống nhất rồi chạy lại build/lint/typecheck/test và ci; kết quả cuối ở bảng trên. ESLint9 bị upstream đánh dấu deprecated nên chuyển ESLint10 tương thích; jest-dom6.10.0 bị đánh dấu incorrect release nên pin6.9.1. Không dùng suppress TypeScript để che lỗi và không thay đổi package nghiệp vụ có sẵn (trước task chưa có manifest).

## 4. HTTP endpoint thực tế

Các kiểm tra dùng Node fetch + assert vào process đang listen thật, không phải response mock:

| Trường hợp | URL / thao tác | Kết quả |
| --- | --- | --- |
| Liveness dev và compiled | GET http://127.0.0.1:3000/api/health | 200 success=true, data.status=ok, service=fashion-api, UUID request_id |
| Alias liveness | GET /api/health/live | 200, không query DB |
| Readiness DB thật | GET /api/health/ready | 200 data.status=ready, database=up qua pg Pool SELECT1 |
| Error route | GET /api/missing | 404 success=false, error.code=NOT_FOUND, meta.request_id |
| SPA dev deep-link | GET :5173/, /system, /unknown | 200 HTML root, để React Router xử lý client route/404 |
| Proxy dev | GET :5173/api/health | 200 JSON từ Express |
| SPA build deep-link | GET :4173/, /system, /unknown | 200 HTML build; không server404 khi reload route |
| Proxy preview | GET :4173/api/health | 200; Vite preview kế thừa proxy server config |
| Outage thật | docker compose stop postgres, gọi API | Liveness200, readiness503 DATABASE_UNAVAILABLE, response không chứa credential/SQL |
| Phục hồi | docker compose up -d --wait postgres, cùng API process | Readiness tự phục hồi200, không restart API |

Test HTTP unit còn kiểm malformed JSON400, CORS403, envelope an toàn khi DB exception chứa dữ liệu nhạy cảm. JWT tests kiểm chữ ký/claims, audience sai, expiry, tampered token và role không hợp lệ. Frontend integration tests dùng jsdom xác nhận route, response Zod không đúng không được hiển thị success và trang404 có đường về.

Không có browser automation khả dụng trong phiên (inventory trình duyệt rỗng); chưa xác nhận hình ảnh bằng trình duyệt thật. Điều này không được thay bằng tuyên bố kiểm visual QA. Đã có build, React integration và HTTP deep-link/proxy; responsive/accessibility/E2E đầy đủ thuộc task sau.

## 5. Kiểm DB và bảo toàn dữ liệu

Pool kết nối thật trả current_user=app_rw_user, rolsuper=false, has_schema_privilege(public,CREATE)=false. Role db_admin của Docker image là bootstrap superuser **chỉ local** cho migration/verification; không cấp cho backend. Production owner/grants còn thuộc T03, không nghiệm thu trong T02.

SELECT server_version trả 17.9 (Debian 17.9-1.pgdg12+1). pg:verify chạy DO block LANGUAGE plpgsql và SQL marker up/down bằng node-pg-migrate9. Trong fashion_dev sau kiểm tra chỉ có public.pgmigrations; bảng probe chỉ nằm ở DB tạm đã cleanup. Không tạo 22 bảng nghiệp vụ, seeds sản phẩm hoặc migration domain.

Đã so SHA-256 ảnh, DOCX, SPEC và audit với baseline trước task; giữ nguyên nội dung. Các tài liệu thiết kế chỉ được cập nhật ghi chú trạng thái foundation/health và D-12, không duyệt ngầm quyết định nghiệp vụ. .gitignore được bổ sung chú thích, giữ các ignore rules sẵn có. Không commit/push, không xóa hoặc di chuyển ảnh.

Đã kiểm frontend dist không chứa giá trị DB_PASSWORD/POSTGRES_PASSWORD/JWT_SECRET từ .env local. .env không nằm trong Git status và không link trong báo cáo.

## 6. Cảnh báo và giới hạn

Audit full còn 3 moderate theo node-pg-migrate9→glob/minimatch: GHSA-3g3m-2fjr-6pw4 và GHSA-g3hv-75wg-m249. Chỉ tool migration dev dùng, patterns/file source do repository quản lý; không nhận pattern từ HTTP. npm gợi ý downgrade major node-pg-migrate7.6.1; chưa áp tự động vì đổi contract/toolchain ngoài nhu cầu. Theo dõi upstream; không tuyên bố đã xử lý 3 cảnh báo. Audit --omit=dev=0 không có nghĩa mọi cấu hình production đã an toàn.

Build còn hai warning annotation từ comment @__PURE__ trong Zod4.6.7; Rollup bỏ annotation và build thành công. Đã lazy-load system route và tách chunks React/router/query, không nâng chunkSizeWarningLimit để che warning. Không benchmark hiệu năng thương mại ở task này.

JWT primitives không thay authentication/RBAC đầy đủ T04. Chưa có DB schema/grants production T03, business transaction, TLS deployment, rate-limit production, benchmark, backup/restore/UAT. T01 quyết định kinh doanh vẫn pending; yêu cầu T02 mới cho phép triển khai foundation độc lập.

## 7. Trạng thái cuối phiên và chạy lại

Đã dừng tiến trình dev và compiled API/preview sau kiểm tra, nên cổng3000/5173/4173 không được coi là đang phục vụ tiếp. PostgreSQL vẫn healthy, volume được giữ lại; không chạy down --volumes.

Chạy lại từ PowerShell: npm.cmd run db:up rồi npm.cmd run dev. Xem [README](../README.md) về .env, cổng, troubleshooting và migration. Không cần cài lại nếu node_modules/lockfile vẫn nguyên; cài sạch dùng npm.cmd ci.

Tham khảo kỹ thuật đã đối chiếu: [Vite](https://vite.dev/guide/), [Tailwind với Vite](https://tailwindcss.com/docs/installation/using-vite), [shadcn/ui Vite](https://ui.shadcn.com/docs/installation/vite). Trang node-pg-migrate hiện có tài liệu loader alpha10; implementation task này dựa runner9 đã cài và kiểm bằng SQL fixture thực tế.
