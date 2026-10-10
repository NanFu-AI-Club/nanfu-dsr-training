import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Clock, Play, CheckCircle, XCircle, ChevronLeft, ChevronRight,
  AlertTriangle, Send, RotateCcw, Loader2, FileText, Award,
  Timer, HelpCircle, BookOpen,
} from 'lucide-react';
import api from '../../api';
import { formatShanghai, parseDate } from '../../utils/time';

// 视图模式
const VIEWS = { PENDING: 'pending', EXAM: 'exam', RECORDS: 'records', WRONGS: 'wrongs' };

// 题型中文名
const TYPE_LABELS = { single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题', short: '简答题' };
const typeLabelOf = (t) => TYPE_LABELS[t] || t;

// 格式化秒数为 MM:SS
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return '';
  return formatShanghai(dateStr, {
    year: undefined,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 格式化用时
function formatDuration(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

export default function Exam() {
  // ---- 共享状态 ----
  const [view, setView] = useState(VIEWS.PENDING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ---- 待考列表 ----
  const [pendingExams, setPendingExams] = useState([]);

  // ---- 考试记录 ----
  const [examRecords, setExamRecords] = useState([]);
  const [expandedRecord, setExpandedRecord] = useState(null); // 展开查看详情的记录ID
  const [recordsLoading, setRecordsLoading] = useState(false);

  // ---- 考试进行中 ----
  const [currentExam, setCurrentExam] = useState(null);       // 考试元信息
  const [questions, setQuestions] = useState([]);              // 题目列表
  const [answers, setAnswers] = useState({});                  // { questionId: answerValue }
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);                 // 剩余秒数
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);           // 已提交（显示结果）
  const [examResult, setExamResult] = useState(null);           // 提交后的结果
  const [autoSubmitted, setAutoSubmitted] = useState(false);   // 是否自动提交

  const timerRef = useRef(null);
  const hasPromptedRef = useRef(false);                        // 是否已提示过

  // ==================== 加载待考列表 ====================
  const loadPendingExams = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/exams/pending');
      setPendingExams(res.data?.list || res.data || []);
    } catch (err) {
      console.error('加载待考列表失败:', err);
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // ==================== 加载考试记录 ====================
  const loadExamRecords = useCallback(async () => {
    try {
      setRecordsLoading(true);
      const res = await api.get('/exams/my-all-records');
      // api拦截器已解包，res = { code: 0, data: { records: [...] } }
      const records = res?.data?.records || [];
      console.log('考试记录:', records, '原始响应:', res);
      setExamRecords(records);
    } catch (err) {
      console.error('加载考试记录失败:', err);
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  // 切换到记录视图时加载所有考试记录
  useEffect(() => {
    if (view === VIEWS.RECORDS) {
      loadExamRecords();
    }
  }, [view, loadExamRecords]);

  // ==================== 错题本 ====================
  const [wrongList, setWrongList] = useState([]);
  const [wrongLoading, setWrongLoading] = useState(false);

  const loadWrongQuestions = useCallback(async () => {
    setWrongLoading(true);
    try {
      const res = await api.get('/exams/my-wrong-questions');
      const data = res?.data || res;
      setWrongList(data?.list || []);
    } catch (err) {
      console.error('加载错题本失败:', err);
    } finally {
      setWrongLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === VIEWS.WRONGS) loadWrongQuestions();
  }, [view, loadWrongQuestions]);

  const removeWrongQuestion = async (questionId) => {
    try {
      await api.delete(`/exams/my-wrong-questions/${questionId}`);
      setWrongList((prev) => prev.filter((item) => item.question_id !== questionId));
    } catch (err) {
      alert(err?.message || '移除失败');
    }
  };

  // ==================== 开始考试 ====================
  const startExam = async (exam) => {
    try {
      setLoading(true);
      setError('');
      const startRes = await api.post(`/exams/${exam.id}/start`);
      const startData = startRes.data || startRes;

      // 通过 paper 接口获取试卷题目
      const paperRes = await api.get(`/exams/paper/${exam.id}`);
      const paperData = paperRes.data || paperRes;
      const qList = paperData.questions || [];

      // 初始化答案
      const initialAnswers = {};
      qList.forEach((q) => {
        if (q.type === 'multiple') {
          initialAnswers[q.id] = []; // 多选用数组
        } else {
          initialAnswers[q.id] = null;
        }
      });

      setCurrentExam({ ...(paperData.exam || exam), record_id: startData.record_id });
      setQuestions(qList);
      setAnswers(initialAnswers);
      setCurrentIndex(0);
      setTimeLeft((startData.duration || paperData.exam?.duration || exam.duration) * 60);
      setView(VIEWS.EXAM);
      setSubmitted(false);
      setExamResult(null);
      setAutoSubmitted(false);
      hasPromptedRef.current = false;
    } catch (err) {
      console.error('开始考试失败:', err);
      setError(err?.message || '开始考试失败');
    } finally {
      setLoading(false);
    }
  };

  // ==================== 倒计时 ====================
  useEffect(() => {
    if (view !== VIEWS.EXAM || submitted) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // 时间到了，自动提交
          clearInterval(timerRef.current);
          handleSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, submitted]);

  // 全部答完自动提醒
  useEffect(() => {
    if (view !== VIEWS.EXAM || submitted || hasPromptedRef.current) return;
    if (questions.length === 0) return;

    const allAnswered = questions.every((q) => {
      const ans = answers[q.id];
      if (q.type === 'multiple') return Array.isArray(ans) && ans.length > 0;
      return ans !== null && ans !== undefined && ans !== '';
    });

    if (allAnswered) {
      hasPromptedRef.current = true;
      // 延迟一点点提示，避免刚进入就弹
      const timer = setTimeout(() => {
        setShowSubmitConfirm(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [answers, questions, view, submitted]);

  // ==================== 答案处理 ====================
  const setAnswer = (questionId, value) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const toggleMultiAnswer = (questionId, optionValue) => {
    setAnswers((prev) => {
      const current = prev[questionId] || [];
      if (current.includes(optionValue)) {
        return { ...prev, [questionId]: current.filter((v) => v !== optionValue) };
      }
      return { ...prev, [questionId]: [...current, optionValue] };
    });
  };

  // ==================== 提交 ====================
  const handleSubmit = async (isAuto = false) => {
    if (submitting || submitted) return;
    setShowSubmitConfirm(false);

    try {
      setSubmitting(true);
      const payload = {
        record_id: currentExam.record_id,
        answers: Object.entries(answers).map(([qId, val]) => ({
          question_id: qId,
          answer: val,
        })),
      };
      const res = await api.post(`/exams/${currentExam.id}/submit`, payload);
      const result = res.data || res;
      setExamResult(result);
      setSubmitted(true);
      if (isAuto) setAutoSubmitted(true);
      // 清除倒计时
      clearInterval(timerRef.current);
    } catch (err) {
      console.error('提交失败:', err);
      setError(err?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // ==================== 获取题目作答状态 ====================
  const getQuestionStatus = (q) => {
    const ans = answers[q.id];
    if (q.type === 'multiple') return Array.isArray(ans) && ans.length > 0 ? 'answered' : 'unanswered';
    return ans !== null && ans !== undefined && ans !== '' ? 'answered' : 'unanswered';
  };

  const answeredCount = useMemo(() => questions.filter((q) => getQuestionStatus(q) === 'answered').length, [questions, answers]);
  const unansweredCount = questions.length - answeredCount;

  // ==================== 导航 ====================
  const goToPrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };
  const goToNext = () => {
    if (currentIndex < questions.length - 1) setCurrentIndex((i) => i + 1);
  };
  const goToQuestion = (idx) => {
    setCurrentIndex(idx);
  };

  const currentQuestion = questions[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;

  // ==================== 重考 ====================
  const handleRetake = async (exam) => {
    await startExam(exam);
  };

  // 初始加载
  useEffect(() => {
    loadPendingExams();
  }, [loadPendingExams]);

  // ==================== 渲染：错题本 ====================
  const renderWrongs = () => (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="page-title">我的错题本</h2>
          <p className="text-sm text-warm-400 mt-1">共 {wrongList.length} 道错题 · 重考答对后会自动移出</p>
        </div>
        <button onClick={() => setView(VIEWS.PENDING)} className="btn-secondary flex items-center gap-2 text-sm">
          <ChevronLeft size={16} />
          返回
        </button>
      </div>

      {wrongLoading ? (
        <div className="card py-16 text-center text-warm-400">
          <Loader2 size={22} className="mx-auto mb-2 animate-spin text-primary-500" />
          正在加载错题...
        </div>
      ) : wrongList.length === 0 ? (
        <div className="card py-16 text-center text-warm-400">
          <CheckCircle size={36} className="mx-auto mb-3 text-emerald-400" />
          <p>太棒了，暂无错题</p>
        </div>
      ) : (
        <div className="space-y-4">
          {wrongList.map((item, idx) => {
            const answerArr = Array.isArray(item.answer) ? item.answer.map(String) : [String(item.answer)];
            return (
              <div key={item.wrong_id} className="card">
                <div className="flex items-start gap-2 mb-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-rose-50 text-rose-600 text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                  <div>
                    <span className="badge badge-blue text-xs mr-2">{typeLabelOf(item.type)}</span>
                    <span className="text-sm text-warm-900 leading-relaxed">{item.content}</span>
                  </div>
                </div>

                <div className="space-y-1.5 mb-3">
                  {(item.options || []).map((opt, oi) => {
                    const value = typeof opt === 'object' ? opt.value : String.fromCharCode(65 + oi);
                    const label = typeof opt === 'object' ? opt.label : opt;
                    const isAnswer = answerArr.includes(String(value));
                    return (
                      <div
                        key={oi}
                        className={`text-sm px-3 py-2 rounded-lg ${isAnswer ? 'bg-emerald-50 text-emerald-700 font-medium' : 'bg-warm-50 text-warm-600'}`}
                      >
                        {value}. {label}{isAnswer && <span className="ml-1 text-xs">✓ 正确答案</span>}
                      </div>
                    );
                  })}
                </div>

                {item.analysis && (
                  <div className="text-xs text-warm-600 bg-sky-50/60 rounded-lg px-3 py-2 leading-relaxed">
                    <span className="font-medium text-sky-700">解析：</span>{item.analysis}
                  </div>
                )}

                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-warm-400">答错 {item.wrong_count} 次 · 最近 {(item.last_wrong_at || '').slice(0, 10)}</span>
                  <button onClick={() => removeWrongQuestion(item.question_id)} className="text-xs text-warm-400 hover:text-rose-500 transition">移出错题本</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ==================== 渲染：待考列表 ====================
  const renderPendingList = () => (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="page-title">销冠答题挑战赛</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setView(VIEWS.WRONGS); }}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <XCircle size={16} />
            错题本
          </button>
          <button
            onClick={() => { setView(VIEWS.RECORDS); }}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <BookOpen size={16} />
            考试记录
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl mb-4">
          <AlertTriangle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary-600" />
        </div>
      ) : pendingExams.length === 0 ? (
        <div className="text-center py-16">
          <FileText size={48} className="mx-auto mb-3 text-warm-300" />
          <p className="text-warm-400">暂无待考考试</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {pendingExams.map((exam) => {
            const isOngoing =
              exam.start_time && exam.end_time &&
              new Date() >= new Date(exam.start_time) &&
              new Date() <= new Date(exam.end_time);

            return (
              <div key={exam.id} className="card flex flex-col">
                {/* 标题 */}
                <h3 className="font-semibold text-warm-900 mb-2 line-clamp-2">
                  {exam.title}
                </h3>

                {/* 信息 */}
                <div className="space-y-2 mb-4 text-sm text-warm-500 flex-1">
                  <div className="flex items-center gap-2">
                    <Clock size={14} />
                    <span>时长: {exam.duration} 分钟</span>
                  </div>
                  {exam.start_time && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs">开始: {formatDate(exam.start_time)}</span>
                    </div>
                  )}
                  {exam.end_time && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs">截止: {formatDate(exam.end_time)}</span>
                    </div>
                  )}
                  {exam.question_count && (
                    <div className="flex items-center gap-2">
                      <HelpCircle size={14} />
                      <span>共 {exam.question_count} 题</span>
                    </div>
                  )}
                  {exam.max_attempts && (
                    <div className="flex items-center gap-2">
                      <RotateCcw size={14} />
                      <span>
                        考试机会: {exam.remaining_attempts != null ? `${exam.remaining_attempts}/${exam.max_attempts}` : `${exam.max_attempts}/${exam.max_attempts}`}
                      </span>
                    </div>
                  )}
                </div>

                {/* 状态和操作 */}
                <div className="flex items-center justify-between pt-3 border-t">
                  <span className={`badge text-xs ${
                    isOngoing ? 'badge-green' :
                    exam.end_time && new Date() > new Date(exam.end_time) ? 'badge-red' :
                    'badge-yellow'
                  }`}>
                    {isOngoing ? '进行中' :
                     exam.end_time && new Date() > new Date(exam.end_time) ? '已截止' :
                     '待开始'}
                  </span>

                  <button
                    onClick={() => startExam(exam)}
                    disabled={loading || (exam.end_time && new Date() > new Date(exam.end_time))}
                    className="btn-primary flex items-center gap-2 text-sm"
                  >
                    <Play size={16} />
                    开始考试
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ==================== 渲染：考试进行中 ====================
  const renderExam = () => (
    <div className="flex flex-col flex-1 min-h-0 -m-2 md:-m-6">
      {/* ===== 顶部信息栏 ===== */}
      <div className="bg-white border-b px-3 md:px-6 py-2.5 md:py-3 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 md:gap-6 min-w-0">
          <h2 className="font-bold text-warm-900 truncate text-sm md:text-base max-w-[120px] md:max-w-xs">
            {currentExam?.title}
          </h2>
          {/* 进度 */}
          <span className="text-xs md:text-sm text-warm-500 shrink-0">
            {answeredCount}/{questions.length}题
          </span>
        </div>

        {/* 倒计时 */}
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <div className={`flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 rounded-xl text-xs md:text-sm font-mono font-bold ${
            timeLeft <= 60
              ? 'bg-rose-50 text-rose-600 animate-pulse'
              : timeLeft <= 300
              ? 'bg-yellow-50 text-yellow-700'
              : 'bg-warm-100 text-warm-700'
          }`}>
            <Timer size={14} />
            {formatTime(timeLeft)}
          </div>

          <button
            onClick={() => setShowSubmitConfirm(true)}
            disabled={submitting}
            className="btn-primary flex items-center gap-1 md:gap-2 text-xs md:text-sm px-3 py-1.5"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            交卷
          </button>
        </div>
      </div>

      {/* ===== 考试主体 ===== */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* 左侧：题目导航 — 桌面端侧边栏，手机端横向滚动条 */}
        <aside className="hidden md:block w-64 bg-white border-r p-4 overflow-y-auto shrink-0">
          <p className="text-xs font-medium text-warm-500 mb-3 uppercase tracking-wide">
            题目导航
          </p>
          <div className="grid grid-cols-5 gap-2">
            {questions.map((q, idx) => {
              const status = getQuestionStatus(q);
              const isCurrent = idx === currentIndex;
              return (
                <button
                  key={q.id}
                  onClick={() => goToQuestion(idx)}
                  className={`w-10 h-10 rounded-xl text-sm font-medium transition flex items-center justify-center ${
                    isCurrent
                      ? 'bg-primary-600 text-white ring-2 ring-primary-300'
                      : status === 'answered'
                      ? 'bg-sky-100 text-sky-700 hover:bg-blue-200'
                      : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {/* 图例 */}
          <div className="mt-6 space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-sky-100" />
              <span className="text-warm-500">已作答</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-warm-100" />
              <span className="text-warm-500">未作答</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-primary-600 ring-2 ring-primary-300" />
              <span className="text-warm-500">当前题目</span>
            </div>
          </div>
        </aside>

        {/* 手机端题目导航：横向滚动 */}
        <div className="md:hidden bg-white border-b px-3 py-2 shrink-0 overflow-x-auto">
          <div className="flex gap-1.5">
            {questions.map((q, idx) => {
              const status = getQuestionStatus(q);
              const isCurrent = idx === currentIndex;
              return (
                <button
                  key={q.id}
                  onClick={() => goToQuestion(idx)}
                  className={`w-7 h-7 rounded-lg text-xs font-medium transition flex items-center justify-center shrink-0 ${
                    isCurrent
                      ? 'bg-primary-600 text-white'
                      : status === 'answered'
                      ? 'bg-sky-100 text-sky-700'
                      : 'bg-warm-100 text-warm-500'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧：题目详情 */}
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          {currentQuestion ? (
            <div className="max-w-3xl">
              {/* 题目标题 */}
              <div className="mb-4 md:mb-6">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 md:px-2.5 md:py-1 rounded-full text-xs font-medium mb-2 md:mb-3 bg-primary-50 text-primary-700">
                  {currentQuestion.type === 'single' && '单选题'}
                  {currentQuestion.type === 'multiple' && '多选题'}
                  {currentQuestion.type === 'judge' && '判断题'}
                  {currentQuestion.type === 'fill' && '填空题'}
                  {currentQuestion.type === 'short' && '简答题'}
                </span>
                <h3 className="text-lg font-medium text-warm-900 leading-relaxed">
                  <span className="text-primary-600 font-bold mr-2">
                    {currentIndex + 1}.
                  </span>
                  {currentQuestion.title || currentQuestion.content}
                </h3>
              </div>

              {/* 选项区域 */}
              <div className="space-y-3 mb-8">
                {/* 单选题 */}
                {currentQuestion.type === 'single' &&
                  (currentQuestion.options || []).map((opt, idx) => {
                    const optValue = opt.value ?? opt.id ?? idx;
                    const optLabel = opt.label || opt.text || `选项 ${idx + 1}`;
                    const isSelected = answers[currentQuestion.id] === optValue;

                    return (
                      <label
                        key={idx}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                          isSelected
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-warm-100/60 hover:border-warm-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`q-${currentQuestion.id}`}
                          checked={isSelected}
                          onChange={() => setAnswer(currentQuestion.id, optValue)}
                          className="w-4 h-4 text-primary-600"
                        />
                        <span className="text-sm font-medium text-warm-700">
                          {String.fromCharCode(65 + idx)}. {optLabel}
                        </span>
                      </label>
                    );
                  })}

                {/* 多选题 */}
                {currentQuestion.type === 'multiple' &&
                  (currentQuestion.options || []).map((opt, idx) => {
                    const optValue = opt.value ?? opt.id ?? idx;
                    const optLabel = opt.label || opt.text || `选项 ${idx + 1}`;
                    const currentAnswers = answers[currentQuestion.id] || [];
                    const isSelected = currentAnswers.includes(optValue);

                    return (
                      <label
                        key={idx}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                          isSelected
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-warm-100/60 hover:border-warm-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleMultiAnswer(currentQuestion.id, optValue)}
                          className="w-4 h-4 text-primary-600 rounded"
                        />
                        <span className="text-sm font-medium text-warm-700">
                          {String.fromCharCode(65 + idx)}. {optLabel}
                        </span>
                      </label>
                    );
                  })}

                {/* 判断题 */}
                {currentQuestion.type === 'judge' && (
                  <div className="flex gap-4">
                    <button
                      onClick={() => setAnswer(currentQuestion.id, true)}
                      className={`flex-1 flex items-center justify-center gap-2 p-6 rounded-xl border-2 transition text-lg font-medium ${
                        answers[currentQuestion.id] === true
                          ? 'border-green-500 bg-emerald-50 text-emerald-700'
                          : 'border-warm-100/60 hover:border-green-300 text-warm-600'
                      }`}
                    >
                      <CheckCircle
                        size={24}
                        className={
                          answers[currentQuestion.id] === true
                            ? 'text-green-500'
                            : 'text-warm-300'
                        }
                      />
                      正确
                    </button>
                    <button
                      onClick={() => setAnswer(currentQuestion.id, false)}
                      className={`flex-1 flex items-center justify-center gap-2 p-6 rounded-xl border-2 transition text-lg font-medium ${
                        answers[currentQuestion.id] === false
                          ? 'border-red-500 bg-rose-50 text-red-700'
                          : 'border-warm-100/60 hover:border-red-300 text-warm-600'
                      }`}
                    >
                      <XCircle
                        size={24}
                        className={
                          answers[currentQuestion.id] === false
                            ? 'text-rose-500'
                            : 'text-warm-300'
                        }
                      />
                      错误
                    </button>
                  </div>
                )}

                {/* 填空题 */}
                {currentQuestion.type === 'fill' && (
                  <div>
                    <input
                      type="text"
                      className="input text-base"
                      placeholder="请输入答案"
                      value={answers[currentQuestion.id] ?? ''}
                      onChange={(e) => setAnswer(currentQuestion.id, e.target.value)}
                    />
                    <p className="text-xs text-warm-400 mt-2">答案不区分大小写，忽略空格与标点</p>
                  </div>
                )}

                {/* 简答题 */}
                {currentQuestion.type === 'short' && (
                  <div>
                    <textarea
                      className="input min-h-[160px] resize-y text-base leading-relaxed"
                      placeholder="请作答，交卷后由管理员批阅"
                      value={answers[currentQuestion.id] ?? ''}
                      onChange={(e) => setAnswer(currentQuestion.id, e.target.value)}
                    />
                    <p className="text-xs text-warm-400 mt-2">
                      简答题为主观题，交卷后需管理员人工批阅，不计入即时成绩
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-warm-400">
              <HelpCircle size={48} className="mx-auto mb-3 opacity-50" />
              <p>暂无题目</p>
            </div>
          )}
        </main>
      </div>

      {/* ===== 底部导航按钮 ===== */}
      <div className="bg-white border-t px-6 py-3 flex items-center justify-between shrink-0">
        <button
          onClick={goToPrev}
          disabled={isFirst}
          className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-40"
        >
          <ChevronLeft size={16} />
          上一题
        </button>

        <span className="text-sm text-warm-400">
          {currentIndex + 1} / {questions.length}
        </span>

        <button
          onClick={goToNext}
          disabled={isLast}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
        >
          下一题
          <ChevronRight size={16} />
        </button>
      </div>

      {/* ===== 提交确认弹窗 ===== */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-4 md:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <div>
                <h3 className="font-semibold text-warm-900 mb-1">确认交卷</h3>
                <p className="text-sm text-warm-500">
                  提交后将无法修改答案，请确认是否交卷。
                </p>
              </div>
            </div>

            <div className="bg-warm-50/80 rounded-xl p-4 mb-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-warm-500">已作答</span>
                <span className="text-sky-600 font-semibold">{answeredCount} 题</span>
              </div>
              <div className="flex justify-between">
                <span className="text-warm-500">未作答</span>
                <span className={`font-semibold ${unansweredCount > 0 ? 'text-rose-500' : 'text-green-500'}`}>
                  {unansweredCount} 题
                </span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-warm-500">总计</span>
                <span className="text-warm-900 font-semibold">{questions.length} 题</span>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSubmitConfirm(false)}
                className="btn-secondary text-sm"
              >
                继续作答
              </button>
              <button
                onClick={() => handleSubmit(false)}
                disabled={submitting}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {submitting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                确认交卷
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ==================== 渲染：考试结果（提交后） ====================
  const renderResult = () => (
    <div className="flex flex-col flex-1 min-h-0 -m-2 md:-m-6">
      <div className="bg-white border-b px-3 md:px-6 py-2.5 md:py-3 flex items-center justify-between shrink-0">
        <h2 className="font-bold text-warm-900">考试结果</h2>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          {/* 自动提交提示 */}
          {autoSubmitted && (
            <div className="flex items-center justify-center gap-2 mb-6 px-4 py-2 bg-yellow-50 text-yellow-700 rounded-xl text-sm">
              <AlertTriangle size={16} />
              考试时间已到，系统已自动交卷
            </div>
          )}

          {/* 成绩卡片 */}
          <div className="card mb-6">
            <Award size={48} className={`mx-auto mb-4 ${
              examResult?.pending_manual ? 'text-amber-500'
                : examResult?.passed !== false ? 'text-green-500' : 'text-red-400'
            }`} />

            <div className="text-4xl font-bold mb-2">
              <span className={examResult?.pending_manual ? 'text-amber-600'
                : examResult?.passed !== false ? 'text-emerald-600' : 'text-rose-500'}>
                {examResult?.score ?? '--'}
              </span>
              <span className="text-warm-300 text-xl"> / {examResult?.total_score ?? '--'}</span>
            </div>

            <span className={`badge text-sm ${
              examResult?.pending_manual ? 'badge-yellow'
                : examResult?.passed !== false ? 'badge-green' : 'badge-red'
            }`}>
              {examResult?.pending_manual ? '待人工批阅' : examResult?.passed !== false ? '已通过' : '未通过'}
            </span>

            {examResult?.pending_manual && (
              <p className="text-sm text-amber-600 mt-3 leading-relaxed">
                本卷含简答题，需管理员批阅后才能确定最终成绩
              </p>
            )}

            {examResult?.duration != null && (
              <p className="text-sm text-warm-400 mt-3">
                用时: {formatDuration(examResult.duration)}
              </p>
            )}

            {examResult?.correct_count != null && examResult?.total_count != null && (
              <p className="text-sm text-warm-500 mt-1">
                正确: {examResult.correct_count} / {examResult.total_count} 题
              </p>
            )}
          </div>

          <div className="flex justify-center gap-3">
            <button
              onClick={() => {
                setView(VIEWS.PENDING);
                loadPendingExams();
              }}
              className="btn-secondary flex items-center gap-2"
            >
              返回列表
            </button>
            {examResult?.can_retake && (
              <button
                onClick={() => handleRetake(currentExam)}
                className="btn-primary flex items-center gap-2"
              >
                <RotateCcw size={16} />
                重新考试
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ==================== 渲染：考试记录 ====================
  const renderRecords = () => (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="page-title">考试记录</h2>
        <button
          onClick={() => {
            setView(VIEWS.PENDING);
            loadPendingExams();
          }}
          className="btn-secondary text-sm"
        >
          返回待考列表
        </button>
      </div>

      {recordsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary-600" />
        </div>
      ) : examRecords.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen size={48} className="mx-auto mb-3 text-warm-300" />
          <p className="text-warm-400">暂无考试记录</p>
        </div>
      ) : (
        <div className="space-y-4">
          {examRecords.map((record) => (
            <div key={record.id}>
              <div
                className="card flex items-center justify-between cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setExpandedRecord(expandedRecord === record.id ? null : record.id)}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    record.pending_manual === 1 ? 'bg-amber-100'
                      : record.passed !== false ? 'bg-emerald-100' : 'bg-rose-100'
                  }`}>
                    {record.pending_manual === 1 ? (
                      <Clock size={22} className="text-amber-600" />
                    ) : record.passed !== false ? (
                      <CheckCircle size={22} className="text-emerald-600" />
                    ) : (
                      <XCircle size={22} className="text-rose-500" />
                    )}
                  </div>

                  <div>
                    <h4 className="font-semibold text-warm-900">
                      {record.exam_title || `考试记录 #${record.id}`}
                      {record.attempt != null && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md bg-primary-50 text-primary-700 text-xs font-medium">
                          第 {record.attempt} 次
                        </span>
                      )}
                    </h4>
                    <div className="flex items-center gap-4 mt-1 text-sm text-warm-500">
                      <span>分数: <strong className="text-warm-700">{record.score}</strong></span>
                      <span>状态: {' '}
                        <span className={
                          record.pending_manual === 1 ? 'text-amber-600'
                            : record.passed !== false ? 'text-emerald-600' : 'text-rose-500'
                        }>
                          {record.pending_manual === 1 ? '待批阅' : record.passed !== false ? '通过' : '未通过'}
                        </span>
                      </span>
                      {record.duration != null && (
                        <span>用时: {formatDuration(record.duration)}</span>
                      )}
                      {record.created_at && (
                        <span>{formatDate(record.created_at)}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {record.can_retake && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const exam = pendingExams.find((e) => e.id === record.exam_id) || {
                          id: record.exam_id,
                          title: record.exam_title,
                          duration: record.duration ? Math.ceil(record.duration / 60) : 30,
                        };
                        handleRetake(exam);
                      }}
                      className="btn-primary flex items-center gap-2 text-sm"
                    >
                      <RotateCcw size={16} />
                      重考
                    </button>
                  )}
                  <ChevronRight
                    size={20}
                    className={`text-warm-400 transition-transform ${expandedRecord === record.id ? 'rotate-90' : ''}`}
                  />
                </div>
              </div>

              {/* 展开的答题明细 */}
              {expandedRecord === record.id && record.answers && record.answers.length > 0 && (
                <div className="mt-2 card bg-warm-25 max-h-[60vh] overflow-y-auto">
                  <h5 className="font-semibold text-warm-800 mb-3">答题明细</h5>
                  <div className="space-y-3">
                    {record.answers.map((ans, idx) => (
                      <div
                        key={ans.question_id || idx}
                        className={`p-3 rounded-lg border ${
                          ans.is_correct === null ? 'bg-amber-50 border-amber-200'
                            : ans.is_correct ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-sm font-medium text-warm-500 mt-0.5 shrink-0">
                            {idx + 1}.
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-warm-800 mb-1">
                              {ans.content}
                              <span className="ml-2 text-xs text-warm-400">{typeLabelOf(ans.type)}</span>
                            </p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                              <span className="text-warm-500">
                                你的答案: <strong className={
                                  ans.is_correct === null ? 'text-amber-600'
                                    : ans.is_correct ? 'text-emerald-600' : 'text-rose-500'
                                }>
                                  {ans.user_answer != null ? String(ans.user_answer) : '未作答'}
                                </strong>
                              </span>
                              <span className="text-warm-500">
                                {ans.type === 'short' ? '参考答案' : '正确答案'}: <strong className="text-emerald-600">
                                  {Array.isArray(ans.correct_answer) ? ans.correct_answer.join(', ') : String(ans.correct_answer)}
                                </strong>
                              </span>
                              <span className="text-warm-500">
                                得分: <strong>
                                  {ans.is_correct === null ? '待批阅' : `${ans.score}/${ans.total_score}`}
                                </strong>
                              </span>
                            </div>
                            {ans.analysis && (
                              <p className="text-xs text-warm-400 mt-1">{ans.analysis}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ==================== 主渲染 ====================
  if (submitted && view === VIEWS.EXAM) {
    return renderResult();
  }

  switch (view) {
    case VIEWS.EXAM:
      return renderExam();
    case VIEWS.RECORDS:
      return renderRecords();
    case VIEWS.WRONGS:
      return renderWrongs();
    default:
      return renderPendingList();
  }
}
