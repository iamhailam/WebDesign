# Kiểm tra workspace dự án bán lẻ thời trang

Ngày kiểm tra: 19/11/2026 (Asia/Bangkok).
Workspace: `C:\Đồ án CSDL`.

## 1. Kết luận và phạm vi

Workspace đang ở giai đoạn đầu vào tài liệu: có 8 file gốc, không có thư mục con tại thời điểm bắt đầu, chưa có mã nguồn hay cấu hình dự án. Đã đọc toàn bộ nội dung đặc tả và xem trực tiếp 7 ảnh. Có đủ đầu vào để phân tích kiến trúc; chưa đủ môi trường và quyết định nghiệp vụ để xác nhận ứng dụng có thể chạy.

Trong task này chỉ tạo mới `SPEC.md` và báo cáo này. Không tạo ứng dụng, không cài dependency/công cụ, không khởi tạo Git, không chạy migration/seed, không tạo database, không di chuyển hoặc chỉnh sửa file gốc. Cấu trúc monorepo ở mục 7 chỉ là đề xuất.

Phạm vi kiểm tra là workspace được cung cấp và các công cụ hệ thống liên quan. Không có dấu hiệu cấu hình Antigravity trong workspace; chưa xác minh phiên bản, extension hay thiết lập IDE bên ngoài workspace.

## 2. Kiểm kê workspace ban đầu

| File | Dung lượng byte | Vai trò |
| --- | ---: | --- |
| ĐẶC TẢ KỸ THUẬT SẢN PHẨM.docx | 28.442 | Nguồn nghiệp vụ gốc |
| styleweb.png | 240.615 | Tham chiếu giao diện |
| sanphamdemo1.jpg | 425.231 | Ảnh sản phẩm mẫu |
| sanphamdemo2.jpg | 33.576 | Ảnh sản phẩm mẫu |
| sanphamdemo3.jpg | 52.611 | Ảnh sản phẩm mẫu |
| sanphamdemo4.jpg | 65.732 | Ảnh sản phẩm mẫu |
| sanphamdemo5.jpg | 80.542 | Ảnh sản phẩm mẫu |
| sanphamdemo6.jpg | 274.143 | Ảnh sản phẩm mẫu |

Đã đối chiếu danh sách từ `rg --files --hidden` và `Get-ChildItem -Force -Recurse`. Không có file ẩn, Git repository, AGENTS.md trong workspace hoặc ở gốc C:, package.json, lockfile, tsconfig, Vite/Express config, SQL/migration, Dockerfile/Compose, .env, README hay test. Vì chưa có mã nguồn, không có dependency tree, build, lint hoặc test ứng dụng để chạy.

## 3. Đặc tả và kết quả chuyển đổi

Nguồn: [ĐẶC TẢ KỸ THUẬT SẢN PHẨM.docx](../ĐẶC%20TẢ%20KỸ%20THUẬT%20SẢN%20PHẨM.docx).
Bản Markdown: [SPEC.md](../SPEC.md).

Đọc trực tiếp gói OOXML ở chế độ chỉ đọc, gồm document.xml, numbering.xml và quan hệ tài liệu. Nội dung thân tài liệu có 240 đoạn (bao gồm đoạn trống và đoạn trong bảng), 351 nút văn bản và 2 bảng. Không có tracked insert/delete, hình nhúng, phần comments, footnotes hoặc endnotes trong gói; không có hyperlink ngoài trong document relationships.

Bản chuyển đổi giữ nội dung theo thứ tự nguồn, tiêu đề các mục 1–7 và tiểu mục, danh sách với cấp lồng và số thứ tự từ numbering.xml, cây thư mục trong khối text, bảng 12 thực thể và ma trận phân quyền. Đã kiểm tra từng đoạn nguồn không rỗng xuất hiện nguyên văn trong Markdown sau khi quy đổi escape bảng và xuống dòng ô. Không tự sửa yêu cầu dù có điểm chưa rõ.

