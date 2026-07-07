# Nội dung bổ sung báo cáo DACN — Phần 4.3 (viết tiếp), Chương 5, Chương 6, Tài liệu tham khảo

> Ghi chú: số liệu trong Chương 5 lấy từ lần chạy gate thật `20260630-053233`
> (image `sha-c6dede8`). Các chỗ `[Chèn ảnh: ...]` là vị trí nên chèn ảnh chụp
> màn hình thật (console gate, biểu đồ k6, Grafana, Jaeger, Kibana).

---

## 4.3. Staging Quality Gate (phần viết tiếp)

*(Nối tiếp ngay sau câu "… Nếu pass hết các điều kiện trên,")*

… quy trình mới chuyển sang giai đoạn đánh giá chất lượng thực sự. Toàn bộ quy
trình được đóng gói trong một script duy nhất `scripts/production-readiness-gate.sh`,
đóng vai trò là **một cổng chất lượng (quality gate)** đặt giữa môi trường staging
và môi trường production. Vai trò của nó là biến câu hỏi cảm tính "hệ thống chạy ổn
chưa?" thành một quyết định **PASS/FAIL** dựa trên bằng chứng có thể kiểm chứng và
tái lập.

### Mô hình gate hai tầng

Mỗi bước kiểm tra trong gate được phân loại theo mức độ nghiêm trọng thông qua hai
cơ chế khác nhau:

- **Điều kiện tiên quyết (require-step):** là các điều kiện hạ tầng bắt buộc phải
  đúng trước khi việc đánh giá có ý nghĩa, ví dụ cluster `readyz`, các node ở trạng
  thái Ready, HelmRelease `dacn` của staging đã Ready, các Deployment của ứng dụng
  đã Available, các pod tầng dữ liệu (MongoDB, Redis, RabbitMQ) và tầng quan sát đã
  Ready. Nếu một điều kiện tiên quyết thất bại, gate **dừng ngay lập tức** và không
  chạy tiếp, bởi vì mọi kết quả thu được sau đó đều không đáng tin.
- **Hạng mục đánh giá (run-step):** là các bài kiểm thử chức năng, kiểm thử tải và
  thu thập bằng chứng quan sát. Các bước này **không dừng** toàn bộ quy trình khi
  thất bại mà được ghi nhận lại và cộng dồn vào bộ đếm lỗi `FAILED_STEPS`. Nhờ đó,
  một lần chạy gate luôn đi đến cuối và sản sinh ra một báo cáo đầy đủ, liệt kê tất
  cả hạng mục đạt và không đạt thay vì dừng ở lỗi đầu tiên.

Cách phân tầng này phản ánh đúng tư duy vận hành thực tế: lỗi hạ tầng là lỗi chặn
(blocking), còn lỗi chức năng hay hiệu năng là bằng chứng cần được thu thập trọn vẹn
để con người ra quyết định.

### Định danh phiên kiểm thử (test run ID)

Mỗi lần chạy gate được gán một định danh duy nhất `TEST_RUN_ID`
(ví dụ `staging-20260629T223233Z`). Định danh này được tiêm vào tải kiểm thử qua
header `X-Test-Run-ID`, sau đó được dùng làm khóa truy vấn chung khi đối chiếu
metrics trên Prometheus, logs trên Elasticsearch và traces trên Jaeger. Đây chính là
sợi chỉ đỏ cho phép thu hẹp toàn bộ bằng chứng quan sát về đúng một cửa sổ thời gian
và đúng một phiên kiểm thử, tránh lẫn với lưu lượng nền khác.

### Các nhóm hạng mục đánh giá

Sau khi vượt qua điều kiện tiên quyết, gate lần lượt thực hiện:

- **Kiểm thử chức năng:** smoke test, contract test và integration test chạy trực
  tiếp lên các service đang sống trong staging (thông qua port-forward), kiểm tra
  hành vi nghiệp vụ và hợp đồng API.
- **Kiểm thử tải:** sử dụng k6 với nhiều hồ sơ tải khác nhau (smoke, 1k, spike,
  soak) bắn vào ingress giống production để đo độ trễ, tỉ lệ lỗi và khả năng chịu
  tải.
