/**
 * 操作审计日志路由（管理员专用）
 * 表: activity_logs, users
 */
const express = require('express');
const { formatShanghai, dateFilename } = require('../utils/time');
const router = express.Router();
const { authRequired, adminRequired, getOrgUserScope } = require('../middleware/auth');
const {
  MODULE_LABELS,
  ACTION_LABELS,
  NOISY_ACTIONS,
  normalizeLog,
} = require('../utils/logFormatter');

const BUSINESS_MODULES = ['auth', 'users', 'knowledge', 'questions', 'exams', 'courses', 'ai', 'training', 'submissions', 'checkin', 'shop', 'shares', 'announcements'];

/**
 * 把动作数组转成 SQL IN 参数
 */
function noisyActionSql() {
  return Array.from(NOISY_ACTIONS).map(() => '?').join(',');
}

function getFilters(query) {
  const { user_id, module, action, operator, start_date, end_date, date_from, date_to } = query;
  // 输入框粘贴时容易带入首尾空格 / Tab，直接拼进 LIKE 会导致搜不到，统一裁剪后再用
  const clean = (value) => (value == null ? '' : String(value).trim());
  const moduleName = clean(module);
  const actionName = clean(action);
  const operatorKeyword = clean(operator);
  const userId = clean(user_id);
  // 默认过滤掉高频噪声日志（learn/update_progress），需要可在 query 加 include_noisy=1 显示
  const includeNoisy = query.include_noisy === '1' || query.include_noisy === 'true';
  const conditions = [];
  if (!includeNoisy) {
    conditions.push(`(al.action IS NULL OR al.action NOT IN (${noisyActionSql()}))`);
  }
  const params = includeNoisy ? [] : Array.from(NOISY_ACTIONS);
  if (userId) { conditions.push('al.user_id = ?'); params.push(userId); }
  if (moduleName) { conditions.push('al.module = ?'); params.push(moduleName); }
  if (actionName) { conditions.push('al.action = ?'); params.push(actionName); }
  if (operatorKeyword) {
    conditions.push('(u.real_name LIKE ? OR u.username LIKE ?)');
    params.push(`%${operatorKeyword}%`, `%${operatorKeyword}%`);
  }
  const from = clean(start_date) || clean(date_from);
  const to = clean(end_date) || clean(date_to);
  if (from) { conditions.push('al.created_at >= ?'); params.push(from); }
  if (to) { conditions.push('al.created_at <= ?'); params.push(to + ' 23:59:59'); }
  return { whereClause: conditions.length ? conditions.join(' AND ') : '1=1', params };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function queryLogs(db, whereClause, params, limit, offset) {
  return db.prepare(`
    SELECT al.id, al.user_id, al.action, al.module, al.target_type,
           al.target_id, al.detail, al.ip, al.created_at,
           u.real_name as operator_name, u.username, u.avatar as operator_avatar
    FROM activity_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE ${whereClause}
    ORDER BY al.created_at DESC
    ${limit == null ? '' : 'LIMIT ? OFFSET ?'}
  `).all(...params, ...(limit == null ? [] : [limit, offset])).map(normalizeLog);
}

// GET /logs/modules - 返回当前有日志数据的业务板块
router.get('/modules', authRequired, adminRequired, (req, res) => {
  try {
    const includeNoisy = req.query.include_noisy === '1' || req.query.include_noisy === 'true';
    const noisyClause = includeNoisy ? '' : `AND (al.action IS NULL OR al.action NOT IN (${noisyActionSql()}))`;
    const noisyParams = includeNoisy ? [] : Array.from(NOISY_ACTIONS);
    const rows = req.db.prepare(`
      SELECT al.module, COUNT(*) AS count FROM activity_logs al
      WHERE al.module IN (${BUSINESS_MODULES.map(() => '?').join(',')})
        ${noisyClause}
      GROUP BY al.module ORDER BY count DESC
    `).all(...BUSINESS_MODULES, ...noisyParams);
    res.json({ code: 0, data: rows.map(row => ({
      value: row.module, label: MODULE_LABELS[row.module] || row.module, count: row.count
    })) });
  } catch (err) {
    console.error('[logs/modules] Error:', err);
    res.status(500).json({ code: 500, message: '获取日志模块失败' });
  }
});

// ==================== 日志列表 ====================

// GET /logs - 活动日志列表
router.get('/', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);
    const scope = getOrgUserScope(req.db, req.user, 'u');
    const filters = getFilters(req.query);
    const whereClause = `${filters.whereClause} AND ${scope.clause}`;
    const params = [...filters.params, ...scope.params];
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE ${whereClause}
    `).get(...params).count;
    const list = queryLogs(db, whereClause, params, limit, offset);

    res.json({
      code: 0,
      data: { list, total, page: parseInt(page), pageSize: limit }
    });
  } catch (err) {
    console.error('[logs/list] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 导出日志 ====================
router.get('/export', authRequired, adminRequired, (req, res) => {
  try {
    const filters = getFilters(req.query);
    const scope = getOrgUserScope(req.db, req.user, 'u');
    const whereClause = `${filters.whereClause} AND ${scope.clause}`;
    const params = [...filters.params, ...scope.params];
    const rows = queryLogs(req.db, whereClause, params, null, 0);
    const headers = ['时间', '操作人', '模块', '操作', '目标类型', '目标ID', '动作描述', '详情', 'IP地址'];
    const lines = [headers, ...rows.map(log => [
      log.created_at, log.operator_name || log.username || '', log.module_label,
      log.action_label, log.target_type_label, log.target_id || '',
      log.description,
      typeof log.detail === 'object' ? JSON.stringify(log.detail) : log.detail,
      log.ip
    ])].map(row => row.map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-logs-${dateFilename()}.csv"`);
    res.send('\ufeff' + lines.join('\n'));
  } catch (err) {
    console.error('[logs/export] Error:', err);
    res.status(500).json({ code: 500, message: '导出日志失败' });
  }
});

// ==================== 日志详情 ====================

// GET /logs/:id - 日志详情
router.get('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const scope = getOrgUserScope(req.db, req.user, 'u');

    const log = db.prepare(`
      SELECT al.id, al.user_id, al.action, al.module, al.target_type,
             al.target_id, al.detail, al.ip, al.created_at,
             u.real_name as operator_name, u.username, u.avatar as operator_avatar
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.id = ? AND ${scope.clause}
    `).get(id, ...scope.params);

    if (!log) {
      return res.status(404).json({ code: 404, message: '日志记录不存在' });
    }

    res.json({ code: 0, data: normalizeLog(log) });
  } catch (err) {
    console.error('[logs/detail] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