Đây là kiểm tra và chuyển nội dung, không phải kiểm định bố cục trang Word; chưa render DOCX sang trang ảnh. File DOCX gốc được giữ nguyên. Nhận xét và đề xuất chỉ nằm trong báo cáo này, không đưa vào phần yêu cầu gốc của SPEC.md.

### Các yêu cầu đã xác nhận từ nguồn

- B2C, một cửa hàng, một kho vật lý, thanh toán COD; không đa nhà bán/đa kho.
- Database-Centric: SQL/PLpgSQL thuần, PostgreSQL thực thi tính toàn vẹn, transaction, khóa đồng thời, giá lịch sử và quy tắc nghiệp vụ; không ORM.
- Migration bằng node-pg-migrate với SQL thuần; Express dùng pg Pool và tham số $1, $2…; React SPA chỉ gọi REST API.
- 12 bảng: users, categories, products, product_variants, inventory, inventory_transactions, carts, cart_items, orders, order_items, vouchers, voucher_usages.
- 5 vai trò ứng dụng: CUSTOMER, SALES, WAREHOUSE, MARKETING, ADMIN. 3 tài khoản DB: app_rw_user, report_ro_user, db_admin.
- Checkout nguyên tử, khóa SKU theo variant_id tăng dần, khóa voucher, chốt unit_price lịch sử, ghi sổ kho và giải phóng giỏ khi thành công.
- Chỉ hủy PENDING/CONFIRMED, khóa đơn, chống hoàn kho kép, RELEASED lượt voucher và giảm used_count khi hủy hợp lệ.
- fn_calculate_voucher_discount, fn_place_order, fn_cancel_order; sp_import_inventory; hai trigger bảo vệ đơn/cập nhật timestamp; hai view doanh thu/bán chạy; index FK, composite và partial index.
- API Auth, Products/Categories/Variants, Cart, Orders, Inventory, Vouchers, Reports; JSON thống nhất và xử lý lỗi nghiệp vụ.
- Storefront: catalog, chi tiết chọn màu/size, cart/checkout COD, đơn cá nhân. Back-office: đơn hàng, kho, voucher, sản phẩm/tài khoản, dashboard theo vai trò.
- Bốn nhóm kiểm thử bắt buộc: tranh chấp tồn kho, tranh chấp voucher, rollback/chống hoàn kho kép, benchmark index với 50.000–100.000 đơn và chi tiết.
- Ngoài phạm vi: cổng thanh toán thật, API vận chuyển bên thứ ba, đa kho/đa nhà bán, tự động hoàn tiền/đổi trả sau giao và AI gợi ý.

React + Vite + TypeScript và Express + TypeScript là ràng buộc bổ sung trong yêu cầu của người dùng. DOCX chỉ nêu React/Express/Node, chưa chỉ định Vite/TypeScript; vì vậy không chèn bổ sung vào bản chuyển nguyên văn.

## 4. Công cụ và môi trường

| Thành phần | Kết quả quan sát | Đánh giá |
| --- | --- | --- |
| Git | git version 2.56.0.windows.4; C:\Program Files\Git\cmd\git.exe | CLI chạy được |
| Git repository | rev-parse, status và remote đều báo “not a git repository” | Chưa có repository; chưa có branch/commit/remote để báo cáo |
| Node.js | v26.13.0; C:\Program Files\nodejs\node.exe | Runtime chạy được; chưa xác minh tương thích dependency vì chưa có manifest |
| npm | 11.20.0 qua npm và npm.cmd | CLI chạy được; npm.cmd có tại C:\Program Files\nodejs\npm.cmd |
| Docker CLI / Compose | Không có docker trong PATH; không chạy được docker --version / docker compose version | Chưa có môi trường Docker được xác nhận |
| PostgreSQL client | psql và pg_isready không có trong PATH | Chưa xác nhận client/version |
| PostgreSQL server | Không thấy dịch vụ/process liên quan hoặc listener 5432/5433 | Chưa xác nhận server local đang chạy |
| Docker daemon | Không thấy service/process liên quan hoặc listener 2375/2376 | Chưa xác nhận daemon; không kiểm tra được docker info |