- **Thu thập bằng chứng quan sát:** sau khi có lưu lượng, gate truy vấn Prometheus,
  Elasticsearch và Jaeger theo `TEST_RUN_ID` để chứng minh hệ thống thực sự quan sát
  được dưới tải.
- **Ngân sách ổn định:** so sánh số lần restart container trước và sau khi kiểm thử
  (mặc định cho phép tăng thêm 0), đồng thời khẳng định không có container nào bị
  `OOMKilled` trong suốt phiên.

### Báo cáo và quyết định

Kết thúc, gate sinh ra một báo cáo Markdown `production-readiness-summary.md` gồm:
bảng tổng hợp PASS/FAIL từng hạng mục, bảng số liệu k6, phần bằng chứng quan sát,
danh sách image thực tế đang chạy và một **quyết định cuối cùng**. Nếu
`FAILED_STEPS = 0`, quyết định là PASS — artifact đủ điều kiện promote lên
production *với điều kiện cùng một image tag được promote qua GitOps*. Ngược lại,
quyết định là FAIL và việc promote bị chặn.

Quyết định này không chỉ mang tính tham khảo: script promote production
`scripts/promote-production.sh` (trong repo GitOps) sẽ **đọc lại chính báo cáo này**
trước khi cập nhật image tag cho môi trường production. Nó kiểm tra rằng báo cáo
không chứa hạng mục FAIL, có dòng quyết định PASS, và image tag trong báo cáo trùng
khớp với tag được promote. Nhờ vậy, cổng chất lượng được nối trực tiếp vào hành động
promote, biến "đã test pass" thành điều kiện kỹ thuật bắt buộc chứ không phải một
bước thủ công dễ bị bỏ qua.

---

## 4.4. Promote lên môi trường Production (Zero Downtime)

Sau khi cổng chất lượng kết luận PASS, bước cuối cùng của quy trình là đưa đúng
artifact đã được kiểm thử lên môi trường production mà **không gây gián đoạn dịch vụ
(zero downtime)**. Bước này được thiết kế như một cổng kiểm soát thứ hai, đặt giữa
quyết định của con người và trạng thái thật của production.

### Trạng thái suspend của production

Khác với staging luôn được FluxCD đồng bộ tự động, HelmRelease của production được giữ
ở trạng thái **suspend** cho tới khi được promote một cách chủ ý. Khi suspend, FluxCD
bỏ qua mọi thay đổi của HelmRelease production, nghĩa là một commit cập nhật image
staging **không bao giờ tự động chảy thẳng lên production**. Đây là ranh giới an toàn:
production chỉ thay đổi khi có một hành động promote tường minh.

### Cơ chế promote có kiểm soát

Việc promote được thực hiện bằng script `scripts/promote-production.sh` trong repo
GitOps. Trước khi chạm vào production, script thực hiện một loạt kiểm tra trên chính
báo cáo của cổng chất lượng:

- Image tag trong báo cáo gate phải **trùng khớp** với tag chuẩn bị promote (không thể
  promote một tag chưa từng được kiểm thử).
- Báo cáo **không được chứa bất kỳ hạng mục FAIL** nào.
- Báo cáo phải có dòng **quyết định PASS** ("đủ điều kiện promote lên production").
- Toàn bộ image được liệt kê trong báo cáo phải dùng đúng tag đó.

Chỉ khi vượt qua tất cả các kiểm tra này, script mới cập nhật `imageTag` cho HelmRelease
production và **bỏ trạng thái suspend** (`suspend: true → false`). Thay đổi này được
commit lên repo GitOps; FluxCD phát hiện commit mới và tiến hành reconcile production.
Nhờ vậy, ngay cả thao tác promote — vốn nhạy cảm nhất — cũng được ràng buộc bằng bằng
chứng kiểm thử thay vì dựa vào trí nhớ hay thiện chí của người vận hành. (Script có
cung cấp một cờ ghi đè dành riêng cho demo trong môi trường lab, nhưng cờ này tách
biệt và không dùng trong quy trình chuẩn.)

### Bảo đảm không gián đoạn dịch vụ

Tính zero downtime đến từ sự phối hợp của nhiều lớp cơ chế ở tầng Kubernetes và FluxCD:

