/**
 * 公告 API
 * 表：announcements（公告本体）/ announcement_reads（每人已读状态）
 *
 * 管理端可发布「全员」或「指定大区」的公告；业务员端通过登录弹窗 + 公告列表页接收。
 * 公告不涉及积分，只做消息触达。
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { nowShanghaiString } = require('../utils/time');
const { authRequired, adminRequired, getAccessibleRegionIds } = require('../middleware/auth');

const router = express.Router();

function logActivity(db, userId, action, targetId, detail, ip) {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
    VALUES (?, ?, ?, 'announcements', 'announcement', ?, ?, ?)
  `).run(uuidv4(), userId, action, targetId, detail ? JSON.stringify(detail) : null, ip || null);
}

function isSystemAdmin(user) {
  return !!(user && (user.manager_type === 'system_admin' || !user.manager_type));
}

// 操作人可发布的大区 id 列表（大区 = level 1 的 region）
function actorAreaIds(db, actor) {
  if (isSystemAdmin(actor)) {
    return db.prepare("SELECT id FROM regions WHERE level = 1 AND status = 'active'").all().map(r => r.id);
  }
  const ids = getAccessibleRegionIds(db, actor);
  if (!ids.length) return [];
  const rows = db.prepare(
    `SELECT DISTINCT CASE WHEN level = 1 THEN id ELSE parent_id END AS area_id
     FROM regions WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
  return rows.map(r => r.area_id).filter(Boolean);
}

// 当前用户所属大区（用于判断公告是否发给他）
function getUserAreaId(db, userId) {
  const row = db.prepare(`
    SELECT CASE WHEN r.level = 1 THEN r.id ELSE r.parent_id END AS area_id
    FROM users u LEFT JOIN regions r ON r.id = u.region_id
    WHERE u.id = ?
  `).get(userId);
  return row ? row.area_id : null;
}

// 我可见的公告条件：已发布 +（全员 或 目标大区包含我的大区）
const VISIBLE_COND = `a.is_published = 1 AND (a.scope = 'all' OR EXISTS (
    SELECT 1 FROM json_each(a.target_areas) WHERE json_each.value = ?
  ))`;

// ==================== 管理端 ====================

// GET /announcements/admin/list — 全部公告（含草稿）
router.get('/admin/list', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const keyword = (req.query.keyword || '').trim();
    const status = req.query.status || '';

    let where = 'WHERE 1 = 1';
    const params = [];
    if (keyword) {
      where += ' AND (a.title LIKE ? OR a.content LIKE ?)';
      const like = `%${keyword}%`;
      params.push(like, like);
    }
    if (status === 'published') where += ' AND a.is_published = 1';
    if (status === 'draft') where += ' AND a.is_published = 0';

    const total = db.prepare(`SELECT COUNT(*) AS c FROM announcements a ${where}`).get(...params).c;
    const list = db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count
      FROM announcements a
      ${where}
      ORDER BY a.is_published DESC, COALESCE(a.published_at, a.created_at) DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ code: 0, data: { list: list.map(normalizeRow), total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[announcements/admin/list]', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// GET /announcements/admin/areas — 当前操作人可发布的大区（含名称）
router.get('/admin/areas', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const ids = actorAreaIds(db, req.user);
    if (!ids.length) return res.json({ code: 0, data: { areas: [], can_all: isSystemAdmin(req.user) } });
    const rows = db.prepare(
      `SELECT id, name FROM regions WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
    ).all(...ids);
    res.json({ code: 0, data: { areas: rows, can_all: isSystemAdmin(req.user) } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// POST /announcements — 新建公告
router.post('/', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!title) return res.status(400).json({ code: 1, message: '标题不能为空' });
    if (!content) return res.status(400).json({ code: 1, message: '内容不能为空' });

    const scope = req.body?.scope === 'areas' ? 'areas' : 'all';
    const areas = Array.isArray(req.body?.target_areas) ? req.body.target_areas.filter(Boolean) : [];

    if (scope === 'all' && !isSystemAdmin(req.user)) {
      return res.status(403).json({ code: 403, message: '仅系统管理员可发布全员公告' });
    }
    if (scope === 'areas') {
      if (!areas.length) return res.status(400).json({ code: 1, message: '请至少选择一个大区' });
      const allowed = actorAreaIds(db, req.user);
      if (areas.some(id => !allowed.includes(id))) {
        return res.status(403).json({ code: 403, message: '包含无权发布的大区' });
      }
    }

    const publish = req.body?.publish !== false; // 默认直接发布
    const now = nowShanghaiString();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO announcements (id, title, content, scope, target_areas, is_published, published_at, created_by, created_by_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, title, content, scope,
      scope === 'areas' ? JSON.stringify(areas) : null,
      publish ? 1 : 0, publish ? now : null,
      req.user.id, req.user.real_name || req.user.username || '', now, now
    );

    logActivity(db, req.user.id, 'create', id, { title, scope, areas, published: publish }, req.ip);
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    res.json({ code: 0, data: normalizeRow(row) });
  } catch (err) {
    console.error('[announcements/create]', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// PUT /announcements/:id — 编辑公告
router.put('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ code: 1, message: '公告不存在' });

    const title = String(req.body?.title ?? existing.title).trim();
    const content = String(req.body?.content ?? existing.content).trim();
    if (!title) return res.status(400).json({ code: 1, message: '标题不能为空' });
    if (!content) return res.status(400).json({ code: 1, message: '内容不能为空' });

    const scope = req.body?.scope === 'areas' ? 'areas' : (req.body?.scope === 'all' ? 'all' : existing.scope);
    const areas = Array.isArray(req.body?.target_areas)
      ? req.body.target_areas.filter(Boolean)
      : safeParseArray(existing.target_areas);

    if (scope === 'all' && !isSystemAdmin(req.user)) {
      return res.status(403).json({ code: 403, message: '仅系统管理员可发布全员公告' });
    }
    if (scope === 'areas') {
      if (!areas.length) return res.status(400).json({ code: 1, message: '请至少选择一个大区' });
      const allowed = actorAreaIds(db, req.user);
      if (areas.some(id => !allowed.includes(id))) {
        return res.status(403).json({ code: 403, message: '包含无权发布的大区' });
      }
    }

    db.prepare(`
      UPDATE announcements
      SET title = ?, content = ?, scope = ?, target_areas = ?, updated_at = ?
      WHERE id = ?
    `).run(title, content, scope, scope === 'areas' ? JSON.stringify(areas) : null, nowShanghaiString(), req.params.id);

    logActivity(db, req.user.id, 'update', req.params.id, { title, scope, areas }, req.ip);
    res.json({ code: 0, data: normalizeRow(db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id)) });
  } catch (err) {
    console.error('[announcements/update]', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// POST /announcements/:id/publish — 发布/撤回（body: { published: true|false }）
router.post('/:id/publish', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ code: 1, message: '公告不存在' });

    const published = req.body?.published !== false;
    const now = nowShanghaiString();
    db.prepare('UPDATE announcements SET is_published = ?, published_at = ?, updated_at = ? WHERE id = ?')
      .run(published ? 1 : 0, published ? (row.published_at || now) : null, now, req.params.id);

    logActivity(db, req.user.id, published ? 'publish' : 'unpublish', req.params.id, { title: row.title }, req.ip);
    res.json({ code: 0, data: { is_published: published ? 1 : 0 } });
  } catch (err) {
    console.error('[announcements/publish]', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// DELETE /announcements/:id — 删除公告（连同已读记录）
router.delete('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ code: 1, message: '公告不存在' });

    db.prepare('DELETE FROM announcement_reads WHERE announcement_id = ?').run(req.params.id);
    db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);

    logActivity(db, req.user.id, 'delete', req.params.id, { title: row.title }, req.ip);
    res.json({ code: 0 });
  } catch (err) {
    console.error('[announcements/delete]', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ==================== 业务员端 ====================

// GET /announcements/mine — 我可见的公告（分页，带已读状态）
router.get('/mine', authRequired, (req, res) => {
  try {
    const db = req.db;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const areaId = getUserAreaId(db, req.user.id) || '';

    const total = db.prepare(`SELECT COUNT(*) AS c FROM announcements a WHERE ${VISIBLE_COND}`).get(areaId).c;
    const list = db.prepare(`
      SELECT a.id, a.title, a.content, a.scope, a.target_areas, a.published_at, a.created_by_name,
             CASE WHEN ar.id IS NULL THEN 0 ELSE 1 END AS is_read
      FROM announcements a
      LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ?
      WHERE ${VISIBLE_COND}
      ORDER BY a.published_at DESC, a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, areaId, limit, offset);

    res.json({ code: 0, data: { list: list.map(normalizeRow), total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[announcements/mine]', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// GET /announcements/unread — 未读公告（登录弹窗用）
router.get('/unread', authRequired, (req, res) => {
  try {
    const db = req.db;
    const areaId = getUserAreaId(db, req.user.id) || '';
    const rows = db.prepare(`
      SELECT a.id, a.title, a.content, a.published_at
      FROM announcements a
      LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ?
      WHERE ${VISIBLE_COND} AND ar.id IS NULL
      ORDER BY a.published_at DESC
      LIMIT 10
    `).all(req.user.id, areaId);
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('[announcements/unread]', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// GET /announcements/unread-count — 未读数（红点用）
router.get('/unread-count', authRequired, (req, res) => {
  try {
    const db = req.db;
    const areaId = getUserAreaId(db, req.user.id) || '';
    const c = db.prepare(`
      SELECT COUNT(*) AS c FROM announcements a
      LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ?
      WHERE ${VISIBLE_COND} AND ar.id IS NULL
    `).get(req.user.id, areaId).c;
    res.json({ code: 0, data: { count: c } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// POST /announcements/read-all — 全部标记已读
router.post('/read-all', authRequired, (req, res) => {
  try {
    const db = req.db;
    const areaId = getUserAreaId(db, req.user.id) || '';
    const rows = db.prepare(`
      SELECT a.id FROM announcements a
      LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ?
      WHERE ${VISIBLE_COND} AND ar.id IS NULL
    `).all(req.user.id, areaId);
    const stmt = db.prepare('INSERT OR IGNORE INTO announcement_reads (id, announcement_id, user_id) VALUES (?, ?, ?)');
    for (const r of rows) stmt.run(uuidv4(), r.id, req.user.id);
    res.json({ code: 0, data: { marked: rows.length } });
  } catch (err) {
    console.error('[announcements/read-all]', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// POST /announcements/:id/read — 单条标记已读
router.post('/:id/read', authRequired, (req, res) => {
  try {
    const db = req.db;
    db.prepare('INSERT OR IGNORE INTO announcement_reads (id, announcement_id, user_id) VALUES (?, ?, ?)')
      .run(uuidv4(), req.params.id, req.user.id);
    res.json({ code: 0 });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ==================== 工具 ====================

function safeParseArray(v) {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function normalizeRow(row) {
  if (!row) return row;
  return { ...row, target_areas: safeParseArray(row.target_areas) };
}

module.exports = router;