Đã kiểm tra thêm thư mục C:\Program Files\Docker, C:\Program Files\PostgreSQL, C:\Program Files (x86)\PostgreSQL và %LOCALAPPDATA%\Docker: đều không tồn tại. Không thấy mục cài Docker/PostgreSQL trong các khóa Uninstall HKLM 64-bit/32-bit và HKCU; không có dịch vụ hoặc process postgres.exe, dockerd.exe, com.docker.backend.exe ở thời điểm kiểm tra.

Các bằng chứng trên chưa loại trừ bản portable, WSL, container/runtime khác, server cổng khác hoặc PostgreSQL từ xa. Không có thông tin kết nối trong workspace; chưa kiểm tra đăng nhập, SELECT version(), PL/pgSQL, quyền role, migration hay backup/restore. Không đọc hoặc ghi thông tin bí mật hệ thống.

Không kết luận Node hiện tại phù hợp mọi dependency; cần chốt phiên bản dự án và kiểm tra khi có manifest/lockfile. Audit không chọn phiên bản thư viện mới nhất và không cài đặt thử.

## 5. Phân tích styleweb.png

### Quan sát trực tiếp

- PNG hợp lệ, giải mã được; kích thước thực 122 × 1636 px, tỷ lệ cao/rộng khoảng 13,41. Đây là ảnh trang dài thu nhỏ, không phải bằng chứng rằng giao diện gốc dùng viewport 122 px.
- Phong cách trang bán lẻ nhiều ngành hàng: nền chủ đạo trắng/sáng, chữ tối, giá và nhãn khuyến mãi màu đỏ, điểm nhấn vàng/cam ở một số vùng.
- Đầu trang có vùng điều hướng/tìm kiếm rất nhỏ, banner khuyến mãi chính và các lối tắt danh mục dạng biểu tượng.
- Nội dung có nhiều hàng sản phẩm theo nhóm, xen banner quảng bá, dải logo thương hiệu; thẻ gồm ảnh, tên nhiều dòng, giá và nhãn giảm giá. Lưới có vẻ khoảng 5 cột trong nhiều vùng, nhưng không đủ độ nét để coi đây là thông số bắt buộc.
- Cuối trang có vùng nội dung dạng tin/bài viết, mô tả cửa hàng, cam kết/dịch vụ, đăng ký nhận tin, nhiều cột liên kết và logo hỗ trợ/thanh toán.
- Ảnh có nước hoa, phụ kiện và thời trang. Các nhóm xuất hiện trong ảnh chỉ là tham chiếu hình thức, không tự mở rộng danh mục nghiệp vụ từ đặc tả.

### Cách áp dụng đề xuất cho lần triển khai sau

Giữ nền sáng, bố cục thương mại rõ ràng, ảnh sản phẩm nổi bật, giá dễ đọc, danh mục và thương hiệu dễ tìm. Dùng chung product card và product section; catalog có bộ lọc theo SPEC, trang chi tiết có pill màu/size và trạng thái tồn kho.

Cần thiết kế responsive riêng; chưa có ảnh mobile, trạng thái hover/focus, empty/loading/error, giỏ hàng, checkout, chi tiết sản phẩm hoặc back-office trong ảnh này. Không suy ra chính xác font, cỡ chữ, mã màu, spacing, container width, breakpoint hoặc hành vi sticky từ ảnh 122 px. Cần ảnh gốc độ phân giải cao hoặc bộ thiết kế nếu muốn tái hiện sát.

Các khối nhận tin, tin tức, carousel quảng bá hoặc logo thanh toán trong ảnh chưa phải yêu cầu chức năng của DOCX; chỉ đưa vào sau khi chốt phạm vi. COD vẫn là phương thức thanh toán được đặc tả.

## 6. Kiểm tra ảnh sản phẩm

