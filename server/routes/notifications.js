/**
 * 用户通知 API
 * 表: user_notifications
 * 用途：管理员调整积分通知、系统消息等
 */
const express = require('express');
const router = express.Router();
const { authRequired } = require('../middleware/auth');

// GET /notifications/unread — 拉取未读通知（用于登录后弹窗）
router.get('/unread', authRequired, (req, res) => {
  try {
    const rows = req.db.prepare(
      `SELECT id, type, title, content, created_at
       FROM user_notifications
       WHERE user_id = ? AND is_read = 0
       ORDER BY created_at DESC
       LIMIT 20`
    ).all(req.user.id);
    res.json({ code: 0, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// GET /notifications/unread-count — 未读数量（红点用）
router.get('/unread-count', authRequired, (req, res) => {
  try {
    const row = req.db.prepare(
      'SELECT COUNT(*) AS c FROM user_notifications WHERE user_id = ? AND is_read = 0'
    ).get(req.user.id);
    res.json({ code: 0, data: { count: row ? row.c : 0 } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// GET /notifications — 全部通知（分页）
router.get('/', authRequired, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;
    const rows = req.db.prepare(
      `SELECT id, type, title, content, is_read, created_at
       FROM user_notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(req.user.id, pageSize, offset);
    const totalRow = req.db.prepare(
      'SELECT COUNT(*) AS c FROM user_notifications WHERE user_id = ?'
    ).get(req.user.id);
    res.json({ code: 0, data: { list: rows, total: totalRow ? totalRow.c : 0, page, pageSize } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// POST /notifications/read — 标记已读（传 ids 则只标记这些，不传则全部已读）
router.post('/read', authRequired, (req, res) => {
  try {
    const { ids } = req.body || {};
    if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      req.db.prepare(
        `UPDATE user_notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`
      ).run(req.user.id, ...ids);
    } else {
      req.db.prepare(
        'UPDATE user_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
      ).run(req.user.id);
    }
    res.json({ code: 0 });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

module.exports = router;
