# Thiết kế trải nghiệm và giao diện

Thiết kế review 1.0 — 19/11/2026. G/U theo [PRD](PRD.md); mọi token, breakpoint và bố cục dưới đây là đề xuất D-14. Tham chiếu hình thức là styleweb.png, nghiệp vụ vẫn theo SPEC và các quyết định được duyệt. Không có mockup bitmap hoặc code UI được tạo trong task này.

## 1. Phân tích đầu vào và hướng hình ảnh

Đã xem styleweb.png và sáu ảnh JPEG. styleweb.png rộng 122 × cao 1636 px, là trang thương mại dài được thu nhỏ: header/tìm kiếm, hero, danh mục icon, nhiều nhóm sản phẩm, banner xen kẽ, logo brand, nội dung và footer. Nền trắng, chữ tối, giá/khuyến mãi đỏ; vàng/cam xuất hiện ở vùng dịch vụ. Ảnh không đủ độ nét để trích font, khoảng cách hoặc kích thước layout gốc; không nhân kích thước ảnh thành viewport thật.

Hướng đề xuất: cửa hàng đa thương hiệu rõ ràng, ảnh và tên sản phẩm là trọng tâm; header gọn, tìm kiếm nổi bật, lối vào brands/categories dễ thấy, khoảng trắng đủ và thông tin giá/tồn minh bạch. Home có nhiều nhóm hàng nhưng không nhồi mọi SKU vào một trang. Không sao chép newsletter/blog/payment-logo chức năng từ ảnh khi chưa nằm trong PRD. Không tự bịa “chính hãng 100%”, chính sách miễn đổi trả hoặc miễn phí vận chuyển trên banner khi chủ cửa hàng chưa xác nhận.

## 2. Design tokens đề xuất

| Thành phần | Token đề xuất | Quy tắc |
| --- | --- | --- |
| Nền | page #FFFFFF; surface #F6F7F8 | Không nền gradient trang trí cạnh tranh sản phẩm |
| Chữ | primary #171717; secondary #525252 | Kiểm contrast thực tế với nền, không chữ xám quá nhạt |
| Màu chính | action #171717, text #FFFFFF | CTA thêm giỏ/đặt hàng; chỉ một CTA chính/vùng |
| Giá/khuyến mãi | #B91C1C | Không dùng màu đơn lẻ truyền đạt lỗi/giảm giá |
| Link/focus | #1D4ED8 | Focus outline 2px + offset 2px, không bị sticky che |
| Thành công/cảnh báo | #166534 / #92400E | Kèm icon và text; contrast được QA |
| Viền | #D4D4D4, radius 6px/10px | Pill options radius full; shadow nhẹ chỉ overlay |
| Font | system-ui có glyph Việt; body 16px, line-height 1.5 | Không tải font bên ngoài bắt buộc; labels 14px, H1 28/36px mobile/desktop |
| Spacing | 4,8,12,16,24,32,48,64px | Dùng scale nhất quán |
| Container | max-width 1280px; gutter 16/24/32px | Không dùng width cố định trên mobile |
| Controls | cao ≥44px; text ≥14px | Có label; disabled có giải thích |
| Motion | 120–180ms cho state nhẹ | Respect reduced-motion; hero không autoplay mặc định |

Breakpoint đề xuất: mobile <768, tablet 768–1023, desktop ≥1024; test tại 360/390/768/1024/1440px. Product grid: 2 cột mobile, 3 tablet, 4 desktop; Home có thể 5 cột từ 1280 nếu tên/giá còn đọc được, chốt sau QA. Catalog desktop sidebar 240px + grid; mobile bộ lọc là drawer. Không ép lưới theo ảnh 122px.

## 3. Sitemap storefront

