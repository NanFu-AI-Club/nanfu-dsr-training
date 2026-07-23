import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, X, Loader2, AlertCircle, ChevronLeft,
  ChevronRight, Users, Play, StopCircle, RotateCcw, Clock,
  ThumbsUp, ThumbsDown, Star, TrendingUp, TrendingDown,
  FileText, BarChart3, History, BookOpen, Target, MessageCircle,
  Award, Zap, Check, HelpCircle, Shield, Heart, UserCheck,
} from 'lucide-react';
import api from '../../api';

/* ========== 维度配置 ========== */
const DIMENSION_CONFIG = [
  { key: 'communication', label: '沟通表达', icon: MessageCircle, color: 'bg-blue-500' },
  { key: 'product_knowledge', label: '产品知识', icon: BookOpen, color: 'bg-purple-500' },
  { key: 'objection_handling', label: '异议处理', icon: Shield, color: 'bg-orange-500' },
  { key: 'negotiation', label: '谈判技巧', icon: Target, color: 'bg-emerald-500' },
  { key: 'customer_relations', label: '客户关系', icon: Heart, color: 'bg-pink-500' },
  { key: 'professionalism', label: '职业素养', icon: UserCheck, color: 'bg-indigo-500' },
];

const DIFFICULTY_CONFIG = {
  easy: { label: '简单', bg: 'bg-emerald-100 text-emerald-700' },
  medium: { label: '中等', bg: 'bg-yellow-100 text-yellow-700' },
  hard: { label: '困难', bg: 'bg-rose-100 text-red-700' },
};

/* ========== 评分评级 ========== */
function getRating(score) {
  if (score >= 90) return { label: '优秀', color: 'text-emerald-600', bg: 'bg-emerald-50' };
  if (score >= 80) return { label: '良好', color: 'text-sky-600', bg: 'bg-sky-50' };
  if (score >= 60) return { label: '及格', color: 'text-yellow-600', bg: 'bg-yellow-50' };
  return { label: '待提升', color: 'text-rose-600', bg: 'bg-rose-50' };
}

