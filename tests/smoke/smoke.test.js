/**
 * Smoke Tests
 *
 * Goal: verify that all services are alive and return the expected HTTP status.
 * Run AFTER docker compose is up and BEFORE integration tests.
 *
 * Environment variables:
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

// ─── Direct service health (bypass gateway) ────────────────────────────────
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

// ─── Gateway health (aggregate) ────────────────────────────────────────────
describe("Gateway health", () => {
  test("GET /api/health → 200, gateway OK, all deps UP", async () => {
    const { status, body } = await get(`${GATEWAY}/api/health`);
    assert.equal(status, 200);
    assert.equal(body.gateway, "OK");
    assert.ok(Array.isArray(body.dependencies), "dependencies must be an array");

    const names = body.dependencies.map((d) => d.name);
    assert.ok(names.includes("auth_service"),    "missing auth_service");
    assert.ok(names.includes("product_service"), "missing product_service");
    assert.ok(names.includes("order_service"),   "missing order_service");

    for (const dep of body.dependencies) {
      assert.equal(dep.status, "UP", `${dep.name} is not UP: ${dep.status}`);
    }
  });

  test("GET / → 200 (gateway root)", async () => {
    const res = await fetch(`${GATEWAY}/`, { signal: AbortSignal.timeout(8000) });
    assert.equal(res.status, 200);
  });
});

// ─── Gateway JWT guard ──────────────────────────────────────────────────────
describe("Gateway JWT guard", () => {
  test("GET /api/products without token → 401", async () => {
    const { status } = await get(`${GATEWAY}/api/products`);
    assert.equal(status, 401);
  });

  test("GET /api/orders without token → 401", async () => {
    const { status } = await get(`${GATEWAY}/api/orders`);
    assert.equal(status, 401);
  });

  test("GET /api/products with fake token → 403", async () => {
    const res = await fetch(`${GATEWAY}/api/products`, {
      headers: { Authorization: "Bearer this.is.fake" },
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(res.status, 403);
  });
});

// ─── Auth endpoints (bypass gateway) ───────────────────────────────────────
describe("Auth endpoints reachable", () => {
  test("POST /register with missing body → 400 (not 5xx)", async () => {
    const res = await fetch(`${AUTH}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    });
    // Expectation: 400 or 201. The important part is that it is not 5xx.
    assert.ok(res.status < 500, `Expected <500 but received ${res.status}`);
  });

  test("POST /login with invalid credentials → 401", async () => {
    const res = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@test.com", password: "wrong" }),
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(res.status, 401);
  });
});

// ─── Product endpoints (bypass gateway) ────────────────────────────────────
describe("Product endpoints reachable", () => {
  test("GET / (product list) → 200, returns shape { products, total, page }", async () => {
    const { status, body } = await get(`${PRODUCT}/`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.products), "products must be an array");
    assert.ok("total"      in body, "missing total");
    assert.ok("page"       in body, "missing page");
    assert.ok("totalPages" in body, "missing totalPages");
  });

  test("GET /notexistid → 404 (product does not exist)", async () => {
    const { status } = await get(`${PRODUCT}/notexistid`);
    assert.equal(status, 404);
  });
});

// ─── Order endpoints (bypass gateway) ──────────────────────────────────────
describe("Order endpoints reachable", () => {
  test("GET / (order list) → 200, returns array", async () => {
    const { status, body } = await get(`${ORDER}/`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), "order list must be an array");
  });

  test("GET /fakeid-not-found → 404", async () => {
    const { status } = await get(`${ORDER}/00000000-0000-0000-0000-000000000000`);
    assert.equal(status, 404);
  });
});

// ─── Nginx routing (if available) ──────────────────────────────────────────
describe("Nginx reverse proxy", () => {
  test("GET /api/auth/health through Nginx → 200", async () => {
    const { status } = await get(`${NGINX}/api/auth/health`);
    assert.equal(status, 200);
  });

  test("GET /api/health through Nginx → 200", async () => {
    const { status } = await get(`${NGINX}/api/health`);
    assert.equal(status, 200);
  });

  test("GET / through Nginx → 200 (frontend)", async () => {
    const res = await fetch(`${NGINX}/`, { signal: AbortSignal.timeout(8000) });
    assert.equal(res.status, 200);
  });
});
