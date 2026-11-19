# Operations, troubleshooting và phục hồi

Ngày 20/11/2026 — runbook Task 15. Tình trạng bàn giao: [FINAL_HANDOVER](FINAL_HANDOVER.md); cấu hình/build/hosting: [DEPLOYMENT](DEPLOYMENT.md). Lệnh production chỉ do Ops chạy sau phê duyệt và kiểm tra đích. Không thay đổi `SPEC`, không sửa migration đã áp dụng.

## 1. Trách nhiệm và lịch vận hành

| Vai trò | Trách nhiệm | Trước go-live phải có |
| --- | --- | --- |
| PO | UAT, phí ship/giá/nội dung, retention PII, chi phí, quyết định release | Người cụ thể và phê duyệt có ngày/revision |
| Ops chính + dự phòng | DNS/TLS, secrets, deploy/rollback, backup/restore, cảnh báo | Tên/liên hệ nội bộ, quyền truy cập và lịch trực |
| DB owner | Migration review, roles/ACL, capacity, đối soát | Credential tách runtime, quyền đúng DB, backup access |
| QA/Tech lead | CI, staging smoke/E2E/performance, kiểm rollback candidate | Evidence theo SHA, các gap còn mở hoặc xử lý có phê duyệt |

Đề xuất để chủ vận hành chốt: readiness mỗi1 phút (token), liveness mỗi1 phút, cảnh báo sau3 lần lỗi liên tiếp; 5xx>1% trong5 phút khi đủ request để có ý nghĩa; CPU/RAM/disk/connection>80%; backup quá26 giờ; TLS còn<14 ngày. Đối soát DB hằng ngày ngoài giờ cao điểm; restore drill hằng tháng và sau migration lớn. Đây là ngưỡng khởi đầu, không phải SLA đã nghiệm thu. Chưa tạo monitor/scheduler/cloud storage trong phiên.

## 2. Logging, health và xử lý sự cố

API stdout JSON: `server_started`, `server_stopping`, `http_request`, `request_failed`, `database_pool_error`. Access log có request_id, method, route template hoặc `unmatched`, status, duration_ms, domain code khi lỗi; không ghi query/headers/body/raw URL/IP/email/address/token/password. Logs hạ tầng/ingress cũng phải redaction; không bật SQL statement/parameter logging cho request có PII. Không dán log nguyên bản ra kênh công khai.

Client nhận `X-Request-ID` và `meta.request_id`; dùng ID này tra lỗi HTTP. Audit của 4 routines `013` vẫn chưa có request_id (`L-3`), nên không khẳng định đã trace toàn bộ HTTP→DB. Chỉ ADMIN được xem audit API. Chưa có metrics exporter/pool dashboard trong code; Ops cần monitor tài nguyên/provider logs, latency/conflicts/retries/lock waits và thu thập metrics trước vận hành có tải.

Monitor bí mật gọi `/api/health/ready` với header `X-Readiness-Token`. Không truyền token vào URL hoặc CLI verbose. Liveness200/ready503 nghĩa là process còn hoạt động nhưng DB/drain chưa sẵn sàng. Readiness404 thiếu token có thể là hành vi đúng. Readiness không kiểm migration/role/backup. Không tự restart liên tục vì DB503; điều tra TLS/connection/pool trước.

Khi có incident: ghi UTC + giờ Asia/Bangkok, revision/migration, request_id và ảnh hưởng; chặn ingress ghi nếu có nguy cơ dữ liệu, giữ log/backup; Ops chọn forward-fix/application rollback/DB recovery theo §6. Không sửa trực tiếp `quantity`, `used_count`, lịch sử đơn hoặc audit để làm biến mất sai lệch.

## 3. PostgreSQL backup

Mục tiêu pilot từ D-12: RPO≤24h/RTO≤4h; chưa được đo trên production. Khuyến nghị managed PITR cùng logical dump độc lập mỗi ngày và trước migration. Retention đề xuất: 7 daily + 4 weekly, lưu object storage mã hóa khác nơi chạy API; PO phải chốt thời hạn PII và backup, vùng lưu, quyền đọc/xóa, key owner, chi phí. Không tự áp retention hoặc purge checkout keys/lịch sử/audit.

