const express = require('express');
const { nowShanghaiString } = require('../utils/time');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired, getOrgUserScope } = require('../middleware/auth');
const { applyLevelBonus } = require('../utils/points');
const { uploadToCOS, deleteFromCOS } = require('../services/cos');

const router = express.Router();

function logActivity(db, userId, action, targetType, targetId, detail, ip) {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, action, 'submissions', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
}

// 给指定用户写入一条站内通知（用户在登录后会看到弹窗）
function notifyUser(db, userId, type, title, content) {
  if (!userId) return;
  try {
    db.prepare(`
      INSERT INTO user_notifications (id, user_id, type, title, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 0, datetime('now','localtime'))
    `).run(uuidv4(), userId, type, title, content);
  } catch (e) {
    console.error('[submissions] 通知写入失败:', e.message);
  }
}

// 该投稿当前净发放的积分（发放 + 扣回）
function getNetAwardedPoints(db, submissionId, userId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(points), 0) AS net FROM point_logs
    WHERE source_id = ? AND user_id = ? AND source_type IN ('submission', 'submission_revoked')
  `).get(submissionId, userId);
  return Number(row?.net) || 0;
}

// 把已通过的投稿改为驳回时，扣回此前发放的奖励积分
function revokeSubmissionPoints(db, sub) {
  const net = getNetAwardedPoints(db, sub.id, sub.user_id);
  if (net <= 0) return 0;
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(sub.user_id);
  if (!user) return 0;
  const balanceDeduction = Math.min(Math.max(Number(user.points) || 0, 0), net);
  db.prepare(`
    UPDATE users
    SET points = MAX(0, points - ?),
        total_earned_points = MAX(0, total_earned_points - ?),
        updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(balanceDeduction, net, sub.user_id);
  db.prepare(`
    INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
    VALUES (?, ?, ?, ?, 'submission_revoked', ?, datetime('now','localtime'))
  `).run(uuidv4(), sub.user_id, -net, '投稿审核改为驳回，扣回奖励积分', sub.id);
  return balanceDeduction;
}

// 本地存储仍保留作为 COS 失败时的回退
const uploadDir = path.join(__dirname, '..', 'uploads', 'submissions');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 使用内存存储，上传后直接转存 COS
const memoryStorage = multer.memoryStorage();

const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 jpg/png/gif/webp/mp4/webm/mov 格式'));
    }
  },
});

// ==================== 业务员上传投稿 ====================
router.post('/', authRequired, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ code: 1, message: err.message || '上传失败' });
    }

    const { title, description, category, link_url } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ code: 1, message: '标题不能为空' });
    }

    // 文件和网盘链接至少提供一项
    if (!req.file && (!link_url || !link_url.trim())) {
      return res.status(400).json({ code: 1, message: '请上传文件或填写网盘链接' });
    }

    const now = nowShanghaiString();
    const id = uuidv4();

    let fileUrl = '';
    let type = 'link';
    let cosKey = null;

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      type = ['.mp4', '.webm', '.mov'].includes(ext) ? 'video' : 'image';

      // 优先上传到 COS
      try {
        const result = await uploadToCOS(req.file.buffer, req.file.originalname, req.file.mimetype, category, req.user.real_name);
        fileUrl = result.url;
        cosKey = result.key;
      } catch (cosErr) {
        console.error('[投稿] COS 上传失败，回退到本地存储:', cosErr.message);
        // COS 失败时回退到本地存储
        const filename = `sub_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
        const localPath = path.join(uploadDir, filename);
        fs.writeFileSync(localPath, req.file.buffer);
        fileUrl = `/uploads/submissions/${filename}`;
      }
    }

    const validCategories = ['sales_negotiation', 'store_sales', 'store_issues', 'customer_acquisition', 'ai_tools', 'other'];
    const cat = validCategories.includes(category) ? category : 'other';
    const cleanLinkUrl = link_url ? link_url.trim() : '';

    const db = req.db;
    db.prepare(
      `INSERT INTO submissions (id, user_id, title, description, type, file_url, category, link_url, cos_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(id, req.user.id, title.trim(), description || null, type, fileUrl, cat, cleanLinkUrl, cosKey, now, now);

    logActivity(db, req.user.id, 'create', 'submission', id, { title: title.trim(), category: cat, type }, req.ip);

    res.json({ code: 0, message: '投稿成功，等待审核', data: { id } });
  });
});

// ==================== 业务员查看自己的投稿 ====================
router.get('/my', authRequired, (req, res) => {
  const db = req.db;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const offset = (page - 1) * limit;
  const { category } = req.query;

  let where = 's.user_id = ?';
  const params = [req.user.id];
  if (category) { where += ' AND s.category = ?'; params.push(category); }

  const rows = db.prepare(
    `SELECT s.*, u.real_name, u.username,
            (SELECT COALESCE(SUM(pl.points), 0) FROM point_logs pl
             WHERE pl.source_id = s.id AND pl.source_type IN ('submission', 'submission_revoked')) AS awarded_points
      FROM submissions s LEFT JOIN users u ON s.reviewed_by = u.id
      WHERE ${where}
      ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) as total FROM submissions s WHERE ${where}`
  ).get(...params).total;

  // 各分类统计
  const catCounts = db.prepare(
    `SELECT category, COUNT(*) as count FROM submissions WHERE user_id = ? GROUP BY category`
  ).all(req.user.id);
  const stats = {};
  catCounts.forEach(c => { stats[c.category] = c.count; });
  let myTotal = 0;
  catCounts.forEach(c => { myTotal += c.count; });

  res.json({
    code: 0,
    data: { list: rows, total, page, limit, stats, myTotal },
  });
});

