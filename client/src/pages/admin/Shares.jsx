import { useState, useEffect, useCallback } from 'react';
import { Trash2, Pin, PinOff, Loader2, Eye, Image, Search, RefreshCw, Users } from 'lucide-react';
import api from '../../api';

export default function AdminShares() {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.get('/shares/groups');
      setGroups(res.data || []);
    } catch { /* ignore */ }
  }, []);

  const loadShares = useCallback(async (pageNum = 1) => {
    try {
      setLoading(true);
      setError('');
      let url = `/shares/admin/list?page=${pageNum}&limit=20`;
      if (selectedGroup) url += `&group_id=${selectedGroup}`;
      const res = await api.get(url);
      const data = res.data;
      setShares((data?.list || []).map(s => ({
        ...s,
        images: typeof s.images === 'string' ? JSON.parse(s.images) : (s.images || []),
      })));
      setPage(pageNum);
      setTotal(data?.total || 0);
      setTotalPages(data?.totalPages || 1);
    } catch (err) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [selectedGroup]);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { loadShares(); }, [loadShares]);

  const handlePin = async (shareId, currentPin) => {
    setActionLoading(prev => ({ ...prev, [`pin_${shareId}`]: true }));
    try {
      const res = await api.post(`/shares/admin/${shareId}/pin`);
      setShares(prev => prev.map(s =>
        s.id === shareId ? { ...s, is_pinned: res.data.is_pinned ? 1 : 0 } : s
      ));
    } catch (err) {
      alert(err?.message || '操作失败');
    } finally {
      setActionLoading(prev => ({ ...prev, [`pin_${shareId}`]: false }));
    }
  };

  const handleDelete = async (shareId) => {
    if (!confirm('确定删除这条分享吗？删除后用户将看不到。')) return;
    setActionLoading(prev => ({ ...prev, [`del_${shareId}`]: true }));
    try {
      await api.delete(`/shares/admin/${shareId}`);
      setShares(prev => prev.filter(s => s.id !== shareId));
      setTotal(prev => prev - 1);
    } catch (err) {
      alert(err?.message || '删除失败');
    } finally {
      setActionLoading(prev => ({ ...prev, [`del_${shareId}`]: false }));
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const truncate = (str, len = 80) => {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  };

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="page-title mb-1">分享圈管理</h2>
          <p className="text-sm text-warm-400">共 {total} 条分享</p>
        </div>
        <button
          onClick={() => loadShares(page)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm text-warm-600 hover:text-warm-800 hover:bg-warm-100 rounded-xl transition disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 分组筛选 */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
          <Users size={14} className="text-warm-400 shrink-0" />
          <button
            onClick={() => { setSelectedGroup(''); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition ${
              !selectedGroup ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            全部
          </button>
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => { setSelectedGroup(g.id); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition ${
                selectedGroup === g.id ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
              }`}
            >
              {g.name}
            </button>
          ))}
          <button
            onClick={() => { setSelectedGroup('__none__'); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition ${
              selectedGroup === '__none__' ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            未分组
          </button>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl mb-4 text-sm">
          {error}
          <button onClick={() => loadShares()} className="ml-2 underline">重试</button>
        </div>
      )}

      {/* 加载态 */}
      {loading && shares.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary-600" />
        </div>
      ) : shares.length === 0 ? (
        <div className="card text-center py-16">
          <Image size={48} className="mx-auto mb-3 text-warm-300" />
          <p className="text-warm-400">暂无分享内容</p>
        </div>
      ) : (
        <>
          {/* 列表 */}
          <div className="space-y-3">
            {shares.map(share => (
              <div key={share.id} className={`card ${share.deleted === 1 ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* 作者信息行 */}
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-300 to-primary-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {(share.real_name || share.username || '?')[0]}
                      </div>
                      <div>
                        <span className="text-sm font-medium text-warm-900">{share.real_name || share.username}</span>
                        {share.group_name && (
                          <span className="ml-2 px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded text-xs">
                            {share.group_name}
                          </span>
                        )}
                        <span className="text-xs text-warm-400 ml-2">{formatTime(share.created_at)}</span>
                      </div>
                      {share.is_pinned === 1 && (
                        <span className="badge-blue text-xs flex items-center gap-1">
                          <Pin size={10} /> 置顶
                        </span>
                      )}
                      {share.deleted === 1 && (
                        <span className="badge-red text-xs">已删除</span>
                      )}
                    </div>

                    {/* 内容 */}
                    <p className="text-sm text-warm-700 whitespace-pre-wrap break-words mb-2">
                      {share.content}
                    </p>

                    {/* 图片缩略 */}
                    {share.images && share.images.length > 0 && (
                      <div className="flex gap-2 flex-wrap mb-2">
                        {share.images.slice(0, 6).map((img, i) => (
                          <div key={i} className="w-16 h-16 rounded-lg overflow-hidden bg-warm-100">
                            <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                          </div>
                        ))}
                        {share.images.length > 6 && (
                          <div className="w-16 h-16 rounded-lg bg-warm-100 flex items-center justify-center text-xs text-warm-400">
                            +{share.images.length - 6}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handlePin(share.id, share.is_pinned)}
                      disabled={actionLoading[`pin_${share.id}`] || share.deleted === 1}
                      className={`p-2 rounded-lg transition text-sm ${
                        share.is_pinned
                          ? 'text-primary-600 bg-primary-50 hover:bg-primary-100'
                          : 'text-warm-400 hover:text-primary-600 hover:bg-warm-50'
                      } disabled:opacity-50`}
                      title={share.is_pinned ? '取消置顶' : '置顶'}
                    >
                      {actionLoading[`pin_${share.id}`] ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : share.is_pinned ? (
                        <PinOff size={16} />
                      ) : (
                        <Pin size={16} />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(share.id)}
                      disabled={actionLoading[`del_${share.id}`] || share.deleted === 1}
                      className="p-2 rounded-lg text-warm-400 hover:text-rose-500 hover:bg-rose-50 transition disabled:opacity-50"
                      title="删除"
                    >
                      {actionLoading[`del_${share.id}`] ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                </div>

                {/* 底部统计 */}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-warm-100/60 text-xs text-warm-400">
                  <span>{(share.likes_count || 0)} 赞</span>
                  <span>{share.images.length || 0} 张图片</span>
                  <span className="ml-auto">ID: {share.id?.slice(0, 8)}...</span>
                </div>
              </div>
            ))}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => loadShares(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-warm-200 hover:bg-warm-50 disabled:opacity-30 transition"
              >
                上一页
              </button>
              <span className="text-sm text-warm-500 px-3">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => loadShares(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-warm-200 hover:bg-warm-50 disabled:opacity-30 transition"
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
