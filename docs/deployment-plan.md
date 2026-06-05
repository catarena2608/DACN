# Deployment Plan For The Lab

Tài liệu này mô tả kế hoạch triển khai đồ án theo hướng production-like nhưng vẫn vừa sức trong môi trường lab. Mục tiêu là hoàn thiện đầy đủ tech stack cốt lõi để chứng minh quy trình DevOps, GitOps, staging validation và đánh giá hiệu năng, không biến đồ án thành một bài triển khai cloud quá nặng.

## Luận Điểm Triển Khai

Đồ án không cần bắt đầu bằng AWS/EKS. Điều quan trọng hơn là chứng minh được workflow:

```text
Developer push code

GitHub Actions build/test/security scan
Image được push lên GHCR
FluxCD sync staging từ Git state
Staging validation chạy smoke test + k6 load test
Nếu pass, cùng image tag được promote sang production state
FluxCD sync production
```

Vì vậy môi trường lab nên ưu tiên:

```text
dễ dựng
dễ demo
dễ quan sát
đủ giống production để đánh giá hiệu năng
không quá nặng như một cloud platform hoàn chỉnh
```

## Kiến Trúc Mục Tiêu

Sơ đồ kiến trúc nằm tại:

```text
docs/assets/architecture.png
```

Sơ đồ hiện tại có các nhóm chính:

| Nhóm | Thành phần |
| --- | --- |
| Entry | Client, Load Balancer, API Gateway, Frontend |
| Business services | Auth, User, Product, Order, Payment, Ranking, Admin |
| Data | MongoDB theo domain, Redis Cache, RabbitMQ |
| Metrics | Prometheus, Node Exporter, Grafana |
| Logs | OpenTelemetry Collector, Elasticsearch, Kibana |
| Traces | OpenTelemetry Collector, Jaeger Query |
| Release workflow | GitHub Actions, GHCR, FluxCD, Helm |
| Performance validation | k6, staging validation workflow |

Repo hiện tại đã có:

```text
frontend
gateway
auth service
product service
order service
nginx local proxy
RabbitMQ trong Docker Compose/Helm
docker compose
helm chart
github actions ci
k6 staging script
```

Các service còn lại như Payment, Ranking và Admin nên được xem là phase mở rộng, không nên trình bày như phần đã hoàn thiện.

## Tech Stack Đề Xuất

### Application

| Thành phần | Công nghệ | Lý do |
| --- | --- | --- |
| Frontend | React + Vite | Nhẹ, dễ build image, phù hợp dashboard/client demo |
| API Gateway | Node.js + Express | Đơn giản, dễ route service và đo latency |
| Services | Node.js + Express | Đồng nhất stack backend, dễ container hóa |
| Database | MongoDB | Phù hợp dữ liệu document/catalog, dễ chia DB theo domain |
| Cache/session | Redis | Cache product, token whitelist, giảm tải DB |
| Message broker | RabbitMQ | Dùng cho phase event-driven như Order/Payment |

### Platform

| Thành phần | Công nghệ | Lý do |
| --- | --- | --- |
| Container | Docker | Chuẩn hóa artifact |
| Local runtime | Docker Compose | Chạy nhanh full stack local |
| Orchestration | Kubernetes | Môi trường production-like |
| Package deploy | Helm | Templating, values theo môi trường |
| GitOps CD | FluxCD | Cluster tự reconcile từ Git state |
| Registry | GHCR | Tích hợp GitHub Actions, đơn giản cho đồ án |
| Ingress | Nginx Ingress Controller | Phổ biến, dễ cấu hình |

### Observability

| Nhu cầu | Công nghệ | Ghi chú |
| --- | --- | --- |
| Metrics | Prometheus | Thu metrics cluster/service |
| Dashboard | Grafana | Hiển thị CPU, memory, HPA, latency |
| Node metrics | Node Exporter | Quan sát tài nguyên node |
| Logs | Elasticsearch + Kibana | Search, filter, log analytics |
| Traces | OpenTelemetry Collector + Jaeger | Trace request qua gateway/service |
| Load test | k6 | Đo p95/p99/error rate/RPS |

## Vì Sao Dùng ELK Thay Vì Loki

Loki nhẹ hơn và rất hợp khi muốn lưu log theo label, tích hợp Grafana nhanh, chi phí thấp. Tuy nhiên trong đồ án này, ELK có thể được chọn vì mục tiêu không chỉ là "xem log", mà là **phân tích log dưới tải lớn để phục vụ production readiness**.

Các lý do hợp lý để chọn ELK:

```text
Elasticsearch mạnh về full-text search.
Kibana mạnh về filtering, dashboard, timeline và phân tích log.
ELK phổ biến trong môi trường enterprise, dễ giải thích với bài toán production.
Log có thể được index theo service, trace_id, status_code, error message, latency bucket.
Khi chạy k6, có thể tìm nhanh lỗi 5xx, timeout, request chậm, correlation theo trace_id.
ELK hỗ trợ use case forensic/debug tốt hơn khi log message phức tạp.
```

