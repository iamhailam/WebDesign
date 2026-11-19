# Sổ quyết định thiết kế

Ngày 19/11/2026. Trạng thái mặc định của các D là **Đề xuất, chờ chốt**. Tài liệu khác dùng phương án khuyến nghị để tạo thiết kế hoàn chỉnh, không phải quyết định đã được duyệt. Chủ sản phẩm chốt chính sách kinh doanh; kiến trúc sư chốt cơ chế sau khi có spike kỹ thuật. Không cần dừng việc soạn tài liệu để hỏi duyệt từng mục.

## 1. Ràng buộc đã xác lập

| ID | Trạng thái | Nội dung và nguồn |
| --- | --- | --- |
| C-01 | Bắt buộc G/U | Một nhà bán B2C, nhiều brand/category, một kho, COD; không marketplace/online payment/AI recommendation/multi-warehouse |
| C-02 | Bắt buộc G/U | PostgreSQL Database-Centric, SQL/PLpgSQL thuần, pg, node-pg-migrate; React Vite TS + Express TS; không ORM |
| C-03 | Bắt buộc G | 5 role ứng dụng, giỏ không trừ kho, giá lịch sử, luồng đơn và 4 kiểm thử SPEC §7 |
| C-04 | Bắt buộc task | Chỉ tài liệu; không tạo mã nguồn ứng dụng/migration hoặc cài môi trường trong task này |

## 2. Quyết định cần chốt

| ID | Chủ chốt; thời điểm | Phương án khuyến nghị | Lựa chọn khác và ảnh hưởng |
| --- | --- | --- | --- |
| D-01 | PO; trước schema tiền | VND, NUMERIC(12,2) có phần lẻ .00; price là giá bán, list_price nullable ≥price; snapshot giá bán; round giảm phần trăm đến đồng, ship 0 | Nếu thu ship/đa tiền/lịch giá: thêm trường, công thức và test; không triển khai ngầm |
| D-02 | Architect + PO; trước catalog schema | 5 bảng thuộc tính quan hệ theo product_type, combo_key chuẩn hóa, một variant cho một tổ hợp | Chỉ color/size không đáp ứng nước hoa/đồng hồ; JSONB tự do khó FK/3NF; nhận chi phí 5 bảng để giữ kiểm soát DB |
| D-03 | Architect; trước checkout | READ COMMITTED + locks theo thứ tự; khóa giỏ; Idempotency-Key bắt buộc; expected_items và cart_version để chặn đổi giá/giỏ | Không idempotency dễ tạo đơn trùng sau timeout; SERIALIZABLE vẫn cần retry, không thay thế khóa kho |
| D-04 | PO + Architect; trước voucher API | Preview tính subtotal từ giỏ server; subtotal client nếu gửi chỉ dùng so sánh; 1 voucher/đơn; campaign đang được dùng chỉ sửa active/limit tăng | Thay từ preview tin subtotal sang server-authoritative là làm rõ hợp đồng; sửa điều khoản chiến dịch cũ phải tạo code mới |
| D-05 | PO; trước checkout/UI | Giá/giỏ đổi trả 409, yêu cầu khách xem lại và retry với key mới; thất bại rollback không lưu key | Tự chấp nhận giá mới có thể thu khác số khách thấy; giữ giá dài hạn đòi quote/reservation mới |
| D-06 | PO; trước cancellation | Giữ G: hủy CANCELLED lần nữa trả 409 ORDER_NOT_CANCELLABLE; hiệu ứng hoàn chỉ một lần | Trả 200 kết quả cũ là thay đổi observable G. Không gọi 409 là HTTP idempotent success; chỉ bảo đảm idempotent side effects |
| D-07 | Architect; trước roles/functions | Giới hạn DML trực tiếp trên kho/đơn/usages/log; hàm SECURITY DEFINER có actor checks, search_path cố định; status function tuần tự | Khác câu app_rw_user có DML trong G; phải duyệt siết quyền. Grant DML rộng + chỉ trigger orders không bảo vệ được order_items/counters |
| D-08 | PO; trước catalog admin | Brand 1–n products; category một cấp; gallery product/SKU; URLs tài sản nội bộ đã cấp, không upload service v1 | Nhiều brand/product hoặc category tree cần junction/recursive filter; ảnh 4/5 chưa xác nhận chung product |
| D-09 | PO; trước banners | ADMIN quản lý banners; HERO/PROMO, lịch [start,end), link PRODUCT/CATEGORY/BRAND/NONE có FK | MARKETING quản lý banners là quyền mới ngoài G; external links/upload cần thêm kiểm soát và test |
| D-10 | Architect + PO; trước auth/RBAC | JWT 30 phút, in-memory, role + token_version hiện hành DB, đăng nhập lại sau reload; không refresh token v1; admin cuối được bảo vệ | Cookie/refresh thêm CSRF/session schema; UX đăng nhập lâu hơn cần quyết định khác. Logout local không thu hồi token bị sao chép |
| D-11 | PO; trước reports | Revenue ghi nhận theo delivered_at, SUM(final_amount) chỉ DELIVERED; timezone Asia/Ho_Chi_Minh; top bằng quantity, RANK có đồng hạng | G chưa nói dùng created_at hay delivered_at; dùng created_at làm lệch ngày ghi nhận; gross revenue phải có metric riêng |
| D-12 | Tech lead/ops; trước bootstrap | npm workspaces backend/frontend; SQL migration; DB version/runtime pin sau kiểm tra; backup pilot RPO 24h/RTO 4h | Chọn PostgreSQL local/remote hoặc Docker đều được; không suy ra môi trường đã cài từ báo cáo cũ |
| D-13 | Architect + PO; trước audit schema | audit_events append-only cùng mutation; chỉ ADMIN xem; không log hash/token/địa chỉ đầy đủ; không purge keys/đơn v1 | Audit đầy đủ before/after chứa PII tăng rủi ro; retention/xóa theo chính sách phải chốt trước production |
| D-14 | PO + QA; trước release | Các ngưỡng UX/performance/accessibility/security của PRD là target pilot cần đo | Hạ tầng/hồ sơ tải chưa chốt nên không coi target là SLA đã bảo đảm |

