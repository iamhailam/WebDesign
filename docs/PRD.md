# Yêu cầu sản phẩm bán lẻ đa thương hiệu

Phiên bản thiết kế 1.0 — 19/11/2026, Asia/Bangkok. Trạng thái: bản thiết kế để review, chưa triển khai. Nguồn: [SPEC](../SPEC.md), [audit](WORKSPACE_AUDIT.md), yêu cầu người dùng và bảy ảnh trong workspace.

## 1. Mục tiêu và nguồn yêu cầu

Xây dựng trải nghiệm mua hàng chuyên nghiệp cho một đơn vị bán lẻ B2C: nhiều thương hiệu, nhiều danh mục, một kho vật lý và thanh toán COD. Nhân viên xử lý đơn, nhập kho, khuyến mãi và báo cáo trong cùng hệ thống có phân quyền. Tính đúng của đơn, kho và voucher quan trọng hơn số lượng tính năng trang trí.

Quy ước áp dụng xuyên suốt bộ tài liệu:

| Nhãn | Ý nghĩa | Cách xử lý |
| --- | --- | --- |
| G | Yêu cầu gốc, dẫn mục SPEC | Bắt buộc; không thay đổi âm thầm |
| U | Ràng buộc người dùng bổ sung | Bắt buộc trong phạm vi thiết kế hiện tại |
| D | Phương án thiết kế/đề xuất làm rõ | Có thiết kế cụ thể để review; quyết định pending nằm trong DECISIONS |
| O | Mở rộng tùy chọn ngoài bản phát hành đầu | Không nằm trong backlog cam kết |

Yêu cầu mới không sửa bản SPEC nguyên văn. Nếu D mâu thuẫn G, phải duyệt quyết định tương ứng trước migration/API phụ thuộc; thiết kế dưới đây dùng phương án khuyến nghị nhất quán để đánh giá, không giả định đã được chủ sản phẩm chấp thuận.

Mục tiêu đo nghiệm thu: không bán vượt tồn, không dùng vượt voucher, không hoàn kho kép; lịch sử giá không thay đổi; mỗi vai trò chỉ thao tác đúng tài nguyên; khách tìm và đặt được một SKU hợp lệ trên mobile và desktop. Không đặt KPI chuyển đổi/doanh thu giả khi chưa có dữ liệu thực tế.

## 2. Phạm vi và tác nhân

Khách chưa đăng nhập có thể xem catalog, thương hiệu, danh mục và chi tiết. Theo G, giỏ/checkout/đơn cá nhân dành cho CUSTOMER đã đăng nhập; không guest checkout. SALES xử lý đơn; WAREHOUSE nhập và xem sổ kho; MARKETING quản lý voucher và báo cáo; ADMIN quản lý vận hành. ADMIN không tự động có quyền checkout của CUSTOMER.

Loại trừ bắt buộc: marketplace/seller/payout/commission, online payment/gateway, AI recommendation, multi-warehouse, tích hợp hãng vận chuyển, tự động hoàn tiền/đổi trả sau DELIVERED. Không thêm stock reservation, quản lý nhà cung cấp, loyalty, đánh giá sản phẩm, wishlist, newsletter hoặc blog vào phạm vi hiện tại. Banner chỉ là nội dung giới thiệu, không tạo một hệ thống marketing automation.

## 3. Yêu cầu chức năng và truy vết

Mức Must là yêu cầu phát hành sau khi các D liên quan được chốt; không phải bằng chứng tính năng đã tồn tại.