| Route UI | Quyền | Nội dung và API chính |
| --- | --- | --- |
| / | PUBLIC | Home, banners, brands, categories, sections từ products |
| /products | PUBLIC | Catalog/search/filter/sort/page, GET /api/products |
| /categories/:slug | PUBLIC | Category landing dùng catalog với category_id đã resolve |
| /brands | PUBLIC | Danh sách thương hiệu GET /api/brands |
| /brands/:slug | PUBLIC | Brand logo/mô tả và catalog đã lọc |
| /products/:slug | PUBLIC | Product detail GET /api/products/by-slug/:slug |
| /login | PUBLIC | Login; return_to chỉ path nội bộ allowlist |
| /register | PUBLIC | Đăng ký CUSTOMER, sau thành công đi login |
| /cart | CUSTOMER | Cart server, voucher preview, cảnh báo stock |
| /checkout | CUSTOMER | Xác nhận giỏ + thông tin COD + submit |
| /checkout/success/:orderId | CUSTOMER owner | Lấy order đã commit; không dựa query total từ URL |
| /account | Auth 5 role | Read-only UserSelf; link đơn cá nhân chỉ CUSTOMER |
| /account/orders | CUSTOMER | Tabs status, paginated orders + items |
| /account/orders/:orderId | CUSTOMER owner | Snapshot hóa đơn, hủy khi hợp lệ |
| /403 | Chung | Không có quyền, lối trở lại đúng không gian |
| * | Chung | 404 có tìm kiếm/quay về, không redirect mọi URL về Home |

PUBLIC xem được hàng; nhấn thêm giỏ khi chưa login chuyển login rồi quay lại product và yêu cầu xác nhận SKU, không checkout tự động. Nhân viên vẫn xem storefront nhưng CTA mua được thay bằng thông tin “Tài khoản nhân viên”; không âm thầm cho họ dùng CUSTOMER API. Không tạo account CUSTOMER thay người dùng.

## 4. Sitemap admin và quyền

| Route UI | Quyền | Màn hình/API |
| --- | --- | --- |
| /admin | S/W/M/A | Redirect theo role: S→orders, W→inventory, M/A→dashboard |
| /admin/dashboard | M/A | KPI/revenue/best-sellers, filter dates |
| /admin/orders | S/A | Filter status/order_code, danh sách |
| /admin/orders/:id | S/A | Chi tiết, status expected/target, cancel reason |
| /admin/inventory | W/A | Tồn kho, search/low stock, modal import |
| /admin/inventory/transactions | W/A | Ledger filters, reference order_code |
| /admin/products | A | Danh sách gồm inactive/draft |
| /admin/products/new | A | Tạo draft metadata |
| /admin/products/:id | A | Thông tin, variants, giá, gallery, publish/deactivate |
| /admin/categories | A | List và modal create/edit/deactivate |
| /admin/brands | A | List và modal create/edit/deactivate |
| /admin/vouchers | M/A | List/create, progress used/limit |
| /admin/vouchers/:id | M/A | Sửa theo terms lock, tab usages |
| /admin/banners | A | Metadata/lịch/vị trí/target, preview form và active |
| /admin/users | A | Danh sách role/active, modal edit và cảnh báo admin cuối |
| /admin/audit-events | A | Filter event/entity/actor, read-only diff đã redaction |

Sidebar chỉ hiện mục role cho phép, API vẫn kiểm quyền. Dashboard không là landing chung cho SALES/WAREHOUSE vì nguồn không cấp báo cáo cho họ. WAREHOUSE chỉ thấy order_code text trong ledger; không có link mở địa chỉ đơn. MARKETING usage không có link chi tiết đơn khi không có quyền, email che bớt. Không có trang chỉnh raw DB, trực tiếp stock quantity, completed order, seller hoặc thanh toán online.

## 5. Layout storefront và wireframe mô tả

```text
Desktop Home
[Thông tin COD ngắn đã được duyệt]
[Logo] [Tìm kiếm rộng........................] [Thương hiệu] [Tài khoản] [Giỏ]
[Danh mục và lối tắt loại hàng]
[Hero banner có link nội bộ hợp lệ, điều khiển truy cập được]
[Brands: logo/tên, link landing]
[Hàng mới: heading + xem tất cả]
[Product card] [Product card] [Product card] [Product card]
[Promo nếu đang lịch]
[Nhóm danh mục có sản phẩm, tối đa số section được cấu hình ở code v1]
[Thông tin cửa hàng và liên hệ thực tế] [Footer links]
```

Home chỉ render section có dữ liệu active; không fake số bán/đánh giá hoặc tạo danh mục không có sản phẩm. Hero không có banner thì bỏ vùng, không chừa khoảng trắng lớn. Home product sections dùng newest/category filters, không gọi là “gợi ý cho bạn”; không AI. Brands hiển thị tên khi chưa có logo, không tải logo tự ý từ Internet.

