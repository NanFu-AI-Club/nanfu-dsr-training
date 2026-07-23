/**
 * 课程管理与学习进度路由
 * 表: courses, learning_progress, roadmap_stages, user_roadmap_progress, point_logs, users
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');

// ==================== 辅助函数 ====================

function logActivity(db, userId, action, targetType, targetId, detail, ip) {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, action, 'courses', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
}

// ==================== 静态路由 (必须在 /:id 之前) ====================

// GET /courses - 课程列表，支持分页、type筛选、category筛选、keyword搜索
router.get('/', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { page = 1, pageSize = 20, type, category, keyword, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const conditions = [];
    const params = [];

    if (type) {
      conditions.push('c.type = ?');
      params.push(type);
    }
    if (category) {
      conditions.push('c.category = ?');
      params.push(category);
    }
    if (keyword) {
      conditions.push('(c.title LIKE ? OR c.description LIKE ? OR c.tags LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (status) {
      conditions.push('c.status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM courses c WHERE ${whereClause}
    `).get(...params).count;

    const courses = db.prepare(`
      SELECT c.*, u.real_name as creator_name
      FROM courses c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE ${whereClause}
      ORDER BY c.sort_order ASC, c.id ASC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const list = courses.map(c => ({
      ...c,
      tags: c.tags ? (() => { try { return JSON.parse(c.tags); } catch (_) { return []; } })() : []
    }));

    res.json({
      code: 0,
      data: { list, total, page: parseInt(page), pageSize: limit }
    });
  } catch (err) {
    console.error('[courses/list] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /courses - 创建课程（admin）
router.post('/', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { title, type, description, cover_url, resource_url, duration, category, tags, sort_order, status } = req.body;

    if (!title) {
      return res.status(400).json({ code: 400, message: '课程标题不能为空' });
    }
    if (!resource_url) {
      return res.status(400).json({ code: 400, message: '课程资源地址不能为空' });
    }

    const id = uuidv4();
    const parsedTags = tags ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : null;

    db.prepare(`
      INSERT INTO courses (id, title, type, description, cover_url, resource_url, duration, category, tags, sort_order, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      type || 'video',
      description || null,
      cover_url || null,
      resource_url,
      duration || 0,
      category || null,
      parsedTags,
      sort_order || 0,
      status || 'published',
      req.user.id
    );

    logActivity(db, req.user.id, 'create', 'course', id, { title, type: type || 'video' }, req.ip);

    res.json({ code: 0, message: '课程创建成功', data: { id } });
  } catch (err) {
    console.error('[courses/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /courses/my-progress - 当前用户学习进度列表
router.get('/my-progress', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;

    const progress = db.prepare(`
      SELECT lp.*, c.title as course_title, c.type as course_type, c.cover_url, c.duration,
             c.category, c.tags, c.resource_url
      FROM learning_progress lp
      JOIN courses c ON lp.course_id = c.id
      WHERE lp.user_id = ?
      ORDER BY lp.updated_at DESC
    `).all(userId);

    const totalCourses = db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get().count;
    const completedCourses = db.prepare(
      'SELECT COUNT(*) as count FROM learning_progress WHERE user_id = ? AND completed = 1'
    ).get(userId).count;

    const list = progress.map(p => ({
      ...p,
      tags: p.tags ? (() => { try { return JSON.parse(p.tags); } catch (_) { return []; } })() : [],
      completed: p.completed === 1
    }));

    res.json({
      code: 0,
      data: {
        list,
        total_courses: totalCourses,
        completed_courses: completedCourses,
        completion_rate: totalCourses > 0 ? Math.round((completedCourses / totalCourses) * 100) : 0
      }
    });
  } catch (err) {
    console.error('[courses/my-progress] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /courses/roadmap - 获取通关路线图
router.get('/roadmap', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;

    const stages = db.prepare(`
      SELECT * FROM roadmap_stages ORDER BY sort_order ASC, id ASC
    `).all();

    const result = stages.map(stage => {
      let requiredCourseIds = [];
      try { requiredCourseIds = JSON.parse(stage.required_courses || '[]'); } catch (_) { requiredCourseIds = []; }

      // 获取本阶段对应课程
      const courses = [];
      if (requiredCourseIds.length > 0) {
        const placeholders = requiredCourseIds.map(() => '?').join(',');
        const rows = db.prepare(`
          SELECT c.*, lp.progress, lp.watch_time, lp.completed, lp.updated_at as progress_updated_at
          FROM courses c
          LEFT JOIN learning_progress lp ON c.id = lp.course_id AND lp.user_id = ?
          WHERE c.id IN (${placeholders})
          ORDER BY c.sort_order ASC, c.id ASC
        `).all(userId, ...requiredCourseIds);

        for (const row of rows) {
          courses.push({
            id: row.id,
            title: row.title,
            type: row.type,
            description: row.description,
            cover_url: row.cover_url,
            resource_url: row.resource_url,
            duration: row.duration,
            tags: row.tags ? (() => { try { return JSON.parse(row.tags); } catch (_) { return []; } })() : [],
            progress: row.progress || 0,
            watch_time: row.watch_time || 0,
            completed: row.completed === 1,
            progress_updated_at: row.progress_updated_at || null
          });
        }
      }

      // 获取用户对该阶段的完成状态
      const userStage = db.prepare(`
        SELECT * FROM user_roadmap_progress WHERE user_id = ? AND stage_id = ?
      `).get(userId, stage.id);

      // 自动检测：如果 required_courses 全部完成，自动标记阶段为完成
      const allCompleted = requiredCourseIds.length > 0 && courses.every(c => c.completed);
      const stageCompleted = (userStage && userStage.completed === 1) || allCompleted;

      // 如果自动检测到全部完成但 DB 未记录，更新 DB
      if (allCompleted && (!userStage || userStage.completed === 0)) {
        if (userStage) {
          db.prepare(`
            UPDATE user_roadmap_progress SET completed = 1, completed_at = datetime('now','localtime')
            WHERE user_id = ? AND stage_id = ?
          `).run(userId, stage.id);
        } else {
          db.prepare(`
            INSERT INTO user_roadmap_progress (id, user_id, stage_id, completed, completed_at)
            VALUES (?, ?, ?, 1, datetime('now','localtime'))
          `).run(uuidv4(), userId, stage.id);
        }
      }

      return {
        id: stage.id,
        name: stage.name,
        description: stage.description,
        sort_order: stage.sort_order,
        required_courses: requiredCourseIds,
        courses,
        completed: stageCompleted,
        total_courses: requiredCourseIds.length,
        completed_courses: courses.filter(c => c.completed).length
      };
    });

    res.json({ code: 0, data: { stages: result } });
  } catch (err) {
    console.error('[courses/roadmap] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 通关路线图阶段 CRUD ====================

// GET /courses/roadmap-stages - 路线图阶段列表
router.get('/roadmap-stages', authRequired, (req, res) => {
  try {
    const db = req.db;
    const stages = db.prepare(`
      SELECT * FROM roadmap_stages ORDER BY sort_order ASC, id ASC
    `).all();

    const list = stages.map(s => ({
      ...s,
      required_courses: s.required_courses ? (() => { try { return JSON.parse(s.required_courses); } catch (_) { return []; } })() : []
    }));

    res.json({ code: 0, data: { list } });
  } catch (err) {
    console.error('[courses/roadmap-stages] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /courses/roadmap-stages - 创建路线图阶段（admin）
router.post('/roadmap-stages', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { name, description, sort_order, required_courses } = req.body;

    if (!name) {
      return res.status(400).json({ code: 400, message: '阶段名称不能为空' });
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO roadmap_stages (id, name, description, sort_order, required_courses)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      description || null,
      sort_order || 0,
      required_courses ? JSON.stringify(required_courses) : null
    );

    logActivity(db, req.user.id, 'create', 'roadmap_stage', id, { name }, req.ip);

    res.json({ code: 0, message: '路线图阶段创建成功', data: { id } });
  } catch (err) {
    console.error('[courses/roadmap-stages/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /courses/roadmap-stages/:stageId - 更新路线图阶段（admin）
router.put('/roadmap-stages/:stageId', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { stageId } = req.params;
    const { name, description, sort_order, required_courses } = req.body;

    const stage = db.prepare('SELECT * FROM roadmap_stages WHERE id = ?').get(stageId);
    if (!stage) {
      return res.status(404).json({ code: 404, message: '路线图阶段不存在' });
    }

    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
    if (required_courses !== undefined) {
      updates.push('required_courses = ?');
      params.push(JSON.stringify(required_courses));
    }

    if (updates.length > 0) {
      params.push(stageId);
      db.prepare(`UPDATE roadmap_stages SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    logActivity(db, req.user.id, 'update', 'roadmap_stage', stageId, { name: name || stage.name }, req.ip);

    res.json({ code: 0, message: '路线图阶段更新成功' });
  } catch (err) {
    console.error('[courses/roadmap-stages/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /courses/roadmap-stages/:stageId - 删除路线图阶段（admin）
router.delete('/roadmap-stages/:stageId', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { stageId } = req.params;

    const stage = db.prepare('SELECT * FROM roadmap_stages WHERE id = ?').get(stageId);
    if (!stage) {
      return res.status(404).json({ code: 404, message: '路线图阶段不存在' });
    }

    db.prepare('DELETE FROM user_roadmap_progress WHERE stage_id = ?').run(stageId);
    db.prepare('DELETE FROM roadmap_stages WHERE id = ?').run(stageId);

    logActivity(db, req.user.id, 'delete', 'roadmap_stage', stageId, { name: stage.name }, req.ip);

    res.json({ code: 0, message: '路线图阶段已删除' });
  } catch (err) {
    console.error('[courses/roadmap-stages/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /courses/roadmap-stages/:stageId/complete - 用户手动标记阶段完成
router.post('/roadmap-stages/:stageId/complete', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { stageId } = req.params;
    const userId = req.user.id;

    const stage = db.prepare('SELECT * FROM roadmap_stages WHERE id = ?').get(stageId);
    if (!stage) {
      return res.status(404).json({ code: 404, message: '路线图阶段不存在' });
    }

    // 检查 required_courses 是否全部完成
    let requiredCourseIds = [];
    try { requiredCourseIds = JSON.parse(stage.required_courses || '[]'); } catch (_) { requiredCourseIds = []; }

    if (requiredCourseIds.length > 0) {
      const placeholders = requiredCourseIds.map(() => '?').join(',');
      const completedCount = db.prepare(`
        SELECT COUNT(*) as count FROM learning_progress
        WHERE user_id = ? AND course_id IN (${placeholders}) AND completed = 1
      `).get(userId, ...requiredCourseIds).count;

      if (completedCount < requiredCourseIds.length) {
        return res.status(400).json({
          code: 400,
          message: `还有 ${requiredCourseIds.length - completedCount} 门必修课程未完成，无法标记阶段完成`
        });
      }
    }

    // 标记完成
    const existing = db.prepare(
      'SELECT * FROM user_roadmap_progress WHERE user_id = ? AND stage_id = ?'
    ).get(userId, stageId);

    if (existing) {
      db.prepare(`
        UPDATE user_roadmap_progress SET completed = 1, completed_at = datetime('now','localtime')
        WHERE user_id = ? AND stage_id = ?
      `).run(userId, stageId);
    } else {
      db.prepare(`
        INSERT INTO user_roadmap_progress (id, user_id, stage_id, completed, completed_at)
        VALUES (?, ?, ?, 1, datetime('now','localtime'))
      `).run(uuidv4(), userId, stageId);
    }

    logActivity(db, userId, 'complete_stage', 'roadmap_stage', stageId,
      { stage_name: stage.name }, req.ip);

    res.json({ code: 0, message: '阶段已标记完成', data: { stage_id: stageId, completed: true } });
  } catch (err) {
    console.error('[courses/roadmap-stages/complete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 动态路由 (/:id) ====================

// GET /courses/:id - 课程详情
router.get('/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const course = db.prepare(`
      SELECT c.*, u.real_name as creator_name
      FROM courses c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.id = ?
    `).get(id);

    if (!course) {
      return res.status(404).json({ code: 404, message: '课程不存在' });
    }

    // 同时获取当前用户的学习进度
    const progress = db.prepare(
      'SELECT * FROM learning_progress WHERE user_id = ? AND course_id = ?'
    ).get(req.user.id, id);

    res.json({
      code: 0,
      data: {
        ...course,
        tags: course.tags ? (() => { try { return JSON.parse(course.tags); } catch (_) { return []; } })() : [],
        learning_progress: progress ? {
          progress: progress.progress,
          watch_time: progress.watch_time,
          completed: progress.completed === 1,
          started_at: progress.started_at,
          completed_at: progress.completed_at,
          updated_at: progress.updated_at
        } : null
      }
    });
  } catch (err) {
    console.error('[courses/:id] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /courses/:id - 更新课程（admin）
router.put('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const fields = ['title', 'type', 'description', 'cover_url', 'resource_url', 'duration', 'category', 'tags', 'sort_order', 'status'];

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    if (!course) {
      return res.status(404).json({ code: 404, message: '课程不存在' });
    }

    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (field === 'tags') {
          updates.push('tags = ?');
          params.push(typeof req.body.tags === 'string' ? req.body.tags : JSON.stringify(req.body.tags));
        } else {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now','localtime')");
      params.push(id);
      db.prepare(`UPDATE courses SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    logActivity(db, req.user.id, 'update', 'course', id,
      { title: req.body.title || course.title, changed_fields: Object.keys(req.body) }, req.ip);

    res.json({ code: 0, message: '课程更新成功' });
  } catch (err) {
    console.error('[courses/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /courses/:id - 删除课程（admin）
router.delete('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    if (!course) {
      return res.status(404).json({ code: 404, message: '课程不存在' });
    }

    db.prepare('DELETE FROM learning_progress WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);

    logActivity(db, req.user.id, 'delete', 'course', id,
      { title: course.title }, req.ip);

    res.json({ code: 0, message: '课程已删除' });
  } catch (err) {
    console.error('[courses/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /courses/:id/progress - 获取当前用户对某课程的学习进度
router.get('/:id/progress', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const course = db.prepare('SELECT id, title, type, duration FROM courses WHERE id = ?').get(id);
    if (!course) {
      return res.status(404).json({ code: 404, message: '课程不存在' });
    }

    const progress = db.prepare(
      'SELECT * FROM learning_progress WHERE user_id = ? AND course_id = ?'
    ).get(req.user.id, id);

    res.json({
      code: 0,
      data: {
        course_id: id,
        course_title: course.title,
        course_type: course.type,
        duration: course.duration,
        progress: progress ? {
          progress: progress.progress,
          watch_time: progress.watch_time,
          completed: progress.completed === 1,
          started_at: progress.started_at,
          completed_at: progress.completed_at,
          updated_at: progress.updated_at
        } : {
          progress: 0,
          watch_time: 0,
          completed: false,
          started_at: null,
          completed_at: null,
          updated_at: null
        }
      }
    });
  } catch (err) {
    console.error('[courses/progress/get] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /courses/:id/progress - 更新学习进度
router.post('/:id/progress', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { progress, watch_time } = req.body;
    const userId = req.user.id;

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    if (!course) {
      return res.status(404).json({ code: 404, message: '课程不存在' });
    }

    const parsedProgress = progress !== undefined ? parseFloat(progress) : 0;
    const parsedWatchTime = watch_time !== undefined ? parseInt(watch_time) : 0;

    if (parsedProgress < 0 || parsedProgress > 100) {
      return res.status(400).json({ code: 400, message: '进度值必须在 0-100 之间' });
    }

    const isCompleted = parsedProgress >= 100;
    const existing = db.prepare(
      'SELECT * FROM learning_progress WHERE user_id = ? AND course_id = ?'
    ).get(userId, id);

    if (existing) {
      db.prepare(`
        UPDATE learning_progress
        SET progress = ?, watch_time = ?, completed = ?,
            completed_at = CASE WHEN ? = 1 AND completed = 0 THEN datetime('now','localtime') ELSE completed_at END,
            updated_at = datetime('now','localtime')
        WHERE user_id = ? AND course_id = ?
      `).run(parsedProgress, parsedWatchTime, isCompleted ? 1 : 0, isCompleted ? 1 : 0, userId, id);
    } else {
      db.prepare(`
        INSERT INTO learning_progress (id, user_id, course_id, progress, watch_time, completed, started_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
      `).run(uuidv4(), userId, id, parsedProgress, parsedWatchTime, isCompleted ? 1 : 0);
    }

    // 完成时发放积分（仅首次完成）
    if (isCompleted) {
      const wasAlreadyCompleted = existing && existing.completed === 1;
      if (!wasAlreadyCompleted) {
        const earnedPoints = Math.max(5, Math.floor(course.duration / 5)); // 每5分钟1分，最低5分
        const pointLogId = uuidv4();

        db.prepare(`
          INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(pointLogId, userId, earnedPoints, `完成课程: ${course.title}`, 'learning', id);

        db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(earnedPoints, userId);
      }
    }

    logActivity(db, userId, 'update_progress', 'course', id,
      { course_title: course.title, progress: parsedProgress, completed: isCompleted, watch_time: parsedWatchTime }, req.ip);

    res.json({
      code: 0,
      message: isCompleted ? '课程已完成' : '学习进度已更新',
      data: {
        course_id: id,
        progress: parsedProgress,
        watch_time: parsedWatchTime,
        completed: isCompleted
      }
    });
  } catch (err) {
    console.error('[courses/progress/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