Cả 6 file đều giải mã thành JPEG, đúng đuôi, PixelFormat 24bpp RGB, kích thước khác 0; đã xem trực tiếp từng ảnh. SHA-256 khác nhau nên không có bản trùng byte. Đây không phải kiểm tra perceptual hash hay bằng chứng về chất lượng hàng hóa.

| File | Kích thước px | Dung lượng byte | Nội dung nhìn thấy và lưu ý |
| --- | --- | ---: | --- |
| sanphamdemo1.jpg | 1282 × 1528 | 425.231 | Áo phao màu đỏ/tím trầm, logo The North Face; ảnh chụp trên móc, có nền cửa hàng và gương |
| sanphamdemo2.jpg | 768 × 768 | 33.576 | Người mẫu mặc hoodie kem/trắng, logo adidas; ảnh vuông, nền sáng |
| sanphamdemo3.jpg | 800 × 800 | 52.611 | Áo varsity đen, viền tím, chữ LAKERS, dấu Nike và NBA; nền trắng |
| sanphamdemo4.jpg | 1280 × 1280 | 65.732 | Hoodie trắng/kem, chữ GIVENCHY PARIS đỏ; nền trắng |
| sanphamdemo5.jpg | 1280 × 1280 | 80.542 | Hoodie đỏ, chữ GIVENCHY PARIS tối; tương tự ảnh 4 về thiết kế |
| sanphamdemo6.jpg | 2560 × 2560 | 274.143 | Áo khoác thể thao trắng/kem, xanh đậm, sọc đỏ; dấu adidas và huy hiệu FC Bayern |

Tên/logo được mô tả theo hình nhìn thấy, chưa phải metadata sản phẩm được xác nhận. Không suy diễn giá, hàng chính hãng, SKU, chất liệu, size hoặc số lượng từ hình.

Ảnh 4 và 5 có thể đại diện hai màu của cùng sản phẩm, nhưng cần xác nhận trước khi gộp thành variants. Sáu ảnh không mặc nhiên tương ứng sáu sản phẩm độc lập.

Đề xuất hiển thị ảnh trong khung thống nhất, object-fit: contain cho thẻ để tránh cắt áo; kiểm tra riêng ảnh 1 có nền phức tạp. Ảnh JPEG không có nền trong suốt. Tạo thumbnail/WebP/AVIF ở bước triển khai nếu cần, giữ file gốc; chưa chuyển đổi ảnh trong audit này. Chưa có gallery nhiều góc cho mỗi sản phẩm.

Dữ liệu seed còn thiếu: ánh xạ product–brand–category–variant–image, tên/mô tả chính thức, màu, size, SKU duy nhất, giá, tồn kho khởi tạo và alt text. Không lấy tên file làm mã SKU nghiệp vụ.

## 7. Cấu trúc monorepo đề xuất

Giữ tên database/backend/frontend theo cấu trúc đã có trong đặc tả. Dùng npm workspaces cho backend và frontend; không cần thêm công cụ điều phối monorepo ở bước đầu. Root workspace hiện tại đóng vai trò fashion-ecommerce/, không cần tạo thêm một tầng thư mục hoặc di chuyển tài liệu gốc.

Toàn bộ cây dưới đây là đề xuất tương lai; chỉ SPEC.md, docs/WORKSPACE_AUDIT.md và 8 file đầu vào hiện tồn tại.

