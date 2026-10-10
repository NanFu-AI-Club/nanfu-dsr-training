/**
 * 课程路由（含文件上传）
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authRequired, adminRequired, isSalesExperienceUser } = require('../middleware/auth');
const { applyLevelBonus } = require('../utils/points');

// 课程文件上传目录
const uploadDir = path.join(__dirname, '..', 'uploads', 'courses');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'video/mp4', 'video/webm', 'video/quicktime',
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];
    const allowedExts = ['.mp4', '.webm', '.mov', '.pdf', '.ppt', '.pptx'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持视频(mp4/webm/mov)、PDF、PPT文件'));
    }
  }
});

// ==================== 辅助函数 ====================

function logActivity(db, userId, action, targetType, targetId, detail, ip) {
  try {
    db.prepare(`
      INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), userId, action, 'courses', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
  } catch (e) {
    console.error('[courses] logActivity error:', e.message);
  }
}

// ==================== 文件上传 ====================

// POST /courses/upload - 上传课程文件（管理员）
router.post('/upload', authRequired, adminRequired, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ code: 400, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请选择文件' });
    }

    const fileUrl = `/uploads/courses/${req.file.filename}`;
    res.json({
      code: 0,
      message: '上传成功',
      data: {
        url: fileUrl,
        filename: req.file.originalname,
        size: req.file.size
      }
    });
  });
});

// ==================== 课程管理 ====================

// GET /courses - 课程列表
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
    if (isSalesExperienceUser(req.user)) {
      conditions.push("c.status = 'published'");
    } else if (status) {
      conditions.push('c.status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM courses c WHERE ${whereClause}
    `).get(...params).count;

    const courses = db.prepare(`
      SELECT c.*, u.real_name as creator_name,
        (SELECT COUNT(DISTINCT lp.user_id)
         FROM learning_progress lp
         JOIN users lu ON lu.id = lp.user_id AND lu.role = 'sales'
         WHERE lp.course_id = c.id) AS learner_count,
        (SELECT COUNT(DISTINCT lp.user_id)
         FROM learning_progress lp
         JOIN users lu ON lu.id = lp.user_id AND lu.role = 'sales'
         WHERE lp.course_id = c.id AND lp.completed = 1) AS completed_count,
        (SELECT COALESCE(SUM(lp.watch_time), 0)
         FROM learning_progress lp
         JOIN users lu ON lu.id = lp.user_id AND lu.role = 'sales'
         WHERE lp.course_id = c.id) AS total_watch_time,
        (SELECT COALESCE(SUM(lp.learn_count), 0)
         FROM learning_progress lp
         JOIN users lu ON lu.id = lp.user_id AND lu.role = 'sales'
         WHERE lp.course_id = c.id) AS learn_count
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
      resource_url || null,
      duration || 0,
      category || null,
      parsedTags,
      sort_order || 0,
      status || 'published',
      req.user.id
    );

    logActivity(db, req.user.id, 'create', 'course', id, { title, type: type || 'video' });

    res.json({ code: 0, message: '课程创建成功', data: { id } });
  } catch (err) {
    console.error('[courses/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /courses/my-progress
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

// GET /courses/roadmap
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

      const userStage = db.prepare(`
        SELECT * FROM user_roadmap_progress WHERE user_id = ? AND stage_id = ?
      `).get(userId, stage.id);

      const allCompleted = requiredCourseIds.length > 0 && courses.every(c => c.completed);
      const stageCompleted = (userStage && userStage.completed === 1) || allCompleted;

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

// GET /courses/roadmap-stages
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

// POST /courses/roadmap-stages
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

    logActivity(db, req.user.id, 'create', 'roadmap_stage', id, { name });

    res.json({ code: 0, message: '路线图阶段创建成功', data: { id } });
  } catch (err) {
    console.error('[courses/roadmap-stages/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /courses/roadmap-stages/:stageId
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

    logActivity(db, req.user.id, 'update', 'roadmap_stage', stageId, { name: name || stage.name });

    res.json({ code: 0, message: '路线图阶段更新成功' });
  } catch (err) {
    console.error('[courses/roadmap-stages/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /courses/roadmap-stages/:stageId
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

    logActivity(db, req.user.id, 'delete', 'roadmap_stage', stageId, { name: stage.name });

    res.json({ code: 0, message: '路线图阶段已删除' });
  } catch (err) {
    console.error('[courses/roadmap-stages/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /courses/roadmap-stages/:stageId/complete
router.post('/roadmap-stages/:stageId/complete', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { stageId } = req.params;
    const userId = req.user.id;

    const stage = db.prepare('SELECT * FROM roadmap_stages WHERE id = ?').get(stageId);
    if (!stage) {
      return res.status(404).json({ code: 404, message: '路线图阶段不存在' });
    }

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

    logActivity(db, userId, 'complete_stage', 'roadmap_stage', stageId, { stage_name: stage.name }, req.ip);

    res.json({ code: 0, message: '阶段已标记完成', data: { stage_id: stageId, completed: true } });
  } catch (err) {
    console.error('[courses/roadmap-stages/complete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /courses/:id
router.get('/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const course = db.prepare(`
      SELECT c.*, u.real_name as creator_name
      FROM courses c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.id = ? ${isSalesExperienceUser(req.user) ? "AND c.status = 'published'" : ''}
    `).get(id);

    if (!course) {
      return res.status(404).json({ code: 404, message: '课程不存在' });
    }

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

// PUT /courses/:id
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

    logActivity(db, req.user.id, 'update', 'course', id, { title: req.body.title || course.title }, req.ip);

    res.json({ code: 0, message: '课程更新成功' });
  } catch (err) {
    console.error('[courses/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /courses/:id
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

    logActivity(db, req.user.id, 'delete', 'course', id, { title: course.title }, req.ip);

    res.json({ code: 0, message: '课程已删除' });
  } catch (err) {
    console.error('[courses/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /courses/:id/progress
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

// POST /courses/:id/progress
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
    const existing = db.prepare(
      'SELECT * FROM learning_progress WHERE user_id = ? AND course_id = ?'
    ).get(userId, id);
    const parsedWatchTime = watch_time !== undefined
      ? Math.max(0, parseInt(watch_time) || 0)
      : (existing?.watch_time || 0);

    if (parsedProgress < 0 || parsedProgress > 100) {
      return res.status(400).json({ code: 400, message: '进度值必须在 0-100 之间' });
    }

    // 销冠闯关秘籍等课程一旦 completed=1 即锁定，后续再看不再回退进度，避免管理后台统计被污染
    if (existing && existing.completed === 1) {
      return res.json({
        code: 0,
        message: '课程已完成，进度已锁定',
        data: {
          course_id: id,
          progress: existing.progress,
          watch_time: existing.watch_time,
          completed: true,
          learn_count: existing.learn_count || 0
        }
      });
    }

    // 单调递增保护：已记录的进度不能被新一次从 0 开始的播放覆盖
    // 当 existing.progress > 0 且 新进度明显回退时，视为"重复观看"：
    //   - 保留原 progress（不回退）
    //   - learn_count + 1（记一次新的学习）
    //   - watch_time 取较大值（不让累计观看时长缩水）
    let finalProgress = parsedProgress;
    let finalWatchTime = parsedWatchTime;
    let isReplay = false;
    if (existing && existing.progress > 0) {
      // 允许 2% 的容差，避免视频正常跳转时误判
      if (parsedProgress + 2 < existing.progress) {
        isReplay = true;
        finalProgress = existing.progress;
        finalWatchTime = Math.max(existing.watch_time || 0, parsedWatchTime);
      } else {
        finalProgress = Math.max(parsedProgress, existing.progress);
        finalWatchTime = Math.max(existing.watch_time || 0, parsedWatchTime);
      }
    }

    const isCompleted = finalProgress >= 100;

    if (existing) {
      const newLearnCount = isReplay ? (existing.learn_count || 0) + 1 : (existing.learn_count || 0);
      db.prepare(`
        UPDATE learning_progress
        SET progress = ?, watch_time = ?, completed = ?,
            completed_at = CASE WHEN ? = 1 AND completed = 0 THEN datetime('now','localtime') ELSE completed_at END,
            updated_at = datetime('now','localtime'),
            learn_count = ?
        WHERE user_id = ? AND course_id = ?
      `).run(finalProgress, finalWatchTime, isCompleted ? 1 : 0, isCompleted ? 1 : 0, newLearnCount, userId, id);
    } else {
      db.prepare(`
        INSERT INTO learning_progress (id, user_id, course_id, progress, watch_time, completed, started_at, learn_count)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), 1)
      `).run(uuidv4(), userId, id, finalProgress, finalWatchTime, isCompleted ? 1 : 0);
    }

    const wasAlreadyCompleted = existing && existing.completed === 1;
    if (isCompleted) {
      if (!wasAlreadyCompleted) {
        const alreadyAwarded = db.prepare(
          `SELECT id FROM point_logs WHERE user_id = ? AND source_type = 'learning' AND source_id = ?`
        ).get(userId, id);
        if (!alreadyAwarded) {
          const basePoints = Math.max(5, Math.floor(course.duration / 5));
          const { awarded: earnedPoints } = applyLevelBonus(db, userId, basePoints);
          const pointLogId = uuidv4();

          db.prepare(`
            INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(pointLogId, userId, earnedPoints, `完成课程: ${course.title}`, 'learning', id);

          db.prepare('UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ? WHERE id = ?').run(earnedPoints, earnedPoints, userId);
        }
      }
    }

    if (isCompleted && !wasAlreadyCompleted) {
      logActivity(db, userId, 'complete', 'course', id, {
        course_title: course.title,
        watch_time: parsedWatchTime
      }, req.ip);
    } else if (isReplay) {
      // 重复观看时记录一条"重看"日志（10 分钟去重，避免短时间反复刷）
      const recentReplayLog = db.prepare(`
        SELECT id FROM activity_logs
        WHERE user_id = ? AND module = 'courses' AND action = 'learn' AND target_id = ?
          AND created_at >= datetime('now', '-10 minutes')
        LIMIT 1
      `).get(userId, id);
      if (!recentReplayLog) {
        logActivity(db, userId, 'learn', 'course', id, {
          course_title: course.title,
          progress: finalProgress,
          watch_time: finalWatchTime,
          replay: true
        }, req.ip);
      }
    } else if (!isCompleted) {
      const recentLearningLog = db.prepare(`
        SELECT id FROM activity_logs
        WHERE user_id = ? AND module = 'courses' AND action = 'learn' AND target_id = ?
          AND created_at >= datetime('now', '-10 minutes')
        LIMIT 1
      `).get(userId, id);
      if (!recentLearningLog) {
        logActivity(db, userId, 'learn', 'course', id, {
          course_title: course.title,
          progress: finalProgress,
          watch_time: finalWatchTime
        }, req.ip);
      }
    }

    // 读回最新 learn_count（包含本次 +1）
    const updated = db.prepare(
      'SELECT learn_count, progress, watch_time, completed FROM learning_progress WHERE user_id = ? AND course_id = ?'
    ).get(userId, id);

    res.json({
      code: 0,
      message: isCompleted ? '课程已完成' : (isReplay ? '已记录为重复观看，进度保留' : '学习进度已更新'),
      data: {
        course_id: id,
        progress: updated ? updated.progress : finalProgress,
        watch_time: updated ? updated.watch_time : finalWatchTime,
        completed: updated ? !!updated.completed : isCompleted,
        learn_count: updated ? (updated.learn_count || 0) : 1
      }
    });
  } catch (err) {
    console.error('[courses/progress/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;