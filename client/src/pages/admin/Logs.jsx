import { useState, useEffect, useCallback } from 'react';
import {
  Search, ChevronLeft, ChevronRight, FileText, Filter,
} from 'lucide-react';
import api from '../../api';

const MODULE_OPTIONS = [
  { value: '', label: '全部模块' },
  { value: 'auth', label: '认证' },
  { value: 'users', label: '用户' },
  { value: 'knowledge', label: '知识库' },
  { value: 'questions', label: '题库' },
  { value: 'exams', label: '考试' },
  { value: 'courses', label: '课程' },
  { value: 'ai', label: 'AI' },
  { value: 'training', label: '培训' },
];

const MODULE_COLORS = {
  auth: 'badge-yellow',
  users: 'badge-blue',
  knowledge: 'badge-green',
  questions: 'bg-purple-100 text-purple-800',
  exams: 'bg-orange-100 text-orange-800',
  courses: 'bg-teal-100 text-teal-800',
  ai: 'bg-pink-100 text-pink-800',
  training: 'badge-red',
};

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 筛选
  const [moduleFilter, setModuleFilter] = useState('');
  const [operatorSearch, setOperatorSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // 分页
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  /* ================= 数据加载 ================= */
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, pageSize };
      if (moduleFilter) params.module = moduleFilter;
      if (operatorSearch) params.operator = operatorSearch;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const res = await api.get('/logs', { params });
      const data = res?.data || res;
      if (Array.isArray(data)) {
        // 如果后端返回数组，直接使用
        setLogs(data);
        setTotal(data.length);
      } else if (data && data.list) {
        // 如果后端返回分页对象
        setLogs(data.list || []);
        setTotal(data.total || 0);
      } else {
        setLogs([]);
        setTotal(0);
      }
    } catch (err) {
      setError(err?.message || '获取日志失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, moduleFilter, operatorSearch, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // 筛选条件变化时重置页码
  const handleFilterChange = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  /* ================= 分页 ================= */
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  /* ================= 渲染 ================= */
  const getModuleBadgeClass = (module) => {
    return MODULE_COLORS[module] || 'badge-gray';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">活动日志</h1>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-rose-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">关闭</button>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-warm-500">
            <Filter size={14} />
            <span>筛选:</span>
          </div>

          <select
            className="input w-28"
            value={moduleFilter}
            onChange={(e) => handleFilterChange(setModuleFilter)(e.target.value)}
          >
            {MODULE_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>

          <div className="relative w-40">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-warm-400" />
            <input
              className="input pl-8 text-sm"
              placeholder="操作人"
              value={operatorSearch}
              onChange={(e) => handleFilterChange(setOperatorSearch)(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              className="input w-36 text-sm"
              value={dateFrom}
              onChange={(e) => handleFilterChange(setDateFrom)(e.target.value)}
            />
            <span className="text-warm-400 text-sm">至</span>
            <input
              type="date"
              className="input w-36 text-sm"
              value={dateTo}
              onChange={(e) => handleFilterChange(setDateTo)(e.target.value)}
            />
          </div>

          {(moduleFilter || operatorSearch || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setModuleFilter('');
                setOperatorSearch('');
                setDateFrom('');
                setDateTo('');
                setPage(1);
              }}
              className="text-sm text-primary-600 hover:text-primary-800 underline"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 日志列表 */}
      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-sm text-warm-400">
            <FileText size={40} className="mx-auto mb-3 text-warm-300" />
            <p>暂无日志记录</p>
          </div>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header w-40">时间</th>
                    <th className="table-header w-24">操作人</th>
                    <th className="table-header w-20">模块</th>
                    <th className="table-header">动作描述</th>
                    <th className="table-header w-48">目标详情</th>
                    <th className="table-header w-36">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-100">
                  {logs.map((log, idx) => (
                    <tr key={log.id || idx} className="hover:bg-warm-50/80">
                      <td className="table-cell text-xs text-warm-500 whitespace-nowrap">
                        {log.created_at || log.time || '-'}
                      </td>
                      <td className="table-cell">
                        <span className="font-medium text-warm-900 text-sm">
                          {log.operator || log.operator_name || log.username || '-'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className={`badge text-xs ${getModuleBadgeClass(log.module)}`}>
                          {MODULE_OPTIONS.find((m) => m.value === log.module)?.label || log.module || '-'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className="text-sm text-warm-700">
                          {log.action || log.description || '-'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="text-xs text-warm-500 max-w-xs truncate" title={
                          typeof log.detail === 'object' ? JSON.stringify(log.detail) : (log.target || log.detail || '')
                        }>
                          {typeof log.detail === 'object' ? JSON.stringify(log.detail) : (log.target || log.detail || '-')}
                        </div>
                      </td>
                      <td className="table-cell">
                        <code className="text-xs text-warm-400 bg-warm-50/80 rounded px-1.5 py-0.5">
                          {log.ip || log.ip_address || '-'}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {total > pageSize && (
              <div className="flex items-center justify-between pt-4 border-t mt-4">
                <div className="text-sm text-warm-500">
                  共 {total} 条记录，第 {page}/{totalPages} 页
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-2 rounded-xl hover:bg-warm-100 text-warm-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {getPageNumbers().map((p) => (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 rounded-xl text-sm font-medium transition ${
                        p === page
                          ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg'
                          : 'text-warm-600 hover:bg-warm-100'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-2 rounded-xl hover:bg-warm-100 text-warm-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
