# Phan tich hanh vi nguoi dung

## 1. Muc dich

Tai lieu nay chuyen cac route va service hien co thanh hanh vi nguoi dung co the quan sat. Viec nay can thiet de test khong chi goi endpoint rieng le, ma phai chung minh cac hanh trinh co y nghia doi voi he thong.

## 2. Nhom tac nhan

| Tac nhan | Kha nang hien co | Muc do hien thuc |
| --- | --- | --- |
| Khach chua dang nhap | Mo trang login, dang ky/dang nhap qua API | Login co UI; register chi co API |
| Nguoi dung da dang nhap | Vao route `/`, goi product/order API | UI chi hien trang da dang nhap; nghiep vu chi co API |
| Nguoi mua hang | Xem san pham, tao/xem/huy don qua API | Backend co, frontend chua co |
| Nguoi quan ly danh muc | Tao/sua/xoa san pham qua API | API co nhung khong co role va UI quan tri |
| Nguoi van hanh | Kiem tra health, rollout, metrics, logs, traces, staging gate | Co cong cu va script ho tro |

Khong co role trong user model va JWT. Vi vay "nguoi mua" va "nguoi quan ly danh muc" chi la vai tro nghiep vu suy ra tu API, chua phai hai quyen truy cap duoc he thong enforce.

## 3. Hanh trinh tren giao dien hien tai

### 3.1 Dang nhap thanh cong

1. Nguoi dung mo `/login`.
2. Nhap email va password.
3. Frontend goi `POST /api/auth/login`.
4. Auth Service tra access token va refresh-token cookie.
5. Frontend luu access token vao Redux Persist.
6. Frontend dieu huong den `/`.
7. Man hinh hien `Main page (logged in)`.

Ket qua nguoi dung nhan duoc chi la xac nhan dang nhap. Khong co danh sach san pham hay thao tac tiep theo.

### 3.2 Dang nhap that bai

Backend tra 401 va message. Frontend chi ghi loi vao console, khong hien thong bao tren form. Doi voi nguoi dung, nut Login co ve khong phan hoi va khong giai thich email hay mat khau sai.

### 3.3 Khoi phuc phien

- Access token duoc persist o browser storage, nen reload trang van co the giu trang thai dang nhap.
- Khi mot request tra 401, Axios interceptor goi refresh va thu lai request.
- Neu refresh that bai, Redux bi logout.
- Frontend khong co thao tac logout chu dong va khong hien thong bao phien het han.

Can test qua browser that vi cookie co cac thuoc tinh `HttpOnly`, `SameSite=Strict` va `Secure` khi `NODE_ENV=production`. Integration test hien gan cookie bang header thu cong, khong mo phong day du quy tac cookie cua browser. Neu staging chi dung HTTP trong khi cookie co `Secure`, luong refresh tren browser co the khac voi test API.

## 4. Hanh trinh nghiep vu qua API

### 4.1 Xem danh muc san pham

1. Nguoi dung dang nhap va nhan access token.
2. Goi `GET /api/products?page=1&limit=20`.
3. Gateway kiem tra JWT.
4. Product Service doc cache; cache miss thi truy van MongoDB.
5. Nguoi dung nhan danh sach, tong so va so trang.
6. Nguoi dung co the loc theo ten, category va khoang gia.

Day la luong duoc k6 mo phong nhieu nhat. Tuy nhien k6 hien chi dung tham so page/limit, khong phu day hanh vi tim kiem va loc.

### 4.2 Xem chi tiet san pham

1. Nguoi dung goi `GET /api/products/:id`.
2. Product Service lay product va description tu hai collection.
3. Ket qua duoc cache de tang toc lan doc sau.

Trong k6, luong nay chi chay moi bon iteration khi bien `PRODUCT_ID` duoc truyen. Neu khong truyen, toan bo performance test chi doc danh sach.

### 4.3 Tao don hang

1. Nguoi dung gui danh sach productID, so luong va dia chi.
2. Gateway xac thuc token.
3. Order Service gui RPC giu stock cho tung san pham.
4. Product Service lock san pham, kiem tra stock va tru stock.
5. Order Service tinh tong tien tu gia do Product Service tra ve.
6. Don duoc luu vao MongoDB va tra 201.

Hanh vi dung mong doi:

- Het hang thi tu choi don.
- Co san pham khong ton tai thi tu choi don.
- Neu da giu mot phan stock roi gap loi, stock da giu duoc hoan lai.

### 4.4 Xem don hang

API cho phep:

- Doc mot don theo ID.
- Loc danh sach theo `userID`.
- Loc theo `productID` hoac `orderID`.

Hien tai userID den tu query/body, khong duoc rang buoc voi JWT. Do do day chua phai hanh vi "nguoi dung chi xem don cua minh".

### 4.5 Huy don hang

1. Nguoi dung goi `DELETE /api/orders/:id`.
2. Order Service lock don.
3. Hoan stock tung san pham qua RabbitMQ.
4. Xoa don va invalidation cache.

He thong chua co trang thai don, nen delete tuong duong huy vat ly. Khong co quy tac nhu chi huy khi chua giao.

### 4.6 Quan ly san pham

Nguoi dung da dang nhap co the goi POST/PATCH/DELETE `/api/products`. Vi khong co role check, he thong chua phan biet nguoi mua va quan tri vien. Day la khoang trong chuc nang va cung la mot yeu cau test quan trong neu do an mo ta co vai tro admin.

## 5. Hanh vi khi tai cao va su co

### 5.1 Doc san pham dong thoi

- Cache hit giup giam truy van MongoDB.
- Cache miss dau tien giu lock 5 giay.
- Request khac doi 100 ms de doc cache; neu chua co thi nhan `Server busy`.
- HPA co the tang Product/Gateway pod dua tren CPU, nhung can thoi gian khoi dong va readiness.

### 5.2 Dat hang dong thoi

- Lock theo product ID giup giam nguy co oversell.
- Moi order giu stock theo thu tu tung item.
- Chua co idempotency key, nen client retry POST sau timeout co the tao hai don.
- Chua co timeout RPC, nen nguoi dung co the cho lau khi RabbitMQ/Product gap su co.

### 5.3 Dependency gap su co

- Gateway health co the bao dependency `DOWN` neu request health that bai hoac qua 2 giay.
- Service health hien kiem tra MongoDB va Redis, nhung Order/Product health khong kiem tra RabbitMQ.
- Backend health co the tra 200 trong mot so truong hop MongoDB disconnected.
- Test can quan sat body, latency va log/trace, khong chi status code.

## 6. Mo hinh hanh vi cua k6 hien tai

Moi VU lap lai:

1. Dung cung mot access token duoc tao mot lan trong `setup()`.
2. Goi danh sach san pham.
3. Tuy chon goi chi tiet san pham moi bon iteration.
4. Nghi ngau nhien 0,5 den 2 giay.

Mo hinh nay dai dien cho **concurrent authenticated catalog readers**, khong dai dien cho day du nguoi dung thuong mai dien tu. No khong bao gom dang nhap theo tung user, tim kiem da dang, gio hang, tao don, huy don, refresh token hoac ty le hanh vi khac nhau.

Vi vay ten bao cao nen ghi:

> Kiem thu N virtual users dong thoi tren luong doc danh muc da xac thuc.

Khong nen ghi:

> He thong da phuc vu N nguoi dung mua hang dong thoi.

## 7. Hanh vi can uu tien kiem thu

| Uu tien | Hanh vi | Ly do |
| --- | --- | --- |
| P0 | Login tren browser, redirect va hien loi | Day la luong UI duy nhat hien co |
| P0 | Tao don, tru stock, huy don, hoan stock | Luong nghiep vu cot loi nhieu service |
| P0 | Don that bai phai rollback stock | Bao ve tinh nhat quan du lieu |
| P0 | Nguoi dung khong sua san pham/xem don nguoi khac | Hien chua co authorization |
| P1 | Refresh token trong browser va logout | API test thu cong cookie chua du |
| P1 | Hai request dat cung san pham dong thoi | Chung minh lock ngan oversell |
| P1 | Client retry tao don | Can idempotency de tranh don lap |
| P1 | RabbitMQ/Product timeout | RPC hien co the treo vo han |
| P1 | Loc category/gia va pagination bien | Chuc nang co nhung test con thieu |
| P2 | Multi-session cung tai khoan | Redis hien chi luu mot refresh token/user |

## 8. Ket luan

Hanh vi backend da du de trinh bay mot case study ro rang ve xac thuc, cache, messaging, distributed lock va compensating rollback. Hanh vi frontend lai chua du de trinh bay trai nghiem thuong mai dien tu dau cuoi.

Do do, danh gia va demo nen tach hai lop:

1. **Nguoi dung tren giao dien**: demo dang nhap va route duoc bao ve.
2. **Nghiep vu he thong qua API**: demo danh muc, don hang, ton kho, rollback va quan sat lien service.

