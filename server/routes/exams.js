/**
 * 考试管理路由
 * 表: exams, exam_questions, exam_records, questions, activity_logs
 */
const express = require('express');
const router = express.Router();
const { saveDb } = require('../database');
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');

// ==================== 辅助函数 ====================

/**
 * 记录操作日志
 */
function logActivity(db, userId, action, targetType, targetId, detail, ip) {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, action, 'exams', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
}

/**
 * 考试状态自动流转检查
 * - 若当前时间 >= start_time 且 status = 'published' -> 改为 'ongoing'
 * - 若当前时间 >= end_time 且 status = 'ongoing' -> 改为 'ended'
 */
function checkExamStatus(db, exam) {
  if (!exam) return exam;
  const now = new Date().toISOString();
  let newStatus = exam.status;

  if (exam.status === 'published' && exam.start_time && exam.start_time <= now) {
    newStatus = 'ongoing';
  }
  if ((exam.status === 'ongoing' || (exam.status === 'published' && exam.start_time && exam.start_time <= now))
      && exam.end_time && exam.end_time <= now) {
    newStatus = 'ended';
  }

  if (newStatus !== exam.status) {
    db.prepare("UPDATE exams SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(newStatus, exam.id);
    exam.status = newStatus;
  }
  return exam;
}

/**
 * 检查用户是否被分配到该考试
 */
function isUserAssigned(db, exam, userId) {
  if (exam.assign_type === 'all') return true;

  let targets = [];
  try { targets = JSON.parse(exam.assign_targets || '[]'); } catch (_) { targets = []; }

  if (exam.assign_type === 'user') {
    return targets.includes(userId);
  }

  if (exam.assign_type === 'group') {
    const user = db.prepare('SELECT group_id FROM users WHERE id = ?').get(userId);
    if (!user || !user.group_id) return false;
    return targets.includes(user.group_id);
  }

  return false;
}

/**
 * 自动判分
 * - single/judge: 直接字符串对比（忽略大小写和前后空格）
 * - multiple: JSON 数组排序后对比
 */
function gradeAnswer(questionType, correctAnswer, userAnswer) {
  // 先尝试解析JSON（数据库中可能存为JSON字符串）
  let parsedCorrect;
  try { parsedCorrect = JSON.parse(correctAnswer); } catch (_) { parsedCorrect = correctAnswer; }
  
  if (questionType === 'single' || questionType === 'judge') {
    const correct = String(parsedCorrect).trim().toUpperCase();
    const user = String(userAnswer).trim().toUpperCase();
    return correct === user;
  }
  if (questionType === 'multiple') {
    let correctArr;
    if (Array.isArray(parsedCorrect)) {
      correctArr = parsedCorrect;
    } else {
      try { correctArr = JSON.parse(parsedCorrect); } catch (_) { correctArr = String(parsedCorrect).split(',').map(s => s.trim()); }
    }
    const userArr = Array.isArray(userAnswer) ? userAnswer : String(userAnswer).split(',').map(s => s.trim());
    const sortedCorrect = [...correctArr].sort().map(String).join(',').toUpperCase();
    const sortedUser = [...userArr].sort().map(String).join(',').toUpperCase();
    return sortedCorrect === sortedUser;
  }
  return false;
}

// ==================== 静态路由（必须在 :id 之前） ====================

// GET /exams/pending - 待考列表（sales），返回已分配但未完成的考试
router.get('/pending', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;

    // 获取所有 published 或 ongoing 的考试
    const exams = db.prepare(`
      SELECT * FROM exams WHERE status IN ('published', 'ongoing')
      ORDER BY start_time ASC
    `).all();

    const pending = [];

    for (const exam of exams) {
      // 状态流转检查
      checkExamStatus(db, exam);

      // 检查分配
      if (!isUserAssigned(db, exam, userId)) continue;

      // 查询该用户对该考试的所有记录
      const records = db.prepare(`
        SELECT * FROM exam_records
        WHERE exam_id = ? AND user_id = ?
        ORDER BY created_at DESC
      `).all(exam.id, userId);

      // 已通过的记录
      const passedRecord = records.find(r => r.passed === 1 && (r.status === 'submitted' || r.status === 'graded'));

      // 如果已通过，不显示在待考列表（已经通过了）
      if (passedRecord) continue;

      // 未通过：可以反复考，直到及格
      const completedCount = records.filter(r => r.status === 'submitted' || r.status === 'graded').length;

      // 是否有正在进行的考试
      const ongoingRecord = records.find(r => r.status === 'ongoing');

      pending.push({
        ...exam,
        assign_targets: exam.assign_targets ? JSON.parse(exam.assign_targets) : null,
        completed_attempts: completedCount,
        remaining_attempts: 999, // 不限次数，直到及格
        has_ongoing: !!ongoingRecord,
        ongoing_record_id: ongoingRecord ? ongoingRecord.id : null
      });
    }

    res.json({ code: 0, data: { list: pending, total: pending.length } });
  } catch (err) {
    console.error('[exams/pending] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /exams/records/:recordId/grade - 管理员手动批阅（admin）
router.put('/records/:recordId/grade', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { recordId } = req.params;
    const { score } = req.body;

    const record = db.prepare('SELECT * FROM exam_records WHERE id = ?').get(recordId);
    if (!record) {
      return res.status(404).json({ code: 404, message: '考试记录不存在' });
    }

    if (score === undefined || score === null) {
      return res.status(400).json({ code: 400, message: '分数不能为空' });
    }

    const parsedScore = parseFloat(score);
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(record.exam_id);
    const passed = parsedScore >= (exam ? exam.pass_score : 60) ? 1 : 0;

    db.prepare(`
      UPDATE exam_records
      SET score = ?, passed = ?, status = 'graded', graded_by = ?
      WHERE id = ?
    `).run(parsedScore, passed, req.user.id, recordId);

    logActivity(db, req.user.id, 'grade', 'exam_record', recordId,
      { user_id: record.user_id, exam_id: record.exam_id, score: parsedScore, passed }, req.ip);

    res.json({ code: 0, message: '批阅完成', data: { score: parsedScore, passed: !!passed } });
  } catch (err) {
    console.error('[exams/records/grade] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /exams/records/:recordId/retake - 授权补考（admin）
router.put('/records/:recordId/retake', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { recordId } = req.params;

    const record = db.prepare('SELECT * FROM exam_records WHERE id = ?').get(recordId);
    if (!record) {
      return res.status(404).json({ code: 404, message: '考试记录不存在' });
    }

    db.prepare('UPDATE exam_records SET retake_authorized = 1 WHERE id = ?').run(recordId);

    logActivity(db, req.user.id, 'retake_authorize', 'exam_record', recordId,
      { user_id: record.user_id, exam_id: record.exam_id }, req.ip);

    res.json({ code: 0, message: '补考已授权' });
  } catch (err) {
    console.error('[exams/records/retake] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== CRUD: GET /exams - 考试列表 ====================

router.get('/', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { page = 1, pageSize = 20, status, keyword } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const conditions = [];
    const params = [];

    // sales 只能看到分配给自己的考试
    if (req.user.role !== 'admin') {
      conditions.push(`(
        e.assign_type = 'all'
        OR (e.assign_type = 'user' AND e.assign_targets LIKE ?)
        OR (e.assign_type = 'group' AND e.assign_targets LIKE ?)
      )`);
      params.push(`%"${req.user.id}"%`, `%"${req.user.id}"%`);
      // 更精确的分配检查将在数据取出后进行
    }

    if (status) {
      conditions.push('e.status = ?');
      params.push(status);
    }
    if (keyword) {
      conditions.push('(e.title LIKE ? OR e.description LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const total = db.prepare(`
      SELECT COUNT(DISTINCT e.id) as count FROM exams e WHERE ${whereClause}
    `).get(...params).count;

    let exams = db.prepare(`
      SELECT e.*, u.real_name as creator_name,
             (SELECT COUNT(*) FROM exam_questions WHERE exam_id = e.id) as question_count
      FROM exams e
      LEFT JOIN users u ON e.created_by = u.id
      WHERE ${whereClause}
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // 对非 admin 做精确分配过滤，同时对每场考试做状态流转检查
    if (req.user.role !== 'admin') {
      exams = exams.filter(exam => isUserAssigned(db, exam, req.user.id));
    }

    // 状态自动流转
    const list = exams.map(exam => {
      const updated = checkExamStatus(db, exam);
      return {
        ...updated,
        assign_targets: updated.assign_targets ? JSON.parse(updated.assign_targets) : null
      };
    });

    res.json({
      code: 0,
      data: { list, total, page: parseInt(page), pageSize: limit }
    });
  } catch (err) {
    console.error('[exams] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== CRUD: POST /exams - 创建考试（admin） ====================

router.post('/', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const {
      title, description, duration, total_score, pass_score,
      start_time, end_time, assign_type, assign_targets,
      max_attempts, shuffle_questions, shuffle_options, show_answer
    } = req.body;

    if (!title || !duration) {
      return res.status(400).json({ code: 400, message: '考试标题和时长不能为空' });
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO exams (id, title, description, duration, total_score, pass_score,
        start_time, end_time, assign_type, assign_targets,
        max_attempts, shuffle_questions, shuffle_options, show_answer, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      description || null,
      parseInt(duration),
      total_score || 100,
      pass_score || 60,
      start_time || null,
      end_time || null,
      assign_type || 'all',
      assign_targets ? JSON.stringify(assign_targets) : null,
      max_attempts || 1,
      shuffle_questions !== undefined ? (shuffle_questions ? 1 : 0) : 1,
      shuffle_options !== undefined ? (shuffle_options ? 1 : 0) : 0,
      show_answer !== undefined ? (show_answer ? 1 : 0) : 0,
      req.user.id
    );

    logActivity(db, req.user.id, 'create', 'exam', id,
      { title }, req.ip);

    res.json({ code: 0, message: '考试创建成功', data: { id } });
  } catch (err) {
    console.error('[exams/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== GET /exams/my-all-records - 我的所有考试记录（必须在 /:id 之前） ====================
router.get('/my-all-records', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;

    const records = db.prepare(`
      SELECT er.*, e.title as exam_title, e.total_score as exam_total_score, e.pass_score as exam_pass_score
      FROM exam_records er
      JOIN exams e ON er.exam_id = e.id
      WHERE er.user_id = ? AND er.status IN ('submitted', 'graded')
      ORDER BY er.created_at DESC
    `).all(userId);

    const data = records.map(r => {
      let answers = [];
      try { answers = JSON.parse(r.answers || '[]'); } catch (_) { answers = []; }
      return {
        ...r,
        answers,
        passed: r.passed === 1
      };
    });

    res.json({ code: 0, data: { records: data } });
  } catch (err) {
    console.error('[exams/my-all-records] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== CRUD: GET /exams/:id - 考试详情 ====================

router.get('/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    let exam = db.prepare(`
      SELECT e.*, u.real_name as creator_name,
             (SELECT COUNT(*) FROM exam_questions WHERE exam_id = e.id) as question_count
      FROM exams e
      LEFT JOIN users u ON e.created_by = u.id
      WHERE e.id = ?
    `).get(id);

    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    // 状态流转
    exam = checkExamStatus(db, exam);

    // 权限检查：非 admin 只能看分配到的考试
    if (req.user.role !== 'admin' && !isUserAssigned(db, exam, req.user.id)) {
      return res.status(403).json({ code: 403, message: '无权查看该考试' });
    }

    res.json({
      code: 0,
      data: {
        ...exam,
        assign_targets: exam.assign_targets ? JSON.parse(exam.assign_targets) : null
      }
    });
  } catch (err) {
    console.error('[exams/:id] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== CRUD: PUT /exams/:id - 编辑考试（admin） ====================

router.put('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const fields = [
      'title', 'description', 'duration', 'total_score', 'pass_score',
      'start_time', 'end_time', 'status', 'assign_type', 'assign_targets',
      'max_attempts', 'shuffle_questions', 'shuffle_options', 'show_answer'
    ];

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (field === 'assign_targets') {
          updates.push('assign_targets = ?');
          params.push(JSON.stringify(req.body.assign_targets));
        } else if (['shuffle_questions', 'shuffle_options', 'show_answer', 'max_attempts'].includes(field)) {
          updates.push(`${field} = ?`);
          params.push(req.body[field] ? 1 : 0);
        } else {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now','localtime')");
      params.push(id);
      db.prepare(`UPDATE exams SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    logActivity(db, req.user.id, 'update', 'exam', id,
      { title: req.body.title || exam.title, changed_fields: Object.keys(req.body) }, req.ip);

    res.json({ code: 0, message: '考试更新成功' });
  } catch (err) {
    console.error('[exams/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== CRUD: DELETE /exams/:id - 删除考试（admin） ====================

router.delete('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    db.prepare('DELETE FROM exam_questions WHERE exam_id = ?').run(id);
    db.prepare('DELETE FROM exam_records WHERE exam_id = ?').run(id);
    db.prepare('DELETE FROM exams WHERE id = ?').run(id);

    logActivity(db, req.user.id, 'delete', 'exam', id,
      { title: exam.title }, req.ip);

    res.json({ code: 0, message: '考试已删除' });
  } catch (err) {
    console.error('[exams/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== POST /exams/:id/questions - 组卷（admin） ====================

router.post('/:id/questions', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { question_ids } = req.body;
    // question_ids: [{question_id, score}]

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    if (!Array.isArray(question_ids) || question_ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供题目列表' });
    }

    // 清空已有组卷
    db.prepare('DELETE FROM exam_questions WHERE exam_id = ?').run(id);

    const insertStmt = db.prepare(`
      INSERT INTO exam_questions (id, exam_id, question_id, score, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);

    const composeBatch = db.transaction((items) => {
      let totalScore = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.question_id) continue;

        const score = item.score || 0;
        totalScore += score;

        insertStmt.run(uuidv4(), id, item.question_id, score, i);
      }
      // 更新考试总分
      db.prepare('UPDATE exams SET total_score = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
        .run(totalScore, id);
    });

    composeBatch(question_ids);

    logActivity(db, req.user.id, 'compose', 'exam', id,
      { question_count: question_ids.length }, req.ip);

    res.json({ code: 0, message: '组卷成功', data: { question_count: question_ids.length } });
  } catch (err) {
    console.error('[exams/compose] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== GET /exams/:id/questions - 查看试卷题目 ====================

router.get('/:id/questions', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    // 权限检查
    if (req.user.role !== 'admin' && !isUserAssigned(db, exam, req.user.id)) {
      return res.status(403).json({ code: 403, message: '无权查看该试卷' });
    }

    // 状态流转
    checkExamStatus(db, exam);

    const questions = db.prepare(`
      SELECT q.id, q.type, q.category, q.content, q.options, q.answer, q.analysis,
             q.difficulty, q.tags, eq.score, eq.sort_order
      FROM exam_questions eq
      JOIN questions q ON eq.question_id = q.id
      WHERE eq.exam_id = ?
      ORDER BY eq.sort_order ASC, eq.id ASC
    `).all(id);

    // 管理端显示答案，考生端不显示答案
    const isAdmin = req.user.role === 'admin';
    const list = questions.map(q => ({
      id: q.id,
      type: q.type,
      category: q.category,
      content: q.content,
      options: q.options ? JSON.parse(q.options) : null,
      difficulty: q.difficulty,
      tags: q.tags ? JSON.parse(q.tags) : [],
      score: q.score,
      sort_order: q.sort_order,
      // 仅管理端或考试结束后（show_answer=1）返回答案
      answer: (isAdmin || exam.show_answer)
        ? (() => { try { return JSON.parse(q.answer); } catch (_) { return q.answer; } })()
        : undefined,
      analysis: (isAdmin || exam.show_answer) ? q.analysis : undefined
    }));

    res.json({
      code: 0,
      data: {
        exam: { id: exam.id, title: exam.title, duration: exam.duration, total_score: exam.total_score },
        questions: list
      }
    });
  } catch (err) {
    console.error('[exams/questions] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== POST /exams/:id/publish - 发布考试（admin） ====================

router.post('/:id/publish', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    if (exam.status !== 'draft') {
      return res.status(400).json({ code: 400, message: `当前状态 "${exam.status}" 不允许发布` });
    }

    // 检查是否有题目
    const questionCount = db.prepare('SELECT COUNT(*) as count FROM exam_questions WHERE exam_id = ?').get(id).count;
    if (questionCount === 0) {
      return res.status(400).json({ code: 400, message: '试卷中没有题目，无法发布' });
    }

    // 状态改为 published（后续由 checkExamStatus 根据时间自动流转）
    db.prepare("UPDATE exams SET status = 'published', updated_at = datetime('now','localtime') WHERE id = ?").run(id);

    logActivity(db, req.user.id, 'publish', 'exam', id,
      { title: exam.title }, req.ip);

    res.json({ code: 0, message: '考试已发布' });
  } catch (err) {
    console.error('[exams/publish] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== POST /exams/:id/start - 开始考试（sales） ====================

router.post('/:id/start', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const userId = req.user.id;

    let exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    // 状态流转检查
    exam = checkExamStatus(db, exam);

    // 必须是 published 或 ongoing 状态
    if (!['published', 'ongoing'].includes(exam.status)) {
      return res.status(400).json({ code: 400, message: '考试当前不可开始' });
    }

    // 权限检查
    if (req.user.role !== 'admin' && !isUserAssigned(db, exam, userId)) {
      return res.status(403).json({ code: 403, message: '您未被分配参加该考试' });
    }

    // 检查是否已通过（已通过不能再考）
    const passedRecord = db.prepare(`
      SELECT id FROM exam_records
      WHERE exam_id = ? AND user_id = ? AND passed = 1 AND status IN ('submitted', 'graded')
    `).get(id, userId);
    if (passedRecord) {
      return res.status(400).json({ code: 400, message: '您已通过该考试，无需再考' });
    }

    // 检查是否有正在进行的考试
    const ongoing = db.prepare(`
      SELECT id FROM exam_records
      WHERE exam_id = ? AND user_id = ? AND status = 'ongoing'
    `).get(id, userId);
    if (ongoing) {
      return res.json({
        code: 0,
        message: '您有一个正在进行的考试',
        data: { record_id: ongoing.id, exam_title: exam.title, duration: exam.duration }
      });
    }

    // 未通过，可以再考（不限次数）
    const completedCount = db.prepare(`
      SELECT COUNT(*) as count FROM exam_records
      WHERE exam_id = ? AND user_id = ? AND status IN ('submitted', 'graded')
    `).get(id, userId).count;

    const attempt = completedCount + 1;
    const recordId = uuidv4();

    db.prepare(`
      INSERT INTO exam_records (id, exam_id, user_id, attempt, score, total_score, passed,
        start_time, answers, status, retake_authorized)
      VALUES (?, ?, ?, ?, 0, ?, 0, datetime('now','localtime'), '[]', 'ongoing', 0)
    `).run(recordId, id, userId, attempt, exam.total_score);

    // 如果考试状态是 published，改为 ongoing
    if (exam.status === 'published') {
      db.prepare("UPDATE exams SET status = 'ongoing', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
    }

    logActivity(db, userId, 'start_exam', 'exam_record', recordId,
      { exam_id: id, exam_title: exam.title, attempt }, req.ip);

    res.json({
      code: 0,
      message: '考试已开始',
      data: {
        record_id: recordId,
        exam_title: exam.title,
        duration: exam.duration,
        total_score: exam.total_score,
        attempt
      }
    });
  } catch (err) {
    console.error('[exams/start] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== GET /exams/:id/my-records - 我的考试记录（sales） ====================

router.get('/:id/my-records', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const userId = req.user.id;

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    const records = db.prepare(`
      SELECT * FROM exam_records
      WHERE exam_id = ? AND user_id = ?
      ORDER BY created_at DESC
    `).all(id, userId);

    const data = records.map(r => {
      let answers = [];
      try { answers = JSON.parse(r.answers || '[]'); } catch (_) { answers = []; }
      return {
        ...r,
        answers,
        passed: r.passed === 1
      };
    });

    res.json({
      code: 0,
      data: {
        exam_title: exam.title,
        total_score: exam.total_score,
        pass_score: exam.pass_score,
        max_attempts: exam.max_attempts,
        records: data
      }
    });
  } catch (err) {
    console.error('[exams/my-records] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== GET /exams/paper/:id - 获取试卷题目（打乱后） ====================

router.get('/paper/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    let questions = db.prepare(`
      SELECT q.id, q.type, q.content, q.options, q.difficulty, q.tags,
             eq.score, eq.sort_order
      FROM exam_questions eq
      JOIN questions q ON eq.question_id = q.id
      WHERE eq.exam_id = ?
      ORDER BY eq.sort_order ASC, eq.id ASC
    `).all(id);

    // 打乱题目顺序
    if (exam.shuffle_questions) {
      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
    }

    // 打乱选项顺序，并规范化选项格式
    const result = questions.map(q => {
      let options = [];
      try { options = JSON.parse(q.options || '[]'); } catch (_) { options = []; }
      
      // 规范化选项格式：支持字符串数组 ["A.选项内容", "B.选项内容"] 和对象数组 [{value, label}]
      options = options.map((opt, idx) => {
        if (typeof opt === 'string') {
          // 解析 "A.选项内容" 格式
          const match = opt.match(/^([A-D])[.．、:：]\s*(.+)$/i);
          if (match) {
            return { value: match[1].toUpperCase(), label: opt, text: match[2] };
          }
          return { value: String.fromCharCode(65 + idx), label: opt, text: opt };
        }
        return opt; // 已经是对象格式
      });
      
      if (exam.shuffle_options && options.length > 0) {
        for (let i = options.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [options[i], options[j]] = [options[j], options[i]];
        }
      }
      return { ...q, options };
    });

    res.json({ code: 0, data: { questions: result, exam } });
  } catch (err) {
    console.error('[exams/paper] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== POST /exams/:id/submit - 提交考试（sales） ====================

router.post('/:id/submit', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { record_id, answers } = req.body;
    const userId = req.user.id;

    if (!record_id || !Array.isArray(answers)) {
      return res.status(400).json({ code: 400, message: '请提供 record_id 和 answers' });
    }

    let exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }
    exam = checkExamStatus(db, exam);

    const record = db.prepare('SELECT * FROM exam_records WHERE id = ? AND user_id = ?')
      .get(record_id, userId);
    if (!record) {
      return res.status(404).json({ code: 404, message: '考试记录不存在' });
    }
    if (record.status !== 'ongoing') {
      return res.status(400).json({ code: 400, message: '该考试记录已提交，不可重复提交' });
    }

    // 获取试卷所有题目及答案
    const questions = db.prepare(`
      SELECT q.id, q.type, q.content, q.answer, q.analysis, q.options,
             eq.score
      FROM exam_questions eq
      JOIN questions q ON eq.question_id = q.id
      WHERE eq.exam_id = ?
      ORDER BY eq.sort_order ASC, eq.id ASC
    `).all(id);

    let correctCount = 0;
    let totalScore = 0;
    const gradedAnswers = [];

    for (const question of questions) {
      const userAnswer = answers.find(a => a.question_id === question.id);
      const userAns = userAnswer ? userAnswer.answer : null;
      let isCorrect = false;

      if (userAns !== null && userAns !== undefined && userAns !== '') {
        isCorrect = gradeAnswer(question.type, question.answer, userAns);
      }

      if (isCorrect) {
        correctCount++;
        totalScore += question.score;
      }

      gradedAnswers.push({
        question_id: question.id,
        type: question.type,
        content: question.content,
        options: question.options ? JSON.parse(question.options) : null,
        user_answer: userAns,
        correct_answer: (() => { try { return JSON.parse(question.answer); } catch (_) { return question.answer; } })(),
        is_correct: isCorrect,
        score: isCorrect ? question.score : 0,
        total_score: question.score,
        analysis: question.analysis
      });
    }

    const passed = totalScore >= exam.pass_score ? 1 : 0;

    db.prepare(`
      UPDATE exam_records
      SET answers = ?, score = ?, passed = ?, status = 'submitted',
          end_time = datetime('now','localtime')
      WHERE id = ?
    `).run(JSON.stringify(gradedAnswers), totalScore, passed, record_id);

    // 立即保存数据库，防止数据丢失
    saveDb(true);

    // 如果本次提交通过了考试，给予积分奖励（同一考试只发一次）
    if (passed === 1) {
      // 幂等检查：查 point_logs 是否已为该考试发过积分
      const alreadyAwarded = db.prepare(
        `SELECT id FROM point_logs WHERE user_id = ? AND source_type = 'exam' AND source_id = ?`
      ).get(userId, id);
      if (!alreadyAwarded) {
        const earnedPoints = Math.floor(totalScore / 10);
        if (earnedPoints > 0) {
          const pointLogId = uuidv4();
          db.prepare(`
            INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(pointLogId, userId, earnedPoints, `考试通过: ${exam.title}`, 'exam', id);

          db.prepare('UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ? WHERE id = ?').run(earnedPoints, earnedPoints, userId);
        }
      }
    }

    logActivity(db, userId, 'submit_exam', 'exam_record', record_id,
      { exam_id: id, exam_title: exam.title, score: totalScore, passed: !!passed, correct: correctCount }, req.ip);

    res.json({
      code: 0,
      message: '考试提交成功',
      data: {
        record_id,
        score: totalScore,
        total_score: exam.total_score,
        pass_score: exam.pass_score,
        passed: !!passed,
        correct_count: correctCount,
        total_count: questions.length,
        answers: gradedAnswers
      }
    });
  } catch (err) {
    console.error('[exams/submit] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== GET /exams/:id/records - 管理员查看所有考生记录（admin） ====================

router.get('/:id/records', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM exam_records WHERE exam_id = ?
    `).get(id).count;

    const records = db.prepare(`
      SELECT er.*, u.real_name, u.username, u.group_id, g.name as group_name
      FROM exam_records er
      JOIN users u ON er.user_id = u.id
      LEFT JOIN groups g ON u.group_id = g.id
      WHERE er.exam_id = ?
      ORDER BY er.created_at DESC
      LIMIT ? OFFSET ?
    `).all(id, limit, offset);

    const list = records.map(r => ({
      ...r,
      passed: r.passed === 1,
      answers: (() => { try { return JSON.parse(r.answers || '[]'); } catch (_) { return []; } })()
    }));

    // 统计汇总
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_count,
        SUM(CASE WHEN passed = 0 AND status IN ('submitted','graded') THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN status = 'ongoing' THEN 1 ELSE 0 END) as ongoing_count,
        ROUND(AVG(CASE WHEN status IN ('submitted','graded') THEN score END), 1) as avg_score,
        MAX(score) as max_score
      FROM exam_records
      WHERE exam_id = ?
    `).get(id);

    res.json({
      code: 0,
      data: {
        exam: { id: exam.id, title: exam.title, total_score: exam.total_score, pass_score: exam.pass_score },
        stats,
        list,
        total,
        page: parseInt(page),
        pageSize: limit
      }
    });
  } catch (err) {
    console.error('[exams/records] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== GET /exams/:id/records/export - 导出考试记录为 Excel（admin） ====================

router.get('/:id/records/export', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) {
      return res.status(404).json({ code: 404, message: '考试不存在' });
    }

    // 获取所有考生记录（不分页）
    const records = db.prepare(`
      SELECT er.*, u.real_name, u.username, u.group_id, g.name as group_name
      FROM exam_records er
      JOIN users u ON er.user_id = u.id
      LEFT JOIN groups g ON u.group_id = g.id
      WHERE er.exam_id = ?
      ORDER BY er.created_at DESC
    `).all(id);

    // 使用 xlsx 生成 Excel
    const XLSX = require('xlsx');

    // 准备数据
    const data = records.map((r, idx) => {
      const duration = r.duration != null ? `${Math.floor(r.duration / 60)}分${r.duration % 60}秒` : '-';
      const statusMap = {
        'ongoing': '进行中',
        'submitted': '已提交',
        'graded': '已批阅'
      };
      return {
        '序号': idx + 1,
        '姓名': r.real_name || r.username || r.user_id,
        '分组': r.group_name || '-',
        '分数': r.score ?? '-',
        '是否通过': r.passed === 1 ? '通过' : '未通过',
        '状态': statusMap[r.status] || r.status,
        '用时': duration,
        '考试时间': r.start_time ? r.start_time.replace('T', ' ').slice(0, 19) : '-',
        '提交时间': r.end_time ? r.end_time.replace('T', ' ').slice(0, 19) : '-',
      };
    });

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);

    // 设置列宽
    ws['!cols'] = [
      { wch: 6 },   // 序号
      { wch: 12 },  // 姓名
      { wch: 12 },  // 分组
      { wch: 8 },   // 分数
      { wch: 10 },  // 是否通过
      { wch: 10 },  // 状态
      { wch: 12 },  // 用时
      { wch: 20 },  // 考试时间
      { wch: 20 },  // 提交时间
    ];

    XLSX.utils.book_append_sheet(wb, ws, '考试记录');

    // 生成文件名
    const filename = `${exam.title}_考试记录_${new Date().toISOString().slice(0, 10)}.xlsx`;

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    // 发送文件
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buf);

    logActivity(db, req.user.id, 'export', 'exam_records', id,
      { exam_title: exam.title, record_count: records.length }, req.ip);
  } catch (err) {
    console.error('[exams/records/export] Error:', err);
    res.status(500).json({ code: 500, message: '导出失败' });
  }
});

module.exports = router;