Mobile: header hai hàng gọn (logo/account/cart rồi search), menu drawer cho danh mục/brand; hero có mobile_path hoặc desktop fallback; lưới 2 cột. Footer accordion nếu cần. Search submit enter/nút, query lưu URL, loading không nhảy layout. Breadcrumb trên category/brand/detail; tên dài wrap hoặc clamp có accessible name đầy đủ.

Catalog: sidebar brand/category/type/price/in_stock, chip filters và reset, số kết quả, sort. Mobile drawer có nút Áp dụng và Xóa lọc; focus trở về nút mở, Escape đóng. Search/filter đổi thì page=1; browser back phục hồi URL và vị trí hợp lý. Giá min/max và in_stock phải phù hợp semantics “cùng SKU” trong API, không lọc lại lệch ở client.

Card: khung ảnh vuông contain, brand, tên tối đa 2 dòng, khoảng giá bán price_min–price_max hoặc một giá, nhãn Hết hàng nếu không in_stock. DTO card chưa có giá niêm yết đại diện: không gạch một list_price từ SKU khác hoặc vẽ phần trăm sale giả. Giá so sánh/discount badge chỉ hiển thị trên detail khi chọn SKU có list_price>price. Card link vào chi tiết, không quick-add khi chưa chọn thuộc tính.

## 6. Chi tiết sản phẩm và chọn SKU

Desktop: gallery trái khoảng 55%, thông tin phải; mobile gallery rồi brand/name/price/options/quantity/CTA. Chọn một option cập nhật tập option hợp lệ từ **các SKU thực**, không sinh tổ hợp cartesian. Khi đủ required và đúng một SKU: hiện sku, giá bán, list_price nếu lớn hơn, tồn và CTA. Một thuộc tính chỉ có một giá trị có thể auto-select nhưng vẫn hiển thị lựa chọn; không tự chọn size đầu tiên khi có nhiều size.

| Loại | Cách chọn | Trạng thái phải giải thích |
| --- | --- | --- |
| Quần áo | Swatch có text màu + pill size S/M/L… | Phân biệt tổ hợp không bán và SKU tồn 0 |
| Giày | Màu + pill size kèm hệ EU/US | Không ngầm quy đổi 42 sang US9; thông số từ value label |
| Túi | Màu; kích thước nếu schema/SKU có | Không ép chọn “size N/A” |
| Đồng hồ | Model + màu dây, đường kính nếu có | Model/40 mm là SKU options, không trường size quần áo |
| Phụ kiện | Model + màu + size khi có | One-size không xuất axis giả; cấu hình loại chưa hỗ trợ phải báo admin |
| Nước hoa | Dung tích ml + nồng độ EDP/EDT… | Không nút màu/size quần áo; giá theo chai được chọn |

Option không tồn tại bị disable và ghi “Không có tổ hợp này”; SKU có tồn 0 vẫn cho xem, CTA disabled “Hết hàng”. Thiếu thuộc tính hiển thị “Chọn dung tích và nồng độ” hoặc đúng labels tương ứng. Quantity 1..999, cảnh báo nếu vượt stock; backend vẫn kiểm khi thêm/checkout. Khi option đổi, gallery ưu tiên ảnh SKU rồi product; nếu không có ảnh dùng placeholder có mô tả, không request URL lỗi liên tục.

Không hiển thị đánh giá, chất liệu, xuất xứ hoặc bảo hành không có dữ liệu. Mô tả plain text; không render HTML tùy ý. Giá list_price=price hoặc null: chỉ một giá bán; percent badge nếu dùng tính từ cùng SKU và không dùng số làm nguồn tính tiền.

## 7. Cart, checkout, đơn cá nhân

Giỏ: mỗi dòng có ảnh, tên, sku/options, giá hiện tại, quantity input, stock warning và xóa. Quantity vượt tồn có text/icon đỏ; item inactive có thông báo và nút xóa, không tự bỏ dòng khi người dùng chưa biết. Số tiền hiển thị theo server. Cart không giữ hàng; subtotal có thể đổi khi refresh.