- **Rolling update:** Deployment cập nhật theo kiểu cuốn chiếu — pod mang image mới
  được tạo và phải sẵn sàng trước, pod cũ chỉ bị thu hồi sau đó, nên luôn có bản đang
  phục vụ trong suốt quá trình rollout.
- **Readiness probe:** mỗi pod chỉ được đưa vào danh sách nhận lưu lượng sau khi
  endpoint health trả về thành công. Pod mới chưa kết nối xong MongoDB/Redis sẽ không
  nhận request, tránh trả lỗi cho người dùng trong lúc khởi động.
- **Liveness probe:** container rơi vào trạng thái treo sẽ tự được khởi động lại.
- **Tự phục hồi của Flux (upgrade remediation):** nếu bản nâng cấp thất bại, FluxCD tự
  động thử lại tới ba lần, đóng vai trò như một lưới an toàn cho việc rollback.
- **Thứ tự phụ thuộc (dependsOn):** production chỉ được triển khai sau khi các thành
  phần hạ tầng (ingress, MongoDB, Redis, RabbitMQ) đã sẵn sàng, tránh tình trạng ứng
  dụng lên trước phụ thuộc.
- **Tự co giãn (HPA):** các service production bật autoscaling để duy trì đủ số bản
  sao phục vụ ngay cả trong lúc rollout.

Kết hợp lại, một lần promote production là một chuỗi khép kín: gate PASS → script
kiểm tra lại bằng chứng → cập nhật GitOps và bỏ suspend → FluxCD reconcile → Kubernetes
rolling update với readiness gate → dịch vụ chuyển sang phiên bản mới mà người dùng
cuối không cảm nhận được sự gián đoạn. Đây chính là hiện thực của mục tiêu "promote
Zero Downtime cho production sau khi đã test ổn định trên staging" mà đề tài đặt ra.

[Chèn ảnh: production HelmRelease chuyển từ suspend sang Ready sau promote, hoặc log rollout không có downtime]

---

## Chương 5. KIỂM THỬ VÀ ĐÁNH GIÁ

### 5.1. Kiểm thử hệ thống

#### 5.1.1. Mục tiêu kiểm thử

Mục tiêu của giai đoạn kiểm thử không phải là chứng minh ứng dụng "chạy được", mà là
trả lời một câu hỏi cụ thể hơn: **liệu phiên bản đang nằm trên môi trường staging có
đủ bằng chứng để được tin tưởng đưa lên môi trường production hay không**. Vì đề tài
tập trung vào hiệu năng và khả năng mở rộng, quy trình kiểm thử được thiết kế để vừa
xác nhận tính đúng đắn chức năng, vừa định lượng được hành vi của hệ thống dưới tải
và chứng minh hệ thống quan sát được trong lúc chịu tải.

Toàn bộ kịch bản kiểm thử được chạy trên môi trường staging — một bản sao của
production dùng chung manifest GitOps — ngay sau khi FluxCD đồng bộ image mới. Cách
làm này bảo đảm những gì được kiểm thử chính là những gì sẽ được triển khai.

#### 5.1.2. Kiến trúc kiểm thử phân tầng

Quy trình kiểm thử được tổ chức thành bốn tầng, đi từ rẻ–nhanh đến đắt–chậm, theo
đúng tinh thần "kim tự tháp kiểm thử":

| Tầng | Loại kiểm thử | Câu hỏi cần trả lời |
| --- | --- | --- |
| 1 | Kiểm thử chức năng (smoke, contract, integration) | Hệ thống có hành xử đúng nghiệp vụ và đúng hợp đồng API không? |
| 2 | Kiểm thử tải (k6: smoke, 1k, spike, soak) | Hệ thống chịu tải tới mức nào, độ trễ và tỉ lệ lỗi ra sao? |
| 3 | Bằng chứng quan sát (Prometheus, Elasticsearch, Jaeger) | Hệ thống có quan sát được trong lúc chịu tải không? |
| 4 | Ngân sách ổn định (restart, OOMKilled) | Hệ thống có ổn định, không sập hay rò rỉ tài nguyên dưới tải không? |

Các tầng được thực thi tuần tự trong cùng một lần chạy gate. Tầng thấp đóng vai trò
sàng lọc nhanh cho tầng cao: nếu chức năng đã sai thì không cần bận tâm tới con số
hiệu năng.

### 5.2. Kịch bản kiểm thử chức năng

