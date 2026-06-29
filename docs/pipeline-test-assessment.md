# Danh gia test va pipeline

## 1. Cau hoi danh gia

Danh gia test khong chi dua tren so luong test. Moi test duoc doi chieu voi ba cau hoi:

1. Test co kiem tra mot hanh vi co y nghia khong?
2. Test co chay tai dung lop va dung moi truong khong?
3. Khi test pass, ket luan nao thuc su duoc phep rut ra?

## 2. Ket luan dieu hanh

Bo test hien tai **dat nen tang kha tot o muc API integration va staging release gate**, dac biet voi luong auth, CRUD san pham, tao/huy don, tru/hoan stock va rollback. Docker Compose smoke test cung chung minh cac container co the khoi dong cung nhau.

Tuy nhien, bo test **chua du de ket luan ung dung thuong mai dien tu hoan chinh hoac production-ready** vi:

- Khong co unit test that trong tung service.
- Khong co browser/E2E test cho frontend.
- Deep contract/integration/k6 test khong chay trong GitHub Actions hien tai; chung nam trong script staging chay thu cong.
- k6 chi test luong doc product bang mot token dung chung.
- Chua test phan quyen, dat hang dong thoi, timeout RabbitMQ, idempotency va failure recovery.
- Staging gate chi kiem tra observability pod `Ready`, chua chung minh metrics/logs/traces da thu du lieu dung.

Danh gia theo muc tieu:

| Muc tieu | Muc do dap ung | Ket luan |
| --- | --- | --- |
| Build va khoi dong full stack | Tot | Compose build, health va smoke co y nghia |
| API health va dinh tuyen | Tot | Co direct service, gateway va ingress smoke |
| Auth API | Kha | Co login, register, refresh rotation, logout; thieu browser va multi-session |
| Product API | Kha | Co CRUD, cache invalidation; thieu validation va loc day du |
| Order va stock | Kha | Co happy path, restore va rollback; thieu concurrency/failure timeout |
| Frontend | Yeu | Chi kiem tra HTTP 200, khong kiem tra UI hoac JavaScript |
| Hieu nang | Mot phan | Do tot mot read path; khong phai workload nguoi dung tong hop |
| Observability | Mot phan | Kiem tra stack song, chua kiem tra telemetry va correlation |
| CD staging tu dong | Chua dat | CI cap nhat GitOps, nhung staging gate van phai chay thu cong |

## 3. Pipeline hien tai

### 3.1 CI theo service tren `develop`

Nam workflow `ci-auth.yml`, `ci-product.yml`, `ci-order.yml`, `ci-gateway.yml`, `ci-frontend.yml` chay khi path service tuong ung thay doi.

Moi workflow:

1. Checkout code.
2. Cai dependency bang `npm ci`.
3. Chay lint neu package co script lint.
4. Chay test neu package co script test.
5. Chay `npm audit`, nhung `|| true` lam ket qua audit khong chan pipeline.

Danh gia thuc te:

- Khong co file `*.test.*`, `*.spec.*` hay `__tests__` trong `apps/` va `services/`.
- Auth, Product va Gateway goi Jest nhung pass vi pipeline truyen `--passWithNoTests`.
- Order chi `echo "No tests configured"`.
- Frontend co Jest nhung khong co component test.
- Chi frontend khai bao lint; cac backend khong co lint script, nen `--if-present` bo qua.

Vi vay ten job `lint / test / audit` nghe day du hon bang chung ma no tao ra. Hien tai lop nay chu yeu xac minh dependency cai duoc va script khong crash.

### 3.2 CI tren `main`

Workflow `ci-main.yml` thuc hien:

1. Phat hien image nao bi anh huong.
2. Gitleaks scan.
3. Cai dependency, lint/test/audit cho tat ca nam ung dung.
4. Docker Compose build toan bo stack.
5. Khoi dong MongoDB, Redis Cluster, RabbitMQ va cac service.
6. Cho container healthy.
7. Chay Node smoke test.
8. Neu push vao `main`, chi push image co code thay doi len GHCR.
9. Cap nhat tag rieng cua service trong GitOps staging.

Diem dung:

- Build toan bo image va khoi dong full stack bat duoc loi Dockerfile, dependency runtime va ket noi co ban.
- Smoke test chay qua process that, khong mock MongoDB/Redis/RabbitMQ.
- Chi push image thay doi giup giam cong viec registry.
- GitOps nhan immutable tag `sha-xxxxxxx` theo tung service.

Diem con thieu:

- Build matrix khong co unit test that.
- `npm audit` chi canh bao, khong phai quality gate.
- Compose smoke chay cho moi thay doi `main`, du thay doi chi o tai lieu.
- Contract va integration test khong chay trong workflow nay.
- Khong co ket qua staging sau khi Flux reconcile trong GitHub Actions.

### 3.3 CD va staging gate

GitHub Actions khong deploy truc tiep vao cluster. Sau khi CI cap nhat GitOps repository, FluxCD reconcile staging.

`scripts/production-readiness-gate.sh` sau do co the chay thu cong de kiem tra:

- Kubernetes API va node Ready.
- Flux HelmRelease Ready.
- Deployment app Available.
- Data va observability pod Ready.
- Tai nguyen, image, event va restart baseline.
- Ingress smoke.
- Frontend/service smoke qua port-forward.
- Node smoke, contract va integration.
- k6 smoke/load/spike/soak theo bien bat/tat.
- Restart budget va OOMKilled.
- Bao cao Markdown va k6 JSON.

Day la mot release gate co pham vi rong, nhung **chua co trigger tu dong sau Flux sync**. No la cong cu staging validation thu cong, khong nen mo ta la mot stage bat buoc tu dong cua CD neu chua co runner/webhook thuc thi no.

## 4. Danh gia tung nhom test

### 4.1 Smoke test

Dang kiem tra:

- Health Auth/Product/Order va trang thai MongoDB/Redis.
- Gateway health va dependency.
- JWT guard voi missing/fake token.
- Endpoint auth, product, order co phan hoi.
- Reverse proxy va frontend tra HTTP 200.

Diem dung:

- Nhanh, pham vi rong, phu hop dat truoc push image.
- Kiem tra status va mot so response body, khong chi ping port.

Diem chua dung/day du:

- Test frontend chi thay file HTML 200; JavaScript co the crash hoac trang trang ma test van pass.
- Trong staging gate, `NGINX_URL` duoc gan vao gateway port-forward. Nhom mang ten `Nginx reverse proxy` luc nay thuc te lai goi Gateway, khong phai Nginx/Ingress.
- Ingress smoke khong goi Order health.
- Cac lenh curl ingress chi dung `-f`, khong xac minh body `database/redis connected`.
- Health Order/Product khong kiem tra RabbitMQ.

### 4.2 Contract test

Dang kiem tra:

- Kieu va truong response cua Auth, Product, Order va Gateway.
- Status code cho mot so loi.
- Product pagination va CRUD.
- Health response shape.

Diem dung:

- Bat duoc thay doi response shape co the lam client hong.
- Co kiem tra cookie HttpOnly va JWT format.
- Co kiem tra san pham va don neu du lieu ton tai.

Diem chua dung/day du:

- Contract duoc viet bang assertion thu cong, khong co OpenAPI/JSON Schema lam nguon hop dong doc lap.
- Mot so test bo qua assertion neu database rong, nen pass khong dam bao item contract.
- Test `missing products` chap nhan ca 400 hoac 500, lam giam gia tri cua contract.
- Tao du lieu truc tiep tren service, bo qua gateway authorization. Dieu nay hop ly cho provider contract, nhung khong chung minh public API an toan.
- Test co the de lai user/product trong database khi dung giua chung hoac khi DB ban dau rong.

### 4.3 Integration test

Dang kiem tra:

- Register, duplicate register, login.
- Access token qua gateway.
- Refresh-token rotation, reject token cu va logout.
- Product CRUD qua gateway va cache invalidation.
- Tao don, tru ton kho, doc/filter don, huy don va hoan stock.
- Rollback stock khi mot item trong don that bai.
- Gateway chan request khong co token.

Day la nhom test manh nhat cua du an vi no kiem tra nghiep vu qua nhieu process va dependency that.

Khoang trong:

- Khong test authorization theo owner/role.
- Khong test hai order dong thoi voi cung stock de chung minh khong oversell.
- Khong test duplicate POST/retry va idempotency.
- Khong test RabbitMQ mat ket noi, Product Service cham/down hoac RPC timeout.
- Khong test delete order that bai giua luc hoan nhieu item.
- Khong test input bien nhu quantity 0/am, product list rong, gia/stock am.
- User tao boi integration test khong duoc xoa.

### 4.4 k6 smoke, load, spike va soak

