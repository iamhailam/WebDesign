# Fashion Retail Project Foundation

Task 02 thiết lập monorepo chạy local trên Windows. Nghiệp vụ products/SKU/cart/checkout/voucher/orders và schema 22 bảng chưa được triển khai. [SPEC.md](SPEC.md) là nguồn gốc; thiết kế nằm trong [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [TASKS.md](TASKS.md) và [AGENTS.md](AGENTS.md).

## Công cụ và phiên bản

Đã kiểm chứng bằng PowerShell, Node 26.13.0, npm 11.20.0, Docker 29.9.3 và Docker Compose v5.7.0. Node 24 hoặc 26 được khai báo hỗ trợ; bản đã chạy thực tế là 26.13.0 (.node-version). Không yêu cầu nâng cấp Node toàn máy khi đã tương thích.

| Phần | Phiên bản khóa |
| --- | --- |
| React / React DOM | 19.3.1 |
| Vite / plugin-react | 7.3.8 / 5.2.0 |
| TypeScript / ESLint | 5.9.3 / 10.15.0 |
| React Router / TanStack Query | 7.18.6 / 5.108.1 |
| Tailwind CSS / Vite plugin | 4.3.5 / 4.3.5 |
| React Hook Form / resolvers / Zod | 7.92.0 / 5.9.2 / 4.6.7 |
| Express / pg / jsonwebtoken | 5.3.0 / 8.23.1 / 9.0.3 |
| PostgreSQL Docker / node-pg-migrate | 17.9-bookworm / 9.0.0 |
| Vitest | 4.1.12 |

Dependencies trực tiếp khóa exact, có package-lock.json và save-exact=true. Vite override 7.3.8 bảo đảm plugin/test runner dùng cùng bản, tránh xung đột types giữa Vite 7/8. ESLint 10 chọn do dòng 9 báo deprecated; không dùng TypeScript 7 ngoài miền peer hỗ trợ. Không chạy npm update hoặc audit fix --force.

shadcn/ui dùng dạng source component local: components.json, alias @/, CSS variables, cn và Button dựa trên Radix Slot/CVA; không phải một thư viện runtime shadcn có version riêng. React Hook Form + Zod resolver đã được cài cho task form sau; chưa tạo form nghiệp vụ giả.

## Chạy local trên Windows

Từ thư mục gốc, PowerShell:

```powershell
npm.cmd ci
npm.cmd run setup:env
npm.cmd run db:up
npm.cmd run db:migrate
npm.cmd run db:verify
npm.cmd run dev
```

Nếu npm PowerShell shim bị ExecutionPolicy chặn, dùng npm.cmd như trên. Không cần Bash, cp, export hoặc công cụ PostgreSQL trên host. Docker Desktop cần chạy Linux containers trước db:up.

setup:env chỉ tạo .env khi chưa tồn tại, sinh ngẫu nhiên credential **chỉ dùng local**, không in giá trị và không ghi đè cấu hình người dùng. .env.example cố ý để trống password/secret, không dùng nó làm cấu hình thật bằng cách copy rồi chạy ngay. .env bị gitignore; không commit hoặc gửi nội dung qua chat. Các biến môi trường đã có trên shell ưu tiên hơn .env.

Địa chỉ:

- Web: http://localhost:5173; trang kiểm tra API: http://localhost:5173/system.
- API: http://127.0.0.1:3000/api/health.
- PostgreSQL: 127.0.0.1:5432, database fashion_dev; runtime app_rw_user. Password do setup:env tạo trong .env.

Root dev dùng concurrently để chạy cả API và Vite; Ctrl+C dừng cả hai. Nếu cổng bận, đổi PORT/FRONTEND_ORIGIN/DB_PORT trong .env và cấu hình Vite tương ứng. Vite cố định 5173/strictPort để không lặng lẽ đổi origin; proxy /api tự theo PORT backend.

## Scripts

| Lệnh từ root | Chức năng |
| --- | --- |
| npm.cmd run dev | Backend tsx watch + frontend Vite |
| npm.cmd run build | Backend tsc→dist, frontend tsc noEmit + Vite→dist |
| npm.cmd run lint | ESLint toàn bộ code/config, max-warnings=0 |
| npm.cmd run typecheck | TS strict cả src/tests/config hai workspaces |
| npm.cmd test | Backend HTTP/JWT tests và frontend routes/health contract |
| npm.cmd run db:up | Compose PostgreSQL, chờ healthy |
| npm.cmd run db:down | Dừng service/network, **giữ volume** |
| npm.cmd run db:migrate | node-pg-migrate up từ database/migrations |
| npm.cmd run db:migrate:down | Rollback một migration, chỉ chạy trên DB phù hợp |
| npm.cmd run db:verify | DB tạm riêng, SQL up/down + PL/pgSQL, tự cleanup |
| npm.cmd run start --workspace backend | Chạy backend đã build |
| npm.cmd run preview --workspace frontend | Preview frontend build; không dùng làm production server |

Frontend preview local kế thừa proxy /api từ server config (đã kiểm HTTP qua cổng 4173). Khi deploy file tĩnh cần reverse proxy cùng origin /api, hoặc build VITE_API_BASE_URL trỏ API và cấu hình CORS origin phù hợp; preview không phải production server. Vite build chỉ đưa biến VITE_* vào browser; tuyệt đối không đưa password/JWT secret vào VITE_*.

## Health và error envelope

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod http://127.0.0.1:3000/api/health/ready
Invoke-RestMethod http://localhost:5173/api/health
```

GET /api/health và /api/health/live là liveness HTTP 200, không query DB. GET /api/health/ready dùng pg Pool SELECT 1: HTTP 200 khi kết nối được, 503 khi DB không sẵn sàng; không trả host/password/version. Readiness endpoint chỉ phục vụ local hiện tại; deployment sau phải giới hạn truy cập bằng ingress theo API_CONTRACT.

```json
{"success":true,"data":{"status":"ok","service":"fashion-api"},"meta":{"request_id":"22222222-2222-4222-8222-222222222222"}}
```

```json
{"success":false,"message":"Không tìm thấy tài nguyên.","error":{"code":"NOT_FOUND","details":{}},"meta":{"request_id":"22222222-2222-4222-8222-222222222222"}}
```

X-Request-ID do server sinh; unknown API404, JSON sai400, payload quá lớn413, CORS origin ngoài allowlist403, DB unavailable503 dùng cùng envelope. Middleware Zod đã có để dùng ở task tiếp; JWT helper chỉ kiểm chữ ký HS256, issuer/audience/exp/max-age và cấu trúc claims. Chưa có login/register/RBAC/lookup actor DB; **không dùng helper JWT riêng lẻ để bảo vệ route nghiệp vụ** trước T04.

## Database và migration

Compose bind cổng vào loopback, volume giữ dữ liệu qua restart/down. Init script chạy **chỉ khi volume rỗng**: tạo runtime app_rw_user không superuser và không quyền CREATE schema/tables, đủ kết nối và SELECT 1. db_admin là bootstrap superuser local của image, chỉ dành migration/verification; backend Pool chỉ dùng app_rw_user. T03 sẽ thiết kế owner/grants production theo quyết định D-07; không coi bootstrap local là cấu hình production.

Migration tooling lấy MIGRATION_DATABASE_URL nếu được cấu hình, nếu không dùng db_admin + POSTGRES_PASSWORD local. Backend chỉ parse allowlist biến runtime và không sử dụng migration credential. Không dùng runtime credential để chạy migration.

database/migrations hiện rỗng có chủ ý; db:migrate xác nhận kết nối/runner và tạo metadata pgmigrations, chưa tạo bảng nghiệp vụ. SQL chuẩn node-pg-migrate 9 dùng một file .sql với marker `-- Up Migration` / `-- Down Migration`; runner quản lý transaction, không viết COMMIT trong function. Fixture database/tests/fixtures/001_foundation_probe.sql chỉ chạy bởi db:verify trên DB tên foundation_verify_<random>, tạo một bảng probe, kiểm up/down rồi xóa DB tạm; không đụng bảng nghiệp vụ hay dữ liệu thật. Không dùng loader alpha từ tài liệu phiên bản khác.

Không xóa volume để “sửa nhanh” mật khẩu: init không chạy lại nếu volume có dữ liệu. Giữ .env đã tạo, hoặc đổi password bằng thao tác quản trị có chủ đích và cập nhật cấu hình. db:down không dùng --volumes. Remote DB/production cần quyền CREATE DATABASE riêng để chạy db:verify, TLS và chính sách secrets riêng; spike này được kiểm chứng ở local Docker.

## Cấu trúc

```text
backend/src/{auth,config,http,middlewares}/
backend/src/app.ts / server.ts
backend/tests/
frontend/src/{components/ui,lib,pages}/
frontend/src/app.tsx / main.tsx / styles.css
frontend/tests/
database/{init,migrations,seeds,tests/fixtures}/
scripts/             environment, setup-env, migration, verification
docs/                đặc tả và thiết kế sẵn có
```

Hai workspaces npm backend/frontend; database là thư mục SQL, runner tooling ở root. Ảnh/DOCX và tài liệu gốc giữ tại vị trí hiện có. Không copy dữ liệu mẫu thành sản phẩm chưa được duyệt.

## Kiểm chứng và giới hạn hiện tại

Kết quả lệnh và endpoint thực tế được ghi ở [docs/FOUNDATION_VERIFICATION.md](docs/FOUNDATION_VERIFICATION.md). Test HTTP unit sử dụng Supertest và dependency DB kiểm soát; readiness qua server thật và db:verify là kiểm chứng PostgreSQL thực, không dùng mock để khẳng định kết nối DB.

npm audit --omit=dev hiện không có vulnerability. Audit toàn bộ còn 3 moderate theo chuỗi node-pg-migrate→glob/minimatch (development tooling); không nhận glob pattern từ request. Không áp downgrade/override major tự động để làm mất cảnh báo; cần theo dõi upstream trước khi dùng pipeline migration với nguồn file không tin cậy. Build có thể báo annotation warning từ source Zod; không thay đổi package đã khóa chỉ để ẩn warning.

T01 và các chính sách giá/SKU/voucher/RBAC còn pending không bị tự đánh dấu đã duyệt bởi việc dựng foundation. User đã cho phép T02 cụ thể; không phụ thuộc việc chốt toàn bộ nghiệp vụ để chạy skeleton. Không có checkout, thanh toán online, marketplace, AI, multi-warehouse hoặc schema nghiệp vụ trong task này.
