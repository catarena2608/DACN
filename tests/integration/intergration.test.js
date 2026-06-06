/**
 * Integration Tests
 *
 * Mục tiêu: test các luồng nghiệp vụ thực tế xuyên nhiều service,
 * đi qua Gateway giống hệt cách frontend sử dụng.
 *
 * Các luồng được test:
 *   1. Auth flow: register → login → refresh → logout
 *   2. Authenticated product CRUD qua gateway
 *   3. Order flow: login → tạo product → đặt hàng → kiểm tra tồn kho → xóa đơn → hoàn tồn kho
 *   4. Stock reservation rollback: đặt hàng với sản phẩm không đủ hàng
 *   5. Gateway auth guard: verify các protected route không thể truy cập khi không có token
 *
 * Biến môi trường:
 *   GATEWAY_URL   default http://localhost:3000
 *   AUTH_URL      default http://localhost:3001  (dùng để verify state)
 *   PRODUCT_URL   default http://localhost:3002  (bypass gateway cho setup)
 *
 * Seed user: nguyenhoa01@gmail.com / hoa123456
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const GATEWAY = process.env.GATEWAY_URL  || "http://localhost:3000";
const AUTH    = process.env.AUTH_URL     || "http://localhost:3001";
const PRODUCT = process.env.PRODUCT_URL  || "http://localhost:3002";

const SEED_EMAIL    = "nguyenhoa01@gmail.com";
const SEED_PASSWORD = "hoa123456";

// ─── helpers ───────────────────────────────────────────────────────────────
async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  let body = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) body = await res.json();
  const setCookie = res.headers.get("set-cookie") || "";
  return { status: res.status, body, headers: res.headers, setCookie };
}

// Lấy refresh token từ set-cookie header
function extractRefreshToken(setCookie) {
  const match = setCookie.match(/refreshToken=([^;]+)/);
  return match ? match[1] : null;
}

// ─── 1. AUTH FLOW ───────────────────────────────────────────────────────────
describe("Integration: Auth flow", () => {
  let accessToken    = null;
  let refreshCookie  = null;
  let testEmail      = null;

  // ── 1a. Register user mới ──
  test("register user mới thành công → 201", async () => {
    testEmail = `ci_test_${Date.now()}@test.com`;
    const { status, body } = await request(`${AUTH}/register`, {
      method: "POST",
      body: JSON.stringify({
        email: testEmail,
        name: "CI Test User",
        password: "citest123",
      }),
    });
    assert.equal(status, 201, `Register thất bại: ${JSON.stringify(body)}`);
  });

  // ── 1b. Register email trùng ──
  test("register email đã tồn tại → 400", async () => {
    const { status } = await request(`${AUTH}/register`, {
      method: "POST",
      body: JSON.stringify({
        email: testEmail,
        name: "Duplicate",
        password: "citest123",
      }),
    });
    assert.equal(status, 400);
  });

  // ── 1c. Login với user vừa tạo ──
  test("login với user vừa tạo → accessToken + refreshToken cookie", async () => {
    const { status, body, setCookie } = await request(`${AUTH}/login`, {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: "citest123" }),
    });

    assert.equal(status, 200, `Login thất bại: ${JSON.stringify(body)}`);
    assert.ok(body.accessToken, "thiếu accessToken");
    assert.equal(typeof body.accessToken, "string");
    assert.ok(setCookie.includes("refreshToken"), "thiếu refreshToken cookie");

    accessToken   = body.accessToken;
    refreshCookie = setCookie;
  });

  // ── 1d. Dùng accessToken để gọi authenticated API qua gateway ──
  test("dùng accessToken gọi GET /api/products qua gateway → 200", async () => {
    const { status } = await request(`${GATEWAY}/api/products`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(status, 200, "Authenticated request thất bại");
  });

  // ── 1e. Refresh token rotation ──
  test("POST /refresh với cookie → trả về accessToken mới + refreshToken mới", async () => {
    const rawToken = extractRefreshToken(refreshCookie);
    assert.ok(rawToken, "Không extract được refreshToken từ cookie");

    const { status, body, setCookie } = await request(`${AUTH}/refresh`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${rawToken}` },
    });

    assert.equal(status, 200, `Refresh thất bại: ${JSON.stringify(body)}`);
    assert.ok(body.accessToken, "thiếu accessToken mới");

    // Token mới phải khác token cũ
    assert.notEqual(body.accessToken, accessToken, "accessToken phải được rotate");

    const newCookie = setCookie;
    const newRawToken = extractRefreshToken(newCookie);
    assert.ok(newRawToken, "thiếu refreshToken mới trong cookie");
    assert.notEqual(newRawToken, rawToken, "refreshToken phải được rotate");

    // ── Token cũ phải bị revoke ──
    const { status: reuseStatus } = await request(`${AUTH}/refresh`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${rawToken}` },
    });
    assert.equal(reuseStatus, 403, "Token cũ sau rotation phải bị revoke (403)");

    // Update để dùng ở bước logout
    accessToken   = body.accessToken;
    refreshCookie = newCookie;
  });

  // ── 1f. Logout ──
  test("POST /logout → 200, sau đó refreshToken không còn dùng được", async () => {
    const rawToken = extractRefreshToken(refreshCookie);

    const { status, body } = await request(`${AUTH}/logout`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${rawToken}` },
    });

    assert.equal(status, 200);
    assert.ok(body.message, "thiếu message sau logout");

    // Thử refresh sau logout → phải fail
    const { status: afterLogout } = await request(`${AUTH}/refresh`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${rawToken}` },
    });
    assert.equal(afterLogout, 403, "refresh sau logout phải trả 403");
  });
});

// ─── 2. PRODUCT CRUD QUA GATEWAY ────────────────────────────────────────────
describe("Integration: Product CRUD qua Gateway", () => {
  let token = null;
  let pid   = null;

  before(async () => {
    const { body, setCookie } = await request(`${AUTH}/login`, {
      method: "POST",
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    token = body.accessToken;
    assert.ok(token, "Không lấy được token để chạy product tests");
  });

  test("GET /api/products → 200 (không có token sẽ fail → token phải hợp lệ)", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.products));
  });

  test("GET /api/products?page=1&limit=3 → trả về tối đa 3 item", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products?page=1&limit=3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(body.products.length <= 3);
  });

  test("POST /api/products → tạo product mới → 201", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: "Integration Test Product",
        price: 150000,
        stock: 100,
        category: ["integration-test"],
        image: "https://example.com/img.jpg",
      }),
    });
    assert.equal(status, 201, `Tạo product thất bại: ${JSON.stringify(body)}`);
    assert.ok(body._id, "thiếu _id trong response");
    pid = body._id;
  });

  test("GET /api/products/:id → lấy product vừa tạo", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products/${pid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.equal(body._id, pid);
    assert.equal(body.name, "Integration Test Product");
    assert.equal(body.price, 150000);
    assert.equal(body.stock, 100);
    assert.ok("description" in body, "thiếu field description");
  });

  test("PATCH /api/products/:id → cập nhật price", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products/${pid}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ price: 200000, name: "Integration Test Product Updated" }),
    });
    assert.equal(status, 200);
    assert.equal(body.price, 200000);
    assert.equal(body.name, "Integration Test Product Updated");
  });

  test("GET /api/products/:id sau PATCH → phản ánh dữ liệu mới (cache invalidated)", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products/${pid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.equal(body.price, 200000, "Cache không được invalidate sau update");
  });

  test("DELETE /api/products/:id → xóa thành công → 200", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products/${pid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(body.message);
  });

  test("GET /api/products/:id sau xóa → 404", async () => {
    const { status } = await request(`${GATEWAY}/api/products/${pid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 404, "Product sau xóa vẫn còn truy cập được");
  });
});

// ─── 3. ORDER FLOW + STOCK RESERVATION ─────────────────────────────────────
describe("Integration: Order flow + stock reservation", () => {
  let token       = null;
  let userId      = null;
  let productId   = null;
  let orderId     = null;
  const STOCK     = 10;
  const ORDER_QTY = 3;

  before(async () => {
    // Login để lấy token và userId
    const { body } = await request(`${AUTH}/login`, {
      method: "POST",
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    token = body.accessToken;
    assert.ok(token, "Không lấy được token");

    // Decode JWT để lấy userId (JWT là base64, không cần verify ở đây)
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    userId = payload.userId || payload.id || payload._id;
    assert.ok(userId, "Không lấy được userId từ JWT");

    // Tạo product test với stock cố định
    const { body: p } = await request(`${PRODUCT}/`, {
      method: "POST",
      body: JSON.stringify({
        name: "Order Flow Test Product",
        price: 50000,
        stock: STOCK,
        category: ["order-test"],
      }),
    });
    productId = p._id;
    assert.ok(productId, "Không tạo được product để test order");
  });

  after(async () => {
    // Cleanup: xóa product nếu còn
    if (productId) {
      await request(`${PRODUCT}/${productId}`, { method: "DELETE" }).catch(() => {});
    }
  });

  test("POST /api/orders → tạo đơn hàng thành công, stock bị trừ", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userID: userId,
        address: "123 Integration Test Street",
        products: [{ productID: productId, num: ORDER_QTY }],
      }),
    });

    assert.equal(status, 201, `Tạo order thất bại: ${JSON.stringify(body)}`);
    assert.ok(body._id, "thiếu _id trong order response");
    assert.equal(body.userID, userId, "userID không khớp");
    assert.ok(typeof body.total === "number" && body.total > 0, "total phải > 0");
    assert.ok(Array.isArray(body.products) && body.products.length > 0);
    assert.equal(body.address, "123 Integration Test Street");
    orderId = body._id;

    // Verify stock đã bị trừ
    const { body: updatedProduct } = await request(`${PRODUCT}/${productId}`);
    assert.equal(
      updatedProduct.stock,
      STOCK - ORDER_QTY,
      `Stock phải là ${STOCK - ORDER_QTY} sau khi reserve ${ORDER_QTY} items`
    );
  });

  test("GET /api/orders/:id → lấy order vừa tạo", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.equal(body._id, orderId);
    assert.equal(body.userID, userId);
    assert.ok(Array.isArray(body.products));
  });

  test("GET /api/orders?userID=xxx → filter theo userID", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders?userID=${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    const found = body.find((o) => o._id === orderId);
    assert.ok(found, "Không tìm thấy order trong kết quả filter theo userID");
  });

  test("DELETE /api/orders/:id → xóa đơn, stock được hoàn trả", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders/${orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(status, 200, `Xóa order thất bại: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);

    // Verify stock được hoàn trả về ban đầu
    const { body: restoredProduct } = await request(`${PRODUCT}/${productId}`);
    assert.equal(
      restoredProduct.stock,
      STOCK,
      `Stock phải được hoàn trả về ${STOCK} sau khi hủy đơn`
    );

    orderId = null; // đã xóa, không cần cleanup
  });
});

// ─── 4. STOCK ROLLBACK KHI ĐẶT HÀNG THẤT BẠI ──────────────────────────────
describe("Integration: Stock rollback khi order thất bại", () => {
  let token      = null;
  let userId     = null;
  let productAId = null;
  const STOCK_A  = 5;

  before(async () => {
    const { body } = await request(`${AUTH}/login`, {
      method: "POST",
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    token = body.accessToken;
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    userId = payload.userId || payload.id || payload._id;

    // Tạo product A (đủ hàng)
    const { body: pA } = await request(`${PRODUCT}/`, {
      method: "POST",
      body: JSON.stringify({ name: "Rollback Product A", price: 10000, stock: STOCK_A, category: [] }),
    });
    productAId = pA._id;
  });

  after(async () => {
    if (productAId) {
      await request(`${PRODUCT}/${productAId}`, { method: "DELETE" }).catch(() => {});
    }
  });

  test("đặt hàng với 1 product hợp lệ + 1 product không tồn tại → 400, stock A không bị thay đổi", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userID: userId,
        address: "Rollback Test Street",
        products: [
          { productID: productAId, num: 2 },         // hợp lệ
          { productID: "nonexistent-product", num: 1 }, // không tồn tại → gây rollback
        ],
      }),
    });

    assert.equal(status, 400, `Expected 400 nhưng nhận ${status}: ${JSON.stringify(body)}`);

    // Stock A phải được rollback về ban đầu
    const { body: checkA } = await request(`${PRODUCT}/${productAId}`);
    assert.equal(
      checkA.stock,
      STOCK_A,
      `Stock A phải được rollback về ${STOCK_A} nhưng nhận ${checkA.stock}`
    );
  });

  test("đặt hàng vượt stock → 400, stock không bị trừ", async () => {
    const { status } = await request(`${GATEWAY}/api/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userID: userId,
        address: "Over Stock Street",
        products: [{ productID: productAId, num: STOCK_A + 100 }],
      }),
    });
    assert.equal(status, 400);

    const { body: checkA } = await request(`${PRODUCT}/${productAId}`);
    assert.equal(checkA.stock, STOCK_A, "Stock phải không đổi khi order thất bại");
  });
});

// ─── 5. GATEWAY AUTH GUARD ─────────────────────────────────────────────────
describe("Integration: Gateway auth guard", () => {
  const protectedRoutes = [
    { method: "GET",    path: "/api/products" },
    { method: "GET",    path: "/api/orders" },
    { method: "POST",   path: "/api/products" },
    { method: "POST",   path: "/api/orders" },
  ];

  for (const route of protectedRoutes) {
    test(`${route.method} ${route.path} không có token → 401`, async () => {
      const { status } = await request(`${GATEWAY}${route.path}`, {
        method: route.method,
        body: route.method !== "GET" ? JSON.stringify({}) : undefined,
      });
      assert.equal(status, 401, `${route.method} ${route.path} phải trả 401 khi không có token`);
    });
  }

  test("Auth routes /api/auth/login và /api/auth/register KHÔNG bị chặn bởi JWT", async () => {
    // Những route này phải bypass JWT guard (theo code gateway)
    const { status: loginStatus } = await request(`${GATEWAY}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: "test@test.com", password: "wrong" }),
    });
    // 401 từ auth service (sai mật khẩu) — KHÔNG phải 403 từ gateway JWT
    assert.equal(loginStatus, 401, "Login route phải bypass JWT guard, nhận error từ auth service");
  });
});