| Profile | Hinh dang tai mac dinh | Muc dich thuc te |
| --- | --- | --- |
| Smoke | 10 VU trong 1 phut | Xac minh script va read path chay duoc |
| Load 1k | Ramp 1 phut, giu 1.000 VU 3 phut, ramp down 1 phut | Do authenticated product-read path o tai on dinh ngan |
| Load 10k | Tuong tu voi 10.000 VU | Thu tai rat cao, can load generator du nang luc |
| Spike | 100 len target trong 30 giay, giu 2 phut | Do phan ung voi tang tai dot ngot |
| Soak | Ramp 2 phut, giu target trong thoi gian cau hinh | Tim suy giam, leak va restart theo thoi gian |

Threshold chung:

- HTTP failure rate < 1%.
- p95 < 800 ms.
- p99 < 1.500 ms.
- Check pass rate > 99%.

Diem dung:

- Profile duoc tach rieng va co summary JSON.
- Co ramp-up/ramp-down va think time.
- Chay qua ingress doi voi load/spike/soak.
- Suite cho he thong nghi giua cac profile.

Gioi han lam thay doi cach dien giai ket qua:

- `setup()` login mot lan va chia cung access token cho moi VU.
- Workload gan nhu chi GET product list. Product detail chi chay neu co `PRODUCT_ID`.
- Khong co login per-user, refresh, search mix, order write hay cancel.
- VU la virtual concurrency, khong tu dong tuong duong nguoi dung thuc.
- Moi profile dung cung threshold. Spike co the can threshold rieng cho cua so dot bien; soak can them tieu chi memory growth/restart theo thoi gian.
- Nguon cua cac threshold 800 ms va 1.500 ms chua duoc lien ket voi SLO hay yeu cau nghiep vu.
- Load generator cung co the la nut that, nhat la profile 10k, nhung gate khong thu metrics cua may tao tai.

Ket luan dung khi k6 pass:

> Trong cau hinh va thoi diem test, he thong dat cac threshold tren luong doc danh muc da xac thuc voi N VU.

Ket luan khong duoc phep:

> Toan bo he thong mua hang phuc vu on dinh N nguoi dung dong thoi.

### 4.5 Restart, OOM va observability

Gate chup tong restart truoc va sau test, dong thoi tim `OOMKilled` o app pod.

Diem dung:

- Bien restart thanh dieu kien fail thay vi chi quan sat bang mat.
- Bao ve khoi truong hop latency dep vi pod crash/restart am tham.

Gioi han:

- Tong restart khong gan theo UID cua pod. Neu HPA/rollout xoa pod cu, phep tru tong co the bo sot restart.
- Chi kiem app namespace cho OOM; khong kiem data/observability.
- Observability gate chi `kubectl wait pod Ready`.
- Khong query Prometheus de chung minh co sample, Elasticsearch de chung minh co log, hoac Jaeger de chung minh trace lien gateway-product/order.
- Khong luu metrics/log/trace cua dung time window test vao artifact.

## 5. Ma tran bao phu hanh vi

| Hanh vi/rui ro | Test hien co | Danh gia |
| --- | --- | --- |
| Service khoi dong va ket noi dependency | Compose health + smoke | Tot |
| Gateway dinh tuyen va JWT guard | Smoke + integration | Tot |
| Dang ky/dang nhap API | Contract + integration | Tot |
| Refresh/logout API | Integration | Tot o cap HTTP client |
| Login tren browser | Khong co | Thieu |
| Frontend render va route `/login` | Chi GET `/` 200 | Thieu |
| Product list/detail | Smoke + contract + integration + k6 | Tot cho basic path |
| Loc category/min/max | Khong co | Thieu |
| Product CRUD va cache invalidation | Contract + integration | Kha |
| Role admin cho product write | Khong co va code chua enforce | Thieu nghiem trong |
| Tao/huy order, tru/hoan stock | Integration | Tot cho happy path |
| Rollback khi item sau that bai | Integration | Tot |
| Owner authorization cua order | Khong co va code chua enforce | Thieu nghiem trong |
| Oversell khi dat dong thoi | Khong co | Thieu |
| Retry/idempotency tao order | Khong co | Thieu |
| RabbitMQ/Product timeout | Khong co, code chua timeout | Thieu |
| Cache stampede | Load doc gian tiep | Mot phan |
| Rate limiter | Khong co | Thieu |
| HPA scale-out va recovery | Chi capture resource/event | Mot phan |
| Self-healing delete pod | Khong co trong gate | Thieu |
| Metrics co du lieu | Chi pod Ready | Thieu |
| Logs co du lieu va dung field | Chi pod Ready | Thieu |
| Distributed trace lien service | Chi pod Ready | Thieu |
| Backup/restore | Khong co | Ngoai gate hien tai |

