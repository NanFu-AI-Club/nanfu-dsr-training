/**
 * BI 数据看板路由
 * 提供统一的聚合接口，支持时间范围和组织维度筛选。
 * 数据源：users, groups, regions, cities, courses, exams, questions,
 *        training_scenarios, activity_logs, learning_progress, exam_records,
 *        training_sessions, point_logs, check_ins
 */
const express = require('express');
const router = express.Router();
const { authRequired, adminRequired, getOrgUserScope } = require('../middleware/auth');
const { getLevelInfo } = require('../utils/levels');
const { dateDaysAgoShanghai, todayShanghai } = require('../utils/time');
const { NOISY_ACTIONS, normalizeLog } = require('../utils/logFormatter');

// 允许的时间范围（天）
const ALLOWED_RANGES = [7, 30, 90];

function parseRange(value) {
  const n = Number(value);
  if (ALLOWED_RANGES.includes(n)) return n;
  return 30;
}

// 构建组织筛选条件（复用 statistics 的层级筛选模式）
function buildOrgFilter(db, actor, query) {
  const scope = getOrgUserScope(db, actor, 'u');
  const params = [...scope.params];
  const orgClauses = [];

  const { area_id = '', region_id = '', city_id = '', group_id = '' } = query;
  if (area_id) {
    orgClauses.push('u.region_id IN (SELECT id FROM regions WHERE id = ? OR parent_id = ?)');
    params.push(area_id, area_id);
  }
  if (region_id) {
    orgClauses.push('u.region_id = ?');
    params.push(region_id);
  }
  if (city_id) {
    orgClauses.push('u.city_id = ?');
    params.push(city_id);
  }
  if (group_id) {
    orgClauses.push('u.group_id = ?');
    params.push(group_id);
  }

  const orgStr = orgClauses.length ? orgClauses.join(' AND ') : '';
  // 业务指标口径：仅业务员（学习/考试/签到/积分/陪练等）
  const bizWhere = [scope.clause, "u.role = 'sales'", "u.status = 'active'", orgStr].filter(Boolean).join(' AND ');
  // 总用户数口径：当前权限范围内的所有 active 用户（含管理员）
  const totalWhere = [scope.clause, "u.status = 'active'", orgStr].filter(Boolean).join(' AND ');

  return { where: bizWhere, totalWhere, params };
}

