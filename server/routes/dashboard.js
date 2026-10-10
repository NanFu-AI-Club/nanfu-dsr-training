/**
 * 管理端仪表盘路由
 * 表: users, courses, exams, questions, exam_records, learning_progress,
 *     training_sessions, training_reports, point_logs, activity_logs, groups
 */
const express = require('express');
const { todayShanghai, dateDaysAgoShanghai } = require('../utils/time');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired, getOrgUserScope } = require('../middleware/auth');
const { getLevelInfo } = require('../utils/levels');
const { NOISY_ACTIONS, normalizeLog } = require('../utils/logFormatter');

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
    const scope = getOrgUserScope(db, req.user, 'u');

    // 基础数据（所有登录用户可见）
    const data = {};

    if (admin) {
      // 总用户数
      data.total_users = db.prepare(`SELECT COUNT(*) as count FROM users u WHERE u.status = 'active' AND ${scope.clause}`).get(...scope.params).count;

      // 活跃用户数（近30天有学习记录）
      data.active_users = db.prepare(`
        SELECT COUNT(DISTINCT al.user_id) as count FROM activity_logs al JOIN users u ON al.user_id = u.id
        WHERE ${scope.clause} AND al.created_at >= datetime('now', '-30 days', 'localtime')
      `).get(...scope.params).count;

      // 本月新增用户
      data.new_users_this_month = db.prepare(`
        SELECT COUNT(*) as count FROM users
        WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
      `).get().count;
    }

    // 课程总数
    data.total_courses = db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get().count;

    // 考试总数（已发布 + 进行中）
    data.total_exams = db.prepare("SELECT COUNT(*) as count FROM exams WHERE status IN ('published', 'ongoing')").get().count;

    // 题库总数
    data.total_questions = db.prepare("SELECT COUNT(*) as count FROM questions WHERE status = 'active'").get().count;

    // 陪练情景总数
    data.total_scenarios = db.prepare("SELECT COUNT(*) as count FROM training_scenarios WHERE status = 'active'").get().count;

    // 上月新增课程
    data.new_courses_this_month = db.prepare(`
      SELECT COUNT(*) as count FROM courses
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') AND status = 'published'
    `).get().count;

    // 本月新增考试（按创建时间）
    data.new_exams_this_month = db.prepare(`
      SELECT COUNT(*) as count FROM exams
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') AND status IN ('published', 'ongoing')
    `).get().count;

    // 今日签到人数
    data.today_checkins = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM check_ins
      WHERE date(check_date) = date('now', 'localtime')
    `).get().count;

    // 总积分发放量
    const pointRow = db.prepare(`
      SELECT COALESCE(SUM(points), 0) as total FROM point_logs
    `).get();
    data.total_points = pointRow ? pointRow.total : 0;

    // 总陪练次数
    const trainingRow = db.prepare(`
      SELECT COUNT(*) as count FROM training_sessions ts JOIN users u ON ts.user_id = u.id WHERE ${scope.clause}
    `).get(...scope.params);
    data.total_trainings = trainingRow ? trainingRow.count : 0;

    // 变化趋势
    data.user_change = data.new_users_this_month || null;
    data.active_change = db.prepare(`
      SELECT COUNT(*) as count FROM activity_logs
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
    `).get().count || null;
    data.course_change = data.new_courses_this_month || null;
    data.exam_change = data.new_exams_this_month || null;
    data.checkin_change = null;  // 签到是新增功能，无历史对比
    data.points_change = null;
    data.training_change = null;

    res.json({ code: 0, data });
  } catch (err) {
    console.error('[dashboard/overview] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 积分排行榜 ====================

// GET /rankings - 积分排行榜 top 20（按累计获得积分排序，不受兑换影响）
router.get('/rankings', authRequired, (req, res) => {
  try {
    const db = req.db;

    const scope = getOrgUserScope(db, req.user, 'u');
    const rankings = db.prepare(`
      SELECT u.id, u.real_name, u.avatar, u.total_earned_points, u.points, u.group_id,
             g.name as group_name
      FROM users u
      LEFT JOIN groups g ON u.group_id = g.id
      WHERE u.status = 'active' AND ${scope.clause}
      ORDER BY u.total_earned_points DESC
      LIMIT 20
    `).all(...scope.params);

    const list = rankings.map((item, index) => {
      const lv = getLevelInfo(item.total_earned_points);
      return {
        ...item,
        rank: index + 1,
        // 排行榜展示累计获得积分，不受兑换影响
        points: item.total_earned_points,
        level: lv.level,
        title: lv.title,
      };
    });

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
    const scope = getOrgUserScope(db, req.user, 'u');

    const activityData = db.prepare(`
      SELECT date(al.created_at) as date, COUNT(DISTINCT al.user_id) as count
      FROM activity_logs al
      JOIN users u ON al.user_id = u.id
      WHERE ${scope.clause} AND al.created_at >= datetime('now', '-30 days', 'localtime')
      GROUP BY date
      ORDER BY date ASC
    `).all(...scope.params);

    // 补全30天
    const result = [];
    const activityMap = {};
    for (const item of activityData) {
      activityMap[item.date] = item.count;
    }

    for (let i = 29; i >= 0; i--) {
      const dateStr = dateDaysAgoShanghai(i);
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
    const scope = getOrgUserScope(db, req.user, 'u');

    // 总考试次数
    const overview = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) as passed,
             ROUND(AVG(er.score), 1) as avg_score
      FROM exam_records er
      JOIN users u ON er.user_id = u.id
      WHERE er.status IN ('submitted', 'graded') AND ${scope.clause}
    `).get(...scope.params);

    // 各考试参与人数
    const examDetails = db.prepare(`
      SELECT e.id, e.title,
             COUNT(DISTINCT er.user_id) as participant_count,
             COUNT(er.id) as attempt_count,
             ROUND(AVG(er.score), 1) as avg_score,
             SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) as passed_count
      FROM exams e
      LEFT JOIN exam_records er ON e.id = er.exam_id AND er.status IN ('submitted', 'graded')
      LEFT JOIN users u ON er.user_id = u.id
      WHERE e.status = 'published' AND (${scope.clause} OR er.user_id IS NULL)
      GROUP BY e.id
      ORDER BY participant_count DESC
    `).all(...scope.params);

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

    const scope = getOrgUserScope(db, req.user, 'u');
    const courses = db.prepare(`
      SELECT c.id, c.title, c.title as name, c.cover_url as cover, c.category, c.type as difficulty,
             COUNT(DISTINCT lp.user_id) as exam_count
      FROM courses c
      LEFT JOIN learning_progress lp ON c.id = lp.course_id
      LEFT JOIN users u ON lp.user_id = u.id
      WHERE c.status = 'published' AND (${scope.clause} OR lp.user_id IS NULL)
      GROUP BY c.id
      ORDER BY exam_count DESC
      LIMIT 10
    `).all(...scope.params);

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
    const scope = getOrgUserScope(db, req.user, 'u');

    // 默认过滤掉高频噪声（学习进度），需要可在 query 加 include_noisy=1
    const includeNoisy = req.query.include_noisy === '1' || req.query.include_noisy === 'true';
    const noisyClause = includeNoisy ? '' : `AND (al.action IS NULL OR al.action NOT IN (${Array.from(NOISY_ACTIONS).map(() => '?').join(',')}))`;
    const noisyParams = includeNoisy ? [] : Array.from(NOISY_ACTIONS);

    const activities = db.prepare(`
      SELECT al.id, al.user_id, al.action, al.module, al.target_type,
             al.target_id, al.detail, al.ip, al.created_at,
             u.real_name as user_name, u.username, u.avatar as operator_avatar
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE ${scope.clause} ${noisyClause}
      ORDER BY al.created_at DESC
      LIMIT 20
    `).all(...scope.params, ...noisyParams);

    const list = activities.map(normalizeLog);

    res.json({ code: 0, data: { list } });
  } catch (err) {
    console.error('[dashboard/recent-activities] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
