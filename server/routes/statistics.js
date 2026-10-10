/**
 * 学习统计路由（sales端个人统计）
 * 表: users, learning_progress, courses, exam_records, exams, exam_questions, questions,
 *     training_sessions, training_reports, training_messages, point_logs, activity_logs, groups
 */
const express = require('express');
const { nowShanghaiString, formatShanghai, dateFilename, dateDaysAgoShanghai } = require('../utils/time');
const { getLevelInfo } = require('../utils/levels');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired, systemAdminRequired, getOrgUserScope } = require('../middleware/auth');

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
    const user = db.prepare('SELECT id, real_name, points, total_earned_points, group_id FROM users WHERE id = ?').get(userId);

    // 总积分
    const totalPoints = user.points || 0;
    const totalEarned = user.total_earned_points || 0;

    // 称号等级
    const levelInfo = getLevelInfo(totalEarned);

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

    // FU利陪陪次数
    const trainingCount = db.prepare(`
      SELECT COUNT(*) as count FROM training_sessions WHERE user_id = ?
    `).get(userId).count;

    // FU利陪陪平均分
    const trainingAvg = db.prepare(`
      SELECT ROUND(AVG(tr.total_score), 1) as avg
      FROM training_reports tr
      WHERE tr.user_id = ?
    `).get(userId).avg || 0;

    // 排名（按累计获得积分，不受兑换影响）
    const ranking = db.prepare(`
      SELECT COUNT(*) as rank FROM users WHERE total_earned_points > ? AND status = 'active'
    `).get(totalEarned);
    const rank = ranking.rank + 1;

    res.json({
      code: 0,
      data: {
        total_points: totalPoints,
        total_earned_points: totalEarned,
        level: levelInfo,
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
        date: dateDaysAgoShanghai(i * 7),
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

// GET /ranking - 积分排行，支持全局/本月维度
router.get('/ranking', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { dimension = 'global', page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);
    const userId = req.user.id;

    const conditions = ["u.status = 'active'"];
    const params = [];

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
        SELECT u.id, u.real_name, u.avatar, r.name as region_name,
               SUM(pl.points) as monthly_points
        FROM point_logs pl
        JOIN users u ON pl.user_id = u.id
        LEFT JOIN regions r ON u.region_id = r.id
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

    // 全局/分组：按 users 表累计获得积分（不受兑换影响）
    const whereClause = conditions.join(' AND ');
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM users u WHERE ${whereClause}
    `).get(...params).count;

    const ranking = db.prepare(`
      SELECT u.id, u.real_name, u.avatar, u.total_earned_points, u.points, r.name as region_name
      FROM users u
      LEFT JOIN regions r ON u.region_id = r.id
      WHERE ${whereClause}
      ORDER BY u.total_earned_points DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // 获取当前用户累计积分与排名
    const userRow = db.prepare('SELECT total_earned_points, points FROM users WHERE id = ?').get(userId);
    const userEarned = (userRow && userRow.total_earned_points) || 0;
    const myRank = db.prepare(`
      SELECT COUNT(*) as rank FROM users u WHERE ${whereClause} AND u.total_earned_points > ?
    `).get(...params, userEarned);

    const list = ranking.map((item, index) => {
      const lv = getLevelInfo(item.total_earned_points);
      return {
        ...item,
        rank: offset + index + 1,
        points: item.total_earned_points,
        level: lv.level,
        title: lv.title,
      };
    });

    res.json({
      code: 0,
      data: {
        list, total, page: parseInt(page), pageSize: limit,
        my_rank: myRank ? myRank.rank + 1 : 1,
        my_points: userEarned
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
  // 合并查询：一次性获取所有统计数据（sql.js 用 ? 位置参数，不能用 @uid 命名参数）
  const stats = db.prepare(`
    SELECT
      -- 产品考试平均分
      (SELECT ROUND(AVG(er.score), 1) FROM exam_records er JOIN exams e ON er.exam_id = e.id
       WHERE er.user_id = ? AND er.status IN ('submitted','graded')
       AND EXISTS (SELECT 1 FROM exam_questions eq JOIN questions q ON eq.question_id = q.id
       WHERE eq.exam_id = e.id AND (q.category LIKE '%产品%' OR q.category LIKE '%product%'))) as product_exam_score,
      -- 产品课程总数
      (SELECT COUNT(*) FROM courses WHERE status = 'published' AND (category LIKE '%产品%' OR category LIKE '%product%')) as total_product_courses,
      -- 完成产品课程数
      (SELECT COUNT(*) FROM learning_progress lp JOIN courses c ON lp.course_id = c.id
       WHERE lp.user_id = ? AND lp.completed = 1 AND (c.category LIKE '%产品%' OR c.category LIKE '%product%')) as completed_product_courses,
      -- 销售考试平均分
      (SELECT ROUND(AVG(er.score), 1) FROM exam_records er JOIN exams e ON er.exam_id = e.id
       WHERE er.user_id = ? AND er.status IN ('submitted','graded')
       AND EXISTS (SELECT 1 FROM exam_questions eq JOIN questions q ON eq.question_id = q.id
       WHERE eq.exam_id = e.id AND (q.category LIKE '%销售%' OR q.category LIKE '%sales%'))) as sales_exam_score,
      -- 销售课程总数
      (SELECT COUNT(*) FROM courses WHERE status = 'published' AND (category LIKE '%销售%' OR category LIKE '%sales%')) as total_sales_courses,
      -- 完成销售课程数
      (SELECT COUNT(*) FROM learning_progress lp JOIN courses c ON lp.course_id = c.id
       WHERE lp.user_id = ? AND lp.completed = 1 AND (c.category LIKE '%销售%' OR c.category LIKE '%sales%')) as completed_sales_courses,
      -- FU利陪陪平均分
      (SELECT ROUND(AVG(tr.total_score), 1) FROM training_reports tr WHERE tr.user_id = ?) as training_avg_score,
      -- 全部完成课程数
      (SELECT COUNT(*) FROM learning_progress WHERE user_id = ? AND completed = 1) as all_completed_courses,
      -- 全部课程数
      (SELECT COUNT(*) FROM courses WHERE status = 'published') as all_total_courses,
      -- 总学习时长（秒）
      (SELECT COALESCE(SUM(lp.watch_time), 0) FROM learning_progress lp WHERE lp.user_id = ?) as total_watch_time
  `).get(userId, userId, userId, userId, userId, userId, userId);

  const productExamScore = stats.product_exam_score || 0;
  const totalProductCourses = stats.total_product_courses || 0;
  const completedProductCourses = stats.completed_product_courses || 0;
  const salesExamScore = stats.sales_exam_score || 0;
  const totalSalesCourses = stats.total_sales_courses || 0;
  const completedSalesCourses = stats.completed_sales_courses || 0;
  const trainingAvgScore = stats.training_avg_score || 0;
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
  const customerCareScore = calculateTrainingDimensionAvg(db, userId, '客情维护', 50);
  const overallCourseRate = allTotalCourses > 0 ? (allCompletedCourses / allTotalCourses) * 100 : 0;
  const totalHours = Math.round(totalWatchTime / 3600 * 10) / 10;
  const timeScore = Math.min(100, Math.round((totalHours / 20) * 100));
  const learningAttitude = Math.round((overallCourseRate * 0.6) + (timeScore * 0.4));

  const dimensions = [
    { name: '产品知识', score: clamp(productKnowledge, 0, 100), fullMark: 100 },
    { name: '销售技巧', score: clamp(salesSkill, 0, 100), fullMark: 100 },
    { name: '沟通能力', score: clamp(commScore, 0, 100), fullMark: 100 },
    { name: '客户管理', score: clamp(customerScore, 0, 100), fullMark: 100 },
    { name: '客情维护', score: clamp(customerCareScore, 0, 100), fullMark: 100 },
    { name: '学习投入', score: clamp(learningAttitude, 0, 100), fullMark: 100 }
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
    customer_care: { training_dimension_avg: customerCareScore },
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

// 角色筛选条件（区分业务员/大区经理/区域经理/客户经理）
function buildRoleClause(roleType) {
  switch (roleType) {
    case 'region_manager': return "u.manager_type = 'region_manager'";
    case 'area_manager': return "u.manager_type = 'area_manager'";
    case 'city_manager': return "u.manager_type = 'city_manager'";
    case 'sales':
    default: return "u.role = 'sales' AND (u.manager_type IS NULL OR u.manager_type = '')";
  }
}

// ==================== 管理端用户统计 ====================
router.get('/admin-user-summary', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { keyword = '', area_id = '', region_id = '', city_id = '', role_type = '', active = '', page = 1, pageSize = 20 } = req.query;
    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const scope = getOrgUserScope(db, actor, 'u');
    const conditions = [`${scope.clause}`, buildRoleClause(role_type), "u.status = 'active'"];
    const params = [...scope.params];

    if (keyword) {
      conditions.push('(u.username LIKE ? OR u.real_name LIKE ? OR u.phone LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (area_id) {
      conditions.push('u.region_id IN (SELECT id FROM regions WHERE id = ? OR parent_id = ?)');
      params.push(area_id, area_id);
    }
    if (region_id) {
      conditions.push('u.region_id = ?');
      params.push(region_id);
    }
    if (city_id) {
      conditions.push('u.city_id = ?');
      params.push(city_id);
    }
    // 活跃度筛选：active=7/30 表示近 N 天有操作记录，active=inactive 表示近 30 天无任何记录
    const activeDays = parseInt(active, 10);
    if (active === 'inactive') {
      conditions.push(`NOT EXISTS (SELECT 1 FROM activity_logs al WHERE al.user_id = u.id AND al.created_at >= datetime('now', '-30 days', 'localtime'))`);
    } else if (Number.isFinite(activeDays) && activeDays > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM activity_logs al WHERE al.user_id = u.id AND al.created_at >= datetime('now', '-${activeDays} days', 'localtime'))`);
    }

    const where = conditions.join(' AND ');
    const count = db.prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`).get(...params).total;
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total_users,
        COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM learning_progress lp WHERE lp.user_id = u.id AND lp.completed = 1) THEN 1 ELSE 0 END), 0) AS users_completed_course,
        COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM exam_records er WHERE er.user_id = u.id AND er.status IN ('submitted', 'graded')) THEN 1 ELSE 0 END), 0) AS users_taken_exam,
        COALESCE(SUM(u.points), 0) AS total_points,
        COALESCE(SUM(u.total_earned_points), 0) AS total_earned_points
      FROM users u WHERE ${where}
    `).get(...params);

    const pageNum = Math.max(1, Number(page));
    const size = Math.min(100, Math.max(1, Number(pageSize)));
    const rows = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.phone, u.points, u.total_earned_points,
             u.role, u.manager_type, u.dealer_name,
             (SELECT MAX(al.created_at) FROM activity_logs al WHERE al.user_id = u.id) AS last_active_at,
             r.name AS region_name, c.name AS city_name,
             (SELECT COUNT(*) FROM learning_progress lp WHERE lp.user_id = u.id AND lp.completed = 1) AS completed_courses,
             (SELECT COUNT(*) FROM exam_records er WHERE er.user_id = u.id AND er.status IN ('submitted', 'graded')) AS exam_count,
             (SELECT COUNT(*) FROM exam_records er WHERE er.user_id = u.id AND er.passed = 1 AND er.status IN ('submitted', 'graded')) AS passed_exam_count,
             (SELECT COUNT(*) FROM training_sessions ts WHERE ts.user_id = u.id) AS training_count,
             (SELECT COUNT(*) FROM check_ins ci WHERE ci.user_id = u.id) AS checkin_count
      FROM users u
      LEFT JOIN regions r ON r.id = u.region_id
      LEFT JOIN cities c ON c.id = u.city_id
      WHERE ${where}
      ORDER BY u.real_name ASC, u.username ASC
      LIMIT ? OFFSET ?
    `).all(...params, size, (pageNum - 1) * size);

    res.json({
      code: 0,
      data: {
        summary: {
          total_users: summary.total_users || 0,
          users_completed_course: summary.users_completed_course || 0,
          users_taken_exam: summary.users_taken_exam || 0,
          total_points: summary.total_points || 0,
          total_earned_points: summary.total_earned_points || 0
        },
        list: rows,
        total: count,
        page: pageNum,
        pageSize: size
      }
    });
  } catch (err) {
    console.error('[statistics/admin-user-summary] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /admin-user-summary/export - 导出当前权限和筛选范围内用户统计
router.get('/admin-user-summary/export', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { keyword = '', area_id = '', region_id = '', city_id = '', role_type = '', active = '' } = req.query;
    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const scope = getOrgUserScope(db, actor, 'u');
    const conditions = [scope.clause, buildRoleClause(role_type), "u.status = 'active'"];
    const params = [...scope.params];
    if (keyword) {
      conditions.push('(u.username LIKE ? OR u.real_name LIKE ? OR u.phone LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (area_id) {
      conditions.push('u.region_id IN (SELECT id FROM regions WHERE id = ? OR parent_id = ?)');
      params.push(area_id, area_id);
    }
    if (region_id) { conditions.push('u.region_id = ?'); params.push(region_id); }
    if (city_id) { conditions.push('u.city_id = ?'); params.push(city_id); }
    // 活跃度筛选（与列表接口口径一致）
    const activeDays = parseInt(active, 10);
    if (active === 'inactive') {
      conditions.push(`NOT EXISTS (SELECT 1 FROM activity_logs al WHERE al.user_id = u.id AND al.created_at >= datetime('now', '-30 days', 'localtime'))`);
    } else if (Number.isFinite(activeDays) && activeDays > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM activity_logs al WHERE al.user_id = u.id AND al.created_at >= datetime('now', '-${activeDays} days', 'localtime'))`);
    }
    const where = conditions.join(' AND ');
    const rows = db.prepare(`
      SELECT u.username, u.real_name, r.name AS region_name, c.name AS city_name,
             u.dealer_name,
             (SELECT MAX(al.created_at) FROM activity_logs al WHERE al.user_id = u.id) AS last_active_at,
             (SELECT COUNT(*) FROM learning_progress lp WHERE lp.user_id = u.id AND lp.completed = 1) AS completed_courses,
             (SELECT COUNT(*) FROM exam_records er WHERE er.user_id = u.id AND er.status IN ('submitted', 'graded')) AS exam_count,
             (SELECT COUNT(*) FROM exam_records er WHERE er.user_id = u.id AND er.passed = 1 AND er.status IN ('submitted', 'graded')) AS passed_exam_count,
             (SELECT COUNT(*) FROM training_sessions ts WHERE ts.user_id = u.id) AS training_count,
             (SELECT COUNT(*) FROM check_ins ci WHERE ci.user_id = u.id) AS checkin_count,
             u.points
      FROM users u
      LEFT JOIN regions r ON r.id = u.region_id
      LEFT JOIN cities c ON c.id = u.city_id
      WHERE ${where}
      ORDER BY u.real_name ASC, u.username ASC
    `).all(...params);
    const headers = ['姓名', '用户名', '所属大区', '细分区域/城市', '所属经销商', '完成课程数', '考试次数', '考试通过次数', 'FU利陪陪次数', '签到次数', '当前积分', '最近活跃时间'];
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers, ...rows.map((row) => [
      row.real_name, row.username, row.region_name, row.city_name || '', row.dealer_name || '',
      row.completed_courses, row.exam_count, row.passed_exam_count, row.training_count, row.checkin_count, row.points,
      row.last_active_at || '从未活跃'
    ])].map((line) => line.map(escapeCsv).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="user-statistics-${dateFilename()}.csv"`);
    res.send('\ufeff' + lines.join('\n'));
  } catch (err) {
    console.error('[statistics/admin-user-summary/export] Error:', err);
    res.status(500).json({ code: 500, message: '导出失败' });
  }
});

// ==================== 积分规则 ====================

// GET /point-rules - 积分获取规则
// ==================== 等级加成配置（L1-L5 积分倍率）====================
// GET /statistics/level-bonuses（登录用户可读，前端需展示升级后的加成权益）
router.get('/level-bonuses', authRequired, (req, res) => {
  try {
    const rows = req.db.prepare('SELECT level, multiplier, enabled FROM level_bonuses ORDER BY level ASC').all();
    res.json({ code: 0, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// PUT /statistics/level-bonuses/:level
router.put('/level-bonuses/:level', authRequired, systemAdminRequired, (req, res) => {
  try {
    const level = parseInt(req.params.level, 10);
    if (!level || level < 1 || level > 5) {
      return res.status(400).json({ code: 400, message: '等级无效（1-5）' });
    }
    const { multiplier, enabled } = req.body;
    const m = Number(multiplier);
    if (!Number.isFinite(m) || m < 1 || m > 5) {
      return res.status(400).json({ code: 400, message: '倍率需在 1 ~ 5 之间' });
    }
    req.db.prepare(
      "UPDATE level_bonuses SET multiplier = ?, enabled = COALESCE(?, enabled), updated_at = datetime('now','localtime') WHERE level = ?"
    ).run(m, enabled === undefined ? null : (enabled ? 1 : 0), level);
    const row = req.db.prepare('SELECT level, multiplier, enabled FROM level_bonuses WHERE level = ?').get(level);
    res.json({ code: 0, data: row });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/point-rules', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const rules = db.prepare(`
      SELECT id, action, source_type, points, description, icon, enabled, sort_order, daily_limit, daily_max_times
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
router.put('/point-rules/:id', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { points, description, enabled, daily_limit, daily_max_times } = req.body;

    const existing = db.prepare('SELECT id FROM point_rules WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '规则不存在' });
    }

    const now = nowShanghaiString();
    db.prepare(`
      UPDATE point_rules SET
        points = COALESCE(?, points),
        description = COALESCE(?, description),
        enabled = COALESCE(?, enabled),
        daily_limit = COALESCE(?, daily_limit),
        daily_max_times = COALESCE(?, daily_max_times),
        updated_at = ?
      WHERE id = ?
    `).run(
      points !== undefined ? points : null,
      description !== undefined ? description : null,
      enabled !== undefined ? enabled : null,
      daily_limit !== undefined ? (Number(daily_limit) || 0) : null,
      daily_max_times !== undefined ? (Number(daily_max_times) || 0) : null,
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
      training: 'FU利陪陪',
      manual_adjust: '管理员调整',
      check_in: '每日签到',
      share_post: '分享圈发帖',
      share_pin: '分享圈置顶',
      share_post_delete: '分享圈删帖',
      ai_ask: '跑店问问提问',
      ai_feedback: '跑店问问反馈',
      submission: '风采投稿',
      shop_exchange: '积分兑换',
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
router.get('/radar-dimensions', authRequired,
  systemAdminRequired, (req, res) => {
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
router.put('/radar-dimensions/:id', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { name, description, icon, weight, enabled, sort_order } = req.body;

    const existing = db.prepare('SELECT id FROM radar_dimensions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '维度不存在' });
    }

    const now = nowShanghaiString();
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
router.post('/radar-dimensions', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const { key, name, description, icon, weight, sort_order } = req.body;

    if (!key || !name) {
      return res.status(400).json({ code: 400, message: 'key 和 name 为必填项' });
    }

    const id = uuidv4();
    const now = nowShanghaiString();
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
router.delete('/radar-dimensions/:id', authRequired, systemAdminRequired, (req, res) => {
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

    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const scope = getOrgUserScope(db, actor, 'u');
    const targetAllowed = db.prepare(`SELECT u.id FROM users u WHERE u.id = ? AND ${scope.clause}`).get(userId, ...scope.params);
    if (!targetAllowed) return res.status(403).json({ code: 403, message: '无权查看该用户画像' });

    // 用户基本信息
    const user = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.role, u.phone, u.email, u.points, u.total_earned_points,
             u.created_at, u.dealer_name, r.name as region_name
      FROM users u LEFT JOIN regions r ON u.region_id = r.id
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
      total_points: db.prepare(`
        SELECT CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(points), 0) ELSE ? END AS c
        FROM point_logs WHERE user_id = ?
      `).get(user.points || 0, userId).c,
      total_earned_points: user.total_earned_points || 0,
      completed_course_details: db.prepare(`
        SELECT c.title, lp.completed_at
        FROM learning_progress lp
        JOIN courses c ON c.id = lp.course_id
        WHERE lp.user_id = ? AND lp.completed = 1
        ORDER BY lp.completed_at DESC, c.title ASC
      `).all(userId),
      exam_details: db.prepare(`
        SELECT e.title, er.score, er.passed, er.status,
               COALESCE(er.end_time, er.start_time, er.created_at) AS exam_date
        FROM exam_records er
        JOIN exams e ON e.id = er.exam_id
        WHERE er.user_id = ? AND er.status IN ('submitted', 'graded')
        ORDER BY exam_date DESC, e.title ASC
      `).all(userId),
      level: getLevelInfo(user.total_earned_points || 0),
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

    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const scope = getOrgUserScope(db, actor, 'u');
    const salesUsers = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.phone, u.email, u.points,
             u.total_earned_points, u.created_at, u.dealer_name
      FROM users u
      WHERE ${scope.clause}
      ORDER BY u.real_name ASC
    `).all(...scope.params);

    // 导出维度固定使用用户画像的六个标准维度，避免后台配置名称变化造成列错位
    const dims = [
      { key: 'product_knowledge', name: '产品知识' },
      { key: 'sales_skills', name: '销售技巧' },
      { key: 'communication', name: '沟通能力' },
      { key: 'customer_management', name: '客户管理' },
      { key: 'customer_care', name: '客情维护' },
      { key: 'learning_attitude', name: '学习投入' },
    ];

    // CSV header
    const headers = [
      '用户名', '姓名', '称号', '等级', '所属经销商', '手机', '邮箱',
      '当前积分', '累计获得积分', '完成课程', '完成课程日期',
      '通过考试', '考试日期', 'FU利陪陪次数', '学习时长(小时)'
    ];
    dims.forEach(d => headers.push(d.name));

    // ===== 批量聚合：把原来的「每个业务员逐条查询」压成个位数查询 =====
    // 原先每人约 13 条 SQL（5000+ 人 ≈ 7 万次），全部挤在主线程同步执行，
    // 会把事件循环卡死几十秒，导致导出请求超时、全站接口一起变慢。
    const ids = salesUsers.map(u => u.id);
    const ph = ids.map(() => '?').join(',');

    // 课程总数是常量，只查一次（原来放在循环里对每个人重复查询）
    const totalCourses = db.prepare("SELECT COUNT(*) c FROM courses WHERE status = 'published'").get().c;
    const totalProductCourses = db.prepare("SELECT COUNT(*) c FROM courses WHERE status = 'published' AND (category LIKE '%产品%' OR category LIKE '%product%')").get().c;
    const totalSalesCourses = db.prepare("SELECT COUNT(*) c FROM courses WHERE status = 'published' AND (category LIKE '%销售%' OR category LIKE '%sales%')").get().c;

    const indexByUser = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(r.user_id, r);
      return m;
    };
    const emptyMap = new Map();

    const lpMap = ids.length ? indexByUser(db.prepare(`
      SELECT lp.user_id,
             SUM(CASE WHEN lp.completed = 1 THEN 1 ELSE 0 END) AS completed_courses,
             COALESCE(SUM(lp.watch_time), 0) AS watch_time
      FROM learning_progress lp WHERE lp.user_id IN (${ph}) GROUP BY lp.user_id
    `).all(...ids)) : emptyMap;

    const lpCatMap = ids.length ? indexByUser(db.prepare(`
      SELECT lp.user_id,
             SUM(CASE WHEN lp.completed = 1 AND (c.category LIKE '%产品%' OR c.category LIKE '%product%') THEN 1 ELSE 0 END) AS completed_product,
             SUM(CASE WHEN lp.completed = 1 AND (c.category LIKE '%销售%' OR c.category LIKE '%sales%') THEN 1 ELSE 0 END) AS completed_sales
      FROM learning_progress lp JOIN courses c ON lp.course_id = c.id
      WHERE lp.user_id IN (${ph}) GROUP BY lp.user_id
    `).all(...ids)) : emptyMap;

    const examPassMap = ids.length ? indexByUser(db.prepare(`
      SELECT er.user_id, COUNT(DISTINCT er.exam_id) AS passed_exams
      FROM exam_records er JOIN exams e ON er.exam_id = e.id
      WHERE er.user_id IN (${ph}) AND er.score >= e.pass_score GROUP BY er.user_id
    `).all(...ids)) : emptyMap;

    const examTotalMap = ids.length ? indexByUser(db.prepare(`
      SELECT er.user_id, COUNT(DISTINCT er.exam_id) AS total_exams
      FROM exam_records er WHERE er.user_id IN (${ph}) GROUP BY er.user_id
    `).all(...ids)) : emptyMap;

    // 产品/销售考试平均分：先取含对应题目的考试集合，再按用户聚合
    const productExamIds = db.prepare(`
      SELECT DISTINCT eq.exam_id FROM exam_questions eq JOIN questions q ON eq.question_id = q.id
      WHERE q.category LIKE '%产品%' OR q.category LIKE '%product%'
    `).all().map(r => r.exam_id);
    const salesExamIds = db.prepare(`
      SELECT DISTINCT eq.exam_id FROM exam_questions eq JOIN questions q ON eq.question_id = q.id
      WHERE q.category LIKE '%销售%' OR q.category LIKE '%sales%'
    `).all().map(r => r.exam_id);
    const examAvgMap = (examIds) => {
      if (!ids.length || !examIds.length) return emptyMap;
      const eph = examIds.map(() => '?').join(',');
      return indexByUser(db.prepare(`
        SELECT er.user_id, ROUND(AVG(er.score), 1) AS avg_score
        FROM exam_records er
        WHERE er.user_id IN (${ph}) AND er.status IN ('submitted','graded') AND er.exam_id IN (${eph})
        GROUP BY er.user_id
      `).all(...ids, ...examIds));
    };
    const productExamMap = examAvgMap(productExamIds);
    const salesExamMap = examAvgMap(salesExamIds);

    const trainingSessionMap = ids.length ? indexByUser(db.prepare(`
      SELECT user_id, COUNT(*) AS c FROM training_sessions
      WHERE user_id IN (${ph}) AND status = 'completed' GROUP BY user_id
    `).all(...ids)) : emptyMap;

    const trainingAvgMap = ids.length ? indexByUser(db.prepare(`
      SELECT user_id, ROUND(AVG(total_score), 1) AS avg_score FROM training_reports
      WHERE user_id IN (${ph}) GROUP BY user_id
    `).all(...ids)) : emptyMap;

    // 陪练维度平均：一次取回全部报告，在 JS 里按维度聚合（原来每个维度都要重查一遍）
    const dimAgg = new Map();
    if (ids.length) {
      const reports = db.prepare(`SELECT user_id, dimensions FROM training_reports WHERE user_id IN (${ph})`).all(...ids);
      for (const rep of reports) {
        const list = safeJsonParse(rep.dimensions, []);
        if (!Array.isArray(list)) continue;
        let perUser = dimAgg.get(rep.user_id);
        if (!perUser) { perUser = {}; dimAgg.set(rep.user_id, perUser); }
        for (const d of list) {
          if (!d || !d.name || typeof d.score !== 'number') continue;
          const agg = perUser[d.name] || (perUser[d.name] = { sum: 0, count: 0 });
          agg.sum += d.score; agg.count += 1;
        }
      }
    }
    const dimAvgOf = (userId, name, fallback) => {
      const perUser = dimAgg.get(userId);
      const agg = perUser && perUser[name];
      return agg && agg.count > 0 ? Math.round(agg.sum / agg.count) : fallback;
    };

    const pointMap = ids.length ? indexByUser(db.prepare(`
      SELECT user_id, COALESCE(SUM(points), 0) AS total FROM point_logs
      WHERE user_id IN (${ph}) GROUP BY user_id
    `).all(...ids)) : emptyMap;

    const courseDetailMap = new Map();
    const examDetailMap = new Map();
    if (ids.length) {
      const pushDetail = (map, key, item) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
      };
      db.prepare(`
        SELECT lp.user_id, c.title, lp.completed_at
        FROM learning_progress lp JOIN courses c ON c.id = lp.course_id
        WHERE lp.user_id IN (${ph}) AND lp.completed = 1
        ORDER BY lp.completed_at ASC, c.title ASC
      `).all(...ids).forEach(r => pushDetail(courseDetailMap, r.user_id, r));
      db.prepare(`
        SELECT er.user_id, e.title, COALESCE(er.end_time, er.start_time, er.created_at) AS exam_date
        FROM exam_records er JOIN exams e ON e.id = er.exam_id
        WHERE er.user_id IN (${ph}) AND er.status IN ('submitted','graded')
        ORDER BY exam_date ASC, e.title ASC
      `).all(...ids).forEach(r => pushDetail(examDetailMap, r.user_id, r));
    }

    const pick = (map, id, key, dflt = 0) => {
      const r = map.get(id);
      return r && r[key] != null ? r[key] : dflt;
    };

    const formatDate = (value) => formatShanghai(value);
    const rows = [];

    for (const user of salesUsers) {
      const completedCourses = pick(lpMap, user.id, 'completed_courses', 0);
      const passedExams = pick(examPassMap, user.id, 'passed_exams', 0);
      const totalExams = pick(examTotalMap, user.id, 'total_exams', 0);
      const totalTraining = pick(trainingSessionMap, user.id, 'c', 0);
      const watchTime = pick(lpMap, user.id, 'watch_time', 0);
      const totalWatchHours = Math.round((watchTime / 3600) * 10) / 10;

      const levelInfo = getLevelInfo(user.total_earned_points || user.points || 0);
      const pointRow = pointMap.get(user.id);
      const pointTotal = pointRow ? pointRow.total : (user.points || 0);
      const completedCourseDetails = courseDetailMap.get(user.id) || [];
      const examDetails = examDetailMap.get(user.id) || [];

      const row = [
        user.username || '',
        user.real_name || '',
        levelInfo.title || '',
        levelInfo.level || 1,
        user.dealer_name || '',
        user.phone || '',
        user.email || '',
        pointTotal || 0,
        user.total_earned_points || 0,
        `${completedCourses}/${totalCourses}`,
        completedCourseDetails.map(item => `${item.title}（${formatDate(item.completed_at)}）`).join('；'),
        `${passedExams}/${totalExams}`,
        examDetails.map(item => `${item.title}（${formatDate(item.exam_date)}）`).join('；'),
        totalTraining,
        totalWatchHours,
      ];

      // 雷达六维（用批量聚合数据计算，口径与 calculateRadarData 保持一致）
      const productExamScore = pick(productExamMap, user.id, 'avg_score', 0) || 0;
      const salesExamScore = pick(salesExamMap, user.id, 'avg_score', 0) || 0;
      const trainingAvgScore = pick(trainingAvgMap, user.id, 'avg_score', 0) || 0;
      const lpCat = lpCatMap.get(user.id) || {};
      const productCourseRate = totalProductCourses > 0 ? ((lpCat.completed_product || 0) / totalProductCourses) * 100 : 0;
      const productKnowledge = Math.round((productExamScore * 0.6) + (productCourseRate * 0.4));
      const salesCourseRate = totalSalesCourses > 0 ? ((lpCat.completed_sales || 0) / totalSalesCourses) * 100 : 0;
      const salesSkill = Math.round((salesExamScore * 0.3) + (salesCourseRate * 0.3) + (trainingAvgScore * 0.4));
      const commScore = dimAvgOf(user.id, '沟通表达', 60);
      const customerScore = dimAvgOf(user.id, '客户关系', 55);
      const customerCareScore = dimAvgOf(user.id, '客情维护', 50);
      const overallCourseRate = totalCourses > 0 ? (completedCourses / totalCourses) * 100 : 0;
      const timeScore = Math.min(100, Math.round((totalWatchHours / 20) * 100));
      const learningAttitude = Math.round((overallCourseRate * 0.6) + (timeScore * 0.4));

      row.push(clamp(productKnowledge, 0, 100));
      row.push(clamp(salesSkill, 0, 100));
      row.push(clamp(commScore, 0, 100));
      row.push(clamp(customerScore, 0, 100));
      row.push(clamp(customerCareScore, 0, 100));
      row.push(clamp(learningAttitude, 0, 100));

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
    res.setHeader('Content-Disposition', 'attachment; filename=profiles_' + dateFilename() + '.csv');
    res.send(csv);
  } catch (err) {
    console.error('[statistics/export-profiles] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
