/**
 * 认证路由: 登录 / 修改密码 / 获取当前用户
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { signToken, authRequired } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
  }
  const user = req.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ code: 401, message: '用户名或密码错误' });
  }
  if (user.status === 'inactive') {
    return res.status(403).json({ code: 403, message: '账号已被禁用' });
  }
  const token = signToken({ id: user.id, username: user.username, role: user.role, real_name: user.real_name });
  const { password: _, ...safeUser } = user;
  // 日志
  req.db.prepare(`INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
    .run(require('uuid').v4(), user.id, 'login', 'auth', 'user', user.id, null, req.ip);
  res.json({ code: 0, data: { token, user: safeUser } });
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  const user = req.db.prepare('SELECT id, username, real_name, role, phone, email, group_id, avatar, status, points, created_at, updated_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
  res.json({ code: 0, data: user });
});

// PUT /api/auth/password
router.put('/password', authRequired, (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ code: 400, message: '旧密码和新密码不能为空' });
  }
  const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(old_password, user.password)) {
    return res.status(400).json({ code: 400, message: '旧密码错误' });
  }
  req.db.prepare('UPDATE users SET password = ?, updated_at = datetime("now","localtime") WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ code: 0, message: '密码修改成功' });
});

module.exports = router;
