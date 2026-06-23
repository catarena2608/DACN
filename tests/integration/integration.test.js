const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const GATEWAY = process.env.GATEWAY_URL  || "http://localhost:3000";
const AUTH    = process.env.AUTH_URL     || "http://localhost:3001";
const PRODUCT = process.env.PRODUCT_URL  || "http://localhost:3002";

const SEED_EMAIL    = process.env.SEED_EMAIL    || "nguyenhoa01@gmail.com";
const SEED_PASSWORD = process.env.SEED_PASSWORD || "hoa123456";

const TEST_PASSWORD = process.env.TEST_PASSWORD || "ci-test-pass-integration";
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

function extractRefreshToken(setCookie) {
  const match = setCookie.match(/refreshToken=([^;]+)/);
  return match ? match[1] : null;
}

describe("Integration: Auth flow", () => {
  let accessToken    = null;
  let refreshCookie  = null;
  let testEmail      = null;

  test("register new user successfully -> 201", async () => {
    testEmail = `ci_test_${Date.now()}@test.com`;
    const { status, body } = await request(`${AUTH}/register`, {
      method: "POST",
      body: JSON.stringify({
        email: testEmail,
        name: "CI Test User",
        password: TEST_PASSWORD,
      }),
    });
    assert.equal(status, 201, `Register failed: ${JSON.stringify(body)}`);
  });

  test("register existing email -> 400", async () => {
    const { status } = await request(`${AUTH}/register`, {
      method: "POST",
      body: JSON.stringify({
        email: testEmail,
        name: "Duplicate",
        password: TEST_PASSWORD,
      }),
    });
    assert.equal(status, 400);
  });

  test("login with newly created user -> accessToken + refreshToken cookie", async () => {
    const { status, body, setCookie } = await request(`${AUTH}/login`, {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: TEST_PASSWORD }),
    });

    assert.equal(status, 200, `Login failed: ${JSON.stringify(body)}`);
    assert.ok(body.accessToken, "missing accessToken");
    assert.equal(typeof body.accessToken, "string");
    assert.ok(setCookie.includes("refreshToken"), "missing refreshToken cookie");

    accessToken   = body.accessToken;
    refreshCookie = setCookie;
  });

  test("use accessToken to call GET /api/products through gateway -> 200", async () => {
    const { status } = await request(`${GATEWAY}/api/products`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(status, 200, "Authenticated request failed");
  });

  test("POST /refresh with cookie -> returns new accessToken + new refreshToken", async () => {
    const rawToken = extractRefreshToken(refreshCookie);
    assert.ok(rawToken, "Could not extract refreshToken from cookie");

    const { status, body, setCookie } = await request(`${AUTH}/refresh`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${rawToken}` },
    });

    assert.equal(status, 200, `Refresh failed: ${JSON.stringify(body)}`);
    assert.ok(body.accessToken, "missing new accessToken");

    assert.notEqual(body.accessToken, accessToken, "accessToken must be rotated");

    const newCookie = setCookie;
    const newRawToken = extractRefreshToken(newCookie);
    assert.ok(newRawToken, "missing new refreshToken in cookie");
    assert.notEqual(newRawToken, rawToken, "refreshToken must be rotated");

    const { status: reuseStatus } = await request(`${AUTH}/refresh`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${rawToken}` },
    });
    assert.equal(reuseStatus, 403, "Old token after rotation must be revoked (403)");

    accessToken   = body.accessToken;
    refreshCookie = newCookie;
  });

  test("POST /logout -> 200, then refreshToken is no longer usable", async () => {
    const rawToken = extractRefreshToken(refreshCookie);

    const { status, body } = await request(`${AUTH}/logout`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${rawToken}` },
    });

    assert.equal(status, 200);
    assert.ok(body.message, "missing message after logout");

    const { status: afterLogout } = await request(`${AUTH}/refresh`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${rawToken}` },
    });
    assert.equal(afterLogout, 403, "refresh after logout must return 403");
  });
});

describe("Integration: Product CRUD through Gateway", () => {
  let token = null;
  let pid   = null;

  before(async () => {
    const { body, setCookie } = await request(`${AUTH}/login`, {
      method: "POST",
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    token = body.accessToken;
    assert.ok(token, "Could not get token to run product tests");
  });

  test("GET /api/products -> 200 (without token it fails, so token must be valid)", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.products));
  });

  test("GET /api/products?page=1&limit=3 -> returns at most 3 items", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products?page=1&limit=3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(body.products.length <= 3);
  });

  test("POST /api/products -> creates new product -> 201", async () => {
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
    assert.equal(status, 201, `Create product failed: ${JSON.stringify(body)}`);
    assert.ok(body._id, "missing _id in response");
    pid = body._id;
  });

  test("GET /api/products/:id -> gets newly created product", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products/${pid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.equal(body._id, pid);
    assert.equal(body.name, "Integration Test Product");
    assert.equal(body.price, 150000);
    assert.equal(body.stock, 100);
    assert.ok("description" in body, "missing description field");
  });

  test("PATCH /api/products/:id -> updates price", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products/${pid}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ price: 200000, name: "Integration Test Product Updated" }),
    });
    assert.equal(status, 200);
    assert.equal(body.price, 200000);
    assert.equal(body.name, "Integration Test Product Updated");
  });

  test("GET /api/products/:id after PATCH -> reflects new data (cache invalidated)", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products/${pid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.equal(body.price, 200000, "Cache was not invalidated after update");
  });

  test("DELETE /api/products/:id -> deletes successfully -> 200", async () => {
    const { status, body } = await request(`${GATEWAY}/api/products/${pid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(body.message);
  });

  test("GET /api/products/:id after delete -> 404", async () => {
    const { status } = await request(`${GATEWAY}/api/products/${pid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 404, "Product remains accessible after delete");
  });
});