Voucher preview có ô mã, nút áp dụng, spinner và message theo error code; thông báo “Mức giảm dự kiến, kiểm tra lại khi đặt hàng”. Thay quantity hoặc cart_version thì bỏ preview cũ và tính lại khi khách yêu cầu. Không hứa giữ lượt sau preview; voucher không hợp lệ không tự đặt đơn không mã.

Checkout desktop hai cột form/summary, mobile một cột: tên, phone, địa chỉ, COD cố định, items, subtotal/discount/final, ghi ship=0 chỉ sau khi D-01 chốt, CTA “Đặt hàng COD”. Không form thẻ, ngân hàng, ví. Các field lỗi inline gắn label và summary trên đầu, focus vào lỗi đầu.

Khi submit: snapshot cart_version/expected_items, tạo key, disable double-click; giữ payload/key trong bộ nhớ đến khi rõ kết quả. PRICE_CHANGED/CART_CHANGED mở màn hình xem lại giỏ, không tự gửi tiếp. OUT_OF_STOCK/ITEM_UNAVAILABLE đánh dấu dòng; voucher lỗi giữ form cho sửa. Khi network timeout không rõ outcome, hiện “Đang xác minh đơn” và nút thử lại cùng key/body, không chỉ báo thất bại và tạo key mới. D-10 reload mất session; key/body chỉ có thể lưu sessionStorage có thời hạn nếu PO duyệt thay đổi lưu PII, v1 không thêm lưu trữ đó; sau reload khách đăng nhập và kiểm tra danh sách đơn trước thao tác mới.

Success lấy order owner từ API, hiện order_code, COD/UNPAID, số tiền snapshot và link lịch sử. Không mặc định đã thanh toán. Tab đơn: tất cả/PENDING/CONFIRMED/SHIPPING/DELIVERED/CANCELLED, giữ filter pagination. Chi tiết hiển thị snapshot tên/brand/SKU/options/giá, không ghi đè từ product hiện tại. Nút hủy chỉ PENDING/CONFIRMED, dialog yêu cầu reason; nếu status đổi khi dialog mở, API409 rồi refresh, không báo hủy thành công.

## 8. Admin screen specifications

| Màn hình | Nội dung/chủ điểm | Validation, empty và conflict |
| --- | --- | --- |
| Orders list/detail | Status tabs/filter, order_code, tiền, người nhận; action một bước; timeline dùng trạng thái và audit nếu A | expected_status tránh ghi đè; confirm trước SHIPPING/DELIVERED; cuối không edit/delete |
| Inventory | SKU/options/quantity/low-stock; modal nhập quantity/note | Không editable cell quantity; key import giữ khi retry; success refresh ledger/balance |
| Ledger | Date/type/SKU/order filters, dấu +/- và actor | Chỉ đọc; W không mở PII; rỗng có hướng dẫn lọc lại |
| Products | Draft/active/inactive filter, tạo metadata→SKU→ảnh→publish | Publish thiếu SKU/ảnh hiển thị checklist; price/list_price validation tại cùng SKU |
| SKU editor | Type options lấy metadata seed, SKU code, price/list_price; inventory chỉ đọc | Không sửa identity sau tạo; duplicate combo highlight; không có CRUD type/options v1 |
| Gallery | Chọn asset đã cấp, alt, order, primary product/SKU | Cross-product SKU reject; primary đổi atomic; không nút upload nếu chưa có API |
| Brands/categories | Danh sách/modal, slug khi tạo, active | Slug read-only sau tạo; ảnh hưởng deactivate phải nêu sản phẩm sẽ ẩn/mất khả năng mua |
| Voucher | Terms, lịch inclusive, used/limit; usage tab có email masked | Terms lock sau usage: controls read-only, active/limit tăng vẫn sửa; không editable used_count |
| Banners | Desktop/mobile paths, alt, HERO/PROMO, target selector, schedule, preview local | [start,end) rõ timezone; link target inactive không public; không HTML/external link |
| Users | Tên/email/role/active, confirm tác động session | Không edit hash/email; chặn admin cuối, refresh me sau thay quyền mình |
| Dashboard | Date/day-month, net delivered revenue, đơn thành công, discount; chart + bảng text | Không dữ liệu =0/empty, không mock KPI; doanh thu SKU gross có label riêng |
| Audit | Filter actor/entity/action/time, whitelist before/after | Không delete/edit/export PII; không log payload secret |

