# Hướng dẫn làm việc trong repository

Áp dụng cho workspace bán lẻ thời trang này. Đọc yêu cầu mới nhất của người dùng trước; hướng dẫn repository không thay thế chỉ dẫn trực tiếp của người dùng hoặc hệ thống. Task tạo bộ tài liệu ngày 19/11/2026 chỉ cho phép thiết kế, không tạo ứng dụng; các task triển khai trong TASKS.md là công việc tương lai.

## 1. Tài liệu và thứ tự đọc

1. [SPEC.md](SPEC.md): bản chuyển nguyên văn nghiệp vụ gốc từ DOCX, giữ làm nguồn đối chiếu.
2. [docs/PRD.md](docs/PRD.md): functional/non-functional requirements và nhãn G/U/D/O.
3. [docs/DECISIONS.md](docs/DECISIONS.md): ràng buộc đã xác lập và phương án còn pending.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md), [docs/API_CONTRACT.md](docs/API_CONTRACT.md), [docs/UI_DESIGN_SPEC.md](docs/UI_DESIGN_SPEC.md).
5. [TASKS.md](TASKS.md): thứ tự dependency và acceptance criteria. [docs/WORKSPACE_AUDIT.md](docs/WORKSPACE_AUDIT.md) là snapshot lịch sử, phải kiểm tra lại công cụ/máy khi thực thi.

Không sửa yêu cầu gốc trong SPEC để khớp implementation. Ghi chênh lệch/quyết định vào DECISIONS và cập nhật đồng thời tài liệu bị ảnh hưởng. Nhãn D không phải bằng chứng người dùng đã duyệt. Nếu user cho phép dùng phương án khuyến nghị thì tiến hành trong phạm vi đó; không hỏi lại từng quyết định. Nếu thiếu chính sách kinh doanh chặn phần việc, nêu rõ lựa chọn cần chốt, hỏi gộp ngắn và tiếp tục phần độc lập.

## 2. Ràng buộc sản phẩm và kỹ thuật

- Một nhà bán B2C, nhiều thương hiệu/danh mục, một kho vật lý, COD. Không tự thêm marketplace/seller/payout/commission, online payment, AI recommendation, multi-warehouse hoặc API vận chuyển.
- React + Vite + TypeScript; Express + TypeScript; PostgreSQL Database-Centric, SQL/PLpgSQL; pg và node-pg-migrate SQL. Không ORM, không schema-sync tự động.
- Giữ monorepo database/backend/frontend, không di chuyển tài nguyên gốc hoặc tạo lại repo khi .git đã có. Không cài plugin/framework chỉ vì có sẵn.
- Checkout, voucher, stock, cancellation, giá lịch sử, state graph và invariant ở DB. Frontend chỉ phục vụ trải nghiệm; backend validation không thay DB constraints/functions.
- Không sửa/xóa/ghi đè ảnh/DOCX/SPEC/audit gốc nếu chưa có yêu cầu cụ thể. Tối ưu ảnh bằng bản sao/derivative, không cắt mất tài nguyên gốc.

## 3. Quy tắc code khi có task triển khai sau này

- Xem Git status và AGENTS.md trong phạm vi liên quan trước khi sửa. Giữ thay đổi người dùng; không reset/clean hoặc ghi đè file chưa hiểu. Không commit/push/deploy nếu không thuộc phạm vi giao.
- Dùng npm lockfile và version đã chốt, TypeScript strict, environment validation. Secret chỉ backend; VITE_* là public. Không ghi token/password/hash/PII vào log, test fixture hoặc screenshot công khai.
- pg queries tham số hóa, allowlist identifiers/sorts; cùng pg client cho một transaction, rollback và release khi lỗi. Không COMMIT trong function, không gọi mạng trong transaction.
- Lock protocol, whole-transaction retry, idempotency và expected_items/cart_version theo ARCHITECTURE. Không chia checkout thành nhiều HTTP/transaction rời, không âm thầm bỏ voucher hoặc tự chấp nhận giá đổi.
- Schema mới qua migration SQL có phiên bản; không sửa migration đã áp dụng. Cẩn trọng dữ liệu thật, backup trước thao tác destructive, benchmark chỉ DB test.
- Không cấp runtime role owner/critical direct DML theo phương án D-07 đã được duyệt; security-definer functions phải role/actor checks, search_path tin cậy, revoke PUBLIC, grant allowlist.
- SKU identity qua attributes/type/combo_key do DB kiểm; không ép color/size cho mọi loại. Giá bán và list_price cùng SKU, order_items snapshot không đọc lại giá sống.
- Quyền UI và API/DB đồng bộ. ADMIN không kế thừa giỏ/checkout CUSTOMER; ownership bắt buộc; WAREHOUSE không xem địa chỉ đơn.
- Không dựng nút upload/payment/blog hoặc tính năng ngoài contract. Giá/tổng từ server, decimal strings, UI local hóa VND theo quyết định được duyệt.

## 4. Kiểm thử và báo cáo

Chỉ chạy lệnh/test hiện có và phù hợp task. Từ Project Foundation ngày 20/11/2026, root đã có scripts dev/build/lint/typecheck/test/db:migrate; xem README.md và docs/FOUNDATION_VERIFICATION.md để biết cách chạy và giới hạn đã kiểm chứng. Không giả định script nghiệp vụ ngoài các manifest hiện có.

Nghiệp vụ DB/RBAC/concurrency cần integration test với PostgreSQL thật. Bắt buộc bảo toàn 4 nhóm test SPEC §7 và verification matrix TASKS V01–V18 khi thay đổi liên quan; không thay bằng test mock. Kiểm fresh migration/upgrade, privileges, deferred COMMIT, snapshot, race/retry, restore theo phạm vi. UI kiểm responsive/accessibility và error states; không viết test chỉ phản chiếu CSS/implementation nhỏ.

Task tài liệu: kiểm liên kết nội bộ, JSON examples, fences, IDs/dependencies và nhất quán DB/API/UI; không cần cài ứng dụng để kiểm Markdown. Báo rõ đã kiểm gì/chưa chạy gì; không nói tests pass khi chưa chạy runtime. Không đánh dấu backlog hoàn thành trước khi có bằng chứng.

## 5. Cách phối hợp

Tiến hành phần việc đã được giao đến khi hoàn tất, cập nhật ngắn bằng tiếng Việt về phát hiện/quyết định. Không xin xác nhận lại thao tác đọc hoặc thay đổi có thể đảo ngược trong phạm vi được phép. Không tự mở rộng sang triển khai từ một task thiết kế. Không tạo sub-agent nếu người dùng hoặc hướng dẫn áp dụng chưa yêu cầu delegation.

Khi kết thúc, nêu tài liệu/file đã thay đổi, lý do, cách kiểm tra và điều kiện còn thiếu. Phân biệt thiết kế đề xuất, code đã tạo và hệ thống đã được kiểm chứng. Không đổi pending decision thành accepted nếu chưa có căn cứ trong phiên làm việc.
