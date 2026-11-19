# PERFORMANCE & POSTGRESQL BENCHMARK REPORT (TASK 14)

Ngày đo kiểm: 20/11/2026 (Asia/Bangkok).
Công cụ sinh tải & đo: [scripts/benchmark-orders.mjs](../scripts/benchmark-orders.mjs) trên PostgreSQL `17.9 (Debian 17.9-1.pgdg12+1) on x86_64-pc-linux-gnu` (Docker Compose, warm cache trên DB tạm tách biệt `bench_orders_*` tự xóa sau khi chạy; không làm ảnh hưởng `fashion_dev`).

---

## 1. Quy mô dữ liệu Benchmark

- **Số đơn hàng (`app.orders`)**: **60.001** bản ghi (**65 MB** total relation size), phân bố qua 200 user trong 180 ngày:
  - `52.000` đơn `DELIVERED` (`86,7%`, có `payment_status = 'PAID'` và `delivered_at`)
  - `3.000` đơn `CANCELLED` (`5,0%`)
  - `5.001` đơn hoạt động (`PENDING` / `CONFIRMED` / `SHIPPING`, `8,3%`)
- **Số dòng chi tiết đơn (`app.order_items`)**: **120.001** bản ghi (**31 MB** total relation size).
- **Bảo toàn ràng buộc**: Dữ liệu được insert theo đúng các trigger `orders_guard`, `order_items_guard`, `orders_total` (deferred constraint) và chuyển trạng thái hợp lệ tuần tự, sau đó chạy `VACUUM ANALYZE`.

---

## 2. So sánh Hiệu năng Trước / Sau Indexing (`EXPLAIN (ANALYZE, BUFFERS)`)

> Phương pháp: Đợt **After** giữ nguyên toàn bộ indexes chuẩn từ migrations `001`–`019`; đợt **Before** drop các secondary indexes (`idx_orders_user_created`, `idx_orders_active_status`, `idx_orders_delivered`, `idx_orders_created`, `idx_order_items_variant`) và chạy lại `ANALYZE` trên cùng 60.001 đơn (vẫn giữ `orders_id_user_id_key` do ràng buộc FK `voucher_usages`).

| Truy vấn | Before Indexing (`Seq Scan` / Sort) | After Indexing (Migrations `006` & `010`) | Mức cải thiện thực tế |
| --- | --- | --- | --- |
| **Q1**: Lịch sử đơn khách hàng (`user_id = 6`, `ORDER BY created_at DESC, id DESC LIMIT 20`) | `1.409 ms` · `632` shared buffers (`Bitmap Heap Scan` + `Sort`) | **`0.054 ms`** · **`23`** shared buffers (`Index Scan using idx_orders_user_created`, không Sort) | **Nhanh hơn 26,1×** · **Giảm 27,5× buffers** |
| **Q2**: Báo cáo doanh thu 30 ngày gần nhất (`DELIVERED` theo `delivered_at`) | `17.627 ms` · `5.728` shared buffers (`Seq Scan on orders`) | **`6.683 ms`** · **`566`** shared buffers (`Bitmap Index Scan on idx_orders_delivered`) | **Nhanh hơn 2,6×** · **Giảm 10,1× buffers** |
| **Q3**: Hàng đợi đơn đang xử lý (`PENDING`/`CONFIRMED`/`SHIPPING`, `LIMIT 50`) | `10.251 ms` · `5.728` shared buffers (`Seq Scan on orders` + `Sort`) | **`0.284 ms`** · **`668`** shared buffers (`Index Scan using idx_orders_created`) | **Nhanh hơn 36,1×** · **Giảm 8,6× buffers** |
| **Q4**: Top SKU bán chạy 30 ngày gần nhất (`order_items` JOIN `orders`) | `28.742 ms` · `8.739` shared buffers (`Parallel Seq Scan` cả 2 bảng) | **`20.844 ms`** · **`3.052`** shared buffers (`Index Only Scan on idx_orders_delivered`, `Heap Fetches: 0`) | **Giảm 2,9× buffers** (`orders`: `51` vs `5.728` buffers) |

---

## 3. Chi tiết Execution Plan (`EXPLAIN (ANALYZE, BUFFERS)`)

### Q1 — Customer Order History (`idx_orders_user_created`)

- **Before**:
```text
Limit  (cost=2767.30..2767.35 rows=20 width=41) (actual time=1.394..1.396 rows=20 loops=1)
  Buffers: shared hit=632
  ->  Sort  (cost=2767.30..2768.05 rows=300 width=41) (actual time=1.393..1.394 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=632
        ->  Bitmap Heap Scan on orders  (cost=1782.37..2759.32 rows=300 width=41) (actual time=1.118..1.350 rows=300 loops=1)
              Recheck Cond: (user_id = 6)
              Heap Blocks: exact=300
              Buffers: shared hit=632
              ->  Bitmap Index Scan on orders_id_user_id_key  (cost=0.00..1782.30 rows=300 width=0) (actual time=1.093..1.093 rows=300 loops=1)
                    Index Cond: (user_id = 6)
                    Buffers: shared hit=332
Planning Time: 0.068 ms
Execution Time: 1.409 ms
```