## 3. Mâu thuẫn nguồn và cách xử lý cụ thể

| Mâu thuẫn/khoảng trống | Thiết kế review | Bằng chứng cần có khi thực thi |
| --- | --- | --- |
| §2 chỉ 12 bảng, không brand; user yêu cầu multi-brand | Thêm 3 bảng nội dung, 5 bảng SKU, 2 bảng vận hành; giữ mapping 12 bảng gốc | Migration design và 22 bảng khớp dictionary |
| color/size bắt buộc trong UI §6 nhưng hàng có volume/concentration/model | Option schema theo loại, không tạo size N/A; color/size trở thành projection đọc | Test đủ 6 loại, duplicate combos và missing required |
| price được gọi “giá niêm yết” khi checkout §3 | price giữ ý nghĩa giá thực bán; list_price chỉ giá so sánh; order_items.unit_price snapshot price | Order không đổi khi cập nhật price/list_price |
| Hủy gọi “Idempotent” nhưng cấm CANCELLED | D-06 giữ lỗi 409 và side effects một lần | Hai cancel song song: một 200, một 409, kho/voucher hoàn một lần |
| API nói CALL/SELECT fn_cancel_order | Function gọi SELECT; sp_import_inventory gọi CALL; COMMIT do caller | Không transaction control trong function; lỗi rollback toàn bộ |
| Lỗi chung 400/409 nhưng test đòi 409 | Domain conflict 409, validation 400; business code ổn định | Stock test bắt buộc đúng 201/409, không đổi thành 400 |
| Preview subtotal client và thời điểm voucher thay đổi | Preview server cart; lock voucher và tính lại ở checkout | Hai preview đều thành công nhưng chỉ một checkout dùng lượt cuối |
| Trigger finalized_orders chưa chặn nhảy bước hoặc sửa items | fn_transition_order + trigger chuyển trạng thái; immutable items và log | DML bypass của runtime bị chặn; owner sửa sai bị invariant reject |
| app_rw DML rộng và DB-Centric | D-07 siết grants; backend là trusted actor gateway, SQL user không cấp cho khách | Test revoke direct DML và function actor RBAC; không tuyên bố chống backend bị chiếm quyền |
| Thiếu API users/categories, chi tiết đơn/admin inactive | Bổ sung endpoint giữ URL G, định nghĩa scope public/admin | Permission matrix từng route; không lộ PII qua list/joins |
| Kho cần link order nhưng WAREHOUSE không có quyền Orders | Hiện order_code tham chiếu dạng text; chỉ SALES/ADMIN có link chi tiết | WAREHOUSE gọi detail nhận 403 |
| Đơn có nhiều SKU và RETURN_CANCEL chống trùng | UNIQUE(order_id,variant_id,type) dạng partial trên reference cho EXPORT/RETURN | Mỗi SKU có log, tổng hoàn chính xác; không UNIQUE chỉ reference_id |

