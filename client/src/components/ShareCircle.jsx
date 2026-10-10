import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Heart, Trash2, Loader2, X, Pin, MessageCircle, CornerDownRight, ChevronLeft, ChevronRight, Camera, Coins, Send, Bell, User } from 'lucide-react';
import api from '../api';
import ShareComposer from './ShareComposer';

// 评论区子组件（微信朋友圈风格：浅灰背景块内展示）
function CommentSection({
  shareId,
  commentsData,
  inputState,
  isAdmin,
  submitting,
  onTextChange,
  onSubmit,
  onCancelReply,
  onStartReply,
  onDeleteComment,
}) {
  const list = commentsData?.list || [];
  const loading = commentsData?.loading;
  const { text, replyTo } = inputState || { text: '', replyTo: null };

  // 组装成"一级 + 内嵌二级"结构
  const top = [];
  const children = {};
  list.forEach((c) => {
    if (c.parent_id) {
      if (!children[c.parent_id]) children[c.parent_id] = [];
      children[c.parent_id].push(c);
    } else {
      top.push(c);
    }
  });

  const renderComment = (c, isChild = false) => {
    const displayName = c.real_name || c.username || '用户';
    const replyName = c.reply_to_user_name;
    return (
      <div key={c.id} className={`flex gap-2 ${isChild ? 'pl-6 relative' : ''}`}>
        {isChild && (
          <CornerDownRight size={14} className="absolute left-0 top-2 text-warm-300" />
        )}
        <div className="w-7 h-7 rounded bg-gradient-to-br from-sky-300 to-primary-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {displayName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-warm-800 whitespace-pre-wrap break-words leading-5">
            <span className="text-[#576b95]">{displayName}</span>
            {replyName && <span className="text-warm-500"> 回复 </span>}
            {replyName && <span className="text-[#576b95]">{replyName}</span>}
            {isAdmin && (
              <button
                onClick={() => onDeleteComment(c.id)}
                className="ml-1 text-warm-300 hover:text-rose-500 transition align-middle"
                title="删除评论（管理员）"
              >
                <Trash2 size={12} className="inline" />
              </button>
            )}
            <span>：{c.content}</span>
          </p>
          {!isChild && (
            <button
              onClick={() => onStartReply(c)}
              className="mt-0.5 text-xs text-warm-400 hover:text-primary-600 transition"
            >
              回复
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center justify-center py-4 text-warm-400 text-xs">
          <Loader2 size={14} className="animate-spin mr-1" /> 加载评论中...
        </div>
      ) : top.length === 0 ? (
        <p className="text-center text-xs text-warm-300 py-2">还没有评论</p>
      ) : (
        <div className="space-y-3">
          {top.map((c) => (
            <div key={c.id} className="space-y-2">
              {renderComment(c, false)}
              {children[c.id] && children[c.id].length > 0 && (
                <div className="space-y-2">
                  {children[c.id].map((child) => renderComment(child, true))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 输入区 */}
      <div className="pt-1">
        {replyTo && (
          <div className="flex items-center justify-between mb-1.5 px-2 py-1 bg-white rounded-lg text-xs text-primary-700">
            <span>
              回复 <span className="font-medium">@{replyTo.userName}</span>
            </span>
            <button onClick={onCancelReply} className="text-primary-400 hover:text-primary-700">
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            id={`comment-input-${shareId}`}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!submitting && text.trim()) onSubmit();
              }
            }}
            placeholder={replyTo ? `回复 @${replyTo.userName}...` : '评论...'}
            rows={1}
            className="flex-1 border border-warm-200 bg-white rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-200 placeholder-warm-400 max-h-24"
          />
          <button
            onClick={onSubmit}
            disabled={submitting || !text.trim()}
            className="px-3 py-1.5 bg-primary-500 text-white text-xs font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShareCircle() {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [pointToast, setPointToast] = useState(null); // { earned, dailyEarned, dailyLimit }
  const [preview, setPreview] = useState(null); // { images: string[], index: number }
  const [commentsMap, setCommentsMap] = useState({}); // { shareId: { list, loaded, loading, open } }
  const [commentInputs, setCommentInputs] = useState({}); // { shareId: { text, replyTo } }
  const [commentSubmitting, setCommentSubmitting] = useState({}); // { shareId: bool }

  // 消息通知 + 我的分享
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifReply, setNotifReply] = useState(null); // 正在回复的通知
  const [notifReplyText, setNotifReplyText] = useState('');
  const [notifReplySubmitting, setNotifReplySubmitting] = useState(false);
  const [showMine, setShowMine] = useState(false);
  const [myShares, setMyShares] = useState([]);
  const [mineLoading, setMineLoading] = useState(false);

  const loadAreas = useCallback(async () => {
    try {
      const res = await api.get('/shares/areas');
      setAreas(res.data || []);
    } catch { /* ignore */ }
  }, []);

  const loadUnreadCount = useCallback(async () => {
    try {
      const res = await api.get('/shares/notifications?page=1&limit=1');
      setUnreadCount(res.data?.unread_count || 0);
    } catch { /* ignore */ }
  }, []);

  const openNotifications = async () => {
    setShowNotifications(true);
    setNotifLoading(true);
    try {
      const res = await api.get('/shares/notifications?page=1&limit=50');
      setNotifications(res.data?.list || []);
      setUnreadCount(0);
      try { await api.post('/shares/notifications/read'); } catch { /* ignore */ }
    } catch { /* ignore */ } finally {
      setNotifLoading(false);
    }
  };

  const openMine = async () => {
    setShowMine(true);
    setMineLoading(true);
    try {
      const res = await api.get('/shares/mine?page=1&limit=50');
      const list = (res.data?.list || []).map((s) => ({
        ...s,
        images: typeof s.images === 'string' ? JSON.parse(s.images) : (s.images || []),
        likers: s.likers || [],
      }));
      setMyShares(list);
    } catch { /* ignore */ } finally {
      setMineLoading(false);
    }
  };

  const submitNotifReply = async () => {
    const n = notifReply;
    const text = notifReplyText.trim();
    if (!n || !text || !n.share_id || !n.comment_id) return;
    setNotifReplySubmitting(true);
    try {
      await api.post(`/shares/${n.share_id}/comments`, {
        content: text,
        parent_id: n.comment_id,
        reply_to_user_id: n.actor_id,
        reply_to_user_name: n.actor_name,
      });
      setNotifReplyText('');
      setNotifReply(null);
    } catch (e) {
      alert(e?.message || '回复失败');
    } finally {
      setNotifReplySubmitting(false);
    }
  };

  const loadShares = useCallback(async (pageNum = 1, append = false) => {
    try {
      setLoading(true);
      setError('');
      let url = `/shares?page=${pageNum}&limit=20`;
      if (selectedArea) url += `&area_id=${selectedArea}`;
      const res = await api.get(url);
      const data = res.data;
      const list = (data?.list || []).map((s) => ({
        ...s,
        images: typeof s.images === 'string' ? JSON.parse(s.images) : (s.images || []),
        likers: s.likers || [],
      }));
      if (append) {
        setShares((prev) => [...prev, ...list]);
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
  }, [selectedArea]);

  useEffect(() => { loadAreas(); }, [loadAreas]);
  useEffect(() => { loadUnreadCount(); }, [loadUnreadCount]);
  useEffect(() => { loadShares(); }, [loadShares]);

  const handlePublished = (newShare, toast) => {
    setShares((prev) => [newShare, ...prev]);
    setShowComposer(false);
    if (toast) {
      setPointToast(toast);
      setTimeout(() => setPointToast(null), 3500);
    }
  };

  const handleLike = async (shareId, idx) => {
    try {
      const res = await api.post(`/shares/${shareId}/like`);
      const likedNow = res.data.liked;
      const currentUser = (() => {
        try {
          const u = JSON.parse(localStorage.getItem('user') || '{}');
          return u.real_name || u.username || '';
        } catch { return ''; }
      })();
      setShares((prev) => prev.map((s, i) => {
        if (i !== idx) return s;
        const likers = s.likers || [];
        const nextLikers = likedNow
          ? (likers.includes(currentUser) ? likers : [...likers, currentUser])
          : likers.filter((n) => n !== currentUser);
        return {
          ...s,
          liked: likedNow,
          likes_count: likedNow ? (s.likes_count || 0) + 1 : Math.max(0, (s.likes_count || 0) - 1),
          likers: nextLikers,
        };
      }));
    } catch { /* ignore */ }
  };

  const handleDelete = async (shareId) => {
    if (!confirm('确定删除这条分享吗？')) return;
    try {
      await api.delete(`/shares/${shareId}`);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (err) {
      alert(err?.message || '删除失败');
    }
  };

  // ============= 评论相关 =============
  const toggleComments = async (shareId) => {
    const cur = commentsMap[shareId] || { list: [], loaded: false, loading: false, open: false };
    const willOpen = !cur.open;
    setCommentsMap((prev) => ({
      ...prev,
      [shareId]: { ...cur, open: willOpen, loading: willOpen && !cur.loaded ? true : cur.loading },
    }));
    if (willOpen && !cur.loaded) {
      try {
        const res = await api.get(`/shares/${shareId}/comments`);
        const list = res.data?.list || [];
        setCommentsMap((prev) => ({
          ...prev,
          [shareId]: { list, loaded: true, loading: false, open: true },
        }));
      } catch {
        setCommentsMap((prev) => ({
          ...prev,
          [shareId]: { ...prev[shareId], loading: false },
        }));
      }
    }
  };

  const getInputState = (shareId) => commentInputs[shareId] || { text: '', replyTo: null };

  const setInputState = (shareId, patch) => {
    setCommentInputs((prev) => ({
      ...prev,
      [shareId]: { ...getInputState(shareId), ...patch },
    }));
  };

  const handleSubmitComment = async (shareId) => {
    const state = getInputState(shareId);
    const text = state.text.trim();
    if (!text) return;
    if (text.length > 500) {
      alert('评论内容最多 500 字');
      return;
    }
    setCommentSubmitting((prev) => ({ ...prev, [shareId]: true }));
    try {
      const payload = { content: text };
      if (state.replyTo && state.replyTo.id) {
        payload.parent_id = state.replyTo.id;
        payload.reply_to_user_id = state.replyTo.userId;
        payload.reply_to_user_name = state.replyTo.userName;
      }
      const res = await api.post(`/shares/${shareId}/comments`, payload);
      const newComment = res.data;
      setCommentsMap((prev) => {
        const cur = prev[shareId] || { list: [], loaded: false, loading: false, open: true };
        return { ...prev, [shareId]: { ...cur, list: [...cur.list, newComment], loaded: true } };
      });
      setShares((prev) => prev.map((s) => s.id === shareId
        ? { ...s, comments_count: (s.comments_count || 0) + 1 }
        : s
      ));
      setInputState(shareId, { text: '', replyTo: null });
    } catch (e) {
      alert(e?.message || '评论失败');
    } finally {
      setCommentSubmitting((prev) => ({ ...prev, [shareId]: false }));
    }
  };

  const handleDeleteComment = async (shareId, commentId) => {
    if (!confirm('确定删除这条评论吗？若该评论有回复，将一起删除。')) return;
    try {
      const res = await api.delete(`/shares/comments/${commentId}`);
      const deleted = res.data?.deleted || 1;
      setCommentsMap((prev) => {
        const cur = prev[shareId];
        if (!cur) return prev;
        const toRemove = new Set();
        toRemove.add(commentId);
        cur.list.forEach((c) => { if (c.parent_id === commentId) toRemove.add(c.id); });
        return { ...prev, [shareId]: { ...cur, list: cur.list.filter((c) => !toRemove.has(c.id)) } };
      });
      setShares((prev) => prev.map((s) => s.id === shareId
        ? { ...s, comments_count: Math.max(0, (s.comments_count || 0) - deleted) }
        : s
      ));
    } catch (e) {
      alert(e?.message || '删除评论失败');
    }
  };

  const startReply = (shareId, comment) => {
    const userName = comment.real_name || comment.username || '用户';
    setInputState(shareId, {
      text: '',
      replyTo: { id: comment.id, userId: comment.user_id, userName },
    });
    setTimeout(() => {
      const el = document.getElementById(`comment-input-${shareId}`);
      if (el) el.focus();
    }, 50);
  };

  const cancelReply = (shareId) => setInputState(shareId, { text: '', replyTo: null });

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

  const isAdmin = (() => {
    try {
      const u = localStorage.getItem('user');
      return u ? JSON.parse(u).role === 'admin' : false;
    } catch { return false; }
  })();

  const openPreview = (images, index) => setPreview({ images, index });
  const closePreview = () => setPreview(null);
  const prevImage = () => setPreview((p) => (p && p.index > 0 ? { ...p, index: p.index - 1 } : p));
  const nextImage = () => setPreview((p) => (p && p.index < p.images.length - 1 ? { ...p, index: p.index + 1 } : p));

  return (
    <div className="flex flex-col h-full">
      {/* 标题行：分享圈 + 消息 + 我的 + 发布 */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h2 className="page-title">分享圈</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={openNotifications}
            className="relative w-9 h-9 rounded-full bg-warm-100 hover:bg-warm-200 flex items-center justify-center text-warm-600 hover:text-primary-600 transition shrink-0"
            title="消息"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-rose-500 rounded-full text-white text-[10px] font-medium flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={openMine}
            className="w-9 h-9 rounded-full bg-warm-100 hover:bg-warm-200 flex items-center justify-center text-warm-600 hover:text-primary-600 transition shrink-0"
            title="我的分享"
          >
            <User size={18} />
          </button>
          <button
            onClick={() => setShowComposer(true)}
            className="flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium shadow-soft transition shrink-0"
            title="发布分享"
          >
            <Camera size={16} />
            发布
          </button>
        </div>
      </div>

      {/* 大区筛选 */}
      <div className="flex items-center gap-2 mb-3 shrink-0 overflow-x-auto pb-1">
        <button
          onClick={() => { setSelectedArea(''); setPage(1); }}
          className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition shrink-0 ${
            !selectedArea ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
          }`}
        >
          全部
        </button>
        {areas.map((a) => (
          <button
            key={a.id}
            onClick={() => { setSelectedArea(a.id); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition shrink-0 ${
              selectedArea === a.id ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl mb-3 text-sm flex items-center gap-2 shrink-0">
          <span>{error}</span>
          <button onClick={() => loadShares()} className="ml-auto underline text-xs">重试</button>
        </div>
      )}

      {/* 积分提示 */}
      {pointToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-gradient-to-r from-amber-400 to-orange-500 text-white rounded-2xl shadow-lg flex items-center gap-3">
          <Coins size={20} />
          <div className="text-sm">
            {pointToast.earned > 0 ? (
              <>
                <span className="font-semibold">获得 {pointToast.earned} 积分</span>
                <span className="ml-2 text-amber-50/90 text-xs">
                  今日已得 {pointToast.dailyEarned}/{pointToast.dailyLimit}（最多3次）
                </span>
              </>
            ) : (
              <span className="font-medium">今日分享积分已达上限 {pointToast.dailyLimit}（最多3次）</span>
            )}
          </div>
        </div>
      )}

      {/* 帖子列表（微信朋友圈信息流） */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white rounded-xl">
        {shares.length === 0 && !loading ? (
          <div className="text-center py-16">
            <MessageCircle size={48} className="mx-auto mb-3 text-warm-300" />
            <p className="text-warm-400">暂无分享，快来发布第一条吧</p>
          </div>
        ) : (
          <div>
            {shares.map((share, idx) => (
              <div key={share.id} className="px-4 py-3 border-b border-warm-100/60">
                {share.is_pinned === 1 && (
                  <div className="flex items-center gap-1 text-xs text-primary-600 mb-2">
                    <Pin size={12} />
                    置顶
                  </div>
                )}
                {/* 头部 */}
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-md bg-gradient-to-br from-sky-300 to-primary-500 flex items-center justify-center text-white font-bold text-base shrink-0">
                    {(share.real_name || share.username || '?')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-[15px] font-semibold text-[#576b95] truncate">
                          {share.real_name || share.username}
                        </p>
                        {share.area_name && (
                          <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded text-[10px] shrink-0">
                            {share.area_name}
                          </span>
                        )}
                      </div>
                      {share.user_id === currentUserId && (
                        <button
                          onClick={() => handleDelete(share.id)}
                          className="p-1 text-warm-300 hover:text-rose-500 transition rounded shrink-0"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>

                    {/* 内容 */}
                    {share.content && (
                      <p className="text-[15px] text-warm-900 whitespace-pre-wrap break-words mt-1 leading-6">
                        {share.content}
                      </p>
                    )}

                    {/* 图片九宫格 */}
                    {share.images && share.images.length > 0 && (
                      <div className="mt-2">
                        {share.images.length === 1 ? (
                          <div
                            className="w-1/3 max-w-[180px] aspect-square rounded-lg overflow-hidden bg-warm-100 cursor-pointer"
                            onClick={() => openPreview(share.images, 0)}
                          >
                            <img src={share.images[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
                          </div>
                        ) : (
                          <div className={`grid gap-1.5 ${
                            share.images.length === 2 || share.images.length === 4 ? 'grid-cols-2' : 'grid-cols-3'
                          }`}>
                            {share.images.map((img, i) => (
                              <div
                                key={i}
                                className="aspect-square rounded-lg overflow-hidden bg-warm-100 cursor-pointer"
                                onClick={() => openPreview(share.images, i)}
                              >
                                <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 底部：时间 + 操作 */}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-warm-400">{formatTime(share.created_at)}</span>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => handleLike(share.id, idx)}
                          className={`flex items-center gap-1 text-sm transition ${share.liked ? 'text-rose-500' : 'text-warm-500'}`}
                        >
                          <Heart size={15} fill={share.liked ? 'currentColor' : 'none'} />
                          {share.likes_count > 0 ? share.likes_count : '赞'}
                        </button>
                        <button
                          onClick={() => toggleComments(share.id)}
                          className={`flex items-center gap-1 text-sm transition ${
                            commentsMap[share.id]?.open ? 'text-primary-600' : 'text-warm-500'
                          }`}
                        >
                          <MessageCircle size={15} />
                          {share.comments_count > 0 ? share.comments_count : '评论'}
                        </button>
                      </div>
                    </div>

                    {/* 评论展开区（灰色背景块，微信风格） */}
                    {commentsMap[share.id]?.open && (
                      <div className="mt-2 bg-warm-50 rounded-lg p-3">
                        {(share.likers || []).length > 0 && (
                          <div className="flex items-start gap-1.5 mb-2">
                            <Heart size={14} className="text-rose-500 mt-0.5 shrink-0" fill="currentColor" />
                            <span className="text-sm text-warm-800 leading-5">{share.likers.join('、')}</span>
                          </div>
                        )}
                        <CommentSection
                          shareId={share.id}
                          commentsData={commentsMap[share.id]}
                          inputState={getInputState(share.id)}
                          isAdmin={isAdmin}
                          submitting={!!commentSubmitting[share.id]}
                          onTextChange={(v) => setInputState(share.id, { text: v })}
                          onSubmit={() => handleSubmitComment(share.id)}
                          onCancelReply={() => cancelReply(share.id)}
                          onStartReply={(c) => startReply(share.id, c)}
                          onDeleteComment={(commentId) => handleDeleteComment(share.id, commentId)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
      </div>

      {/* 图片预览弹窗 */}
      {preview && createPortal(
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center"
          onClick={closePreview}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition"
            onClick={closePreview}
            aria-label="关闭预览"
          >
            <X size={24} />
          </button>

          {preview.index > 0 && (
            <button
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition"
              onClick={(e) => { e.stopPropagation(); prevImage(); }}
              aria-label="上一张"
            >
              <ChevronLeft size={28} />
            </button>
          )}

          <img
            src={preview.images[preview.index]}
            alt="预览图片"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {preview.index < preview.images.length - 1 && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition"
              onClick={(e) => { e.stopPropagation(); nextImage(); }}
              aria-label="下一张"
            >
              <ChevronRight size={28} />
            </button>
          )}

          {preview.images.length > 1 && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/15 text-white text-sm">
              {preview.index + 1} / {preview.images.length}
            </div>
          )}
        </div>,
        document.body
      )}

      {/* 全屏发布页 */}
      {showComposer && (
        <ShareComposer
          onClose={() => setShowComposer(false)}
          onPublished={handlePublished}
        />
      )}

      {/* 消息列表 */}
      {showNotifications && createPortal(
        <div className="fixed inset-0 z-[200] bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 h-12 border-b border-warm-100/60 shrink-0">
            <button
              onClick={() => { setShowNotifications(false); setNotifReply(null); }}
              className="flex items-center text-warm-700 hover:text-warm-900 transition"
            >
              <ChevronLeft size={24} />
              <span className="text-sm">返回</span>
            </button>
            <span className="text-[15px] font-semibold text-warm-900">消息</span>
            <span className="w-14" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {notifLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 size={28} className="animate-spin text-primary-600" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-16">
                <Bell size={48} className="mx-auto mb-3 text-warm-300" />
                <p className="text-warm-400">暂无消息</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className="px-4 py-3 border-b border-warm-100/60">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-md bg-gradient-to-br from-sky-300 to-primary-500 flex items-center justify-center text-white font-bold shrink-0">
                      {(n.actor_name || '?')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-warm-800 leading-5">
                        <span className="font-medium text-[#576b95]">{n.actor_name}</span>
                        <span className="text-warm-600">
                          {n.type === 'like' ? ' 赞了你的分享' : n.type === 'comment' ? ' 评论了你的分享' : ' 回复了你的评论'}
                        </span>
                        {n.content && n.type !== 'like' && (
                          <span className="text-warm-500">：{n.content}</span>
                        )}
                      </p>
                      <p className="text-xs text-warm-400 mt-1">{formatTime(n.created_at)}</p>
                      {n.type !== 'like' && n.share_id && n.comment_id && (
                        <div className="mt-1.5">
                          {notifReply?.id === n.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={notifReplyText}
                                onChange={(e) => setNotifReplyText(e.target.value)}
                                placeholder={`回复 @${n.actor_name}...`}
                                className="flex-1 border border-warm-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200"
                                autoFocus
                              />
                              <button
                                onClick={submitNotifReply}
                                disabled={notifReplySubmitting || !notifReplyText.trim()}
                                className="px-3 py-1 bg-primary-500 text-white text-xs rounded-lg disabled:opacity-50 shrink-0"
                              >
                                {notifReplySubmitting ? '发送中' : '发送'}
                              </button>
                              <button
                                onClick={() => { setNotifReply(null); setNotifReplyText(''); }}
                                className="px-2 py-1 text-xs text-warm-400 shrink-0"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setNotifReply(n)} className="text-xs text-primary-600">
                              回复
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}

      {/* 我的分享 */}
      {showMine && createPortal(
        <div className="fixed inset-0 z-[200] bg-white flex flex-col">
          <div className="flex items-center px-4 h-12 border-b border-warm-100/60 shrink-0">
            <button onClick={() => setShowMine(false)} className="flex items-center text-warm-700 hover:text-warm-900 transition">
              <ChevronLeft size={24} />
              <span className="text-sm">返回</span>
            </button>
            <span className="flex-1 text-center text-[15px] font-semibold text-warm-900">我的分享</span>
            <span className="w-14" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {mineLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 size={28} className="animate-spin text-primary-600" />
              </div>
            ) : myShares.length === 0 ? (
              <div className="text-center py-16">
                <MessageCircle size={48} className="mx-auto mb-3 text-warm-300" />
                <p className="text-warm-400">你还没有发布过分享</p>
              </div>
            ) : (
              myShares.map((share) => (
                <div key={share.id} className="px-4 py-3 border-b border-warm-100/60">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-md bg-gradient-to-br from-sky-300 to-primary-500 flex items-center justify-center text-white font-bold shrink-0">
                      {(share.real_name || share.username || '?')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-[15px] font-semibold text-[#576b95] truncate">
                            {share.real_name || share.username}
                          </p>
                          {share.area_name && (
                            <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded text-[10px] shrink-0">
                              {share.area_name}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-warm-400 shrink-0">{formatTime(share.created_at)}</span>
                      </div>
                      {share.content && (
                        <p className="text-[15px] text-warm-900 whitespace-pre-wrap break-words mt-1 leading-6">
                          {share.content}
                        </p>
                      )}
                      {share.images && share.images.length > 0 && (
                        <div className="mt-2">
                          {share.images.length === 1 ? (
                            <div
                              className="w-1/3 max-w-[180px] aspect-square rounded-lg overflow-hidden bg-warm-100 cursor-pointer"
                              onClick={() => openPreview(share.images, 0)}
                            >
                              <img src={share.images[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </div>
                          ) : (
                            <div className={`grid gap-1.5 ${share.images.length === 2 || share.images.length === 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                              {share.images.map((img, i) => (
                                <div
                                  key={i}
                                  className="aspect-square rounded-lg overflow-hidden bg-warm-100 cursor-pointer"
                                  onClick={() => openPreview(share.images, i)}
                                >
                                  <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-warm-400">
                        <span className="flex items-center gap-1"><Heart size={12} />{share.likes_count || 0}</span>
                        <span className="flex items-center gap-1"><MessageCircle size={12} />{share.comments_count || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