## 6. Test co du va dung hay chua?

### 6.1 Du cho pham vi nao?

Bo test du de chung minh:

- Cac service va dependency chay cung nhau.
- API cot loi co response shape tuong doi on dinh.
- Luong order-product co stock reservation va rollback co ban.
- Staging co the chiu mot workload doc san pham duoc dinh nghia, neu threshold pass.
- Release co the bi chan boi deployment, health, test, latency, restart hoac OOM.

### 6.2 Chua du cho pham vi nao?

Bo test chua du de chung minh:

- Trai nghiem nguoi dung dau cuoi tren browser.
- Phan quyen va so huu du lieu dung.
- Tinh nhat quan khi co request dong thoi/retry/dependency outage.
- Workload mua hang thuc te.
- Observability da thu du ba loai du lieu va truy nguyen duoc root cause.
- Staging validation tu dong sau moi Flux reconciliation.
- Production reliability dai han.

### 6.3 Test nao dang gan nhan chua chinh xac?

1. `Nginx reverse proxy` trong staging gate co the dang goi Gateway port-forward.
2. `1k/10k users` thuc chat la VU doc product dung chung token.
3. Job `Build & test` co phan service test nhung khong co unit test that.
4. `npm audit` khong phai gate vi loi bi `|| true` bo qua.
5. `observability pods ready` chi chung minh process song, khong chung minh telemetry ton tai.

## 7. De xuat bo sung theo uu tien

### P0: Can de ket luan test dung

1. Them browser E2E toi thieu: mo `/login`, dang nhap, redirect `/`, hien loi khi sai, reload va refresh session.
2. Them authorization rule va test: buyer khong duoc CRUD product; user chi xem/huy order cua minh.
3. Them unit test cho auth token logic, product cache/lock va order compensation.
4. Doi cach mo ta k6 thanh VU tren authenticated catalog-read path; khong goi la day du user journey.
5. Them telemetry smoke sau test: Prometheus co sample, Elasticsearch co document log, Jaeger co trace gateway-product.

### P1: Can de tang do tin cay nghiep vu

1. Test dat dong thoi cung mot product de chung minh khong oversell.
2. Them timeout cho RabbitMQ RPC va test dependency down/cham.
3. Them idempotency cho tao order va test retry cung key.
4. Validate payload va test cac boundary quantity, price, stock, page, limit.
5. Don dep test data bang unique run ID va `after()` ke ca khi test that bai.
6. Sua health de tra 503 neu dependency bat buoc disconnected; them RabbitMQ health.

### P2: Can cho staging gate hoan chinh hon

1. Trigger smoke/readiness sau Flux sync; giu load/spike/soak manual hoac scheduled.
2. Thu metrics load generator va app trong dung test window.
3. Theo doi restart theo pod UID/container thay vi tong don gian.
4. Them post-load recovery check cho latency, replica va queue backlog.
5. Dinh nghia threshold rieng cho load, spike va soak tu baseline/SLO cua do an.

## 8. Pipeline de xuat

```text
Pull request/develop
  -> dependency install
  -> lint
  -> unit/component tests theo service thay doi
  -> build service thay doi

Merge main
  -> Gitleaks
  -> unit/component tests
  -> Docker Compose smoke
  -> contract/integration cho API/business thay doi
  -> push chi image thay doi len GHCR
  -> cap nhat GitOps staging

FluxCD staging Ready
  -> tu dong: ingress smoke + mot browser E2E + telemetry smoke
  -> co dieu kien/manual: contract/integration day du
  -> manual/scheduled: load + spike + soak
  -> tong hop k6 + metrics + logs + traces
  -> quality gate
  -> promote dung image tag da test
```

## 9. Ket luan cuoi

Bo test hien tai khong phai la "thieu het". No co gia tri that o integration nghiep vu va staging load validation. Van de chinh la su lech giua ten goi va bang chung:

- CI noi service test nhung chua co unit test.
- Frontend smoke noi app song nhung chi thay HTML 200.
- k6 noi user load nhung chi mo phong mot read path.
- Observability noi stack Ready nhung chua xac minh du lieu.

Neu sua bon diem lech nay va bo sung cac test P0, do an se co mot cau chuyen chat che: moi test dai dien cho mot hanh vi/rui ro ro rang, va moi ket luan deu co bang chung tu code, pipeline va observability.