## 4. Thứ tự cần xác nhận

Trước schema: D-01,02,07,08,13. Trước checkout/voucher: D-03,04,05,06. Trước auth/report/content: D-09,10,11. Trước triển khai/release: D-12,14. Backlog có task chốt và task dependent tương ứng, không tự đưa D sang trạng thái accepted.

Thông tin cần bổ sung: tên/logo cửa hàng và ảnh UI rõ hơn; dữ liệu thật về category/brand, SKU/giá/tồn; quan hệ ảnh 4–5; chính sách phí ship; hạ tầng/DB version, retention PII và người chịu trách nhiệm backup. Không cần các dữ liệu này để hoàn tất bộ thiết kế hiện tại.

## 5. Bản ghi hiện trạng và thay đổi

Audit là snapshot cũ: khi audit chưa có Git. Lần đọc ngày 19/11/2026 hiện có .git, .gitignore, commit 4bbfc43 (chore: initialize project workspace), working tree sạch trước khi tạo tài liệu. Không sửa lại audit lịch sử, không commit trong task này. Không xác minh lại Docker/PostgreSQL hoặc khẳng định chúng vẫn thiếu chỉ dựa báo cáo cũ.

Khi chốt: ghi ngày, người duyệt, lựa chọn, lý do và tài liệu/task bị ảnh hưởng ngay trong hàng quyết định hoặc mục lịch sử mới; cập nhật đồng thời DB/API/UI/AC. SPEC vẫn giữ nguyên làm nguồn đối chiếu.

### 20/11/2026 Task 02 Project Foundation

Người dùng yêu cầu triển khai cụ thể T02 với React Router, Tailwind/shadcn, TanStack Query, RHF/Zod, Express/pg/JWT, Compose và migration tooling. Yêu cầu này cho phép làm foundation trước khi chốt T01; không đồng nghĩa duyệt chính sách kinh doanh D-01..11/13/14.

D-12 được chọn phần foundation: npm workspaces backend/frontend; Node 26.13.0 và npm 11.20.0 đang có, PostgreSQL Docker 17.9-bookworm; exact direct dependency versions + lockfile theo README. TypeScript 5.9.3 nằm trong peer range; ESLint 10 thay bản 9 deprecated ngay trong bootstrap; override Vite 7.3.8 tránh đồng thời Vite 7/8. node-pg-migrate 9 stable dùng SQL marker up/down, không dùng loader alpha 10. Không nâng cấp dependency đã có của dự án vì trước T02 chưa có manifest.

Bootstrap db_admin chỉ là local image superuser, backend dùng app_rw_user không superuser; owner/grants production và schema nghiệp vụ để T03. JWT mới là primitive verify, chưa có login hay DB actor checks T04. Health có alias /api/health theo yêu cầu mới và readiness lỗi theo envelope thống nhất. D-12 phần backup/RPO/RTO/deploy chưa được coi là đã nghiệm thu; xem FOUNDATION_VERIFICATION.md về bằng chứng foundation.
