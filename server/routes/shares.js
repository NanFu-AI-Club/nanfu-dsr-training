const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');
const { uploadToCOS } = require('../services/cos');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads', 'shares');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 jpg/png/gif/webp 格式图片'));
    }
  },
});

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ==================== 发布分享（支持多图上传） ====================
router.post('/', (req, res) => {
  upload.array('images', 9)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ code: 1, message: err.message || '上传失败' });
    }

    try {
      const { content } = req.body;
      const hasContent = content && content.trim();
      const hasImages = req.files && req.files.length > 0;

      if (!hasContent && !hasImages) {
        return res.status(400).json({ code: 1, message: '请输入内容或上传图片' });
      }

      const userId = req.user.id;
      const userName = req.user.real_name || req.user.username;
      let images = [];

      if (hasImages) {
        const results = await Promise.all(
          req.files.map(async (file, i) => {
            try {
              const result = await uploadToCOS(
                file.buffer, file.originalname, file.mimetype,
                null, userName,
                { baseFolder: '分享圈', index: i }
              );
              return result.url;
            } catch (e) {
              console.error('[Shares] COS 上传失败，回退本地:', e.message);
              const ext = path.extname(file.originalname);
              const filename = `${uuidv4()}${ext}`;
              fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
              return `/uploads/shares/${filename}`;
            }
          })
        );
        images = results;
      }

      const id = uuidv4();
      const db = req.db;
      const textContent = hasContent ? content.trim() : '';
      // 从数据库获取用户的真实分组（不依赖 JWT token）
      let userGroupId = null;
      let groupName = null;
      const userInfo = db.prepare('SELECT group_id FROM users WHERE id = ?').get(userId);
      if (userInfo && userInfo.group_id) {
        userGroupId = userInfo.group_id;
        const grp = db.prepare('SELECT name FROM groups WHERE id = ?').get(userGroupId);
        groupName = grp ? grp.name : null;
      }

      db.prepare(
        'INSERT INTO shares (id, user_id, content, images, group_id, group_name) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, userId, textContent, JSON.stringify(images), userGroupId, groupName);

      const share = db.prepare(`
        SELECT s.*, u.real_name, u.avatar
        FROM shares s JOIN users u ON s.user_id = u.id
        WHERE s.id = ?
      `).get(id);

      res.json({
        code: 0,
        data: { ...share, images: safeParseJSON(share.images, []), liked: false },
      });
    } catch (e) {
      console.error('[Shares] 发布失败:', e.message);
      res.status(500).json({ code: 1, message: '发布失败，请重试' });
    }
  });
});

