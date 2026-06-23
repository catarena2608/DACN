import axios from "axios";
import { store } from "../store";
import { setCredentials, logout } from "../features/authSlice";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

axiosClient.interceptors.request.use((config) => {
  const state = store.getState();
  const token = state.auth.accessToken;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

axiosClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;

    if (err.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const res = await axios.post(
          `${API_BASE_URL}/auth/refresh`,
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
      } catch {
        store.dispatch(logout());
      }
    }

    return Promise.reject(err);
  }
);

export default axiosClient;