Tầng chức năng gồm ba bộ kiểm thử viết bằng `node:test`, chạy đối trực tiếp các
service thật trong staging.      

**a) Smoke test — kiểm tra sống còn.** Xác nhận từng thành phần ở trạng thái khỏe
mạnh tối thiểu: endpoint `/health` của Auth, Product, Order trả về 200 và báo
`database`, `redis` đã `connected`; `/api/health` của Gateway trả về 200 và tất cả
phụ thuộc ở trạng thái `UP`; lớp bảo vệ JWT của Gateway chặn đúng (không token →
401, token giả → 403); reverse proxy Nginx định tuyến đúng tới frontend và các API.

**b) Contract test — kiểm tra hợp đồng API.** Xác nhận hình dạng (shape) của
response đúng cam kết để frontend và các service phụ thuộc không bị vỡ. Ví dụ: đăng
nhập trả về `accessToken` dạng JWT ba phần và đặt cookie `refreshToken` với cờ
`HttpOnly`; danh sách sản phẩm trả về đúng cấu trúc `{ products, total, page,
totalPages }`; tạo sản phẩm trả về 201 kèm `_id`; các trường hợp lỗi (sai mật khẩu,
email không tồn tại, id không tồn tại) đều trả về đúng mã lỗi kèm trường `message`.

**c) Integration test — kiểm tra luồng nghiệp vụ đầu–cuối.** Đây là tầng quan trọng
nhất vì nó kiểm chứng đúng những yêu cầu phi chức năng mà đề tài đặt ra:

- *Luồng xác thực với token rotation:* đăng ký → đăng nhập → gọi API qua Gateway
  bằng access token → refresh và nhận về cặp token mới; access token và refresh
  token cũ **bị thu hồi (403)** sau khi xoay vòng; sau khi logout, refresh token
  không còn dùng được. Bài test này chứng minh cơ chế Token Rotation + Whitelist
  dựa trên cụm Redis hoạt động đúng.
- *Vòng đời sản phẩm và bất biến cache:* tạo → đọc → cập nhật giá → đọc lại thấy
  **giá mới** (cache đã được invalidate đúng) → xóa → đọc lại nhận 404. Bài test này
  xác nhận chiến lược cache-aside không phục vụ dữ liệu lỗi thời.
- *Đặt hàng và trừ tồn kho bằng khóa phân tán:* tạo đơn hàng làm **giảm đúng số
  lượng tồn kho**, xóa đơn hàng **hoàn lại tồn kho**. Bài test này kiểm chứng giao
  tiếp message broker giữa Order và Product cùng khóa phân tán Redis bảo toàn tính
  nhất quán của trường `stock`.
- *Hoàn tác khi đặt hàng thất bại (rollback):* đơn hàng gồm một sản phẩm hợp lệ và
  một sản phẩm không tồn tại bị từ chối (400) và tồn kho của sản phẩm hợp lệ **không
  bị trừ**; đơn hàng vượt quá tồn kho cũng bị từ chối và tồn kho giữ nguyên. Bài test
  này chứng minh tính nguyên tử (atomicity) của thao tác đặt hàng phân tán.

[Chèn ảnh: console gate khi các bước "node smoke / contract / integration tests" đều PASS]

### 5.3. Kịch bản kiểm thử hiệu năng

Tầng hiệu năng sử dụng k6, bắn lưu lượng qua đúng ingress giống production. Kịch bản
mô phỏng **luồng đọc có xác thực** — sát với hành vi người dùng thật của một hệ thống
thương mại điện tử: đăng nhập một lần ở bước `setup`, sau đó lặp lại liên tục thao
tác xem danh sách sản phẩm `GET /api/products?page=1&limit=20` (đi qua lớp cache
aside) kèm thỉnh thoảng xem chi tiết một sản phẩm. Mỗi request mang header
`X-Test-Run-ID` để phục vụ truy vết.

Hệ thống áp các **ngưỡng đạt/rớt (threshold)** thống nhất cho mọi hồ sơ tải:

- Tỉ lệ request lỗi `http_req_failed` < 1%.
- Độ trễ `http_req_duration`: p95 < 800 ms và p99 < 1500 ms.
- Tỉ lệ `checks` vượt qua > 99%.

