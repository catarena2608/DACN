import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration: gradually increase virtual users to measure load.
export const options = {
  stages: [
    { duration: '30s', target: 20 }, // Ramp up to 20 users in 30 seconds.
    { duration: '1m', target: 20 },  // Hold 20 users for 1 minute.
    { duration: '30s', target: 0 },  // Ramp down to 0.
  ],
};

// Gateway or Nginx URL. Defaults to the local gateway on port 3000.
const BASE_URL = 'http://localhost:3000';

/**
 * Runs once before the test starts.
 * Used to get an authentication token.
 */
export function setup() {
  const loginUrl = `${BASE_URL}/api/auth/login`;
  const payload = JSON.stringify({
    email: 'test@example.com', // Replace with a real email in your database.
    password: 'password123',   // Replace with the real password.
  });
  
  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post(loginUrl, payload, params);
  
  // Log setup result for easier debugging.
  if (res.status !== 200) {
    console.error(`❌ Setup failed! Status: ${res.status}. Response: ${res.body}`);
    // In a real test, you could create a user here if login fails.
    return { authToken: null };
  }

  const body = res.json();
  const token = body.accessToken;

  console.log(`✅ Setup success! Token obtained.`);
  return { authToken: token };
}

/**
 * Main function executed repeatedly by virtual users (VUs).
 */
export default function (data) {
  // 1. Test public API: get product list.
  const getProductsRes = http.get(`${BASE_URL}/api/users/`); // /api/users maps to PRODUCT_SERVICE_URL.
  check(getProductsRes, {
    'GET /api/users/ status is 200': (r) => r.status === 200,
  });

  // If a token exists, continue with authenticated APIs.
  if (data && data.authToken) {
    const authHeaders = {
      headers: {
        'Authorization': `Bearer ${data.authToken}`,
        'Content-Type': 'application/json',
      },
    };

    // 2. Test authenticated API: add a product example.
    const addProductPayload = JSON.stringify({
      name: `Test Product ${Math.floor(Math.random() * 1000)}`,
      price: 100,
      description: 'Load test product'
    });

    const addProductRes = http.post(`${BASE_URL}/api/users/`, addProductPayload, authHeaders);
    check(addProductRes, {
      'POST /api/users/ status is 201': (r) => r.status === 201,
    });
  }

  // Wait 1 second between requests for each VU.
  sleep(1);
}
