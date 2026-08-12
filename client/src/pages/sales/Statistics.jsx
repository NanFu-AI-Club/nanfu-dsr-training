import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, AlertCircle, Award, BookOpen, CheckCircle, MessageSquare,
  Star, Trophy, TrendingUp, Users, Calendar, RefreshCw, Zap, FileText, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, AreaChart, Area,
} from 'recharts';
import api from '../../api';

/* ========== 排行维度选项 ========== */
const RANKING_TABS = [
  { key: 'global', label: '全局排行' },
  { key: 'group', label: '分组排行' },
  { key: 'monthly', label: '本月排行' },
];

/* ========== 概览卡片配置 ========== */
const OVERVIEW_CARDS = [
  { key: 'total_points', label: '总积分', icon: Award, color: 'text-amber-500', bg: 'bg-amber-50' },
  { key: 'completed_courses', label: '完成课程', icon: BookOpen, color: 'text-blue-500', bg: 'bg-sky-50' },
  { key: 'exam_pass_rate', label: '考试通过率', icon: CheckCircle, color: 'text-green-500', bg: 'bg-emerald-50', isPercent: true },
  { key: 'training_count', label: '陪练次数', icon: MessageSquare, color: 'text-purple-500', bg: 'bg-purple-50' },
  { key: 'avg_score', label: '平均分', icon: Star, color: 'text-orange-500', bg: 'bg-orange-50' },
  { key: 'rank', label: '排名', icon: Trophy, color: 'text-pink-500', bg: 'bg-pink-50', prefix: '#' },
];

/* ========== 热力图颜色阶梯 ========== */
function getHeatColor(level) {
  if (level === 0) return 'bg-warm-100';
  if (level <= 1) return 'bg-green-200';
  if (level <= 2) return 'bg-green-300';
  if (level <= 3) return 'bg-green-400';
  return 'bg-green-500';
}

