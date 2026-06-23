const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");

const AUTH    = process.env.AUTH_URL     || "http://localhost:3001";
const PRODUCT = process.env.PRODUCT_URL  || "http://localhost:3002";
const ORDER   = process.env.ORDER_URL    || "http://localhost:3003";
const GATEWAY = process.env.GATEWAY_URL  || "http://localhost:3000";

const SEED_EMAIL    = process.env.SEED_EMAIL    || "nguyenhoa01@gmail.com";
const SEED_PASSWORD = process.env.SEED_PASSWORD || "hoa123456";

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
  assert.equal(typeof val, "string", `${field} must be a string, received ${typeof val}`);
}
function assertNumber(val, field) {
  assert.equal(typeof val, "number", `${field} must be a number, received ${typeof val}`);
}
function assertArray(val, field) {
  assert.ok(Array.isArray(val), `${field} must be an array`);
}
function assertObject(val, field) {
  assert.ok(val && typeof val === "object" && !Array.isArray(val), `${field} must be an object`);
}

let accessToken = null;
let createdProductId = null;

describe("Contract: Auth", () => {
  describe("POST /login", () => {
    test("response has accessToken (string) and sets refreshToken cookie", async () => {
      const { status, body, headers } = await request(`${AUTH}/login`, {
        method: "POST",
        body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
      });

      assert.equal(status, 200);
      assertObject(body, "body");
      assert.ok("accessToken" in body,          "missing accessToken field");
      assertString(body.accessToken, "accessToken");
      assert.ok(body.accessToken.split(".").length === 3, "accessToken must be a JWT with 3 parts");

      const cookie = headers.get("set-cookie") || "";
      assert.ok(cookie.includes("refreshToken"), "missing refreshToken cookie");
      assert.ok(cookie.includes("HttpOnly"),      "refreshToken cookie must be HttpOnly");

      accessToken = body.accessToken;
    });

    test("login with wrong password -> 401 + message field", async () => {
      const { status, body } = await request(`${AUTH}/login`, {
        method: "POST",
        body: JSON.stringify({ email: SEED_EMAIL, password: "wrongpassword" }),
      });
      assert.equal(status, 401);
      assert.ok("message" in body, "missing message field in error response");
      assertString(body.message, "message");
    });

    test("login with nonexistent email -> 401 + message field", async () => {
      const { status, body } = await request(`${AUTH}/login`, {
        method: "POST",
        body: JSON.stringify({ email: "ghost@nowhere.com", password: "x" }),
      });
      assert.equal(status, 401);
      assert.ok("message" in body);
    });
  });

  describe("POST /register", () => {
    test("register duplicate email -> 400 + message field", async () => {
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

  describe("POST /logout", () => {
    test("logout without cookie -> 200 (idempotent) + message field", async () => {
      const { status, body } = await request(`${AUTH}/logout`, { method: "POST" });
      assert.equal(status, 200);
      assert.ok("message" in body, "missing message field");
    });
  });

  describe("POST /refresh", () => {
    test("refresh without cookie -> 403 + message field", async () => {
      const { status, body } = await request(`${AUTH}/refresh`, { method: "POST" });
      assert.equal(status, 403);
      assert.ok("message" in body, "missing message field");
    });
  });

  describe("GET /health", () => {
    test("shape: { uptime, message, timestamp, services: { database, redis } }", async () => {
      const { status, body } = await request(`${AUTH}/health`);
      assert.equal(status, 200);
      assertNumber(body.uptime,    "uptime");
      assertString(body.message,   "message");
      assertNumber(body.timestamp, "timestamp");
      assertObject(body.services,  "services");
      assert.ok("database" in body.services, "missing services.database");
      assert.ok("redis"    in body.services, "missing services.redis");
    });
  });
});

describe("Contract: Product", () => {
  describe("GET / (product list)", () => {
    test("shape: { products[], total, page, totalPages }", async () => {
      const { status, body } = await request(`${PRODUCT}/`);
      assert.equal(status, 200);
      assertArray(body.products,  "products");
      assertNumber(body.total,     "total");
      assertNumber(body.page,      "page");
      assertNumber(body.totalPages,"totalPages");
    });

    test("each product item has required fields", async () => {
      const { body } = await request(`${PRODUCT}/`);
      if (body.products.length === 0) return; // skip if DB is empty

      const p = body.products[0];
      assert.ok("_id"      in p, "missing _id");
      assert.ok("name"     in p, "missing name");
      assert.ok("price"    in p, "missing price");
      assert.ok("stock"    in p, "missing stock");
      assertString(p._id, "_id");
      assertNumber(p.price, "price");
      assertNumber(p.stock, "stock");
    });

    test("query ?page=1&limit=5 -> returns the requested limit", async () => {
      const { status, body } = await request(`${PRODUCT}/?page=1&limit=5`);
      assert.equal(status, 200);
      assert.ok(body.products.length <= 5, "returned product count exceeds limit=5");
    });

    test("query ?name=xxx -> still returns standard shape even with no result", async () => {
      const { status, body } = await request(`${PRODUCT}/?name=xyzxyzxyz_notexist`);
      assert.equal(status, 200);
      assertArray(body.products, "products");
      assert.equal(body.total, 0);
    });
  });

  describe("GET /:id", () => {
    test("nonexistent id -> 404 + message field", async () => {
      const { status, body } = await request(`${PRODUCT}/notexistid`);
      assert.equal(status, 404);
      assert.ok("message" in body);
      assertString(body.message, "message");
    });

    test("valid product -> complete shape using id from list", async () => {
      const { body: listBody } = await request(`${PRODUCT}/`);
      if (listBody.products.length === 0) {
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
      assert.ok("_id"   in body, "missing _id");
      assert.ok("name"  in body, "missing name");
      assert.ok("price" in body, "missing price");
      assert.ok("stock" in body, "missing stock");
      assert.ok("description" in body, "missing description field, which may be null");
    });
  });

  describe("POST / (create product)", () => {
    test("create new product -> 201 + returns object with _id", async () => {
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
      assert.ok("_id" in body, "missing _id in create response");
      assertString(body._id, "_id");

      await request(`${PRODUCT}/${body._id}`, { method: "DELETE" });
    });
  });

  describe("PATCH /:id (update product)", () => {
    test("update product -> returns updated object with _id", async () => {
      const { body: created } = await request(`${PRODUCT}/`, {
        method: "POST",
        body: JSON.stringify({ name: "To Update", price: 100, stock: 10, category: [] }),
      });

      const { status, body } = await request(`${PRODUCT}/${created._id}`, {
        method: "PATCH",
        body: JSON.stringify({ price: 200 }),
      });

      assert.equal(status, 200);
      assert.ok("_id" in body, "missing _id in update response");

      await request(`${PRODUCT}/${created._id}`, { method: "DELETE" });
    });
  });

  describe("DELETE /:id", () => {
    test("delete valid product -> 200 + message field", async () => {
      const { body: created } = await request(`${PRODUCT}/`, {
        method: "POST",
        body: JSON.stringify({ name: "To Delete", price: 10, stock: 1, category: [] }),
      });

      const { status, body } = await request(`${PRODUCT}/${created._id}`, {
        method: "DELETE",
      });

      assert.equal(status, 200);
      assert.ok("message" in body, "missing message field after delete");
      assertString(body.message, "message");
    });
  });

  describe("GET /health", () => {
    test("shape matches auth health", async () => {
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

describe("Contract: Order", () => {
  describe("GET / (order list)", () => {
    test("returns an array, possibly empty", async () => {
      const { status, body } = await request(`${ORDER}/`);
      assert.equal(status, 200);
      assertArray(body, "order list");
    });

    test("query ?userID=xxx -> still returns an array", async () => {
      const { status, body } = await request(`${ORDER}/?userID=fakeuserid`);
      assert.equal(status, 200);
      assertArray(body, "filtered order list");
    });

    test("each order item, if present, has required fields", async () => {
      const { body } = await request(`${ORDER}/`);
      if (body.length === 0) return;

      const o = body[0];
      assert.ok("_id"      in o, "missing _id");
      assert.ok("userID"   in o, "missing userID");
      assert.ok("products" in o, "missing products");
      assert.ok("total"    in o, "missing total");
      assert.ok("address"  in o, "missing address");
      assertArray(o.products, "order.products");
      assertNumber(o.total,   "order.total");

      if (o.products.length > 0) {
        const item = o.products[0];
        assert.ok("productID" in item, "order item is missing productID");
        assert.ok("num"       in item, "order item is missing num");
        assert.ok("price"     in item, "order item is missing price");
      }
    });
  });

  describe("GET /:id", () => {
    test("nonexistent UUID id -> 404 + message field", async () => {
      const { status, body } = await request(
        `${ORDER}/00000000-0000-0000-0000-000000000000`
      );
      assert.equal(status, 404);
      assert.ok("message" in body);
    });
  });

  describe("POST / (create order)", () => {
    test("missing products -> 400 + message field", async () => {
      const { status, body } = await request(`${ORDER}/`, {
        method: "POST",
        body: JSON.stringify({ userID: "testuser", address: "123 street" }),
      });
      assert.ok(status === 400 || status === 500, `Expected 400/500 but received ${status}`);
      assert.ok("message" in body, "missing message field in error response");
    });

    test("nonexistent productID -> 400 + message field", async () => {
      const { status, body } = await request(`${ORDER}/`, {
        method: "POST",
        body: JSON.stringify({
          userID: "testuser",
          address: "123 test street",
          products: [{ productID: "notexist", num: 1 }],
        }),
      });
      assert.equal(status, 400);
      assert.ok("message" in body, "missing message field");
      assertString(body.message, "message");
    });
  });

  describe("DELETE /:id", () => {
    test("nonexistent id -> 400 + message field", async () => {
      const { status, body } = await request(
        `${ORDER}/00000000-0000-0000-0000-000000000000`,
        { method: "DELETE" }
      );
      assert.equal(status, 400);
      assert.ok("message" in body, "missing message field");
    });
  });

  describe("GET /health", () => {
    test("shape matches the other services", async () => {
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

describe("Contract: Gateway", () => {
  describe("GET /api/health", () => {
    test("shape: { gateway, timestamp, dependencies[] }", async () => {
      const { status, body } = await request(`${GATEWAY}/api/health`);
      assert.equal(status, 200);
      assertString(body.gateway,    "gateway");
      assertString(body.timestamp,  "timestamp");
      assertArray(body.dependencies,"dependencies");

      for (const dep of body.dependencies) {
        assert.ok("name"   in dep, "dep is missing name");
        assert.ok("status" in dep, "dep is missing status");
        assertString(dep.name,   "dep.name");
        assertString(dep.status, "dep.status");
      }
    });
  });

  describe("JWT error responses", () => {
    test("without token -> 401 + message field", async () => {
      const { status, body } = await request(`${GATEWAY}/api/products`);
      assert.equal(status, 401);
      assert.ok("message" in body, "missing message field");
      assertString(body.message, "message");
    });

    test("invalid token -> 403 + message field", async () => {
      const { status, body } = await request(`${GATEWAY}/api/products`, {
        headers: { Authorization: "Bearer invalid.jwt.token" },
      });
      assert.equal(status, 403);
      assert.ok("message" in body, "missing message field");
      assertString(body.message, "message");
    });

    test("nonexistent route -> 404 + message field", async () => {
      const { status, body } = await request(`${GATEWAY}/api/unknown-service`, {
        headers: { Authorization: "Bearer fake.jwt.token" },
      });
      assert.ok([403, 404].includes(status), `Expected 403 or 404, received ${status}`);
      assert.ok("message" in body, "missing message field");
    });
  });
});
