/**
 * JWT 认证中间件
 */
const jwt = require('jsonwebtoken');

// 安全：强制要求环境变量设置JWT_SECRET
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // 生产环境必须设置，开发环境生成随机密钥并警告
  if (process.env.NODE_ENV === 'production') {
    throw new Error('❌ 生产环境必须设置 JWT_SECRET 环境变量');
  }
  // 开发环境生成随机密钥
  JWT_SECRET = require('crypto').randomBytes(32).toString('hex');
  console.warn('⚠️  警告: JWT_SECRET 未设置，已生成临时密钥（仅用于开发环境）');
}

const JWT_EXPIRES = '24h';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// 必须登录
function authRequired(req, res, next) {
  if (!req.db) {
    return res.status(503).json({ code: 503, message: '服务正在初始化，请稍后重试' });
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录或 Token 已过期' });
  }
  try {
    req.user = verifyToken(authHeader.slice(7));
    if (req.db) {
      const currentUser = getCurrentUser(req.db, req.user.id);
      if (!currentUser || currentUser.status !== 'active') {
        return res.status(401).json({ code: 401, message: '账号已停用或不存在，请重新登录' });
      }
      req.user = {
        ...req.user,
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
        real_name: currentUser.real_name,
        manager_type: currentUser.manager_type || null,
        region_id: currentUser.region_id || null,
        city_id: currentUser.city_id || null
      };
    }
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: 'Token 无效或已过期' });
  }
}

// 管理员权限（系统管理员及各级经理）
function isSalesExperienceUser(user) {
  return Boolean(user && (
    user.role === 'sales' ||
    ['region_manager', 'area_manager', 'city_manager'].includes(user.manager_type)
  ));
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || req.user.manager_type === 'city_manager') {
    return res.status(403).json({ code: 403, message: '需要管理员权限' });
  }
  next();
}

function systemAdminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || (req.user.manager_type && req.user.manager_type !== 'system_admin')) {
    return res.status(403).json({ code: 403, message: '仅系统管理员可访问' });
  }
  next();
}

function getOrgUserScope(db, actor, alias = 'u') {
  if (!actor || actor.role !== 'admin') return { clause: '1 = 0', params: [] };
  if (actor.manager_type === 'system_admin' || !actor.manager_type) return { clause: '1 = 1', params: [] };
  if (actor.manager_type === 'city_manager') {
    return { clause: `${alias}.role = 'sales' AND ${alias}.city_id = ?`, params: [actor.city_id || ''] };
  }
  const regionIds = getAccessibleRegionIds(db, actor);
  if (!regionIds.length) return { clause: '1 = 0', params: [] };
  return {
    clause: `${alias}.role = 'sales' AND ${alias}.region_id IN (${regionIds.map(() => '?').join(',')})`,
    params: regionIds
  };
}

function getCurrentUser(db, userId) {
  return db.prepare(`
    SELECT u.*, r.name AS region_name, r.level AS region_level, c.name AS city_name
    FROM users u
    LEFT JOIN regions r ON r.id = u.region_id
    LEFT JOIN cities c ON c.id = u.city_id
    WHERE u.id = ?
  `).get(userId);
}

function getAccessibleRegionIds(db, user) {
  if (!user || user.role !== 'admin') return [];
  if (user.manager_type === 'system_admin' || !user.manager_type) {
    return db.prepare('SELECT id FROM regions WHERE status = ?').all('active').map(row => row.id);
  }
  if (!user.region_id) return [];
  if (user.manager_type === 'region_manager') {
    return db.prepare('SELECT id FROM regions WHERE id = ? OR parent_id = ?').all(user.region_id, user.region_id).map(row => row.id);
  }
  if (user.manager_type === 'area_manager') {
    return [user.region_id];
  }
  if (user.manager_type === 'city_manager' && user.city_id) {
    const city = db.prepare('SELECT region_id FROM cities WHERE id = ?').get(user.city_id);
    return city ? [city.region_id] : [];
  }
  return [];
}

function canManageUser(db, actor, target) {
  if (!actor || !target || actor.id === target.id) return false;
  if (actor.role !== 'admin') return false;
  if (actor.manager_type === 'system_admin' || !actor.manager_type) return true;
  if (target.role !== 'sales') return false;
  if (actor.manager_type === 'city_manager') return Boolean(actor.city_id && target.city_id === actor.city_id);
  const regionIds = getAccessibleRegionIds(db, actor);
  return Boolean(target.region_id && regionIds.includes(target.region_id));
}

function canManageRegion(db, actor, regionId) {
  if (!actor || actor.role !== 'admin') return false;
  if (actor.manager_type === 'system_admin' || !actor.manager_type) return true;
  return getAccessibleRegionIds(db, actor).includes(regionId);
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

module.exports = {
  signToken,
  verifyToken,
  authRequired,
  adminRequired,
  systemAdminRequired,
  authOptional,
  getCurrentUser,
  isSalesExperienceUser,
  getAccessibleRegionIds,
  getOrgUserScope,
  canManageUser,
  canManageRegion,
  JWT_SECRET
};
