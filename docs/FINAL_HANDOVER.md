# Final handover — Task 15 Production Readiness

Ngày 20/11/2026, Asia/Bangkok. Phạm vi: chuẩn bị production trong repository, không deploy hoặc tạo dịch vụ trả phí. Task15 trong yêu cầu hiện tại ánh xạ phần chuẩn bị `T25` của backlog gốc; không đánh dấu `T15` Design System thành công việc vận hành.

**Kết luận: đã chuẩn bị bản build/cấu hình/container/runbook và kiểm chứng local; chưa đủ điều kiện go-live production.** Chưa có production URL, cloud account/configuration được kiểm chứng hoặc PO UAT. Không commit/push/deploy trong phiên. Giữ nguyên SPEC, ảnh/DOCX gốc, migrations001–019 và báo cáo audit/QA lịch sử; bảo toàn các thay đổi có sẵn của Task14.

## 1. Hồ sơ đã đọc và cách dùng bằng chứng

Đã đọc SPEC, README, AGENTS, TASKS và toàn bộ bộ tài liệu `docs`: PRD, DECISIONS, ARCHITECTURE, DATABASE_DESIGN, API_CONTRACT, UI_DESIGN_SPEC, ERD, MIGRATION_GUIDE, WORKSPACE_AUDIT, FOUNDATION_VERIFICATION, SCHEMA_VERIFICATION, FULL_PROJECT_AUDIT, QUALITY_GATE_FINAL, QA_REPORT, SECURITY_REPORT, PERFORMANCE_REPORT. Snapshot cũ có mô tả “chưa có UI/benchmark/restore”; kết quả mới trong tài liệu này không ghi đè lịch sử đó.

PERFORMANCE_REPORT ghi benchmark60.001 orders/120.001 items ở Task14; Task15 không chạy lại benchmark vì không đổi SQL/index/query nghiệp vụ. Các số EXPLAIN riêng lẻ không chứng minh API p95 dưới tải hoặc Web Vitals; `T24` vẫn PARTIAL. Các policies pending trong DECISIONS giữ trạng thái; user AGENTS yêu cầu tiếp tục D-07 least-privilege, không cấp owner/direct DML cho runtime.

## 2. Checklist 12 yêu cầu

| # | Yêu cầu | Đã chuẩn bị/kiểm chứng | Phần trước production còn cần |
| --- | --- | --- | --- |
| 1 | Frontend production build | Vite build, chunk React/router/query/forms/validation, lazy auth và403 component riêng; static host config | URL thật, browser E2E/visual/a11y, domain CSP/deep-link/CDN smoke |
| 2 | Backend production config | Compiled Express, non-root multi-stage Docker, HOST/PORT, bounded HTTP/DB timeouts, SIGTERM drain | Deploy staging, load/capacity/rollout timing trên host chọn dùng |
| 3 | Environment variables | Track template không secrets, validate HTTPS origin/runtime user/TLS/readiness, production không đọc .env local | Inject secrets/vault/domain/CA thật; rotation/access owners |
| 4 | HTTPS/CORS/headers | Helmet, exact origin, no-store, body64KiB, proxy config, register/checkout/login rate limits; frontend headers/rewrite | Ingress HTTPS/renewal/trusted chain, exact CSP API origin, limiter chung nếu scale |
| 5 | Logging/health | JSON request_id/route/status/duration/code, không URL thô/PII; live public/ready token guarded; Docker HTTP smoke | Monitor/alerts/log retention/pool metrics; L-3 audit request_id vẫn mở |
| 6 | Migration strategy | Job tách runtime, TLS verify-full chống URL override, không production down, bootstrap/SQL verifier, expand/contract runbook | Chạy upgrade staging rồi một job được duyệt tại production; backup trước upgrade |
| 7 | PostgreSQL backup/restore | Local pg_dump/pg_restore thực,22 bảng/19 migrations, counts/ACL/routines/receipt/reconciliation; runbook encrypted offsite + PITR | Scheduler/offsite vault, retention/owners, managed PITR restore & RPO/RTO dữ liệu thật |
| 8 | Least privilege | Bootstrap DB mới +19 migrations bằng db_admin **không superuser**, runtime/report allow/deny qua kết nối riêng; restore grants ALL ROUTINES | Xác minh provider role/ownership/TLS/password thực và network ACL |
| 9 | CI/CD | GitHub CI checks + artifact SHA/checksums, manual approval/delivery workflow, không cloud secrets/calls | Push sau review, bật CI/protected branch/environment reviewers, cấu hình API URL, Ops deploy thủ công sau duyệt |
| 10 | Production README | [DEPLOYMENT](DEPLOYMENT.md) và README root có build/start/env/hosting/rollout | Điền host/domain/owners/revision thực |
| 11 | Troubleshooting | [OPERATIONS](OPERATIONS.md) có health/TLS/CORS/429/409/503/migration/restore/secret handling | Thiết lập liên hệ trực và thử incident trên staging |
| 12 | Rollback plan | N−1 artifact/image, frontend/backend rollback, forward-fix, PITR/restore DB mới, maintenance/cutover checklist | Diễn tập promotion/rollback trên host thật; duyệt RPO/RTO và mất dữ liệu nếu recovery |

