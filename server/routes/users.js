const express = require('express');
const { nowShanghaiString } = require('../utils/time');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const {
  authRequired,
  getCurrentUser,
  getAccessibleRegionIds,
  canManageUser,
  canManageRegion
} = require('../middleware/auth');

const SALT_ROUNDS = 10;

/**
 * 管理员权限校验中间件
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ code: 403, message: '无权限，仅管理员可操作' });
  }
  next();
}

/**
 * 记录操作日志
 */
function logActivity(db, userId, action, targetType, targetId, detail, module = 'users', ip = null) {
  const id = uuidv4();
  const now = nowShanghaiString();
  const detailStr = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null;
  db.prepare(
    `INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, action, module, targetType, targetId, detailStr, ip, now);
}
module.exports.logActivity = logActivity;

function resolveOrgAssignment(db, { regionId, regionName, cityId, cityName }) {
  let resolvedRegionId = regionId || null;
  let resolvedCityId = cityId || null;

  if (!resolvedRegionId && regionName) {
    const region = db.prepare(
      'SELECT id FROM regions WHERE name = ? AND status = ?'
    ).get(regionName, 'active');
    resolvedRegionId = region?.id || null;
  }

  if (!resolvedCityId && cityName) {
    const city = db.prepare(
      'SELECT id FROM cities WHERE name = ? AND status = ?'
    ).get(cityName, 'active');
    resolvedCityId = city?.id || null;
  }

  return {
    regionId: resolvedRegionId,
    cityId: resolvedCityId,
    invalidRegion: Boolean(regionName && !resolvedRegionId),
    invalidCity: Boolean(cityName && !resolvedCityId)
  };
}

function validateOrgAssignment(db, { role, managerType, regionId, cityId }) {
  // 销售端角色（业务员 + 城市经理销售端）必须绑定细分区域
  if (role === 'sales' && !regionId) {
    return '业务员和城市经理必须绑定细分区域';
  }
  if (role === 'sales' && regionId) {
    const salesRegion = db.prepare('SELECT level FROM regions WHERE id = ? AND status = ?').get(regionId, 'active');
    if (!salesRegion || salesRegion.level !== 2) return '业务员和城市经理必须绑定细分区域，不能绑定大区';
  }
  if (role === 'sales' && managerType && managerType !== 'city_manager') {
    return '业务员不能设置该管理角色';
  }
  if (managerType === 'city_manager' && role !== 'sales') {
    return '城市经理只能使用销售端角色';
  }
  if (role === 'admin' && !managerType) return '管理员必须选择管理角色';
  if (role === 'admin' && managerType === 'system_admin') {
    if (regionId || cityId) return '系统管理员不需要绑定区域或城市';
    return null;
  }
  if (managerType === 'region_manager' || managerType === 'area_manager') {
    const region = regionId && db.prepare('SELECT level FROM regions WHERE id = ? AND status = ?').get(regionId, 'active');
    const expectedLevel = managerType === 'region_manager' ? 1 : 2;
    if (!region || region.level !== expectedLevel || cityId) return '管理角色与区域归属不匹配';
  }
  if (regionId) {
    const region = db.prepare(
      'SELECT id FROM regions WHERE id = ? AND status = ?'
    ).get(regionId, 'active');
    if (!region) return '区域不存在或已停用';
  }
  if (cityId) {
    const city = db.prepare(`
      SELECT c.region_id, r.level AS region_level
      FROM cities c
      JOIN regions r ON r.id = c.region_id
      WHERE c.id = ? AND c.status = 'active' AND r.status = 'active'
    `).get(cityId);
    if (!city) return '城市不存在或已停用';
    if (regionId && city.region_id !== regionId) return '城市不属于所选区域';
  }
  return null;
}

// 角色筛选（区分业务员/系统管理员/大区经理/区域经理/城市经理）
function buildRoleClause(roleType) {
  switch (roleType) {
    case 'region_manager': return "u.manager_type = 'region_manager'";
    case 'area_manager': return "u.manager_type = 'area_manager'";
    case 'city_manager': return "u.manager_type = 'city_manager'";
    case 'system_admin': return "u.role = 'admin' AND (u.manager_type = 'system_admin' OR u.manager_type IS NULL OR u.manager_type = '')";
    case 'sales':
    default: return "u.role = 'sales' AND (u.manager_type IS NULL OR u.manager_type = '')";
  }
}

// ============================================================
// 用户 CRUD
// ============================================================

/**
 * GET /users
 * 用户列表（分页、搜索、按分组/角色/组织筛选）
 */
function listUsers(req, res) {
  const db = req.db;
  const {
    page = 1,
    limit = 20,
    keyword = '',
    group_id = '',
    role = '',
    role_type = '',
    region_id = '',
    city_id = '',
    area_id = '',
    ids = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const limitNum = Number(limit);

  let whereClauses = [];
  let params = [];
  const actor = getCurrentUser(db, req.user.id);
  const accessibleRegionIds = getAccessibleRegionIds(db, actor);
  const isSystemAdmin = actor.manager_type === 'system_admin' || !actor.manager_type;

  if (!isSystemAdmin) {
    if (actor.manager_type === 'city_manager') {
      whereClauses.push("u.city_id = ? AND u.role = 'sales'");
      params.push(actor.city_id || '');
    } else if (accessibleRegionIds.length > 0) {
      whereClauses.push(`u.region_id IN (${accessibleRegionIds.map(() => '?').join(',')})`);
      params.push(...accessibleRegionIds);
    } else {
      whereClauses.push('1 = 0');
    }
  }

  const keywordText = String(keyword || '').trim();
  if (keywordText) {
    whereClauses.push('(u.username LIKE ? OR u.real_name LIKE ?)');
    params.push(`%${keywordText}%`, `%${keywordText}%`);
  }

  // 按 ID 批量查询（用于回填已选人员的姓名）
  const idList = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (idList.length > 0) {
    whereClauses.push(`u.id IN (${idList.map(() => '?').join(',')})`);
    params.push(...idList);
  }

  if (group_id) {
    whereClauses.push('u.group_id = ?');
    params.push(group_id);
  }

  if (role_type) {
    whereClauses.push(buildRoleClause(role_type));
  } else if (role) {
    whereClauses.push('u.role = ?');
    params.push(role);
  }

  if (area_id) {
    whereClauses.push('(u.region_id = ? OR u.region_id IN (SELECT id FROM regions WHERE parent_id = ?))');
    params.push(area_id, area_id);
  }

  if (region_id && (isSystemAdmin || accessibleRegionIds.includes(region_id))) {
    whereClauses.push('u.region_id = ?');
    params.push(region_id);
  }

  if (city_id && (isSystemAdmin || actor.city_id === city_id || accessibleRegionIds.includes((db.prepare('SELECT region_id FROM cities WHERE id = ?').get(city_id) || {}).region_id))) {
    whereClauses.push('u.city_id = ?');
    params.push(city_id);
  }

  const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM users u ${whereSQL}`
  ).get(...params);

  const rows = db.prepare(
    `SELECT u.id, u.username, u.real_name, u.email, u.phone, u.role, u.points, u.total_earned_points, u.group_id, u.status,
            g.name as group_name,
            r.name as region_name, c.name as city_name,
            u.manager_type, u.region_id, u.city_id, u.dealer_name,
            u.created_at, u.updated_at
     FROM users u
     LEFT JOIN groups g ON g.id = u.group_id
     LEFT JOIN regions r ON r.id = u.region_id
     LEFT JOIN cities c ON c.id = u.city_id
     ${whereSQL}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limitNum, offset);

  res.json({
    code: 0,
    data: {
      list: rows,
      total: countRow.total,
      page: Number(page),
      limit: limitNum,
    },
  });
}

/**
 * POST /users
 * 创建用户（密码 bcrypt 加密）
 */
function createUser(req, res) {
  const db = req.db;
  const actor = getCurrentUser(db, req.user.id);
  const actorIsSystemAdmin = !actor.manager_type || actor.manager_type === 'system_admin';
  const actorIsOrgManager = actor.manager_type === 'region_manager' || actor.manager_type === 'area_manager';
  if (!actorIsSystemAdmin && !actorIsOrgManager) {
    return res.status(403).json({ code: 403, message: '无权创建用户' });
  }
  const { username, name, real_name, password, email, phone, role, manager_type, group_id, region_id, city_id, dealer_name } = req.body;
  const displayName = real_name || name || '';
  const targetRole = role || 'sales';
  const targetManagerType = manager_type || null;
  // 只有业务员有所属经销商，管理员 / 城市经理不涉及
  const isSalesman = targetRole === 'sales' && !targetManagerType;
  const dealerValue = isSalesman ? String(dealer_name || '').trim() : '';

  const assignmentError = validateOrgAssignment(db, {
    role: role || 'sales',
    managerType: manager_type || null,
    regionId: region_id || null,
    cityId: city_id || null
  });
  if (assignmentError) {
    return res.status(400).json({ code: 400, message: assignmentError });
  }

  // 大区经理 / 区域经理：只能在本辖区内创建业务员或城市经理
  if (!actorIsSystemAdmin) {
    if (targetRole !== 'sales' || (targetManagerType && targetManagerType !== 'city_manager')) {
      return res.status(403).json({ code: 403, message: '各级经理只能创建业务员或城市经理账号' });
    }
    if (!region_id || !canManageRegion(db, actor, region_id)) {
      return res.status(403).json({ code: 403, message: '无权在该区域下创建用户' });
    }
  }

  if (manager_type && manager_type !== 'system_admin' && !canManageRegion(db, actor, region_id)) {
    return res.status(403).json({ code: 403, message: '无权分配该管理范围' });
  }
  if (city_id) {
    const city = db.prepare('SELECT region_id FROM cities WHERE id = ?').get(city_id);
    if (!city || !canManageRegion(db, actor, city.region_id)) {
      return res.status(403).json({ code: 403, message: '无权分配该城市' });
    }
  }

  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '用户名和密码为必填项' });
  }
  if (isSalesman && !dealerValue) {
    return res.status(400).json({ code: 400, message: '业务员必须填写所属经销商' });
  }

  // 检查用户名是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ code: 400, message: '用户名已存在' });
  }

  const id = uuidv4();
  const now = nowShanghaiString();
  const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);

  db.prepare(
    `INSERT INTO users (id, username, real_name, password, email, phone, role, manager_type, group_id, region_id, city_id, dealer_name, points, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, username, displayName, hashedPassword, email || null, phone || null,
        role || 'sales', manager_type || null, group_id || null, region_id || null, city_id || null,
        dealerValue || null, 0, 'active', now, now);

  logActivity(db, req.user.id, 'create', 'user', id,
    `创建用户：${username}（${displayName || '未命名'}）`);

  const user = db.prepare(
    `SELECT u.id, u.username, u.real_name, u.email, u.phone, u.role, u.manager_type,
            u.points, u.group_id, u.region_id, u.city_id, u.dealer_name, u.status,
            g.name as group_name, r.name as region_name, c.name as city_name,
            u.created_at, u.updated_at
     FROM users u LEFT JOIN groups g ON g.id = u.group_id
     LEFT JOIN regions r ON r.id = u.region_id LEFT JOIN cities c ON c.id = u.city_id
     WHERE u.id = ?`
  ).get(id);

  res.json({ code: 0, data: user });
}

/**
 * POST /users/batch
 * 批量导入用户
 * 请求体: { users: [{ username, real_name, password, role, group_id, phone, email }, ...] }
 */
async function batchCreateUsers(req, res) {
  try {
    const db = req.db;
    const actor = getCurrentUser(db, req.user.id);
    if (actor.manager_type && actor.manager_type !== 'system_admin') {
      return res.status(403).json({ code: 403, message: '只有系统管理员可以创建用户' });
    }
    const { users } = req.body;

    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供用户数据' });
    }

    const results = { success: 0, skipped: 0, errors: [] };
    const now = nowShanghaiString();

    // 第一遍：校验并收集待插入用户
    const toInsert = [];
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const username = u.username?.trim();
      const realName = u.real_name?.trim() || u.name?.trim() || username || '';
      const password = u.password?.trim();
      const role = u.role?.trim() || 'sales';
      const phone = u.phone?.trim() || null;
      const email = u.email?.trim() || null;
      const dealerName = u.dealer_name?.trim() || null;
      let groupId = u.group_id || null;
      const managerType = u.manager_type?.trim() || null;
      const org = resolveOrgAssignment(db, {
        regionId: u.region_id?.trim(),
        regionName: u.region_name?.trim(),
        cityId: u.city_id?.trim(),
        cityName: u.city_name?.trim()
      });
      const regionId = org.regionId;
      const cityId = org.cityId;

      if (org.invalidRegion || org.invalidCity) {
        results.errors.push({
          row: i + 1,
          username: username || '(空)',
          reason: org.invalidRegion ? '区域不存在或已停用' : '城市不存在或已停用'
        });
        continue;
      }

      // 跳过空行
      if (!username) continue;

      const assignmentError = validateOrgAssignment(db, {
        role,
        managerType,
        regionId,
        cityId
      });
      if (assignmentError) {
        results.errors.push({ row: i + 1, username, reason: assignmentError });
        continue;
      }

      // 校验
      if (!password) {
        results.errors.push({ row: i + 1, username: username || '(空)', reason: '密码不能为空' });
        continue;
      }

      // 检查用户名是否已存在
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        results.skipped++;
        continue;
      }

      // 如果传了分组名称，尝试按名称查找分组
      if (u.group_name?.trim() && !groupId) {
        const grp = db.prepare('SELECT id FROM groups WHERE name = ?').get(u.group_name.trim());
        if (grp) groupId = grp.id;
      }

      toInsert.push({ username, realName, password, role, managerType, groupId, regionId, cityId, phone, email, dealerName });
    }

    // 第二遍：计算密码哈希（相同密码复用同一哈希，避免重复计算拖慢全站）
    const hashCache = new Map();
    const hashes = await Promise.all(toInsert.map((u) => {
      if (!hashCache.has(u.password)) {
        hashCache.set(u.password, bcrypt.hash(u.password, SALT_ROUNDS));
      }
      return hashCache.get(u.password);
    }));

    // 第三遍：同步插入
    for (let j = 0; j < toInsert.length; j++) {
      const u = toInsert[j];
      const id = uuidv4();
      db.prepare(
        `INSERT INTO users (id, username, real_name, password, email, phone, role, manager_type, group_id, region_id, city_id, dealer_name, points, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, u.username, u.realName, hashes[j], u.email, u.phone,
            u.role, u.managerType, u.groupId, u.regionId, u.cityId, u.dealerName, 0, 'active', now, now);

      results.success++;
    }

    logActivity(db, req.user.id, 'batch_import', 'user', null,
      `批量导入用户：成功 ${results.success}，跳过 ${results.skipped}，失败 ${results.errors.length}`);

    res.json({ code: 0, data: results });
  } catch (err) {
    console.error('[users/batch] Error:', err);
    res.status(500).json({ code: 500, message: '批量导入失败' });
  }
}

/**
 * PUT /users/:id
 * 更新用户
 */
function updateUser(req, res) {
  const db = req.db;
  const { id } = req.params;
  // 前端提交的姓名字段为 real_name（与 users 表字段一致），此处兼容旧的 name 字段名
  const { username, name, real_name: realNameInput, email, phone, role, manager_type, group_id, region_id, city_id, status, password, dealer_name } = req.body;
  const realName = realNameInput !== undefined ? realNameInput : name;

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '用户不存在' });
  }
  const actor = getCurrentUser(db, req.user.id);
  if (!actor || !canManageUser(db, actor, existing)) {
    return res.status(403).json({ code: 403, message: '无权编辑该用户' });
  }
  const isSystemAdmin = actor.manager_type === 'system_admin' || !actor.manager_type;
  const assignmentError = validateOrgAssignment(db, {
    role: role !== undefined ? role : existing.role,
    managerType: manager_type !== undefined ? manager_type : existing.manager_type,
    regionId: region_id !== undefined ? region_id : existing.region_id,
    cityId: city_id !== undefined ? city_id : existing.city_id
  });
  if (assignmentError) {
    return res.status(400).json({ code: 400, message: assignmentError });
  }
  if (!isSystemAdmin && (role !== undefined || manager_type !== undefined || region_id !== undefined || city_id !== undefined)) {
    return res.status(403).json({ code: 403, message: '各级经理不能修改用户角色和组织归属' });
  }

  // 如果修改了用户名，检查是否重复
  if (username && username !== existing.username) {
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (dup) {
      return res.status(400).json({ code: 400, message: '用户名已被占用' });
    }
  }

  const now = nowShanghaiString();

  const setClauses = [];
  const params = [];

  if (username !== undefined) { setClauses.push('username = ?'); params.push(username); }
  if (realName !== undefined) {
    if (!String(realName).trim()) return res.status(400).json({ code: 400, message: '真实姓名不能为空' });
    setClauses.push('real_name = ?'); params.push(realName);
  }
  if (email !== undefined) { setClauses.push('email = ?'); params.push(email); }
  if (phone !== undefined) { setClauses.push('phone = ?'); params.push(phone); }
  if (role !== undefined) { setClauses.push('role = ?'); params.push(role); }
  if (manager_type !== undefined) { setClauses.push('manager_type = ?'); params.push(manager_type || null); }
  if (group_id !== undefined) { setClauses.push('group_id = ?'); params.push(group_id); }
  if (region_id !== undefined) {
    if (!canManageRegion(db, actor, region_id)) return res.status(403).json({ code: 403, message: '无权分配该区域' });
    setClauses.push('region_id = ?'); params.push(region_id || null);
  }
  if (city_id !== undefined) {
    const city = city_id ? db.prepare('SELECT region_id FROM cities WHERE id = ?').get(city_id) : null;
    if (city_id && (!city || !canManageRegion(db, actor, city.region_id))) return res.status(403).json({ code: 403, message: '无权分配该城市' });
    setClauses.push('city_id = ?'); params.push(city_id || null);
  }
  if (dealer_name !== undefined) { setClauses.push('dealer_name = ?'); params.push(dealer_name || null); }
  if (status !== undefined) { setClauses.push('status = ?'); params.push(status); }

  if (password) {
    setClauses.push('password = ?');
    params.push(bcrypt.hashSync(password, SALT_ROUNDS));
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ code: 400, message: '没有需要更新的字段' });
  }

  setClauses.push('updated_at = ?');
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  logActivity(db, req.user.id, 'update', 'user', id,
    `更新用户：${username || existing.username}`);

  const user = db.prepare(
    `SELECT u.id, u.username, u.real_name, u.email, u.phone, u.role, u.manager_type,
            u.points, u.group_id, u.region_id, u.city_id, u.dealer_name, u.status,
            g.name as group_name, r.name as region_name, c.name as city_name,
            u.created_at, u.updated_at
     FROM users u LEFT JOIN groups g ON g.id = u.group_id
     LEFT JOIN regions r ON r.id = u.region_id LEFT JOIN cities c ON c.id = u.city_id
     WHERE u.id = ?`
  ).get(id);

  res.json({ code: 0, data: user });
}

/**
 * DELETE /users/:id
 * 删除用户
 */
function deleteUser(req, res) {
  const db = req.db;
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '用户不存在' });
  }
  const actor = getCurrentUser(db, req.user.id);
  if (!canManageUser(db, actor, existing)) {
    return res.status(403).json({ code: 403, message: '无权删除该用户' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  logActivity(db, req.user.id, 'delete', 'user', id,
    `删除用户：${existing.username}`);

  res.json({ code: 0, data: null });
}

// ============================================================
// 分组 CRUD
// ============================================================

/**
  * GET /groups
  * 分组列表
  */
function listGroups(req, res) {
  const db = req.db;
  const actor = getCurrentUser(db, req.user.id);
  const isSystemAdmin = actor.manager_type === 'system_admin' || !actor.manager_type;
  let scope = '';
  let params = [];

  if (!isSystemAdmin) {
    const accessibleRegionIds = getAccessibleRegionIds(db, actor);
    if (actor.manager_type === 'city_manager') {
      scope = `WHERE EXISTS (
        SELECT 1 FROM users scoped
        WHERE scoped.group_id = g.id
          AND scoped.city_id = ?
          AND scoped.role = 'sales'
      )`;
      params = [actor.city_id || ''];
    } else if (accessibleRegionIds.length > 0) {
      scope = `WHERE EXISTS (
        SELECT 1 FROM users scoped
        WHERE scoped.group_id = g.id
          AND scoped.role = 'sales'
          AND scoped.region_id IN (${accessibleRegionIds.map(() => '?').join(',')})
      )`;
      params = accessibleRegionIds;
    } else {
      scope = 'WHERE 1 = 0';
    }
  }

  const rows = db.prepare(
    `SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) as user_count
     FROM groups g ${scope} ORDER BY g.created_at DESC`
  ).all(...params);

  res.json({ code: 0, data: rows });
}

/**
 * POST /groups
 * 创建分组
 */
function listRegions(req, res) {
  const db = req.db;
  const actor = getCurrentUser(db, req.user.id);
  const accessibleRegionIds = getAccessibleRegionIds(db, actor);
  const isSystemAdmin = actor.manager_type === 'system_admin' || !actor.manager_type;
  const scope = isSystemAdmin ? '' : accessibleRegionIds.length ? `AND r.id IN (${accessibleRegionIds.map(() => '?').join(',')})` : 'AND 1 = 0';
  const rows = db.prepare(`
    SELECT r.id, r.name, r.parent_id, r.level, r.code, r.sort_order,
           (SELECT COUNT(*) FROM users u WHERE u.region_id = r.id OR u.city_id IN (SELECT id FROM cities WHERE region_id = r.id)) AS user_count
    FROM regions r
    WHERE r.status = 'active' ${scope}
    ORDER BY r.level, r.sort_order
  `).all(...(isSystemAdmin ? [] : accessibleRegionIds));
  res.json({ code: 0, data: rows });
}

function listCities(req, res) {
  const db = req.db;
  const { region_id = '' } = req.query;
  const actor = getCurrentUser(db, req.user.id);
  const accessibleRegionIds = getAccessibleRegionIds(db, actor);
  const isSystemAdmin = actor.manager_type === 'system_admin' || !actor.manager_type;
  const requestedRegionAllowed = !region_id || isSystemAdmin || accessibleRegionIds.includes(region_id);
  const regionIds = region_id ? [region_id] : accessibleRegionIds;
  const scope = !requestedRegionAllowed
    ? 'AND 1 = 0'
    : isSystemAdmin
      ? (region_id ? 'AND c.region_id = ?' : '')
      : regionIds.length
        ? `AND c.region_id IN (${regionIds.map(() => '?').join(',')})`
        : 'AND 1 = 0';
  const rows = db.prepare(`
    SELECT c.*, r.name AS region_name
    FROM cities c JOIN regions r ON r.id = c.region_id
    WHERE c.status = 'active' ${scope}
    ORDER BY c.name
  `).all(...(isSystemAdmin ? (region_id ? [region_id] : []) : regionIds));
  res.json({ code: 0, data: rows });
}

function createGroup(req, res) {
  const db = req.db;
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ code: 400, message: '分组名称为必填项' });
  }

  const existing = db.prepare('SELECT id FROM groups WHERE name = ?').get(name);
  if (existing) {
    return res.status(400).json({ code: 400, message: '分组名称已存在' });
  }

  const id = uuidv4();
  const now = nowShanghaiString();

  db.prepare(
    `INSERT INTO groups (id, name, description, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, name, description || null, now);

  logActivity(db, req.user.id, 'create', 'group', id,
    `创建分组：${name}`);

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  res.json({ code: 0, data: group });
}

