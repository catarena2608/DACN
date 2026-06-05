# dacn-app

Đồ án này tập trung vào triển khai một ứng dụng e-commerce dạng microservices lên Kubernetes theo mô hình staging -> production. Mục tiêu là xây dựng một môi trường staging đủ gần production, chạy các bài kiểm thử đáng tin cậy, sau đó mới cho phép cùng một image được dùng ở production.

GitHub Actions chỉ đảm nhận CI: build, test, security scan, smoke test local, build image và push image lên GHCR. CD sẽ do FluxCD đảm nhận bằng cách reconcile Kubernetes cluster từ Git state.

Luận điểm trung tâm của đồ án: hiệu năng và độ ổn định production không phải là trách nhiệm riêng của Dev hoặc Ops. Một release chỉ nên đến tay người dùng cuối khi code, hạ tầng, CI, GitOps, staging validation và kiểm thử tải cùng chứng minh rằng image tag đó đủ an toàn.

Repo này là `dacn-app`: nơi chứa source code, Dockerfile, Helm chart ứng dụng, CI workflow, test script và tài liệu kỹ thuật. Desired state cho FluxCD nên nằm ở repo riêng sau này, ví dụ `dacn-gitops`.

## Hiện Trạng Hệ Thống

| Thành phần | Vị trí | Vai trò |
| --- | --- | --- |
| Frontend | `apps/frontend` | React + Vite web client |
| Gateway | `apps/gateway` | API gateway, route `/api/*` về service nội bộ |
| Auth service | `services/backend-auth` | Đăng ký, đăng nhập, JWT, refresh token |
| Product service | `services/backend-product` | Product catalog, cache Redis, xử lý stock RPC |
| Order service | `services/backend-order` | Quản lý order, gọi Product qua RabbitMQ RPC |
| RabbitMQ | `deploy/compose`, `deploy/helm/dacn` | Message broker cho luồng order-product |
| Nginx | `deploy/nginx` | Reverse proxy local, rate limit cơ bản |
| Helm chart | `deploy/helm/dacn` | Kubernetes application chart cho FluxCD/Helm |
| Docker Compose | `deploy/compose` | Chạy full stack local |
| Load test | `tests/load` | k6 scripts, gồm staging 10k user scenario |
| Shared packages | `packages` | Khu vực cho shared code sau này |
| Automation scripts | `scripts` | Khu vực cho helper scripts sau này |
| Deployment plan | `docs/deployment-plan.md` | Kế hoạch triển khai lab, FluxCD, observability và tech stack |
| Performance plan | `docs/performance-evaluation.md` | Kế hoạch đánh giá hiệu năng và tiêu chí production readiness |
| DevOps readiness | `docs/devops-production-readiness.md` | Luận điểm Dev/Ops shared responsibility và quality gate trước production |

Những thành phần như Payment và observability stack đầy đủ là roadmap nếu phát triển tiếp. Order và RabbitMQ hiện đã có trong source/deploy ở mức phục vụ luồng đặt hàng.

## Cấu Trúc Repo

```text
apps/
  frontend/
  gateway/

services/
  backend-auth/
  backend-product/
  backend-order/

packages/
  README.md

deploy/
  compose/
  helm/dacn/
  nginx/

scripts/
  README.md

tests/
  load/
  smoke/
  integration/
  contract/

docs/
  architecture/
  assets/
  runbooks/
  archive/
```

## Môi Trường

| Môi trường | Mục đích | Config chính | Cách triển khai |
| --- | --- | --- | --- |
| Local | Developer chạy trên máy cá nhân | `deploy/compose/docker-compose.yml`, `.env.dev` | Docker Compose |
| Dev Kubernetes | Kiểm tra Helm nội bộ | `values.yaml` + `values-dev.yaml` | Manual/Flux tùy giai đoạn |
| Staging | Mô phỏng production, chạy validation gate | `values.yaml` + `values-staging.yaml` | FluxCD |
| Production | Người dùng cuối | `values.yaml` + `values-prod.yaml` | FluxCD + approval theo GitOps |

## Chạy Local

Tạo file env local từ file mẫu:

```powershell
Copy-Item services/backend-auth/.env.example services/backend-auth/.env.dev
Copy-Item services/backend-product/.env.example services/backend-product/.env.dev
Copy-Item services/backend-order/.env.example services/backend-order/.env.dev
Copy-Item apps/gateway/.env.example apps/gateway/.env.dev
Copy-Item apps/frontend/.env.example apps/frontend/.env.dev
```

Chạy full stack:

```bash
docker compose -f deploy/compose/docker-compose.yml up --build
```

Endpoint chính:

```text
Frontend:       http://localhost
Gateway:        http://localhost:3000
Auth health:    http://localhost/api/auth/health
Product health: http://localhost/api/products/health
Order health:   http://localhost/api/order/health
```

## Helm Và FluxCD

Kế hoạch triển khai lab đầy đủ nằm ở:

```text
docs/deployment-plan.md
```

Chart chính:

```text
deploy/helm/dacn
```

Values theo môi trường:

```text
values.yaml           # Base chung, không chứa secret thật
values-dev.yaml       # Dev Kubernetes
values-staging.yaml   # Staging, external MongoDB/Redis
values-prod.yaml      # Production, external MongoDB/Redis, TLS
```