Phản biện nếu bị hỏi "ELK nặng quá":

```text
Đúng, ELK nặng hơn Loki. Đây là trade-off có chủ đích.
Đồ án không dùng ELK vì nó nhẹ, mà vì nó mạnh cho log analytics và full-text search.
Trong lab, ELK sẽ chạy cấu hình single-node, retention ngắn, resource limit rõ ràng.
Không triển khai Elasticsearch HA/cluster lớn để tránh lệch trọng tâm.
Nếu mục tiêu chỉ là log storage rẻ và nhẹ, Loki hợp hơn; nếu mục tiêu là phân tích log sâu phục vụ performance debugging, ELK có lý do rõ ràng.
```

Cách làm cho ELK nhẹ hơn trong lab:

```text
chạy Elasticsearch single-node
giới hạn heap 1-2GB
retention 1-3 ngày
không bật replica shard trong lab
không dùng Logstash nếu không cần
dùng OpenTelemetry Collector hoặc Fluent Bit để gửi log
chỉ thu log từ namespace staging/app thay vì toàn cluster
```

Vì vậy, stack thực tế nên gọi chính xác là:

```text
Elasticsearch + Kibana + OpenTelemetry Collector/Fluent Bit
```

Không nhất thiết phải chạy đủ Logstash nếu mục tiêu là giảm tải lab.

## Mô Hình Lab Khuyến Nghị

### Lựa Chọn Cluster

Ưu tiên theo mức độ dễ triển khai:

| Lựa chọn | Khi nào dùng | Nhận xét |
| --- | --- | --- |
| kind/minikube local | Demo nhanh, máy cá nhân mạnh | Dễ nhất nhưng hạn chế tài nguyên |
| k3s trên VPS | Lab production-like vừa sức | Khuyến nghị cho đồ án |
| AWS/EKS | Khi muốn cloud-native thật | Nặng, dễ lệch trọng tâm |

Khuyến nghị:

```text
k3s trên VPS hoặc máy lab 8 vCPU / 16GB RAM trở lên
```

Nếu phải chạy cả ELK, Prometheus, Grafana, MongoDB, Redis, RabbitMQ và app services, cấu hình thấp hơn sẽ dễ nghẽn tài nguyên.

### Namespace

```text
flux-system          # FluxCD
ingress-nginx        # Ingress Controller
observability        # Prometheus, Grafana, Elasticsearch, Kibana, Jaeger, OTel
data                 # MongoDB, Redis, RabbitMQ nếu chạy trong cluster
dacn-staging         # Application staging
dacn-prod            # Application production-like
```

Trong lab có thể dùng chung cluster nhưng tách namespace. Production thật nên dùng cluster hoặc node pool riêng.

## Kế Hoạch Triển Khai Theo Phase

### Phase 1: Local Baseline

Mục tiêu:

```text
chạy được frontend/gateway/auth/product/local data layer
đảm bảo developer có thể reproduce nhanh
```

Công việc:

```text
Docker Compose chạy full stack
health check pass
login flow pass
product list/detail pass
```

Artifact:

```text
deploy/compose/docker-compose.yml
services/*/.env.example
apps/*/.env.example
```

### Phase 2: Kubernetes Lab Base

Mục tiêu:

```text
có cluster Kubernetes lab
có Ingress Controller
có StorageClass
có namespace chuẩn
```

Công việc:

```text
cài k3s/kind/minikube
cài ingress-nginx
tạo namespace
cài FluxCD
kết nối FluxCD với repo Git/GitOps state
```

Kết quả mong đợi:

```text
kubectl get nodes pass
FluxCD sync pass
Ingress hoạt động
```

### Phase 3: App Deployment Bằng FluxCD

Mục tiêu:

```text
GitHub Actions không deploy trực tiếp
FluxCD triển khai app bằng Helm
```

Công việc:

```text
GitHub Actions build image và push GHCR
Helm chart dùng imageTag theo môi trường
FluxCD sync staging namespace
staging URL truy cập được
```

Kết quả mong đợi:

```text
/api/health pass
/api/auth/health pass
/api/products/health pass
/ pass
```

### Phase 4: Data Layer

Mục tiêu:

```text
MongoDB/Redis/RabbitMQ có mặt trong lab
service có thể kết nối ổn định
```

Triển khai lab:

```text
MongoDB: Bitnami MongoDB standalone hoặc replica set nhỏ
Redis: Redis standalone cho lab, Redis cluster nếu còn tài nguyên
RabbitMQ: Bitnami RabbitMQ
```

Lưu ý:

```text
staging và production-like không nên dùng chung database name
production thật nên dùng managed MongoDB/Redis hoặc cluster HA
```

### Phase 5: Observability

Mục tiêu:

```text
thu metrics, logs, traces để phân tích hiệu năng
```

Triển khai:

```text
kube-prometheus-stack cho Prometheus + Grafana
Node Exporter đi kèm stack
OpenTelemetry Collector làm gateway telemetry
Jaeger cho trace visualization
Elasticsearch + Kibana cho log analytics
```