| ID | Nguồn | Yêu cầu và quy tắc chính | Tiêu chí nghiệm thu |
| --- | --- | --- | --- |
| FR-01 | G §4–5 | Đăng ký CUSTOMER, đăng nhập JWT, lấy hồ sơ; không nhận role từ đăng ký | Email trùng bị từ chối; mật khẩu không lộ; tài khoản inactive bị chặn |
| FR-02 | G §5–6, U | Catalog: tìm tên, danh mục, giá, còn hàng; thêm lọc brand/type, phân trang/sắp xếp (D) | Cùng một SKU phải thỏa đồng thời price và in_stock; URL giữ filter |
| FR-03 | G §2,6; U | Chi tiết product có brand, gallery, SKU, giá và tồn hiện tại | Chỉ tổ hợp SKU tồn tại được chọn; tồn 0 khóa nút thêm |
| FR-04 | U, D-02 | SKU cho quần áo, giày, túi, đồng hồ, phụ kiện, nước hoa | Không yêu cầu size giả cho nước hoa; tổ hợp trùng bị DB từ chối |
| FR-05 | G §2,5–6 | Giỏ theo user, cộng dồn/thay số lượng/xóa; thêm giỏ không trừ kho | Một dòng/cart/SKU; số lượng dương; vượt tồn được cảnh báo |
| FR-06 | G §3,5; D-04 | Preview voucher từ giỏ server, chưa giữ lượt | Hết hạn/không đủ giá trị/đã dùng bị từ chối; preview không tăng used_count |
| FR-07 | G §3,5–7; D-01,03,05 | Checkout toàn giỏ COD, snapshot giá bán, kiểm tra lại giá và tồn | Atomic: đơn, items, kho, log, voucher và xóa giỏ cùng commit/rollback |
| FR-08 | G §3,7; D-03 | Tranh tồn/voucher dưới tải đồng thời | 5 giỏ độc lập tranh tồn 1: đúng 1 HTTP 201, 4 HTTP 409 |
| FR-09 | G §5–6 | Đơn cá nhân theo trạng thái, chi tiết giá lịch sử | CUSTOMER không xem/hủy đơn của người khác; không tính lại từ giá hiện tại |
| FR-10 | G §3–6; D-06 | Hủy PENDING/CONFIRMED; hoàn kho/voucher một lần | Hủy lần hai trả 409 theo phương án giữ G; số dư không đổi |
| FR-11 | G §5–6; D-07 | SALES/ADMIN duyệt tuần tự PENDING→CONFIRMED→SHIPPING→DELIVERED | DB chặn nhảy bước; DELIVERED và PAID cùng transaction |
| FR-12 | G §3–6 | Nhập kho và sổ cái IMPORT/EXPORT_ORDER/RETURN_CANCEL | Nhập >0; mọi biến động có actor, thời gian, reference; không sửa log |
| FR-13 | G §4–6 | ADMIN quản lý products/SKUs/categories, tạo SKU tự sinh inventory 0 | Không xóa SKU có lịch sử; deactivation không làm mất đơn cũ |
| FR-14 | U; D-08 | ADMIN quản lý brands; một product thuộc một brand và một category | Slug/code duy nhất; brand inactive không nhận checkout mới |
| FR-15 | U; D-08 | Gallery product_images cho product hoặc SKU, alt, thứ tự, ảnh chính | Ảnh SKU phải cùng product; chỉ một primary/product hoặc SKU |
| FR-16 | U; D-01 | SKU có giá bán price và giá niêm yết list_price tùy chọn | list_price null hoặc ≥price; snapshot unit_price là giá bán, voucher tính trên giá bán |
| FR-17 | G §3–6 | MARKETING/ADMIN tạo/sửa/ngừng voucher, xem usages | Không sửa used_count qua API; giảm limit không dưới used_count |
| FR-18 | U; D-09 | Banners theo vị trí/lịch, desktop/mobile và đích nội bộ | Chỉ hiện trong lịch active; không chèn JS/HTML hoặc link tùy ý |
| FR-19 | G §4,6; D-10 | ADMIN quản lý users, role, active; không cấp quyền qua UI ẩn là đủ | Role/inactive có hiệu lực request sau; không tự khóa/hạ quyền admin cuối |
| FR-20 | G §3,5–6; D-11 | Revenue theo ngày/tháng và top product/SKU từ DELIVERED | Không tính PENDING/CANCELLED; không nhân doanh thu do join items |
| FR-21 | G §3–4 | RBAC 5 vai trò; roles DB độc lập roles ứng dụng | Kiểm thử allow và deny cho mọi endpoint; DB runtime không là owner |
| FR-22 | G §7 | Seed demo và benchmark 50k–100k orders/order_items | Có EXPLAIN (ANALYZE, BUFFERS) trước/sau index, fixture tách dữ liệu thật |
| FR-23 | G §3; D-12 | Migration SQL, roles và backup/restore | Restore sang DB rỗng kiểm tra row counts, FK, functions, quyền và đơn mẫu |
| FR-24 | D-13 | Audit thay đổi nhạy cảm: đơn, kho, voucher, giá, quyền, nội dung | Log append-only cùng transaction; không chứa password/JWT |

