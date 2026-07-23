const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');

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
function logActivity(db, userId, action, targetType, targetId, detail) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO activity_logs (id, user_id, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, action, targetType, targetId, detail || null, now);
}

// ============================================================
// 用户 CRUD
// ============================================================

/**
 * GET /users
 * 用户列表（分页、搜索、按分组筛选）
 */
function listUsers(req, res) {
  const db = req.db;
  const {
    page = 1,
    limit = 20,
    keyword = '',
    group_id = '',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const limitNum = Number(limit);

  let whereClauses = [];
  let params = [];

  if (keyword) {
    whereClauses.push('(u.username LIKE ? OR u.real_name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  if (group_id) {
    whereClauses.push('u.group_id = ?');
    params.push(group_id);
  }

  const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM users u ${whereSQL}`
  ).get(...params);

  const rows = db.prepare(
    `SELECT u.id, u.username, u.real_name, u.email, u.phone, u.role, u.points, u.group_id, u.status,
            g.name as group_name,
            u.created_at, u.updated_at
     FROM users u
     LEFT JOIN groups g ON g.id = u.group_id
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
  const { username, name, password, email, phone, role, group_id } = req.body;

  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '用户名和密码为必填项' });
  }

  // 检查用户名是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ code: 400, message: '用户名已存在' });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);

  db.prepare(
    `INSERT INTO users (id, username, real_name, password, email, phone, role, group_id, points, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, username, name || null, hashedPassword, email || null, phone || null,
        role || 'sales', group_id || null, 0, 'active', now, now);

  logActivity(db, req.user.id, 'create', 'user', id,
    `创建用户：${username}（${name || '未命名'}）`);

  const user = db.prepare(
    `SELECT u.id, u.username, u.real_name, u.email, u.phone, u.role, u.points, u.group_id, u.status,
            g.name as group_name, u.created_at, u.updated_at
     FROM users u LEFT JOIN groups g ON g.id = u.group_id
     WHERE u.id = ?`
  ).get(id);

  res.json({ code: 0, data: user });
}

/**
 * POST /users/batch
 * 批量导入用户
 * 请求体: { users: [{ username, real_name, password, role, group_id, phone, email }, ...] }
 */
function batchCreateUsers(req, res) {
  const db = req.db;
  const { users } = req.body;

  if (!users || !Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供用户数据' });
  }

  const results = { success: 0, skipped: 0, errors: [] };
  const now = new Date().toISOString();

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const username = u.username?.trim();
    const realName = u.real_name?.trim() || u.name?.trim() || username || '';
    const password = u.password?.trim();
    const role = u.role?.trim() || 'sales';
    const phone = u.phone?.trim() || null;
    const email = u.email?.trim() || null;
    let groupId = u.group_id || null;

    // 跳过空行
    if (!username) continue;

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

    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);

    db.prepare(
      `INSERT INTO users (id, username, real_name, password, email, phone, role, group_id, points, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, username, realName, hashedPassword, email, phone,
          role, groupId, 0, 'active', now, now);

    results.success++;
  }

  logActivity(db, req.user.id, 'batch_import', 'user', null,
    `批量导入用户：成功 ${results.success}，跳过 ${results.skipped}，失败 ${results.errors.length}`);

  res.json({ code: 0, data: results });
}

/**
 * PUT /users/:id
 * 更新用户
 */
function updateUser(req, res) {
  const db = req.db;
  const { id } = req.params;
  const { username, name, email, phone, role, group_id, status, password } = req.body;

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '用户不存在' });
  }

  // 如果修改了用户名，检查是否重复
  if (username && username !== existing.username) {
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (dup) {
      return res.status(400).json({ code: 400, message: '用户名已被占用' });
    }
  }

  const now = new Date().toISOString();

  const setClauses = [];
  const params = [];

  if (username !== undefined) { setClauses.push('username = ?'); params.push(username); }
  if (name !== undefined) { setClauses.push('real_name = ?'); params.push(name); }
  if (email !== undefined) { setClauses.push('email = ?'); params.push(email); }
  if (phone !== undefined) { setClauses.push('phone = ?'); params.push(phone); }
  if (role !== undefined) { setClauses.push('role = ?'); params.push(role); }
  if (group_id !== undefined) { setClauses.push('group_id = ?'); params.push(group_id); }
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
    `SELECT u.id, u.username, u.real_name, u.email, u.phone, u.role, u.points, u.group_id, u.status,
            g.name as group_name, u.created_at, u.updated_at
     FROM users u LEFT JOIN groups g ON g.id = u.group_id
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
  const rows = db.prepare(
    `SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) as user_count
     FROM groups g ORDER BY g.created_at DESC`
  ).all();

  res.json({ code: 0, data: rows });
}

/**
 * POST /groups
 * 创建分组
 */
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
  const now = new Date().toISOString();

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

  const now = new Date().toISOString();
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
  const { amount, reason } = req.body;

  if (amount === undefined || amount === null || isNaN(Number(amount))) {
    return res.status(400).json({ code: 400, message: '积分变动量（amount）为必填项且必须是数字' });
  }

  const changeAmount = Number(amount);
  if (changeAmount === 0) {
    return res.status(400).json({ code: 400, message: '积分变动量不能为0' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(400).json({ code: 400, message: '用户不存在' });
  }

  const newPoints = Number(user.points || 0) + changeAmount;
  if (newPoints < 0) {
    return res.status(400).json({ code: 400, message: '积分不足，操作后积分不能为负数' });
  }

  const now = new Date().toISOString();

  // 更新用户积分
  db.prepare('UPDATE users SET points = ?, updated_at = ? WHERE id = ?')
    .run(newPoints, now, id);

  // 写入积分流水
  const logId = uuidv4();
  db.prepare(
    `INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(logId, id, changeAmount, reason || null, 'manual_adjust', req.user.id, now);

  logActivity(db, req.user.id, 'adjust_points', 'user', id,
    `积分调整：${changeAmount > 0 ? '+' : ''}${changeAmount}，余额 ${newPoints}，原因：${reason || '无'}`);

  const updatedUser = db.prepare(
    `SELECT u.id, u.username, u.real_name, u.points, u.updated_at
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

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(400).json({ code: 400, message: '用户不存在' });
  }

  const countRow = db.prepare(
    'SELECT COUNT(*) as total FROM point_logs WHERE user_id = ?'
  ).get(id);

  const rows = db.prepare(
    `SELECT pl.*
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

module.exports = router;
module.exports.logActivity = logActivity;
