import { useCallback, useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Users, UserCheck, BookOpen, FileText, TrendingUp, TrendingDown, Trophy, Clock, HelpCircle, MessageSquare, CheckSquare, Coins, CalendarRange, Filter } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

const STAT_CARD_ICONS = {
  totalUsers: { icon: Users, color: 'text-sky-600', bg: 'bg-sky-50' },
  activeUsers: { icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  totalCourses: { icon: BookOpen, color: 'text-sky-600', bg: 'bg-sky-50' },
  totalExams: { icon: FileText, color: 'text-accent-600', bg: 'bg-accent-50' },
  totalQuestions: { icon: HelpCircle, color: 'text-purple-600', bg: 'bg-purple-50' },
  totalScenarios: { icon: MessageSquare, color: 'text-orange-600', bg: 'bg-orange-50' },
  todayCheckins: { icon: CheckSquare, color: 'text-green-600', bg: 'bg-green-50' },
  totalPoints: { icon: Coins, color: 'text-amber-600', bg: 'bg-amber-50' },
};

const RANK_COLORS = ['#f59e0b', '#94a3b8', '#d97706'];

const RANGE_OPTIONS = [
  { value: 7, label: '近7天' },
  { value: 30, label: '近30天' },
  { value: 90, label: '近90天' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [range, setRange] = useState(30);
  const [filters, setFilters] = useState({ area_id: '', region_id: '', city_id: '' });
  const [regions, setRegions] = useState([]);
  const [cities, setCities] = useState([]);

  const [overview, setOverview] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [learningActivity, setLearningActivity] = useState([]);
  const [examStats, setExamStats] = useState(null);
  const [popularCourses, setPopularCourses] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadOptions = useCallback(async () => {
    try {
      const [regionRes, cityRes] = await Promise.all([
        api.get('/users/regions'), api.get('/users/cities'),
      ]);
      setRegions(regionRes?.data || regionRes || []);
      setCities(cityRes?.data || cityRes || []);
    } catch (err) {
      console.error('组织选项加载失败:', err);
    }
  }, []);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { range };
      if (filters.area_id) params.area_id = filters.area_id;
      if (filters.region_id) params.region_id = filters.region_id;
      if (filters.city_id) params.city_id = filters.city_id;

      const res = await api.get('/bi/overview', { params });
      const data = res?.data || res || {};
      setOverview(data.overview || null);
      setRankings(data.rankings || []);
      setLearningActivity(data.learning_activity || []);
      setExamStats(data.exam_stats || null);
      setPopularCourses(data.popular_courses || []);
      setRecentActivities(data.recent_activities || []);
    } catch (err) {
      console.error('获取看板数据失败:', err);
    } finally {
      setLoading(false);
    }
  }, [range, filters]);

  useEffect(() => { loadOptions(); }, [loadOptions]);
  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  // 根据管理员类型锁定组织筛选默认值
  useEffect(() => {
    if (!user || regions.length === 0) return;
    const currentRegion = regions.find((item) => String(item.id) === String(user.region_id));
    if (user.manager_type === 'region_manager' && currentRegion) {
      setFilters((prev) => ({ ...prev, area_id: currentRegion.id }));
    }
    if (user.manager_type === 'area_manager' && currentRegion) {
      setFilters((prev) => ({ ...prev, area_id: currentRegion.parent_id || '', region_id: currentRegion.id }));
    }
  }, [user, regions]);

  const updateFilter = (key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'area_id') { next.region_id = ''; next.city_id = ''; }
      if (key === 'region_id') { next.city_id = ''; }
      return next;
    });
  };

  const areaRegions = regions.filter((item) => item.level === 1);
  const subRegions = regions.filter((item) => item.level === 2 && (!filters.area_id || String(item.parent_id) === String(filters.area_id)));
  const visibleCities = cities.filter((city) => !filters.region_id || String(city.region_id) === String(filters.region_id));

  const statCards = overview
    ? [
        { key: 'totalUsers', label: '总用户数', value: overview.total_users ?? 0, change: overview.user_change },
        { key: 'activeUsers', label: '活跃用户', value: overview.active_users ?? 0, change: overview.active_change },
        { key: 'totalCourses', label: '课程总数', value: overview.total_courses ?? 0, change: overview.course_change },
        { key: 'totalExams', label: '考试总数', value: overview.total_exams ?? 0, change: overview.exam_change },
        { key: 'totalQuestions', label: '题库总数', value: overview.total_questions ?? 0 },
        { key: 'totalScenarios', label: 'FU利陪陪情景', value: overview.total_scenarios ?? 0 },
        { key: 'todayCheckins', label: '今日签到', value: overview.today_checkins ?? 0 },
        { key: 'totalPoints', label: '总积分', value: overview.total_points ?? 0 },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">BI 数据看板</h1>
        <p className="text-sm text-warm-500 mt-1">按时间范围和组织维度查看整体运营情况；具体人员明细请进入“用户统计”。</p>
      </div>

      {/* 筛选栏 */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-warm-500">
            <CalendarRange size={16} />
            <span className="text-sm font-medium">时间范围</span>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-warm-50 p-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                  range === opt.value ? 'bg-white text-primary-700 shadow-sm font-medium' : 'text-warm-500 hover:text-warm-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-warm-500">
            <Filter size={16} />
            <span className="text-sm font-medium">组织维度</span>
          </div>
          <select className="input bg-white !w-auto" value={filters.area_id} onChange={(e) => updateFilter('area_id', e.target.value)} disabled={user?.manager_type === 'region_manager' || user?.manager_type === 'area_manager'} title="大区">
            <option value="">全部大区</option>
            {areaRegions.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
          <select className="input bg-white !w-auto" value={filters.region_id} onChange={(e) => updateFilter('region_id', e.target.value)} disabled={user?.manager_type === 'area_manager' || (!filters.area_id && user?.manager_type !== 'area_manager')}>
            <option value="">{filters.area_id || user?.manager_type === 'area_manager' ? '全部细分区域' : '先选择大区'}</option>
            {subRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
          <select className="input bg-white !w-auto disabled:bg-warm-100" value={filters.city_id} onChange={(e) => updateFilter('city_id', e.target.value)} disabled={!filters.region_id}>
            <option value="">{filters.region_id ? '全部城市' : '先选择细分区域'}</option>
            {visibleCities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select>
          {(filters.area_id || filters.region_id || filters.city_id) && (
            <button className="text-sm text-warm-500 hover:text-primary-600" onClick={() => setFilters({ area_id: '', region_id: '', city_id: '' })}>重置</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((card) => {
              const config = STAT_CARD_ICONS[card.key];
              const Icon = config.icon;
              const isUp = (card.change ?? 0) >= 0;
              return (
                <div key={card.key} className="card flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${config.bg}`}>
                    <Icon size={24} className={config.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-warm-500">{card.label}</div>
                    <div className="text-2xl font-bold text-warm-900">{card.value.toLocaleString()}</div>
                    {card.change != null && card.change > 0 && (
                      <div className={`flex items-center gap-1 text-xs mt-1 ${isUp ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        <span>近{range}天 +{card.change}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 学习活跃度 + 积分排行榜 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card lg:col-span-2">
              <h3 className="text-base font-semibold text-warm-900 mb-4">学习活跃度（近{range}天）</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={learningActivity} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} />
                  <Legend />
                  <Line type="monotone" dataKey="count" name="学习人数" stroke="#4f46e5" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Trophy size={18} className="text-accent-500" />
                <h3 className="text-base font-semibold text-warm-900">积分排行榜</h3>
              </div>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {rankings.slice(0, 15).map((item, index) => {
                  const levelColors = [
                    'bg-gray-100 text-gray-600',
                    'bg-blue-100 text-blue-700',
                    'bg-cyan-100 text-cyan-700',
                    'bg-violet-100 text-violet-700',
                    'bg-amber-100 text-amber-700',
                    'bg-rose-100 text-rose-700',
                  ];
                  const lv = item.level || 1;
                  const titleText = item.title || '江湖跑侠';
                  return (
                  <div key={item.user_id || index} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{
                        backgroundColor: index < 3 ? RANK_COLORS[index] : '#e5e7eb',
                        color: index < 3 ? '#fff' : '#6b7280',
                      }}
                    >
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-warm-900 truncate">{item.real_name || item.name}</div>
                      <div className="text-xs text-warm-400 flex items-center gap-1">
                        <span>{item.region_name || '未分配区域'}</span>
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${levelColors[Math.min(lv, levelColors.length - 1)]}`}>
                          <span className="font-bold">L{lv}</span>
                          <span>{titleText}</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-primary-600">{item.points ?? 0}</div>
                      <div className="text-[10px] text-warm-400">累计积分</div>
                    </div>
                  </div>
                  );
                })}
                {rankings.length === 0 && (
                  <div className="text-sm text-warm-400 text-center py-8">暂无排行数据</div>
                )}
              </div>
            </div>
          </div>

          {/* 考试统计 + 热门课程 + 最近动态 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card">
              <h3 className="text-base font-semibold text-warm-900 mb-4">考试统计（近{range}天）</h3>
              {examStats && (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center p-3 bg-warm-50/80 rounded-xl">
                      <div className="text-xl font-bold text-warm-900">{examStats.total_count ?? 0}</div>
                      <div className="text-xs text-warm-500 mt-1">总次数</div>
                    </div>
                    <div className="text-center p-3 bg-emerald-50 rounded-xl">
                      <div className="text-xl font-bold text-emerald-700">{examStats.pass_rate ?? 0}%</div>
                      <div className="text-xs text-warm-500 mt-1">通过率</div>
                    </div>
                    <div className="text-center p-3 bg-sky-50 rounded-xl">
                      <div className="text-xl font-bold text-sky-700">{examStats.avg_score ?? 0}</div>
                      <div className="text-xs text-warm-500 mt-1">平均分</div>
                    </div>
                  </div>
                  <h4 className="text-sm font-medium text-warm-700 mb-2">热门课程 TOP 5</h4>
                  <div className="space-y-2">
                    {popularCourses.slice(0, 5).map((course, idx) => (
                      <div key={course.id || idx} className="flex items-center gap-2 text-sm">
                        <span className="w-5 h-5 rounded bg-primary-100 text-primary-700 text-xs flex items-center justify-center font-bold shrink-0">
                          {idx + 1}
                        </span>
                        <span className="flex-1 truncate text-warm-700">{course.name || course.title}</span>
                        <span className="text-warm-400 text-xs">{course.exam_count ?? 0}人</span>
                      </div>
                    ))}
                    {popularCourses.length === 0 && (
                      <div className="text-sm text-warm-400 text-center py-4">暂无数据</div>
                    )}
                  </div>
                </>
              )}
              {!examStats && <div className="text-sm text-warm-400 text-center py-8">暂无考试统计数据</div>}
            </div>

            <div className="card lg:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <Clock size={18} className="text-warm-500" />
                <h3 className="text-base font-semibold text-warm-900">最近操作动态</h3>
              </div>
              <div className="space-y-3 max-h-[340px] overflow-y-auto">
                {recentActivities.map((item, idx) => (
                  <div key={item.id || idx} className="flex items-start gap-3 pb-3 border-b last:border-0">
                    <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-sm font-bold shrink-0">
                      {(item.user_name || item.operator || 'A')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">
                        <span className="font-medium text-warm-900">{item.user_name || item.operator}</span>
                        <span className="text-warm-500 ml-1">{item.description || item.action}</span>
                      </div>
                      <div className="text-xs text-warm-400 mt-0.5">{item.created_at || item.time}</div>
                    </div>
                  </div>
                ))}
                {recentActivities.length === 0 && (
                  <div className="text-sm text-warm-400 text-center py-8">暂无动态</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