/**
 * PUT /groups/:id
 * 更新分组
 */
function updateGroup(req, res) {
  const db = req.db;
  const actor = getCurrentUser(db, req.user.id);
  if (actor.manager_type && actor.manager_type !== 'system_admin') {
    return res.status(403).json({ code: 403, message: '只有系统管理员可以管理分组' });
  }
  const { id } = req.params;
  const { name, description } = req.body;

  const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '分组不存在' });
  }

  if (name && name !== existing.name) {
    const dup = db.prepare('SELECT id FROM groups WHERE name = ? AND id != ?').get(name, id);
    if (dup) {
      return res.status(400).json({ code: 400, message: '分组名称已存在' });
    }
  }

  const now = nowShanghaiString();
  db.prepare(
    `UPDATE groups SET name = ?, description = ? WHERE id = ?`
  ).run(
    name !== undefined ? name : existing.name,
    description !== undefined ? description : existing.description,
    id
  );

  logActivity(db, req.user.id, 'update', 'group', id,
    `更新分组：${name || existing.name}`);

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  res.json({ code: 0, data: group });
}

/**
 * DELETE /groups/:id
 * 删除分组
 */
function deleteGroup(req, res) {
  const db = req.db;
  const actor = getCurrentUser(db, req.user.id);
  if (actor.manager_type && actor.manager_type !== 'system_admin') {
    return res.status(403).json({ code: 403, message: '只有系统管理员可以管理分组' });
  }
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '分组不存在' });
  }

  // 将该分组下的用户移出分组
  db.prepare('UPDATE users SET group_id = NULL WHERE group_id = ?').run(id);
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);

  logActivity(db, req.user.id, 'delete', 'group', id,
    `删除分组：${existing.name}`);

  res.json({ code: 0, data: null });
}