export default function Training() {
  /* ---- 视图状态 ---- */
  const [view, setView] = useState('scenarios'); // scenarios | chatting | report | history
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [report, setReport] = useState(null);
  const [historySessions, setHistorySessions] = useState([]);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  /* ---- 自动滚动到底部 ---- */
  useEffect(() => {
    if (view === 'chatting') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, view]);

  /* ---- 加载情景列表 ---- */
  const loadScenarios = useCallback(async () => {
    try {
      setScenarioLoading(true);
      setError('');
      const res = await api.get('/training/scenarios');
      setScenarios(res.data?.list || res.data || []);
    } catch (err) {
      console.error('加载情景失败:', err);
      setError(err?.message || '加载情景失败');
    } finally {
      setScenarioLoading(false);
    }
  }, []);

  /* ---- 加载历史会话 ---- */
  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await api.get('/training/sessions');
      setHistorySessions(res.data?.list || res.data || []);
    } catch (err) {
      console.error('加载历史会话失败:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScenarios();
    loadHistory();
  }, [loadScenarios, loadHistory]);

  /* ---- 开始陪练 ---- */
  const handleStartTraining = async () => {
    if (!selectedScenario) return;
    try {
      setSending(true);
      setError('');
      const res = await api.post('/training/sessions', {
        scenario_id: selectedScenario.id,
      });
      const session = res.data || res;
      // 后端返回 {session_id, scenario}，统一映射为 {id, ...}
      const sessionId = session.session_id || session.id;
      setCurrentSession({ id: sessionId, ...session });

      // 加载后端已插入的消息（system + AI 开场白）
      try {
        const msgRes = await api.get(`/training/sessions/${sessionId}/messages`);
        const msgData = msgRes.data || msgRes;
        const msgList = msgData.messages || msgData.list || msgData || [];
        if (msgList.length > 0) {
          setMessages(msgList.map((m) => ({
            id: m.id,
            type: m.role === 'system' ? 'system' : m.role === 'user' ? 'user' : 'ai',
            role: m.role,
            content: m.content,
            timestamp: m.created_at,
          })));
        } else {
          setMessages([{
            id: 'system-0',
            type: 'system',
            role: 'system',
            content: `欢迎进入「${selectedScenario.title}」情景陪练`,
            timestamp: new Date().toISOString(),
          }]);
        }
      } catch {
        setMessages([{
          id: 'system-0',
          type: 'system',
          role: 'system',
          content: `欢迎进入「${selectedScenario.title}」情景陪练`,
          timestamp: new Date().toISOString(),
        }]);
      }
      setView('chatting');
    } catch (err) {
      setError(err?.message || '创建会话失败');
    } finally {
      setSending(false);
    }
  };

  /* ---- 发送消息 ---- */
  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || !currentSession) return;

    const userMsg = {
      id: `user-${Date.now()}`,
      type: 'user',
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputText('');

    try {
      setSending(true);
      const res = await api.post(`/training/sessions/${currentSession.id}/message`, {
        content: text,
      });
      const responseData = res.data || res;
      const aiMsg = responseData.ai_message || responseData;
      setMessages((prev) => [
        ...prev,
        {
          id: aiMsg.id || `ai-${Date.now()}`,
          type: 'ai',
          role: 'ai',
          content: aiMsg.content || aiMsg.message || '',
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.error('发送消息失败:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          type: 'system',
          role: 'system',
          content: '消息发送失败，请重试。',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  /* ---- 结束会话并获取报告 ---- */
  const handleEndSession = async () => {
    if (!currentSession) return;
    try {
      setSending(true);
      await api.post(`/training/sessions/${currentSession.id}/end`);
      const reportRes = await api.get(`/training/sessions/${currentSession.id}/report`);
      const reportData = reportRes.data || reportRes;
      setReport(reportData.report || reportData);
      setView('report');
      loadHistory();
    } catch (err) {
      console.error('结束会话失败:', err);
      setError(err?.message || '结束会话失败');
    } finally {
      setSending(false);
    }
  };

  /* ---- 查看历史报告 ---- */
  const handleViewHistoryReport = async (session) => {
    try {
      setSending(true);
      setError('');
      const reportRes = await api.get(`/training/sessions/${session.id}/report`);
      const reportData = reportRes.data || reportRes;
      setReport(reportData.report || reportData);
      setCurrentSession(session);
      const scenario = scenarios.find((s) => s.id === session.scenario_id);
      setSelectedScenario(scenario || null);
      setView('report');
    } catch (err) {
      setError(err?.message || '加载报告失败');
    } finally {
      setSending(false);
    }
  };

  /* ---- 回到情景选择 ---- */
  const handleBackToScenarios = () => {
    setView('scenarios');
    setCurrentSession(null);
    setMessages([]);
    setReport(null);
    setSelectedScenario(null);
    setError('');
  };

  /* ---- 键盘发送 ---- */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  /* ---- 对话轮数（不含系统消息） ---- */
  const dialogRounds = messages.filter((m) => m.type !== 'system').length;

  /* ================================================================
   *  渲染：情景选择视图
   * ================================================================ */
  const renderScenarioView = () => (
    <div className="space-y-6">
      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
          <button onClick={loadScenarios} className="ml-auto underline text-sm">重试</button>
        </div>
      )}

      {/* 情景卡片区域 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-warm-900">选择陪练情景</h3>
          <button
            onClick={() => setView('history')}
            className="flex items-center gap-1.5 text-sm text-warm-500 hover:text-primary-600 transition"
          >
            <History size={16} />
            历史记录
          </button>
        </div>

        {scenarioLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={32} className="animate-spin text-primary-600" />
          </div>
        ) : scenarios.length === 0 ? (
          <div className="text-center py-12 card">
            <Target size={48} className="mx-auto mb-3 text-warm-300" />
            <p className="text-warm-400">暂无可用的陪练情景</p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin" ref={scrollRef}>
            {scenarios.map((scenario) => {
              const isSelected = selectedScenario?.id === scenario.id;
              const diff = DIFFICULTY_CONFIG[scenario.difficulty] || DIFFICULTY_CONFIG.medium;
              return (
                <button
                  key={scenario.id}
                  onClick={() => setSelectedScenario(scenario)}
                  className={`card shrink-0 w-64 text-left cursor-pointer transition-all hover:shadow-soft-lg ${
                    isSelected
                      ? 'ring-2 ring-sky-400 border-primary-500 shadow-soft-lg'
                      : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                      <Users size={20} className="text-primary-600" />
                    </div>
                    <span className={`badge text-xs ${diff.bg}`}>{diff.label}</span>
                  </div>
                  <h4 className="font-semibold text-warm-900 mb-1">{scenario.title}</h4>
                  <p className="text-sm text-warm-500 line-clamp-2 mb-3">
                    {scenario.description || '暂无描述'}
                  </p>
                  {scenario.customer_role && (
                    <div className="flex items-center gap-1 text-xs text-warm-400">
                      <Users size={12} />
                      <span>{scenario.customer_role}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 开始按钮 */}
      <div className="flex justify-center">
        <button
          onClick={handleStartTraining}
          disabled={!selectedScenario || sending}
          className="btn-primary flex items-center gap-2 px-8 py-3 text-base"
        >
          {sending ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Play size={20} />
          )}
          开始陪练
        </button>
      </div>
    </div>
  );

  /* ================================================================
   *  渲染：聊天对话视图
   * ================================================================ */
  const renderChatView = () => {
    const customerRole = selectedScenario?.role_type || '客户';
    const scenarioTitle = selectedScenario?.title || '陪练';

    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border rounded-t-xl shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToScenarios}
              className="p-1.5 hover:bg-warm-100 rounded-xl transition"
            >
              <ChevronLeft size={20} className="text-warm-500" />
            </button>
            <div>
              <h3 className="font-semibold text-warm-900">{scenarioTitle}</h3>
              <p className="text-xs text-warm-400">
                {customerRole} · 对话 {Math.ceil(dialogRounds / 2)} 轮
              </p>
            </div>
          </div>
          <button
            onClick={handleEndSession}
            disabled={sending}
            className="btn-danger flex items-center gap-2 text-sm px-3 py-1.5"
          >
            <StopCircle size={16} />
            结束会话
          </button>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 bg-warm-50/80 space-y-3">
          {messages.map((msg) => {
            if (msg.type === 'system') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="bg-sky-50 text-sky-700 text-sm px-4 py-2 rounded-full max-w-lg text-center">
                    {msg.content}
                  </div>
                </div>
              );
            }
            if (msg.type === 'user') {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[75%] bg-primary-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 shadow-soft">
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              );
            }
            if (msg.type === 'ai') {
              return (
                <div key={msg.id} className="flex justify-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center shrink-0 mt-1">
                    <Users size={16} className="text-warm-600" />
                  </div>
                  <div className="max-w-[75%]">
                    <p className="text-xs text-warm-400 mb-1">{customerRole}</p>
                    <div className="bg-white border rounded-2xl rounded-tl-md px-4 py-2.5 shadow-soft">
                      <p className="text-sm whitespace-pre-wrap text-warm-800">{msg.content}</p>
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <div className="bg-white border-t px-4 py-3 shrink-0 rounded-b-xl">
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的回复..."
              rows={2}
              className="input flex-1 resize-none"
              disabled={sending}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputText.trim() || sending}
              className="btn-primary flex items-center gap-2 px-4 py-2 shrink-0"
            >
              {sending ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
              发送
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ================================================================
   *  渲染：评估报告视图
   * ================================================================ */
  const renderReportView = () => {
    if (!report) {
      return (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary-600" />
        </div>
      );
    }

    const rating = getRating(report.total_score);
    const dimensions = report.dimensions || [];
    const strengths = report.strengths || [];
    const weaknesses = report.weaknesses || [];

    return (
      <div className="space-y-6">
        {/* 返回按钮 */}
        <button
          onClick={handleBackToScenarios}
          className="flex items-center gap-1.5 text-sm text-warm-500 hover:text-primary-600 transition"
        >
          <ChevronLeft size={16} />
          返回情景列表
        </button>

        {/* 总分区域 */}
        <div className="card text-center">
          <div className={`inline-flex items-center justify-center w-28 h-28 rounded-full ${rating.bg} mb-4`}>
            <div>
              <span className={`text-4xl font-bold ${rating.color}`}>{report.total_score}</span>
              <span className={`text-sm ${rating.color}`}>分</span>
            </div>
          </div>
          <h2 className={`text-xl font-bold ${rating.color}`}>{rating.label}</h2>
          <p className="text-warm-500 text-sm mt-1">
            {selectedScenario?.title || '陪练'} · {selectedScenario?.role_type || '客户'}
          </p>
          {report.rounds && (
            <p className="text-warm-400 text-xs mt-1">共 {report.rounds} 轮对话</p>
          )}
        </div>

        {/* 六维度评分 */}
        <div className="card">
          <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-primary-600" />
            能力评分
          </h3>
          <div className="space-y-4">
            {dimensions.map((dim, idx) => {
              const config = DIMENSION_CONFIG.find((d) => d.key === dim.key) || {};
              const percent = Math.min(100, Math.max(0, dim.score || 0));
              return (
                <div key={dim.key || idx} className="flex items-center gap-3">
                  <span className="w-20 text-sm text-warm-600 shrink-0">
                    {config.label || dim.name || dim.key}
                  </span>
                  <div className="flex-1 bg-warm-200 rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full transition-all ${config.color || 'bg-primary-500'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="w-10 text-sm font-semibold text-right text-warm-700">
                    {dim.score}
                  </span>
                </div>
              );
            })}
            {dimensions.length === 0 && (
              <p className="text-sm text-warm-400">暂无维度评分数据</p>
            )}
          </div>
        </div>

        {/* 优势 & 劣势 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 优势 */}
          <div className="card border-green-200">
            <h3 className="font-semibold text-emerald-700 mb-3 flex items-center gap-2">
              <ThumbsUp size={18} />
              优势亮点
            </h3>
            {strengths.length === 0 ? (
              <p className="text-sm text-warm-400">暂无数据</p>
            ) : (
              <ul className="space-y-2">
                {strengths.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-green-800">
                    <Check size={14} className="text-green-500 mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 劣势 */}
          <div className="card border-red-200">
            <h3 className="font-semibold text-red-700 mb-3 flex items-center gap-2">
              <ThumbsDown size={18} />
              待改进
            </h3>
            {weaknesses.length === 0 ? (
              <p className="text-sm text-warm-400">暂无数据</p>
            ) : (
              <ul className="space-y-2">
                {weaknesses.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-red-800">
                    <AlertCircle size={14} className="text-rose-500 mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 改进建议 */}
        {report.suggestions && (
          <div className="card border-blue-200">
            <h3 className="font-semibold text-sky-700 mb-3 flex items-center gap-2">
              <Zap size={18} />
              改进建议
            </h3>
            <p className="text-sm text-sky-800 whitespace-pre-wrap leading-relaxed">
              {report.suggestions}
            </p>
          </div>
        )}
      </div>
    );
  };

  /* ================================================================
   *  渲染：历史会话视图
   * ================================================================ */
  const renderHistoryView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setView('scenarios')}
          className="flex items-center gap-1.5 text-sm text-warm-500 hover:text-primary-600 transition"
        >
          <ChevronLeft size={16} />
          返回情景列表
        </button>
        <button
          onClick={loadHistory}
          className="flex items-center gap-1.5 text-sm text-warm-500 hover:text-primary-600 transition"
        >
          <RotateCcw size={14} />
          刷新
        </button>
      </div>

      <h3 className="text-lg font-semibold text-warm-900">历史陪练记录</h3>

      {historyLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={32} className="animate-spin text-primary-600" />
        </div>
      ) : historySessions.length === 0 ? (
        <div className="text-center py-12 card">
          <FileText size={48} className="mx-auto mb-3 text-warm-300" />
          <p className="text-warm-400">暂无陪练记录</p>
          <button
            onClick={() => setView('scenarios')}
            className="btn-primary mt-4 text-sm"
          >
            去开始第一次陪练
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {historySessions.map((session) => {
            const scenario = scenarios.find((s) => s.id === session.scenario_id);
            return (
              <div
                key={session.id}
                className="card flex items-center justify-between hover:shadow-soft-lg transition cursor-pointer"
                onClick={() => handleViewHistoryReport(session)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                    <MessageSquare size={20} className="text-primary-600" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-warm-900">
                      {scenario?.title || `训练 #${session.id}`}
                    </h4>
                    <div className="flex items-center gap-2 text-xs text-warm-400 mt-1">
                      {session.role_type && (
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {session.role_type}
                        </span>
                      )}
                      {session.created_at && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {new Date(session.created_at).toLocaleString('zh-CN')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {session.report_score != null && (
                    <div className="text-right">
                      <span className={`text-lg font-bold ${getRating(session.report_score).color}`}>
                        {session.report_score}
                      </span>
                      <span className="text-xs text-warm-400">分</span>
                    </div>
                  )}
                  <ChevronRight size={18} className="text-warm-300" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  /* ================================================================
   *  主渲染
   * ================================================================ */
  return (
    <div>
      <h2 className="page-title mb-6">模拟门店实战对练</h2>

      {/* 根据 view 切换视图 */}
      {view === 'scenarios' && renderScenarioView()}
      {view === 'chatting' && renderChatView()}
      {view === 'report' && renderReportView()}
      {view === 'history' && renderHistoryView()}
    </div>
  );
}
