/**
 * Contract Tests
 *
 * Mục tiêu: xác nhận response shape (field name, type) của từng API
 * khớp với những gì frontend và các service khác mong đợi.
 * Không test logic nghiệp vụ — chỉ test "hình dạng" của JSON.
 *
 * Biến môi trường:
 *   AUTH_URL      default http://localhost:3001
 *   PRODUCT_URL   default http://localhost:3002
 *   ORDER_URL     default http://localhost:3003
 *   GATEWAY_URL   default http://localhost:3000
 *
 * Seed user (từ auth.json):
 *   email: nguyenhoa01@gmail.com / password: hoa123456
 */

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");

const AUTH    = process.env.AUTH_URL     || "http://localhost:3001";
const PRODUCT = process.env.PRODUCT_URL  || "http://localhost:3002";
const ORDER   = process.env.ORDER_URL    || "http://localhost:3003";
const GATEWAY = process.env.GATEWAY_URL  || "http://localhost:3000";

const SEED_EMAIL    = "nguyenhoa01@gmail.com";
const SEED_PASSWORD = "hoa123456";

// ─── helpers ───────────────────────────────────────────────────────────────
async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let body = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await res.json();
  }
  return { status: res.status, body, headers: res.headers };
}

function assertString(val, field) {
  assert.equal(typeof val, "string", `${field} phải là string, nhận ${typeof val}`);
}
function assertNumber(val, field) {
  assert.equal(typeof val, "number", `${field} phải là number, nhận ${typeof val}`);
}
function assertArray(val, field) {
  assert.ok(Array.isArray(val), `${field} phải là array`);
}
function assertObject(val, field) {
  assert.ok(val && typeof val === "object" && !Array.isArray(val), `${field} phải là object`);
}

// ─── State dùng chung giữa các test ────────────────────────────────────────
let accessToken = null;
let createdProductId = null;

// ─── AUTH CONTRACT ──────────────────────────────────────────────────────────
describe("Contract: Auth", () => {
  // ── POST /login ──
  describe("POST /login", () => {
    test("response có accessToken (string) và set cookie refreshToken", async () => {
      const { status, body, headers } = await request(`${AUTH}/login`, {
        method: "POST",
        body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
      });

      assert.equal(status, 200);
      assertObject(body, "body");
      assert.ok("accessToken" in body,          "thiếu field accessToken");
      assertString(body.accessToken, "accessToken");
      assert.ok(body.accessToken.split(".").length === 3, "accessToken phải là JWT (3 phần)");

      const cookie = headers.get("set-cookie") || "";
      assert.ok(cookie.includes("refreshToken"), "thiếu cookie refreshToken");
      assert.ok(cookie.includes("HttpOnly"),      "refreshToken cookie phải HttpOnly");

      accessToken = body.accessToken;
    });

    test("login sai password → 401 + có field message", async () => {
      const { status, body } = await request(`${AUTH}/login`, {
        method: "POST",
        body: JSON.stringify({ email: SEED_EMAIL, password: "wrongpassword" }),
      });
      assert.equal(status, 401);
      assert.ok("message" in body, "thiếu field message trong error response");
      assertString(body.message, "message");
    });

    test("login email không tồn tại → 401 + có field message", async () => {
      const { status, body } = await request(`${AUTH}/login`, {
        method: "POST",
        body: JSON.stringify({ email: "ghost@nowhere.com", password: "x" }),
      });
      assert.equal(status, 401);
      assert.ok("message" in body);
    });
  });

  // ── POST /register ──
  describe("POST /register", () => {
    test("register email trùng → 400 + có field message", async () => {
      const { status, body } = await request(`${AUTH}/register`, {
        method: "POST",
        body: JSON.stringify({
          email: SEED_EMAIL,
          name: "Duplicate",
          password: "somepass",
        }),
      });
      assert.equal(status, 400);
      assert.ok("message" in body);
      assertString(body.message, "message");
    });
  });

  // ── POST /logout ──
  describe("POST /logout", () => {
    test("logout không có cookie → 200 (idempotent) + có field message", async () => {
      const { status, body } = await request(`${AUTH}/logout`, { method: "POST" });
      assert.equal(status, 200);
      assert.ok("message" in body, "thiếu field message");
    });
  });

  // ── POST /refresh ──
  describe("POST /refresh", () => {
    test("refresh không có cookie → 403 + có field message", async () => {
      const { status, body } = await request(`${AUTH}/refresh`, { method: "POST" });
      assert.equal(status, 403);
      assert.ok("message" in body, "thiếu field message");
    });
  });

  // ── GET /health ──
  describe("GET /health", () => {
    test("shape: { uptime, message, timestamp, services: { database, redis } }", async () => {
      const { status, body } = await request(`${AUTH}/health`);
      assert.equal(status, 200);
      assertNumber(body.uptime,    "uptime");
      assertString(body.message,   "message");
      assertNumber(body.timestamp, "timestamp");
      assertObject(body.services,  "services");
      assert.ok("database" in body.services, "thiếu services.database");
      assert.ok("redis"    in body.services, "thiếu services.redis");
    });
  });
});

