import { useState, useEffect, useCallback } from 'react';
import {
  Search, ChevronLeft, ChevronRight, FileText, Filter, Download,
} from 'lucide-react';
import api from '../../api';
import { todayShanghai } from '../../utils/time';

const DEFAULT_MODULE_OPTIONS = [{ value: '', label: '全部业务板块' }];

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
  const [moduleOptions, setModuleOptions] = useState(DEFAULT_MODULE_OPTIONS);

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
      // 去掉首尾空格 / Tab，否则拼进 LIKE 会搜不到
      if (operatorSearch.trim()) params.operator = operatorSearch.trim();
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

  useEffect(() => {
    api.get('/logs/modules').then((res) => {
      const data = res?.data || res;
      if (Array.isArray(data)) setModuleOptions([...DEFAULT_MODULE_OPTIONS, ...data]);
    }).catch(() => {});
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // 筛选条件变化时重置页码
  const handleFilterChange = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const exportLogs = async () => {
    try {
      const params = {};
      if (moduleFilter) params.module = moduleFilter;
      if (operatorSearch.trim()) params.operator = operatorSearch.trim();
      if (dateFrom) params.start_date = dateFrom;
      if (dateTo) params.end_date = dateTo;
      const response = await api.get('/logs/export', { params, responseType: 'blob' });
      const blob = response?.data instanceof Blob ? response.data : response;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `活动日志_${todayShanghai()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + (err?.message || '未知错误'));
    }
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

  const renderDetail = (log) => {
    if (!log) return '-';
    let text = '';
    // 优先用后端格式化好的多行文本
    if (log.detail_text) {
      text = log.detail_text;
    } else if (typeof log.detail === 'object' && log.detail) {
      text = Object.entries(log.detail)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('、') : typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n');
    } else {
      return log.target || log.detail || '-';
    }
    return (
      <pre className="m-0 text-[11px] leading-relaxed text-warm-600 bg-warm-50/70 rounded-lg px-2 py-1.5 whitespace-pre-wrap break-words line-clamp-3 max-w-[240px] font-mono cursor-help" title={text}>
        {text}
      </pre>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">活动日志</h1>
        <button onClick={exportLogs} className="btn-primary inline-flex items-center gap-2">
          <Download size={16} /> 导出当前筛选
        </button>
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
            {moduleOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}{m.count != null ? `（${m.count}）` : ''}</option>
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
                    <th className="table-header w-56">详情</th>
                    <th className="table-header w-32">IP</th>
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
                          {log.module_label || moduleOptions.find((m) => m.value === log.module)?.label || log.module || '-'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-col gap-0.5 max-w-[240px]">
                          <span className="text-sm text-warm-800 font-medium line-clamp-2" title={log.description || log.action_label || log.action || '-'}>
                            {log.description || log.action_label || log.action || '-'}
                          </span>
                          {log.action_label && log.description && log.action_label !== log.description && (
                            <span className="text-[11px] text-warm-400">{log.action_label}</span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        {renderDetail(log)}
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
