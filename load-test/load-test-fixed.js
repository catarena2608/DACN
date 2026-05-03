import http from 'k6/http';
import { check, sleep } from 'k6';

// Cấu hình test: Tăng dần số lượng người dùng để đo tải
export const options = {
  stages: [
    { duration: '30s', target: 20 }, // Tăng lên 20 users trong 30 giây
    { duration: '1m', target: 20 },  // Duy trì 20 users trong 1 phút
    { duration: '30s', target: 0 },  // Giảm dần về 0
  ],
};

// URL của Gateway (hoặc Nginx) - mặc định chạy local qua gateway port 3000
const BASE_URL = 'http://localhost:3000';

/**
 * Setup function: Chạy 1 lần duy nhất trước khi bắt đầu test
 * Dùng để lấy token xác thực
 */
export function setup() {
  const loginUrl = `${BASE_URL}/api/auth/login`;
  const payload = JSON.stringify({
    email: 'test@example.com', // Thay bằng email thật trong DB của bạn
    password: 'password123',   // Thay bằng password thật
  });
  
  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post(loginUrl, payload, params);
  
  // Log kết quả setup để dễ debug
  if (res.status !== 200) {
    console.error(`❌ Setup failed! Status: ${res.status}. Response: ${res.body}`);
    // Trong thực tế, bạn có thể tạo user mới ở đây nếu login thất bại
    return { authToken: null };
  }

  const body = res.json();
  const token = body.accessToken;

  console.log(`✅ Setup success! Token obtained.`);
  return { authToken: token };
}

/**
 * Main function: Chạy lặp lại bởi các Virtual Users (VUs)
 */
export default function (data) {
  // 1. Test API công khai (không cần token): Lấy danh sách sản phẩm
  const getProductsRes = http.get(`${BASE_URL}/api/users/`); // /api/users mapping tới PRODUCT_SERVICE_URL
  check(getProductsRes, {
    'GET /api/users/ status is 200': (r) => r.status === 200,
  });

  // Nếu có token thì test tiếp các API yêu cầu xác thực
  if (data && data.authToken) {
    const authHeaders = {
      headers: {
        'Authorization': `Bearer ${data.authToken}`,
        'Content-Type': 'application/json',
      },
    };

    // 2. Test API yêu cầu xác thực: Thêm sản phẩm (Ví dụ)
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

  // Nghỉ 1 giây giữa các lần request của 1 VU
  sleep(1);
}