// ─── PRODUCT CONTRACT ───────────────────────────────────────────────────────
describe("Contract: Product", () => {
  // ── GET / (list) ──
  describe("GET / (product list)", () => {
    test("shape: { products[], total, page, totalPages }", async () => {
      const { status, body } = await request(`${PRODUCT}/`);
      assert.equal(status, 200);
      assertArray(body.products,  "products");
      assertNumber(body.total,     "total");
      assertNumber(body.page,      "page");
      assertNumber(body.totalPages,"totalPages");
    });

    test("mỗi product item có các field bắt buộc", async () => {
      const { body } = await request(`${PRODUCT}/`);
      if (body.products.length === 0) return; // skip nếu DB rỗng

      const p = body.products[0];
      assert.ok("_id"      in p, "thiếu _id");
      assert.ok("name"     in p, "thiếu name");
      assert.ok("price"    in p, "thiếu price");
      assert.ok("stock"    in p, "thiếu stock");
      assertString(p._id, "_id");
      assertNumber(p.price, "price");
      assertNumber(p.stock, "stock");
    });

    test("query ?page=1&limit=5 → trả về đúng limit", async () => {
      const { status, body } = await request(`${PRODUCT}/?page=1&limit=5`);
      assert.equal(status, 200);
      assert.ok(body.products.length <= 5, "số sản phẩm trả về vượt quá limit=5");
    });

    test("query ?name=xxx → vẫn trả về shape chuẩn (dù không có kết quả)", async () => {
      const { status, body } = await request(`${PRODUCT}/?name=xyzxyzxyz_notexist`);
      assert.equal(status, 200);
      assertArray(body.products, "products");
      assert.equal(body.total, 0);
    });
  });

  // ── GET /:id ──
  describe("GET /:id", () => {
    test("id không tồn tại → 404 + có field message", async () => {
      const { status, body } = await request(`${PRODUCT}/notexistid`);
      assert.equal(status, 404);
      assert.ok("message" in body);
      assertString(body.message, "message");
    });

    test("product hợp lệ → shape đầy đủ (thử với id từ list)", async () => {
      const { body: listBody } = await request(`${PRODUCT}/`);
      if (listBody.products.length === 0) {
        // Tạo một product để test
        const { body: created } = await request(`${PRODUCT}/`, {
          method: "POST",
          body: JSON.stringify({ name: "Test Product", price: 100, stock: 10, category: ["test"] }),
        });
        createdProductId = created._id;
      } else {
        createdProductId = listBody.products[0]._id;
      }

      const { status, body } = await request(`${PRODUCT}/${createdProductId}`);
      assert.equal(status, 200);
      assert.ok("_id"   in body, "thiếu _id");
      assert.ok("name"  in body, "thiếu name");
      assert.ok("price" in body, "thiếu price");
      assert.ok("stock" in body, "thiếu stock");
      // description có thể null (từ detail model)
      assert.ok("description" in body, "thiếu field description (có thể null)");
    });
  });

  // ── POST / ──
  describe("POST / (create product)", () => {
    test("tạo product mới → 201 + trả về object với _id", async () => {
      const { status, body } = await request(`${PRODUCT}/`, {
        method: "POST",
        body: JSON.stringify({
          name: "Contract Test Product",
          price: 99000,
          stock: 50,
          category: ["contract-test"],
          image: "https://example.com/img.jpg",
        }),
      });
      assert.equal(status, 201);
      assertObject(body, "body");
      assert.ok("_id" in body, "thiếu _id trong response tạo mới");
      assertString(body._id, "_id");

      // cleanup
      await request(`${PRODUCT}/${body._id}`, { method: "DELETE" });
    });
  });

  // ── PATCH /:id ──
  describe("PATCH /:id (update product)", () => {
    test("update product → trả về object đã cập nhật (có _id)", async () => {
      // Tạo product để update
      const { body: created } = await request(`${PRODUCT}/`, {
        method: "POST",
        body: JSON.stringify({ name: "To Update", price: 100, stock: 10, category: [] }),
      });

      const { status, body } = await request(`${PRODUCT}/${created._id}`, {
        method: "PATCH",
        body: JSON.stringify({ price: 200 }),
      });

      assert.equal(status, 200);
      assert.ok("_id" in body, "thiếu _id trong update response");

      // cleanup
      await request(`${PRODUCT}/${created._id}`, { method: "DELETE" });
    });
  });

  // ── DELETE /:id ──
  describe("DELETE /:id", () => {
    test("xóa product hợp lệ → 200 + có field message", async () => {
      const { body: created } = await request(`${PRODUCT}/`, {
        method: "POST",
        body: JSON.stringify({ name: "To Delete", price: 10, stock: 1, category: [] }),
      });

      const { status, body } = await request(`${PRODUCT}/${created._id}`, {
        method: "DELETE",
      });

      assert.equal(status, 200);
      assert.ok("message" in body, "thiếu field message sau khi xóa");
      assertString(body.message, "message");
    });
  });

  // ── GET /health ──
  describe("GET /health", () => {
    test("shape giống auth health", async () => {
      const { status, body } = await request(`${PRODUCT}/health`);
      assert.equal(status, 200);
      assertNumber(body.uptime,    "uptime");
      assertString(body.message,   "message");
      assertObject(body.services,  "services");
      assert.ok("database" in body.services);
      assert.ok("redis"    in body.services);
    });
  });
});

