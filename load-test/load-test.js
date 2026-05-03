import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '20s', target: 15 },
  ],
};

const BASE_URL = 'https://cookial.site';

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

  // Kiểm tra phản hồi có dữ liệu không
  const body = res.json();
  
  // Dựa trên FormateData: data { data: { id, token } }
  // Ta dùng optional chaining (?.) để tránh crash nếu API trả lỗi
  const token = body && body.token;

  if (!token) {
    console.error(`Setup failed! Status: ${res.status}. Response: ${res.body}`);
    return { authToken: null };
  }

  console.log(`Setup success! Token obtained.`);
  return { authToken: token };
}

export default function (data) {
  // Nếu không có token thì dừng iteration này
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
    _id: '69e67d5cf113f318aa10384e', 
    qty: 1
  }), authHeaders);

  check(cartRes, {
    'Added to cart status 200': (r) => r.status === 200,
  });

  sleep(1);
}