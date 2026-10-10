/**
 * 安全中间件：速率限制、输入验证等
 */

// 内存存储速率限制（生产环境建议用 Redis）
const rateLimitStore = new Map();

// 登录速率限制
// 双重限制：同一「账号+IP」严格（防单账号爆破）；同一「IP 总量」宽松（防换用户名爆破）
// 这样多人共用同一出口 IP（同一门店 WiFi / 办公区）时，各自账号互不影响
const loginLimiter = (maxAttempts = 5, windowMs = 60000, ipMaxAttempts = 60) => {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const username = (req.body && req.body.username ? String(req.body.username) : '').trim().toLowerCase();
    const now = Date.now();

    const bump = (key, max) => {
      const record = rateLimitStore.get(key) || { count: 0, firstAttempt: now };
      // 窗口过期，重置
      if (now - record.firstAttempt > windowMs) {
        record.count = 0;
        record.firstAttempt = now;
      }
      record.count++;
      rateLimitStore.set(key, record);
      return {
        blocked: record.count > max,
        retryAfter: Math.ceil((record.firstAttempt + windowMs - now) / 1000)
      };
    };

    const acct = bump(`login:acct:${ip}:${username}`, maxAttempts);
    const ipTotal = bump(`login:ip:${ip}`, ipMaxAttempts);

    if (acct.blocked || ipTotal.blocked) {
      const retryAfter = Math.max(acct.retryAfter, ipTotal.retryAfter, 1);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        code: 429,
        message: `登录尝试过多，请 ${retryAfter} 秒后再试`
      });
    }

    next();
  };
};

// API 通用速率限制
const apiLimiter = (maxRequests = 100, windowMs = 60000) => {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const key = `api:${ip}`;
    const now = Date.now();

    const record = rateLimitStore.get(key) || { count: 0, firstAttempt: now };

    if (now - record.firstAttempt > windowMs) {
      record.count = 0;
      record.firstAttempt = now;
    }

    record.count++;
    rateLimitStore.set(key, record);

    if (record.count > maxRequests) {
      return res.status(429).json({
        code: 429,
        message: '请求过于频繁，请稍后再试'
      });
    }

    next();
  };
};

// 清理过期记录（每5分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore) {
    if (now - record.firstAttempt > 300000) {
      rateLimitStore.delete(key);
    }
  }
}, 300000);

// XSS 防护：HTML 转义
const escapeHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

// 输入净化
const sanitizeInput = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    // 移除危险键名
    if (key.includes('$') || key.includes('.') || key.includes('__proto__')) {
      continue;
    }

    if (typeof value === 'string') {
      // 限制字符串长度
      sanitized[key] = value.slice(0, 10000);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeInput(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

// 安全头
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // X-Frame-Options 设为 SAMEORIGIN 以允许同源 iframe（课程预览需要）
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.removeHeader('X-Powered-By');
  next();
};

module.exports = {
  loginLimiter,
  apiLimiter,
  escapeHtml,
  sanitizeInput,
  securityHeaders
};