// ─── ORDER CONTRACT ─────────────────────────────────────────────────────────
describe("Contract: Order", () => {
  // ── GET / ──
  describe("GET / (order list)", () => {
    test("trả về array (có thể rỗng)", async () => {
      const { status, body } = await request(`${ORDER}/`);
      assert.equal(status, 200);
      assertArray(body, "order list");
    });

    test("query ?userID=xxx → vẫn trả về array", async () => {
      const { status, body } = await request(`${ORDER}/?userID=fakeuserid`);
      assert.equal(status, 200);
      assertArray(body, "filtered order list");
    });

    test("mỗi order item (nếu có) có các field bắt buộc", async () => {
      const { body } = await request(`${ORDER}/`);
      if (body.length === 0) return;

      const o = body[0];
      assert.ok("_id"      in o, "thiếu _id");
      assert.ok("userID"   in o, "thiếu userID");
      assert.ok("products" in o, "thiếu products");
      assert.ok("total"    in o, "thiếu total");
      assert.ok("address"  in o, "thiếu address");
      assertArray(o.products, "order.products");
      assertNumber(o.total,   "order.total");

      // orderItem shape
      if (o.products.length > 0) {
        const item = o.products[0];
        assert.ok("productID" in item, "order item thiếu productID");
        assert.ok("num"       in item, "order item thiếu num");
        assert.ok("price"     in item, "order item thiếu price");
      }
    });
  });

  // ── GET /:id ──
  describe("GET /:id", () => {
    test("id uuid không tồn tại → 404 + có field message", async () => {
      const { status, body } = await request(
        `${ORDER}/00000000-0000-0000-0000-000000000000`
      );
      assert.equal(status, 404);
      assert.ok("message" in body);
    });
  });

  // ── POST / ──
  describe("POST / (create order)", () => {
    test("thiếu products → 400 + có field message", async () => {
      const { status, body } = await request(`${ORDER}/`, {
        method: "POST",
        body: JSON.stringify({ userID: "testuser", address: "123 street" }),
      });
      // service sẽ throw lỗi vì products rỗng hoặc thiếu
      assert.ok(status === 400 || status === 500, `Expected 400/500 nhưng nhận ${status}`);
      assert.ok("message" in body, "thiếu field message trong error response");
    });

    test("productID không tồn tại → 400 + có field message", async () => {
      const { status, body } = await request(`${ORDER}/`, {
        method: "POST",
        body: JSON.stringify({
          userID: "testuser",
          address: "123 test street",
          products: [{ productID: "notexist", num: 1 }],
        }),
      });
      assert.equal(status, 400);
      assert.ok("message" in body, "thiếu field message");
      assertString(body.message, "message");
    });
  });

  // ── DELETE /:id ──
  describe("DELETE /:id", () => {
    test("id không tồn tại → 400 + có field message", async () => {
      const { status, body } = await request(
        `${ORDER}/00000000-0000-0000-0000-000000000000`,
        { method: "DELETE" }
      );
      assert.equal(status, 400);
      assert.ok("message" in body, "thiếu field message");
    });
  });

  // ── GET /health ──
  describe("GET /health", () => {
    test("shape giống các service khác", async () => {
      const { status, body } = await request(`${ORDER}/health`);
      assert.equal(status, 200);
      assertNumber(body.uptime,   "uptime");
      assertString(body.message,  "message");
      assertObject(body.services, "services");
      assert.ok("database" in body.services);
      assert.ok("redis"    in body.services);
    });
  });
});