“Đã chuẩn bị” không có nghĩa đã nghiệm thu cloud. CI/CD ở đây là continuous delivery với **deploy thủ công**, chưa phải automated cloud deployment. Workflow release không migrate remote, không publish hoặc tạo resource.

## 3. Thay đổi kỹ thuật chính

- [DEPLOYMENT](DEPLOYMENT.md): so sánh hosting theo chi phí/backup/cấu hình/công vận hành, production README, biến môi trường, HTTPS/health, managed bootstrap/migration, CI/manual CD và release order.
- [OPERATIONS](OPERATIONS.md): monitoring/logs, backup mã hóa ngoài máy, restore/verify, sự cố và rollback app/schema/DB.
- Backend env/app/server/database/rate-limit/error và production-config tests: verified TLS bắt buộc, runtime role cố định, readiness token, log route template thay URL thô, error code, register5/IP/phút + checkout30/IP/phút, memory bucket cap, proxy/timeouts/drain. Không đổi checkout transaction/DB invariants.
- [roles_backup.sql](../database/roles_backup.sql): sửa lỗi được restore drill phát hiện: `ALL FUNCTIONS` không thu hồi mặc định PUBLIC EXECUTE trên procedures sau `--no-acl`; chuyển sang `ALL ROUTINES` rồi grant allowlist. Không chỉnh migration cũ.
- [production-bootstrap.sql](../database/production-bootstrap.sql), [verify-production.sql](../database/verify-production.sql), [restore-rehearsal.mjs](../scripts/restore-rehearsal.mjs), [verify-production-permissions.mjs](../scripts/verify-production-permissions.mjs): có kiểm chứng PostgreSQL thật, tự dọn tài nguyên test.
- [Dockerfile](../Dockerfile), [.dockerignore](../.dockerignore), [.env.production.example](../.env.production.example), [ci.yml](../.github/workflows/ci.yml), [release.yml](../.github/workflows/release.yml); package scripts, env/migration TLS tests và static host configuration.
- Frontend: tách ForbiddenPage, vendor chunks đúng React DOM client/forms/validation, giữ hành vi403. Shopping-flow tests chờ form lazy render trước thao tác. Không thêm feature ngoài phạm vi.
- README/TASKS/DECISIONS/ARCHITECTURE/API_CONTRACT/MIGRATION_GUIDE được đồng bộ hiện trạng và liên kết runbooks; báo cáo QA/audit cũ giữ nguyên.

## 4. Kết quả kiểm chứng trong phiên

Windows/PowerShell, Node26.13.0/npm11.20.0, PostgreSQL17.9 Docker thực. Tất cả DB test/probes dùng dữ liệu synthetic trong DB/container tạm, không xóa/reset/migrate dữ liệu `fashion_dev`.