## 4. Hành trình và quy tắc thương mại

Khám phá Home → danh mục/thương hiệu → catalog có filter → product → chọn toàn bộ thuộc tính bắt buộc → thêm SKU → giỏ → preview voucher → xác nhận thông tin COD → checkout → đơn thành công. Trang thành công chỉ lấy đơn đã commit, không suy diễn từ giỏ trống.

Giá/stock trên màn hình là thời điểm đọc. Cart không giữ giá, không giữ kho. Checkout so sánh cart_version và expected_items với dữ liệu hiện hành; thay đổi giá/giỏ trả 409 để khách xem lại. Voucher tối đa một mã trên đơn, không cộng chồng; không có giảm giá theo seller/brand ở phiên bản này. Preview không cam kết lượt còn.

D-01 đề xuất VND, làm tròn half-up đến đồng ở phép giảm phần trăm; NUMERIC(12,2) vẫn giữ theo G, tiền VND có .00. Phí ship 0 cho bản đầu, không cộng thuế/phí ngầm. Đây là giả định cần chốt; nếu thu phí ship phải mở lại thiết kế tổng tiền và UI trước triển khai.

Một product có ít nhất một SKU để bán; một SKU có một inventory. Product, brand, category và SKU phải active khi mua; dữ liệu inactive vẫn xuất hiện trong đơn lịch sử. Không xóa đơn, order_items, usages hoặc log kho bằng UI. Khách vẫn hủy được đơn hợp lệ chứa SKU đã inactive.

## 5. Ma trận quyền

PUBLIC là trạng thái chưa đăng nhập, không phải role DB/role ứng dụng thứ sáu.

| Chức năng | PUBLIC | CUSTOMER | SALES | WAREHOUSE | MARKETING | ADMIN |
| --- | --- | --- | --- | --- | --- | --- |
| Xem catalog/brands/banners public | Có | Có | Có | Có | Có | Có |
| Giỏ, preview, checkout | Không | Cá nhân | Không | Không | Không | Không |
| Xem đơn cá nhân/hủy của mình | Không | Có | Không | Không | Không | Không |
| Danh sách/chi tiết mọi đơn, chuyển trạng thái/hủy hộ | Không | Không | Có | Không | Không | Có |
| Tồn kho và giao dịch kho | Không | Không | Không | Có | Không | Có |
| Nhập kho | Không | Không | Không | Có | Không | Có |
| Voucher và báo cáo | Không | Chỉ available/preview | Không | Không | Có | Có |
| Products/SKU/category/brand/images | Không | Không | Không | Không | Không | Có |
| Banners | Không | Không | Không | Không | Không | Có (D-09) |
| Users/role/active và audit | Không | Không | Không | Không | Không | Có |

WAREHOUSE thấy mã đơn tham chiếu sổ kho, không được mở chi tiết địa chỉ/điện thoại đơn. MARKETING xem usage với user_id/email che bớt, không xem địa chỉ giao hàng. ADMIN không được chuyển đơn kết thúc hoặc sửa giá lịch sử.

## 6. Yêu cầu phi chức năng

Mọi ngưỡng mới là mục tiêu đề xuất D-12/D-14, không phải số đo hiện trạng.

