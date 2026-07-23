/**
 * 题库管理路由
 * 表: questions, activity_logs
 */
const express = require('express');
const router = express.Router();
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
  `).run(uuidv4(), userId, action, 'questions', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
}

/**
 * 解析 JSON 字段
 */
function parseQuestion(q) {
  let answer = q.answer;
  // 仅当 answer 是 JSON 数组/对象时才 parse，避免 "true"/"false" 被转成 boolean
  try {
    const parsed = JSON.parse(answer);
    if (typeof parsed === 'object') {
      answer = parsed;
    }
  } catch (_) {}
  return {
    ...q,
    options: q.options ? JSON.parse(q.options) : null,
    tags: q.tags ? JSON.parse(q.tags) : [],
    answer,
  };
}

// ==================== 静态路由（必须在 :id 之前） ====================

// GET /questions/categories - 获取所有题目分类（去重）
router.get('/categories', authRequired, (req, res) => {
  try {
    const db = req.db;
    const rows = db.prepare(`
      SELECT DISTINCT category FROM questions
      WHERE category IS NOT NULL AND category != ''
      ORDER BY category ASC
    `).all();
    const list = rows.map((r, idx) => ({ id: r.category, name: r.category, value: r.category, label: r.category }));
    res.json({ code: 0, data: list });
  } catch (err) {
    console.error('[questions/categories] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /questions/export - 导出题目为 JSON（admin），支持 type/category 筛选
router.get('/export', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { type, category } = req.query;

    const conditions = [];
    const params = [];

    if (type) { conditions.push('type = ?'); params.push(type); }
    if (category) { conditions.push('category = ?'); params.push(category); }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const questions = db.prepare(`
      SELECT * FROM questions WHERE ${whereClause} ORDER BY created_at ASC
    `).all(...params);

    const list = questions.map(parseQuestion);

    logActivity(db, req.user.id, 'export', 'questions', null, { count: list.length, type, category }, req.ip);

    res.json({ code: 0, data: list });
  } catch (err) {
    console.error('[questions/export] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /questions/batch - 批量导入（admin）
router.post('/batch', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const items = req.body;
    // 预期格式: [{type, category, content, options, answer, analysis, difficulty, tags}]

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供有效的题目数据' });
    }

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    const insertStmt = db.prepare(`
      INSERT INTO questions (id, type, category, content, options, answer, analysis, difficulty, tags, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < items.length; i++) {
      const q = items[i];

      if (!q.type || !q.content || q.answer === undefined || q.answer === null) {
        failCount++;
        errors.push({ index: i, message: 'type/content/answer 不能为空' });
        continue;
      }
      if (!['single', 'multiple', 'judge'].includes(q.type)) {
        failCount++;
        errors.push({ index: i, message: `无效的题目类型: ${q.type}` });
        continue;
      }

      insertStmt.run(
        uuidv4(),
        q.type,
        q.category || null,
        q.content,
        q.options ? JSON.stringify(q.options) : null,
        typeof q.answer === 'string' ? q.answer : JSON.stringify(q.answer),
        q.analysis || null,
        q.difficulty || 'medium',
        q.tags ? JSON.stringify(q.tags) : null,
        req.user.id
      );
      successCount++;
    }

    logActivity(db, req.user.id, 'batch_import', 'questions', null,
      { total: items.length, success: successCount, fail: failCount }, req.ip);

    res.json({
      code: 0,
      data: { total: items.length, success: successCount, fail: failCount, errors }
    });
  } catch (err) {
    console.error('[questions/batch] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== GET /questions - 题目列表 ====================

router.get('/', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { page = 1, pageSize = 20, type, category, difficulty, keyword } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const conditions = [];
    const params = [];

    if (keyword) {
      conditions.push('content LIKE ?');
      params.push(`%${keyword}%`);
    }
    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (difficulty) {
      conditions.push('difficulty = ?');
      params.push(difficulty);
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const total = db.prepare(`SELECT COUNT(*) as count FROM questions WHERE ${whereClause}`).get(...params).count;

    const questions = db.prepare(`
      SELECT * FROM questions
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const list = questions.map(parseQuestion);

    res.json({
      code: 0,
      data: { list, total, page: parseInt(page), pageSize: limit }
    });
  } catch (err) {
    console.error('[questions] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 每日一题（必须在 /:id 之前定义） ====================

// GET /daily - 获取今日随机一题（每天每用户同一题）
router.get('/daily', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // 检查今天是否已经答过
    const existingLog = db.prepare(`
      SELECT pl.* FROM point_logs pl
      WHERE pl.user_id = ? AND pl.source_type = 'daily_question'
        AND date(pl.created_at) = ?
    `).get(userId, today);

    if (existingLog) {
      return res.json({
        code: 0,
        data: { answered: true, source_type: 'daily_question', source_id: existingLog.source_id },
      });
    }

    // 基于日期生成确定性种子，保证每天所有用户看到同一题
    const seed = parseInt(today.replace(/-/g, ''), 10);
    const count = db.prepare("SELECT COUNT(*) as count FROM questions WHERE status = 'active'").get().count;

    if (count === 0) {
      return res.json({ code: 0, data: { answered: false, question: null } });
    }

    const offset = seed % count;
    const question = db.prepare(`
      SELECT id, type, content, options, category, difficulty
      FROM questions WHERE status = 'active'
      LIMIT 1 OFFSET ?
    `).get(offset);

    // 解析 options JSON
    if (question && question.options) {
      try { question.options = JSON.parse(question.options); } catch (_) {}
    }

    res.json({ code: 0, data: { answered: false, question } });
  } catch (err) {
    console.error('[questions/daily] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /daily/answer - 提交每日一题答案
router.post('/daily/answer', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const { question_id, answer } = req.body;

    if (!question_id || answer === undefined) {
      return res.status(400).json({ code: 400, message: '缺少题目ID或答案' });
    }

    // 检查今天是否已答
    const existingLog = db.prepare(`
      SELECT id FROM point_logs
      WHERE user_id = ? AND source_type = 'daily_question' AND date(created_at) = ?
    `).get(userId, today);
    if (existingLog) {
      return res.status(400).json({ code: 400, message: '今日已答过题目' });
    }

    // 获取正确答案
    const question = db.prepare('SELECT id, type, answer, analysis, content FROM questions WHERE id = ? AND status = \'active\'').get(question_id);
    if (!question) {
      return res.json({ code: 404, message: '题目不存在' });
    }

    let correctAnswer;
    try { correctAnswer = JSON.parse(question.answer); } catch (_) { correctAnswer = question.answer; }

    // 判断/单选题答案标准化：前端可能传来 A/B/C/D 或 true/false/是/否 或选项文本
    let userAnswer = String(answer).trim();
    let serverAnswer = String(correctAnswer).trim();

    // 尝试将字母映射到具体选项值
    if (question.type === 'single' || question.type === 'judge') {
      // 如果是 A/B/C/D 字母，映射到实际选项文本
      if (/^[A-D]$/i.test(userAnswer) && Array.isArray(question.options)) {
        const idx = userAnswer.toUpperCase().charCodeAt(0) - 65;
        if (idx < question.options.length) {
          userAnswer = String(question.options[idx]);
        }
      }
      if (/^[A-D]$/i.test(serverAnswer) && Array.isArray(question.options)) {
        const idx = serverAnswer.toUpperCase().charCodeAt(0) - 65;
        if (idx < question.options.length) {
          serverAnswer = String(question.options[idx]);
        }
      }
      // 判断题中文映射: true/正确/是 → 统一为 true
      const judgeTrueValues = ['true', '正确', '是', '对', 'a', 'yes', '1'];
      const judgeFalseValues = ['false', '错误', '否', '错', 'b', 'no', '0'];
      if (question.type === 'judge') {
        if (judgeTrueValues.includes(userAnswer.toLowerCase())) userAnswer = '是';
        if (judgeFalseValues.includes(userAnswer.toLowerCase())) userAnswer = '否';
        if (judgeTrueValues.includes(serverAnswer.toLowerCase())) serverAnswer = '是';
        if (judgeFalseValues.includes(serverAnswer.toLowerCase())) serverAnswer = '否';
      }
    }

    let isCorrect = false;
    if (question.type === 'single' || question.type === 'judge') {
      isCorrect = userAnswer.toLowerCase() === serverAnswer.toLowerCase();
    } else if (question.type === 'multiple') {
      const userSorted = Array.isArray(answer) ? answer.map(String).sort() : [String(answer)];
      const correctSorted = Array.isArray(correctAnswer) ? correctAnswer.map(String).sort() : [String(correctAnswer)];
      isCorrect = JSON.stringify(userSorted) === JSON.stringify(correctSorted);
    }

    // 积分奖励：从 point_rules 读取配置
    const correctRule = db.prepare("SELECT points FROM point_rules WHERE source_type = 'daily_question_correct' AND enabled = 1").get();
    const wrongRule = db.prepare("SELECT points FROM point_rules WHERE source_type = 'daily_question_wrong' AND enabled = 1").get();
    const earnedPoints = isCorrect ? (correctRule?.points || 10) : (wrongRule?.points || 2);
    const now = new Date().toISOString();

    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(earnedPoints, userId);
    db.prepare(`
      INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), userId, earnedPoints,
      `每日一题: ${isCorrect ? '回答正确' : '参与答题'} - ${String(question.content || '').substring(0, 30)}`,
      'daily_question', question_id, now
    );

    const { logActivity } = require('./users');
    logActivity(db, userId, 'daily_question', 'question', question_id,
      { question_id, isCorrect, earnedPoints }, req.ip);

    // 判断题显示友好文本
    const friendlyAnswer = question.type === 'judge'
      ? (serverAnswer === '是' ? '正确' : '错误')
      : serverAnswer;

    res.json({
      code: 0,
      data: { isCorrect, correctAnswer: friendlyAnswer, analysis: question.analysis || '', earnedPoints },
    });
  } catch (err) {
    console.error('[questions/daily-answer] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== GET /questions/:id - 单题详情 ====================

router.get('/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);

    if (!question) {
      return res.status(404).json({ code: 404, message: '题目不存在' });
    }

    res.json({ code: 0, data: parseQuestion(question) });
  } catch (err) {
    console.error('[questions/:id] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== POST /questions - 新增题目（admin） ====================

router.post('/', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { type, category, content, options, answer, analysis, difficulty, tags } = req.body;

    if (!type || !content || answer === undefined || answer === null) {
      return res.status(400).json({ code: 400, message: '题目类型、内容和答案不能为空' });
    }
    if (!['single', 'multiple', 'judge'].includes(type)) {
      return res.status(400).json({ code: 400, message: '题目类型无效，仅支持 single/multiple/judge' });
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO questions (id, type, category, content, options, answer, analysis, difficulty, tags, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      type,
      category || null,
      content,
      options ? JSON.stringify(options) : null,
      typeof answer === 'string' ? answer : JSON.stringify(answer),
      analysis || null,
      difficulty || 'medium',
      tags ? JSON.stringify(tags) : null,
      req.user.id
    );

    logActivity(db, req.user.id, 'create', 'question', id,
      { content: content.substring(0, 100), type }, req.ip);

    res.json({ code: 0, message: '题目创建成功', data: { id } });
  } catch (err) {
    console.error('[questions/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== PUT /questions/:id - 编辑题目（admin） ====================

router.put('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { type, category, content, options, answer, analysis, difficulty, tags, status } = req.body;

    const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
    if (!question) {
      return res.status(404).json({ code: 404, message: '题目不存在' });
    }

    const updates = [];
    const params = [];

    if (type !== undefined) { updates.push('type = ?'); params.push(type); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (content !== undefined) { updates.push('content = ?'); params.push(content); }
    if (options !== undefined) { updates.push('options = ?'); params.push(JSON.stringify(options)); }
    if (answer !== undefined) {
      updates.push('answer = ?');
      params.push(typeof answer === 'string' ? answer : JSON.stringify(answer));
    }
    if (analysis !== undefined) { updates.push('analysis = ?'); params.push(analysis); }
    if (difficulty !== undefined) { updates.push('difficulty = ?'); params.push(difficulty); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now','localtime')");
      params.push(id);
      db.prepare(`UPDATE questions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    logActivity(db, req.user.id, 'update', 'question', id,
      { content: (content || question.content).substring(0, 100), changed_fields: Object.keys(req.body) }, req.ip);

    res.json({ code: 0, message: '题目更新成功' });
  } catch (err) {
    console.error('[questions/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== DELETE /questions/:id - 删除题目（admin） ====================

router.delete('/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
    if (!question) {
      return res.status(404).json({ code: 404, message: '题目不存在' });
    }

    // 先解除考试关联
    db.prepare('DELETE FROM exam_questions WHERE question_id = ?').run(id);
    // 删除题目
    db.prepare('DELETE FROM questions WHERE id = ?').run(id);

    logActivity(db, req.user.id, 'delete', 'question', id,
      { content: question.content.substring(0, 100) }, req.ip);

    res.json({ code: 0, message: '题目已删除' });
  } catch (err) {
    console.error('[questions/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
