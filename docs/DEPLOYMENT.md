# Production deployment

Ngày 20/11/2026, Asia/Bangkok — Task 15 của người dùng, tương ứng phần chuẩn bị `T25` trong [TASKS](../TASKS.md); không phải `T15` Design System của backlog gốc. Chưa tạo tài nguyên cloud, chưa deploy, chưa phê duyệt chi phí. Kết quả kiểm chứng và cổng còn mở: [FINAL_HANDOVER](FINAL_HANDOVER.md). Runbook sự cố/backup/rollback: [OPERATIONS](OPERATIONS.md).

## 1. Phương án hosting và chi phí

Đối chiếu nguồn chính thức ngày 20/11/2026. Giá USD/tháng chỉ là giá tham khảo, chưa gồm VAT, domain, egress vượt hạn mức, log lưu dài hạn, lưu backup ngoài hệ thống, staging hoặc instance phục hồi. Xác nhận lại báo giá khi phê duyệt.

| Lựa chọn | Chi phí tham khảo | Backup/rollback | Cấu hình và công vận hành |
| --- | --- | --- | --- |
| Cloudflare Pages, static SPA | Static requests miễn phí; Free 500 builds/tháng, 1 build đồng thời | Giữ artifact theo revision, rollback deployment còn lưu; không backup DB | Phù hợp Vite, CDN/HTTPS, `_headers`/`_redirects`; cấu hình API URL lúc build và preview tách môi trường |
| Vercel | Hobby $0 chỉ dành cá nhân, phi thương mại; Pro từ $20/tháng, thêm usage/seat theo gói | Promote deployment cũ và giữ artifact; không backup DB | Monorepo/Git preview tiện; cửa hàng thương mại cần ngân sách Pro, cấu hình `frontend/vercel.json` |
| Render backend | Paid web compute nhỏ từ $7/tháng, 512 MB; sizing phải đo tải thật | Rollback application revision; filesystem tạm không dùng lưu DB/dump | HTTPS/log/health tích hợp, ít quản trị OS; 1 instance khi limiter còn ở memory |
| VPS backend | Ví dụ DigitalOcean từ $4/tháng ở cấu hình nhỏ nhất; nên dự trù cấu hình lớn hơn sau đo tải | Tự giữ image/release; snapshot VPS không thay backup PostgreSQL | Tự vá OS, firewall, TLS, reverse proxy, restart, monitor; chỉ chọn khi có người vận hành |
| Render PostgreSQL paid | Compute từ $6/tháng, storage tính thêm theo gói | PITR: Hobby workspace 3 ngày, Pro trở lên 7 ngày; logical export; restore tạo instance khác | Chọn PG17, kiểm `CREATE ROLE`, ownership/`SET ROLE`, TLS, connection cap trên staging trước mua/chuyển dữ liệu |

