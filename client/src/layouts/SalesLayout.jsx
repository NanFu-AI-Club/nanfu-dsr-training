import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MessageSquare, GraduationCap, FileText, Users, BarChart3, User, LogOut, Zap, Star, CheckCircle, XCircle, Award, X, KeyRound, ShoppingBag, CalendarDays, Flame, Gift, Check, Loader2, ChevronLeft, ChevronRight, Sparkles, Camera, Share2, Megaphone } from 'lucide-react';
import api from '../api';
import ChangePasswordModal from '../components/ChangePasswordModal';

const menuItems = [
  { path: '/sales/chat', icon: MessageSquare, label: '跑店问问' },
  { path: '/sales/training', icon: Users, label: 'FU利陪陪' },
  { path: '/sales/shares', icon: Share2, label: '分享圈' },
  { path: '/sales/announcements', icon: Megaphone, label: '公告' },
  { path: '/sales/learning', icon: GraduationCap, label: '销冠闯关秘籍' },
  { path: '/sales/exam', icon: FileText, label: '销冠答题挑战赛' },
  { path: '/sales/submission', icon: Camera, label: '风采投稿' },
  { path: '/sales/statistics', icon: BarChart3, label: '我的销冠成长榜' },
  { path: '/sales/profile', icon: User, label: '我的画像' },
];