```text
<workspace>/
├── SPEC.md
├── ĐẶC TẢ KỸ THUẬT SẢN PHẨM.docx        # giữ nguồn gốc
├── styleweb.png                       # giữ tham chiếu
├── sanphamdemo1.jpg … sanphamdemo6.jpg  # giữ ảnh gốc
├── docs/
│   ├── WORKSPACE_AUDIT.md
│   ├── architecture.md
│   ├── api-contract.md
│   ├── data-dictionary.md
│   └── decisions/                     # quyết định làm rõ đặc tả
├── database/
│   ├── migrations/                    # SQL tables, constraints, functions, triggers, views, indexes
│   ├── seeds/                         # seed demo tách seed benchmark 50k–100k
│   ├── tests/                         # invariants, roles, transaction, DB objects
│   └── roles_backup.sql               # roles và hướng dẫn backup/restore theo SPEC
├── backend/
│   ├── src/
│   │   ├── config/                    # env validation, pg Pool
│   │   ├── middlewares/               # JWT, RBAC, validation, error mapping
│   │   ├── controllers/
│   │   ├── services/                  # SQL tham số hóa, gọi DB functions/procedures
│   │   ├── routes/
│   │   ├── types/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── tests/                         # API integration và concurrency
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── public/images/products/        # bản dùng web được sao chép/tối ưu sau
│   ├── src/
│   │   ├── pages/storefront/
│   │   ├── pages/admin/
│   │   ├── components/
│   │   ├── layouts/
│   │   ├── context/                   # Auth, Cart
│   │   ├── api/                       # REST client, không truy cập DB
│   │   ├── styles/
│   │   ├── types/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── tests/
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── tests/e2e/
├── scripts/                           # kiểm tra môi trường, benchmark, backup helpers
├── package.json                       # npm workspaces backend/frontend
├── package-lock.json
├── tsconfig.base.json
├── .env.example                       # giá trị mẫu, không chứa secret
├── .gitignore
├── compose.yaml                       # tùy chọn nếu chọn Docker
└── README.md
```

Ranh giới trách nhiệm:

- Frontend xử lý giao diện và trạng thái trải nghiệm; server xác thực mọi request và kiểm tra quyền trên tài nguyên.
- Backend không lặp lại nghiệp vụ checkout/hủy đơn trong nhiều truy vấn rời rạc. Một transaction phải dùng cùng pg client; nếu cần nhiều câu lệnh thì BEGIN/COMMIT/ROLLBACK trên client đó.
- Database kiểm soát invariant, khóa, giá lịch sử và luồng nghiệp vụ; migration có phiên bản, không chỉnh sửa migration đã áp dụng.
- node-pg-migrate điều phối SQL thuần đúng yêu cầu nguồn; cần kiểm chứng cơ chế SQL migration/up-down và scripts khi chốt phiên bản. Không thêm ORM.
- Chỉ tách package hợp đồng dùng chung khi có nhu cầu thật; tuyệt đối không đưa cấu hình DB/secret vào bundle Vite.
- Demo seed và benchmark seed phải tách môi trường, không chạy tự động benchmark trên dữ liệu thật.

## 8. Các điều kiện còn thiếu và điểm cần chốt

### Môi trường triển khai

| Mức | Điều kiện | Việc cần thực hiện sau audit |
| --- | --- | --- |
| Chặn chạy nghiệp vụ DB | Chưa có PostgreSQL được xác nhận và thông tin kết nối | Chọn PostgreSQL local/remote hoặc qua Docker; chốt version, database và kiểm tra kết nối/PLpgSQL |
| Chặn xác minh phân quyền DB | Chưa có 3 role và migration | Thiết lập app_rw_user/report_ro_user/db_admin, kiểm tra quyền bảng/view/function/sequence/schema |
| Cần trước quản lý thay đổi code | Workspace chưa có Git repository | Khởi tạo Git và chọn remote nếu cần ở task sau |
| Cần trước build | Chưa có manifest/lockfile/config | Chốt Node/npm và dependency versions; tạo cấu hình React–Vite–TS, Express–TS, pg, node-pg-migrate ở task triển khai |
| Nếu chọn container | Docker CLI/Compose/daemon chưa được xác nhận | Cài và kiểm tra Docker hoặc chọn PostgreSQL native/remote; Docker không phải điều kiện bắt buộc nếu dùng phương án khác |
| Cần trước chạy API/web | Chưa có cấu hình runtime | Định nghĩa DB connection, JWT secret/TTL, API/web port, CORS và biến Vite chỉ chứa dữ liệu công khai |

Không yêu cầu người dùng gửi mật khẩu trong chat; cấu hình bí mật tại môi trường chạy sau.

