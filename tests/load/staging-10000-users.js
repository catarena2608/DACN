import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";

const BASE_URL = (__ENV.BASE_URL || "https://staging.dacn.example.com").replace(/\/$/, "");
const AUTH_EMAIL = __ENV.AUTH_EMAIL;
const AUTH_PASSWORD = __ENV.AUTH_PASSWORD;
const PRODUCT_ID = __ENV.PRODUCT_ID || "";

export const options = {
  scenarios: {
    authenticated_read_path: {
      executor: "ramping-vus",
      gracefulRampDown: "30s",
      stages: [
        { duration: "10m", target: 10000 },
        { duration: "20m", target: 10000 },
        { duration: "5m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  if (!AUTH_EMAIL || !AUTH_PASSWORD) {
    throw new Error("AUTH_EMAIL and AUTH_PASSWORD are required for staging load tests.");
  }

  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
    { headers: { "Content-Type": "application/json" }, timeout: "10s" }
  );

  const ok = check(response, {
    "login returns 200": (res) => res.status === 200,
    "login returns access token": (res) => Boolean(res.json("accessToken")),
  });

  if (!ok) {
    throw new Error(`Login setup failed with status ${response.status}: ${response.body}`);
  }

  return {
    accessToken: response.json("accessToken"),
  };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.accessToken}`,
    "Content-Type": "application/json",
  };

  const listResponse = http.get(`${BASE_URL}/api/products?page=1&limit=20`, {
    headers,
    timeout: "10s",
  });

  check(listResponse, {
    "product list returns 200": (res) => res.status === 200,
    "product list has body": (res) => Boolean(res.body && res.body.length > 0),
  });

  if (PRODUCT_ID && exec.scenario.iterationInTest % 4 === 0) {
    const detailResponse = http.get(`${BASE_URL}/api/products/${PRODUCT_ID}`, {
      headers,
      timeout: "10s",
    });

    check(detailResponse, {
      "product detail returns 200": (res) => res.status === 200,
    });
  }

  sleep(0.5 + Math.random() * 1.5);
}

export function handleSummary(data) {
  return {
    stdout: `Staging 10k load test summary: ${JSON.stringify(data.metrics, null, 2)}\n`,
    "staging-load-summary.json": JSON.stringify(data, null, 2),
  };
}
