# Workflow guide

## Cách làm việc với workflow ci

```
# 1. Code trên develop
git checkout develop
git add backend-auth/src/something.ts
git commit -m "fix: validate token expiry"
git push origin develop

# Lúc này GitHub Actions chạy ci cho mỗi auth

# 2. Khi muốn merge lên main
git checkout main
git merge develop
git push origin main
# Hoặc tạo PR trên GitHub rồi merge

# Lúc này main pipeline chạy:
# build all → smoke test → push images
```

## Khi thêm service mới (ví dụ: order-service)

**Bước 1** — Copy `ci-auth.yml` thành `ci-order.yml`, thay `backend-auth` → `order-service`

**Bước 2** — Thêm vào `ci-main.yml` ở 2 chỗ:

```yaml
# job build → matrix:
- name: order
  path: order-service

# job push-images → matrix:
- name: order
  context: ./order-service
```

**Bước 3** — Thêm vào `security.yml`:

```bash
SERVICES=("backend-auth" "backend-product" "gateway" "frontend/client" "order-service")
```

**Bước 4** — Tạo secret `ORDER_ENV_DEV` trên GitHub

---

## Sửa smoke test endpoints

Trong `ci-main.yml`, tìm block `Run smoke tests` và sửa path cho đúng
với routing thực tế của gateway:

```bash
check "auth route"    "$BASE/api/auth/health"     "200"
check "product route" "$BASE/api/products/health" "200"
```

---