### Nghiệp vụ và hợp đồng cần làm rõ

1. **Đa thương hiệu:** người dùng nêu multi-brand nhưng 12 bảng chưa có brands/brand_id, API quản lý/lọc thương hiệu cũng chưa có. Cần quyết định cách mô hình hóa và ghi nhận thay đổi đặc tả trước khi thêm schema. Đa thương hiệu vẫn có thể thuộc một nhà bán và một kho, không biến thành marketplace.
2. **Dữ liệu demo:** cần xác nhận ảnh 4/5 thuộc cùng product hay hai product; cung cấp hoặc cho phép tạo dữ liệu demo minh họa cho giá/size/SKU/tồn kho. Không tự coi ảnh là dữ liệu nghiệp vụ đầy đủ.
3. **Chuyển trạng thái đơn:** nguồn mô tả luồng một chiều ở API/UI, trigger hiện chỉ chặn đơn kết thúc. Cần xác định DB function/trigger bảo đảm các bước hợp lệ và DELIVERED đồng thời PAID, để không thể bỏ qua bằng UPDATE trực tiếp.
4. **Quyền trên tài nguyên:** CUSTOMER chỉ xem/hủy đơn của mình; p_actor_id phải gắn với danh tính đã xác thực, không tin body. Cần chốt kiểm tra role/is_active, cách backend truyền actor và quyền EXECUTE ở tầng DB.
5. **Idempotency:** fn_cancel_order được gọi “Idempotent” nhưng mô tả yêu cầu báo lỗi khi đã CANCELLED. Giữ nguyên nguồn; cần chốt HTTP cho lần hủy lặp (báo lỗi hay trả kết quả cũ), trong mọi trường hợp kho/voucher chỉ hoàn một lần.
6. **Đồng thời:** checkout khóa inventory trước voucher; cần cùng thứ tự khóa cho hủy/nhập/chỉnh kho và xử lý deadlock. Cần chốt bảo vệ cùng giỏ bị checkout đồng thời, biến động giá/giỏ trong lúc đặt, retry request và đơn trùng. Test 5 request tranh tồn cần fixture giỏ hợp lệ độc lập để đo đúng tranh tồn.
7. **Hoàn kho nhiều SKU:** mỗi log RETURN_CANCEL phải gắn đúng reference_type/order và từng variant; kiểm tra chống hoàn kho kép phải diễn ra ở cấp đơn trước vòng lặp. Không đặt UNIQUE(reference_id) đơn lẻ khiến đơn nhiều SKU không ghi đủ log.
8. **Tiền/voucher:** cần chốt tiền tệ, quy tắc làm tròn NUMERIC(12,2), phí ship (schema chưa có trường riêng), giới hạn phần trăm/giá trị voucher và NULL/default. Công thức PERCENT trong nguồn có thể vượt subtotal nếu discount_value > 100 và max_discount_amount quá lớn; cần ràng buộc hoặc quyết định nghiệp vụ, không sửa lặng lẽ.
9. **Schema chi tiết:** nguồn mới liệt kê cột chính và một số ràng buộc; cần hoàn thiện NOT NULL/default, FK/delete policy còn thiếu, invariant tổng tiền, cách sinh order_code và bảo vệ lịch sử khi sửa/xóa sản phẩm hoặc order_items. Trigger chỉ trên orders chưa bảo vệ trực tiếp order_items.
10. **API còn thiếu:** UI/ma trận đòi quản lý tài khoản, gán role và danh mục nhưng chưa mô tả đầy đủ endpoint ghi tương ứng. Chưa rõ endpoint chi tiết đơn, phân trang/sắp xếp, filter báo cáo, kiểu payload/response và chữ ký SQL cụ thể (p_shipping_info).
11. **Functions/procedures:** tài liệu ghi CALL/SELECT fn_cancel_order trong API nhưng định nghĩa là Function. Cần thống nhất kiểu object và cú pháp gọi; function không tự COMMIT, lỗi phải rollback trong transaction caller.
12. **Mã lỗi:** nguồn chung cho phép 400 hoặc 409, nhưng test hết hàng yêu cầu đúng 409 và checkout thành công 201. Cần mapping SQLSTATE → HTTP/error code rõ, không lộ thông tin DB nội bộ khi trả lỗi.
13. **Bảo mật và DB roles:** app_rw_user có DML trực tiếp trong nguồn; cần xác định ràng buộc/trigger đủ để không vượt nghiệp vụ, quyền sequence/function, cách truy vấn báo cáo bằng report_ro_user và mô hình SECURITY INVOKER/DEFINER nếu dùng. Đây là thiết kế cần kiểm chứng, chưa có lỗ hổng mã nguồn để kết luận.
14. **Báo cáo và UI:** chốt timezone nhóm ngày/tháng, cách tính doanh thu/chiết khấu và xếp hạng; cần ảnh tham chiếu rõ hơn, tên/logo cửa hàng, quy tắc responsive và các màn hình chưa có mẫu.

