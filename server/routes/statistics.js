/**
 * 学习统计路由（sales端个人统计）
 * 表: users, learning_progress, courses, exam_records, exams, exam_questions, questions,
 *     training_sessions, training_reports, training_messages, point_logs, activity_logs, groups
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');

// ==================== 辅助函数 ====================

/**
 * 安全解析JSON
 */
function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

// ==================== 个人概览 ====================

// GET /overview - 个人概览
router.get('/overview', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;

    // 当前用户信息（积分）
    const user = db.prepare('SELECT id, real_name, points, group_id FROM users WHERE id = ?').get(userId);

    // 总积分
    const totalPoints = user.points || 0;

    // 完成课程数
    const completedCourses = db.prepare(`
      SELECT COUNT(*) as count FROM learning_progress WHERE user_id = ? AND completed = 1
    `).get(userId).count;

    // 总课程数
    const totalCourses = db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get().count;

    // 考试通过率
    const examStats = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) as passed
      FROM exam_records er
      WHERE er.user_id = ? AND er.status IN ('submitted', 'graded')
    `).get(userId);
    const examPassRate = examStats.total > 0 ? Math.round((examStats.passed / examStats.total) * 100) : 0;

    // 陪练次数
    const trainingCount = db.prepare(`
      SELECT COUNT(*) as count FROM training_sessions WHERE user_id = ?
    `).get(userId).count;

    // 陪练平均分
    const trainingAvg = db.prepare(`
      SELECT ROUND(AVG(tr.total_score), 1) as avg
      FROM training_reports tr
      WHERE tr.user_id = ?
    `).get(userId).avg || 0;

    // 排名（按积分排序）
    const ranking = db.prepare(`
      SELECT COUNT(*) as rank FROM users WHERE points > ? AND status = 'active'
    `).get(totalPoints);
    const rank = ranking.rank + 1;

    res.json({
      code: 0,
      data: {
        total_points: totalPoints,
        completed_courses: completedCourses,
        total_courses: totalCourses,
        course_completion_rate: totalCourses > 0 ? Math.round((completedCourses / totalCourses) * 100) : 0,
        exam_total: examStats.total,
        exam_passed: examStats.passed,
        exam_pass_rate: examPassRate,
        training_count: trainingCount,
        avg_score: trainingAvg,
        rank,
        real_name: user.real_name
      }
    });
  } catch (err) {
    console.error('[statistics/overview] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 考试成绩趋势 ====================

// GET /exam-trend - 最近12个月各月平均分
router.get('/exam-trend', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;

    // 查询用户最近12个月每个月的考试平均分
    const myTrend = db.prepare(`
      SELECT strftime('%Y-%m', er.created_at) as month,
             ROUND(AVG(er.score), 1) as my_score,
             COUNT(*) as exam_count
      FROM exam_records er
      WHERE er.user_id = ? AND er.status IN ('submitted', 'graded')
        AND er.created_at >= datetime('now', '-12 months', 'localtime')
      GROUP BY month
      ORDER BY month ASC
    `).all(userId);

    // 查询全局最近12个月每个月的考试平均分
    const globalTrend = db.prepare(`
      SELECT strftime('%Y-%m', er.created_at) as month,
             ROUND(AVG(er.score), 1) as avg_score
      FROM exam_records er
      WHERE er.status IN ('submitted', 'graded')
        AND er.created_at >= datetime('now', '-12 months', 'localtime')
      GROUP BY month
      ORDER BY month ASC
    `).all();

    // 补全12个月
    const result = [];
    const now = new Date();
    const myMap = {};
    for (const item of myTrend) {
      myMap[item.month] = { my_score: item.my_score, exam_count: item.exam_count };
    }
    const globalMap = {};
    for (const item of globalTrend) {
      globalMap[item.month] = item.avg_score;
    }

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      result.push({
        month: monthStr,
        my_score: myMap[monthStr] ? myMap[monthStr].my_score : 0,
        exam_count: myMap[monthStr] ? myMap[monthStr].exam_count : 0,
        avg_score: globalMap[monthStr] || 0
      });
    }

    res.json({ code: 0, data: result });
  } catch (err) {
    console.error('[statistics/exam-trend] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 学习日历（热力图数据） ====================

// GET /learning-calendar - 按日期统计学习课程数
router.get('/learning-calendar', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;

    // 查询最近180天的学习记录（按日期统计完成的课程数 + 学习的课程数）
    const calendar = db.prepare(`
      SELECT date(lp.updated_at) as date, COUNT(*) as count
      FROM learning_progress lp
      WHERE lp.user_id = ? AND lp.updated_at >= datetime('now', '-180 days', 'localtime')
      GROUP BY date
      ORDER BY date ASC
    `).all(userId);

    res.json({ code: 0, data: calendar });
  } catch (err) {
    console.error('[statistics/learning-calendar] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 积分变化趋势 ====================

// GET /points-history - 按周统计积分变化
router.get('/points-history', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;

    // 最近12周的积分获取情况
    const history = db.prepare(`
      SELECT strftime('%Y-W%W', pl.created_at) as week,
             SUM(pl.points) as points,
             COUNT(*) as count
      FROM point_logs pl
      WHERE pl.user_id = ? AND pl.created_at >= datetime('now', '-84 days', 'localtime')
      GROUP BY week
      ORDER BY week ASC
    `).all(userId);

    // 补全12周数据
    const result = [];
    const historyMap = {};
    for (const item of history) {
      historyMap[item.week] = { points: item.points, count: item.count };
    }

    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      // 计算ISO周
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      const weekStr = d.getFullYear() + '-W' + String(weekNum).padStart(2, '0');

      result.push({
        week: weekStr,
        date: d.toISOString().split('T')[0],
        points: historyMap[weekStr] ? historyMap[weekStr].points : 0,
        count: historyMap[weekStr] ? historyMap[weekStr].count : 0
      });
    }

    res.json({ code: 0, data: result });
  } catch (err) {
    console.error('[statistics/points-history] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 积分排行 ====================

// GET /ranking - 积分排行，支持全局/分组/本月维度
router.get('/ranking', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { dimension = 'global', page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);
    const userId = req.user.id;

    let conditions = ["u.status = 'active'"];
    let params = [];

    if (dimension === 'group') {
      // 获取当前用户的分组
      const user = db.prepare('SELECT group_id FROM users WHERE id = ?').get(userId);
      if (user && user.group_id) {
        conditions.push('u.group_id = ?');
        params.push(user.group_id);
      }
    }

    if (dimension === 'month') {
      // 本月积分排行：从 point_logs 汇总本月积分
      const whereClause = conditions.join(' AND ');
      const total = db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT pl.user_id
          FROM point_logs pl
          JOIN users u ON pl.user_id = u.id
          WHERE ${whereClause}
            AND strftime('%Y-%m', pl.created_at) = strftime('%Y-%m', 'now', 'localtime')
          GROUP BY pl.user_id
        )
      `).get(...params).count;

      const ranking = db.prepare(`
        SELECT u.id, u.real_name, u.avatar, u.group_id, g.name as group_name,
               SUM(pl.points) as monthly_points
        FROM point_logs pl
        JOIN users u ON pl.user_id = u.id
        LEFT JOIN groups g ON u.group_id = g.id
        WHERE ${whereClause}
          AND strftime('%Y-%m', pl.created_at) = strftime('%Y-%m', 'now', 'localtime')
        GROUP BY u.id
        ORDER BY monthly_points DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      // 获取当前用户排名
      const myRow = db.prepare(`
        SELECT SUM(pl.points) as monthly_points
        FROM point_logs pl
        JOIN users u ON pl.user_id = u.id
        WHERE pl.user_id = ? AND strftime('%Y-%m', pl.created_at) = strftime('%Y-%m', 'now', 'localtime')
      `).get(userId);
      const myPoints = myRow.monthly_points || 0;

      const myRank = db.prepare(`
        SELECT COUNT(*) as rank FROM (
          SELECT pl.user_id, SUM(pl.points) as pts
          FROM point_logs pl
          JOIN users u ON pl.user_id = u.id
          WHERE ${whereClause}
            AND strftime('%Y-%m', pl.created_at) = strftime('%Y-%m', 'now', 'localtime')
          GROUP BY pl.user_id
        ) sub WHERE sub.pts > ?
      `).get(...params, myPoints);

      const list = ranking.map((item, index) => ({
        ...item,
        rank: offset + index + 1,
        points: item.monthly_points
      }));

      return res.json({
        code: 0,
        data: {
          list, total, page: parseInt(page), pageSize: limit,
          my_rank: myRank ? myRank.rank + 1 : 1,
          my_points: myPoints
        }
      });
    }

    // 全局/分组：按 users 表总积分
    const whereClause = conditions.join(' AND ');
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM users u WHERE ${whereClause}
    `).get(...params).count;

    const ranking = db.prepare(`
      SELECT u.id, u.real_name, u.avatar, u.points, u.group_id, g.name as group_name
      FROM users u
      LEFT JOIN groups g ON u.group_id = g.id
      WHERE ${whereClause}
      ORDER BY u.points DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // 获取当前用户排名
    const userPoints = db.prepare('SELECT points FROM users WHERE id = ?').get(userId).points;
    const myRank = db.prepare(`
      SELECT COUNT(*) as rank FROM users u WHERE ${whereClause} AND u.points > ?
    `).get(...params, userPoints);

    const list = ranking.map((item, index) => ({
      ...item,
      rank: offset + index + 1
    }));

    res.json({
      code: 0,
      data: {
        list, total, page: parseInt(page), pageSize: limit,
        my_rank: myRank ? myRank.rank + 1 : 1,
        my_points: userPoints
      }
    });
  } catch (err) {
    console.error('[statistics/ranking] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 能力画像六维数据 ====================

/**
 * 计算指定用户的雷达图六维数据（合并查询版，一次 SQL 出全部结果）
 */
function calculateRadarData(db, userId) {
  // 合并查询：一次性获取所有统计数据
  const stats = db.prepare(`
    SELECT
      -- 产品考试平均分
      (SELECT ROUND(AVG(er.score), 1) FROM exam_records er JOIN exams e ON er.exam_id = e.id
       WHERE er.user_id = @uid AND er.status IN ('submitted','graded')
       AND EXISTS (SELECT 1 FROM exam_questions eq JOIN questions q ON eq.question_id = q.id
       WHERE eq.exam_id = e.id AND (q.category LIKE '%产品%' OR q.category LIKE '%product%'))) as product_exam_score,
      -- 产品课程总数
      (SELECT COUNT(*) FROM courses WHERE status = 'published' AND (category LIKE '%产品%' OR category LIKE '%product%')) as total_product_courses,
      -- 完成产品课程数
      (SELECT COUNT(*) FROM learning_progress lp JOIN courses c ON lp.course_id = c.id
       WHERE lp.user_id = @uid AND lp.completed = 1 AND (c.category LIKE '%产品%' OR c.category LIKE '%product%')) as completed_product_courses,
      -- 销售考试平均分
      (SELECT ROUND(AVG(er.score), 1) FROM exam_records er JOIN exams e ON er.exam_id = e.id
       WHERE er.user_id = @uid AND er.status IN ('submitted','graded')
       AND EXISTS (SELECT 1 FROM exam_questions eq JOIN questions q ON eq.question_id = q.id
       WHERE eq.exam_id = e.id AND (q.category LIKE '%销售%' OR q.category LIKE '%sales%'))) as sales_exam_score,
      -- 销售课程总数
      (SELECT COUNT(*) FROM courses WHERE status = 'published' AND (category LIKE '%销售%' OR category LIKE '%sales%')) as total_sales_courses,
      -- 完成销售课程数
      (SELECT COUNT(*) FROM learning_progress lp JOIN courses c ON lp.course_id = c.id
       WHERE lp.user_id = @uid AND lp.completed = 1 AND (c.category LIKE '%销售%' OR c.category LIKE '%sales%')) as completed_sales_courses,
      -- 陪练平均分
      (SELECT ROUND(AVG(tr.total_score), 1) FROM training_reports tr WHERE tr.user_id = @uid) as training_avg_score,
      -- 制度考试平均分
      (SELECT ROUND(AVG(er.score), 1) FROM exam_records er JOIN exams e ON er.exam_id = e.id
       WHERE er.user_id = @uid AND er.status IN ('submitted','graded')
       AND EXISTS (SELECT 1 FROM exam_questions eq JOIN questions q ON eq.question_id = q.id
       WHERE eq.exam_id = e.id AND (q.category LIKE '%制度%' OR q.category LIKE '%公司%'))) as policy_exam_score,
      -- 全部完成课程数
      (SELECT COUNT(*) FROM learning_progress WHERE user_id = @uid AND completed = 1) as all_completed_courses,
      -- 全部课程数
      (SELECT COUNT(*) FROM courses WHERE status = 'published') as all_total_courses,
      -- 总学习时长（秒）
      (SELECT COALESCE(SUM(lp.watch_time), 0) FROM learning_progress lp WHERE lp.user_id = @uid) as total_watch_time
  `).get({ uid: userId });

  const productExamScore = stats.product_exam_score || 0;
  const totalProductCourses = stats.total_product_courses || 0;
  const completedProductCourses = stats.completed_product_courses || 0;
  const salesExamScore = stats.sales_exam_score || 0;
  const totalSalesCourses = stats.total_sales_courses || 0;
  const completedSalesCourses = stats.completed_sales_courses || 0;
  const trainingAvgScore = stats.training_avg_score || 0;
  const policyExamScore = stats.policy_exam_score || 0;
  const allCompletedCourses = stats.all_completed_courses || 0;
  const allTotalCourses = stats.all_total_courses || 0;
  const totalWatchTime = stats.total_watch_time || 0;

  // 计算指标
  const productCourseRate = totalProductCourses > 0 ? (completedProductCourses / totalProductCourses) * 100 : 0;
  const productKnowledge = Math.round((productExamScore * 0.6) + (productCourseRate * 0.4));
  const salesCourseRate = totalSalesCourses > 0 ? (completedSalesCourses / totalSalesCourses) * 100 : 0;
  const salesSkill = Math.round((salesExamScore * 0.3) + (salesCourseRate * 0.3) + (trainingAvgScore * 0.4));
  const commScore = calculateTrainingDimensionAvg(db, userId, '沟通表达', 60);
  const customerScore = calculateTrainingDimensionAvg(db, userId, '客户关系', 55);
  const policyUnderstanding = Math.round(policyExamScore);
  const overallCourseRate = allTotalCourses > 0 ? (allCompletedCourses / allTotalCourses) * 100 : 0;
  const totalHours = Math.round(totalWatchTime / 3600 * 10) / 10;
  const timeScore = Math.min(100, Math.round((totalHours / 20) * 100));
  const learningAttitude = Math.round((overallCourseRate * 0.6) + (timeScore * 0.4));

  const dimensions = [
    { name: '产品知识', score: clamp(productKnowledge, 0, 100), fullMark: 100 },
    { name: '销售技巧', score: clamp(salesSkill, 0, 100), fullMark: 100 },
    { name: '沟通能力', score: clamp(commScore, 0, 100), fullMark: 100 },
    { name: '客户管理', score: clamp(customerScore, 0, 100), fullMark: 100 },
    { name: '制度理解', score: clamp(policyUnderstanding, 0, 100), fullMark: 100 },
    { name: '学习态度', score: clamp(learningAttitude, 0, 100), fullMark: 100 }
  ];

  const detail = {
    product_knowledge: {
      exam_avg_score: productExamScore,
      course_completion_rate: Math.round(productCourseRate),
      total_courses: totalProductCourses,
      completed_courses: completedProductCourses
    },
    sales_skill: {
      exam_avg_score: salesExamScore,
      course_completion_rate: Math.round(salesCourseRate),
      training_avg_score: trainingAvgScore,
      total_courses: totalSalesCourses,
      completed_courses: completedSalesCourses
    },
    communication: { training_dimension_avg: commScore },
    customer_management: { training_dimension_avg: customerScore },
    policy_understanding: { exam_avg_score: policyExamScore },
    learning_attitude: {
      course_completion_rate: Math.round(overallCourseRate),
      total_watch_hours: totalHours,
      completed_courses: allCompletedCourses,
      total_courses: allTotalCourses
    }
  };

  return { dimensions, detail };
}

// GET /radar - 六维能力画像
router.get('/radar', authRequired, (req, res) => {
  try {
    const db = req.db;
    const data = calculateRadarData(db, req.user.id);
    res.json({ code: 0, data });
  } catch (err) {
    console.error('[statistics/radar] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * 从 training_reports 的 dimensions JSON 中取某个维度的平均分
 */
function calculateTrainingDimensionAvg(db, userId, dimensionName, defaultScore) {
  const reports = db.prepare(`
    SELECT tr.dimensions FROM training_reports tr WHERE tr.user_id = ?
  `).all(userId);

  if (reports.length === 0) return defaultScore;

  let totalScore = 0;
  let count = 0;

  for (const report of reports) {
    const dims = safeJsonParse(report.dimensions, []);
    for (const dim of dims) {
      if (dim.name === dimensionName && typeof dim.score === 'number') {
        totalScore += dim.score;
        count++;
      }
    }
  }

  return count > 0 ? Math.round(totalScore / count) : defaultScore;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ==================== 积分规则 ====================

// GET /point-rules - 积分获取规则
router.get('/point-rules', authRequired, (req, res) => {
  try {
    const db = req.db;
    const rules = db.prepare(`
      SELECT id, action, source_type, points, description, icon, enabled, sort_order
      FROM point_rules
      ORDER BY sort_order ASC
    `).all();
    res.json({ code: 0, data: rules });
  } catch (err) {
    console.error('[statistics/point-rules] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /point-rules/:id - 更新积分规则
router.put('/point-rules/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { points, description, enabled } = req.body;

    const existing = db.prepare('SELECT id FROM point_rules WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '规则不存在' });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE point_rules SET
        points = COALESCE(?, points),
        description = COALESCE(?, description),
        enabled = COALESCE(?, enabled),
        updated_at = ?
      WHERE id = ?
    `).run(
      points !== undefined ? points : null,
      description !== undefined ? description : null,
      enabled !== undefined ? enabled : null,
      now, id
    );

    const updated = db.prepare('SELECT * FROM point_rules WHERE id = ?').get(id);
    res.json({ code: 0, data: updated, message: '积分规则已更新' });
  } catch (err) {
    console.error('[statistics/point-rules/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 积分明细 ====================

// GET /point-details - 积分明细流水
router.get('/point-details', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const total = db.prepare('SELECT COUNT(*) as count FROM point_logs WHERE user_id = ?').get(userId).count;

    const logs = db.prepare(`
      SELECT id, points, reason, source_type, source_id, created_at
      FROM point_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);

    // 源类型映射
    const sourceTypeMap = {
      daily_question: '每日一题',
      learning: '完成课程',
      exam: '考试通过',
      training: 'AI陪练',
      manual_adjust: '管理员调整',
    };

    const list = logs.map(log => ({
      ...log,
      source_label: sourceTypeMap[log.source_type] || log.source_type,
    }));

    res.json({
      code: 0,
      data: { list, total, page: parseInt(page), pageSize: limit },
    });
  } catch (err) {
    console.error('[statistics/point-details] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 雷达维度管理 ====================

// GET /radar-dimensions - 获取雷达维度配置
router.get('/radar-dimensions', authRequired, (req, res) => {
  try {
    const db = req.db;
    const dims = db.prepare(`
      SELECT id, key, name, description, icon, weight, enabled, sort_order
      FROM radar_dimensions
      ORDER BY sort_order ASC
    `).all();
    res.json({ code: 0, data: dims });
  } catch (err) {
    console.error('[statistics/radar-dimensions] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /radar-dimensions/:id - 更新雷达维度
router.put('/radar-dimensions/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { name, description, icon, weight, enabled, sort_order } = req.body;

    const existing = db.prepare('SELECT id FROM radar_dimensions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '维度不存在' });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE radar_dimensions SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        icon = COALESCE(?, icon),
        weight = COALESCE(?, weight),
        enabled = COALESCE(?, enabled),
        sort_order = COALESCE(?, sort_order),
        updated_at = ?
      WHERE id = ?
    `).run(
      name || null,
      description !== undefined ? description : null,
      icon || null,
      weight !== undefined ? weight : null,
      enabled !== undefined ? enabled : null,
      sort_order !== undefined ? sort_order : null,
      now, id
    );

    const updated = db.prepare('SELECT * FROM radar_dimensions WHERE id = ?').get(id);
    res.json({ code: 0, data: updated, message: '维度已更新' });
  } catch (err) {
    console.error('[statistics/radar-dimensions/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /radar-dimensions - 新增雷达维度
router.post('/radar-dimensions', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { key, name, description, icon, weight, sort_order } = req.body;

    if (!key || !name) {
      return res.status(400).json({ code: 400, message: 'key 和 name 为必填项' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO radar_dimensions (id, key, name, description, icon, weight, enabled, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(id, key, name, description || '', icon || 'star', weight || 1.0, sort_order || 99, now, now);

    const created = db.prepare('SELECT * FROM radar_dimensions WHERE id = ?').get(id);
    res.json({ code: 0, data: created, message: '维度已创建' });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(400).json({ code: 400, message: '维度 key 已存在' });
    }
    console.error('[statistics/radar-dimensions/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /radar-dimensions/:id - 删除雷达维度
router.delete('/radar-dimensions/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    db.prepare('DELETE FROM radar_dimensions WHERE id = ?').run(id);
    res.json({ code: 0, message: '维度已删除' });
  } catch (err) {
    console.error('[statistics/radar-dimensions/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 管理员查看业务员画像 ====================

// GET /user-profile/:userId - 管理员查看指定业务员的画像
router.get('/user-profile/:userId', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { userId } = req.params;

    // 用户基本信息
    const user = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.role, u.phone, u.email, u.points,
             u.created_at, g.name as group_name
      FROM users u LEFT JOIN groups g ON u.group_id = g.id
      WHERE u.id = ?
    `).get(userId);

    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }

    // 获取雷达图数据
    const radarData = calculateRadarData(db, userId);

    // 学习统计
    const stats = {
      total_courses: db.prepare("SELECT COUNT(*) as c FROM courses WHERE status = 'published'").get().c,
      completed_courses: db.prepare('SELECT COUNT(*) as c FROM learning_progress WHERE user_id = ? AND completed = 1').get(userId).c,
      total_exams: db.prepare(`
        SELECT COUNT(DISTINCT er.exam_id) as c FROM exam_records er WHERE er.user_id = ?
      `).get(userId).c,
      passed_exams: db.prepare(`
        SELECT COUNT(DISTINCT er.exam_id) as c FROM exam_records er
        JOIN exams e ON er.exam_id = e.id
        WHERE er.user_id = ? AND er.score >= e.pass_score
      `).get(userId).c,
      total_training: db.prepare(`
        SELECT COUNT(*) as c FROM training_sessions WHERE user_id = ? AND status = 'completed'
      `).get(userId).c,
      total_points: user.points || 0,
      total_watch_hours: Math.round(
        (db.prepare("SELECT COALESCE(SUM(watch_time),0) as t FROM learning_progress WHERE user_id=?").get(userId).t / 3600) * 10
      ) / 10,
    };

    // 最近活动
    const recentLogs = db.prepare(`
      SELECT action, module, detail, created_at FROM activity_logs
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 10
    `).all(userId);

    res.json({
      code: 0,
      data: {
        user,
        radar: radarData,
        stats,
        recent_activities: recentLogs,
      },
    });
  } catch (err) {
    console.error('[statistics/user-profile] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /export-profiles - 批量导出业务员画像（CSV）
router.get('/export-profiles', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;

    // 获取所有业务员
    const salesUsers = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.phone, u.email, u.points,
             u.created_at, g.name as group_name
      FROM users u LEFT JOIN groups g ON u.group_id = g.id
      WHERE u.role = 'sales'
      ORDER BY u.real_name ASC
    `).all();

    // 获取雷达维度
    const dims = db.prepare(`
      SELECT key, name FROM radar_dimensions WHERE enabled = 1 ORDER BY sort_order ASC
    `).all();

    // CSV header
    const headers = ['用户名', '姓名', '分组', '手机', '邮箱', '总积分', '完成课程', '通过考试', '陪练次数', '学习时长(小时)'];
    dims.forEach(d => headers.push(d.name));

    const rows = [];

    for (const user of salesUsers) {
      // 学习统计
      const completedCourses = db.prepare('SELECT COUNT(*) as c FROM learning_progress WHERE user_id = ? AND completed = 1').get(user.id).c;
      const totalCourses = db.prepare("SELECT COUNT(*) as c FROM courses WHERE status = 'published'").get().c;
      const passedExams = db.prepare(`
        SELECT COUNT(DISTINCT er.exam_id) as c FROM exam_records er
        JOIN exams e ON er.exam_id = e.id
        WHERE er.user_id = ? AND er.score >= e.pass_score
      `).get(user.id).c;
      const totalExams = db.prepare(`
        SELECT COUNT(DISTINCT er.exam_id) as c FROM exam_records er WHERE er.user_id = ?
      `).get(user.id).c;
      const totalTraining = db.prepare(`
        SELECT COUNT(*) as c FROM training_sessions WHERE user_id = ? AND status = 'completed'
      `).get(user.id).c;
      const totalWatchHours = Math.round(
        (db.prepare("SELECT COALESCE(SUM(watch_time),0) as t FROM learning_progress WHERE user_id=?").get(user.id).t / 3600) * 10
      ) / 10;

      const row = [
        user.username || '',
        user.real_name || '',
        user.group_name || '',
        user.phone || '',
        user.email || '',
        user.points || 0,
        `${completedCourses}/${totalCourses}`,
        `${passedExams}/${totalExams}`,
        totalTraining,
        totalWatchHours,
      ];

      // 雷达维度分数
      try {
        const radarData = calculateRadarData(db, user.id);
        if (radarData?.dimensions) {
          for (const dim of dims) {
            const found = radarData.dimensions.find(d => d.name === dim.name);
            row.push(found ? found.score : 0);
          }
        } else {
          dims.forEach(() => row.push(0));
        }
      } catch (e) {
        dims.forEach(() => row.push(0));
      }

      rows.push(row);
    }

    // 生成 CSV
    const csvEscape = (val) => {
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const csvLines = [headers.map(csvEscape).join(',')];
    for (const row of rows) {
      csvLines.push(row.map(csvEscape).join(','));
    }

    const csv = '\uFEFF' + csvLines.join('\n'); // BOM for Excel Chinese support

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=profiles_' + new Date().toISOString().split('T')[0] + '.csv');
    res.send(csv);
  } catch (err) {
    console.error('[statistics/export-profiles] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