// GET /overview - 看板统一聚合接口
router.get('/overview', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const range = parseRange(req.query.range);
    const startDate = dateDaysAgoShanghai(range - 1);
    const { where, totalWhere, params } = buildOrgFilter(db, actor, req.query);

    // ===== 概览指标 =====
    const overview = {};

    // 总用户数（含管理员，受组织筛选影响）
    overview.total_users = db.prepare(`SELECT COUNT(*) as count FROM users u WHERE ${totalWhere}`).get(...params).count;

    // 活跃用户数（近 range 天有活动记录，含管理员）
    overview.active_users = db.prepare(`
      SELECT COUNT(DISTINCT al.user_id) as count
      FROM activity_logs al JOIN users u ON al.user_id = u.id
      WHERE ${totalWhere} AND date(al.created_at) >= ?
    `).get(...params, startDate).count;

    // 内容资源（全局，不按组织过滤）
    overview.total_courses = db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get().count;
    overview.total_exams = db.prepare("SELECT COUNT(*) as count FROM exams WHERE status IN ('published', 'ongoing')").get().count;
    overview.total_questions = db.prepare("SELECT COUNT(*) as count FROM questions WHERE status = 'active'").get().count;
    overview.total_scenarios = db.prepare("SELECT COUNT(*) as count FROM training_scenarios WHERE status = 'active'").get().count;

    // 今日签到人数（受组织筛选影响）
    overview.today_checkins = db.prepare(`
      SELECT COUNT(DISTINCT ci.user_id) as count
      FROM check_ins ci JOIN users u ON ci.user_id = u.id
      WHERE ${where} AND date(ci.check_date) = ?
    `).get(...params, todayShanghai()).count;

    // 总积分发放量（受组织筛选影响）
    const pointRow = db.prepare(`
      SELECT COALESCE(SUM(pl.points), 0) as total
      FROM point_logs pl JOIN users u ON pl.user_id = u.id
      WHERE ${where}
    `).get(...params);
    overview.total_points = pointRow ? pointRow.total : 0;

    // 总陪练次数（受组织筛选影响）
    overview.total_trainings = db.prepare(`
      SELECT COUNT(*) as count
      FROM training_sessions ts JOIN users u ON ts.user_id = u.id
      WHERE ${where}
    `).get(...params).count;

    // 变化趋势（环比用上月/上周期新增，先提供近 range 天新增用于趋势展示）
    overview.user_change = db.prepare(`
      SELECT COUNT(*) as count FROM users u
      WHERE ${totalWhere} AND date(u.created_at) >= ?
    `).get(...params, startDate).count;
    overview.active_change = db.prepare(`
      SELECT COUNT(*) as count FROM activity_logs al JOIN users u ON al.user_id = u.id
      WHERE ${totalWhere} AND date(al.created_at) >= ?
    `).get(...params, startDate).count;
    overview.course_change = db.prepare(`
      SELECT COUNT(*) as count FROM courses
      WHERE status = 'published' AND date(created_at) >= ?
    `).get(startDate).count;
    overview.exam_change = db.prepare(`
      SELECT COUNT(*) as count FROM exams
      WHERE status IN ('published', 'ongoing') AND date(created_at) >= ?
    `).get(startDate).count;

    // ===== 学习活跃度趋势（近 range 天） =====
    const activityData = db.prepare(`
      SELECT date(al.created_at) as date, COUNT(DISTINCT al.user_id) as count
      FROM activity_logs al JOIN users u ON al.user_id = u.id
      WHERE ${where} AND date(al.created_at) >= ?
      GROUP BY date(al.created_at)
      ORDER BY date ASC
    `).all(...params, startDate);

    const activityMap = {};
    for (const item of activityData) activityMap[item.date] = item.count;
    const learning_activity = [];
    for (let i = range - 1; i >= 0; i--) {
      const dateStr = dateDaysAgoShanghai(i);
      learning_activity.push({ date: dateStr, count: activityMap[dateStr] || 0 });
    }

    // ===== 考试统计（近 range 天） =====
    const examOverview = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) as passed,
             ROUND(AVG(er.score), 1) as avg_score
      FROM exam_records er JOIN users u ON er.user_id = u.id
      WHERE er.status IN ('submitted', 'graded') AND ${where} AND date(er.created_at) >= ?
    `).get(...params, startDate);

    const exam_details = db.prepare(`
      SELECT e.id, e.title,
             COUNT(DISTINCT er.user_id) as participant_count,
             COUNT(er.id) as attempt_count,
             ROUND(AVG(er.score), 1) as avg_score,
             SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) as passed_count
      FROM exams e
      LEFT JOIN exam_records er ON e.id = er.exam_id
        AND er.status IN ('submitted', 'graded') AND date(er.created_at) >= ?
      LEFT JOIN users u ON er.user_id = u.id
      WHERE e.status = 'published' AND (${where} OR er.user_id IS NULL)
      GROUP BY e.id
      ORDER BY participant_count DESC
    `).all(startDate, ...params);

    const exam_stats = {
      total_count: examOverview.total,
      pass_rate: examOverview.total > 0 ? Math.round((examOverview.passed / examOverview.total) * 100) : 0,
      avg_score: examOverview.avg_score || 0,
      exams: exam_details,
    };

    // ===== 积分排行榜（累计积分，受组织筛选影响） =====
    const rankingRows = db.prepare(`
      SELECT u.id, u.real_name, u.avatar, u.total_earned_points, u.points,
             r.name as region_name
      FROM users u LEFT JOIN regions r ON u.region_id = r.id
      WHERE ${where}
      ORDER BY u.total_earned_points DESC
      LIMIT 20
    `).all(...params);

    const rankings = rankingRows.map((item, index) => {
      const lv = getLevelInfo(item.total_earned_points);
      return {
        ...item,
        rank: index + 1,
        points: item.total_earned_points,
        level: lv.level,
        title: lv.title,
      };
    });

    // ===== 热门课程（按学习人数，受组织筛选影响） =====
    const courseRows = db.prepare(`
      SELECT c.id, c.title, c.title as name, c.cover_url as cover, c.category, c.type as difficulty,
             COUNT(DISTINCT lp.user_id) as exam_count
      FROM courses c
      LEFT JOIN learning_progress lp ON c.id = lp.course_id
      LEFT JOIN users u ON lp.user_id = u.id
      WHERE c.status = 'published' AND (${where} OR lp.user_id IS NULL)
      GROUP BY c.id
      ORDER BY exam_count DESC
      LIMIT 10
    `).all(...params);

    const popular_courses = courseRows.map((item, index) => ({ ...item, rank: index + 1 }));

    // ===== 最近操作动态 =====
    const includeNoisy = req.query.include_noisy === '1' || req.query.include_noisy === 'true';
    const noisyClause = includeNoisy ? '' : `AND (al.action IS NULL OR al.action NOT IN (${Array.from(NOISY_ACTIONS).map(() => '?').join(',')}))`;
    const noisyParams = includeNoisy ? [] : Array.from(NOISY_ACTIONS);

    const activityRows = db.prepare(`
      SELECT al.id, al.user_id, al.action, al.module, al.target_type,
             al.target_id, al.detail, al.ip, al.created_at,
             u.real_name as user_name, u.username, u.avatar as operator_avatar
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE ${totalWhere} ${noisyClause}
      ORDER BY al.created_at DESC
      LIMIT 20
    `).all(...params, ...noisyParams);

    const recent_activities = activityRows.map(normalizeLog);

    res.json({
      code: 0,
      data: {
        range,
        overview,
        learning_activity,
        exam_stats,
        rankings,
        popular_courses,
        recent_activities,
      },
    });
  } catch (err) {
    console.error('[bi/overview] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