- **After**:
```text
Limit  (cost=0.41..79.69 rows=20 width=41) (actual time=0.017..0.040 rows=20 loops=1)
  Buffers: shared hit=23
  ->  Index Scan using idx_orders_user_created on orders  (cost=0.41..1181.56 rows=298 width=41) (actual time=0.016..0.038 rows=20 loops=1)
        Index Cond: (user_id = 6)
        Buffers: shared hit=23
Planning Time: 0.085 ms
Execution Time: 0.054 ms
```

### Q2 — Revenue Report Last 30 Delivered Days (`idx_orders_delivered`)

- **Before**:
```text
GroupAggregate  (cost=7490.97..7811.06 rows=7970 width=104) (actual time=15.958..17.604 rows=33 loops=1)
  Group Key: (((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text))::date)
  Buffers: shared hit=5728
  ->  Sort  (cost=7490.97..7511.11 rows=8056 width=21) (actual time=15.921..16.274 rows=9247 loops=1)
        Sort Key: (((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text))::date) DESC
        Sort Method: quicksort  Memory: 746kB
        Buffers: shared hit=5728
        ->  Seq Scan on orders  (cost=0.00..6968.30 rows=8056 width=21) (actual time=2.565..14.996 rows=9247 loops=1)
              Filter: (((status)::text = 'DELIVERED'::text) AND (delivered_at >= (now() - '30 days'::interval)))
              Rows Removed by Filter: 50754
              Buffers: shared hit=5728
Planning Time: 0.102 ms
Execution Time: 17.627 ms
```

- **After**:
```text
GroupAggregate  (cost=6986.33..7307.64 rows=8000 width=104) (actual time=5.081..6.656 rows=33 loops=1)
  Group Key: (((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text))::date)
  Buffers: shared hit=566
  ->  Sort  (cost=6986.33..7006.55 rows=8087 width=21) (actual time=5.050..5.370 rows=9247 loops=1)
        Sort Key: (((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text))::date) DESC
        Sort Method: quicksort  Memory: 746kB
        Buffers: shared hit=566
        ->  Bitmap Heap Scan on orders  (cost=234.97..6461.43 rows=8087 width=21) (actual time=0.369..4.042 rows=9247 loops=1)
              Recheck Cond: ((delivered_at >= (now() - '30 days'::interval)) AND ((status)::text = 'DELIVERED'::text))
              Heap Blocks: exact=516
              Buffers: shared hit=566
              ->  Bitmap Index Scan on idx_orders_delivered  (cost=0.00..232.95 rows=8087 width=0) (actual time=0.323..0.324 rows=9247 loops=1)
                    Index Cond: (delivered_at >= (now() - '30 days'::interval))
                    Buffers: shared hit=50
Planning Time: 0.132 ms
Execution Time: 6.683 ms
```

### Q3 — Active Orders Queue (`idx_orders_created` vs `Seq Scan`)

- **Before**:
```text
Limit  (cost=6719.04..6719.17 rows=50 width=34) (actual time=10.227..10.236 rows=50 loops=1)
  Buffers: shared hit=5728
  ->  Sort  (cost=6719.04..6731.54 rows=4998 width=34) (actual time=10.225..10.231 rows=50 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 28kB
        Buffers: shared hit=5728
        ->  Seq Scan on orders  (cost=0.00..6553.01 rows=4998 width=34) (actual time=0.008..9.665 rows=5001 loops=1)
              Filter: ((status)::text = ANY ('{PENDING,CONFIRMED,SHIPPING}'::text[]))
              Rows Removed by Filter: 55000
              Buffers: shared hit=5728
Planning Time: 0.078 ms
Execution Time: 10.251 ms
```

- **After**:
```text
Limit  (cost=0.41..260.86 rows=50 width=34) (actual time=0.008..0.275 rows=50 loops=1)
  Buffers: shared hit=668
  ->  Index Scan using idx_orders_created on orders  (cost=0.41..26045.13 rows=5000 width=34) (actual time=0.008..0.272 rows=50 loops=1)
        Filter: ((status)::text = ANY ('{PENDING,CONFIRMED,SHIPPING}'::text[]))
        Rows Removed by Filter: 611
        Buffers: shared hit=668
Planning Time: 0.087 ms
Execution Time: 0.284 ms
```

### Q4 — Best-Selling SKUs Last 30 Delivered Days