// ==================== 获取分享列表 ====================
router.get('/', authRequired, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const groupId = req.query.group_id || null;

  let whereClause = 'WHERE s.deleted = 0';
  const condParams = [];

  if (groupId) {
    if (groupId === '__none__') {
      whereClause += ' AND s.group_id IS NULL';
    } else {
      whereClause += ' AND s.group_id = ?';
      condParams.push(groupId);
    }
  }

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM shares s ${whereClause}`
  ).get(...condParams).count;

  const shares = db.prepare(`
    SELECT s.*, u.real_name, u.avatar,
      COALESCE((SELECT COUNT(*) FROM share_likes sl WHERE sl.share_id = s.id), 0) as likes_count,
      (CASE WHEN EXISTS(SELECT 1 FROM share_likes sl WHERE sl.share_id = s.id AND sl.user_id = ?) THEN 1 ELSE 0 END) as liked
    FROM shares s
    JOIN users u ON s.user_id = u.id
    ${whereClause}
    ORDER BY s.is_pinned DESC, s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, ...condParams, limit, offset);

  res.json({
    code: 0,
    data: {
      list: shares.map(s => ({ ...s, images: safeParseJSON(s.images, []), liked: !!s.liked })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ==================== 获取分组列表（用于筛选） ====================
router.get('/groups', authRequired, (req, res) => {
  const db = req.db;
  const groups = db.prepare(`
    SELECT g.id, g.name, COUNT(u.id) as user_count
    FROM groups g
    LEFT JOIN users u ON u.group_id = g.id
    GROUP BY g.id
    ORDER BY g.name
  `).all();
  res.json({ code: 0, data: groups });
});

// ==================== 点赞/取消点赞 ====================
router.post('/:id/like', authRequired, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const shareId = req.params.id;

  const existing = db.prepare(
    'SELECT id FROM share_likes WHERE share_id = ? AND user_id = ?'
  ).get(shareId, userId);

  if (existing) {
    db.prepare('DELETE FROM share_likes WHERE share_id = ? AND user_id = ?').run(shareId, userId);
    db.prepare(
      'UPDATE shares SET likes_count = (SELECT COUNT(*) FROM share_likes WHERE share_id = ?) WHERE id = ?'
    ).run(shareId, shareId);
    return res.json({ code: 0, data: { liked: false } });
  }

  db.prepare('INSERT INTO share_likes (id, share_id, user_id) VALUES (?, ?, ?)').run(uuidv4(), shareId, userId);
  db.prepare(
    'UPDATE shares SET likes_count = (SELECT COUNT(*) FROM share_likes WHERE share_id = ?) WHERE id = ?'
  ).run(shareId, shareId);
  res.json({ code: 0, data: { liked: true } });
});

// ==================== 删除帖子（本人或管理员） ====================
router.delete('/:id', authRequired, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const shareId = req.params.id;

  const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(shareId);
  if (!share) {
    return res.status(404).json({ code: 1, message: '帖子不存在' });
  }
  if (share.user_id !== userId && req.user.role !== 'admin') {
    return res.status(403).json({ code: 1, message: '无权删除此帖子' });
  }

  db.prepare('UPDATE shares SET deleted = 1 WHERE id = ?').run(shareId);
  res.json({ code: 0, message: '删除成功' });
});

// ==================== 管理员：查看所有分享 ====================
router.get('/admin/list', authRequired, adminRequired, (req, res) => {
  const db = req.db;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const groupId = req.query.group_id || null;

  let whereClause = '';
  const condParams = [];

  if (groupId) {
    if (groupId === '__none__') {
      whereClause = 'WHERE s.group_id IS NULL';
    } else {
      whereClause = 'WHERE s.group_id = ?';
      condParams.push(groupId);
    }
  }

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM shares s ${whereClause}`
  ).get(...condParams).count;

  const shares = db.prepare(`
    SELECT s.*, u.real_name, u.username,
      COALESCE((SELECT COUNT(*) FROM share_likes sl WHERE sl.share_id = s.id), 0) as likes_count
    FROM shares s
    JOIN users u ON s.user_id = u.id
    ${whereClause}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...condParams, limit, offset);

  res.json({
    code: 0,
    data: {
      list: shares.map(s => ({ ...s, images: safeParseJSON(s.images, []) })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ==================== 管理员：置顶/取消置顶 ====================
router.post('/admin/:id/pin', authRequired, adminRequired, (req, res) => {
  const db = req.db;
  const shareId = req.params.id;

  const share = db.prepare('SELECT is_pinned FROM shares WHERE id = ?').get(shareId);
  if (!share) {
    return res.status(404).json({ code: 1, message: '帖子不存在' });
  }

  const newPin = share.is_pinned ? 0 : 1;
  db.prepare('UPDATE shares SET is_pinned = ? WHERE id = ?').run(newPin, shareId);
  res.json({ code: 0, data: { is_pinned: newPin } });
});

// ==================== 管理员：强制删除 ====================
router.delete('/admin/:id', authRequired, adminRequired, (req, res) => {
  const db = req.db;
  db.prepare('UPDATE shares SET deleted = 1 WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '删除成功' });
});

module.exports = router;
