// 积分等级/称号系统 (L1-L5)
// 基于 total_earned_points（累计获得积分，不因兑换扣减）

const LEVELS = [
  { level: 1, title: '江湖跑侠',   min: 0,    max: 499 },
  { level: 2, title: '拓店游侠',   min: 500,  max: 1499 },
  { level: 3, title: '终端先锋',   min: 1500, max: 2999 },
  { level: 4, title: '销冠大咖',   min: 3000, max: 4999 },
  { level: 5, title: '销冠王者',   min: 5000, max: Infinity },
];

/** 根据累计积分获取当前等级信息 */
function getLevelInfo(totalEarnedPoints) {
  const pts = totalEarnedPoints || 0;
  const current = LEVELS.find(l => pts >= l.min && pts <= l.max) || LEVELS[0];
  const next = LEVELS.find(l => l.level === current.level + 1) || null;
  const needNext = next ? next.min - pts : 0;
  return { level: current.level, title: current.title, next_title: next?.title || null, need_next: needNext };
}

/** 升级弹窗文案 */
function getLevelUpText(fromLevel, toLevel) {
  const key = `${fromLevel}→${toLevel}`;
  const map = {
    '1→2': { icon: '🎉', subtitle: '恭喜升级｜解锁称号【拓店游侠】', body: '奔走终端江湖，你的努力已经看见！继续跑店答题攒积分，向着终端先锋进发。' },
    '2→3': { icon: '✨', subtitle: '恭喜升级｜解锁称号【终端先锋】', body: '谈判拓店越来越顺手，一线战场已然独当一面！再接再厉，冲击销冠大咖。' },
    '3→4': { icon: '🔥', subtitle: '恭喜升级｜解锁称号【销冠大咖】', body: '实力得到认证！你已是一线实战中坚，距离销冠王者仅一步之遥。' },
    '4→5': { icon: '🏆', subtitle: '重磅升级｜解锁最高称号【销冠王者】', body: '恭喜达成至高荣誉！你是本区域业务标杆，欢迎多多投稿实战视频，带动全体伙伴共同成长。' },
  };
  return map[key] || null;
}

module.exports = { LEVELS, getLevelInfo, getLevelUpText };