Nguồn: [Cloudflare static pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Vercel pricing và điều kiện Hobby](https://vercel.com/pricing), [Render pricing](https://render.com/pricing), [Render DB pricing](https://render.com/articles/managed-postgresql-pricing-2026), [Render backups](https://render.com/docs/postgresql-backups), [VPS pricing](https://www.digitalocean.com/pricing/droplets).

**Khuyến nghị để PO/Ops duyệt:** Pages static + Render paid API + Managed PostgreSQL paid cùng region với API, ưu tiên region gần Việt Nam nếu gói hỗ trợ. Mức sàn tính toán khoảng $13/tháng (0+7+6), không phải ngân sách đủ cho production có tải. Dùng Vercel Pro thay Pages nâng sàn lên khoảng $33/tháng. Cần cộng staging, storage, backup ngoài nhà cung cấp và headroom tải; chưa khẳng định gói nhỏ nhất đáp ứng PRD. VPS có thể giảm tiền compute nhưng tăng công trực vận hành; managed DB vẫn được khuyến nghị.

Render Free ngủ khi idle, DB free hết hạn và thiếu recovery; tài liệu nhà cung cấp không khuyến nghị cho production. [Render Free limitations](https://render.com/docs/free). Không thay mô hình SQL hiện có bằng DB REST/service-role hoặc chạy Express trên Pages Functions.

## 2. Mô hình triển khai

```text
Browser --HTTPS--> shop.<domain> (Pages hoặc Vercel, frontend/dist)
Browser --HTTPS--> api.<domain> (Render hoặc VPS proxy --> Express)
Express --TLS verify-full--> Managed PostgreSQL 17 (app_rw_user)
Ops/migration job --TLS verify-full--> PostgreSQL (db_admin)
Ops backup --> encrypted storage ngoài backend và ngoài repository
```

Dev/staging/production dùng DB, credentials, domain riêng. API không phục vụ `/media`/`/images`: assets đi cùng frontend static output. Preview không kết nối production DB/API; single-origin CORS hiện chỉ nhận đúng một frontend origin. Dùng staging domain cố định, không wildcard toàn bộ `*.vercel.app`/`*.pages.dev`.

## 3. Production README: build và start

Đứng tại root repository. Node `26.13.0`, npm `11.20.0`, PG17 đã kiểm local. Dùng lockfile, không `npm update`/schema sync. PowerShell dùng `npm.cmd`; Linux dùng `npm`.

```powershell
npm.cmd ci
$env:VITE_API_BASE_URL='https://api.<domain>/api'
npm.cmd run build
$env:EXPECTED_API_BASE=$env:VITE_API_BASE_URL
npm.cmd run build:verify
Remove-Item Env:VITE_API_BASE_URL
Remove-Item Env:EXPECTED_API_BASE
```

`frontend/dist` là toàn bộ static output; `backend/dist/server.js` là entry runtime. `VITE_API_BASE_URL=/api` chỉ đúng khi đã có reverse proxy cùng origin `/api`. Với hosting tách origin như khuyến nghị, build bằng URL HTTPS tuyệt đối kết thúc `/api`, không slash cuối. Đổi biến frontend cần build lại. Không dùng `vite dev`, `vite preview`, `tsx watch` hay `npm run dev` làm production server.

Build xuất `frontend/dist/api-config.json` chứa API base đã nhúng, tên chunk chứa API client và SHA-256 của chunk. `build:verify` kiểm cấu hình mong đợi với manifest và JavaScript thực tế; không chỉ kiểm một file text mô tả endpoint. Domain trong ví dụ phải được thay bằng domain đã duyệt; production build/release từ chối `example.com` và mọi subdomain của nó.

Backend native, từ root checkout đúng revision và secrets được inject:

```sh
npm ci
npm run build --workspace backend
npm run start --workspace backend
```

Build cần dev dependencies; runtime không cần migration tooling. Hoặc build [Dockerfile](../Dockerfile) từ root: multi-stage, Node pin exact, runtime `USER node`, cài dependency workspace backend với `--omit=dev`, không copy `.env`, SQL, ảnh gốc hay tests vào image.

```sh
docker build -t fashion-api:<revision> .
docker run -d --name fashion-api --restart unless-stopped --env-file /etc/fashion/runtime.env -p 127.0.0.1:3000:3000 fashion-api:<revision>
```

Đây là lệnh cho Ops sau phê duyệt. File secret ngoài repo, quyền đọc chỉ tài khoản vận hành. Với Docker bridge trên VPS, `HOST=0.0.0.0` bên trong container, chỉ publish host loopback; `PORT=3000`.

## 4. Environment variables

Template được track: [.env.production.example](../.env.production.example). Chỉ copy **từng nhóm key** vào đúng secret store. Backend và migration tooling không đọc `.env` local khi process `NODE_ENV=production`; phải thiết lập biến này từ service manager trước khi start. Template để trống secrets, không chạy được ngay.

| Biến | Phạm vi | Cấu hình production |
| --- | --- | --- |
| NODE_ENV | API/migration | `production` |
| HOST / PORT | API | Render/container `0.0.0.0`, PORT do platform cấp; native VPS `127.0.0.1` sau Nginx |
| FRONTEND_ORIGIN | API | Chính xác `https://shop.<domain>`, không path/slash cuối/credentials; chỉ một origin |
| DB_HOST / DB_PORT / DB_NAME | API | Endpoint/cổng/database managed thực; không dùng DATABASE_URL mặc định của platform thay cho nhóm này |
| DB_USER / DB_PASSWORD | API secret | `app_rw_user` và password riêng, tuyệt đối không provider admin |
| DB_SSL_MODE / DB_SSL_CA | API | Bắt buộc `verify-full`; CA PEM nếu cần, hỗ trợ literal `\n`; không `require`/`disable` ở production |
| DB_POOL_MAX | API | Mặc định 10, range 1..50; budget bên dưới |
| TRUST_PROXY | API | 0..5 hops; chỉ đặt sau khi kiểm đường đi thực, không mặc định coi mọi platform là 1 |
| LOG_REQUESTS | API | Mặc định true ở production, JSON stdout; không chứa body/header/query/URL thô |
| READINESS_TOKEN | API + monitor secret | Random ≥32 ký tự; monitor gửi `X-Readiness-Token`, không đưa frontend |
| JWT_SECRET | API secret | Random ≥32 ký tự, khuyến nghị 48 random bytes; thay key làm token hiện tại vô hiệu |
| JWT_ISSUER / JWT_AUDIENCE | API | `fashion-api` / `fashion-web`, đồng nhất toàn instance |
| MIGRATION_DATABASE_URL | Chỉ job/operator | Login `db_admin`/migrator được kiểm soát, không nằm trong runtime environment |
| MIGRATION_SSL_CA | Chỉ job/operator | CA PEM nếu nhà cung cấp cần; runner production luôn xác minh certificate/hostname |
| VITE_API_BASE_URL | Frontend build, PUBLIC | `https://api.<domain>/api`; bất kỳ `VITE_*` nào đều có thể đọc từ browser |
| PRODUCTION_API_BASE | GitHub repository variable, PUBLIC | Nguồn duy nhất cho CI/release; URL HTTPS thật kết thúc `/api`, không example.com; không chỉ đặt ở environment production |

Không đưa `POSTGRES_PASSWORD`, `MIGRATION_*`, `DB_PASSWORD`, JWT/readiness token vào hosting frontend. Không log/dán secrets, không upload `.env` vào CI artifacts. Sinh secret bằng secret manager hoặc Node crypto trên máy vận hành rồi lưu trực tiếp vào vault; không lưu trong Git, issue hay screenshot.

Connection budget: `(số replica đang chạy + replica rollout) × DB_POOL_MAX + migration/backup/monitor + reserved admin < provider max_connections`. Ví dụ 1 replica + 1 rollout với pool10 đã cần tối thiểu 20 kết nối API, chưa gồm Ops. Backend hiện dùng một pool `app_rw_user`, báo cáo qua actor-checked functions; không cấu hình `report_ro_user` vào `DB_USER`. Vai trò report chỉ dành aggregate views, không gọi được auth/commerce APIs. Giới hạn kiến trúc được ghi trong [DECISIONS](DECISIONS.md).

## 5. HTTPS, CORS, headers, health

TLS HTTP kết thúc ở hosting/ingress; redirect HTTP→HTTPS và kiểm chứng certificate/renewal. Backend Helmet + body64KiB + `no-store`; frontend có [Vercel config](../frontend/vercel.json), [Pages headers](../frontend/public/_headers), [SPA redirects](../frontend/public/_redirects). CSP chặn inline scripts/objects/frame; `style-src unsafe-inline` còn cần cho UI. Trước go-live thay `connect-src 'self' https:` trong cả hai cấu hình thành `connect-src 'self' https://api.<domain>`. Chỉ dùng HSTS `includeSubDomains` khi mọi subdomain liên quan đã có HTTPS.

`TRUST_PROXY` phải khớp topology, proxy cuối overwrite forwarded headers, chặn đường đi thẳng có ít hops hơn. Xem [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/). Không bật `trust proxy=true`. Default rate limits mỗi IP/process: login30/15 phút và IP+account10/15 phút, register5/phút, checkout30/phút; response429 + Retry-After. Limiter memory reset khi restart; **chưa cho horizontal scaling** nếu chưa có limiter chung/ingress được kiểm chứng. Edge/CDN limit không thay DB invariants.

Liveness `/api/health/live` public200, không query DB; Docker/Render health path mặc định này chỉ phát hiện process HTTP. Readiness `/api/health/ready` cần token ở production, thiếu/sai trả404 không query DB; DB lỗi503, drain503, thành công200. Monitor riêng phải kiểm readiness có header, không dùng liveness làm bằng chứng DB healthy. Pool connect timeout3s, statement5s, client query8s; thời gian đợi pool vẫn cần theo dõi dưới tải. HTTP request15s/header10s/keepalive5s; shutdown drain tối đa10s. Readiness200 chỉ xác nhận kết nối, không thay SQL privilege/smoke nghiệp vụ.

## 6. Managed database bootstrap và migration

1. Ops được duyệt tạo DB **trống**, PG17, TLS, firewall/private endpoint, backup/PITR; xác nhận account có thể tạo 3 roles và `SET ROLE db_admin`. Các role là cluster-wide: dành cluster riêng hoặc bảo đảm tên không xung đột ứng dụng khác. Không tự demote provider admin để ép compatibility.
2. Kết nối bằng `psql`17 với service/pgpass bảo mật; chạy [production-bootstrap.sql](../database/production-bootstrap.sql) bằng provider administrator trên đúng DB trống. Script kiểm role attributes/membership, thu hồi quyền DB PUBLIC, cấp runtime CONNECT, db_admin CREATE trong DB/public. Đặt password bằng `\password db_admin` và `\password app_rw_user` qua terminal riêng; không đưa password vào SQL. `report_ro_user` chưa cần credential.
3. Migration job chỉ nhận `MIGRATION_DATABASE_URL` cùng CA, chạy dưới `db_admin` không superuser/CREATEROLE; runner metadata nằm `public.pgmigrations`. Không truyền provider admin cho backend. Bootstrap local Docker vẫn là superuser, không phải cấu hình production đã kiểm chứng.
4. Backup/export và lưu revision + migration list trước upgrade; thử trên staging/restored clone trước. Chỉ một migration job, runner giữ advisory lock và check order; không tắt lock. Migrations `001`–`019` nguyên trạng, append migration mới cho mọi thay đổi schema; schema không tự migrate khi API start.

```sh
# NODE_ENV và migration secret đã được inject riêng vào operator/job environment
npm ci
npm run db:migrate
# psql service fashion_owner do Ops cấu hình ngoài repo
psql 'service=fashion_owner' -X -v ON_ERROR_STOP=1 -f database/verify-production.sql
```

Upgrade giữ tương thích code N/N−1 bằng expand→deploy→backfill có kiểm soát→contract ở release sau; review lock/timeout với DDL lớn. Bản `001` có `SET LOCAL ROLE db_admin`, do đó không thể chỉ thay URL bằng account bất kỳ rồi kỳ vọng quyền đúng. Sau restore `--no-acl`, chạy [roles_backup.sql](../database/roles_backup.sql) rồi verify; script đã thu hồi trên **ALL ROUTINES** gồm procedures. Không cấp direct DML cho runtime để sửa lỗi deploy. Không chạy demo seed, db:test, db:verify, benchmark hoặc restore drill trên production. Down migration production bị runner chặn; xem rollback runbook.

`npm.cmd run db:permissions:verify` đã kiểm bootstrap +19 migrations bằng `db_admin` không superuser trên cluster Docker riêng, cùng runtime/report login identities và allow/deny. Cluster test dùng trust auth chỉ loopback, tự xóa sau chạy; không chứng minh password/TLS/network của managed provider.

## 7. Thiết lập hosting sau phê duyệt

**Cloudflare Pages:** chọn project static, root repo; build `npm ci && npm run build --workspace frontend`, output `frontend/dist`, Node/npm đúng phiên bản nếu build image hỗ trợ. Nếu toolchain host chưa hỗ trợ runtime đã pin, dùng artifact CI đã build để Direct Upload. `_headers`/`_redirects` nằm trong dist; kiểm deep link `/products/...`, `/account/orders/...`, `/admin/...`. Không dùng Functions hoặc binding DB. Manual Direct Upload có thể dùng dashboard kéo thư mục static đã giải nén; không upload cả bundle backend/SQL.

**Vercel:** Root Directory `frontend`, bật include source ngoài root cho monorepo; install `cd .. && npm ci`, build `cd .. && npm run build --workspace frontend`, Output `dist`. Cấu hình `frontend/vercel.json` đã có install/build/output tương ứng; test bằng preview trước promotion. Chọn Node/npm tương thích, khai báo public API URL cho từng environment. Production Auto Deploy phải tắt đến khi PO/Ops duyệt quy trình release.

**Render:** Web Service Docker, Dockerfile ở root, context root; chọn branch/revision đã kiểm, 1 instance, runtime env §4, health path `/api/health/live`. Managed DB và API cùng region; xác minh hostname TLS trên endpoint chọn dùng. Không cấu hình migration credential hoặc seed trong service; migrate bằng operator/job tách biệt trước promotion. Native build thay thế: `npm ci && npm run build --workspace backend`; Start `npm run start --workspace backend`, cần bảo đảm Node/npm pin đúng. Tắt auto-deploy trước lần phát hành được duyệt. [Render Express deployment](https://render.com/docs/deploy-node-express-app).

**VPS:** build image đúng revision, chạy loopback như §3; Nginx listen443/TLS và port80 redirect, proxy tới127.0.0.1:3000, overwrite `X-Forwarded-For` bằng `$remote_addr` khi chỉ có một proxy, `X-Forwarded-Proto=$scheme`, Host đã validate. Giới hạn body64k, timeout proxy ≥15s; firewall không mở3000/5432 ra Internet. Cấu hình log proxy bỏ query string/body/header/PII, rotate log; tự động restart và cảnh báo disk/TLS/5xx. Ops phải kiểm `nginx -t` và smoke trên staging trước áp dụng. Có CDN phía trước thì phải review lại trusted chain và client IP.

## 8. CI/CD và thứ tự phát hành

[ci.yml](../.github/workflows/ci.yml) chạy push main/PR/manual: `npm ci`, lint, strict types, build, DB thật Compose, schema/concurrency/API/UI tests, SQL up/down probe, restore drill, runtime audit, Docker build. Actions pin SHA; quyền `contents:read`, không cloud secrets, DB test riêng. Unit/component tests luôn dùng `VITE_API_BASE_URL=/api` qua Vitest test environment, kể cả parent process đang đặt URL production; các test API client riêng vẫn kiểm HTTPS bằng override có kiểm soát.

Nguồn build là **repository variable `PRODUCTION_API_BASE`**. CI thường chưa có biến này sẽ build `/api` và xuất `build-<sha>`; nếu đã có thì validate trước khi build. Không fallback sang domain example. Bước build override VITE_API_BASE_URL bằng output đã validate, các bước tests vẫn `/api`. `npm run build:verify` chạy sau build và sau copy artifact, trước checksum/upload.

[release.yml](../.github/workflows/release.yml) là **continuous delivery có bước deploy thủ công**: chỉ workflow_dispatch trên main với `release_approved=true`. Job `configuration` không dùng environment production: nó đọc repository variable một lần, validate bắt buộc URL HTTPS thật rồi truyền output vào reusable CI với `release_build=true`. Thiếu URL, `/api`, HTTP, example.com/subdomains, credentials, query/fragment hoặc path khác `/api` đều bị từ chối trước build. URL được chuẩn hóa một lần; không có endpoint production mặc định.

CI release xuất `release-<sha>` cùng REVISION/PUBLIC_API_BASE/SHA256SUMS và `frontend/api-config.json`, retention14 ngày; outputs gồm API base đã build và tên artifact. Job `handoff` qua environment `production` để approval, download đúng artifact, kiểm checksum và đối chiếu URL từ output quality với manifest, compiled chunk và PUBLIC_API_BASE. Nó **không đọc lại** PRODUCTION_API_BASE từ environment production, nên environment override hoặc thay đổi variable sau validation không đổi URL của artifact đang bàn giao. Workflow không gọi API cloud, migrate remote, publish hoặc tạo dịch vụ. Không tuyên bố đã có automated cloud deployment.

Nguyên nhân run44628702888 ở commit dfff0cb: URL build bị đặt ở cấp job nên tràn vào test đang kỳ vọng `/api/health`. Cấu hình hiện tại tách hai phạm vi, có regression tests cho test isolation, HTTPS client, release validation và artifact mismatch. Workflows sửa trong đợt này chưa được push/dispatch trên GitHub.

Kiểm lại local từ root:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
$env:VITE_API_BASE_URL='https://api.<domain>/api'
npm.cmd test --workspace frontend
npm.cmd run build
$env:EXPECTED_API_BASE=$env:VITE_API_BASE_URL
npm.cmd run build:verify
Remove-Item Env:VITE_API_BASE_URL
Remove-Item Env:EXPECTED_API_BASE
```

Frontend tests vẫn dùng `/api` ở test profile; regression tests chủ động kiểm thêm HTTPS. `ci:api-base` chỉ đọc PRODUCTION_API_BASE/RELEASE_BUILD được truyền vào process, không đọc `.env` hay VITE_*; trong GitHub Actions nó ghi output `api_base`. `build:verify -- <static-directory> <PUBLIC_API_BASE-file>` kiểm thêm URL của artifact đóng gói. Hai scripts không truy cập mạng hoặc DB.

Người dùng cần push cấu hình sau review, bật branch protection/required CI, đặt PRODUCTION_API_BASE, cấu hình environment reviewers + protected main trước dispatch. Khả năng required reviewer phụ thuộc gói/visibility GitHub; nếu không hỗ trợ, giữ bước release thủ công do người có quyền triển khai và lưu phê duyệt riêng. [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Trình tự Ops sau release approval:

1. Chốt SHA sạch đã CI pass, URL/env/hosting/budget/UAT/gates; giữ N−1 và checksum. Staging chạy smoke/browser E2E với DB riêng; không dùng token/dữ liệu thật trong artifacts.
2. Tạo backup đã verify; export migration list, chọn maintenance window nếu SQL không tương thích; dừng ingress ghi khi cần.
3. Chạy migration job duy nhất; verify-production.sql bằng owner. Lỗi thì dừng promotion, xử lý forward-fix/rollback theo runbook.
4. Deploy API đúng SHA, chờ liveness + authenticated readiness, kiểm catalog và RBAC qua HTTPS; sau đó promote frontend cùng SHA và đúng public URL. Xóa maintenance sau smoke thành công.
5. Theo dõi 30 phút: 5xx,429,503, latency, CPU/RAM, pool/locks và đối soát. Ops ghi timestamp, revision, migration range, backup ID, người duyệt, kết quả smoke và rollback candidate.

Smoke tối thiểu tại domain thật: HTTP redirect, TLS, CSP/Helmet/no-store, preflight POST có Authorization+Idempotency-Key từ origin hợp lệ, origin lạ403; deep links tải SPA; assets200 đúng MIME; login theo5 roles, CUSTOMER checkout COD/idempotent replay/history/cancel với fixture được phép trên staging; ADMIN không checkout, WAREHOUSE không xem địa chỉ. Sau production chỉ dùng smoke đọc và tài khoản kiểm tra được duyệt, không tự tạo đơn thật. Không bỏ bước browser E2E chỉ vì build/tests xanh.