Bốn hồ sơ tải được thiết kế cho các mục đích khác nhau:

| Hồ sơ | Cấu hình VU | Mục đích |
| --- | --- | --- |
| Smoke | 10 VU trong ~1 phút | Kiểm tra đường tải hoạt động, ngưỡng nới lỏng (p95 < 2000 ms) do ảnh hưởng khởi động nguội |
| 1k (production-like) | tăng dần 100 → 1000 VU, giữ 1000 VU trong 3 phút | Tải giống production để đo độ trễ và throughput ổn định |
| Spike | bật từ 100 → 1000 VU trong 30 giây, giữ 2 phút | Đánh giá phản ứng với tăng tải đột ngột (autoscaling, độ co giãn) |
| Soak | 300 VU duy trì trong 30 phút | Phát hiện rò rỉ bộ nhớ / suy giảm hiệu năng theo thời gian |

Giữa các hồ sơ tải có một khoảng "chờ hồi phục" (recovery wait) và một bước chờ tất
cả Deployment trở lại Available, để mỗi hồ sơ bắt đầu từ trạng thái sạch.

[Chèn ảnh: biểu đồ tiến trình k6 trong hồ sơ 1k VU — số VU và độ trễ theo thời gian]

### 5.4. Thu thập bằng chứng quan sát

Ngay sau khi tải kết thúc, gate gọi `scripts/collect-observability-evidence.sh` để
chứng minh hệ thống quan sát được trong đúng cửa sổ kiểm thử. Bước này truy vấn:

- **Prometheus:** CPU/memory so với limit, mức CPU throttling, số lần restart và số
  replica lớn nhất do HPA tạo ra trong cửa sổ test.
- **Elasticsearch:** số document log mang `testRunId` tương ứng, phân tách theo
  service, kèm số log nghi ngờ lỗi/timeout.
- **Jaeger:** số trace gắn tag `test_run_id`, đặc biệt là số trace đi theo đường
  Gateway → Product, và span dài nhất.

Một hạng mục quan sát chỉ PASS khi thực sự thu được bằng chứng (metrics, logs và
traces) trong đúng cửa sổ thời gian — nghĩa là hệ thống không chỉ chạy mà còn *kể lại
được* nó đã chạy thế nào.

[Chèn ảnh: Grafana dashboard namespace trong cửa sổ test] [Chèn ảnh: Jaeger trace Gateway → Product] [Chèn ảnh: Kibana Discover lọc theo test_run_id]

### 5.5. Kết quả và đánh giá

Phần này trình bày kết quả của một lần chạy gate đại diện trên image `sha-c6dede8`.

#### 5.5.1. Kết quả kiểm thử chức năng

Toàn bộ các bộ smoke, contract và integration đều PASS. Đáng chú ý, các bài
integration về token rotation, bất biến cache, trừ/hoàn tồn kho bằng khóa phân tán và
rollback khi đặt hàng thất bại đều đạt — xác nhận các yêu cầu phi chức năng cốt lõi
của hệ thống được bảo toàn trên môi trường staging thật.

#### 5.5.2. Kết quả kiểm thử hiệu năng

| Hồ sơ | VU tối đa | Tổng request | Throughput (req/s) | p95 (ms) | Tỉ lệ lỗi | Checks | Kết luận ngưỡng |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Smoke | 10 | 218 | 3.2 | 679 | 0% | 100% | Đạt lỗi & checks (p95 nới lỏng) |
| 1k | 1000 | 165 940 | 417.6 | 264 | 0% | 100% | Đạt toàn bộ |
| Spike | 1000 | 105 232 | 397.1 | 274 | 0% | 100% | Đạt toàn bộ |
| Soak | 300 | 145 728 | 158.7 | 240 | 0.15% | 99.93% | Đạt toàn bộ |

Nhận xét:

- Ở mức tải giống production **1000 VU**, hệ thống xử lý hơn **165 nghìn request** với
  **p95 ≈ 264 ms** và **0% lỗi** — thấp hơn nhiều so với ngưỡng p95 < 800 ms, cho
  thấy còn dư địa hiệu năng đáng kể.
- Hồ sơ **spike** cho thấy hệ thống hấp thụ được cú tăng tải đột ngột lên 1000 VU mà
  độ trễ p95 gần như không đổi (≈ 274 ms), chứng tỏ cơ chế co giãn phản ứng kịp.
