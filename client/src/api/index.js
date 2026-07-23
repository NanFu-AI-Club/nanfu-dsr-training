import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// 请求拦截器：自动附带 Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：统一解包与错误处理
api.interceptors.response.use(
  (res) => {
    const data = res.data;
    // Blob 响应（文件导出）直接透传
    if (data instanceof Blob || data instanceof ArrayBuffer) {
      return data;
    }
    // 检查业务错误码，code !== 0 且 code 不为 undefined 时视为错误
    if (data && typeof data === 'object' && data.code !== undefined && data.code !== 0) {
      return Promise.reject({ code: data.code, message: data.message || '请求失败' });
    }
    return data;
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err.response?.data || { code: 500, message: '网络错误，请检查连接' });
  }
);

export default api;