// ============================================================
// 积分管理
// ============================================================

/**
 * PUT /users/:id/points
 * 手动加减积分，同时写入 point_logs
 */
function adjustPoints(req, res) {
  const db = req.db;
  const { id } = req.params;
  const { amount, reason, total_earned_amount } = req.body;

  const changeAmount = amount === undefined || amount === null || amount === '' ? 0 : Number(amount);
  const totalEarnedChange = total_earned_amount === undefined || total_earned_amount === null || total_earned_amount === '' ? 0 : Number(total_earned_amount);

  if (isNaN(changeAmount) || isNaN(totalEarnedChange)) {
    return res.status(400).json({ code: 400, message: '积分变动量必须是数字' });
  }
  if (changeAmount === 0 && totalEarnedChange === 0) {
    return res.status(400).json({ code: 400, message: '请至少调整一项（当前积分或累计总积分）' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(400).json({ code: 400, message: '用户不存在' });
  }
  const actor = getCurrentUser(db, req.user.id);
  if (!canManageUser(db, actor, user)) {
    return res.status(403).json({ code: 403, message: '无权调整该用户积分' });
  }

  const newPoints = Number(user.points || 0) + changeAmount;
  if (newPoints < 0) {
    return res.status(400).json({ code: 400, message: '积分不足，操作后当前积分不能为负数' });
  }

  // 累计总积分：手动调整量 + 当前积分的正向增量（与原逻辑保持一致）
  let newTotalEarned = Number(user.total_earned_points || 0) + totalEarnedChange;
  if (changeAmount > 0) newTotalEarned += changeAmount;
  if (newTotalEarned < 0) {
    return res.status(400).json({ code: 400, message: '累计总积分不能为负数' });
  }

  const now = nowShanghaiString();

  db.prepare('UPDATE users SET points = ?, total_earned_points = ?, updated_at = ? WHERE id = ?')
    .run(newPoints, newTotalEarned, now, id);

  // 当前积分变动写入积分流水；累计总积分的单独调整不写流水，避免影响积分统计口径
  if (changeAmount !== 0) {
    const logId = uuidv4();
    db.prepare(
      `INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(logId, id, changeAmount, reason || null, 'manual_adjust', req.user.id, now);
  }

  // 通知被调整的用户本人（登录后弹窗提示）
  try {
    const parts = [];
    if (changeAmount !== 0) parts.push(`当前积分 ${changeAmount > 0 ? '+' : ''}${changeAmount}`);
    if (totalEarnedChange !== 0) parts.push(`累计总积分 ${totalEarnedChange > 0 ? '+' : ''}${totalEarnedChange}`);
    db.prepare(
      `INSERT INTO user_notifications (id, user_id, type, title, content, is_read, created_at)
       VALUES (?, ?, 'points_adjust', ?, ?, 0, datetime('now','localtime'))`
    ).run(
      uuidv4(), id, '积分调整通知',
      `管理员调整了你的积分：${parts.join('，')}${reason ? `。原因：${reason}` : ''}（调整后当前积分 ${newPoints} 分）`
    );
  } catch (e) {
    console.error('[users/adjustPoints] 通知写入失败:', e.message);
  }

  logActivity(db, req.user.id, 'adjust_points', 'user', id,
    `积分调整：当前积分${changeAmount >= 0 ? '+' : ''}${changeAmount}，累计总积分${totalEarnedChange >= 0 ? '+' : ''}${totalEarnedChange}，原因：${reason || '无'}`);

  const updatedUser = db.prepare(
    `SELECT u.id, u.username, u.real_name, u.points, u.total_earned_points, u.updated_at
     FROM users u WHERE u.id = ?`
  ).get(id);

  res.json({ code: 0, data: updatedUser });
}

/**
 * GET /users/:id/point-logs
 * 查询积分流水
 */
function getPointLogs(req, res) {
  const db = req.db;
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const limitNum = Number(limit);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(400).json({ code: 400, message: '用户不存在' });
  }
  const actor = getCurrentUser(db, req.user.id);
  if (!canManageUser(db, actor, user)) {
    return res.status(403).json({ code: 403, message: '无权查看该用户积分流水' });
  }

  const countRow = db.prepare(
    'SELECT COUNT(*) as total FROM point_logs WHERE user_id = ?'
  ).get(id);

  const rows = db.prepare(
    `SELECT pl.*,
            CASE WHEN pl.source_type = 'manual_adjust'
                 THEN (SELECT u2.real_name FROM users u2 WHERE u2.id = pl.source_id)
                 ELSE NULL
            END as operator_name
     FROM point_logs pl
     WHERE pl.user_id = ?
     ORDER BY pl.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(id, limitNum, offset);

  res.json({
    code: 0,
    data: {
      list: rows,
      total: countRow.total,
      page: Number(page),
      limit: limitNum,
    },
  });
}

// ============================================================
// 路由注册
// ============================================================

const router = express.Router();

// 所有路由需要 JWT 认证 + admin 权限
router.use(authRequired);
router.use(requireAdmin);

// 组织架构查询（必须放在 /:id 之前）
router.get('/regions', listRegions);
router.get('/cities', listCities);

// 用户 CRUD
router.get('/', listUsers);
router.post('/', createUser);
router.post('/batch', batchCreateUsers);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

// 积分管理
router.put('/:id/points', adjustPoints);
router.get('/:id/point-logs', getPointLogs);

// 分组 CRUD（挂载在 /users 路径下，实际路由为 /users/groups）
// 注意：/groups 路由需要放在 /:id 之前，否则会被 :id 匹配
router.get('/groups', listGroups);
router.post('/groups', createGroup);
router.put('/groups/:id', updateGroup);
router.delete('/groups/:id', deleteGroup);

// 批量删除
router.post('/batch-delete', (req, res) => {
  const db = req.db;
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供要删除的用户ID列表' });
  }
  const actor = getCurrentUser(db, req.user.id);
  let deleted = 0;
  for (const id of ids) {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (
      existing &&
      String(existing.id) !== String(req.user.id) &&
      canManageUser(db, actor, existing)
    ) {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      logActivity(db, req.user.id, 'batch_delete', 'user', id, `批量删除用户：${existing.username}`);
      deleted++;
    }
  }
  res.json({ code: 0, data: { deleted, total: ids.length } });
});

module.exports = router;
module.exports.logActivity = logActivity;
