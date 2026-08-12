import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Users, UserCheck, BookOpen, FileText, TrendingUp, TrendingDown, Trophy, Clock, HelpCircle, MessageSquare, CheckSquare, Coins } from 'lucide-react';
import api from '../../api';

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

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [learningActivity, setLearningActivity] = useState([]);
  const [examStats, setExamStats] = useState(null);
  const [popularCourses, setPopularCourses] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [overviewRes, rankingsRes, activityRes, examRes, popularRes, activitiesRes] = await Promise.all([
        api.get('/dashboard/overview'),
        api.get('/dashboard/rankings'),
        api.get('/dashboard/learning-activity'),
        api.get('/dashboard/exam-stats'),
        api.get('/dashboard/popular-courses'),
        api.get('/dashboard/recent-activities'),
      ]);
      setOverview(overviewRes?.data || overviewRes);
      setRankings(rankingsRes?.data?.list || rankingsRes?.data || rankingsRes || []);
      setLearningActivity((Array.isArray(activityRes?.data) ? activityRes.data : (activityRes?.data?.list || [])));
      setExamStats(examRes?.data || examRes || {});
      setPopularCourses(popularRes?.data?.list || popularRes?.data || popularRes || []);
      setRecentActivities(activitiesRes?.data?.list || activitiesRes?.data || activitiesRes || []);
    } catch (err) {
      console.error('获取仪表盘数据失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const statCards = overview
    ? [
        { key: 'totalUsers', label: '总用户数', value: overview.total_users ?? 0, change: overview.user_change },
        { key: 'activeUsers', label: '活跃用户', value: overview.active_users ?? 0, change: overview.active_change },
        { key: 'totalCourses', label: '课程总数', value: overview.total_courses ?? 0, change: overview.course_change },
        { key: 'totalExams', label: '考试总数', value: overview.total_exams ?? 0, change: overview.exam_change },
        { key: 'totalQuestions', label: '题库总数', value: overview.total_questions ?? 0 },
        { key: 'totalScenarios', label: '陪练情景', value: overview.total_scenarios ?? 0 },
        { key: 'todayCheckins', label: '今日签到', value: overview.today_checkins ?? 0 },
        { key: 'totalPoints', label: '总积分', value: overview.total_points ?? 0 },
      ]
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">仪表盘</h1>

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
                {card.change != null && (
                  <div className={`flex items-center gap-1 text-xs mt-1 ${isUp ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    <span>{isUp ? '+' : ''}{card.change}%</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 学习活跃度 + 积分排行榜 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 学习活跃度折线图 */}
        <div className="card lg:col-span-2">
          <h3 className="text-base font-semibold text-warm-900 mb-4">学习活跃度（最近30天）</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={learningActivity} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
              />
              <Legend />
              <Line type="monotone" dataKey="count" name="学习人数" stroke="#4f46e5" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 积分排行榜 */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Trophy size={18} className="text-accent-500" />
            <h3 className="text-base font-semibold text-warm-900">积分排行榜</h3>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {rankings.slice(0, 15).map((item, index) => (
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
                  <div className="text-xs text-warm-400">{item.group_name || item.group}</div>
                </div>
                <div className="text-sm font-semibold text-primary-600">{item.points ?? 0}分</div>
              </div>
            ))}
            {rankings.length === 0 && (
              <div className="text-sm text-warm-400 text-center py-8">暂无排行数据</div>
            )}
          </div>
        </div>
      </div>

      {/* 考试统计 + 热门课程 + 最近动态 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 考试统计区域 */}
        <div className="card">
          <h3 className="text-base font-semibold text-warm-900 mb-4">考试统计</h3>
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
                    <span className="text-warm-400 text-xs">{course.exam_count ?? 0}次</span>
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

        {/* 最近操作动态 */}
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
    </div>
  );
}
