# DevOps Production Readiness

Tài liệu này mô tả luận điểm trung tâm của đồ án: khi một hệ thống microservices được đưa lên production, tốc độ phản hồi, độ ổn định và khả năng chịu tải không phải là trách nhiệm riêng của Developer hoặc Operator. Đó là trách nhiệm chung của cả quy trình DevOps.

## Luận Điểm Chính

Một ứng dụng chạy tốt trên production không chỉ vì code đúng, cũng không chỉ vì hạ tầng mạnh. Production readiness đến từ sự kết hợp giữa:

```text
Developer viết code có khả năng chịu tải, dễ quan sát, dễ rollback
Operator/Platform cung cấp hạ tầng ổn định, autoscaling, secret, ingress, monitoring
CI kiểm tra chất lượng source code và artifact
FluxCD triển khai nhất quán theo GitOps
Staging validation chứng minh artifact đủ an toàn trước production
```

Vì vậy, câu hỏi của đồ án không chỉ là:

```text
Ứng dụng có chạy được không?
```

Mà là:

```text
Ứng dụng có đủ bằng chứng để được phép chạy trước người dùng cuối không?
```

## Trách Nhiệm Của Developer

Developer chịu trách nhiệm tạo ra phần mềm có thể vận hành được:

```text
API trả lỗi rõ ràng
health check hoạt động đúng
không hard-code endpoint/secret
code đọc config từ environment
query database có index phù hợp
cache Redis được dùng đúng chỗ
không dùng thao tác nguy hiểm ở tải lớn nếu chưa kiểm soát
log đủ thông tin để debug
test được các luồng nghiệp vụ chính
```

Ví dụ trong hệ thống này:

```text
Auth service phải expose /health
Product service phải chịu được cache miss/cache hit
Gateway phải route lỗi rõ ràng
Frontend phải dùng /api hoặc VITE_API_BASE_URL thay vì hard-code localhost
```

## Trách Nhiệm Của Operator/Platform

Operator hoặc platform layer chịu trách nhiệm tạo môi trường chạy ổn định:

```text
Kubernetes resource requests/limits hợp lý
HPA scale theo tải
Ingress và DNS ổn định
secret production không nằm plaintext trong Git
FluxCD sync đúng desired state
rollback có thể thực hiện được
metrics/logs đủ để quan sát sự cố
database/cache có sizing phù hợp
```

Nếu hạ tầng yếu hoặc cấu hình sai, code tốt vẫn có thể fail khi gặp traffic thật.

## Trách Nhiệm Chung

Những điểm sau không thuộc riêng Dev hay Ops:

```text
latency p95/p99
error rate
khả năng chịu 10.000 virtual users
khả năng scale khi tải tăng
thời gian phát hiện lỗi
khả năng rollback khi bản release xấu
production readiness decision
```

Đây là các chỉ số chung của toàn hệ thống. Một release chỉ nên được promote khi cả code và môi trường đều đã vượt qua quality gate.

## Quality Gate Trước Production

Quality gate là bộ điều kiện bắt buộc trước khi một image tag được phép lên production.

Trong đồ án này, gate gồm:

```text
CI build pass
dependency/security scan pass
Docker Compose smoke test pass
Helm render/lint pass
FluxCD sync staging thành công
staging health check pass
k6 10.000 user test pass threshold
không có pod restart/OOMKilled bất thường
error rate < 1%
p95 latency < 800ms
p99 latency < 1500ms
```

Nếu một điều kiện quan trọng fail, image tag đó không được promote sang production.

## Vì Sao Cần Staging Production-like

Local development không đủ để kết luận production readiness vì local thiếu:

```text
Ingress thật
network latency thật
autoscaling
resource limit
secret injection
database/cache production-like
traffic đồng thời lớn
observability production-like
```

Staging là nơi kết nối Dev và Ops:

```text
Dev thấy code phản ứng thế nào dưới tải thật
Ops thấy hạ tầng scale và chịu lỗi thế nào
CI/CD/GitOps chứng minh release có thể lặp lại
```

## Tình Huống Xấu Nhất Cần Tránh

Tình huống xấu nhất là một bản release chỉ pass ở local hoặc CI nhẹ, sau đó lên production rồi mới phát hiện:

```text
gateway timeout
product service tăng p99 latency
Redis nghẽn vì thao tác key lớn
MongoDB query chậm
HPA scale không kịp
pod OOMKilled
người dùng cuối gặp lỗi 5xx hàng loạt
rollback không rõ quy trình
```

Mục tiêu của đồ án là đưa các rủi ro này về staging, phát hiện trước khi người dùng cuối bị ảnh hưởng.

## Kết Luận

DevOps trong đồ án này không chỉ là dùng Docker, Kubernetes, GitHub Actions hay FluxCD. DevOps là quy trình biến một bản build thành một release có bằng chứng:

```text
có thể triển khai lặp lại
có thể quan sát
có thể chịu tải
có thể rollback
có thể được tin tưởng trước khi tới production
```

Đây là lý do phần đánh giá hiệu năng và staging validation là trọng tâm của đề tài.
