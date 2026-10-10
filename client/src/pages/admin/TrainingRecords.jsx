import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, ChevronLeft, MessageSquare, FileText, Bot, User, Download, Filter, X } from 'lucide-react';
import api from '../../api';
import { formatShanghai, todayShanghai } from '../../utils/time';

export default function TrainingRecords() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [filters, setFilters] = useState({ status: '', user_id: '', scenario_id: '', date_from: '', date_to: '' });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [scenarios, setScenarios] = useState([]);
  const [users, setUsers] = useState([]);
  const [userKeyword, setUserKeyword] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('page', page);
      params.append('pageSize', pageSize);
      if (filters.status) params.append('status', filters.status);
      if (filters.user_id) params.append('user_id', filters.user_id);
      if (filters.scenario_id) params.append('scenario_id', filters.scenario_id);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);
      const res = await api.get(`/training/admin/sessions?${params.toString()}`);
      const data = res.data || res || {};
      setSessions(Array.isArray(data) ? data : (data.list || []));
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || Math.max(1, Math.ceil((data.total || 0) / pageSize)));
    } catch (err) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  // 加载筛选选项
  useEffect(() => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 29);
    const toDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    setFilters((prev) => ({ ...prev, date_from: toDate(from), date_to: toDate(today) }));

    api.get('/training/scenarios?status=all&pageSize=100').then(res => {
      const data = res.data?.data || res.data || res || [];
      setScenarios(Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : []));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: '1', limit: '30', role: 'sales' });
    if (userKeyword.trim()) params.set('keyword', userKeyword.trim());
    api.get(`/users?${params.toString()}`).then(res => {
      const data = res.data?.data || res.data || res || [];
      setUsers(Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : []));
    }).catch(() => {});
  }, [userKeyword]);

  useEffect(() => { setPage(1); }, [filters]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  const viewDetail = async (sessionId) => {
    try {
      setLoading(true);
      const [msgRes, reportRes] = await Promise.all([
        api.get(`/training/admin/sessions/${sessionId}/messages`),
        api.get(`/training/admin/sessions/${sessionId}/report`).catch(() => null),
      ]);
      const msgData = msgRes.data || msgRes || {};
      const session = msgData.session || {};
      const messages = msgData.messages || [];

      let report = null;
      if (reportRes) {
        const reportData = reportRes.data || reportRes;
        report = reportData;
      }

      setDetail({ session, messages, report });
    } catch (err) {
      setError(err?.message || '加载详情失败');
    } finally {
      setLoading(false);
    }
  };

  if (detail) {
    const { session, messages, report } = detail;
    return (
      <div className="space-y-4">
        <button
          onClick={() => setDetail(null)}
          className="flex items-center gap-1.5 text-sm text-warm-500 hover:text-primary-600 transition"
        >
          <ChevronLeft size={16} /> 返回列表
        </button>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-warm-900">{session.scenario_title || 'FU利陪陪记录'}</h3>
              <p className="text-xs text-warm-400 mt-1">
                {session.real_name || session.username || '-'} · {session.role_type || ''} · {session.started_at ? formatShanghai(session.started_at) : ''}
              </p>
            </div>
            {report && report.total_score != null && (
              <div className="text-right">
                <div className={`text-2xl font-bold ${report.total_score >= 80 ? 'text-green-600' : report.total_score >= 60 ? 'text-amber-600' : 'text-rose-500'}`}>
                  {report.total_score.toFixed?.(1) ?? report.total_score}
                </div>
                <div className="text-xs text-warm-400">总分</div>
              </div>
            )}
          </div>
        </div>

        {/* 对话记录 */}
        <div className="card">
          <h4 className="font-semibold text-warm-900 mb-3">对话记录</h4>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {messages.length === 0 && <p className="text-sm text-warm-400 text-center py-4">暂无对话记录</p>}
            {messages.map((msg) => {
              if (msg.role === 'system') {
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="bg-sky-50 text-sky-700 text-xs px-4 py-2 rounded-full max-w-lg text-center">{msg.content}</div>
                  </div>
                );
              }
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end gap-2">
                    <div className="max-w-[75%] bg-primary-600 text-white rounded-2xl rounded-br-md px-4 py-2.5">
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                      <User size={16} className="text-primary-600" />
                    </div>
                  </div>
                );
              }
              return (
                <div key={msg.id} className="flex justify-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <Bot size={16} className="text-amber-600" />
                  </div>
                  <div className="max-w-[75%] bg-white border border-warm-200 rounded-2xl rounded-tl-md px-4 py-2.5">
                    <p className="text-sm whitespace-pre-wrap text-warm-800">{msg.content}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 评估报告 */}
        {report && (
          <div className="card">
            <h4 className="font-semibold text-warm-900 mb-3">评估报告</h4>
            {report.dimensions && (() => {
              let dims = [];
              try { dims = JSON.parse(report.dimensions || '[]'); } catch (_) {}
              return dims.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  {dims.map((d, i) => (
                    <div key={i} className="bg-warm-50 rounded-xl p-3 text-center">
                      <div className="text-lg font-bold text-primary-600">{d.score ?? '-'}</div>
                      <div className="text-xs text-warm-500 mt-1">{d.name || d.dimension || '-'}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
            {report.strengths && (() => {
              let arr = [];
              try { arr = JSON.parse(report.strengths || '[]'); } catch (_) {}
              return arr.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-green-600 mb-1">优势</p>
                  <ul className="list-disc list-inside text-sm text-warm-700 space-y-1">
                    {arr.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              );
            })()}
            {report.weaknesses && (() => {
              let arr = [];
              try { arr = JSON.parse(report.weaknesses || '[]'); } catch (_) {}
              return arr.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-rose-500 mb-1">待改进</p>
                  <ul className="list-disc list-inside text-sm text-warm-700 space-y-1">
                    {arr.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              );
            })()}
            {report.suggestions && <p className="text-sm text-warm-600">{report.suggestions}</p>}
          </div>
        )}
      </div>
    );
  }

  // 导出Excel
  const exportExcel = () => {
    const headers = ['业务员', '情景', '角色', '开始时间', '状态', '得分', '积分'];
    const rows = sessions.map(s => [
      s.real_name || s.username || '-',
      s.scenario_title || '-',
      s.role_type || '-',
      s.started_at ? formatShanghai(s.started_at) : '-',
      s.status === 'completed' ? '已结束' : '进行中',
      s.report_score != null ? s.report_score.toFixed(1) : '-',
      s.earned_points != null ? s.earned_points : '-'
    ]);
    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FU利陪陪记录_${todayShanghai()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-warm-900">FU利陪陪记录</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters(!showFilters)} className={`btn-secondary flex items-center gap-1.5 ${showFilters ? 'bg-primary-50 text-primary-600' : ''}`}>
            <Filter size={16} /> 筛选
          </button>
          <button onClick={exportExcel} className="btn-secondary flex items-center gap-1.5">
            <Download size={16} /> 导出
          </button>
        </div>
      </div>

      {/* 筛选区域 */}
      {showFilters && (
        <div className="card mb-4 bg-warm-50/50">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-warm-500 mb-1 block">状态</label>
              <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="input-field text-sm">
                <option value="">全部</option>
                <option value="ongoing">进行中</option>
                <option value="completed">已结束</option>
              </select>
            </div>
            <div>
                <label className="text-xs text-warm-500 mb-1 block">业务员</label>
                <input
                  value={userKeyword}
                  onChange={e => setUserKeyword(e.target.value)}
                  placeholder="搜索姓名/账号"
                  className="input-field text-sm mb-1"
                />
                <select value={filters.user_id} onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))} className="input-field text-sm">
                  <option value="">全部</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.real_name || u.username}</option>)}
                </select>
              </div>
            <div>
              <label className="text-xs text-warm-500 mb-1 block">情景</label>
              <select value={filters.scenario_id} onChange={e => setFilters(f => ({ ...f, scenario_id: e.target.value }))} className="input-field text-sm">
                <option value="">全部</option>
                {scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-warm-500 mb-1 block">开始日期</label>
              <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} className="input-field text-sm" />
            </div>
            <div>
              <label className="text-xs text-warm-500 mb-1 block">结束日期</label>
              <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} className="input-field text-sm" />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={() => { setFilters({ status: '', user_id: '', scenario_id: '', date_from: '', date_to: '' }); }} className="text-sm text-warm-500 hover:text-warm-700 flex items-center gap-1">
              <X size={14} /> 清空筛选
            </button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error mb-4 flex items-center gap-2"><AlertCircle size={16} />{error}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-500" size={24} /></div>
      ) : sessions.length === 0 ? (
        <div className="card text-center py-12 text-warm-400">暂无FU利陪陪记录</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-100 text-warm-500">
                <th className="text-left py-3 px-3">业务员</th>
                <th className="text-left py-3 px-3">情景</th>
                <th className="text-left py-3 px-3">角色</th>
                <th className="text-left py-3 px-3">开始时间</th>
                <th className="text-left py-3 px-3">状态</th>
                <th className="text-left py-3 px-3">得分</th>
                <th className="text-left py-3 px-3">积分</th>
                <th className="text-left py-3 px-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-warm-50 hover:bg-warm-50/50">
                  <td className="py-3 px-3 font-medium">{s.real_name || s.username || '-'}</td>
                  <td className="py-3 px-3">{s.scenario_title || '-'}</td>
                  <td className="py-3 px-3 text-warm-500">{s.role_type || '-'}</td>
                  <td className="py-3 px-3 text-xs text-warm-400">{s.started_at ? formatShanghai(s.started_at) : '-'}</td>
                  <td className="py-3 px-3">
                    <span className={`badge ${s.status === 'completed' ? 'badge-green' : 'badge-amber'}`}>
                      {s.status === 'completed' ? '已结束' : '进行中'}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-semibold text-amber-600">{s.report_score != null ? s.report_score.toFixed(1) : '-'}</td>
                  <td className="py-3 px-3 font-semibold text-emerald-600">{s.earned_points != null ? s.earned_points : '-'}</td>
                  <td className="py-3 px-3">
                    <button onClick={() => viewDetail(s.id)} className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-1">
                      <FileText size={14} /> 查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="btn-secondary text-sm disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-sm text-warm-500">第 {page} / {totalPages} 页，共 {total} 条</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="btn-secondary text-sm disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