Dump có PII/password hashes, cần quyền đọc giới hạn. Không dùng runtime role để backup; owner `db_admin` có SELECT toàn DB. Secrets cấu hình qua `pg_service.conf`/`.pgpass` hoặc secret store, không URL/password trong command line/log. File service/pgpass ngoài repo, mode0600 trên Linux; TLS `sslmode=verify-full` + `sslrootcert` khi cần. Dùng client PG17 cho server PG17; review tương thích trước major upgrade. [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

Ví dụ Linux operator, các service `fashion_owner`, `fashion_restore` và recipient GPG đã được Ops cấu hình. Thư mục `/var/lib/fashion-backups` dành riêng, mode0700; script không chạy tại repo:

```sh
set -eu
umask 077
backup_dir=/var/lib/fashion-backups
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_dir/fashion-$backup_stamp.dump"
pg_dump --dbname='service=fashion_owner' --format=custom --no-owner --no-acl --file="$backup_file.partial"
pg_restore --list "$backup_file.partial" >/dev/null
mv "$backup_file.partial" "$backup_file"
gpg --batch --yes --encrypt --recipient '<approved-backup-recipient>' --output "$backup_file.gpg" "$backup_file"
sha256sum "$backup_file.gpg" > "$backup_file.gpg.sha256"
```

Ops/scheduler chỉ đánh dấu thành công sau khi upload **cả encrypted archive + checksum + manifest** lên kho ngoài máy, xác minh checksum/kích thước từ kho, và ghi thời điểm backup. Sau xác minh mới xóa bản plaintext cụ thể theo chính sách; không đưa path computed vào recursive delete. File `.partial` không phải backup thành công. Nếu một bước lỗi: dừng, cảnh báo, giữ backup tốt gần nhất, không rotate/xóa tự động vì job mới chạy. Cấu hình khóa mã hóa/khôi phục và thử decrypt trước tin vào backup. Không upload dump vào GitHub artifact công khai hoặc filesystem tạm Render.

Manifest riêng chứa source DB ID (không credential), PostgreSQL/client version, UTC start/end, revision, migration list, bytes/checksum, logical row counts từ cùng snapshot hoặc trong maintenance window, encryption key ID, offsite object ID, người/job thực hiện. `pg_dump` cho snapshot nhất quán trong chính nó; đếm trước/sau dump khi ứng dụng còn ghi có thể khác snapshot, không coi đó là mất dữ liệu.

Logical dump không chứa cluster roles/passwords và không thay PITR/WAL. Lưu role definitions/allowlist có phiên bản từ repository, credentials từ vault; không dùng `pg_dumpall --globals-only` rồi phát tán password hashes. Provider PITR phải bật trên gói đã chọn và thử restore; PITR window không đồng nghĩa backup dài hạn. Theo [Render recovery](https://render.com/docs/postgresql-backups), paid DB được backup liên tục và phục hồi thành instance khác; vẫn phải kiểm dữ liệu/quyền trước đổi endpoint.

## 4. Restore và kiểm chứng

1. Ops xác định timestamp mong muốn, RPO và phạm vi mất dữ liệu được PO chấp nhận. Giữ DB gốc, bật maintenance chặn mọi API ghi. Tạo DB/instance **mới, trống**, PG17 và role names không xung đột. Không dùng `--clean`, không restore đè production, không disable triggers trên DB đang phục vụ.
2. Download backup từ offsite, kiểm checksum, decrypt trong thư mục hạn chế; kiểm `pg_restore --list`. Chỉ restore archive tin cậy vì có SQL/function definitions. Provision roles bằng phần bootstrap phù hợp. Trên cùng cluster đã có roles thì kiểm lại attributes/membership, không đổi mật khẩu của DB đang chạy tùy tiện.
3. Restore chạy bằng `db_admin` hoặc operator được phép SET ROLE db_admin; schema/routines phải owner db_admin. **Không migrate trước restore** vì archive chứa schema và `public.pgmigrations`.

```sh
pg_restore --dbname='service=fashion_restore' --role=db_admin --no-owner --no-acl --exit-on-error --single-transaction '/secure/restore/fashion.dump'
psql 'service=fashion_restore' -X -v ON_ERROR_STOP=1 -f database/roles_backup.sql
psql 'service=fashion_restore' -X -v ON_ERROR_STOP=1 -f database/verify-production.sql
```

4. Đối chiếu22 bảng, migration list, row counts theo snapshot, index/constraints/triggers/routines, sequences và order receipt snapshot. SQL verifier kiểm runtime không có base DML, report không có base SELECT/DML, owner/search_path/PUBLIC ACL của SECURITY DEFINER, cân bằng kho=SUM ledger, voucher counter=COUNT APPLIED, subtotal, không key pending. Script `roles_backup.sql` thu hồi **ALL ROUTINES**, tránh PUBLIC EXECUTE lọt trên procedures sau restore `--no-acl`.
5. Đăng nhập runtime bằng password thực để kiểm catalog/actor checks/deny write; role `report_ro_user` chỉ SELECT aggregate views. Chạy staging smoke checkout/replay/cancel và token/RBAC với fixture riêng; kiểm private receipt owner đúng và đơn lịch sử không đổi. Không gửi PII vào báo cáo. Verifier không thay mọi tình huống `V01–V18`.
6. Nếu archive cũ hơn code, thử migration còn thiếu trên clone trước. Chỉ chạy dưới job một lần. Không sửa `pgmigrations` thủ công, không dùng seed demo để “bù” dữ liệu.
7. Ghi thời gian từ bắt đầu incident/khôi phục tới smoke đạt, timestamp snapshot mới nhất tới incident (RPO), thời gian provision/decrypt/restore/verify/cutover; PO/Ops duyệt chuyển DB endpoint. Restart/drain API để đóng pool cũ, readiness + HTTPS smoke lại, mở ingress ghi rồi theo dõi. Giữ DB cũ read-only và N−1 theo retention đã duyệt.

Local rehearsal đã có lệnh tái lập:

```powershell
npm.cmd run db:restore:verify
```

[restore-rehearsal.mjs](../scripts/restore-rehearsal.mjs) chỉ nhận Compose loopback, từ chối remote URL/production; tạo hai DB tạm riêng, migrate19 + seed synthetic trong source tạm, `pg_dump`/`pg_restore` PG17 thực, reapply ACL, so counts/migrations/object counts, verify SQL, đọc order qua function dưới runtime role, xác nhận direct stock write và item update bị chặn. Chỉ xóa hai DB/archive `/tmp` tự tạo, không dump/sửa `fashion_dev`. Không phải restore rehearsal của managed provider hay phép đo RTO có thể suy rộng theo dữ liệu thật.

## 5. Troubleshooting

| Hiện tượng | Kiểm tra an toàn | Cách xử lý |
| --- | --- | --- |
| Start lỗi `Invalid environment: ...` | Tên biến lỗi, NODE_ENV của process manager; không in env | Inject đủ secret, origin HTTPS chính xác, DB_USER runtime, TLS verify-full, readiness token≥32 |
| Render không thấy listener / 502 | HOST, PORT platform, startup logs, image revision | HOST0.0.0.0 trong container/Render; start compiled backend, không Vite preview |
| Liveness200, readiness404 | Monitor có đúng token không, route/ingress có cho phép không | Đặt header trong secret config của monitor; không công khai token/disable guard |
| Ready503 / TLS certificate error | CA chain, hostname SAN, DB firewall/endpoint, quota, pool | Cài đúng CA, chọn hostname đúng certificate, rotate creds đúng; không tắt TLS verification |
| `permission denied`, thiếu schema/function | Owner/migration history, ACL sau restore, login thực runtime | Apply migration/grants đúng phiên bản bằng owner; không grant ALL tables/owner cho API |
| Migration lock/order failure | Job khác còn chạy, `pgmigrations`, staging result | Dừng job thừa; kiểm lock holder với DB owner; không disable runner lock/xóa migration rows |
| Frontend gọi API domain cũ hoặc nhận HTML | PUBLIC_API_BASE trong artifact, VITE_API_BASE_URL lúc build, network inspector | Rebuild/promote đúng artifact; `/api` chỉ có ý nghĩa khi có proxy; không sửa runtime env để mong JS cũ đổi |
| CORS403 hoặc preflight lỗi | Origin chính xác, Allow-Headers Authorization/Idempotency-Key, proxy | Chỉnh FRONTEND_ORIGIN đúng domain; kiểm OPTIONS qua HTTPS; không wildcard/credentials cookie |
| Deep-link404 / ảnh lỗi MIME | SPA rewrite, dist có `_redirects`, static assets thật | Serve frontend/dist, giữ assets/media/images khỏi rewrite về HTML; metadata ảnh phải trỏ file đã cấp |
| CSP chặn fetch/style | Browser console với domain bị chặn, headers thực tế | Allow đúng API origin; không thêm `unsafe-eval`, không wildcard script-src |
| 429 quá nhiều | Retry-After, IP sau proxy, số instance, NAT dùng chung | Client chờ theo header; sửa trusted chain/edge limiter sau đo, không đổi key để né limiter |
| 409 checkout/status/cancel | Domain code, cart/version, trạng thái đơn hiện hành | Refresh và khách xác nhận; unknown outcome retry đúng key/body, không tạo đơn mới/voucher khác âm thầm |
| 503 RESOURCE_BUSY / RETRYABLE_TRANSACTION | Pool cap, lock waits/long transactions, DB CPU | Giảm tải và tìm holder; whole-transaction retry đã có bounded; không chỉ retry SQL cuối/tăng timeout vô hạn |
| JWT401 sau deploy/reload | exp, issuer/aud, key rotation, active/token_version | Login lại; JWT memory mất khi reload theo D-10; logout client chưa thu hồi token đã sao chép |
| Backup job xanh nhưng không restore được | Encrypted object, checksum, key access, partial file, pg_restore list | Cảnh báo và dùng backup tốt đã diễn tập; không tin file tồn tại là đủ |
| Restore quyền PUBLIC EXECUTE / owner sai | `verify-production.sql`, roles_backup revision | Reapply grants bằng ALL ROUTINES, owner db_admin; không promote khi verifier fail |
| Windows npm.ps1 bị ExecutionPolicy | Thử npm.cmd | Dùng npm.cmd, không đổi toàn hệ thống chỉ để chạy npm |

## 6. Deployment rollback plan

Trigger đề xuất: startup/readiness fail liên tiếp sau rollout, 5xx tăng đáng kể, catalog/login không hoạt động, RBAC/PII sai, kho/voucher/đơn đối soát sai. Ops incident lead có quyền quyết định dừng ghi ngay; PO phê duyệt mất dữ liệu/cutover DB. Lưu N−1 artifact/image, migration compatibility note, env version tham chiếu secret store và backup ID **trước** deploy.

| Sự cố | Hành động | Giới hạn |
| --- | --- | --- |
| Chỉ frontend | Pages/Vercel promote deployment N−1 còn giữ, hoặc upload artifact N−1 có checksum; kiểm API URL/CSP/deep links | Không xóa các hashed asset cũ khi còn browser/tab dùng; tránh cache index lâu |
| Chỉ backend, schema tương thích | Redeploy Render revision N−1 hoặc image tag/digest N−1 trên VPS; giữ DB mới; chờ drain10s, liveness/readiness, smoke | Không rollback secret về giá trị bị lộ; confirm code N−1 tương thích migration hiện tại |
| Migration lỗi trong transaction | Dừng promotion, kiểm `pgmigrations` và trạng thái rollback thực, giữ app cũ nếu vẫn tương thích | Không giả mọi migration tương lai đều transactional; kiểm DDL ngoài transaction nếu bổ sung |
| Schema mới không tương thích code cũ | Maintenance, ưu tiên forward-fix có staging test; nếu phải recover, restore/PITR sang DB mới theo §4 | `npm run db:migrate:down` production bị chặn; không tự DROP/clean hoặc chạy down trên dữ liệu thật |
| DB corruption/sai business data | Chặn ghi, giữ bản gốc, PITR/backup sang instance mới, đối soát và PO duyệt cutover | Restore mất các commit sau timestamp backup; thu thập/reconcile đơn phát sinh trước mở bán lại |
| Credential/token lộ | Rotate ở secret manager, update service, invalidate phiên cần thiết, audit quyền | Không rollback về credential cũ để “khôi phục nhanh” |

Checklist rollback: ghi thời điểm/SHA lỗi → tắt auto promotion → maintenance nếu cần → xác nhận schema tương thích → chọn N−1/forward-fix/recovery → triển khai được duyệt → health+readiness+read-only smoke → đối soát DB nếu liên quan → mở ghi → theo dõi30 phút → lưu biên bản. Target khôi phục app trong15 phút là đề xuất chưa đo trên hosting; target RTO4h bao gồm DB recovery cần diễn tập với dữ liệu thực và hạ tầng đã chọn. Không coi Docker restart/rollback UI là DB rollback.
