# Performance Evaluation Plan

Tài liệu này mô tả cách đánh giá hiệu năng hệ thống DACN trên môi trường staging trước khi promote cùng một image tag sang production. Trọng tâm không chỉ là "chạy được 10.000 user", mà là chứng minh hệ thống đạt ngưỡng latency, error rate, throughput, autoscaling và độ ổn định đủ tin cậy.

Phần đánh giá hiệu năng là bằng chứng cho luận điểm DevOps của đồ án: tốc độ phản hồi và độ bền production không thuộc riêng Dev hay Ops, mà là kết quả của code, hạ tầng, quy trình kiểm thử, GitOps và observability cùng hoạt động.

## Mục Tiêu

Các câu hỏi chính cần trả lời:

```text
Hệ thống chịu được tải mục tiêu 10.000 virtual users không?
Latency p95/p99 có nằm trong ngưỡng chấp nhận được không?
Error rate có thấp hơn 1% không?
HPA có scale đúng khi tải tăng không?
MongoDB/Redis/Gateway/Product/Auth nghẽn ở đâu?
Cùng image tag này có đủ điều kiện promote sang production không?
```

## Phạm Vi Hiện Tại

Các thành phần được kiểm thử:

| Thành phần | Vai trò trong test |
| --- | --- |
| Frontend | Kiểm tra endpoint `/` sống sau Ingress/Gateway layer |
| Gateway | Entry point API, route `/api/*` |
| Auth service | Login, JWT, refresh-token flow |
| Product service | Product list/detail, Redis cache behavior |
| Redis | Cache/session/token whitelist |
| MongoDB | Nguồn dữ liệu chính cho auth/product |
| Kubernetes HPA | Scale pod theo tải |

Các thành phần chưa thuộc phạm vi hiện tại:

```text
Order service
Payment service
RabbitMQ
Observability stack đầy đủ
Service mesh
```

## Định Nghĩa 10.000 User

Trong k6, 10.000 user nghĩa là **10.000 virtual users (VUs)**, không đồng nghĩa 10.000 requests/second.

RPS thực tế phụ thuộc vào:

```text
số request mỗi vòng lặp
think time giữa các request
latency của hệ thống
duration giữ tải
```

Ví dụ đơn giản:

```text
10.000 VUs, mỗi VU gửi 1 request mỗi 2 giây
=> khoảng 5.000 RPS
```

Vì vậy báo cáo phải luôn ghi đủ:

```text
virtual users
test duration
ramp-up/ramp-down
traffic mix
think time
observed RPS
```

## Môi Trường Staging

Staging cần đủ giống production để kết quả có ý nghĩa:

| Nhóm | Thông tin cần ghi trong báo cáo |
| --- | --- |
| Kubernetes | Số node, CPU/RAM mỗi node, Kubernetes version |
| Ingress | Nginx Ingress/Load Balancer, TLS, domain |
| Workload | Replica ban đầu, HPA min/max, CPU target |
| Database | MongoDB mode, connection string type, instance size |
| Cache | Redis mode, memory limit, eviction policy |
| Image | Image tag đang test, ví dụ `sha-abc123` |
| Load generator | k6 Cloud hoặc distributed self-hosted runners |

## Metrics Cần Thu Thập

### User-facing Metrics

| Metric | Ý nghĩa |
| --- | --- |
| `http_req_duration p50` | Trải nghiệm user điển hình |
| `http_req_duration p95` | Trải nghiệm phần lớn user |
| `http_req_duration p99` | Tail latency, nhóm user chậm nhất |
| `http_req_failed` | Tỷ lệ request lỗi |
| `checks` | Tỷ lệ assertion pass |
| RPS/throughput | Năng lực xử lý thực tế |

### Kubernetes Metrics

| Metric | Ý nghĩa |
| --- | --- |
| CPU/memory per pod | Xác định pod nghẽn tài nguyên |
| Replica count | HPA có scale không |
| Pod restart count | Lỗi runtime/OOM/restart |
| HPA events | Tốc độ và lý do scale |
| Ingress 4xx/5xx | Lỗi ở edge layer |

### Service Metrics

| Service | Cần quan sát |
| --- | --- |
| Gateway | CPU, 401/403/502, latency route |
| Auth | Login latency, Redis token ops, JWT errors |
| Product | Product list/detail latency, cache hit behavior |
| Redis | Latency, memory, connected clients, slow commands |
| MongoDB | Query latency, connection count, slow query |

## Test Matrix

Không nên chỉ chạy một bài 10k user. Nên có nhiều bài để hiểu hệ thống từ nhẹ đến nặng.

| Test | Mục đích | Ví dụ tải | Kết quả mong đợi |
| --- | --- | --- | --- |
| Baseline | Đo hiệu năng gốc | 100 VUs, 5 phút | Latency thấp, không scale nhiều |
| Load | Kiểm tra tải mục tiêu | 10.000 VUs | Pass threshold |
| Stress | Tìm điểm gãy | tăng vượt 10.000 VUs | Xác định ngưỡng lỗi |
| Spike | Tăng tải đột ngột | 0 -> 5.000 VUs trong 1 phút | Hệ thống không sập |
| Soak | Chạy lâu | 1.000-2.000 VUs trong 1-4 giờ | Không memory leak/restart |
| Scalability | So sánh trước/sau HPA/cache | nhiều cấu hình | Chứng minh tối ưu có tác dụng |

