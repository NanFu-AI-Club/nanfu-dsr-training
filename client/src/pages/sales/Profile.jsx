import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertCircle, User, Calendar, Award, Star, Clock,
  BookOpen, MessageSquare, FileText, ChevronRight, TrendingUp,
  Zap, Shield, Heart, Target, Users, CheckCircle, XCircle,
} from 'lucide-react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import api from '../../api';

/* ========== 六维能力配置 ========== */
const DIMENSION_CONFIG = [
  {
    key: 'product_knowledge',
    label: '产品知识',
    icon: BookOpen,
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    bar: 'bg-blue-500',
    description: '电池产品参数、卖点、竞品对比的掌握程度',
  },
  {
    key: 'sales_skills',
    label: '销售技巧',
    icon: TrendingUp,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    bar: 'bg-emerald-500',
    description: 'SPIN提问、FAB法则、促成话术等销售技能',
  },
  {
    key: 'communication',
    label: '沟通能力',
    icon: MessageSquare,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    bar: 'bg-purple-500',
    description: '倾听、表达、共情及非暴力沟通能力',
  },
  {
    key: 'customer_management',
    label: '客户管理',
    icon: Users,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    bar: 'bg-orange-500',
    description: '客户分级、跟进节奏、客情维护与售后处理',
  },
  {
    key: 'policy_understanding',
    label: '制度理解',
    icon: FileText,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    bar: 'bg-indigo-500',
    description: '公司政策、价格体系、合规制度的理解与执行',
  },
  {
    key: 'learning_attitude',
    label: '学习态度',
    icon: Star,
    color: 'text-pink-600',
    bg: 'bg-pink-50',
    bar: 'bg-pink-500',
    description: '主动学习意愿、参与度、学习效率与坚持度',
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
  training: { icon: MessageSquare, label: '陪练', color: 'text-purple-500', bg: 'bg-purple-100' },
  course: { icon: BookOpen, label: '学习', color: 'text-green-500', bg: 'bg-emerald-100' },
  points: { icon: Award, label: '积分', color: 'text-amber-500', bg: 'bg-amber-100' },
  default: { icon: Clock, label: '其他', color: 'text-warm-500', bg: 'bg-warm-100' },
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
  const [radarData, setRadarData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [activities, setActivities] = useState([]);
  const [dimensions, setDimensions] = useState([]);

  const [radarLoading, setRadarLoading] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [error, setError] = useState('');

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
  }, [loadRadar, loadOverview]);

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
              <h3 className="text-xl font-bold text-warm-900">
                {currentUser.name || currentUser.username || '业务员'}
              </h3>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-warm-500">
                <span className="flex items-center gap-1">
                  <Users size={14} />
                  {overview?.department || overview?.group_name || currentUser.department || '-'}
                </span>
                {overview?.joined_at && (
                  <span className="flex items-center gap-1">
                    <Calendar size={14} />
                    加入 {new Date(overview.joined_at).toLocaleDateString('zh-CN')}
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
                          {new Date(activity.created_at).toLocaleString('zh-CN')}
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
    </div>
  );
}