| ID | Nguồn | Yêu cầu | Cách kiểm chứng |
| --- | --- | --- | --- |
| NFR-01 | G | Atomicity, nonnegative inventory/money, uniqueness voucher, snapshots bất biến | Test DB trực tiếp, rollback món 2, hủy song song và tranh chấp |
| NFR-02 | G,U | React Vite TS, Express TS, PostgreSQL SQL/PLpgSQL; không ORM | Manifest/review; không truy cập DB từ browser; typecheck strict |
| NFR-03 | G,D-10 | JWT xác minh chữ ký/exp/issuer/audience, hash mật khẩu adaptive, SQL tham số hóa, kiểm tra role/active hiện hành | Test injection, token cũ khi role đổi, IDOR, không trả hash/stack |
| NFR-04 | D-14 | HTTPS khi deploy, CORS allowlist, giới hạn body/rate login và checkout, secret ngoài Git | Kiểm tra config và 429/413; không secret trong VITE_* |
| NFR-05 | G,D-14 | Catalog p95 ≤500ms, checkout p95 ≤1500ms ngoài tình huống cố ý chờ khóa | Load fixture 100k orders, 10k SKU, 20 phiên đồng thời, warm DB; ghi CPU/RAM/DB/network; chưa cam kết SLA |
| NFR-06 | D-14 | LCP ≤2,5s, CLS ≤0,1 ở mobile profile đã công bố | Lighthouse/field khi có; ảnh có width/height, lazy dưới fold, không preload mọi ảnh |
| NFR-07 | D-14 | Không mất đơn do retry, không timeout vô hạn | Idempotency test, bounded lock/statement timeout, process restart sau commit |
| NFR-08 | D-12 | Backup hằng ngày, mục tiêu RPO 24h/RTO 4h cho demo pilot | Restore rehearsal có thời gian; production SLO phải chốt lại |
| NFR-09 | D-14 | Bàn phím, focus, label, contrast 4,5:1 text, không chỉ dựa màu; mục tiêu WCAG 2.2 AA | Accessibility audit các màn hình chính; không tuyên bố chứng nhận |
| NFR-10 | U,D-14 | 360px mobile đến 1440px desktop; Chrome/Edge/Firefox và Safari bản được chọn khi QA | Không scroll ngang trang, thao tác cảm ứng ≥44px, bảng admin có vùng cuộn riêng |
| NFR-11 | D-13 | Request ID, structured log, metric errors/latency/pool/locks, audit mutation | Trace lỗi HTTP→DB không lộ PII; dashboard vận hành tối thiểu |
| NFR-12 | D-12 | Migration tái lập, seed xác định, tests tách DB; backup trước thay đổi destructive | Chạy fresh install/upgrade/restore; không sửa migration đã áp dụng |
| NFR-13 | D-14 | Tiếng Việt, VND theo D-01, lưu TIMESTAMPTZ UTC, hiển thị Asia/Ho_Chi_Minh | Test ranh giới ngày/tháng; input/output ISO8601 có timezone |
| NFR-14 | D-14 | URL ổn định, title/meta theo product; SPA có giới hạn SEO | Kiểm tra deep-link reload; SSR/prerender là O, không âm thầm đổi stack |

## 7. Ranh giới mở rộng

Brands/images/banners/pricing/SKU đa loại là nội dung người dùng yêu cầu thiết kế (U), nhưng cấu trúc bảng, vai trò quản lý và chính sách cụ thể vẫn là D. Idempotency, audit và mô hình bảo mật DB chặt hơn là D bổ sung để đạt an toàn dữ liệu. Không suy ra các tính năng này đã có trong DOCX.

O chưa lập lịch: CMS bài viết, newsletter, wishlist, reviews, lưu nhiều địa chỉ, refresh-token dài hạn, CDN upload service, SSR, lịch giảm giá tự động, voucher theo brand/category và guest cart. Mọi mục O cần PRD thay đổi trước khi thêm task.

## 8. Tài liệu triển khai và cổng nghiệm thu

Đọc tiếp [DECISIONS](DECISIONS.md), [ARCHITECTURE](ARCHITECTURE.md), [DATABASE_DESIGN](DATABASE_DESIGN.md), [API_CONTRACT](API_CONTRACT.md), [UI_DESIGN_SPEC](UI_DESIGN_SPEC.md), [TASKS](../TASKS.md). Backlog nối FR/NFR tới task và test.

Release chỉ nghiệm thu khi 4 nhóm test của SPEC đạt, RBAC deny/allow đạt, snapshot/giá/thuộc tính đúng, build/typecheck và E2E đạt, quyết định chặn schema đã duyệt, môi trường DB và restore có bằng chứng. Bộ tài liệu này không xác nhận đã chạy các kiểm thử đó.
