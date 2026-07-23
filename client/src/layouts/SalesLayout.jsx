import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MessageSquare, GraduationCap, FileText, Users, BarChart3, User, LogOut, Menu, Zap, Star, CheckCircle, XCircle, Award, X, KeyRound } from 'lucide-react';
import api from '../api';
import ChangePasswordModal from '../components/ChangePasswordModal';

const menuItems = [
  { path: '/sales/chat', icon: MessageSquare, label: '南孚智囊小助手' },
  { path: '/sales/learning', icon: GraduationCap, label: '销冠秘籍闯关' },
  { path: '/sales/exam', icon: FileText, label: '销冠答题挑战赛' },
  { path: '/sales/training', icon: Users, label: '模拟门店实战对练' },
  { path: '/sales/statistics', icon: BarChart3, label: '我的销冠成长榜' },
  { path: '/sales/profile', icon: User, label: '我的画像' },
];

/* ========== 每日一题弹窗 ========== */
function DailyQuestionModal({ onClose }) {
  const [question, setQuestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);

  useEffect(() => {
    loadDailyQuestion();
  }, []);

  const loadDailyQuestion = async () => {
    try {
      setLoading(true);
      const res = await api.get('/questions/daily');
      const data = res.data || res;
      if (data.answered) {
        setAlreadyAnswered(true);
      } else if (data.question) {
        setQuestion(data.question);
      }
    } catch (err) {
      console.error('加载每日一题失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedAnswer || !question) return;
    try {
      const res = await api.post('/questions/daily/answer', {
        question_id: question.id,
        answer: selectedAnswer,
      });
      const data = res.data || res;
      setResult(data);
      setSubmitted(true);
    } catch (err) {
      console.error('提交答案失败:', err);
    }
  };

  const typeLabel = question?.type === 'single' ? '单选题' : question?.type === 'multiple' ? '多选题' : question?.type === 'judge' ? '判断题' : '题目';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-warm-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl sm:rounded-3xl shadow-soft-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden animate-slide-up">
        {/* 头部 */}
        <div className="bg-gradient-to-r from-primary-500 to-sky-500 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center">
                <Zap size={22} />
              </div>
              <div>
                <h3 className="font-bold text-lg">每日一题</h3>
                <p className="text-white/70 text-xs">答对 +10 积分，答错 +2 积分</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 内容（可滚动） */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : alreadyAnswered ? (
            <div className="text-center py-8">
              <CheckCircle size={48} className="mx-auto mb-3 text-emerald-400" />
              <p className="text-warm-700 font-medium">今日题目已答过</p>
              <p className="text-warm-400 text-sm mt-1">明天再来挑战吧！</p>
            </div>
          ) : !question ? (
            <div className="text-center py-8">
              <p className="text-warm-400">暂无可用题目</p>
            </div>
          ) : submitted && result ? (
            /* 答题结果 */
            <div className="space-y-4">
              <div className={`flex items-center gap-3 p-4 rounded-2xl ${result.isCorrect ? 'bg-emerald-50 border border-emerald-100' : 'bg-rose-50 border border-rose-100'}`}>
                {result.isCorrect ? (
                  <CheckCircle size={28} className="text-emerald-500 shrink-0" />
                ) : (
                  <XCircle size={28} className="text-rose-500 shrink-0" />
                )}
                <div>
                  <p className={`font-bold ${result.isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.isCorrect ? '回答正确！' : '回答错误'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Award size={14} className="text-amber-500" />
                    <span className="text-sm text-amber-600 font-medium">+{result.earnedPoints} 积分</span>
                  </div>
                </div>
              </div>

              {!result.isCorrect && (
                <div className="p-3 bg-warm-50 rounded-xl text-sm">
                  <p className="text-warm-500 mb-1">正确答案：</p>
                  <p className="text-warm-800 font-medium">
                    {Array.isArray(result.correctAnswer) ? result.correctAnswer.join('、') : result.correctAnswer}
                  </p>
                </div>
              )}

              {result.analysis && (
                <div className="p-3 bg-sky-50 rounded-xl text-sm border border-sky-100">
                  <p className="text-sky-700 font-medium mb-1">解析：</p>
                  <p className="text-warm-700">{result.analysis}</p>
                </div>
              )}

              <button onClick={onClose} className="btn-primary w-full py-3">
                知道了
              </button>
            </div>
          ) : (
            /* 答题界面 */
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2.5 py-0.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-medium">
                  {typeLabel}
                </span>
                {question.category && (
                  <span className="px-2.5 py-0.5 bg-warm-100 text-warm-600 rounded-lg text-xs">
                    {question.category}
                  </span>
                )}
              </div>

              <p className="text-warm-900 font-medium leading-relaxed">{question.content}</p>

              {/* 选项 */}
              <div className="space-y-2">
                {Array.isArray(question.options) && question.options.map((opt, idx) => {
                  const letter = String.fromCharCode(65 + idx); // A, B, C, D
                  const isSelected = selectedAnswer === letter || (Array.isArray(selectedAnswer) && selectedAnswer.includes(letter));
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        if (question.type === 'multiple') {
                          setSelectedAnswer(prev => {
                            const arr = Array.isArray(prev) ? prev : [];
                            return arr.includes(letter)
                              ? arr.filter(a => a !== letter)
                              : [...arr, letter];
                          });
                        } else {
                          setSelectedAnswer(letter);
                        }
                      }}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all duration-200 ${
                        isSelected
                          ? 'border-primary-300 bg-primary-50 text-primary-700 shadow-inner-soft'
                          : 'border-warm-100 hover:border-primary-200 hover:bg-warm-50/50 text-warm-700'
                      }`}
                    >
                      <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                        isSelected
                          ? 'bg-primary-500 text-white'
                          : 'bg-warm-100 text-warm-500'
                      }`}>
                        {letter}
                      </span>
                      <span className="text-sm">{typeof opt === 'string' ? opt : opt.text || opt.content || JSON.stringify(opt)}</span>
                    </button>
                  );
                })}
              </div>

              {/* 判断题选项 */}
              {question.type === 'judge' && !Array.isArray(question.options) && (
                <div className="flex gap-3">
                  {[{ label: '正确', value: 'true' }, { label: '错误', value: 'false' }].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSelectedAnswer(opt.value)}
                      className={`flex-1 p-3.5 rounded-2xl border text-center font-medium transition-all duration-200 ${
                        selectedAnswer === opt.value
                          ? 'border-primary-300 bg-primary-50 text-primary-700 shadow-inner-soft'
                          : 'border-warm-100 hover:border-primary-200 hover:bg-warm-50/50 text-warm-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={!selectedAnswer}
                className="btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                提交答案
              </button>
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
  const location = useLocation();
  const [showDailyQuestion, setShowDailyQuestion] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const handleLogout = () => { logout(); navigate('/login'); };

  // 登录后弹出每日一题
  useEffect(() => {
    const shown = sessionStorage.getItem('daily_question_shown');
    if (!shown) {
      const timer = setTimeout(() => {
        setShowDailyQuestion(true);
        sessionStorage.setItem('daily_question_shown', '1');
      }, 1000);
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
          <div className="font-bold text-sm text-warm-800 truncate">南孚 DSR</div>
          <div className="text-[11px] text-warm-400 truncate">智能培训助手</div>
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
          </NavLink>
        ))}

        {/* 每日一题快捷入口 */}
        <button
          onClick={() => setShowDailyQuestion(true)}
          className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-200 w-full text-warm-600 hover:bg-amber-50 hover:text-amber-700"
        >
          <Zap size={18} className="shrink-0 text-amber-500" />
          <span className="truncate">每日一题</span>
          <span className="ml-auto px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded text-[10px] font-bold">+10</span>
        </button>
      </nav>

      {/* 底部用户区 */}
      <div className="border-t border-warm-100/60 p-3 shrink-0">
        <div className="flex items-center gap-3 mb-3 px-2">
          <div className="w-9 h-9 bg-gradient-to-br from-sky-200 to-primary-300 rounded-full flex items-center justify-center text-primary-700 text-sm font-bold shrink-0 shadow-soft">
            {user?.real_name?.[0] || 'S'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-warm-800 truncate">{user?.real_name}</div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-warm-400">业务员</span>
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

  // 移动端底部导航（核心功能）
  const mobileNavItems = [
    { path: '/sales/chat', icon: MessageSquare, label: '智囊' },
    { path: '/sales/learning', icon: GraduationCap, label: '闯关' },
    { path: '/sales/exam', icon: FileText, label: '答题' },
    { path: '/sales/training', icon: Users, label: '陪练' },
    { path: '/sales/statistics', icon: BarChart3, label: '成长' },
    { path: '/sales/profile', icon: User, label: '我的' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-warm-50">
      {/* ========== 移动端顶部栏 ========== */}
      <div className="md:hidden shrink-0 z-30 bg-white/80 backdrop-blur-xl border-b border-warm-100/60 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-sky-400 to-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0">
            南
          </div>
          <span className="text-sm font-bold text-warm-800">南孚 DSR</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDailyQuestion(true)}
            className="p-1.5 rounded-xl bg-amber-50 text-amber-500 transition-all"
          >
            <Zap size={18} />
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
          {/* 背景装饰 — 仅桌面端 */}
          <div className="hidden md:block absolute top-8 right-[20%] w-36 h-14 bg-white/40 rounded-full blur-xl pointer-events-none animate-float-slow" />
          <div className="hidden md:block absolute top-24 right-[45%] w-20 h-8 bg-white/30 rounded-full blur-lg pointer-events-none animate-float-delay" />
          <div className="hidden md:block absolute bottom-16 left-[8%] w-24 h-10 bg-white/25 rounded-full blur-xl pointer-events-none animate-float" />
          <div className="hidden md:block absolute top-36 left-[25%] w-16 h-6 bg-white/20 rounded-full blur-lg pointer-events-none animate-float-delay" />

          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto md:overflow-hidden p-2 md:p-6 relative z-10">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ========== 移动端底部导航 ========== */}
      <nav className="md:hidden shrink-0 z-40 bg-white/90 backdrop-blur-xl border-t border-warm-100/60 flex items-center justify-around py-1.5 safe-area-bottom">
        {mobileNavItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path === '/sales/chat' && location.pathname === '/sales');
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-0 transition-all duration-200 ${
                isActive
                  ? 'text-primary-600'
                  : 'text-warm-400'
              }`}
            >
              <item.icon size={20} className="shrink-0" strokeWidth={isActive ? 2.5 : 1.5} />
              <span className={`text-[10px] font-medium ${isActive ? 'text-primary-600' : ''}`}>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* 每日一题弹窗 */}
      {showDailyQuestion && (
        <DailyQuestionModal onClose={() => setShowDailyQuestion(false)} />
      )}
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