GitHub Actions không chạy `helm upgrade` vào cluster. Sau này FluxCD sẽ theo dõi Git repository hoặc một repo GitOps riêng, rồi tự reconcile staging/production.

Render thử staging local:

```bash
helm template dacn ./deploy/helm/dacn \
  -f ./deploy/helm/dacn/values-staging.yaml \
  --set global.imageTag=sha-xxxxxxx
```

Luồng GitOps mong muốn:

```text
CI build image -> push GHCR tag sha-xxxxxxx
Update GitOps state cho staging imageTag=sha-xxxxxxx
FluxCD sync staging
Run staging validation workflow
Nếu pass: promote cùng image tag sang production GitOps state
FluxCD sync production
```

Phần cập nhật GitOps state có thể làm thủ công trong đồ án, hoặc sau này tự động hóa bằng Image Automation Controller của FluxCD.

## Quản Lý Secret

Không commit `.env.dev`, password, token, kubeconfig, database URI thật vào repo.

Repo chỉ giữ `.env.example`. Secret thật nên nằm ở:

```text
Kubernetes Secret
Flux SOPS/Sealed Secrets/External Secrets
GitHub Secrets cho test credentials và k6 token
```

Ví dụ Kubernetes Secret staging:

```bash
kubectl -n dacn-staging create secret generic dacn-auth-staging-secrets \
  --from-literal=URI='mongodb://user:password@mongo-host:27017/auth_db' \
  --from-literal=JWT_SECRET='replace-me' \
  --from-literal=JWT_REFRESH_SECRET='replace-me'

kubectl -n dacn-staging create secret generic dacn-product-staging-secrets \
  --from-literal=URI='mongodb://user:password@mongo-host:27017/product_db' \
  --from-literal=RABBITMQ_URL='amqp://user:password@rabbitmq-host:5672'

kubectl -n dacn-staging create secret generic dacn-order-staging-secrets \
  --from-literal=URI='mongodb://user:password@mongo-host:27017/order_db' \
  --from-literal=RABBITMQ_URL='amqp://user:password@rabbitmq-host:5672'

kubectl -n dacn-staging create secret generic dacn-gateway-staging-secrets \
  --from-literal=JWT_SECRET='same-as-auth-jwt-secret'
```

Production dùng secret riêng:

```text
dacn-auth-prod-secrets
dacn-product-prod-secrets
dacn-order-prod-secrets
dacn-gateway-prod-secrets
```

## CI Và Staging Validation

| Workflow | Mục đích |
| --- | --- |
| `.github/workflows/ci-main.yml` | Build, test, audit, Docker Compose smoke test, push image lên GHCR |
| `.github/workflows/security.yml` | Gitleaks, npm audit, SonarQube |
| `.github/workflows/staging-validation.yml` | Helm render/lint, smoke test staging, k6 10k user test |

Không có workflow production deploy trong GitHub Actions. Production deployment thuộc về FluxCD.

Triết lý quality gate và trách nhiệm chung Dev/Ops được mô tả chi tiết tại:

```text
docs/devops-production-readiness.md
```

Luồng đề xuất:

```text
Pull request
  -> build/test/audit
  -> merge main
  -> build image + push GHCR
  -> FluxCD sync staging từ GitOps state
  -> run staging validation
  -> nếu pass thì promote image tag trong GitOps state production
  -> FluxCD sync production
```

## Staging Validation 10.000 User

Kế hoạch đánh giá hiệu năng chi tiết nằm ở:

```text
docs/performance-evaluation.md
```

Script chính:

```text
tests/load/staging-10000-users.js
```

Kịch bản:

```text
10 phút ramp lên 10.000 virtual users
20 phút giữ tải 10.000 virtual users
5 phút ramp down
```

Threshold:

```text
http_req_failed < 1%
p95 latency < 800ms
p99 latency < 1500ms
checks pass rate > 99%
```

Chạy bằng k6 Cloud trong workflow staging validation:

```bash
k6 cloud tests/load/staging-10000-users.js
```

Các secret/variable cần:

```text
STAGING_TEST_EMAIL
STAGING_TEST_PASSWORD
K6_CLOUD_TOKEN
STAGING_PRODUCT_ID          # optional GitHub variable
```

Lưu ý: 10.000 user thật không nên chạy bằng một GitHub-hosted runner đơn lẻ. Workflow dùng k6 Cloud để tải được phân phối và kết quả đáng tin cậy hơn. Nếu không dùng k6 Cloud, cần self-hosted/distributed load generators.

## Production Promotion

Production chỉ dùng image tag đã pass staging validation. Không build lại image cho production.

Với FluxCD, promotion nên là một thay đổi Git:

```text
staging imageTag=sha-xxxxxxx đã pass
production imageTag=sha-xxxxxxx được cập nhật qua PR/review
FluxCD phát hiện thay đổi
FluxCD sync production
```

Trong đồ án, production promotion có thể trình bày bằng PR thủ công vào GitOps state. Trong hệ thống hoàn chỉnh, có thể dùng Flux Image Automation Controller hoặc một repo GitOps riêng.

## Tiêu Chí Đạt

Một bản build được xem là đủ điều kiện production khi:

```text
CI build pass
npm audit không có high/critical vulnerability
secret scan pass
Docker Compose smoke test pass
Helm staging render/lint pass
FluxCD đã sync staging thành công
Staging smoke test pass
k6 10k user test pass thresholds
Production image tag được promote qua GitOps review
FluxCD sync production
```