/* ========== 签到弹窗（登录后弹出） ========== */
function CheckInPopup({ onClose }) {
  const [status, setStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [showResult, setShowResult] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statusRes, tasksRes] = await Promise.all([
        api.get('/checkin/status'),
        api.get('/checkin/tasks'),
      ]);
      setStatus(statusRes.data || statusRes);
      setTasks(tasksRes.data?.tasks || (tasksRes.data || []));
    } catch (err) {
      console.error('加载签到数据失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async () => {
    if (checkingIn || status?.checked_in) return;
    try {
      setCheckingIn(true);
      const res = await api.post('/checkin');
      const data = res.data || res;
      setShowResult(data);
      await loadData();
    } catch (err) {
      console.error('签到失败:', err);
    } finally {
      setCheckingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-warm-900/30 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white rounded-3xl p-8 flex items-center justify-center min-h-[200px] shadow-soft-xl">
          <Loader2 size={36} className="animate-spin text-amber-500" />
        </div>
      </div>
    );
  }

  const checkedIn = status?.checked_in || false;
  const streak = status?.streak || 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-warm-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl sm:rounded-3xl shadow-soft-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-slide-up">
        {/* 头部 */}
        <div className="bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 px-5 sm:px-6 py-4 sm:py-5 text-white shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center">
                <CalendarDays size={22} />
              </div>
              <div>
                <h3 className="font-bold text-lg">每日签到</h3>
                <p className="text-white/70 text-xs">签到领积分，连续签到奖励更多</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="px-5 sm:px-6 py-4 sm:py-5 overflow-y-auto flex-1 space-y-4">
          {showResult ? (
            /* 签到成功 */
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center">
                <Award size={36} className="text-white" />
              </div>
              <h3 className="text-lg font-bold text-warm-900">签到成功！</h3>
              <div className="flex items-center justify-center gap-1 mt-2">
                <span className="text-3xl font-black text-amber-500">+{showResult.points_earned}</span>
                <span className="text-warm-400">积分</span>
              </div>
              <p className="text-sm text-warm-500 mt-1">{showResult.reason}</p>
              <button onClick={onClose} className="btn-primary w-full py-3 mt-4">
                去签到页查看更多
              </button>
            </div>
          ) : (
            <>
              {/* 签到按钮 */}
              <div className="flex flex-col items-center py-2">
                <button
                  onClick={handleCheckIn}
                  disabled={checkedIn || checkingIn}
                  className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-full flex flex-col items-center justify-center transition-all duration-300 ${
                    checkedIn
                      ? 'bg-amber-50 border-2 border-amber-200'
                      : 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95'
                  }`}
                >
                  {checkingIn ? (
                    <Loader2 size={36} className="animate-spin text-white" />
                  ) : checkedIn ? (
                    <>
                      <Check size={36} className="text-emerald-500" />
                      <span className="text-xs text-warm-500 mt-1">今日已签到</span>
                    </>
                  ) : (
                    <>
                      <Gift size={32} className="text-white" />
                      <span className="text-xs text-white mt-0.5 font-bold">点击签到</span>
                    </>
                  )}
                </button>

                <div className="flex items-center gap-2 mt-3">
                  <div className="flex items-center gap-1 bg-amber-50 rounded-full px-3 py-1">
                    <Flame size={14} className="text-amber-500" />
                    <span className="text-sm font-bold text-amber-600">连续{streak}天</span>
                  </div>
                  {checkedIn && (
                    <div className="flex items-center gap-1 bg-emerald-50 rounded-full px-3 py-1">
                      <Award size={14} className="text-emerald-500" />
                      <span className="text-sm font-bold text-emerald-600">+{status?.today_points || 0}</span>
                    </div>
                  )}
                </div>

                {/* 连续签到提示 */}
                {streak > 0 && streak < 3 && !checkedIn && (
                  <p className="text-xs text-amber-600 mt-2">
                    再签到{3 - streak}天获得额外 +10 积分！
                  </p>
                )}
                {streak >= 3 && streak < 7 && !checkedIn && (
                  <p className="text-xs text-amber-600 mt-2">
                    再签到{7 - streak}天获得额外 +20 积分！
                  </p>
                )}
                {streak >= 7 && streak < 30 && !checkedIn && (
                  <p className="text-xs text-amber-600 mt-2">
                    再签到{30 - streak}天获得额外 +50 积分！
                  </p>
                )}
                {streak >= 30 && !checkedIn && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <Sparkles size={12} /> 连续30天达成！今日签到可获额外 +50 积分
                  </p>
                )}
              </div>

              {/* 本月签到日历（迷你） */}
              <div className="bg-warm-50 rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-warm-600">本月签到</span>
                  <span className="text-xs text-warm-400">已签 {status?.month_dates?.length || 0} / {status?.total_days || 0} 天</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {(() => {
                    const now = new Date();
                    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                    const monthDates = status?.month_dates || [];
                    const today = now.getDate();
                    const cells = [];
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                      const isChecked = monthDates.includes(dateStr);
                      const isToday = d === today;
                      cells.push(
                        <div
                          key={d}
                          className={`w-5 h-5 rounded text-[9px] flex items-center justify-center font-medium ${
                            isChecked
                              ? 'bg-amber-400 text-white'
                              : isToday
                              ? 'bg-primary-100 text-primary-600 border border-primary-300'
                              : 'bg-white text-warm-400 border border-warm-100'
                          }`}
                        >
                          {isChecked ? <Check size={10} /> : d}
                        </div>
                      );
                    }
                    return cells;
                  })()}
                </div>
              </div>

              {/* 积分奖励简览 */}
              <div>
                <h4 className="text-sm font-semibold text-warm-800 mb-2 flex items-center gap-1.5">
                  <Star size={15} className="text-amber-500" />
                  积分奖励
                </h4>
                <div className="space-y-1.5">
                  {tasks.slice(0, 3).map(task => (
                    <div
                      key={task.source_type}
                      className={`flex items-center gap-2 p-2 rounded-xl text-xs ${
                        task.today_done
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-warm-50 text-warm-600'
                      }`}
                    >
                      {task.today_done ? (
                        <CheckCircle size={14} className="shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-warm-300 shrink-0" />
                      )}
                      <span className="flex-1">{task.action}</span>
                      <span className="font-bold text-amber-500">+{task.points}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={onClose} className="btn-primary w-full py-3">
                进入签到页
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========== 每日一题弹窗 ========== */
function DailyQuestionModal({ onClose }) {
  const [question, setQuestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);

  useEffect(() => { loadDailyQuestion(); }, []);

  const loadDailyQuestion = async () => {
    try {
      setLoading(true);
      const res = await api.get('/questions/daily');
      const data = res.data || res;
      if (data.answered) { setAlreadyAnswered(true); }
      else if (data.question) { setQuestion(data.question); }
    } catch (err) { console.error('加载每日一题失败:', err); }
    finally { setLoading(false); }
  };

  const handleSubmit = async () => {
    if (!selectedAnswer || !question) return;
    try {
      const res = await api.post('/questions/daily/answer', { question_id: question.id, answer: selectedAnswer });
      const data = res.data || res;
      setResult(data);
      setSubmitted(true);
    } catch (err) { console.error('提交答案失败:', err); }
  };

  const typeLabel = question?.type === 'single' ? '单选题' : question?.type === 'multiple' ? '多选题' : question?.type === 'judge' ? '判断题' : '题目';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-warm-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl sm:rounded-3xl shadow-soft-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden animate-slide-up">
        <div className="bg-gradient-to-r from-primary-500 to-sky-500 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center"><Zap size={22} /></div>
              <div>
                <h3 className="font-bold text-lg">每日一题</h3>
                <p className="text-white/70 text-xs">答对 +10 积分，答错 +2 积分</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition"><X size={20} /></button>
          </div>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-10"><div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>
          ) : alreadyAnswered ? (
            <div className="text-center py-8">
              <CheckCircle size={48} className="mx-auto mb-3 text-emerald-400" />
              <p className="text-warm-700 font-medium">今日题目已答过</p>
              <p className="text-warm-400 text-sm mt-1">明天再来挑战吧！</p>
            </div>
          ) : !question ? (
            <div className="text-center py-8"><p className="text-warm-400">暂无可用题目</p></div>
          ) : submitted && result ? (
            <div className="space-y-4">
              <div className={`flex items-center gap-3 p-4 rounded-2xl ${result.isCorrect ? 'bg-emerald-50 border border-emerald-100' : 'bg-rose-50 border border-rose-100'}`}>
                {result.isCorrect ? <CheckCircle size={28} className="text-emerald-500 shrink-0" /> : <XCircle size={28} className="text-rose-500 shrink-0" />}
                <div>
                  <p className={`font-bold ${result.isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>{result.isCorrect ? '回答正确！' : '回答错误'}</p>
                  <div className="flex items-center gap-1.5 mt-0.5"><Award size={14} className="text-amber-500" /><span className="text-sm text-amber-600 font-medium">+{result.earnedPoints} 积分</span></div>
                </div>
              </div>
              {!result.isCorrect && <div className="p-3 bg-warm-50 rounded-xl text-sm"><p className="text-warm-500 mb-1">正确答案：</p><p className="text-warm-800 font-medium">{Array.isArray(result.correctAnswer) ? result.correctAnswer.join('、') : result.correctAnswer}</p></div>}
              {result.analysis && <div className="p-3 bg-sky-50 rounded-xl text-sm border border-sky-100"><p className="text-sky-700 font-medium mb-1">解析：</p><p className="text-warm-700">{result.analysis}</p></div>}
              <button onClick={onClose} className="btn-primary w-full py-3">知道了</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2.5 py-0.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-medium">{typeLabel}</span>
                {question.category && <span className="px-2.5 py-0.5 bg-warm-100 text-warm-600 rounded-lg text-xs">{question.category}</span>}
              </div>
              <p className="text-warm-900 font-medium leading-relaxed">{question.content}</p>
              <div className="space-y-2">
                {Array.isArray(question.options) && question.options.map((opt, idx) => {
                  const letter = String.fromCharCode(65 + idx);
                  const isSelected = selectedAnswer === letter || (Array.isArray(selectedAnswer) && selectedAnswer.includes(letter));
                  return (
                    <button key={idx}
                      onClick={() => {
                        if (question.type === 'multiple') {
                          setSelectedAnswer(prev => { const arr = Array.isArray(prev) ? prev : []; return arr.includes(letter) ? arr.filter(a => a !== letter) : [...arr, letter]; });
                        } else { setSelectedAnswer(letter); }
                      }}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all duration-200 ${isSelected ? 'border-primary-300 bg-primary-50 text-primary-700 shadow-inner-soft' : 'border-warm-100 hover:border-primary-200 hover:bg-warm-50/50 text-warm-700'}`}
                    >
                      <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${isSelected ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500'}`}>{letter}</span>
                      <span className="text-sm">{typeof opt === 'string' ? opt : opt.text || opt.content || JSON.stringify(opt)}</span>
                    </button>
                  );
                })}
              </div>
              {question.type === 'judge' && !Array.isArray(question.options) && (
                <div className="flex gap-3">
                  {[{ label: '正确', value: 'true' }, { label: '错误', value: 'false' }].map(opt => (
                    <button key={opt.value} onClick={() => setSelectedAnswer(opt.value)}
                      className={`flex-1 p-3.5 rounded-2xl border text-center font-medium transition-all duration-200 ${selectedAnswer === opt.value ? 'border-primary-300 bg-primary-50 text-primary-700 shadow-inner-soft' : 'border-warm-100 hover:border-primary-200 hover:bg-warm-50/50 text-warm-700'}`}
                    >{opt.label}</button>
                  ))}
                </div>
              )}
              <button onClick={handleSubmit} disabled={!selectedAnswer} className="btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed">提交答案</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SalesLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canUseAdminExperience = user?.role === 'admin' && user?.manager_type !== 'city_manager';
  const [showCheckInPopup, setShowCheckInPopup] = useState(false);
  const [showDailyQuestion, setShowDailyQuestion] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [notices, setNotices] = useState([]);
  const [announceNotices, setAnnounceNotices] = useState([]);
  const [announceUnread, setAnnounceUnread] = useState(0);
  const handleLogout = () => { logout(); navigate('/login'); };

  // 拉取未读通知（如管理员调整积分）与未读公告，登录后弹窗提醒
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [notiRes, annRes] = await Promise.all([
          api.get('/notifications/unread').catch(() => null),
          api.get('/announcements/unread').catch(() => null),
        ]);
        const list = notiRes?.data || notiRes || [];
        if (!cancelled && Array.isArray(list) && list.length > 0) setNotices(list);
        const annList = annRes?.data || [];
        if (!cancelled && Array.isArray(annList) && annList.length > 0) setAnnounceNotices(annList);
      } catch (_) { /* 静默失败，不打扰用户 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 侧边栏公告红点（进入页面/切换路由后刷新）
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/announcements/unread-count');
        if (!cancelled) setAnnounceUnread(res?.data?.count || 0);
      } catch (_) { /* 忽略 */ }
    })();
    return () => { cancelled = true; };
  }, [location.pathname]);

  const dismissNotices = async () => {
    const ids = notices.map((n) => n.id);
    setNotices([]);
    setAnnounceNotices([]);
    setAnnounceUnread(0);
    try {
      if (ids.length > 0) await api.post('/notifications/read', { ids });
      await api.post('/announcements/read-all');
    } catch (_) { /* 忽略 */ }
  };

  // 登录后弹出签到面板（替代每日一题）
  useEffect(() => {
    const shown = sessionStorage.getItem('checkin_popup_shown');
    if (!shown) {
      const timer = setTimeout(() => {
        setShowCheckInPopup(true);
        sessionStorage.setItem('checkin_popup_shown', '1');
      }, 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const sidebarContent = (
    <>
      {/* 品牌区 */}
      <div className="h-16 flex items-center px-5 border-b border-warm-100/60 shrink-0">
        <div className="w-9 h-9 bg-gradient-to-br from-sky-400 to-primary-600 rounded-2xl flex items-center justify-center text-white font-bold text-sm mr-3 shrink-0 shadow-soft">
          南
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm text-warm-800 truncate">终端跑店宝典</div>
          <div className="text-[11px] text-warm-500 truncate">智能培训助手</div>
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {menuItems.map((item) => (
          <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-sky-50 to-primary-50 text-primary-700 font-medium shadow-inner-soft'
                  : 'text-warm-600 hover:bg-warm-50 hover:text-warm-800'
              }`
            }
          >
            <item.icon size={18} className="shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.path === '/sales/announcements' && announceUnread > 0 && (
              <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-medium flex items-center justify-center">
                {announceUnread > 99 ? '99+' : announceUnread}
              </span>
            )}
          </NavLink>
        ))}

        {/* 积分商城快捷入口 */}
        <NavLink
          to="/sales/shop"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-200 w-full ${
              isActive ? 'bg-primary-50 text-primary-700 font-medium' : 'text-warm-600 hover:bg-rose-50 hover:text-rose-700'
            }`
          }
        >
          <ShoppingBag size={18} className="shrink-0 text-rose-500" />
          <span className="truncate">积分商城</span>
        </NavLink>

        {/* 每日一题快捷入口 */}
        <button
          onClick={() => setShowDailyQuestion(true)}
          className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-200 w-full text-warm-600 hover:bg-amber-50 hover:text-amber-700"
        >
          <Zap size={18} className="shrink-0 text-amber-500" />
          <span className="truncate">每日一题</span>
          <span className="ml-auto px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded text-[10px] font-bold">+10</span>
        </button>

        {/* 每日签到快捷入口 */}
        <NavLink
          to="/sales/checkin"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-200 w-full ${
              isActive ? 'bg-amber-50 text-amber-700 font-medium' : 'text-warm-600 hover:bg-amber-50 hover:text-amber-700'
            }`
          }
        >
          <CalendarDays size={18} className="shrink-0 text-amber-500" />
          <span className="truncate">每日签到</span>
          <span className="ml-auto px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded text-[10px] font-bold">+5</span>
        </NavLink>
      </nav>

      {/* 底部用户区 */}
      <div className="border-t border-warm-100/60 p-3 shrink-0">
        {canUseAdminExperience && (
          <button
            onClick={() => navigate('/admin')}
            className="flex items-center gap-2.5 text-sm text-primary-600 hover:text-primary-700 transition-all duration-200 w-full px-3 py-2 rounded-xl hover:bg-primary-50 mb-2"
          >
            <Users size={16} />
            进入管理后台
          </button>
        )}
        <div className="flex items-center gap-3 mb-3 px-2">
          <div className="w-9 h-9 bg-gradient-to-br from-sky-200 to-primary-300 rounded-full flex items-center justify-center text-primary-700 text-sm font-bold shrink-0 shadow-soft">
            {user?.real_name?.[0] || 'S'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-warm-800 truncate">{user?.real_name}</div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-warm-400">{user?.manager_type === 'region_manager' ? '大区经理' : user?.manager_type === 'area_manager' ? '区域经理' : user?.manager_type === 'system_admin' ? '系统管理员' : '业务员'}</span>
              <span className="text-[10px] text-warm-300">·</span>
              <span className="text-xs text-accent-600 font-medium flex items-center gap-0.5">
                <Star size={10} className="fill-accent-400" />
                {user?.points || 0} 积分
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowChangePassword(true)}
          className="flex items-center gap-2.5 text-sm text-warm-500 hover:text-primary-600 transition-all duration-200 w-full px-3 py-2 rounded-xl hover:bg-primary-50 mb-1"
        >
          <KeyRound size={16} />
          修改密码
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 text-sm text-warm-500 hover:text-rose-500 transition-all duration-200 w-full px-3 py-2.5 rounded-xl hover:bg-rose-50"
        >
          <LogOut size={16} />
          退出登录
        </button>
      </div>
    </>
  );

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-warm-50">
      {/* ========== 移动端顶部栏 ========== */}
      <div className="md:hidden shrink-0 z-30 bg-white/80 backdrop-blur-xl border-b border-warm-100/60 px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 bg-gradient-to-br from-sky-400 to-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0">
            跑
          </div>
          <span className="text-sm font-bold text-warm-800 truncate hidden min-[380px]:inline">终端跑店宝典</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => navigate('/sales/announcements')}
            className="relative p-1.5 rounded-xl bg-sky-50 text-sky-500 transition-all"
            title="信息公告"
          >
            <Megaphone size={18} />
            {announceUnread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-medium flex items-center justify-center">
                {announceUnread > 99 ? '99+' : announceUnread}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowDailyQuestion(true)}
            className="p-1.5 rounded-xl bg-amber-50 text-amber-500 transition-all"
            title="每日一题"
          >
            <Zap size={18} />
          </button>
          <button
            onClick={() => navigate('/sales/checkin')}
            className="p-1.5 rounded-xl bg-amber-50 text-amber-500 transition-all"
            title="签到"
          >
            <CalendarDays size={18} />
          </button>
          <button
            onClick={() => navigate('/sales/submission')}
            className="p-1.5 rounded-xl bg-rose-50 text-rose-500 transition-all"
            title="风采投稿"
          >
            <Camera size={18} />
          </button>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-xl hover:bg-warm-50 text-warm-400 transition-all"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* ========== 桌面端侧边栏 + 主内容 ========== */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="hidden md:flex w-56 bg-white/90 backdrop-blur-xl border-r border-warm-100/60 flex-col shrink-0">
          {sidebarContent}
        </aside>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative sky-gradient">
          {/* 背景装饰 */}
          <div className="hidden md:block absolute top-8 right-[20%] w-36 h-14 bg-white/40 rounded-full blur-xl pointer-events-none animate-float-slow" />
          <div className="hidden md:block absolute top-24 right-[45%] w-20 h-8 bg-white/30 rounded-full blur-lg pointer-events-none animate-float-delay" />
          <div className="hidden md:block absolute bottom-16 left-[8%] w-24 h-10 bg-white/25 rounded-full blur-xl pointer-events-none animate-float" />
          <div className="hidden md:block absolute top-36 left-[25%] w-16 h-6 bg-white/20 rounded-full blur-lg pointer-events-none animate-float-delay" />

          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-2 md:p-6 relative z-10">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="md:hidden shrink-0 z-40 bg-white border-t border-warm-100 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] grid grid-cols-4 gap-1 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <NavLink to="/sales/chat" className={({ isActive }) => `flex flex-col items-center gap-1 py-1.5 rounded-xl text-[10px] ${isActive ? 'bg-primary-100 text-primary-800 font-semibold' : 'text-warm-700'}`}><MessageSquare size={18} /><span>跑店问问</span></NavLink>
        <NavLink to="/sales/training" className={({ isActive }) => `flex flex-col items-center gap-1 py-1.5 rounded-xl text-[10px] ${isActive ? 'bg-primary-100 text-primary-800 font-semibold' : 'text-warm-700'}`}><Users size={18} /><span>FU利陪陪</span></NavLink>
        <NavLink to="/sales/shares" className={({ isActive }) => `flex flex-col items-center gap-1 py-1.5 rounded-xl text-[10px] ${isActive ? 'bg-primary-100 text-primary-800 font-semibold' : 'text-warm-700'}`}><Share2 size={18} /><span>分享圈</span></NavLink>
        <NavLink to="/sales/profile" className={({ isActive }) => `flex flex-col items-center gap-1 py-1.5 rounded-xl text-[10px] ${isActive ? 'bg-primary-100 text-primary-800 font-semibold' : 'text-warm-700'}`}><User size={18} /><span>我的</span></NavLink>
      </nav>

      {/* 签到弹窗（登录后弹出） */}
      {showCheckInPopup && (
        <CheckInPopup onClose={() => setShowCheckInPopup(false)} />
      )}
      {/* 每日一题弹窗 */}
      {showDailyQuestion && (
        <DailyQuestionModal onClose={() => setShowDailyQuestion(false)} />
      )}

      {/* 通知弹窗（管理员调整积分、公告等），避免与签到/每日一题同时弹出 */}
      {(notices.length > 0 || announceNotices.length > 0) && !showCheckInPopup && !showDailyQuestion && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-soft-xl w-full max-w-sm overflow-hidden">
            <div className="px-5 pt-5 pb-3 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-amber-50 flex items-center justify-center mb-2">
                <Award size={24} className="text-amber-500" />
              </div>
              <h3 className="text-base font-bold text-warm-900">
                {(notices.length + announceNotices.length) > 1 ? `你有 ${notices.length + announceNotices.length} 条新提醒` : '你有一条新提醒'}
              </h3>
            </div>
            <div className="px-5 max-h-72 overflow-y-auto space-y-2.5">
              {announceNotices.map((a) => (
                <div key={'ann_' + a.id} className="p-3 rounded-xl bg-primary-50 border border-primary-100">
                  <p className="text-sm font-semibold text-warm-800">
                    <span className="mr-1.5 px-1.5 py-0.5 rounded bg-primary-500 text-white text-[10px] align-middle">公告</span>
                    {a.title}
                  </p>
                  <p className="text-xs text-warm-600 mt-1 leading-relaxed whitespace-pre-wrap">{a.content}</p>
                  <p className="text-[11px] text-warm-300 mt-1.5">{String(a.published_at || '').slice(0, 16)}</p>
                </div>
              ))}
              {notices.map((n) => (
                <div key={n.id} className="p-3 rounded-xl bg-warm-50 border border-warm-100">
                  <p className="text-sm font-semibold text-warm-800">{n.title || '通知'}</p>
                  <p className="text-xs text-warm-500 mt-1 leading-relaxed whitespace-pre-wrap">{n.content}</p>
                  <p className="text-[11px] text-warm-300 mt-1.5">{String(n.created_at || '').slice(0, 16)}</p>
                </div>
              ))}
            </div>
            <div className="p-5">
              <button onClick={dismissNotices} className="btn-primary w-full">我知道了</button>
            </div>
          </div>
        </div>
      )}
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
