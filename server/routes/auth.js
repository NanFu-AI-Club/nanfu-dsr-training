/**
 * 认证路由: 登录 / 修改密码 / 获取当前用户
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { signToken, authRequired, getCurrentUser } = require('../middleware/auth');
const { loginLimiter, sanitizeInput } = require('../middleware/security');
const { v4: uuidv4 } = require('uuid');

// 密码强度验证
const validatePassword = (password) => {
  if (!password || password.length < 6) {
    return { valid: false, message: '密码长度至少6位' };
  }
  if (password.length > 50) {
    return { valid: false, message: '密码长度不能超过50位' };
  }
  return { valid: true };
};

// 用户名验证
const validateUsername = (username) => {
  if (!username || username.length < 2) {
    return { valid: false, message: '用户名长度至少2位' };
  }
  if (username.length > 50) {
    return { valid: false, message: '用户名长度不能超过50位' };
  }
  // 允许中文、字母、数字、下划线
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, message: '用户名只能包含中文、字母、数字、下划线' };
  }
  return { valid: true };
};

// POST /api/auth/login - 带速率限制
router.post('/login', loginLimiter(5, 60000), async (req, res) => {
  try {
    // 输入净化
    const { username, password } = sanitizeInput(req.body);

    // 输入验证
    const usernameCheck = validateUsername(username);
    if (!usernameCheck.valid) {
      return res.status(400).json({ code: 400, message: usernameCheck.message });
    }

    if (!password) {
      return res.status(400).json({ code: 400, message: '密码不能为空' });
    }

    // 查询用户
    const user = req.db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    // 防止时序攻击：无论用户是否存在，都执行 bcrypt（异步，避免阻塞事件循环）
    const dummyHash = '$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const hashToCompare = user ? user.password : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatch) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ code: 403, message: '账号已被禁用' });
    }

    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      real_name: user.real_name,
      group_id: user.group_id || null,
      manager_type: user.manager_type || null,
      region_id: user.region_id || null,
      city_id: user.city_id || null
    });

    const { password: _, ...safeUser } = user;

    // 日志异步写入
    setImmediate(() => {
      try {
        req.db.prepare(`
          INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
          VALUES (?,?,?,?,?,?,?,?)
        `).run(uuidv4(), user.id, 'login', 'auth', 'user', user.id, null, req.ip);
      } catch (e) {
        console.error('[login] log error:', e.message);
      }
    });

    res.json({ code: 0, data: { token, user: safeUser } });
  } catch (err) {
    console.error('[login] Error:', err);
    return res.status(500).json({ code: 500, message: '登录失败，请稍后重试' });
  }
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  const user = getCurrentUser(req.db, req.user.id);

  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  res.json({ code: 0, data: user });
});

// PUT /api/auth/password
router.put('/password', authRequired, async (req, res) => {
  try {
    const { old_password, new_password } = sanitizeInput(req.body);

    if (!old_password || !new_password) {
      return res.status(400).json({ code: 400, message: '旧密码和新密码不能为空' });
    }

    // 新密码强度验证
    const passwordCheck = validatePassword(new_password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ code: 400, message: passwordCheck.message });
    }

    const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!(await bcrypt.compare(old_password, user.password))) {
      return res.status(400).json({ code: 400, message: '旧密码错误' });
    }

    // 新密码不能与旧密码相同
    if (await bcrypt.compare(new_password, user.password)) {
      return res.status(400).json({ code: 400, message: '新密码不能与旧密码相同' });
    }

    const hashed = await bcrypt.hash(new_password, 12); // 增加哈希轮数

    req.db.prepare("UPDATE users SET password = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(hashed, req.user.id);

    res.json({ code: 0, message: '密码修改成功' });
  } catch (err) {
    console.error('[password] Error:', err);
    return res.status(500).json({ code: 500, message: '密码修改失败' });
  }
});

module.exports = router;