- Hồ sơ **soak** 30 phút giữ p95 ≈ 240 ms với tỉ lệ lỗi chỉ 0.15% — không có dấu hiệu
  suy giảm hay rò rỉ tài nguyên theo thời gian.
- Hồ sơ **smoke** có p95 cao bất thường (679 ms) do hiệu ứng khởi động nguội ở vài
  request đầu; đây là lý do ngưỡng smoke được cố tình nới lỏng và không phản ánh hiệu
  năng ở trạng thái ổn định.

#### 5.5.3. Bằng chứng quan sát

| Nguồn | Trạng thái | Bằng chứng thu được |
| --- | --- | --- |
| Prometheus metrics | PASS | Có chuỗi CPU/memory trong cửa sổ test; CPU đỉnh ≈ 79.7% so với limit, memory đỉnh ≈ 20.2% |
| Elasticsearch logs | PASS | 12 document mang test run ID (Gateway 6, Product 6) |
| Jaeger traces | PASS | 200 trace, trong đó 196 trace đi theo đường Gateway → Product |
| HPA | — | Số replica lớn nhất quan sát được: 6 |
| Ổn định | PASS | Số container restart tăng thêm: 0; không có container OOMKilled |

Một chỉ số đáng lưu ý: **CPU throttling đạt đỉnh ≈ 52.6%**, cho thấy giới hạn CPU
(CPU limit) đang kìm bớt throughput dù tỉ lệ lỗi vẫn bằng 0. Đây là một gợi ý tối ưu
có giá trị: nới CPU limit hoặc tinh chỉnh ngưỡng HPA có thể tăng throughput hơn nữa.
Việc gate tự động phát hiện và ghi nhận điều này cho thấy giá trị của lớp bằng chứng
quan sát — nó không chỉ nói "đạt" mà còn chỉ ra điểm có thể cải thiện.

#### 5.5.4. Quyết định cổng chất lượng

Với toàn bộ hạng mục PASS (`FAILED_STEPS = 0`), gate kết luận **PASS**: artifact
`sha-c6dede8` đủ điều kiện promote lên production. Sau đó, lệnh promote production đọc
lại chính báo cáo này, xác nhận không có hạng mục FAIL, có quyết định PASS và image
tag trùng khớp, rồi mới cập nhật image tag cho production và bỏ trạng thái suspend của
HelmRelease production. Quy trình promote vì vậy được gắn chặt vào bằng chứng kiểm
thử thay vì dựa trên đánh giá cảm tính.

[Chèn ảnh: bảng tổng hợp Results trong production-readiness-summary.md với toàn bộ PASS]

#### 5.5.5. Đánh giá chung

Quy trình kiểm thử đạt được ba điều mà một quy trình kiểm thử đáng tin cậy cần có.
Thứ nhất, **tính khách quan**: kết quả là PASS/FAIL dựa trên ngưỡng định lượng và
bằng chứng, không phụ thuộc cảm tính người vận hành. Thứ hai, **tính tái lập**: cùng
một image và cùng kịch bản cho ra cùng cách đánh giá, mọi bằng chứng được lưu lại
trong thư mục artifact theo dấu thời gian. Thứ ba, **tính truy vết**: nhờ
`TEST_RUN_ID`, mọi metric, log và trace của một phiên đều có thể được tra cứu lại sau
này.

Tuy nhiên quy trình vẫn còn giới hạn cần thẳng thắn nhìn nhận: kiểm thử mới tập trung
vào *đường đọc có xác thực* mà chưa mô phỏng đầy đủ tỷ lệ ghi (đặt hàng) ở mức tải
cao; chưa có kiểm thử hỗn loạn (chaos) để chủ động tiêm lỗi; và việc đánh giá vẫn
dừng ở staging chứ chưa có giám sát hồi quy hiệu năng tự động trên production. Đây
chính là các hướng được đề xuất phát triển ở chương tiếp theo.

---

## Chương 6. KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN

### 6.1. Kết luận

Đề tài đã hoàn thành mục tiêu xây dựng một hệ thống thương mại điện tử theo kiến trúc
microservices và một quy trình triển khai – kiểm thử hoàn chỉnh trên nền tảng
Kubernetes, với trọng tâm là hiệu năng và khả năng mở rộng.

