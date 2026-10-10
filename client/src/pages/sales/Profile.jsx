import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, AlertCircle, User, Calendar, Award, Star, Clock,
  BookOpen, MessageSquare, FileText, ChevronRight, TrendingUp,
  Zap, Shield, Heart, Target, Users, CheckCircle, XCircle,
  GraduationCap, CalendarDays, Camera, ShoppingBag, BarChart3,
} from 'lucide-react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import api from '../../api';
import { formatShanghai, formatDateShanghai } from '../../utils/time';

/* ========== 六维能力配置 ========== */
const DIMENSION_CONFIG = [
  {
    key: 'product_knowledge',
    label: '产品知识',
    icon: BookOpen,
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    bar: 'bg-blue-500',
    description: '产品参数、卖点、竞品对比的掌握程度',
    scoreSource: '产品类考试平均分 × 60% + 产品课程完成率 × 40%',
  },
  {
    key: 'sales_skills',
    label: '销售技巧',
    icon: TrendingUp,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    bar: 'bg-emerald-500',
    description: 'SPIN提问、FAB法则、促成话术等销售技能',
    scoreSource: '销售类考试平均分 × 30% + 销售课程完成率 × 30% + FU利陪陪平均分 × 40%',
  },
  {
    key: 'communication',
    label: '沟通能力',
    icon: MessageSquare,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    bar: 'bg-purple-500',
    description: '倾听、表达、共情及非暴力沟通能力',
    scoreSource: 'FU利陪陪报告中"沟通表达"维度平均分',
  },
  {
    key: 'customer_management',
    label: '客户管理',
    icon: Users,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    bar: 'bg-orange-500',
    description: '客户分级、跟进节奏与售后处理',
    scoreSource: 'FU利陪陪报告中"客户关系"维度平均分',
  },
  {
    key: 'customer_care',
    label: '客情维护',
    icon: Heart,
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    bar: 'bg-rose-500',
    description: '客户关系维护、客情建立与长期合作经营',
    scoreSource: 'FU利陪陪报告中"客情维护"维度平均分',
  },
  {
    key: 'learning_attitude',
    label: '学习投入',
    icon: Clock,
    color: 'text-pink-600',
    bg: 'bg-pink-50',
    bar: 'bg-pink-500',
    description: '课程完成率、学习时长与学习投入度',
    scoreSource: '全部课程完成率 × 60% + 学习时长得分 × 40%（每20小时满分）',
  },
];

/* ========== 评级函数 ========== */
function getRating(score) {
  if (score >= 90) return { label: '优秀', color: 'text-emerald-600', bg: 'bg-emerald-50' };
  if (score >= 80) return { label: '良好', color: 'text-sky-600', bg: 'bg-sky-50' };
  if (score >= 60) return { label: '及格', color: 'text-yellow-600', bg: 'bg-yellow-50' };
  return { label: '待提升', color: 'text-rose-600', bg: 'bg-rose-50' };
}

/* ========== 活动类型配置 ========== */
const ACTIVITY_CONFIG = {
  exam: { icon: FileText, label: '考试', color: 'text-orange-500', bg: 'bg-orange-100' },
  training: { icon: MessageSquare, label: 'FU利陪陪', color: 'text-purple-500', bg: 'bg-purple-100' },
  course: { icon: BookOpen, label: '学习', color: 'text-green-500', bg: 'bg-emerald-100' },
  points: { icon: Award, label: '积分', color: 'text-amber-500', bg: 'bg-amber-100' },
  default: { icon: Clock, label: '其他', color: 'text-warm-500', bg: 'bg-warm-100' },
};

