import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Flame, Award, Gift, Check, ChevronLeft, ChevronRight, Star, BookOpen, FileText, MessageSquare, Loader2, Sparkles, Crown } from 'lucide-react';
import api from '../../api';
import { todayShanghai } from '../../utils/time';

const ICON_MAP = {
  calendar: CalendarDays,
  flame: Flame,
  fire: Flame,
  crown: Crown,
  gift: Gift,
  star: Star,
  book: BookOpen,
  file: FileText,
  message: MessageSquare,
  sparkles: Sparkles,
};

export default function CheckIn() {
  const [status, setStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [calendar, setCalendar] = useState(null);
  const [currMonth, setCurrMonth] = useState(() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  });
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [showSuccess, setShowSuccess] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const [statusRes, tasksRes, calRes] = await Promise.all([
        api.get('/checkin/status'),
        api.get('/checkin/tasks'),
        api.get(`/checkin/calendar?month=${currMonth}`),
      ]);
      setStatus(statusRes.data || statusRes);
      setTasks(tasksRes.data?.tasks || (tasksRes.data || []));
      setCalendar(calRes.data || calRes);
    } catch (err) {
      console.error('加载签到数据失败:', err);
    } finally {
      setLoading(false);
    }
  }, [currMonth]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleCheckIn = async () => {
    if (checkingIn || status?.checked_in) return;
    try {
      setCheckingIn(true);
      setAnimating(true);
      const res = await api.post('/checkin');
      const data = res.data || res;
      setShowSuccess(data);
      setAnimating(false);
      // 刷新数据
      await loadAll();
      // 3秒后自动关闭成功提示
      setTimeout(() => setShowSuccess(null), 3000);
    } catch (err) {
      setAnimating(false);
      console.error('签到失败:', err);
    } finally {
      setCheckingIn(false);
    }
  };

  const changeMonth = (offset) => {
    const [year, month] = currMonth.split('-').map(Number);
    const d = new Date(year, month - 1 + offset, 1);
    setCurrMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-primary-500" />
      </div>
    );
  }

  const checkedIn = status?.checked_in || false;
  const streak = status?.streak || 0;

  // 连续签到里程碑
  const showStreakMilestone = streak > 0 && [3, 7, 30].includes(streak);
  const nextMilestone = streak < 3 ? 3 : streak < 7 ? 7 : streak < 30 ? 30 : null;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-2xl mx-auto pb-4">
      {/* ========== 签到主卡片 ========== */}
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-gradient-to-br from-amber-400 via-orange-400 to-rose-500 p-5 sm:p-8 text-white shadow-soft-xl">
        {/* 背景装饰 */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2 blur-xl" />

        <div className="relative">
          {/* 状态栏 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarDays size={20} className="text-white/80" />
              <span className="text-white/80 text-sm">
                {new Date().getMonth() + 1}月{new Date().getDate()}日
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1">
              <Flame size={16} className={streak > 0 ? 'animate-pulse' : ''} />
              <span className="font-bold text-sm">连续{streak}天</span>
            </div>
          </div>

          {/* 签到按钮 */}
          <div className="flex flex-col items-center py-2 sm:py-4">
            <button
              onClick={handleCheckIn}
              disabled={checkedIn || checkingIn}
              className={`relative w-24 h-24 sm:w-32 sm:h-32 rounded-full flex flex-col items-center justify-center transition-all duration-300 ${
                checkedIn
                  ? 'bg-white/30 cursor-default'
                  : 'bg-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95'
              }`}
            >
              {checkingIn && animating ? (
                <Loader2 size={36} className="animate-spin text-amber-500" />
              ) : checkedIn ? (
                <>
                  <Check size={36} className="text-emerald-400" />
                  <span className="text-xs text-white/70 mt-1">已签到</span>
                </>
              ) : (
                <>
                  <Gift size={32} className="text-amber-500" />
                  <span className="text-xs text-amber-500 mt-0.5 font-bold">签到</span>
                </>
              )}
            </button>

            {!checkedIn && (
              <p className="mt-3 text-white/70 text-sm">点击签到领取今日积分</p>
            )}

            {checkedIn && (
              <div className="mt-3 flex items-center gap-1.5 bg-white/20 rounded-full px-4 py-1.5">
                <Award size={16} />
                <span className="text-sm font-bold">今日获得 {status?.today_points || 0} 积分</span>
              </div>
            )}
          </div>

          {/* 里程碑提示 */}
          {showStreakMilestone && (
            <div className="mt-3 flex items-center justify-center gap-2 bg-white/15 rounded-xl py-2 px-4 animate-pulse">
              <Crown size={16} />
              <span className="text-sm font-bold">连续签到{streak}天！太棒了！</span>
            </div>
          )}

          {!checkedIn && nextMilestone && (
            <div className="mt-3 flex items-center justify-center gap-2 bg-white/10 rounded-xl py-2 px-4">
              <Flame size={14} />
              <span className="text-xs">再签到{nextMilestone - streak}天达成{nextMilestone}天里程碑</span>
            </div>
          )}
        </div>
      </div>

      {/* ========== 签到成功动画 ========== */}
      {showSuccess && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowSuccess(null)} />
          <div className="relative bg-white rounded-3xl p-8 text-center shadow-soft-2xl animate-slide-up max-w-sm w-full">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center">
              <Award size={36} className="text-white" />
            </div>
            <h3 className="text-xl font-bold text-warm-900 mb-1">签到成功！</h3>
            <p className="text-warm-500 text-sm mb-1">{showSuccess.reason}</p>
            <div className="flex items-center justify-center gap-1 mt-3">
              <span className="text-3xl font-black text-amber-500">+{showSuccess.points_earned}</span>
              <span className="text-warm-400">积分</span>
            </div>
            <p className="text-xs text-warm-400 mt-2">已连续签到 {showSuccess.streak} 天</p>
            <button
              onClick={() => setShowSuccess(null)}
              className="mt-5 btn-primary w-full py-3"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* ========== 签到日历 ========== */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-warm-900 flex items-center gap-2">
            <CalendarDays size={18} className="text-warm-400" />
            签到日历
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => changeMonth(-1)}
              className="p-1.5 rounded-lg hover:bg-warm-100 transition"
            >
              <ChevronLeft size={18} className="text-warm-400" />
            </button>
            <span className="text-sm font-medium text-warm-700 w-28 text-center">
              {currMonth.split('-')[0]}年{currMonth.split('-')[1]}月
            </span>
            <button
              onClick={() => changeMonth(1)}
              className="p-1.5 rounded-lg hover:bg-warm-100 transition"
            >
              <ChevronRight size={18} className="text-warm-400" />
            </button>
          </div>
        </div>

        {/* 星期头 */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['一', '二', '三', '四', '五', '六', '日'].map((d, i) => (
            <div key={i} className="text-center text-xs text-warm-400 font-medium py-1">
              {d}
            </div>
          ))}
        </div>

        {/* 日期格子 */}
        <div className="grid grid-cols-7 gap-1">
          {(() => {
            const [year, month] = currMonth.split('-').map(Number);
            const firstDay = new Date(year, month - 1, 1).getDay();
            const daysInMonth = new Date(year, month, 0).getDate();
            const cells = [];

            // 填充前面的空白
            const startOffset = firstDay === 0 ? 6 : firstDay - 1; // 周一为第一天
            for (let i = 0; i < startOffset; i++) {
              cells.push(<div key={`empty-${i}`} />);
            }

            // 日期
            for (let d = 1; d <= daysInMonth; d++) {
              const dateStr = currMonth + '-' + String(d).padStart(2, '0');
              const dayData = calendar?.calendar?.find(c => c.date === dateStr);
              const isToday = dateStr === todayShanghai();
              const isChecked = dayData?.checked_in;

              cells.push(
                <div
                  key={dateStr}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs transition-all ${
                    isChecked
                      ? 'bg-amber-100 text-amber-700 font-bold'
                      : isToday
                      ? 'bg-primary-50 text-primary-600 font-bold border border-primary-200'
                      : 'text-warm-500'
                  }`}
                >
                  <span>{d}</span>
                  {isChecked && (
                    <Check size={10} className="text-amber-500 mt-0.5" />
                  )}
                </div>
              );
            }

            return cells;
          })()}
        </div>

        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-warm-100 text-xs text-warm-400">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> 已签到
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-primary-50 border border-primary-200" /> 今天
          </span>
          <span className="ml-auto">本月签到 {calendar?.total_days || 0} 天</span>
        </div>
      </div>

      {/* ========== 任务栏 ========== */}
      <div className="card">
        <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
          <Star size={18} className="text-amber-500" />
          积分奖励
        </h3>
        <div className="space-y-3">
          {tasks.map((task, idx) => {
            const Icon = ICON_MAP[task.icon] || Star;
            return (
              <div
                key={task.source_type}
                className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all ${
                  task.today_done
                    ? 'bg-emerald-50/50 border-emerald-100'
                    : 'bg-warm-50/50 border-warm-100'
                }`}
              >
                {/* 图标 */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  task.today_done ? 'bg-emerald-100' : 'bg-amber-50'
                }`}>
                  <Icon size={18} className={task.today_done ? 'text-emerald-500' : 'text-amber-500'} />
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-warm-800">{task.action}</span>
                    {task.today_done && (
                      <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded text-[10px] font-medium flex items-center gap-0.5">
                        <Check size={10} /> 今日已完成
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-warm-400 mt-0.5">{task.description}</p>
                </div>

                {/* 积分 */}
                <div className="shrink-0 text-right">
                  <span className="text-sm font-black text-amber-500">+{task.points}</span>
                  <p className="text-[10px] text-warm-400">积分/次</p>
                </div>
              </div>
            );
          })}

          {tasks.length === 0 && (
            <div className="text-center py-8 text-warm-400 text-sm">
              暂无任务
            </div>
          )}
        </div>
      </div>

      {/* ========== 积分历史快捷入口 ========== */}
      <div className="text-center">
        <a
          href="/sales/statistics"
          className="text-sm text-primary-500 hover:text-primary-600 transition"
        >
          查看积分明细与排行 →
        </a>
      </div>
    </div>
  );
}