- **Before**:
```text
Limit  (cost=11209.87..11209.87 rows=2 width=12) (actual time=23.656..28.703 rows=2 loops=1)
  Buffers: shared hit=8739
  ->  Sort ...
        ->  Finalize GroupAggregate ...
              ->  Gather Merge (Workers Launched: 1)
                    ->  Partial HashAggregate ...
                          ->  Parallel Hash Join (Hash Cond: (oi.order_id = o.id))
                                ->  Parallel Seq Scan on order_items oi (Buffers: shared hit=3001)
                                ->  Parallel Hash -> Parallel Seq Scan on orders o (Filter: DELIVERED & 30d; Buffers: shared hit=5728)
Planning Time: 0.202 ms
Execution Time: 28.742 ms
```

- **After**:
```text
Limit  (cost=5011.84..5011.84 rows=2 width=12) (actual time=20.810..20.814 rows=2 loops=1)
  Buffers: shared hit=3052
  ->  Sort  (cost=5011.84..5011.84 rows=2 width=12) (actual time=20.810..20.813 rows=2 loops=1)
        Sort Key: (sum(oi.quantity)) DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=3052
        ->  HashAggregate  (cost=5011.81..5011.83 rows=2 width=12) (actual time=20.804..20.807 rows=2 loops=1)
              Group Key: oi.variant_id
              Batches: 1  Memory Usage: 24kB
              Buffers: shared hit=3052
              ->  Hash Join  (cost=414.91..4930.94 rows=16174 width=8) (actual time=1.371..19.117 rows=18494 loops=1)
                    Hash Cond: (oi.order_id = o.id)
                    Buffers: shared hit=3052
                    ->  Seq Scan on order_items oi  (cost=0.00..4201.01 rows=120001 width=12) (actual time=0.005..5.606 rows=120001 loops=1)
                          Buffers: shared hit=3001
                    ->  Hash  (cost=313.82..313.82 rows=8087 width=4) (actual time=1.358..1.359 rows=9247 loops=1)
                          Buckets: 16384 (originally 8192)  Batches: 1 (originally 1)  Memory Usage: 454kB
                          Buffers: shared hit=51
                          ->  Index Only Scan using idx_orders_delivered on orders o  (cost=0.29..313.82 rows=8087 width=4) (actual time=0.013..0.737 rows=9247 loops=1)
                                Index Cond: (delivered_at >= (now() - '30 days'::interval))
                                Heap Fetches: 0
                                Buffers: shared hit=51
Planning Time: 0.220 ms
Execution Time: 20.844 ms
```

---

## 4. Phân tích chuyên sâu & Đánh giá hiệu năng

1. **Tất cả truy vấn đạt mục tiêu p95 thấp (< 25 ms ở mức 60k đơn)**:
   - Lịch sử đơn của khách hàng (`Q1`) giảm từ `1.409 ms` xuống **`0.054 ms`** nhờ `idx_orders_user_created(user_id, created_at DESC, id DESC)`.
   - Báo cáo doanh thu (`Q2`) dùng `idx_orders_delivered` giảm 10× I/O buffer (`5728` → `566`) và chạy trong `6.683 ms`.
   - Hàng đợi đơn mở (`Q3`) dùng `idx_orders_created` chạy trong **`0.284 ms`**.
2. **Quan sát tối ưu cho dữ liệu lớn hơn (>500k đơn — ghi nhận mức Low/Optimization, không tự ý đổi architecture)**:
   - Trong `Q3`, PostgreSQL dùng `idx_orders_created` kết hợp filter `Rows Removed by Filter: 611` vì `idx_orders_active_status` hiện chỉ đánh trên `(status)` chứ không có `(created_at DESC, id DESC)`. Nếu tỷ lệ đơn đang xử lý giảm xuống <1% trên hàng triệu đơn, một partial composite index `(created_at DESC, id DESC) WHERE status IN ('PENDING','CONFIRMED','SHIPPING')` sẽ tránh được các bước lọc bỏ đơn đã hoàn thành.
   - Trong `Q4`, `Index Only Scan` trên `idx_orders_delivered` giảm buffer đọc bảng `orders` từ `5.728` xuống `51` (`Heap Fetches: 0`); phần chi phí còn lại (`~19 ms`) nằm ở `Seq Scan on order_items` khi kỳ báo cáo 30 ngày chiếm `~15,4%` tổng số đơn (`18.494 / 120.001` dòng) — hành vi đúng của PostgreSQL Hash Join.
   - **Frontend bundle size (`L-1`)**: Vite production build (`5.74s`) báo chunk `index-*.js` đạt `721.58 kB` (`gzip: 200.28 kB`) > 500 kB và cảnh báo static/dynamic import trùng cho `pages/auth.tsx` (cần tách ở nhóm sửa lỗi kế tiếp).
