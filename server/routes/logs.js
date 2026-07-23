/**
 * 操作审计日志路由（管理员专用）
 * 表: activity_logs, users
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');

// ==================== 日志列表 ====================

// GET /logs - 活动日志列表
router.get('/', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const {
      page = 1,
      pageSize = 20,
      user_id,
      module,
      action,
      start_date,
      end_date
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const conditions = [];
    const params = [];

    // user_id 筛选
    if (user_id) {
      conditions.push('al.user_id = ?');
      params.push(user_id);
    }

    // module 筛选
    if (module) {
      conditions.push('al.module = ?');
      params.push(module);
    }

    // action 筛选
    if (action) {
      conditions.push('al.action = ?');
      params.push(action);
    }

    // date_range 筛选
    if (start_date) {
      conditions.push('al.created_at >= ?');
      params.push(start_date);
    }
    if (end_date) {
      conditions.push('al.created_at <= ?');
      params.push(end_date + ' 23:59:59');
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    // 总数
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM activity_logs al WHERE ${whereClause}
    `).get(...params).count;

    // 列表数据（JOIN users获取操作人姓名）
    const logs = db.prepare(`
      SELECT al.id, al.user_id, al.action, al.module, al.target_type,
             al.target_id, al.detail, al.ip, al.created_at,
             u.real_name as operator_name, u.avatar as operator_avatar
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const list = logs.map(log => ({
      ...log,
      detail: (() => {
        try { return JSON.parse(log.detail || '{}'); } catch (_) { return log.detail; }
      })()
    }));

    res.json({
      code: 0,
      data: { list, total, page: parseInt(page), pageSize: limit }
    });
  } catch (err) {
    console.error('[logs/list] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 日志详情 ====================

// GET /logs/:id - 日志详情
router.get('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const log = db.prepare(`
      SELECT al.id, al.user_id, al.action, al.module, al.target_type,
             al.target_id, al.detail, al.ip, al.created_at,
             u.real_name as operator_name, u.avatar as operator_avatar
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.id = ?
    `).get(id);

    if (!log) {
      return res.status(404).json({ code: 404, message: '日志记录不存在' });
    }

    res.json({
      code: 0,
      data: {
        ...log,
        detail: (() => {
          try { return JSON.parse(log.detail || '{}'); } catch (_) { return log.detail; }
        })()
      }
    });
  } catch (err) {
    console.error('[logs/detail] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