Admin header có tên người dùng/role, logout và link cửa hàng; sidebar collapse mobile. Bảng có header semantic, pagination, skeleton và error retry; cuộn ngang **trong bảng**, không toàn trang. Mutations tiền/kho/đơn không optimistic update; chờ server commit rồi refresh. Toast chỉ phụ trợ, lỗi vẫn ở form/row.

## 9. State và accessibility dùng chung

| State | Hành vi |
| --- | --- |
| Loading | Skeleton đúng tỷ lệ, aria-busy, nút submit không gửi lặp |
| Empty | Phân biệt chưa có hàng, không có kết quả filter và giỏ trống; CTA phù hợp |
| Error | Message theo code, retry đọc an toàn, không lộ SQL; giữ input chưa gửi |
| Unauthorized/expired | Chuyển login có return_to nội bộ, clear auth/cache PII; không giữ đơn người trước |
| Forbidden | 403 có lối về workspace đúng role; không thử endpoint role khác |
| Inactive/not found | Public 404; cart/đơn cũ giữ text snapshot và giải thích |
| Stale/conflict | Refresh object liên quan, khách xác nhận lại; không báo thành công giả |

Keyboard đủ mọi tương tác; swatches có accessible label, pills là radio group, gallery có alt và nút điều hướng. Modal trap focus/restore/Escape; form error liên kết aria-describedby, cập nhật quan trọng qua live region không đọc mọi keystroke. Focus nhìn thấy và không bị sticky CTA che, contrast được đo với token thực. Mục tiêu AA theo [WCAG 2.2](https://www.w3.org/TR/2023/REC-WCAG22-20231005/); nút ≥44px là target thiết kế dự án, không tuyên bố mọi tiêu chí WCAG đều đòi 44px. UI cần kiểm bàn phím, screen reader, zoom và reduced motion khi có mã.

## 10. Tài nguyên ảnh và dữ liệu còn thiếu

| File | Kích thước | Mapping demo dự kiến, chưa xác nhận metadata |
| --- | --- | --- |
| sanphamdemo1.jpg | 1282×1528 | CLOTHING, áo phao màu burgundy, logo The North Face; nền thật phức tạp |
| sanphamdemo2.jpg | 768×768 | CLOTHING, hoodie kem, logo adidas, có người mẫu |
| sanphamdemo3.jpg | 800×800 | CLOTHING, varsity Lakers đen/tím, dấu Nike; cần chốt brand chính |
| sanphamdemo4.jpg | 1280×1280 | CLOTHING, hoodie Givenchy trắng; có thể một product với ảnh5 |
| sanphamdemo5.jpg | 1280×1280 | CLOTHING, hoodie Givenchy đỏ; chỉ gộp khi PO xác nhận |
| sanphamdemo6.jpg | 2560×2560 | CLOTHING, áo khoác adidas/Bayern; brand chính cần metadata chính thức |

Giữ ảnh gốc. Thực thi sau có thể sao chép thành asset web và derivative tối ưu; không crop cắt sản phẩm mặc định. Chưa có logo cửa hàng/brands chính thức, hero high-res, ảnh nhóm giày/túi/đồng hồ/phụ kiện/nước hoa, ảnh nhiều góc, size chart, thông tin giá/tồn/size. Không lấy logo trên hình làm bằng chứng hàng thật hoặc quyền sử dụng thương mại. Trạng thái thiếu tài sản không ngăn hoàn tất sitemap và thiết kế hiện tại; fixture synthetic phải được đánh dấu demo.

## 11. Acceptance UI

Từng route sitemap có API/quyền tương ứng; hoàn tất flow từ tìm hàng tới COD trên 360px và desktop; đủ 6 loại option; không chọn nhầm SKU; xử lý hết hàng/price change/voucher last slot/cancel conflict; menu và deep link không vượt RBAC. Không có API cho feature nào thì không dựng control giả như upload/payment. Tests tham chiếu T15–T25 trong [TASKS](../TASKS.md).
