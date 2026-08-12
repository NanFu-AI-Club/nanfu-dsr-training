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

// 错误消息映射
const errorMessages = {
  400: '请求参数错误',
  401: '登录已过期，请重新登录',
  403: '没有权限执行此操作',
  404: '请求的资源不存在',
  429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误',
  502: '服务器网关错误',
  503: '服务暂时不可用',
  504: '服务器响应超时',
};

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
    const status = err.response?.status;
    const data = err.response?.data;

    // 401 未授权
    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // 避免登录页面重复跳转
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }

    // 429 速率限制
    if (status === 429) {
      const retryAfter = err.response?.headers?.['retry-after'];
      const message = retryAfter
        ? `请求过于频繁，请 ${retryAfter} 秒后再试`
        : data?.message || '请求过于频繁，请稍后再试';
      return Promise.reject({ code: 429, message });
    }

    // 友好错误消息
    const message = data?.message || errorMessages[status] || '网络错误，请检查连接';

    return Promise.reject({
      code: status || 500,
      message,
    });
  }
);

export default api;