Các điểm trên là khoảng trống hoặc rủi ro thiết kế cần giải quyết khi triển khai. Bản SPEC.md vẫn giữ nguyên nội dung gốc.

## 9. Điều kiện nghiệm thu bước triển khai sau

- Kết nối PostgreSQL thành công; migration/seed demo chạy được; phân quyền 5 vai trò ứng dụng và 3 role DB được kiểm tra.
- Build/typecheck/frontend/backend và API integration chạy được theo phiên bản đã khóa.
- Chứng minh 5 checkout cùng SKU tồn 1: 1 HTTP 201, 4 HTTP 409, kho về 0.
- Chứng minh 5 tài khoản tranh voucher còn 1 lượt: đúng 1 đơn áp voucher, used_count bằng usage_limit.
- Lỗi món thứ hai rollback cả đơn; hủy lặp không hoàn kho/voucher hai lần.
- Seed 50.000–100.000 đơn và order_items ở môi trường benchmark, lưu EXPLAIN (ANALYZE, BUFFERS) trước/sau index.
- Kiểm tra responsive và các trạng thái hết hàng, giỏ vượt tồn, voucher lỗi, phân quyền, loading/empty/error.

Các kiểm thử này chưa được chạy vì task hiện tại không tạo ứng dụng hoặc database.

## 10. Bảo toàn dữ liệu và bằng chứng

Các file mới được mở bằng chế độ CreateNew để thao tác thất bại nếu đường dẫn đã tồn tại. Không ghi đè tài liệu gốc. Bảng SHA-256 dưới đây ghi nhận 8 file đầu vào để đối chiếu sau audit.
| File | SHA-256 |
| --- | --- |
| ĐẶC TẢ KỸ THUẬT SẢN PHẨM.docx | 66E1813140A7198B40D3B8B68A9C73D7773BB3B110D8BAE3FA9AE695C0BD2DD5 |
| sanphamdemo1.jpg | 17EAE8E1B0C50E513C71FC2E443EA216EC80A1B199800CCC7ABCB008F648D4CD |
| sanphamdemo2.jpg | 833195BEB948D037BF64E17555354844FB383B0E19E5A05274707C0AE2675AB1 |
| sanphamdemo3.jpg | 9CC02850D08E6FEF294FC7640E3D6E6509AFE06C13342A72A0F297788C48644A |
| sanphamdemo4.jpg | 2500F1ACBB5E22EFBEE3D0FF4B73F7F830BE40D16E3AD0DAE19490B7BE1304DF |
| sanphamdemo5.jpg | 494DFBD675AAF8CBD0503C473FE580E235A123287ECEBBB0FCC06613D2E5A3AE |
| sanphamdemo6.jpg | 420D64DAAC8C2F9EEAC87BFC8A5AE188A58CDF6DBD6DD7903D59810DFE53778B |
| styleweb.png | 69128A6A0CD3A7761E452F93CF5F64977BA8D0C89A67DF1E5C4E32609E738AEE |