// ==================== 管理员查看所有投稿 ====================
router.get('/', authRequired, adminRequired, (req, res) => {
  const db = req.db;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;
  const { status, user_id, type, category } = req.query;
  const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const scope = getOrgUserScope(db, actor, 'u');

  let where = scope.clause;
  const params = [...scope.params];
  if (status) { where += ' AND s.status = ?'; params.push(status); }
  if (user_id) { where += ' AND s.user_id = ?'; params.push(user_id); }
  if (type) { where += ' AND s.type = ?'; params.push(type); }
  if (category) { where += ' AND s.category = ?'; params.push(category); }

  const rows = db.prepare(
    `SELECT s.*, u.real_name, u.username, r.real_name as reviewer_name
     FROM submissions s
     LEFT JOIN users u ON s.user_id = u.id
     LEFT JOIN users r ON s.reviewed_by = r.id
     WHERE ${where}
     ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) as total FROM submissions s JOIN users u ON s.user_id = u.id WHERE ${where}`
  ).get(...params).total;

  const catCounts = db.prepare(
    `SELECT s.category, COUNT(*) as count FROM submissions s JOIN users u ON s.user_id = u.id WHERE ${scope.clause} GROUP BY s.category`
  ).all(...scope.params);
  const stats = {};
  let allTotal = 0;
  catCounts.forEach(c => { stats[c.category] = c.count; allTotal += c.count; });

  res.json({
    code: 0,
    data: { list: rows, total, page, limit, stats, allTotal },
  });
});

// ==================== 管理员审核投稿 ====================
router.put('/:id/status', authRequired, adminRequired, (req, res) => {
  const db = req.db;
  const { status, review_comment } = req.body;

  // 区域经理（area_manager）仅可查看，无审核权限
  if (req.user.manager_type === 'area_manager') {
    return res.status(403).json({ code: 403, message: '区域经理无投稿审核权限' });
  }

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ code: 1, message: '状态值无效' });
  }

  const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const scope = getOrgUserScope(db, actor, 'u');
  const sub = db.prepare(`SELECT s.* FROM submissions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND ${scope.clause}`).get(req.params.id, ...scope.params);
  if (!sub) {
    return res.status(404).json({ code: 1, message: '投稿不存在' });
  }

  if (sub.status === status) {
    return res.json({ code: 0, message: status === 'approved' ? '该投稿已经审核通过' : '该投稿已经审核驳回' });
  }
  const now = nowShanghaiString();
  db.prepare(
    'UPDATE submissions SET status = ?, review_comment = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?'
  ).run(status, review_comment || null, req.user.id, now, now, req.params.id);

  // 审核通过给积分奖励（从积分规则读取配置），按净发放判断，避免重复发放
  let awardedPoints = 0;
  let revokedPoints = 0;
  if (status === 'approved') {
    if (getNetAwardedPoints(db, sub.id, sub.user_id) <= 0) {
      const rule = db.prepare("SELECT points FROM point_rules WHERE source_type = 'submission_approved' AND enabled = 1").get();
      const basePoints = rule ? rule.points : 5;
      const { awarded: points } = applyLevelBonus(db, sub.user_id, basePoints);
      awardedPoints = points;
      const pointsId = uuidv4();
      db.prepare(
        `INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
         VALUES (?, ?, ?, ?, 'submission', ?, ?)`
      ).run(pointsId, sub.user_id, points, '风采投稿审核通过', sub.id, now);
      db.prepare('UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ? WHERE id = ?').run(points, points, sub.user_id);
    }
  } else if (sub.status === 'approved') {
    // 已通过改为驳回：扣回此前发放的奖励积分
    revokedPoints = revokeSubmissionPoints(db, sub);
  }

  const logDetail = { title: sub.title, submitter_id: sub.user_id };
  if (status === 'approved') logDetail.points = awardedPoints;
  else if (revokedPoints > 0) logDetail.revoked_points = revokedPoints;

  logActivity(db, req.user.id, status === 'approved' ? 'approve' : 'reject', 'submission', sub.id, logDetail, req.ip);

  // 驳回时通知投稿人
  if (status === 'rejected') {
    const parts = [`你的投稿《${sub.title || '未命名'}》未通过审核`];
    if (review_comment) parts.push(`审核意见：${review_comment}`);
    if (revokedPoints > 0) parts.push(`此前发放的 ${revokedPoints} 积分已扣回`);
    notifyUser(db, sub.user_id, 'submission_rejected', '风采投稿未通过', parts.join('。') + '。');
  }

  res.json({ code: 0, message: status === 'approved' ? '已通过' : '已驳回' });
});

// ==================== 删除投稿 ====================
router.delete('/:id', authRequired, async (req, res) => {
  const db = req.db;
  const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!sub) {
    return res.status(404).json({ code: 1, message: '投稿不存在' });
  }

  // 业务员只能删自己的，管理员可以删任何
  if (req.user.role !== 'admin' && sub.user_id !== req.user.id) {
    return res.status(403).json({ code: 1, message: '无权删除' });
  }

  // 删除文件：优先从 COS 删除，否则从本地删除
  if (sub.cos_key) {
    try { await deleteFromCOS(sub.cos_key); } catch (e) { console.error('[投稿] COS 删除失败:', e.message); }
  } else if (sub.file_url && sub.file_url.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '..', sub.file_url);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  }

  db.prepare('DELETE FROM submissions WHERE id = ?').run(req.params.id);
  logActivity(db, req.user.id, 'delete', 'submission', sub.id, {
    title: sub.title,
    by: req.user.role === 'admin' ? 'admin' : 'self',
    submitter_id: sub.user_id,
  }, req.ip);
  res.json({ code: 0, message: '已删除' });
});

module.exports = router;