/* ========== 生成近3个月日历格子 ========== */
function generateCalendarDays(calendarData) {
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const dataMap = {};
  if (Array.isArray(calendarData)) {
    calendarData.forEach((d) => {
      const key = d.date || d.day;
      if (key) dataMap[key] = d.count || d.value || 0;
    });
  }

  const days = [];
  const cursor = new Date(threeMonthsAgo);
  while (cursor <= today) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const count = dataMap[dateStr] || 0;
    let level = 0;
    if (count > 0 && count <= 2) level = 1;
    else if (count <= 5) level = 2;
    else if (count <= 10) level = 3;
    else if (count > 10) level = 4;
    days.push({ date: dateStr, count, level });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/* 按周聚合图表数据 */
function groupByWeek(dailyData) {
  const weeks = {};
  (dailyData || []).forEach((d) => {
    const date = new Date(d.date || d.day);
    const year = date.getFullYear();
    const oneJan = new Date(year, 0, 1);
    const weekNum = Math.ceil(((date - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
    const key = `${year}-W${String(weekNum).padStart(2, '0')}`;
    if (!weeks[key]) weeks[key] = { total: 0, count: 0 };
    weeks[key].total += d.points || d.value || 0;
    weeks[key].count += 1;
  });
  return Object.entries(weeks)
    .map(([name, val]) => ({ week: name, points: Math.round(val.total) }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

/* 图表通用 tooltip */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border shadow-soft-lg rounded-xl px-3 py-2 text-sm">
      <p className="text-warm-500 mb-1">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export default function Statistics() {
  const [overview, setOverview] = useState(null);
  const [examTrend, setExamTrend] = useState([]);
  const [calendarData, setCalendarData] = useState([]);
  const [pointsHistory, setPointsHistory] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [rankingTab, setRankingTab] = useState('global');
  const [pointRules, setPointRules] = useState([]);
  const [pointDetails, setPointDetails] = useState([]);
  const [pointDetailsTotal, setPointDetailsTotal] = useState(0);
  const [pointDetailsPage, setPointDetailsPage] = useState(1);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const [overviewLoading, setOverviewLoading] = useState(false);
  const [examLoading, setExamLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [error, setError] = useState('');

  const currentUserId = (() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      return user.id;
    } catch { return null; }
  })();

  /* ---- 概览 ---- */
  const loadOverview = useCallback(async () => {
    try {
      setOverviewLoading(true);
      const res = await api.get('/statistics/overview');
      setOverview(res.data || res);
    } catch (err) {
      console.error('加载概览失败:', err);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  /* ---- 考试趋势 ---- */
  const loadExamTrend = useCallback(async () => {
    try {
      setExamLoading(true);
      const res = await api.get('/statistics/exam-trend');
      setExamTrend(res.data || res || []);
    } catch (err) {
      console.error('加载考试趋势失败:', err);
    } finally {
      setExamLoading(false);
    }
  }, []);

  /* ---- 学习日历 ---- */
  const loadCalendar = useCallback(async () => {
    try {
      setCalendarLoading(true);
      const res = await api.get('/statistics/learning-calendar');
      setCalendarData(res.data || res || []);
    } catch (err) {
      console.error('加载日历失败:', err);
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  /* ---- 积分历史 ---- */
  const loadPointsHistory = useCallback(async () => {
    try {
      setPointsLoading(true);
      const res = await api.get('/statistics/points-history');
      setPointsHistory(res.data || res || []);
    } catch (err) {
      console.error('加载积分历史失败:', err);
    } finally {
      setPointsLoading(false);
    }
  }, []);

  /* ---- 排行榜 ---- */
  const loadRanking = useCallback(async (type) => {
    try {
      setRankingLoading(true);
      setError('');
      const res = await api.get('/statistics/ranking', { params: { dimension: type } });
      setRanking(res.data?.list || res.data || []);
    } catch (err) {
      console.error('加载排行榜失败:', err);
      setError(err?.message || '加载排行榜失败');
    } finally {
      setRankingLoading(false);
    }
  }, []);

  /* ---- 积分规则 ---- */
  const loadPointRules = useCallback(async () => {
    try {
      setRulesLoading(true);
      const res = await api.get('/statistics/point-rules');
      setPointRules(res.data || []);
    } catch (err) {
      console.error('加载积分规则失败:', err);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  /* ---- 积分明细 ---- */
  const loadPointDetails = useCallback(async (page = 1) => {
    try {
      setDetailsLoading(true);
      const res = await api.get('/statistics/point-details', { params: { page, pageSize: 10 } });
      const data = res.data || {};
      setPointDetails(data.list || []);
      setPointDetailsTotal(data.total || 0);
      setPointDetailsPage(page);
    } catch (err) {
      console.error('加载积分明细失败:', err);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    loadExamTrend();
    loadCalendar();
    loadPointsHistory();
    loadRanking('global');
    loadPointRules();
    loadPointDetails(1);
  }, [loadOverview, loadExamTrend, loadCalendar, loadPointsHistory, loadRanking, loadPointRules, loadPointDetails]);

  const handleRankingTabChange = (tab) => {
    setRankingTab(tab);
    loadRanking(tab);
  };

  const calendarDays = useMemo(() => generateCalendarDays(calendarData), [calendarData]);
  const weeksData = useMemo(() => groupByWeek(pointsHistory), [pointsHistory]);

  /* ================================================================
   *  渲染
   * ================================================================ */
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto space-y-6">
      <h2 className="page-title">我的销冠成长榜</h2>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
          <button onClick={() => loadRanking(rankingTab)} className="ml-auto underline text-sm">重试</button>
        </div>
      )}

      {/* ===== 概览卡片行 ===== */}
      {overviewLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={28} className="animate-spin text-primary-600" />
        </div>
      ) : overview ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {OVERVIEW_CARDS.map((cardMeta) => {
            const Icon = cardMeta.icon;
            let value = overview[cardMeta.key];
            if (value == null) value = '-';
            else if (cardMeta.isPercent) value = `${value}%`;
            else if (cardMeta.prefix) value = `${cardMeta.prefix}${value}`;
            return (
              <div key={cardMeta.key} className="card flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cardMeta.bg}`}>
                  <Icon size={20} className={cardMeta.color} />
                </div>
                <div>
                  <p className="text-xs text-warm-400">{cardMeta.label}</p>
                  <p className="text-lg font-bold text-warm-900">{value}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6 card">
          <Award size={40} className="mx-auto mb-2 text-warm-300" />
          <p className="text-warm-400 text-sm">暂无概览数据</p>
        </div>
      )}

      {/* ===== 图表区：考试成绩趋势 + 积分变化 ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 考试成绩趋势折线图 */}
        <div className="card">
          <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-blue-500" />
            考试成绩趋势
          </h3>
          {examLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-primary-600" />
            </div>
          ) : examTrend.length === 0 ? (
            <div className="text-center py-10 text-warm-400 text-sm">暂无考试数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={examTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9CA3AF" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" domain={[0, 100]} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="my_score"
                  name="我的分数"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="avg_score"
                  name="全员平均"
                  stroke="#9CA3AF"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 积分变化面积图 */}
        <div className="card">
          <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
            <Award size={18} className="text-amber-500" />
            积分变化（按周）
          </h3>
          {pointsLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-primary-600" />
            </div>
          ) : weeksData.length === 0 ? (
            <div className="text-center py-10 text-warm-400 text-sm">暂无积分数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={weeksData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" />
                <Tooltip content={<ChartTooltip />} />
                <defs>
                  <linearGradient id="pointsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="points"
                  name="积分"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  fill="url(#pointsGradient)"
                  dot={{ r: 3, fill: '#F59E0B' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ===== 学习日历热力图 ===== */}
      <div className="card">
        <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
          <Calendar size={18} className="text-green-500" />
          学习日历（近3个月）
        </h3>
        {calendarLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 size={24} className="animate-spin text-primary-600" />
          </div>
        ) : calendarDays.length === 0 ? (
          <div className="text-center py-6 text-warm-400 text-sm">暂无学习记录</div>
        ) : (
          <div>
            <div className="flex flex-wrap gap-1">
              {calendarDays.map((day) => (
                <div
                  key={day.date}
                  className={`w-3.5 h-3.5 rounded-sm ${getHeatColor(day.level)}`}
                  title={`${day.date}: ${day.count} 次学习`}
                />
              ))}
            </div>
            {/* 图例 */}
            <div className="flex items-center gap-2 mt-3 text-xs text-warm-400">
              <span>少</span>
              <div className="w-3.5 h-3.5 rounded-sm bg-warm-100" />
              <div className="w-3.5 h-3.5 rounded-sm bg-green-200" />
              <div className="w-3.5 h-3.5 rounded-sm bg-green-300" />
              <div className="w-3.5 h-3.5 rounded-sm bg-green-400" />
              <div className="w-3.5 h-3.5 rounded-sm bg-green-500" />
              <span>多</span>
            </div>
          </div>
        )}
      </div>

      {/* ===== 积分排行榜 ===== */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-warm-900 flex items-center gap-2">
            <Trophy size={18} className="text-pink-500" />
            积分排行榜
          </h3>
          <div className="flex gap-1 bg-warm-100 rounded-xl p-1">
            {RANKING_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleRankingTabChange(tab.key)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                  rankingTab === tab.key
                    ? 'bg-white text-warm-900 shadow-soft'
                    : 'text-warm-500 hover:text-warm-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {rankingLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-primary-600" />
          </div>
        ) : ranking.length === 0 ? (
          <div className="text-center py-8 text-warm-400 text-sm">暂无排行数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="table-header">排名</th>
                  <th className="table-header">姓名</th>
                  <th className="table-header">部门/分组</th>
                  <th className="table-header text-right">积分</th>
                  <th className="table-header text-right">平均分</th>
                </tr>
              </thead>
              <tbody>
                {ranking.slice(0, 20).map((item, idx) => {
                  const isMe = currentUserId && (item.user_id === currentUserId || item.id === currentUserId);
                  const rank = item.rank || idx + 1;
                  return (
                    <tr
                      key={item.user_id || idx}
                      className={`border-b transition ${
                        isMe ? 'bg-primary-50 border-primary-200' : 'hover:bg-warm-50/80'
                      }`}
                    >
                      <td className="table-cell">
                        {rank <= 3 ? (
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                            rank === 1 ? 'bg-yellow-400 text-white' :
                            rank === 2 ? 'bg-gray-300 text-white' :
                            'bg-amber-600 text-white'
                          }`}>
                            {rank}
                          </span>
                        ) : (
                          <span className="text-warm-500">{rank}</span>
                        )}
                      </td>
                      <td className="table-cell font-medium text-warm-900">
                        {item.real_name || item.name || item.username || '-'}
                        {isMe && (
                          <span className="badge-blue text-xs ml-2">我</span>
                        )}
                      </td>
                      <td className="table-cell text-warm-500">
                        {item.department || item.group_name || '-'}
                      </td>
                      <td className="table-cell text-right font-semibold text-warm-900">
                        {item.points ?? '-'}
                      </td>
                      <td className="table-cell text-right text-warm-500">
                        {item.avg_score != null ? item.avg_score : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== 积分规则 ===== */}
      <div className="card">
        <button
          onClick={() => setShowRules(!showRules)}
          className="w-full flex items-center justify-between"
        >
          <h3 className="font-semibold text-warm-900 flex items-center gap-2">
            <Star size={18} className="text-amber-500" />
            积分获取规则
          </h3>
          {showRules ? <ChevronUp size={18} className="text-warm-400" /> : <ChevronDown size={18} className="text-warm-400" />}
        </button>
        {showRules && (
          <div className="mt-4 space-y-2">
            {rulesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 size={20} className="animate-spin text-primary-600" />
              </div>
            ) : (
              pointRules.map((rule, idx) => {
                const iconMap = { zap: Zap, book: BookOpen, file: FileText, message: MessageSquare, user: Users };
                const Icon = iconMap[rule.icon] || Star;
                return (
                  <div key={rule.id || idx} className="flex items-center gap-3 p-3 bg-warm-50/80 rounded-xl">
                    <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                      <Icon size={17} className="text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-warm-800">{rule.action}</p>
                      <p className="text-xs text-warm-400">{rule.description}</p>
                    </div>
                    <span className="px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg text-sm font-bold shrink-0">
                      +{rule.points}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ===== 积分明细 ===== */}
      <div className="card">
        <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
          <Award size={18} className="text-amber-500" />
          积分明细
        </h3>
        {detailsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-primary-600" />
          </div>
        ) : pointDetails.length === 0 ? (
          <div className="text-center py-8 text-warm-400 text-sm">暂无积分记录</div>
        ) : (
          <>
            <div className="space-y-0">
              {pointDetails.map((log, idx) => {
                const iconMap = {
                  daily_question: Zap,
                  learning: BookOpen,
                  exam: FileText,
                  training: MessageSquare,
                  manual_adjust: Users,
                };
                const Icon = iconMap[log.source_type] || Award;
                return (
                  <div
                    key={log.id || idx}
                    className={`flex items-center gap-3 py-3 ${idx < pointDetails.length - 1 ? 'border-b' : ''}`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-warm-50 flex items-center justify-center shrink-0">
                      <Icon size={17} className="text-warm-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-warm-800 truncate">{log.reason || log.source_label}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="badge text-xs bg-warm-100 text-warm-500">{log.source_label}</span>
                        {log.created_at && (
                          <span className="text-xs text-warm-400">
                            {new Date(log.created_at).toLocaleString('zh-CN')}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`text-sm font-bold ${log.points > 0 ? 'text-emerald-600' : 'text-rose-500'} shrink-0`}>
                      {log.points > 0 ? '+' : ''}{log.points}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* 分页 */}
            {pointDetailsTotal > 10 && (
              <div className="flex items-center justify-center gap-2 mt-4 pt-3 border-t">
                <button
                  onClick={() => loadPointDetails(pointDetailsPage - 1)}
                  disabled={pointDetailsPage <= 1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-warm-200 hover:bg-warm-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  上一页
                </button>
                <span className="text-sm text-warm-500">
                  {pointDetailsPage} / {Math.ceil(pointDetailsTotal / 10)}
                </span>
                <button
                  onClick={() => loadPointDetails(pointDetailsPage + 1)}
                  disabled={pointDetailsPage >= Math.ceil(pointDetailsTotal / 10)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-warm-200 hover:bg-warm-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
