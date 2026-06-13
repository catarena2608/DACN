import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 20 },
  ],
};

const BASE_URL = 'http://localhost';

export function setup() {
  const loginUrl = `${BASE_URL}/customer/login`;
  const payload = JSON.stringify({
    email: 'anvu5437@gmail.com',
    password: '666666',
  });
  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post(loginUrl, payload, params);

  // Check that the response contains data.
  const body = res.json();
  
  // Based on the expected response shape: data { data: { id, token } }.
  // Use defensive access to avoid crashing when the API returns an error.
  const token = body && body.token;

  if (!token) {
    console.error(`Setup failed! Status: ${res.status}. Response: ${res.body}`);
    return { authToken: null };
  }

  console.log(`Setup success! Token obtained.`);
  return { authToken: token };
}

export default function (data) {
  // Stop this iteration if no token is available.
  if (!data || !data.authToken) {
    return;
  }

  const authHeaders = {
    headers: {
      'Authorization': `Bearer ${data.authToken}`,
      'Content-Type': 'application/json',
    },
  };

  const cartRes = http.put(`${BASE_URL}/cart`, JSON.stringify({
    _id: '69e67cbeb74cd907848e366f', 
    qty: 1
  }), authHeaders);

  check(cartRes, {
    'Added to cart status 200': (r) => r.status === 200,
  });

  sleep(1);
}