Về phần **ứng dụng**, nhóm đã hiện thực được ba backend microservices (Auth, Product,
Order) viết bằng NodeJS, mỗi service sở hữu cơ sở dữ liệu MongoDB riêng và giao tiếp
bất đồng bộ qua RabbitMQ, đứng sau một Gateway đóng vai trò reverse proxy kiêm rate
limiter. Cụm Redis được khai thác cho nhiều yêu cầu phi chức năng cốt lõi: quản lý
phiên với cơ chế token rotation, lớp cache-aside, khóa phân tán bảo toàn tồn kho và
rate limiter. Các bài kiểm thử tích hợp đã chứng minh những cơ chế này hoạt động đúng
trên môi trường thật.

Về phần **nền tảng triển khai**, nhóm đã xây dựng một pipeline CI/CD kết hợp tư duy
GitOps: GitHub Actions đảm nhận kiểm tra mã nguồn, smoke test, build và push image;
FluxCD đồng bộ tự động trạng thái mong muốn từ repository GitOps lên cluster, lấy Git
làm nguồn sự thật duy nhất cho cả hạ tầng lẫn ứng dụng. Hệ thống hỗ trợ hai môi
trường staging và production với cơ chế promote có kiểm soát.

Về phần **quan sát và kiểm thử**, nhóm đã triển khai một hệ thống observability đầy
đủ ba trụ cột (metrics với Prometheus/Grafana, logs tập trung với Elasticsearch/Kibana,
distributed tracing với Jaeger qua OpenTelemetry Collector) và — quan trọng nhất —
một **cổng chất lượng staging (Staging Quality Gate)** tự động hóa toàn bộ việc đánh
giá độ sẵn sàng production. Cổng chất lượng này kiểm thử phân tầng từ chức năng, tải,
bằng chứng quan sát đến ổn định, rồi kết luận PASS/FAIL bằng bằng chứng định lượng có
thể tái lập và truy vết. Kết quả kiểm thử thực tế cho thấy hệ thống chịu được mức tải
giống production 1000 VU với p95 khoảng 264 ms và 0% lỗi, đồng thời ổn định qua bài
soak 30 phút.

Tóm lại, đề tài không chỉ tạo ra một ứng dụng chạy được, mà tạo ra một **quy trình
hoàn chỉnh từ máy local của lập trình viên đến production**, trong đó mỗi lần phát
hành đều có thể kiểm thử, truy vết và rollback — đúng tinh thần đặt ra ban đầu.

### 6.2. Hướng phát triển

Nền tảng và bộ dữ liệu quan sát mà đề tài xây dựng được là bệ phóng cho những hướng
phát triển nâng cao, đưa hệ thống từ mức "vận hành được" lên mức "tự vận hành thông
minh". Nhóm đề xuất bốn hướng chính.

**a) AIOps — vận hành thông minh trên nền dữ liệu quan sát.** Hệ thống hiện đã sinh
ra liên tục ba luồng dữ liệu metrics, logs và traces được tương quan bằng
`TEST_RUN_ID`. Đây chính là tập dữ liệu đầu vào lý tưởng để áp dụng AI/ML vào vận
hành: phát hiện bất thường (anomaly detection) trên chuỗi thời gian thay cho ngưỡng
cảnh báo tĩnh; phân tích nguyên nhân gốc tự động (automated root cause analysis) bằng
cách lần theo trace và cụm log quanh thời điểm sự cố; và dự báo sự cố trước khi xảy
ra. Mục tiêu là chuyển hệ thống giám sát từ thế bị động (báo khi đã hỏng) sang thế
chủ động (cảnh báo trước và tự đề xuất hành động khắc phục).

**b) Dự báo tải và tự co giãn bằng Machine Learning.** Thay cho HPA phản ứng theo CPU
như hiện tại, có thể huấn luyện mô hình dự báo lưu lượng theo chu kỳ ngày/tuần và
theo sự kiện (flash sale) để **chủ động cấp phát tài nguyên trước khi tải đến**
(predictive autoscaling). Hướng này khai thác trực tiếp dữ liệu hiệu năng thật mà
cổng chất lượng đã thu thập, đồng thời giải quyết hiện tượng CPU throttling đã quan
sát được, hướng tới cân bằng tối ưu giữa hiệu năng và chi phí.