## Kịch Bản 10.000 User

Script hiện tại:

```text
tests/load/staging-10000-users.js
```

Kịch bản:

```text
10 phút ramp lên 10.000 VUs
20 phút giữ tải 10.000 VUs
5 phút ramp down
```

Traffic mix hiện tại:

```text
login trong setup
GET /api/products?page=1&limit=20
GET /api/products/:id theo tỷ lệ 25% nếu có PRODUCT_ID
think time 0.5s - 2s
```

Threshold:

```text
http_req_failed < 1%
p95 latency < 800ms
p99 latency < 1500ms
checks pass rate > 99%
```

## Quy Trình Chạy Test

1. Deploy image tag lên staging bằng FluxCD.
2. Xác nhận FluxCD sync thành công.
3. Chạy smoke test staging:

```text
/api/health
/api/auth/health
/api/products/health
/
```

4. Warm-up hệ thống 3-5 phút để cache và pod ổn định.
5. Chạy bài test tương ứng bằng k6 Cloud hoặc distributed load generator.
6. Thu thập artifact:

```text
k6 summary
Grafana dashboard screenshot
HPA events
pod CPU/memory
pod restart count
MongoDB/Redis metrics
Ingress 4xx/5xx
```

7. So sánh với threshold.
8. Kết luận: pass, fail, hoặc pass có điều kiện.

## Tiêu Chí Pass/Fail

Một bài 10k user được xem là pass khi:

```text
http_req_failed < 1%
p95 latency < 800ms
p99 latency < 1500ms
checks pass rate > 99%
không có pod restart bất thường
không có OOMKilled
HPA scale trong giới hạn maxReplicas
MongoDB/Redis không báo lỗi nghiêm trọng
```

Fail nếu có một trong các điều kiện:

```text
error rate >= 1%
p95 hoặc p99 vượt ngưỡng liên tục
gateway/product/auth trả nhiều 5xx
pod restart/OOMKilled trong lúc test
HPA không scale dù CPU cao
database/cache trở thành bottleneck chưa có phương án xử lý
```

## Phân Tích Bottleneck

| Dấu hiệu | Khả năng nghẽn | Hướng kiểm tra |
| --- | --- | --- |
| Gateway 502 tăng | Service đích timeout/down | Gateway logs, service health |
| p95 product list tăng mạnh | MongoDB query hoặc cache miss | Product logs, Mongo slow query, Redis metrics |
| CPU product pod cao | Service compute-bound | HPA events, pod CPU |
| Redis latency cao | Cache/key operation nghẽn | Redis slowlog, memory, connected clients |
| Mongo connection cao | Connection pool/database nghẽn | Mongo metrics, query index |
| HPA scale chậm | Metrics server/HPA config | `kubectl describe hpa` |
| Pod restart | OOM/crash | `kubectl describe pod`, container logs |

Điểm cần chú ý trong code hiện tại:

```js
redis.keys("products:*")
```

`KEYS` có thể gây nghẽn Redis khi dữ liệu cache lớn. Nếu test cho thấy Redis latency tăng khi update/delete product, nên thay bằng chiến lược cache versioning, tag-based invalidation, hoặc `SCAN`.

## Phân Tích Trước Và Sau Tối Ưu

Để đồ án có chiều sâu, nên chạy benchmark theo phase:

| Phase | Cấu hình | Mục tiêu so sánh |
| --- | --- | --- |
| P1 | Replica thấp, cache cơ bản | Baseline |
| P2 | Bật/tối ưu Redis cache | Latency product list/detail |
| P3 | Bật HPA | Khả năng giữ error rate khi tải tăng |
| P4 | Tuning CPU/memory requests | HPA ổn định hơn |
| P5 | Tối ưu query/index/cache invalidation | Giảm p95/p99 |

Kết quả nên trình bày bằng bảng:

| Phase | VUs | RPS | Error rate | p95 | p99 | Max replicas | Kết luận |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | 1.000 | TBD | TBD | TBD | TBD | TBD | Baseline |
| P2 | 1.000 | TBD | TBD | TBD | TBD | TBD | Cache impact |
| P3 | 10.000 | TBD | TBD | TBD | TBD | TBD | HPA impact |

## Mẫu Kết Luận Production Readiness

```text
Image tag: sha-xxxxxxx
Môi trường: staging
Kịch bản: 10.000 VUs, 35 phút
Observed RPS: TBD
Error rate: TBD
p95 latency: TBD
p99 latency: TBD
Max auth replicas: TBD
Max product replicas: TBD
Max gateway replicas: TBD
Pod restarts: TBD
Kết luận: PASS/FAIL
Khuyến nghị: promote/chưa promote sang production
```

## Artifact Cần Lưu Cho Báo Cáo

```text
k6 result JSON hoặc link k6 Cloud
ảnh dashboard Grafana nếu có
ảnh HPA scale timeline
ảnh CPU/memory pod
log lỗi tiêu biểu nếu fail
bảng so sánh các phase benchmark
commit/image tag đã test
```

## Kết Luận

Phần đánh giá hiệu năng phải chứng minh được ba điều:

```text
hệ thống chịu được tải mục tiêu
hệ thống scale và phục hồi hợp lý
các rủi ro/bottleneck được phát hiện và có hướng xử lý
```

Chỉ khi staging validation pass theo threshold, image tag đó mới nên được promote sang production bằng FluxCD/GitOps.