Lab mode:

```text
Prometheus retention ngắn
Elasticsearch single-node
Kibana một replica
Jaeger all-in-one hoặc production mode nhẹ
OTel Collector một replica
```

### Phase 6: Staging Validation

Mục tiêu:

```text
chứng minh staging đủ điều kiện promote image tag
```

Công việc:

```text
Helm lint/template
smoke test staging endpoint
k6 baseline test
k6 10.000 VUs test nếu tài nguyên và load generator cho phép
thu metrics/logs/traces
```

Artifact:

```text
k6 summary
Grafana screenshots
Kibana query screenshots
Jaeger trace screenshots
HPA events
pod CPU/memory
```

### Phase 7: Production-like Promotion

Mục tiêu:

```text
cùng image tag đã pass staging được promote sang production-like namespace
```

Công việc:

```text
cập nhật imageTag production trong GitOps state
FluxCD sync dacn-prod
smoke test production-like endpoint
```

Không cần AWS để chứng minh phase này. Điều cần chứng minh là quy trình promotion bằng GitOps.

## Thứ Tự Ưu Tiên Triển Khai

Nếu thời gian hạn chế, ưu tiên như sau:

```text
1. CI + GHCR image
2. Kubernetes lab + FluxCD
3. Helm staging deploy
4. Prometheus + Grafana
5. k6 staging validation
6. Elasticsearch + Kibana
7. OTel + Jaeger
8. RabbitMQ + service mở rộng
9. production-like namespace promotion
```

Điều này giúp đồ án vẫn có giá trị ngay cả khi chưa hoàn thiện toàn bộ stack.

## Resource Planning Cho Lab

### Tối Thiểu

```text
4 vCPU
8GB RAM
40GB disk
```

Chạy được app, MongoDB, Redis, Prometheus/Grafana cơ bản. Không phù hợp chạy ELK thoải mái.

### Khuyến Nghị

```text
8 vCPU
16GB RAM
80GB disk
```

Chạy được app, data layer, Prometheus/Grafana, OTel, Jaeger, Elasticsearch/Kibana single-node ở mức lab.

### Nếu Chạy 10.000 VUs

```text
load generator nên dùng k6 Cloud hoặc distributed runners
cluster lab có thể không pass 10.000 VUs, nhưng vẫn có thể dùng để tìm bottleneck
```

Không nên kết luận thất bại nếu lab nhỏ không chịu được 10.000 VUs. Kết quả đó nên được dùng để phân tích capacity planning.

## GitOps Layout Đề Xuất

Trong cùng repo ở giai đoạn đồ án:

```text
dacn-app/
  apps/
  services/
  packages/
  deploy/
    compose/
    helm/dacn/
    nginx/
  tests/
  scripts/
  docs/
```

Khi dự án trưởng thành hơn, có thể tách sang repo riêng:

```text
dacn-app       # source code + Dockerfile + Helm chart
dacn-gitops    # FluxCD desired state for clusters/environments
```

Repo `dacn-gitops` dự kiến:

```text
dacn-gitops/
  clusters/
    lab/
      flux-system/
      infrastructure/
      apps/
  apps/
    dacn/
      staging/
      production/
  secrets/
    staging/
    production/
```

## Rủi Ro Và Cách Giới Hạn Phạm Vi

| Rủi ro | Cách xử lý |
| --- | --- |
| Stack quá lớn | Chia phase, ưu tiên CI/Flux/staging validation trước |
| ELK quá nặng | Single-node, retention ngắn, resource limit |
| 10k VUs làm sập lab | Xem là stress result, phân tích bottleneck/capacity |
| AWS quá phức tạp | Dùng k3s/VPS/lab cluster |
| Observability mất nhiều thời gian | Bắt đầu Prometheus/Grafana trước, thêm ELK/Jaeger sau |
| Service chưa đủ nhiều | Trình bày service còn lại là roadmap/phase mở rộng |

## Definition Of Done

Đồ án được xem là hoàn thiện về triển khai khi có:

```text
CI build/test/security scan pass
image push lên GHCR
FluxCD sync staging
Helm values theo dev/staging/prod
staging smoke test pass
k6 test có kết quả và phân tích
Prometheus/Grafana dashboard cho resource/HPA
ELK/Kibana log search demo được lỗi hoặc request chậm
Jaeger trace demo được một request qua gateway/service
production-like promotion bằng GitOps
tài liệu phân tích bottleneck và production readiness
```

## Kết Luận

Kế hoạch triển khai nên đi theo hướng:

```text
nhỏ trước, đúng trước, đo được trước
```

Không cần ôm AWS ngay. Một lab Kubernetes với FluxCD, Helm, GHCR, Prometheus/Grafana, ELK, OTel/Jaeger và k6 là đủ để chứng minh trọng tâm đồ án: Dev và Ops cùng tạo ra quy trình kiểm định production readiness trước khi release tới người dùng cuối.
