/**
 * 管理端仪表盘路由
 * 表: users, courses, exams, questions, exam_records, learning_progress,
 *     training_sessions, training_reports, point_logs, activity_logs, groups
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');

// ==================== 辅助函数 ====================

function isAdmin(req) {
  return req.user && req.user.role === 'admin';
}

// ==================== 总览统计 ====================

// GET /overview - 总览统计
router.get('/overview', authRequired, (req, res) => {
  try {
    const db = req.db;
    const admin = isAdmin(req);

    // 基础数据（所有登录用户可见）
    const data = {};

    if (admin) {
      // 总用户数
      data.total_users = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count;

      // 活跃用户数（近30天有学习记录）
      data.active_users = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as count FROM activity_logs
        WHERE created_at >= datetime('now', '-30 days', 'localtime')
      `).get().count;

      // 本月新增用户
      data.new_users_this_month = db.prepare(`
        SELECT COUNT(*) as count FROM users
        WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
      `).get().count;
    }

    // 课程总数
    data.total_courses = db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get().count;

    // 考试总数
    data.total_exams = db.prepare("SELECT COUNT(*) as count FROM exams WHERE status = 'published'").get().count;

    // 题库总数
    data.total_questions = db.prepare("SELECT COUNT(*) as count FROM questions WHERE status = 'active'").get().count;

    // 陪练情景总数
    data.total_scenarios = db.prepare("SELECT COUNT(*) as count FROM training_scenarios WHERE status = 'active'").get().count;

    // 上月新增课程
    data.new_courses_this_month = db.prepare(`
      SELECT COUNT(*) as count FROM courses
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') AND status = 'published'
    `).get().count;

    // 上月新增考试
    data.new_exams_this_month = db.prepare(`
      SELECT COUNT(*) as count FROM exams
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') AND status = 'published'
    `).get().count;

    // 变化趋势（上月新增）
    data.user_change = data.new_users_this_month || null;
    data.active_change = db.prepare(`
      SELECT COUNT(*) as count FROM activity_logs
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
    `).get().count || null;
    data.course_change = data.new_courses_this_month || null;
    data.exam_change = data.new_exams_this_month || null;

    res.json({ code: 0, data });
  } catch (err) {
    console.error('[dashboard/overview] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 积分排行榜 ====================

// GET /rankings - 积分排行榜 top 20
router.get('/rankings', authRequired, (req, res) => {
  try {
    const db = req.db;

    const rankings = db.prepare(`
      SELECT u.id, u.real_name, u.avatar, u.points, u.group_id,
             g.name as group_name
      FROM users u
      LEFT JOIN groups g ON u.group_id = g.id
      WHERE u.status = 'active'
      ORDER BY u.points DESC
      LIMIT 20
    `).all();

    const list = rankings.map((item, index) => ({
      ...item,
      rank: index + 1
    }));

    res.json({ code: 0, data: { list } });
  } catch (err) {
    console.error('[dashboard/rankings] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 学习活跃度 ====================

// GET /learning-activity - 最近30天每天的学习人数
router.get('/learning-activity', authRequired, (req, res) => {
  try {
    const db = req.db;

    const activityData = db.prepare(`
      SELECT date(al.created_at) as date, COUNT(DISTINCT al.user_id) as count
      FROM activity_logs al
      WHERE al.created_at >= datetime('now', '-30 days', 'localtime')
      GROUP BY date
      ORDER BY date ASC
    `).all();

    // 补全30天
    const result = [];
    const activityMap = {};
    for (const item of activityData) {
      activityMap[item.date] = item.count;
    }

    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      result.push({
        date: dateStr,
        count: activityMap[dateStr] || 0
      });
    }

    res.json({ code: 0, data: result });
  } catch (err) {
    console.error('[dashboard/learning-activity] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 考试统计 ====================

// GET /exam-stats - 考试统计
router.get('/exam-stats', authRequired, (req, res) => {
  try {
    const db = req.db;

    // 总考试次数
    const overview = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) as passed,
             ROUND(AVG(er.score), 1) as avg_score
      FROM exam_records er
      WHERE er.status IN ('submitted', 'graded')
    `).get();

    // 各考试参与人数
    const examDetails = db.prepare(`
      SELECT e.id, e.title,
             COUNT(DISTINCT er.user_id) as participant_count,
             COUNT(er.id) as attempt_count,
             ROUND(AVG(er.score), 1) as avg_score,
             SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) as passed_count
      FROM exams e
      LEFT JOIN exam_records er ON e.id = er.exam_id AND er.status IN ('submitted', 'graded')
      WHERE e.status = 'published'
      GROUP BY e.id
      ORDER BY participant_count DESC
    `).all();

    res.json({
      code: 0,
      data: {
        total_count: overview.total,
        pass_rate: overview.total > 0 ? Math.round((overview.passed / overview.total) * 100) : 0,
        avg_score: overview.avg_score || 0,
        exams: examDetails
      }
    });
  } catch (err) {
    console.error('[dashboard/exam-stats] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 热门课程 ====================

// GET /popular-courses - 热门课程 top 10
router.get('/popular-courses', authRequired, (req, res) => {
  try {
    const db = req.db;

    const courses = db.prepare(`
      SELECT c.id, c.title, c.title as name, c.cover_url as cover, c.category, c.type as difficulty,
             COUNT(DISTINCT lp.user_id) as exam_count
      FROM courses c
      LEFT JOIN learning_progress lp ON c.id = lp.course_id
      WHERE c.status = 'published'
      GROUP BY c.id
      ORDER BY exam_count DESC
      LIMIT 10
    `).all();

    const list = courses.map((item, index) => ({
      ...item,
      rank: index + 1
    }));

    res.json({ code: 0, data: { list } });
  } catch (err) {
    console.error('[dashboard/popular-courses] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 最近操作动态 ====================

// GET /recent-activities - 最近操作动态 top 20
router.get('/recent-activities', authRequired, (req, res) => {
  try {
    const db = req.db;

    const activities = db.prepare(`
      SELECT al.id, al.user_id, al.action, al.module, al.target_type,
             al.target_id, al.detail, al.ip, al.created_at,
             u.real_name as user_name, u.avatar as operator_avatar
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 20
    `).all();

    const list = activities.map(a => ({
      ...a,
      detail: (() => { try { return JSON.parse(a.detail || '{}'); } catch (_) { return a.detail; } })()
    }));

    res.json({ code: 0, data: { list } });
  } catch (err) {
    console.error('[dashboard/recent-activities] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
