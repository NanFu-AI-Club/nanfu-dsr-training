/**
 * 签到与任务 API
 * 表: check_ins, point_rules, point_logs, users, learning_progress, exam_records, training_sessions
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');

// ==================== 辅助函数 ====================

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * 发放积分
 */
function awardPoints(db, userId, points, reason, sourceType, sourceId) {
  const logId = uuidv4();
  db.prepare(`
    INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(logId, userId, points, reason || '', sourceType || '', sourceId || '');
  db.prepare('UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ?, updated_at = datetime("now","localtime") WHERE id = ?')
    .run(points, points, userId);
}

/**
 * 获取积分规则值
 */
function getRulePoints(db, sourceType) {
  const rule = db.prepare('SELECT points FROM point_rules WHERE source_type = ? AND enabled = 1').get(sourceType);
  return rule ? rule.points : 0;
}

// ==================== 签到状态 ====================

// GET /api/checkin/status - 获取当前签到状态
router.get('/status', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;
    const today = todayStr();

    // 今日是否已签到
    const todayCheckin = db.prepare(`
      SELECT id, points_earned, streak_count FROM check_ins
      WHERE user_id = ? AND check_date = ?
    `).get(userId, today);

    // 计算连续签到天数
    let streak = 0;
    if (todayCheckin) {
      streak = todayCheckin.streak_count;
    } else {
      // 查找昨天是否签到
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const yesterday = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const yesterdayCheckin = db.prepare(`
        SELECT streak_count FROM check_ins WHERE user_id = ? AND check_date = ?
      `).get(userId, yesterday);
      streak = yesterdayCheckin ? yesterdayCheckin.streak_count : 0;
    }

    // 本月签到记录
    const firstDay = today.substring(0, 7) + '-01';
    const monthRecords = db.prepare(`
      SELECT check_date, points_earned FROM check_ins
      WHERE user_id = ? AND check_date >= ?
      ORDER BY check_date ASC
    `).all(userId, firstDay);

    // 总签到天数
    const totalDays = db.prepare(`
      SELECT COUNT(*) as cnt FROM check_ins WHERE user_id = ?
    `).get(userId).cnt;

    // 连续签到规则
    const streakRules = db.prepare(`
      SELECT source_type, points, action FROM point_rules
      WHERE source_type LIKE 'check_in%' AND enabled = 1
      ORDER BY sort_order ASC
    `).all();

    res.json({
      code: 0,
      data: {
        checked_in: !!todayCheckin,
        today_points: todayCheckin ? todayCheckin.points_earned : 0,
        streak,
        total_days: totalDays,
        month_dates: monthRecords.map(r => r.check_date),
        month_points: monthRecords.reduce((sum, r) => sum + r.points_earned, 0),
        streak_rules: streakRules,
      }
    });
  } catch (err) {
    console.error('[checkin/status] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /api/checkin - 执行签到
router.post('/', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;
    const today = todayStr();

    // 检查今日是否已签到
    const existing = db.prepare(`
      SELECT id FROM check_ins WHERE user_id = ? AND check_date = ?
    `).get(userId, today);

    if (existing) {
      return res.status(400).json({ code: 400, message: '今日已签到，明天再来吧！' });
    }

    // 计算连续签到天数
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const yesterdayCheckin = db.prepare(`
      SELECT streak_count FROM check_ins WHERE user_id = ? AND check_date = ?
    `).get(userId, yesterday);

    const prevStreak = yesterdayCheckin ? yesterdayCheckin.streak_count : 0;
    const newStreak = prevStreak + 1;

    // 计算积分：基础签到 + 连续签到加成
    let totalPoints = getRulePoints(db, 'check_in');  // 基础签到积分

    // 连续签到加成
    let bonusReason = '';
    if (newStreak >= 30) {
      const bonus = getRulePoints(db, 'check_in_streak_30');
      if (bonus > 0) { totalPoints += bonus; bonusReason = ' + 连续30天奖励'; }
    } else if (newStreak >= 7) {
      const bonus = getRulePoints(db, 'check_in_streak_7');
      if (bonus > 0) { totalPoints += bonus; bonusReason = ' + 连续7天奖励'; }
    } else if (newStreak >= 3) {
      const bonus = getRulePoints(db, 'check_in_streak_3');
      if (bonus > 0) { totalPoints += bonus; bonusReason = ' + 连续3天奖励'; }
    }

    // 插入签到记录
    const checkinId = uuidv4();
    db.prepare(`
      INSERT INTO check_ins (id, user_id, check_date, points_earned, streak_count, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(checkinId, userId, today, totalPoints, newStreak);

    // 发放积分
    const reason = bonusReason
      ? `签到第${newStreak}天${bonusReason}`
      : `签到第${newStreak}天`;
    awardPoints(db, userId, totalPoints, reason, 'check_in', checkinId);

    res.json({
      code: 0,
      data: {
        points_earned: totalPoints,
        streak: newStreak,
        reason,
      },
      message: `签到成功！获得 ${totalPoints} 积分`,
    });
  } catch (err) {
    console.error('[checkin] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 任务列表 ====================

// GET /api/checkin/tasks - 获取任务列表（带用户完成状态）
router.get('/tasks', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;
    const today = todayStr();

    // 已签到
    const checkedIn = !!db.prepare(`
      SELECT 1 FROM check_ins WHERE user_id = ? AND check_date = ?
    `).get(userId, today);

    // 今日学习课程数
    const todayLearning = db.prepare(`
      SELECT COUNT(*) as cnt FROM learning_progress
      WHERE user_id = ? AND date(updated_at) = ?
    `).get(userId, today).cnt;

    // 今日完成的课程数
    const todayCompleted = db.prepare(`
      SELECT COUNT(*) as cnt FROM learning_progress
      WHERE user_id = ? AND completed = 1 AND date(completed_at) = ?
    `).get(userId, today).cnt;

    // 今日参加考试数
    const todayExams = db.prepare(`
      SELECT COUNT(*) as cnt FROM exam_records
      WHERE user_id = ? AND date(created_at) = ?
    `).get(userId, today).cnt;

    // 今日考试通过数
    const todayPassed = db.prepare(`
      SELECT COUNT(*) as cnt FROM exam_records
      WHERE user_id = ? AND passed = 1 AND date(created_at) = ?
    `).get(userId, today).cnt;

    // 今日陪练数
    const todayTraining = db.prepare(`
      SELECT COUNT(*) as cnt FROM training_sessions
      WHERE user_id = ? AND date(started_at) = ?
    `).get(userId, today).cnt;

    // 总任务完成统计
    const totalCompleted = db.prepare(`
      SELECT COUNT(*) as cnt FROM learning_progress
      WHERE user_id = ? AND completed = 1
    `).get(userId).cnt;

    const totalPassed = db.prepare(`
      SELECT COUNT(*) as cnt FROM exam_records WHERE user_id = ? AND passed = 1
    `).get(userId).cnt;

    const totalTraining = db.prepare(`
      SELECT COUNT(*) as cnt FROM training_sessions WHERE user_id = ? AND status = 'completed'
    `).get(userId).cnt;

    // 获取积分规则
    const rules = db.prepare(`
      SELECT source_type, action, points, description, icon, sort_order
      FROM point_rules
      WHERE enabled = 1
      ORDER BY sort_order ASC
    `).all();

    const tasks = rules.map(r => {
      let completed = 0, todayDone = false, extra = null;
      switch (r.source_type) {
        case 'check_in':
        case 'check_in_streak_3':
        case 'check_in_streak_7':
        case 'check_in_streak_30':
          // 签到类规则不单独显示为任务，在签到弹窗中处理
          return null;
        case 'daily_question_correct':
        case 'daily_question_wrong':
          return null; // 已禁用的每日一题
        case 'learning_complete':
          completed = totalCompleted;
          todayDone = todayCompleted > 0;
          extra = { today_count: todayLearning, today_completed: todayCompleted };
          break;
        case 'exam_pass':
          completed = totalPassed;
          todayDone = todayPassed > 0;
          extra = { today_count: todayExams, today_passed: todayPassed };
          break;
        case 'training_complete':
          completed = totalTraining;
          todayDone = todayTraining > 0;
          extra = { today_count: todayTraining };
          break;
        default:
          completed = 0;
          todayDone = false;
      }
      return {
        source_type: r.source_type,
        action: r.action,
        points: r.points,
        description: r.description,
        icon: r.icon,
        sort_order: r.sort_order,
        completed,
        today_done: todayDone,
        extra,
      };
    }).filter(Boolean);

    res.json({
      code: 0,
      data: {
        checked_in: checkedIn,
        tasks,
      }
    });
  } catch (err) {
    console.error('[checkin/tasks] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 获取签到日历数据 ====================

// GET /api/checkin/calendar?month=2026-07
router.get('/calendar', authRequired, (req, res) => {
  try {
    const db = req.db;
    const userId = req.user.id;
    const { month } = req.query;

    const targetMonth = month || todayStr().substring(0, 7);
    const firstDay = targetMonth + '-01';

    // 获取该月的签到日期
    const records = db.prepare(`
      SELECT check_date, points_earned FROM check_ins
      WHERE user_id = ? AND check_date >= ? AND check_date < date(?, '+1 month')
      ORDER BY check_date ASC
    `).all(userId, firstDay, firstDay);

    // 生成本月日历
    const [year, mon] = targetMonth.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const calendar = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = targetMonth + '-' + String(d).padStart(2, '0');
      const record = records.find(r => r.check_date === dateStr);
      calendar.push({
        date: dateStr,
        checked_in: !!record,
        points: record ? record.points_earned : 0,
      });
    }

    res.json({
      code: 0,
      data: {
        month: targetMonth,
        total_days: records.length,
        calendar,
      }
    });
  } catch (err) {
    console.error('[checkin/calendar] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