/* ========== 快捷功能入口（收纳次要功能） ========== */
const QUICK_ACTIONS = [
  { path: '/sales/learning', icon: GraduationCap, label: '闯关学习', color: 'text-sky-600', bg: 'bg-sky-50' },
  { path: '/sales/exam', icon: FileText, label: '答题挑战', color: 'text-violet-600', bg: 'bg-violet-50' },
  { path: '/sales/checkin', icon: CalendarDays, label: '每日签到', color: 'text-amber-600', bg: 'bg-amber-50' },
  { path: '/sales/submission', icon: Camera, label: '风采投稿', color: 'text-rose-600', bg: 'bg-rose-50' },
  { path: '/sales/shop', icon: ShoppingBag, label: '积分商城', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { path: '/sales/statistics', icon: BarChart3, label: '成长榜', color: 'text-orange-600', bg: 'bg-orange-50' },
];

/* ========== 等级/称号配置 ========== */
const LEVELS = [
  { level: 1, title: '江湖跑侠', min: 0, max: 499, desc: '初闯终端江湖，开启跑店历练', color: 'text-stone-500', bar: 'bg-stone-400' },
  { level: 2, title: '拓店游侠', min: 500, max: 1499, desc: '奔走各大门店，拓店小有收获', color: 'text-emerald-600', bar: 'bg-emerald-500' },
  { level: 3, title: '终端先锋', min: 1500, max: 2999, desc: '熟稔门店谈判，终端得心应手', color: 'text-blue-600', bar: 'bg-blue-500' },
  { level: 4, title: '销冠大咖', min: 3000, max: 4999, desc: '实战战绩突出，团队中坚力量', color: 'text-purple-600', bar: 'bg-purple-500' },
  { level: 5, title: '销冠王者', min: 5000, max: Infinity, desc: '一线顶尖标杆，众人学习榜样', color: 'text-amber-500', bar: 'bg-amber-500' },
];

function getLevelInfo(totalEarnedPoints) {
  const pts = totalEarnedPoints || 0;
  const current = LEVELS.find(l => pts >= l.min && pts <= l.max) || LEVELS[0];
  const next = LEVELS.find(l => l.level === current.level + 1) || null;
  const needNext = next ? next.min - pts : 0;
  return { ...current, next_title: next?.title || null, need_next: needNext };
}

const LEVEL_UP_TEXTS = {
  '1→2': { icon: '🎉', subtitle: '恭喜升级｜解锁称号【拓店游侠】', body: '奔走终端江湖，你的努力已经看见！继续跑店答题攒积分，向着终端先锋进发。' },
  '2→3': { icon: '✨', subtitle: '恭喜升级｜解锁称号【终端先锋】', body: '谈判拓店越来越顺手，一线战场已然独当一面！再接再厉，冲击销冠大咖。' },
  '3→4': { icon: '🔥', subtitle: '恭喜升级｜解锁称号【销冠大咖】', body: '实力得到认证！你已是一线实战中坚，距离销冠王者仅一步之遥。' },
  '4→5': { icon: '🏆', subtitle: '重磅升级｜解锁最高称号【销冠王者】', body: '恭喜达成至高荣誉！你是本区域业务标杆，欢迎多多投稿实战视频，带动全体伙伴共同成长。' },
};

/* 雷达图 tooltip */
function RadarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border shadow-soft-lg rounded-xl px-3 py-2 text-sm">
      <p className="font-medium text-warm-900">{payload[0].payload.subject}</p>
      <p className="text-primary-600 font-bold">{payload[0].value} 分</p>
    </div>
  );
}

