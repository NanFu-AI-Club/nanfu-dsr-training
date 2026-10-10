const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired, getOrgUserScope } = require('../middleware/auth');
const { applyLevelBonus } = require('../utils/points');
const { uploadToCOS } = require('../services/cos');
const { saveDb } = require('../database');

const router = express.Router();

function logActivity(db, userId, action, targetType, targetId, detail, ip) {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, action, 'shares', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
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
    console.error('[shares] 通知写入失败:', e.message);
  }
}

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

function getShareSettings(db) {
  const rows = db.prepare("SELECT key, value FROM app_settings WHERE key IN ('share_min_length', 'share_blocked_keywords')").all();
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    minLength: Math.max(0, parseInt(settings.share_min_length, 10) || 0),
    blockedKeywords: (settings.share_blocked_keywords || '').split(/[，,\\n、]+/).map((word) => word.trim()).filter(Boolean),
  };
}

function getShareSettingsPayload(db) {
  const settings = getShareSettings(db);
  return {
    min_length: settings.minLength,
    blocked_keywords: settings.blockedKeywords.join('\\n'),
  };
}

function revokeSharePoints(db, share) {
  const reward = db.prepare(`
    SELECT points
    FROM point_logs
    WHERE user_id = ? AND source_type = 'share_post' AND source_id = ? AND points > 0
    ORDER BY created_at ASC
    LIMIT 1
  `).get(share.user_id, share.id);

  if (!reward || !reward.points) return 0;

  const revoked = db.prepare(`
    SELECT id
    FROM point_logs
    WHERE user_id = ? AND source_type = 'share_post_delete' AND source_id = ?
    LIMIT 1
  `).get(share.user_id, share.id);

  if (revoked) return 0;

  const amount = Number(reward.points);
  const user = db.prepare('SELECT points, total_earned_points FROM users WHERE id = ?').get(share.user_id);
  if (!user) return 0;

  const balanceDeduction = Math.min(Math.max(Number(user.points) || 0, 0), amount);
  db.prepare(`
    UPDATE users
    SET points = MAX(0, points - ?),
        total_earned_points = MAX(0, total_earned_points - ?),
        updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(balanceDeduction, amount, share.user_id);

  db.prepare(`
    INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
    VALUES (?, ?, ?, ?, 'share_post_delete', ?, datetime('now','localtime'))
  `).run(uuidv4(), share.user_id, -amount, '删除分享圈内容，扣回发帖积分', share.id);

  return balanceDeduction;
}

// ==================== 分享圈规则配置 ====================
router.get('/settings', (req, res) => {
  res.json({ code: 0, data: getShareSettingsPayload(req.db) });
});

router.put('/settings', authRequired, adminRequired, (req, res) => {
  const minLength = Math.max(0, Math.min(10000, parseInt(req.body.min_length, 10) || 0));
  const blockedKeywords = typeof req.body.blocked_keywords === 'string' ? req.body.blocked_keywords.trim() : '';
  req.db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('share_min_length', ?, datetime('now','localtime'))").run(String(minLength));
  req.db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('share_blocked_keywords', ?, datetime('now','localtime'))").run(blockedKeywords);
  saveDb();
  res.json({ code: 0, message: '分享圈规则已保存', data: getShareSettingsPayload(req.db) });
});

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

      const settings = getShareSettings(req.db);
      const textContent = hasContent ? content.trim() : '';
      if (settings.minLength > 0 && textContent.length < settings.minLength) {
        return res.status(400).json({ code: 1, message: `分享内容至少需要 ${settings.minLength} 个字` });
      }
      const matchedKeyword = settings.blockedKeywords.find((keyword) => textContent.includes(keyword));
      if (matchedKeyword) {
        return res.status(400).json({ code: 1, message: '内容包含不允许发布的关键词，请修改后重试' });
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

      db.prepare(
        'INSERT INTO shares (id, user_id, content, images) VALUES (?, ?, ?, ?)'
      ).run(id, userId, textContent, JSON.stringify(images));

      logActivity(db, userId, 'create', 'share', id, { content_length: textContent.length, image_count: images.length }, req.ip);

      // 发放分享圈积分：每日上限与次数上限均可在后台「积分规则」配置（0 表示不限制）
      const DEFAULT_DAILY_POINT_LIMIT = 20;
      const DEFAULT_DAILY_MAX_TIMES = 2;
      let dailyPointLimit = DEFAULT_DAILY_POINT_LIMIT;
      let dailyMaxTimes = DEFAULT_DAILY_MAX_TIMES;
      let earnedPoints = 0;
      let dailyEarned = 0;
      let dailyTimes = 0;
      let perPostPoints = 10;
      try {
        const ruleRow = db.prepare('SELECT points, daily_limit, daily_max_times FROM point_rules WHERE source_type = ? AND enabled = 1').get('share_post');
        if (ruleRow) {
          if (ruleRow.points > 0) perPostPoints = ruleRow.points;
          dailyPointLimit = Number(ruleRow.daily_limit) > 0 ? Number(ruleRow.daily_limit) : Infinity;
          dailyMaxTimes = Number(ruleRow.daily_max_times) > 0 ? Number(ruleRow.daily_max_times) : Infinity;
        }

        const todayRow = db.prepare(
          `SELECT COALESCE(SUM(points), 0) AS total, COUNT(*) AS times
           FROM point_logs
           WHERE user_id = ? AND source_type = 'share_post' AND date(created_at) = date('now','localtime')`
        ).get(userId);
        dailyEarned = todayRow ? Number(todayRow.total) : 0;
        dailyTimes = todayRow ? Number(todayRow.times) : 0;

        if (dailyEarned < dailyPointLimit && dailyTimes < dailyMaxTimes) {
          const base = Math.min(perPostPoints, dailyPointLimit - dailyEarned);
          // 等级加成后再受每日上限约束
          const { awarded: boosted } = applyLevelBonus(db, userId, base);
          const give = Math.max(0, Math.min(boosted, dailyPointLimit - dailyEarned));
          if (give > 0) {
            db.prepare(`
              INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
            `).run(uuidv4(), userId, give, '分享圈发帖', 'share_post', id);
            db.prepare("UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ?, updated_at = datetime('now','localtime') WHERE id = ?")
              .run(give, give, userId);
            earnedPoints = give;
            dailyEarned += give;
            dailyTimes += 1;
          }
        }
      } catch (e) {
        console.error('[Shares] 分享积分发放失败:', e.message);
      }

      const share = db.prepare(`
        SELECT s.*, u.real_name, u.avatar
        FROM shares s JOIN users u ON s.user_id = u.id
        WHERE s.id = ?
      `).get(id);

      res.json({
        code: 0,
        data: {
          ...share,
          images: safeParseJSON(share.images, []),
          liked: false,
          earned_points: earnedPoints,
          daily_earned: dailyEarned,
          daily_limit: dailyPointLimit === Infinity ? 0 : dailyPointLimit,
        },
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
  const areaId = req.query.area_id || null;

  let whereClause = 'WHERE s.deleted = 0';
  const condParams = [];

  // 按所属大区筛选：用户 region_id 可能是大区(level 1)或细分区域(level 2)，统一映射到大区 id
  if (areaId) {
    whereClause += ' AND (CASE WHEN ur.level = 1 THEN ur.id ELSE ur.parent_id END) = ?';
    condParams.push(areaId);
  }

  const total = db.prepare(
    `SELECT COUNT(*) as count
     FROM shares s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN regions ur ON ur.id = u.region_id
     ${whereClause}`
  ).get(...condParams).count;

  const shares = db.prepare(`
    SELECT s.*, u.real_name, u.avatar,
      (CASE WHEN ur.level = 1 THEN ur.name ELSE parent_ur.name END) as area_name,
      COALESCE((SELECT COUNT(*) FROM share_likes sl WHERE sl.share_id = s.id), 0) as likes_count,
      (CASE WHEN EXISTS(SELECT 1 FROM share_likes sl WHERE sl.share_id = s.id AND sl.user_id = ?) THEN 1 ELSE 0 END) as liked,
      (SELECT GROUP_CONCAT(COALESCE(u2.real_name, u2.username), '||') FROM share_likes sl JOIN users u2 ON u2.id = sl.user_id WHERE sl.share_id = s.id) as likers
    FROM shares s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN regions ur ON ur.id = u.region_id
    LEFT JOIN regions parent_ur ON parent_ur.id = ur.parent_id
    ${whereClause}
    ORDER BY s.is_pinned DESC, s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, ...condParams, limit, offset);

  res.json({
    code: 0,
    data: {
      list: shares.map(s => ({
        ...s,
        images: safeParseJSON(s.images, []),
        liked: !!s.liked,
        likers: s.likers ? s.likers.split('||').filter(Boolean) : [],
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ==================== 获取分组列表（用于筛选，已废弃，保留兼容） ====================
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

// ==================== 获取大区列表（用于筛选） ====================
router.get('/areas', authRequired, (req, res) => {
  const db = req.db;
  const areas = db.prepare(`
    SELECT id, name
    FROM regions
    WHERE level = 1
    ORDER BY sort_order, name
  `).all();
  res.json({ code: 0, data: areas });
});

// ==================== 我的分享（个人主页） ====================
router.get('/mine', authRequired, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = db.prepare(
    'SELECT COUNT(*) as count FROM shares s WHERE s.user_id = ? AND s.deleted = 0'
  ).get(userId).count;

  const shares = db.prepare(`
    SELECT s.*, u.real_name, u.avatar,
      (CASE WHEN ur.level = 1 THEN ur.name ELSE parent_ur.name END) as area_name,
      COALESCE((SELECT COUNT(*) FROM share_likes sl WHERE sl.share_id = s.id), 0) as likes_count,
      (CASE WHEN EXISTS(SELECT 1 FROM share_likes sl WHERE sl.share_id = s.id AND sl.user_id = ?) THEN 1 ELSE 0 END) as liked,
      (SELECT GROUP_CONCAT(COALESCE(u2.real_name, u2.username), '||') FROM share_likes sl JOIN users u2 ON u2.id = sl.user_id WHERE sl.share_id = s.id) as likers
    FROM shares s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN regions ur ON ur.id = u.region_id
    LEFT JOIN regions parent_ur ON parent_ur.id = ur.parent_id
    WHERE s.user_id = ? AND s.deleted = 0
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, userId, limit, offset);

  res.json({
    code: 0,
    data: {
      list: shares.map(s => ({
        ...s,
        images: safeParseJSON(s.images, []),
        liked: !!s.liked,
        likers: s.likers ? s.likers.split('||').filter(Boolean) : [],
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    },
  });
});

// ==================== 消息通知列表 ====================
router.get('/notifications', authRequired, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const unread = db.prepare(
    'SELECT COUNT(*) as count FROM share_notifications WHERE user_id = ? AND is_read = 0'
  ).get(userId).count;

  const total = db.prepare(
    'SELECT COUNT(*) as count FROM share_notifications WHERE user_id = ?'
  ).get(userId).count;

  const list = db.prepare(`
    SELECT n.*, s.content as share_content
    FROM share_notifications n
    LEFT JOIN shares s ON s.id = n.share_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  res.json({
    code: 0,
    data: { list, unread_count: unread, total, page, limit, totalPages: Math.ceil(total / limit) },
  });
});

// ==================== 标记消息已读 ====================
router.post('/notifications/read', authRequired, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  db.prepare('UPDATE share_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
  try { saveDb(true); } catch (e) { /* ignore */ }
  res.json({ code: 0, message: '已读' });
});

// ==================== 点赞/取消点赞 ====================
router.post('/:id/like', authRequired, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const shareId = req.params.id;
  const actorName = req.user.real_name || req.user.username || '用户';

  const existing = db.prepare(
    'SELECT id FROM share_likes WHERE share_id = ? AND user_id = ?'
  ).get(shareId, userId);

  if (existing) {
    db.prepare('DELETE FROM share_likes WHERE share_id = ? AND user_id = ?').run(shareId, userId);
    db.prepare(
      'UPDATE shares SET likes_count = (SELECT COUNT(*) FROM share_likes WHERE share_id = ?) WHERE id = ?'
    ).run(shareId, shareId);
    // 取消点赞时删除对应通知
    db.prepare('DELETE FROM share_notifications WHERE share_id = ? AND actor_id = ? AND type = ?').run(shareId, userId, 'like');
    logActivity(db, userId, 'unlike', 'share', shareId, null, req.ip);
    return res.json({ code: 0, data: { liked: false } });
  }

  db.prepare('INSERT INTO share_likes (id, share_id, user_id) VALUES (?, ?, ?)').run(uuidv4(), shareId, userId);
  db.prepare(
    'UPDATE shares SET likes_count = (SELECT COUNT(*) FROM share_likes WHERE share_id = ?) WHERE id = ?'
  ).run(shareId, shareId);

  // 点赞通知：通知分享作者（自己赞自己不通知）
  const share = db.prepare('SELECT user_id FROM shares WHERE id = ?').get(shareId);
  if (share && share.user_id !== userId) {
    db.prepare(`
      INSERT INTO share_notifications (id, user_id, actor_id, actor_name, type, share_id, is_read, created_at)
      VALUES (?, ?, ?, ?, 'like', ?, 0, datetime('now','localtime'))
    `).run(uuidv4(), share.user_id, userId, actorName, shareId);
  }

  logActivity(db, userId, 'like', 'share', shareId, null, req.ip);

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

  const result = db.prepare('UPDATE shares SET deleted = 1 WHERE id = ? AND deleted = 0').run(shareId);
  if (!result.changes) {
    return res.status(404).json({ code: 1, message: '帖子已删除' });
  }

  const pointsRevoked = revokeSharePoints(db, share);
  logActivity(db, userId, 'delete', 'share', shareId, { points_revoked: pointsRevoked }, req.ip);

  // 通知作者（本人删自己的内容无需通知）
  if (share.user_id !== userId) {
    const raw = String(share.content || '').trim();
    const excerpt = raw ? `「${raw.slice(0, 30)}${raw.length > 30 ? '…' : ''}」` : '';
    notifyUser(db, share.user_id, 'share_deleted', '你的分享被删除',
      `你发布的分享${excerpt}已被删除${pointsRevoked > 0 ? `，并扣回 ${pointsRevoked} 积分` : ''}。`);
  }

  try { saveDb(true); } catch (e) { /* ignore */ }
  res.json({ code: 0, message: '删除成功', data: { points_revoked: pointsRevoked } });
});

// ==================== 管理员：查看所有分享 ====================
router.get('/admin/list', authRequired, adminRequired, (req, res) => {
  const db = req.db;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const areaId = req.query.area_id || null;
  const pinnedOnly = req.query.pinned === '1';

  const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const scope = getOrgUserScope(db, actor, 'u');
  let whereClause = `WHERE ${scope.clause}`;
  const condParams = [...scope.params];

  if (areaId) {
    whereClause += ' AND (CASE WHEN ur.level = 1 THEN ur.id ELSE ur.parent_id END) = ?';
    condParams.push(areaId);
  }

  if (pinnedOnly) {
    whereClause += ' AND s.is_pinned = 1';
  }

  // 搜索：按发布人（姓名/工号）或内容
  const keyword = (req.query.keyword || '').trim();
  if (keyword) {
    const like = `%${keyword}%`;
    whereClause += ' AND (u.real_name LIKE ? OR u.username LIKE ? OR s.content LIKE ?)';
    condParams.push(like, like, like);
  }

  // 只看某个人的全部发布
  const authorId = req.query.user_id || null;
  if (authorId) {
    whereClause += ' AND s.user_id = ?';
    condParams.push(authorId);
  }

  // #region debug-point share-admin-list
  if (process.env.DEBUG_SERVER_URL) fetch(process.env.DEBUG_SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'share-circle-500', location: 'server/routes/shares.js:admin-list', msg: 'share admin list query', data: { whereClause, paramCount: condParams.length, managerType: actor?.manager_type || null }, ts: Date.now() })
  }).catch(() => {});
  // #endregion

  const total = db.prepare(
    `SELECT COUNT(*) as count
     FROM shares s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN regions ur ON ur.id = u.region_id
     ${whereClause}`
  ).get(...condParams).count;

  const shares = db.prepare(`
    SELECT s.*, u.real_name, u.username,
      (CASE WHEN ur.level = 1 THEN ur.name ELSE parent_ur.name END) as area_name,
      COALESCE((SELECT COUNT(*) FROM share_likes sl WHERE sl.share_id = s.id), 0) as likes_count
    FROM shares s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN regions ur ON ur.id = u.region_id
    LEFT JOIN regions parent_ur ON parent_ur.id = ur.parent_id
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

  const scope = getOrgUserScope(db, req.user, 'u');
  const share = db.prepare(`SELECT s.is_pinned, s.user_id FROM shares s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND ${scope.clause}`).get(shareId, ...scope.params);
  if (!share) {
    return res.status(404).json({ code: 1, message: '帖子不存在' });
  }

  const newPin = share.is_pinned ? 0 : 1;
  db.prepare('UPDATE shares SET is_pinned = ? WHERE id = ?').run(newPin, shareId);

  // 置顶额外奖励帖子作者积分（同一帖子只奖励一次）
  let pinPoints = 0;
  if (newPin === 1) {
    try {
      const alreadyAwarded = db.prepare(
        "SELECT id FROM point_logs WHERE source_type = 'share_pin' AND source_id = ?"
      ).get(shareId);
      if (!alreadyAwarded) {
        const ruleRow = db.prepare("SELECT points FROM point_rules WHERE source_type = 'share_pin' AND enabled = 1").get();
        const basePin = ruleRow && ruleRow.points > 0 ? ruleRow.points : 50;
        const { awarded: boostedPin } = applyLevelBonus(db, share.user_id, basePin);
        pinPoints = boostedPin;
        db.prepare(`
          INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
        `).run(uuidv4(), share.user_id, pinPoints, '分享圈内容被置顶', 'share_pin', shareId);
        db.prepare("UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ?, updated_at = datetime('now','localtime') WHERE id = ?")
          .run(pinPoints, pinPoints, share.user_id);
      }
    } catch (e) {
      console.error('[Shares] 置顶奖励发放失败:', e.message);
    }
  }

  logActivity(db, req.user.id, newPin ? 'pin' : 'unpin', 'share', shareId, null, req.ip);
  res.json({ code: 0, data: { is_pinned: newPin, earned_points: pinPoints } });
});

// ==================== 管理员：强制删除 ====================
router.delete('/admin/:id', authRequired, adminRequired, (req, res) => {
  const db = req.db;
  const scope = getOrgUserScope(db, req.user, 'u');
  const share = db.prepare(`
    SELECT s.*
    FROM shares s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.deleted = 0 AND ${scope.clause}
  `).get(req.params.id, ...scope.params);
  if (!share) return res.status(404).json({ code: 1, message: '帖子不存在或无权操作' });

  db.prepare('UPDATE shares SET deleted = 1 WHERE id = ? AND deleted = 0').run(share.id);
  const pointsRevoked = revokeSharePoints(db, share);
  logActivity(db, req.user.id, 'delete', 'share', share.id, { by: 'admin', points_revoked: pointsRevoked }, req.ip);

  // 通知作者（管理员删自己发的内容无需通知）
  if (share.user_id !== req.user.id) {
    const raw = String(share.content || '').trim();
    const excerpt = raw ? `「${raw.slice(0, 30)}${raw.length > 30 ? '…' : ''}」` : '';
    notifyUser(db, share.user_id, 'share_deleted', '你的分享被删除',
      `你发布的分享${excerpt}已被管理员删除${pointsRevoked > 0 ? `，并扣回 ${pointsRevoked} 积分` : ''}。`);
  }

  try { saveDb(true); } catch (e) { /* ignore */ }
  res.json({ code: 0, message: '删除成功', data: { points_revoked: pointsRevoked } });
});

// ==================== 获取评论列表（含二级回复） ====================
router.get('/:id/comments', authRequired, (req, res) => {
  const db = req.db;
  const shareId = req.params.id;

  const share = db.prepare('SELECT id FROM shares WHERE id = ? AND deleted = 0').get(shareId);
  if (!share) {
    return res.status(404).json({ code: 1, message: '帖子不存在' });
  }

  const comments = db.prepare(`
    SELECT c.id, c.share_id, c.user_id, c.parent_id, c.reply_to_user_id, c.reply_to_user_name,
           c.content, c.created_at,
           u.real_name, u.username, u.avatar
    FROM share_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.share_id = ?
    ORDER BY c.created_at ASC
  `).all(shareId);

  res.json({ code: 0, data: { list: comments, total: comments.length } });
});

// ==================== 发表评论 / 回复 ====================
router.post('/:id/comments', authRequired, (req, res) => {
  const db = req.db;
  const shareId = req.params.id;
  const userId = req.user.id;
  const actorName = req.user.real_name || req.user.username || '用户';
  const { content, parent_id, reply_to_user_id, reply_to_user_name } = req.body || {};

  const text = (content || '').trim();
  if (!text) {
    return res.status(400).json({ code: 1, message: '评论内容不能为空' });
  }
  if (text.length > 500) {
    return res.status(400).json({ code: 1, message: '评论内容最多 500 字' });
  }

  const share = db.prepare('SELECT id FROM shares WHERE id = ? AND deleted = 0').get(shareId);
  if (!share) {
    return res.status(404).json({ code: 1, message: '帖子不存在' });
  }

  // 如果是回复，校验 parent_id 合法性；且仅允许二级（若 parent 已是二级，则回复指向其一级）
  let actualParentId = null;
  let actualReplyUserId = reply_to_user_id || null;
  let actualReplyUserName = reply_to_user_name || null;
  if (parent_id) {
    const parent = db.prepare(
      'SELECT id, user_id, parent_id, share_id FROM share_comments WHERE id = ?'
    ).get(parent_id);
    if (!parent) {
      return res.status(400).json({ code: 1, message: '被回复的评论不存在' });
    }
    if (parent.share_id !== shareId) {
      return res.status(400).json({ code: 1, message: '被回复的评论不属于该帖子' });
    }
    if (parent.parent_id) {
      // 已是二级回复 → 归到其一级评论下
      actualParentId = parent.parent_id;
    } else {
      actualParentId = parent.id;
    }
    if (!actualReplyUserId) actualReplyUserId = parent.user_id;
    if (!actualReplyUserName) {
      const ru = db.prepare('SELECT real_name, username FROM users WHERE id = ?').get(parent.user_id);
      actualReplyUserName = ru ? (ru.real_name || ru.username) : null;
    }
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO share_comments (id, share_id, user_id, parent_id, reply_to_user_id, reply_to_user_name, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(id, shareId, userId, actualParentId, actualReplyUserId, actualReplyUserName, text);

  logActivity(db, userId, parent_id ? 'reply' : 'comment', 'share_comment', id, { share_id: shareId, content_length: text.length }, req.ip);

  db.prepare(
    'UPDATE shares SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = ?'
  ).run(shareId);

  // 通知逻辑
  const shareAuthor = db.prepare('SELECT user_id FROM shares WHERE id = ?').get(shareId);
  if (parent_id) {
    // 回复：通知被回复的人
    if (actualReplyUserId && actualReplyUserId !== userId) {
      db.prepare(`
        INSERT INTO share_notifications (id, user_id, actor_id, actor_name, type, share_id, comment_id, content, is_read, created_at)
        VALUES (?, ?, ?, ?, 'reply', ?, ?, ?, 0, datetime('now','localtime'))
      `).run(uuidv4(), actualReplyUserId, userId, actorName, shareId, id, text);
    }
    // 回复：同时通知分享作者（作者既不是回复人也不是被回复人时）
    if (shareAuthor && shareAuthor.user_id !== userId && shareAuthor.user_id !== actualReplyUserId) {
      db.prepare(`
        INSERT INTO share_notifications (id, user_id, actor_id, actor_name, type, share_id, comment_id, content, is_read, created_at)
        VALUES (?, ?, ?, ?, 'comment', ?, ?, ?, 0, datetime('now','localtime'))
      `).run(uuidv4(), shareAuthor.user_id, userId, actorName, shareId, id, text);
    }
  } else {
    // 一级评论：通知分享作者
    if (shareAuthor && shareAuthor.user_id !== userId) {
      db.prepare(`
        INSERT INTO share_notifications (id, user_id, actor_id, actor_name, type, share_id, comment_id, content, is_read, created_at)
        VALUES (?, ?, ?, ?, 'comment', ?, ?, ?, 0, datetime('now','localtime'))
      `).run(uuidv4(), shareAuthor.user_id, userId, actorName, shareId, id, text);
    }
  }

  const created = db.prepare(`
    SELECT c.id, c.share_id, c.user_id, c.parent_id, c.reply_to_user_id, c.reply_to_user_name,
           c.content, c.created_at,
           u.real_name, u.username, u.avatar
    FROM share_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(id);

  // 同步保存 DB 到磁盘
  try { saveDb(true); } catch (e) { /* ignore */ }

  res.json({ code: 0, data: created });
});

// ==================== 管理员删除评论（级联删除其子回复） ====================
router.delete('/comments/:commentId', authRequired, adminRequired, (req, res) => {
  const db = req.db;
  const commentId = req.params.commentId;
  const scope = getOrgUserScope(db, req.user, 'u');

  const comment = db.prepare(`
    SELECT sc.id, sc.share_id
    FROM share_comments sc
    JOIN shares s ON s.id = sc.share_id
    JOIN users u ON u.id = s.user_id
    WHERE sc.id = ? AND ${scope.clause}
  `).get(commentId, ...scope.params);
  if (!comment) {
    return res.status(404).json({ code: 1, message: '评论不存在' });
  }

  // 收集要删除的 id（自身 + 直接子回复）
  const children = db.prepare('SELECT id FROM share_comments WHERE parent_id = ?').all(commentId);
  const ids = [commentId, ...children.map(c => c.id)];
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM share_comments WHERE id IN (${placeholders})`).run(...ids);

  logActivity(db, req.user.id, 'delete', 'share_comment', commentId, { share_id: comment.share_id, deleted: ids.length }, req.ip);

  db.prepare(
    'UPDATE shares SET comments_count = MAX(0, COALESCE(comments_count, 0) - ?) WHERE id = ?'
  ).run(ids.length, comment.share_id);

  try { saveDb(true); } catch (e) { /* ignore */ }

  res.json({ code: 0, message: '删除成功', data: { deleted: ids.length } });
});

module.exports = router;