| Lệnh/kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run lint` | PASS, max-warnings0 |
| `npm.cmd run typecheck` | PASS, TS strict backend/frontend |
| `VITE_API_BASE_URL=https://api.example.com/api` + `npm.cmd run build` | PASS backend/frontend production build; URL example là fixture, không phải production endpoint |
| `npm.cmd test` | Backend43/43 (9 files, gồm11 production-config/security tests), frontend29/29 (6 files, jsdom/fetch mock), environment/migration3/3 |
| `npm.cmd run db:test` | PASS94/94, PG17.9 thật, gồm5-way stock/voucher, rollback món2, cancel/snapshot/privileges/deferred COMMIT |
| `npm.cmd run db:verify` | PASS SQL up/down/PLpgSQL trên DB tạm |
| `npm.cmd run db:restore:verify` | PASS22 bảng/19 migrations; lần chạy cuối recovery539ms, tổng1750ms với fixture nhỏ local; không là production RPO/RTO |
| `npm.cmd run db:permissions:verify` | PASS bootstrap trên cluster Docker riêng, migrate dưới db_admin không superuser, app/report identities và allow/deny; test-only loopback trust auth, không kiểm TLS/password managed |
| `docker build -t fashion-api:task15 .` | PASS Linux build + runtime npm ci từ lockfile; runtime chỉ99 packages backend, USER node |
| Docker production HTTP smoke | PASS UID1000, không .env/database/TypeScript trong runtime; live200, thiếu readiness token404, DB-down ready503, CORS origin lạ403, stop process |
| `npm.cmd audit --omit=dev` | PASS0 runtime vulnerabilities; clean Docker build vẫn báo3 moderate ở dev tooling chain node-pg-migrate, đã ghi từ foundation; không force update |
| Tài liệu/config | PASS21 Markdown files,146 local links,6 JSON examples; JSON manifests/Vercel parse; git diff --check không whitespace error |
| Workflow/static bundle | actionlint1.7.7 + ShellCheck kiểm2 workflows; scan frontend dist không chứa giá trị backend secrets từ .env local, không in giá trị |

Frontend entry khoảng168,34kB (gzip36,28kB), React chunk391,72kB; không còn warning chunk>500kB/static+dynamic auth import. Vẫn còn2 warning annotation từ dependency Zod4.6.7, Rollup bỏ comment và build thành công. Không nâng warning limit/nâng dependency để che cảnh báo. Chưa đo browser download/LCP; bundle nhỏ hơn không chứng minh UX target đạt.

Chưa chạy GitHub-hosted workflow, deployment provider, public HTTPS, production migration, remote backup upload/PITR, browser E2E thật, screen reader/contrast/overflow, API p95/10k SKU/Web Vitals, V16 mixed barrier, V17 two-admin barrier hoặc PO UAT. Không gọi các mục này PASS.

## 5. Release blockers và công việc người dùng

1. **PO + Architect:** chốt policies ảnh hưởng release trong DECISIONS, dữ liệu/tên cửa hàng/brand/ảnh/giá/tồn thật, phí ship, retention PII/log/backup và JWT logout limitation. Không tự chuyển nhãn D thành accepted.
2. **PO + Ops:** duyệt hosting/budget/domain/region, chọn người trực + dự phòng và backup owner. Đề xuất Pages + Render paid + managed PG17 paid, sàn tham khảo khoảng$13/tháng trước phụ phí; Vercel Pro thay Pages sàn khoảng$33. Giá/điều kiện có nguồn trong DEPLOYMENT và cần xác nhận lúc mua.
3. **Ops:** provision staging riêng, xác minh provider hỗ trợ roles/SET ROLE/non-superuser ownership/TLS; set secret store, connection budget, proxy/HTTPS/CSP/headers và backend1 instance. Thực hiện managed restore/PITR + promotion rollback, đo recovery với kích thước dữ liệu dự kiến.
4. **QA + Tech lead:** hoàn tất browser E2E/responsive360–1440/accessibility thật (`T23`), V16/V17 barrier (`T20/T22`), API load p95/10k SKU/Web Vitals (`T24`). L-2 checkout form thủ công vẫn còn; L-3 audit request_id cần migration mới; reporting pool hiện trạng một runtime pool đã ghi rõ. Chưa có metrics exporter/alert dashboard.
5. **Repo owner:** review rồi commit/push theo quy trình riêng; bật required CI, protected main/environment production/reviewers nếu gói hỗ trợ, đặt PRODUCTION_API_BASE thật. Workflow chỉ chuẩn bị/bàn giao artifact; Ops thực hiện deploy theo runbook, giữ auto-deploy tắt cho tới khi quy trình được duyệt.
6. **PO + QA + Ops:** UAT (`T26`), lưu release SHA/migration/backup ID/người duyệt, phê duyệt go-live riêng. Sau đó mới triển khai production; kiểm HTTPS/readiness/readonly smoke và theo dõi rollout.

Task15 hoàn tất phần chuẩn bị có thể làm trong repository. `T25` chỉ PARTIAL vì chưa pilot/cloud recovery; `T26` OPEN. Không có thay đổi dữ liệu thật, không có dịch vụ trả phí hoặc production deployment trong phiên này.
