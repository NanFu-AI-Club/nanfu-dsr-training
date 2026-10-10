import { useState, useEffect, useCallback } from 'react';
import { Trash2, Pin, PinOff, Loader2, Eye, Image, Search, RefreshCw, Users, X } from 'lucide-react';
import api from '../../api';

export default function AdminShares() {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [shareSettings, setShareSettings] = useState({ min_length: 0, blocked_keywords: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [keyword, setKeyword] = useState('');            // 输入框内容
  const [appliedKeyword, setAppliedKeyword] = useState(''); // 已应用的搜索词
  const [author, setAuthor] = useState(null);            // 只看某个人：{ id, name }

  const loadSettings = useCallback(async () => {
    try {
      const res = await api.get('/shares/settings');
      setShareSettings(res.data || { min_length: 0, blocked_keywords: '' });
    } catch { /* ignore */ }
  }, []);

  const saveSettings = async () => {
    try {
      setSettingsSaving(true);
      const res = await api.put('/shares/settings', shareSettings);
      setShareSettings(res.data || shareSettings);
      alert('分享圈规则已保存');
    } catch (err) {
      alert(err?.message || '保存失败');
    } finally {
      setSettingsSaving(false);
    }
  };

  const loadAreas = useCallback(async () => {
    try {
      const res = await api.get('/shares/areas');
      setAreas(res.data || []);
    } catch { /* ignore */ }
  }, []);

  const loadShares = useCallback(async (pageNum = 1) => {
    try {
      setLoading(true);
      setError('');
      let url = `/shares/admin/list?page=${pageNum}&limit=20`;
      if (selectedArea) url += `&area_id=${selectedArea}`;
      if (pinnedOnly) url += `&pinned=1`;
      if (appliedKeyword) url += `&keyword=${encodeURIComponent(appliedKeyword)}`;
      if (author?.id) url += `&user_id=${encodeURIComponent(author.id)}`;
      const res = await api.get(url);
      const data = res.data;
      setShares((data?.list || []).map(s => ({
        ...s,
        images: typeof s.images === 'string' ? (() => { try { return JSON.parse(s.images); } catch { return []; } })() : (s.images || []),
      })));
      setPage(pageNum);
      setTotal(data?.total || 0);
      setTotalPages(data?.totalPages || 1);
    } catch (err) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [selectedArea, pinnedOnly, appliedKeyword, author]);

  useEffect(() => { loadAreas(); loadSettings(); }, [loadAreas, loadSettings]);
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

  // 搜索：按发布人（姓名/工号）或内容
  const applySearch = () => {
    setAppliedKeyword(keyword.trim());
    setAuthor(null);
    setPage(1);
  };

  const clearSearch = () => {
    setKeyword('');
    setAppliedKeyword('');
    setAuthor(null);
    setPage(1);
  };

  // 只看某个人的全部发布
  const onlyAuthor = (s) => {
    setKeyword('');
    setAppliedKeyword('');
    setAuthor({ id: s.user_id, name: s.real_name || s.username || '该用户' });
    setPage(1);
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

      {/* 分享规则 */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-amber-50 shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-primary-100/80 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500 text-white">✓</div>
              <div>
                <h3 className="font-semibold text-warm-900">分享发布规则</h3>
                <p className="mt-0.5 text-xs text-warm-500">统一规范内容质量，保存后立即对新发布内容生效</p>
              </div>
            </div>
          </div>
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs text-primary-600">运营设置</span>
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-[220px_1fr]">
          <div className="rounded-xl border border-white bg-white/80 p-4">
            <label className="block text-sm font-medium text-warm-700">最低文字字数</label>
            <p className="mt-1 text-xs leading-5 text-warm-400">设置为 0 表示不限制。纯图片分享不受文字字数限制。</p>
            <div className="relative mt-3">
              <input
                type="number"
                min="0"
                max="10000"
                value={shareSettings.min_length}
                onChange={(e) => setShareSettings((prev) => ({ ...prev, min_length: e.target.value }))}
                className="input pr-10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-warm-400">字</span>
            </div>
          </div>
          <div className="rounded-xl border border-white bg-white/80 p-4">
            <label className="block text-sm font-medium text-warm-700">屏蔽关键词</label>
            <p className="mt-1 text-xs leading-5 text-warm-400">每行填写一个关键词，也支持使用逗号分隔；命中后将无法发布。</p>
            <textarea
              value={shareSettings.blocked_keywords}
              onChange={(e) => setShareSettings((prev) => ({ ...prev, blocked_keywords: e.target.value }))}
              className="input mt-3 min-h-[96px] resize-y bg-white"
              placeholder="例如：广告\n刷屏\n违规词"
            />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-primary-100/80 px-5 py-3">
          <span className="text-xs text-warm-400">规则校验同时在服务端执行</span>
          <button onClick={saveSettings} disabled={settingsSaving} className="btn-primary min-w-24 disabled:opacity-50">
            {settingsSaving ? '保存中...' : '保存规则'}
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
            placeholder="搜索发布人姓名 / 工号 / 内容，回车搜索"
            className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-warm-200 bg-white focus:border-primary-400 focus:outline-none"
          />
          {keyword && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600"
              title="清空"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button onClick={applySearch} disabled={loading} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
          搜索
        </button>
        {author && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-50 text-primary-600 text-xs">
            只看：{author.name}
            <button onClick={() => { setAuthor(null); setPage(1); }} className="hover:text-primary-800" title="取消">
              <X size={12} />
            </button>
          </span>
        )}
        {appliedKeyword && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warm-100 text-warm-600 text-xs">
            关键词：{appliedKeyword}
            <button onClick={clearSearch} className="hover:text-warm-800" title="取消">
              <X size={12} />
            </button>
          </span>
        )}
      </div>

      {/* 大区筛选 */}
      {areas.length > 0 && (
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
          <Users size={14} className="text-warm-400 shrink-0" />
          <button
            onClick={() => { setSelectedArea(''); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition ${
              !selectedArea ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            全部
          </button>
          {areas.map(a => (
            <button
              key={a.id}
              onClick={() => { setSelectedArea(a.id); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition ${
                selectedArea === a.id ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
              }`}
            >
              {a.name}
            </button>
          ))}
          <button
            onClick={() => { setPinnedOnly(!pinnedOnly); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition flex items-center gap-1 ${
              pinnedOnly ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            <Pin size={12} />
            已置顶
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
          <p className="text-warm-400">
            {(appliedKeyword || author) ? '没有找到匹配的分享' : '暂无分享内容'}
          </p>
          {(appliedKeyword || author) && (
            <button onClick={clearSearch} className="mt-2 text-sm text-primary-600 hover:underline">清除筛选条件</button>
          )}
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
                        {share.area_name && (
                          <span className="ml-2 px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded text-xs">
                            {share.area_name}
                          </span>
                        )}
                        <span className="text-xs text-warm-400 ml-2">{formatTime(share.created_at)}</span>
                        <button
                          type="button"
                          onClick={() => onlyAuthor(share)}
                          className="ml-2 text-xs text-primary-600 hover:text-primary-800 hover:underline"
                          title="只看该用户发布的全部内容"
                        >
                          只看TA
                        </button>
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
                          <button
                            key={i}
                            type="button"
                            onClick={() => setPreviewImage(img)}
                            className="w-16 h-16 rounded-lg overflow-hidden bg-warm-100 cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary-400"
                            title="查看大图"
                          >
                            <img
                              src={img}
                              alt={`分享图片${i + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.parentElement.classList.add('bg-rose-50');
                              }}
                            />
                          </button>
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

      {previewImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
            title="关闭预览"
          >
            <X size={22} />
          </button>
          <img
            src={previewImage}
            alt="分享大图预览"
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onError={() => setPreviewImage(null)}
          />
        </div>
      )}
    </div>
  );
}
