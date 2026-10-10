import { useState, useEffect, useCallback } from 'react';
import { Megaphone, Loader2, RefreshCw, ChevronDown, CheckCheck } from 'lucide-react';
import api from '../../api';

export default function SalesAnnouncements() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async (pageNum = 1) => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get(`/announcements/mine?page=${pageNum}&limit=20`);
      const data = res.data || {};
      setList(data.list || []);
      setPage(pageNum);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  const unreadCount = list.filter(a => !a.is_read).length;

  const toggle = async (item) => {
    const next = expanded === item.id ? null : item.id;
    setExpanded(next);
    if (next && !item.is_read) {
      setList(prev => prev.map(x => x.id === item.id ? { ...x, is_read: 1 } : x));
      try { await api.post(`/announcements/${item.id}/read`); } catch { /* 忽略 */ }
    }
  };

  const markAllRead = async () => {
    setList(prev => prev.map(x => ({ ...x, is_read: 1 })));
    try { await api.post('/announcements/read-all'); } catch { /* 忽略 */ }
  };

  const formatTime = (ts) => (ts ? String(ts).slice(0, 16) : '');

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-5">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-warm-900 flex items-center gap-2">
            <Megaphone size={20} className="text-primary-600" />
            公告
          </h2>
          <p className="text-sm text-warm-400 mt-1">
            共 {total} 条{unreadCount > 0 ? ` · 本页 ${unreadCount} 条未读` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-xl transition"
            >
              <CheckCheck size={15} /> 全部已读
            </button>
          )}
          <button
            onClick={() => load(page)}
            disabled={loading}
            className="p-2 text-warm-500 hover:bg-warm-100 rounded-xl transition disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl mb-4 text-sm">
          {error}
          <button onClick={() => load(page)} className="ml-2 underline">重试</button>
        </div>
      )}

      {loading && list.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary-600" />
        </div>
      ) : list.length === 0 ? (
        <div className="card text-center py-16">
          <Megaphone size={48} className="mx-auto mb-3 text-warm-300" />
          <p className="text-warm-400">暂无公告</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {list.map(item => (
              <div
                key={item.id}
                className={`card transition ${!item.is_read ? 'border-l-4 border-l-primary-500' : ''}`}
              >
                <button onClick={() => toggle(item)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {!item.is_read && <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0" />}
                        <span className={`text-base truncate ${!item.is_read ? 'font-semibold text-warm-900' : 'font-medium text-warm-700'}`}>
                          {item.title}
                        </span>
                        {item.scope === 'areas' && (
                          <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded text-xs shrink-0">大区</span>
                        )}
                      </div>
                      {expanded !== item.id && (
                        <p className="text-sm text-warm-400 mt-1 truncate">{item.content}</p>
                      )}
                    </div>
                    <ChevronDown
                      size={18}
                      className={`text-warm-400 shrink-0 transition-transform ${expanded === item.id ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {expanded === item.id && (
                  <div className="mt-3 pt-3 border-t border-warm-100">
                    <p className="text-sm text-warm-700 whitespace-pre-wrap break-words leading-relaxed">{item.content}</p>
                    <div className="flex items-center gap-3 mt-3 text-xs text-warm-400">
                      <span>{item.created_by_name || '管理团队'}</span>
                      <span>{formatTime(item.published_at || item.created_at)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                disabled={page <= 1}
                onClick={() => load(page - 1)}
                className="px-3 py-1.5 text-sm rounded-lg bg-warm-100 text-warm-600 disabled:opacity-40"
              >
                上一页
              </button>
              <span className="text-sm text-warm-500">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => load(page + 1)}
                className="px-3 py-1.5 text-sm rounded-lg bg-warm-100 text-warm-600 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
