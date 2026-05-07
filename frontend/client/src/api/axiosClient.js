import axios from "axios";
import { store } from "../store";
import { setCredentials, logout } from "../features/authSlice";

const axiosClient = axios.create({
  baseURL: "http://localhost:5000",
  withCredentials: true, // 👈 để gửi cookie refresh token
});

// attach access token
axiosClient.interceptors.request.use((config) => {
  const state = store.getState();
  const token = state.auth.accessToken;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// handle refresh token
axiosClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;

    if (err.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const res = await axios.post(
          "http://localhost:5000/auth/refresh",
          {},
          { withCredentials: true }
        );

        store.dispatch(
          setCredentials({
            accessToken: res.data.accessToken,
          })
        );

        originalRequest.headers.Authorization = `Bearer ${res.data.accessToken}`;
        return axiosClient(originalRequest);
      } catch (_error) {
        store.dispatch(logout());
      }
    }

    return Promise.reject(err);
  }
);

export default axiosClient;