// ─── GATEWAY CONTRACT ───────────────────────────────────────────────────────
describe("Contract: Gateway", () => {
  describe("GET /api/health", () => {
    test("shape: { gateway, timestamp, dependencies[] }", async () => {
      const { status, body } = await request(`${GATEWAY}/api/health`);
      assert.equal(status, 200);
      assertString(body.gateway,    "gateway");
      assertString(body.timestamp,  "timestamp");
      assertArray(body.dependencies,"dependencies");

      for (const dep of body.dependencies) {
        assert.ok("name"   in dep, "dep thiếu name");
        assert.ok("status" in dep, "dep thiếu status");
        assertString(dep.name,   "dep.name");
        assertString(dep.status, "dep.status");
      }
    });
  });

  describe("JWT error responses", () => {
    test("không có token → 401 + field message", async () => {
      const { status, body } = await request(`${GATEWAY}/api/products`);
      assert.equal(status, 401);
      assert.ok("message" in body, "thiếu field message");
      assertString(body.message, "message");
    });

    test("token sai → 403 + field message", async () => {
      const { status, body } = await request(`${GATEWAY}/api/products`, {
        headers: { Authorization: "Bearer invalid.jwt.token" },
      });
      assert.equal(status, 403);
      assert.ok("message" in body, "thiếu field message");
      assertString(body.message, "message");
    });

    test("route không tồn tại → 404 + field message", async () => {
      const { status, body } = await request(`${GATEWAY}/api/unknown-service`, {
        headers: { Authorization: "Bearer fake.jwt.token" },
      });
      // gateway verify JWT trước → 403, hoặc sau verify → 404
      // cả hai đều chấp nhận
      assert.ok([403, 404].includes(status), `Expected 403 hoặc 404, nhận ${status}`);
      assert.ok("message" in body, "thiếu field message");
    });
  });
});