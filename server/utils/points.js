/**
 * 积分发放工具 — 统一应用等级加成
 *
 * 规则：
 *  - 用户达到 L3 / L4 / L5 后，**后续**获得的积分按倍率计算（默认 1.1 / 1.2 / 1.3）
 *  - 倍率取「发放时用户所处等级」对应的值（非累乘），历史积分不变
 *  - 出现小数时四舍五入取整
 *  - 倍率与启停可在后台「积分规则 → 等级加成」调整
 */
const { getLevelInfo } = require('./levels');

/** 读取某用户当前的等级与加成倍率 */
function getLevelBonus(db, userId) {
  let level = 1;
  let multiplier = 1;
  try {
    const u = db.prepare('SELECT total_earned_points FROM users WHERE id = ?').get(userId);
    const pts = u ? Number(u.total_earned_points) || 0 : 0;
    level = getLevelInfo(pts).level;

    const row = db.prepare('SELECT multiplier, enabled FROM level_bonuses WHERE level = ?').get(level);
    if (row && Number(row.enabled) === 1) {
      const m = Number(row.multiplier);
      if (Number.isFinite(m) && m > 0) multiplier = m;
    }
  } catch (_) { /* 配置缺失时按无加成处理，不影响主流程 */ }
  return { level, multiplier };
}

/**
 * 对基础积分应用等级加成
 * @returns {{ awarded:number, raw:number, multiplier:number, level:number }}
 *   awarded 为实际发放积分，raw 为规则原始值
 */
function applyLevelBonus(db, userId, basePoints) {
  const { level, multiplier } = getLevelBonus(db, userId);
  const raw = Math.max(0, Number(basePoints) || 0);
  const awarded = multiplier === 1 ? raw : Math.round(raw * multiplier);
  return { awarded, raw, multiplier, level };
}

/** 积分说明后缀，如 "（L3 加成 ×1.1）"，无加成时返回空串 */
function bonusLabel(multiplier, level) {
  if (!multiplier || multiplier === 1) return '';
  return `（L${level} 加成 ×${multiplier}）`;
}

module.exports = { getLevelBonus, applyLevelBonus, bonusLabel };
