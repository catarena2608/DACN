/**
 * Smoke Tests
 *
 * Mục tiêu: xác nhận toàn bộ services đang sống và trả đúng HTTP status.
 * Chạy SAU khi docker compose up, TRƯỚC integration test.
 *
 * Biến môi trường:
 *   GATEWAY_URL   default http://localhost:3000
 *   AUTH_URL      default http://localhost:3001
 *   PRODUCT_URL   default http://localhost:3002
 *   ORDER_URL     default http://localhost:3003
 *   NGINX_URL     default http://localhost
 */

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");

const GATEWAY = process.env.GATEWAY_URL || "http://localhost:3000";
const AUTH    = process.env.AUTH_URL     || "http://localhost:3001";
const PRODUCT = process.env.PRODUCT_URL  || "http://localhost:3002";
const ORDER   = process.env.ORDER_URL    || "http://localhost:3003";
const NGINX   = process.env.NGINX_URL    || "http://localhost";

// ─── helper ────────────────────────────────────────────────────────────────
async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  let body = {};
  try { body = await res.json(); } catch (_) {}
  return { status: res.status, body };
}

// ─── Direct service health (bỏ qua gateway) ────────────────────────────────
describe("Direct service health", () => {
  test("Auth service /health → 200 + DB/Redis connected", async () => {
    const { status, body } = await get(`${AUTH}/health`);
    assert.equal(status, 200);
    assert.equal(body.message, "OK");
    assert.equal(body.services?.database, "connected");
    assert.equal(body.services?.redis,    "connected");
  });

  test("Product service /health → 200 + DB/Redis connected", async () => {
    const { status, body } = await get(`${PRODUCT}/health`);
    assert.equal(status, 200);
    assert.equal(body.message, "OK");
    assert.equal(body.services?.database, "connected");
    assert.equal(body.services?.redis,    "connected");
  });

  test("Order service /health → 200 + DB/Redis connected", async () => {
    const { status, body } = await get(`${ORDER}/health`);
    assert.equal(status, 200);
    assert.equal(body.message, "OK");
    assert.equal(body.services?.database, "connected");
    assert.equal(body.services?.redis,    "connected");
  });
});

// ─── Gateway health (tổng hợp) ─────────────────────────────────────────────
describe("Gateway health", () => {
  test("GET /api/health → 200, gateway OK, all deps UP", async () => {
    const { status, body } = await get(`${GATEWAY}/api/health`);
    assert.equal(status, 200);
    assert.equal(body.gateway, "OK");
    assert.ok(Array.isArray(body.dependencies), "dependencies phải là array");

    const names = body.dependencies.map((d) => d.name);
    assert.ok(names.includes("auth_service"),    "thiếu auth_service");
    assert.ok(names.includes("product_service"), "thiếu product_service");
    assert.ok(names.includes("order_service"),   "thiếu order_service");

    for (const dep of body.dependencies) {
      assert.equal(dep.status, "UP", `${dep.name} không phải UP: ${dep.status}`);
    }
  });

  test("GET / → 200 (gateway root)", async () => {
    const res = await fetch(`${GATEWAY}/`, { signal: AbortSignal.timeout(8000) });
    assert.equal(res.status, 200);
  });
});

// ─── Gateway JWT guard ──────────────────────────────────────────────────────
describe("Gateway JWT guard", () => {
  test("GET /api/products không có token → 401", async () => {
    const { status } = await get(`${GATEWAY}/api/products`);
    assert.equal(status, 401);
  });

  test("GET /api/orders không có token → 401", async () => {
    const { status } = await get(`${GATEWAY}/api/orders`);
    assert.equal(status, 401);
  });

  test("GET /api/products với token giả → 403", async () => {
    const res = await fetch(`${GATEWAY}/api/products`, {
      headers: { Authorization: "Bearer this.is.fake" },
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(res.status, 403);
  });
});

// ─── Auth endpoints (không qua gateway) ────────────────────────────────────
describe("Auth endpoints reachable", () => {
  test("POST /register với body thiếu → 400 (không phải 5xx)", async () => {
    const res = await fetch(`${AUTH}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    });
    // Expectation: 400 hoặc 201 — quan trọng là không phải 5xx
    assert.ok(res.status < 500, `Expected <500 nhưng nhận ${res.status}`);
  });

  test("POST /login với sai thông tin → 401", async () => {
    const res = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@test.com", password: "wrong" }),
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(res.status, 401);
  });
});

// ─── Product endpoints (không qua gateway) ─────────────────────────────────
describe("Product endpoints reachable", () => {
  test("GET / (product list) → 200, trả về shape { products, total, page }", async () => {
    const { status, body } = await get(`${PRODUCT}/`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.products), "products phải là array");
    assert.ok("total"      in body, "thiếu total");
    assert.ok("page"       in body, "thiếu page");
    assert.ok("totalPages" in body, "thiếu totalPages");
  });

  test("GET /notexistid → 404 (sản phẩm không tồn tại)", async () => {
    const { status } = await get(`${PRODUCT}/notexistid`);
    assert.equal(status, 404);
  });
});

// ─── Order endpoints (không qua gateway) ───────────────────────────────────
describe("Order endpoints reachable", () => {
  test("GET / (order list) → 200, trả về array", async () => {
    const { status, body } = await get(`${ORDER}/`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), "order list phải là array");
  });

  test("GET /fakeid-not-found → 404", async () => {
    const { status } = await get(`${ORDER}/00000000-0000-0000-0000-000000000000`);
    assert.equal(status, 404);
  });
});

// ─── Nginx routing (nếu có) ────────────────────────────────────────────────
describe("Nginx reverse proxy", () => {
  test("GET /api/auth/health qua Nginx → 200", async () => {
    const { status } = await get(`${NGINX}/api/auth/health`);
    assert.equal(status, 200);
  });

  test("GET /api/health qua Nginx → 200", async () => {
    const { status } = await get(`${NGINX}/api/health`);
    assert.equal(status, 200);
  });

  test("GET / qua Nginx → 200 (frontend)", async () => {
    const res = await fetch(`${NGINX}/`, { signal: AbortSignal.timeout(8000) });
    assert.equal(res.status, 200);
  });
});