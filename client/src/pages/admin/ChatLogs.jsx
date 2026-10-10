import { useState, useEffect, useCallback, Fragment } from 'react';
import api from '../../api';
import { todayShanghai } from '../../utils/time';
import { Search, MessageSquare, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, User, Clock, ThumbsUp, ThumbsDown, Loader2, Minus, Download, Star, BookOpen } from 'lucide-react';

export default function AdminChatLogs() {
  const [tab, setTab] = useState('conversations'); // conversations | feedbacks
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedConv, setExpandedConv] = useState(null);
  const [convDetail, setConvDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const pageSize = 20;

  // ---- 反馈评分 ----
  const [feedbacks, setFeedbacks] = useState([]);
  const [feedbackFilter, setFeedbackFilter] = useState('all');
  const [fbLoading, setFbLoading] = useState(false);

  // ---- 没用反馈 ----
  const [dislikes, setDislikes] = useState([]);
  const [dislikeLoading, setDislikeLoading] = useState(false);
  const [dislikeOpen, setDislikeOpen] = useState({});
  const [dislikeDetail, setDislikeDetail] = useState({});
  const [dislikeDetailLoading, setDislikeDetailLoading] = useState({});

  useEffect(() => {
    if (tab === 'conversations') loadLogs();
  }, [page, search, tab]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = { page, pageSize };
      if (search.trim()) params.search = search.trim();
      const res = await api.get('/ai/admin/conversations', { params });
      if (res.code === 0) {
        setLogs(res.data.list || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('加载对话记录失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (conversationId) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/ai/admin/conversations/${conversationId}`);
      if (res.code === 0) {
        setConvDetail(res.data || []);
      }
    } catch (err) {
      console.error('加载对话详情失败:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleExpand = (conversationId) => {
    if (expandedConv === conversationId) {
      setExpandedConv(null);
      setConvDetail(null);
    } else {
      setExpandedConv(conversationId);
      loadDetail(conversationId);
    }
  };

  const fetchFeedbacks = useCallback(async () => {
    setFbLoading(true);
    try {
      const params = feedbackFilter === 'all' ? {} : { rating: feedbackFilter };
      const res = await api.get('/knowledge/feedbacks', { params });
      const data = res?.data || res;
      const fbs = Array.isArray(data) ? data : (data?.list || []);
      setFeedbacks(fbs);
    } catch (err) {
      console.error('获取反馈失败:', err);
    } finally {
      setFbLoading(false);
    }
  }, [feedbackFilter]);

  useEffect(() => {
    if (tab === 'feedbacks') fetchFeedbacks();
  }, [tab, fetchFeedbacks]);

  const fetchDislikes = useCallback(async () => {
    setDislikeLoading(true);
    try {
      const res = await api.get('/ai/admin/dislikes');
      const data = res?.data || res;
      const list = Array.isArray(data) ? data : (data?.list || []);
      setDislikes(list);
    } catch (err) {
      console.error('获取没用反馈失败:', err);
    } finally {
      setDislikeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'dislikes') fetchDislikes();
  }, [tab, fetchDislikes]);

  // 展开/收起某条「没用反馈」所属的完整对话
  const toggleDislikeConversation = async (d) => {
    const key = d.id;
    if (dislikeOpen[key]) {
      setDislikeOpen(prev => ({ ...prev, [key]: false }));
      return;
    }
    setDislikeOpen(prev => ({ ...prev, [key]: true }));
    if (dislikeDetail[key] || !d.conversation_id) return;
    setDislikeDetailLoading(prev => ({ ...prev, [key]: true }));
    try {
      const res = await api.get(`/ai/admin/conversations/${d.conversation_id}`);
      const list = res?.code === 0 ? (res.data || []) : [];
      setDislikeDetail(prev => ({ ...prev, [key]: list }));
    } catch {
      setDislikeDetail(prev => ({ ...prev, [key]: [] }));
    } finally {
      setDislikeDetailLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const formatTime = (t) => {
    if (!t) return '';
    const d = new Date(t);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    return isToday
      ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const truncate = (text, len = 80) => {
    if (!text) return '';
    return text.length > len ? text.substring(0, len) + '...' : text;
  };

  const parseSources = (sources) => {
    try {
      if (!sources) return [];
      const parsed = typeof sources === 'string' ? JSON.parse(sources) : sources;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  const handleExport = (type) => {
    const urls = {
      feedbacks: '/knowledge/feedbacks/export',
      conversations: '/ai/admin/conversations/export',
      dislikes: '/ai/admin/dislikes/export',
    };
    const url = urls[type];
    if (!url) return;
    api.get(url, { responseType: 'blob' }).then(res => {
      const blob = res.data || res;
      const a = document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = `${type}_${todayShanghai()}.csv`;
      a.click();
      a.remove();
    }).catch(err => alert('导出失败: ' + (err?.message || '未知错误')));
  };

  // 按 conversation_id 分组
  const grouped = {};
  logs.forEach((item) => {
    if (!grouped[item.conversation_id]) {
      grouped[item.conversation_id] = {
        conversation_id: item.conversation_id,
        user: { username: item.username, real_name: item.real_name, id: item.user_id },
        messages: [],
        latestTime: item.created_at,
      };
    }
    grouped[item.conversation_id].messages.push(item);
  });
  const groups = Object.values(grouped).sort((a, b) => new Date(b.latestTime) - new Date(a.latestTime));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-warm-900">跑店问问对话记录</h1>
          <p className="text-sm text-warm-500 mt-1">查看业务员在跑店问问中的所有对话和反馈</p>
        </div>
        {/* Tab 切换 */}
        <div className="flex bg-warm-100 rounded-xl p-1">
          <button
            onClick={() => setTab('conversations')}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition ${
              tab === 'conversations' ? 'bg-white shadow text-warm-900' : 'text-warm-500'
            }`}
          >
            对话记录
          </button>
          <button
            onClick={() => setTab('feedbacks')}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition ${
              tab === 'feedbacks' ? 'bg-white shadow text-warm-900' : 'text-warm-500'
            }`}
          >
            反馈评分
          </button>
          <button
            onClick={() => setTab('dislikes')}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition ${
              tab === 'dislikes' ? 'bg-white shadow text-warm-900' : 'text-warm-500'
            }`}
          >
            没用反馈
          </button>
        </div>
      </div>

      {/* ========== 对话记录 ========== */}
      {tab === 'conversations' && (<>
        {/* 搜索栏 */}
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-warm-100/60 p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-warm-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="搜索问题内容、业务员姓名..."
                className="input pl-10 rounded-xl border-warm-200 w-full"
              />
            </div>
            <button onClick={() => handleExport('conversations')} className="btn-secondary flex items-center gap-1.5 text-sm shrink-0">
              <Download size={15} /> 导出CSV
            </button>
          </div>
        </div>

        {/* 对话列表 */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={28} className="animate-spin text-primary-500" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16 bg-white/60 rounded-2xl border border-warm-100/60">
            <MessageSquare size={40} className="mx-auto mb-3 text-warm-300" />
            <p className="text-warm-500">暂无对话记录</p>
            <p className="text-warm-400 text-sm mt-1">业务员开始使用跑店问问后，对话记录将显示在这里</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.conversation_id} className="bg-white/80 backdrop-blur-xl rounded-2xl border border-warm-100/60 overflow-hidden">
                <button
                  onClick={() => toggleExpand(group.conversation_id)}
                  className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-warm-50/50 transition-all duration-200 text-left"
                >
                  <div className="w-8 h-8 bg-gradient-to-br from-sky-200 to-primary-300 rounded-full flex items-center justify-center shrink-0">
                    <User size={15} className="text-primary-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-warm-800">
                      {group.user.real_name || group.user.username}
                      <span className="text-warm-400 font-normal ml-1.5 text-xs">@{group.user.username}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-warm-400 mt-0.5">
                      <span className="flex items-center gap-1">
                        <MessageSquare size={11} />
                        {group.messages.length} 轮对话
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {formatTime(group.latestTime)}
                      </span>
                    </div>
                  </div>
                  <div className="text-warm-400">
                    {expandedConv === group.conversation_id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </button>

                {expandedConv === group.conversation_id && (
                  <div className="border-t border-warm-100/60 bg-warm-50/50">
                    {detailLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 size={20} className="animate-spin text-warm-400" />
                      </div>
                    ) : convDetail && convDetail.length > 0 ? (
                      <div className="divide-y divide-warm-100/30">
                        {convDetail.map((msg, idx) => (
                          <div key={msg.id || idx} className="px-4 py-3">
                            <div className="flex items-start gap-2 mb-2">
                              <div className="w-6 h-6 bg-primary-100 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-[10px] font-bold text-primary-600">Q</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-warm-800 whitespace-pre-wrap break-words">{msg.question}</p>
                                <span className="text-[10px] text-warm-400">{formatTime(msg.created_at)}</span>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <div className="w-6 h-6 bg-sky-100 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-[10px] font-bold text-sky-600">A</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-warm-700 whitespace-pre-wrap break-words">{truncate(msg.answer, 500)}</p>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  {msg.rating === 'like' && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-500">
                                      <ThumbsUp size={10} /> 好评
                                    </span>
                                  )}
                                  {msg.rating === 'dislike' && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-rose-500">
                                      <ThumbsDown size={10} /> 没用
                                    </span>
                                  )}
                                  {msg.favorite_id && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
                                      <Star size={10} fill="currentColor" /> 已收藏
                                    </span>
                                  )}
                                </div>
                                {msg.feedback_reason && (
                                  <div className="mt-2 px-3 py-2 bg-rose-50/70 border border-rose-100 rounded-lg">
                                    <span className="text-[10px] font-medium text-rose-500">反馈原因：</span>
                                    <span className="text-xs text-warm-700 break-words">{msg.feedback_reason}</span>
                                  </div>
                                )}
                                {(() => {
                                  const srcs = parseSources(msg.sources);
                                  return srcs.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {srcs.map((s, i) => (
                                        <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                                          s.type === 'question'
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                            : 'bg-sky-50 text-sky-700 border border-sky-100'
                                        }`}>
                                          <BookOpen size={10} />
                                          {s.type === 'question' ? '题库' : '知识库'}: {truncate(s.title, 30)}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-warm-400 text-sm">暂无详情</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-xl hover:bg-warm-100 disabled:opacity-30 transition-all"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-warm-600 px-3">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-xl hover:bg-warm-100 disabled:opacity-30 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </>)}

      {/* ========== 反馈评分 ========== */}
      {tab === 'feedbacks' && (
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-warm-100/60">
          <div className="p-4 border-b border-warm-100/60">
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { key: 'all', label: '全部' },
                { key: 'like', label: '满意' },
                { key: 'dislike', label: '不满意' },
                { key: 'none', label: '无评分' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFeedbackFilter(f.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                    feedbackFilter === f.key ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <div className="flex-1" />
              <button onClick={() => handleExport('feedbacks')} className="btn-secondary flex items-center gap-1.5 text-sm shrink-0">
                <Download size={15} /> 导出CSV
              </button>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">用户</th>
                  <th className="table-header">问题</th>
                  <th className="table-header w-16">评分</th>
                  <th className="table-header w-16">收藏</th>
                  <th className="table-header">关联文档</th>
                  <th className="table-header w-36">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100">
                {fbLoading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12">
                      <Loader2 size={20} className="animate-spin text-warm-400 mx-auto" />
                    </td>
                  </tr>
                ) : feedbacks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-sm text-warm-400">暂无反馈数据</td>
                  </tr>
                ) : (
                  feedbacks.map((fb, idx) => {
                    const srcs = parseSources(fb.sources);
                    return (
                    <tr key={fb.id || idx} className="hover:bg-warm-50/80">
                      <td className="table-cell font-medium">{fb.user_name || fb.user}</td>
                      <td className="table-cell text-warm-600">{truncate(fb.question, 50) || '-'}</td>
                      <td className="table-cell">
                        {fb.rating === 'like' && <ThumbsUp size={16} className="text-green-500" />}
                        {fb.rating === 'dislike' && <ThumbsDown size={16} className="text-rose-500" />}
                        {(!fb.rating || fb.rating === 'none') && <Minus size={16} className="text-warm-400" />}
                      </td>
                      <td className="table-cell">
                        {fb.favorite_id ? <Star size={15} className="text-amber-500" fill="currentColor" /> : <Minus size={15} className="text-warm-300" />}
                      </td>
                      <td className="table-cell">
                        {srcs.length > 0 ? (
                          <div className="flex flex-wrap gap-0.5">
                            {srcs.map((s, i) => (
                              <span key={i} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                s.type === 'question'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-sky-50 text-sky-700'
                              }`}>
                                {s.type === 'question' ? '📝' : '📚'} {truncate(s.title, 20)}
                              </span>
                            ))}
                          </div>
                        ) : <span className="text-warm-400 text-xs">-</span>}
                      </td>
                      <td className="table-cell text-xs text-warm-400">{fb.created_at}</td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========== 没用反馈 ========== */}
      {tab === 'dislikes' && (
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-warm-100/60 overflow-hidden">
          <div className="p-4 border-b border-warm-100/60 flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-warm-500">业务员标记「没用」的对话记录与反馈原因（含语音转文字），可展开查看该次完整对话</p>
            <button onClick={() => handleExport('dislikes')} className="btn-secondary flex items-center gap-1.5 text-sm shrink-0">
              <Download size={15} /> 导出CSV
            </button>
          </div>
          <div className="overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header w-28">用户</th>
                  <th className="table-header">对话记录（问 / 答）</th>
                  <th className="table-header w-64">反馈原因</th>
                  <th className="table-header w-36">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100">
                {dislikeLoading ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12">
                      <Loader2 size={20} className="animate-spin text-warm-400 mx-auto" />
                    </td>
                  </tr>
                ) : dislikes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-sm text-warm-400">暂无「没用」反馈</td>
                  </tr>
                ) : (
                  dislikes.map((d, idx) => (
                    <Fragment key={d.id || idx}>
                      <tr className="hover:bg-warm-50/80 align-top">
                        <td className="table-cell font-medium">{d.real_name || d.username || '-'}</td>
                        <td className="table-cell">
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-600">问</span>
                              <p className="text-sm text-warm-800 whitespace-pre-wrap break-words">{d.question || '-'}</p>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600">答</span>
                              <p className="text-sm text-warm-600 whitespace-pre-wrap break-words">{truncate(d.answer, 300) || '-'}</p>
                            </div>
                            {d.conversation_id && (
                              <button
                                onClick={() => toggleDislikeConversation(d)}
                                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
                              >
                                {dislikeOpen[d.id] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                {dislikeOpen[d.id] ? '收起完整对话' : '查看完整对话'}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="table-cell">
                          <div className="px-3 py-2 bg-rose-50/70 border border-rose-100 rounded-lg text-xs text-warm-700 whitespace-pre-wrap break-words">{d.feedback_reason}</div>
                        </td>
                        <td className="table-cell text-xs text-warm-400">{formatTime(d.created_at)}</td>
                      </tr>
                      {dislikeOpen[d.id] && (
                        <tr className="bg-warm-50/60">
                          <td colSpan={4} className="px-4 py-3">
                            {dislikeDetailLoading[d.id] ? (
                              <div className="flex items-center gap-2 text-xs text-warm-400">
                                <Loader2 size={14} className="animate-spin" /> 加载完整对话中...
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {(dislikeDetail[d.id] || []).map((m, i) => (
                                  <div key={m.id || i} className="space-y-1">
                                    <div className="flex items-start gap-2">
                                      <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-600">问</span>
                                      <p className="text-sm text-warm-800 whitespace-pre-wrap break-words">{m.question}</p>
                                    </div>
                                    <div className="flex items-start gap-2">
                                      <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600">答</span>
                                      <p className="text-sm text-warm-700 whitespace-pre-wrap break-words">{m.answer}</p>
                                    </div>
                                  </div>
                                ))}
                                {(dislikeDetail[d.id] || []).length === 0 && (
                                  <p className="text-xs text-warm-400">未获取到完整对话</p>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
