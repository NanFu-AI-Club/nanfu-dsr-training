/**
 * JWT 认证中间件
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'nanfu-dsr-training-secret-key-2025';
const JWT_EXPIRES = '24h';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// 必须登录
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录或 Token 已过期' });
  }
  try {
    req.user = verifyToken(authHeader.slice(7));
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: 'Token 无效或已过期' });
  }
}

// 管理员权限
function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ code: 403, message: '需要管理员权限' });
  }
  next();
}

// 可选的认证（不强制）
function authOptional(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(authHeader.slice(7));
    } catch (_) { /* ignore */ }
  }
  next();
}

module.exports = { signToken, verifyToken, authRequired, adminRequired, authOptional, JWT_SECRET };
