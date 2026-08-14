import { useState, useEffect, useCallback, useRef } from 'react';
import { Heart, Send, Trash2, Loader2, ImagePlus, X, Pin, MessageCircle, Users } from 'lucide-react';
import api from '../api';

export default function ShareCircle() {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [posting, setPosting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.get('/shares/groups');
      setGroups(res.data || []);
    } catch { /* ignore */ }
  }, []);

  const loadShares = useCallback(async (pageNum = 1, append = false) => {
    try {
      setLoading(true);
      setError('');
      let url = `/shares?page=${pageNum}&limit=20`;
      if (selectedGroup) url += `&group_id=${selectedGroup}`;
      const res = await api.get(url);
      const data = res.data;
      const list = (data?.list || []).map(s => ({
        ...s,
        images: typeof s.images === 'string' ? JSON.parse(s.images) : (s.images || []),
      }));
      if (append) {
        setShares(prev => [...prev, ...list]);
      } else {
        setShares(list);
      }
      setPage(pageNum);
      setTotalPages(data?.totalPages || 1);
      setHasMore(pageNum < (data?.totalPages || 1));
    } catch (err) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [selectedGroup]);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { loadShares(); }, [loadShares]);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + selectedFiles.length > 9) {
      setError('最多上传9张图片');
      return;
    }
    const newPreviews = files.map(f => ({
      url: URL.createObjectURL(f),
      file: f,
    }));
    setSelectedFiles(prev => [...prev, ...files]);
    setPreviews(prev => [...prev, ...newPreviews]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (idx) => {
    if (previews[idx]?.url) URL.revokeObjectURL(previews[idx].url);
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx));
    setPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const handlePost = async () => {
    if (!content.trim() && selectedFiles.length === 0) return;
    try {
      setPosting(true);
      setError('');
      const formData = new FormData();
      formData.append('content', content.trim());
      selectedFiles.forEach(f => formData.append('images', f));

      const res = await api.post('/shares', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const newShare = {
        ...res.data,
        images: typeof res.data.images === 'string' ? JSON.parse(res.data.images) : (res.data.images || []),
      };
      setShares(prev => [newShare, ...prev]);
      setContent('');
      previews.forEach(p => { if (p?.url) URL.revokeObjectURL(p.url); });
      setSelectedFiles([]);
      setPreviews([]);
    } catch (err) {
      setError(err?.message || '发布失败');
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (shareId, idx) => {
    try {
      const res = await api.post(`/shares/${shareId}/like`);
      setShares(prev => prev.map((s, i) => {
        if (i !== idx) return s;
        return {
          ...s,
          liked: res.data.liked,
          likes_count: res.data.liked ? s.likes_count + 1 : Math.max(0, s.likes_count - 1),
        };
      }));
    } catch (err) {
      /* ignore */
    }
  };

  const handleDelete = async (shareId) => {
    if (!confirm('确定删除这条分享吗？')) return;
    try {
      await api.delete(`/shares/${shareId}`);
      setShares(prev => prev.filter(s => s.id !== shareId));
    } catch (err) {
      alert(err?.message || '删除失败');
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const currentUserId = (() => {
    try {
      const u = localStorage.getItem('user');
      return u ? JSON.parse(u).id : null;
    } catch { return null; }
  })();

  return (
    <div className="flex flex-col h-full">
      {/* 发布框 */}
      <div className="card mb-4 shrink-0">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-300 to-primary-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
            {(() => {
              try {
                const u = JSON.parse(localStorage.getItem('user') || '{}');
                return (u.real_name || u.username || '我')[0];
              } catch { return '我'; }
            })()}
          </div>
          <div className="flex-1 min-w-0">
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="分享你的销售心得..."
              rows={3}
              className="w-full border-0 bg-warm-50/50 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-200 placeholder-warm-400"
            />
            {/* 图片预览 */}
            {previews.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {previews.map((p, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden bg-warm-100">
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-xs text-warm-400 hover:text-primary-600 transition"
              >
                <ImagePlus size={16} />
                图片 ({selectedFiles.length}/9)
              </button>
              <button
                onClick={handlePost}
                disabled={posting || (!content.trim() && selectedFiles.length === 0)}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white text-sm font-medium rounded-xl shadow-soft hover:shadow-soft-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                发布
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* 分组筛选 */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
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

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl mb-3 text-sm flex items-center gap-2">
          <span>{error}</span>
          <button onClick={() => loadShares()} className="ml-auto underline text-xs">重试</button>
        </div>
      )}

      {/* 帖子列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {shares.length === 0 && !loading ? (
          <div className="text-center py-16">
            <MessageCircle size={48} className="mx-auto mb-3 text-warm-300" />
            <p className="text-warm-400">暂无分享，快来发布第一条吧</p>
          </div>
        ) : (
          shares.map((share, idx) => (
            <div key={share.id} className="card">
              {share.is_pinned === 1 && (
                <div className="flex items-center gap-1 text-xs text-primary-600 mb-2">
                  <Pin size={12} />
                  置顶
                </div>
              )}
              {/* 头部 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-300 to-primary-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {(share.real_name || share.username || '?')[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-warm-900">{share.real_name || share.username}</p>
                      {share.group_name && (
                        <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded text-xs">
                          {share.group_name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-warm-400">{formatTime(share.created_at)}</p>
                  </div>
                </div>
                {share.user_id === currentUserId && (
                  <button
                    onClick={() => handleDelete(share.id)}
                    className="p-1.5 text-warm-400 hover:text-rose-500 transition rounded-lg hover:bg-rose-50"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {/* 内容 */}
              <p className="text-sm text-warm-800 whitespace-pre-wrap break-words mb-3">{share.content}</p>

              {/* 图片网格 */}
              {share.images && share.images.length > 0 && (
                <div className={`grid gap-2 mb-3 ${
                  share.images.length === 1 ? 'grid-cols-1' :
                  share.images.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
                }`}>
                  {share.images.map((img, i) => (
                    <div
                      key={i}
                      className={`relative rounded-xl overflow-hidden bg-warm-100 cursor-pointer ${
                        share.images.length === 1 ? 'aspect-video max-w-md' : 'aspect-square'
                      }`}
                      onClick={() => window.open(img, '_blank')}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" loading="lazy" />
                    </div>
                  ))}
                </div>
              )}

              {/* 底部操作 */}
              <div className="flex items-center gap-4 pt-2 border-t border-warm-100/60">
                <button
                  onClick={() => handleLike(share.id, idx)}
                  className={`flex items-center gap-1 text-sm transition ${
                    share.liked ? 'text-rose-500' : 'text-warm-400 hover:text-rose-400'
                  }`}
                >
                  <Heart size={16} fill={share.liked ? 'currentColor' : 'none'} />
                  {share.likes_count || 0}
                </button>
              </div>
            </div>
          ))
        )}

        {/* 加载更多 */}
        {hasMore && (
          <div className="text-center py-3">
            <button
              onClick={() => loadShares(page + 1, true)}
              disabled={loading}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin inline mr-1" /> : null}
              加载更多
            </button>
          </div>
        )}

        {!hasMore && shares.length > 0 && (
          <p className="text-center text-xs text-warm-300 py-4">已经到底啦</p>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