export default function Profile() {
  const navigate = useNavigate();
  const [radarData, setRadarData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [activities, setActivities] = useState([]);
  const [dimensions, setDimensions] = useState([]);

  const [radarLoading, setRadarLoading] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [levelUpPopup, setLevelUpPopup] = useState(null);
  // null 表示尚未加载完成（升级弹窗需等它就绪后再判断，避免漏显加成）
  const [levelBonuses, setLevelBonuses] = useState(null);

  /* ---- 从 localStorage 获取当前用户 ---- */
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch { return {}; }
  })();

  /* ---- 加载雷达图数据 ---- */
  const loadRadar = useCallback(async () => {
    try {
      setRadarLoading(true);
      setError('');
      const res = await api.get('/statistics/radar');
      const data = res.data || res;
      setRadarData(data);
      // 转换为雷达图所需格式
      if (data?.dimensions) {
        const formatted = data.dimensions.map((dim) => {
          const config = DIMENSION_CONFIG.find((c) => c.key === dim.key) || {};
          return {
            subject: config.label || dim.name || dim.key,
            key: dim.key,
            score: dim.score || dim.value || 0,
            maxScore: 100,
            fullScore: 100,
            suggestion: dim.suggestion || dim.advice || '',
            rating: getRating(dim.score || 0),
          };
        });
        setDimensions(formatted);
      } else if (Array.isArray(data)) {
        // 直接是数组的情况
        const formatted = data.map((dim) => {
          const config = DIMENSION_CONFIG.find((c) => c.key === dim.key) || {};
          return {
            subject: config.label || dim.name || dim.key,
            key: dim.key,
            score: dim.score || dim.value || 0,
            maxScore: 100,
            fullScore: 100,
            suggestion: dim.suggestion || dim.advice || '',
            rating: getRating(dim.score || 0),
          };
        });
        setDimensions(formatted);
      }
    } catch (err) {
      console.error('加载雷达图失败:', err);
      setError(err?.message || '加载能力数据失败');
    } finally {
      setRadarLoading(false);
    }
  }, []);

  /* ---- 加载概览数据（含最近活动） ---- */
  const loadOverview = useCallback(async () => {
    try {
      setOverviewLoading(true);
      const res = await api.get('/statistics/overview');
      const data = res.data || res;
      setOverview(data);
      // 提取最近活动
      if (data?.recent_activities) {
        setActivities(data.recent_activities.slice(0, 10));
      } else if (data?.activities) {
        setActivities(data.activities.slice(0, 10));
      }
    } catch (err) {
      console.error('加载概览失败:', err);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRadar();
    loadOverview();
    (async () => {
      try {
        const res = await api.get('/statistics/level-bonuses');
        const rows = res?.data || res || [];
        const map = {};
        rows.forEach((r) => {
          if (Number(r.enabled) === 1) map[r.level] = Number(r.multiplier);
        });
        setLevelBonuses(map);
      } catch (_) {
        setLevelBonuses({}); // 拿不到配置时不影响升级弹窗其它内容
      }
    })();
  }, [loadRadar, loadOverview]);

  /* ---- 等级升级检测 ---- */
  useEffect(() => {
    if (!overview?.level || levelBonuses === null) return;
    const currentLevel = overview.level.level;
    const lastSeen = localStorage.getItem('last_seen_level');

    if (lastSeen === null) {
      // 首次访问，记录当前等级，不弹窗
      localStorage.setItem('last_seen_level', String(currentLevel));
      return;
    }

    const lastSeenNum = parseInt(lastSeen, 10);
    if (currentLevel > lastSeenNum) {
      const fromTo = `${lastSeenNum}→${currentLevel}`;
      const texts = LEVEL_UP_TEXTS[fromTo];
      if (texts) {
        const bonus = levelBonuses[currentLevel];
        setLevelUpPopup({
          ...texts,
          newLevel: currentLevel,
          newTitle: overview.level.title,
          bonus: bonus && bonus > 1 ? bonus : null,
        });
      }
      localStorage.setItem('last_seen_level', String(currentLevel));
    }
  }, [overview, levelBonuses]);

  /* ---- 雷达图数据 ---- */
  const chartData = dimensions.map((d) => ({
    subject: d.subject,
    score: d.score,
    fullScore: d.fullScore,
  }));

  /* ================================================================
   *  渲染
   * ================================================================ */
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto space-y-6">
      <h2 className="page-title">我的画像</h2>

      {/* 快捷功能入口 */}
      <div className="grid grid-cols-3 gap-3">
        {QUICK_ACTIONS.map(({ path, icon: Icon, label, color, bg }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="card flex flex-col items-center justify-center gap-2 py-4 hover:-translate-y-0.5 transition"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bg}`}>
              <Icon size={20} className={color} />
            </div>
            <span className="text-xs text-warm-700 font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
          <button onClick={loadRadar} className="ml-auto underline text-sm">重试</button>
        </div>
      )}

      {/* ===== 基本信息卡片 ===== */}
      <div className="card">
        {overviewLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 size={24} className="animate-spin text-primary-600" />
          </div>
        ) : (
          <div className="flex items-center gap-5">
            {/* 头像占位 */}
            <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <User size={32} className="text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-warm-900 flex flex-wrap items-baseline gap-x-2">
                <span>{currentUser.real_name || currentUser.name || currentUser.username || '业务员'}</span>
                {(currentUser.real_name || currentUser.name) && currentUser.username && (
                  <span className="text-sm font-normal text-warm-400">{currentUser.username}</span>
                )}
              </h3>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-warm-500">
                <span className="flex items-center gap-1">
                  <Users size={14} />
                  {overview?.department || overview?.group_name || currentUser.department || '-'}
                </span>
                {overview?.joined_at && (
                  <span className="flex items-center gap-1">
                    <Calendar size={14} />
                    加入 {formatDateShanghai(overview.joined_at)}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-amber-500">
                {overview?.total_points ?? '-'}
              </p>
              <p className="text-xs text-warm-400">总积分</p>
            </div>
          </div>
        )}
      </div>

      {/* ===== 积分称号等级 ===== */}
      {overview && overview.level && (
        <div className="card">
          {(() => {
            const levelInfo = overview.level;
            const currentLevel = LEVELS.find(l => l.level === levelInfo.level) || LEVELS[0];
            const pts = overview.total_earned_points || 0;
            const progressPct = currentLevel.max === Infinity
              ? 100
              : Math.min(100, Math.max(0, Math.round(((pts - currentLevel.min) / (currentLevel.max - currentLevel.min + 1)) * 100)));

            return (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-warm-900 flex items-center gap-2">
                    <Award size={18} className="text-amber-500" />
                    我的称号
                  </h3>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${currentLevel.color} bg-amber-50 border border-amber-200`}>
                    L{currentLevel.level} · {currentLevel.title}
                  </span>
                </div>

                <p className="text-xs text-warm-500 mb-3">
                  当前称号：<strong className="text-warm-800">{levelInfo.title}</strong>
                  {levelInfo.next_title ? (
                    <>｜距离下一级还需 <strong className="text-primary-600">{levelInfo.need_next}</strong> 积分</>
                  ) : (
                    <>｜已达成最高称号 🏆</>
                  )}
                </p>

                {/* 进度条 */}
                <div className="w-full bg-warm-200 rounded-full h-2.5 mb-1.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${currentLevel.bar}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <div className="flex justify-between text-[11px] text-warm-400">
                  <span>{currentLevel.min} 分</span>
                  {currentLevel.max !== Infinity && <span>{currentLevel.max} 分</span>}
                  {currentLevel.max === Infinity && <span>{currentLevel.min}+ 分</span>}
                </div>

                <p className="text-xs text-warm-400 mt-3 italic">
                  闯荡终端江湖，积累积分解锁更高荣誉！
                </p>
              </>
            );
          })()}
        </div>
      )}

      {/* ===== 六维能力雷达图 ===== */}
      <div className="card">
        <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
          <Star size={18} className="text-primary-600" />
          能力雷达图
        </h3>
        {radarLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={32} className="animate-spin text-primary-600" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="text-center py-10 text-warm-400 text-sm">暂无能力数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <RadarChart data={chartData} outerRadius="75%">
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fontSize: 12, fill: '#6B7280' }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickCount={6}
              />
              <Tooltip content={<RadarTooltip />} />
              <Radar
                name="我的能力"
                dataKey="score"
                stroke="#3B82F6"
                fill="#3B82F6"
                fillOpacity={0.25}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ===== 6个维度卡片详解 ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {dimensions.map((dim) => {
          const config = DIMENSION_CONFIG.find((c) => c.key === dim.key) || {};
          const Icon = config.icon || Star;
          const percent = Math.min(100, Math.max(0, dim.score));
          return (
            <div key={dim.key} className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${config.bg || 'bg-warm-50/80'}`}>
                    <Icon size={18} className={config.color || 'text-warm-500'} />
                  </div>
                  <h4 className="font-semibold text-warm-900 text-sm">
                    {config.label || dim.subject}
                  </h4>
                </div>
                <div className="text-right">
                  <span className={`text-lg font-bold ${dim.rating.color}`}>
                    {dim.score}
                  </span>
                  <span className="text-xs text-warm-400">/100</span>
                </div>
              </div>

              {/* 进度条 */}
              <div className="w-full bg-warm-200 rounded-full h-2 mb-2">
                <div
                  className={`h-2 rounded-full transition-all ${config.bar || 'bg-primary-500'}`}
                  style={{ width: `${percent}%` }}
                />
              </div>

              {/* 评级 */}
              <span className={`badge text-xs ${dim.rating.bg} ${dim.rating.color}`}>
                {dim.rating.label}
              </span>

              {/* 改进建议 */}
              {dim.suggestion && (
                <p className="text-xs text-warm-500 mt-2 leading-relaxed">
                  {dim.suggestion}
                </p>
              )}
              {!dim.suggestion && (
                <p className="text-xs text-warm-400 mt-2 leading-relaxed">
                  {config.description}
                </p>
              )}

              {/* 得分来源 */}
              {config.scoreSource && (
                <div className="mt-2 pt-2 border-t border-warm-100">
                  <p className="text-[11px] text-warm-400 leading-relaxed">
                    <span className="font-medium text-warm-500">得分来源：</span>{config.scoreSource}
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {dimensions.length === 0 && !radarLoading && (
          <div className="col-span-full text-center py-6 card">
            <Star size={40} className="mx-auto mb-2 text-warm-300" />
            <p className="text-warm-400 text-sm">暂无维度数据</p>
          </div>
        )}
      </div>

      {/* ===== 最近学习动态 ===== */}
      <div className="card">
        <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
          <Clock size={18} className="text-primary-600" />
          最近学习动态
        </h3>
        {activities.length === 0 ? (
          <div className="text-center py-8 text-warm-400 text-sm">
            {overviewLoading ? (
              <Loader2 size={24} className="animate-spin mx-auto text-primary-600" />
            ) : (
              '暂无学习动态'
            )}
          </div>
        ) : (
          <div className="space-y-0">
            {activities.map((activity, idx) => {
              const typeConfig = ACTIVITY_CONFIG[activity.type] || ACTIVITY_CONFIG.default;
              const Icon = typeConfig.icon;
              return (
                <div
                  key={activity.id || idx}
                  className={`flex items-center gap-3 py-3 ${
                    idx < activities.length - 1 ? 'border-b' : ''
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${typeConfig.bg}`}>
                    <Icon size={17} className={typeConfig.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-warm-800 truncate">
                      {activity.title || activity.description || '未知活动'}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-warm-400 mt-0.5">
                      <span className={`badge text-xs ${typeConfig.bg} ${typeConfig.color}`}>
                        {typeConfig.label}
                      </span>
                      {activity.created_at && (
                        <span>
                          {formatShanghai(activity.created_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  {activity.score != null && (
                    <span className="text-sm font-semibold text-warm-700 shrink-0">
                      {activity.score > 0 ? '+' : ''}{activity.score}
                      {activity.type === 'points' ? '分' : ''}
                    </span>
                  )}
                  {activity.status === 'pass' && (
                    <CheckCircle size={16} className="text-green-500 shrink-0" />
                  )}
                  {activity.status === 'fail' && (
                    <XCircle size={16} className="text-red-400 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== 升级弹窗 ===== */}
      {levelUpPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setLevelUpPopup(null)}>
          <div className="bg-white rounded-2xl shadow-soft-xl p-6 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl mb-3">{levelUpPopup.icon}</div>
            <h3 className="text-lg font-bold text-warm-900 mb-2">{levelUpPopup.subtitle}</h3>
            <p className="text-sm text-warm-500 leading-relaxed mb-4">{levelUpPopup.body}</p>

            {levelUpPopup.bonus && (
              <div className="mb-5 p-3.5 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200">
                <p className="text-sm font-semibold text-amber-700">解锁等级加成权益</p>
                <p className="text-xs text-amber-600 mt-1.5 leading-relaxed">
                  从此刻起，你获得的所有积分按{' '}
                  <span className="font-bold text-base">×{levelUpPopup.bonus}</span> 计算
                </p>
              </div>
            )}

            <button
              onClick={() => setLevelUpPopup(null)}
              className="btn-primary w-full"
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