describe("Integration: Order flow + stock reservation", () => {
  let token       = null;
  let userId      = null;
  let productId   = null;
  let orderId     = null;
  const STOCK     = 10;
  const ORDER_QTY = 3;

  before(async () => {
    const { body } = await request(`${AUTH}/login`, {
      method: "POST",
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    token = body.accessToken;
    assert.ok(token, "Could not get token");

    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    userId = payload.userId || payload.id || payload._id;
    assert.ok(userId, "Could not get userId from JWT");

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
    assert.ok(productId, "Could not create product for order test");
  });

  after(async () => {
    if (productId) {
      await request(`${PRODUCT}/${productId}`, { method: "DELETE" }).catch(() => {});
    }
  });

  test("POST /api/orders -> creates order successfully and deducts stock", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userID: userId,
        address: "123 Integration Test Street",
        products: [{ productID: productId, num: ORDER_QTY }],
      }),
    });

    assert.equal(status, 201, `Create order failed: ${JSON.stringify(body)}`);
    assert.ok(body._id, "missing _id in order response");
    assert.equal(body.userID, userId, "userID does not match");
    assert.ok(typeof body.total === "number" && body.total > 0, "total must be > 0");
    assert.ok(Array.isArray(body.products) && body.products.length > 0);
    assert.equal(body.address, "123 Integration Test Street");
    orderId = body._id;

    const { body: updatedProduct } = await request(`${PRODUCT}/${productId}`);
    assert.equal(
      updatedProduct.stock,
      STOCK - ORDER_QTY,
      `Stock must be ${STOCK - ORDER_QTY} after reserving ${ORDER_QTY} items`
    );
  });

  test("GET /api/orders/:id -> gets newly created order", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.equal(body._id, orderId);
    assert.equal(body.userID, userId);
    assert.ok(Array.isArray(body.products));
  });

  test("GET /api/orders?userID=xxx -> filters by userID", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders?userID=${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    const found = body.find((o) => o._id === orderId);
    assert.ok(found, "Order was not found in results filtered by userID");
  });

  test("DELETE /api/orders/:id -> deletes order and restores stock", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders/${orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(status, 200, `Delete order failed: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);

    const { body: restoredProduct } = await request(`${PRODUCT}/${productId}`);
    assert.equal(
      restoredProduct.stock,
      STOCK,
      `Stock must be restored to ${STOCK} after canceling the order`
    );

    orderId = null; // deleted, no cleanup needed
  });
});

describe("Integration: Stock rollback when order fails", () => {
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

  test("order with 1 valid product + 1 nonexistent product -> 400, stock A remains unchanged", async () => {
    const { status, body } = await request(`${GATEWAY}/api/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userID: userId,
        address: "Rollback Test Street",
        products: [
          { productID: productAId, num: 2 },
          { productID: "nonexistent-product", num: 1 },
        ],
      }),
    });

    assert.equal(status, 400, `Expected 400 but received ${status}: ${JSON.stringify(body)}`);

    const { body: checkA } = await request(`${PRODUCT}/${productAId}`);
    assert.equal(
      checkA.stock,
      STOCK_A,
      `Stock A must be rolled back to ${STOCK_A}, but received ${checkA.stock}`
    );
  });

  test("order exceeding stock -> 400, stock is not deducted", async () => {
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
    assert.equal(checkA.stock, STOCK_A, "Stock must remain unchanged when order fails");
  });
});

describe("Integration: Gateway auth guard", () => {
  const protectedRoutes = [
    { method: "GET",    path: "/api/products" },
    { method: "GET",    path: "/api/orders" },
    { method: "POST",   path: "/api/products" },
    { method: "POST",   path: "/api/orders" },
  ];

  for (const route of protectedRoutes) {
    test(`${route.method} ${route.path} without token -> 401`, async () => {
      const { status } = await request(`${GATEWAY}${route.path}`, {
        method: route.method,
        body: route.method !== "GET" ? JSON.stringify({}) : undefined,
      });
      assert.equal(status, 401, `${route.method} ${route.path} must return 401 without token`);
    });
  }

  test("Auth routes /api/auth/login and /api/auth/register are NOT blocked by JWT", async () => {
    const { status: loginStatus } = await request(`${GATEWAY}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: "test@test.com", password: "wrong" }),
    });
    assert.equal(loginStatus, 401, "Login route must bypass JWT guard and receive error from auth service");
  });
});
