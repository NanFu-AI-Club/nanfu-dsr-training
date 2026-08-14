const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');
const { uploadToCOS, deleteFromCOS } = require('../services/cos');

const router = express.Router();

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

    const now = new Date().toISOString();
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
    `SELECT s.*, u.real_name, u.username
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

  let where = '1=1';
  const params = [];
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
    `SELECT COUNT(*) as total FROM submissions s WHERE ${where}`
  ).get(...params).total;

  // 各分类统计（全部投稿，不分用户）
  const catCounts = db.prepare(
    `SELECT category, COUNT(*) as count FROM submissions GROUP BY category`
  ).all();
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

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ code: 1, message: '状态值无效' });
  }

  const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!sub) {
    return res.status(404).json({ code: 1, message: '投稿不存在' });
  }

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE submissions SET status = ?, review_comment = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?'
  ).run(status, review_comment || null, req.user.id, now, now, req.params.id);

  // 审核通过给积分奖励（从积分规则读取配置）
  if (status === 'approved') {
    const rule = db.prepare("SELECT points FROM point_rules WHERE source_type = 'submission_approved' AND enabled = 1").get();
    const points = rule ? rule.points : 5;
    const pointsId = uuidv4();
    db.prepare(
      `INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
       VALUES (?, ?, ?, ?, 'submission', ?, ?)`
    ).run(pointsId, sub.user_id, points, '风采投稿审核通过', sub.id, now);
    db.prepare('UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ? WHERE id = ?').run(points, points, sub.user_id);
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
  res.json({ code: 0, message: '已删除' });
});

module.exports = router;