**c) Xây dựng nền tảng nội bộ cho lập trình viên (Internal Developer Platform).** Quy
trình CI/CD–GitOps–Quality Gate hiện tại có thể được tổng quát hóa thành một nền tảng
tự phục vụ (self-service platform) với các "đường ray vàng" (golden paths): lập trình
viên chỉ cần khai báo một service mới, nền tảng tự động sinh pipeline, manifest
GitOps, cấu hình quan sát và cổng chất lượng tương ứng. Đây là bước tiến từ "triển
khai một hệ thống" sang "cung cấp một nền tảng tái sử dụng" theo tư duy Platform
Engineering, giúp rút ngắn đáng kể thời gian đưa một dịch vụ mới lên production.

**d) Tích hợp hệ khuyến nghị bằng AI cho thương mại điện tử.** Ở tầng nghiệp vụ, hệ
thống có thể được bổ sung một microservice khuyến nghị (recommendation service) dùng
mô hình học máy để cá nhân hóa danh sách sản phẩm theo hành vi người dùng. Service
này tận dụng đúng kiến trúc đã có: dữ liệu hành vi thu thập qua message broker, mô
hình phục vụ sau Gateway, kết quả được cache bằng Redis và toàn bộ được kiểm thử qua
cùng một cổng chất lượng. Đây là hướng làm giàu giá trị nghiệp vụ trực tiếp cho hệ
thống thương mại điện tử, đồng thời là bài toán mở rộng tự nhiên cho kiến trúc
microservices.

Ngoài bốn hướng trọng tâm trên, hệ thống cũng sẵn sàng cho các thực hành nâng cao như
chaos engineering có hệ thống và progressive delivery (canary/blue-green) để tiếp tục
nâng cao độ tin cậy khi quy mô tăng lên.

---

## TÀI LIỆU THAM KHẢO

[1] S. Newman, *Building Microservices: Designing Fine-Grained Systems*, 2nd ed.
O'Reilly Media, 2021.

[2] B. Beyer, C. Jones, J. Petoff, and N. R. Murphy, *Site Reliability Engineering:
How Google Runs Production Systems*. O'Reilly Media, 2016.

[3] N. Forsgren, J. Humble, and G. Kim, *Accelerate: The Science of Lean Software
and DevOps*. IT Revolution Press, 2018.

[4] J. Humble and D. Farley, *Continuous Delivery: Reliable Software Releases through
Build, Test, and Deployment Automation*. Addison-Wesley, 2010.

[5] B. Burns, J. Beda, and K. Hightower, *Kubernetes: Up and Running*, 3rd ed.
O'Reilly Media, 2022.

[6] The Kubernetes Authors, "Kubernetes Documentation." [Online]. Available:
https://kubernetes.io/docs/

[7] Flux Authors, "Flux Documentation — GitOps Toolkit." [Online]. Available:
https://fluxcd.io/flux/

[8] Weaveworks, "GitOps: What you need to know." [Online]. Available:
https://www.weave.works/technologies/gitops/

[9] Prometheus Authors, "Prometheus — Monitoring system and time series database."
[Online]. Available: https://prometheus.io/docs/

[10] Grafana Labs, "Grafana Documentation." [Online]. Available:
https://grafana.com/docs/

[11] The OpenTelemetry Authors, "OpenTelemetry Documentation." [Online]. Available:
https://opentelemetry.io/docs/

[12] The Jaeger Authors, "Jaeger: open source, distributed tracing platform."
[Online]. Available: https://www.jaegertracing.io/docs/

[13] Elastic, "Elasticsearch Guide" and "Kibana Guide." [Online]. Available:
https://www.elastic.co/guide/

[14] Grafana Labs, "k6 Documentation — Load testing for engineering teams." [Online].
Available: https://k6.io/docs/

[15] Redis Ltd., "Redis Documentation." [Online]. Available: https://redis.io/docs/

[16] VMware, "RabbitMQ Documentation." [Online]. Available:
https://www.rabbitmq.com/documentation.html

[17] GitHub, "GitHub Actions Documentation." [Online]. Available:
https://docs.github.com/en/actions
