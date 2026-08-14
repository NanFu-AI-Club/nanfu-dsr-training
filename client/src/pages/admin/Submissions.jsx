import { useState, useEffect } from 'react';
import { Loader2, CheckCircle, XCircle, Eye, Clock, Search, ChevronLeft, ChevronRight, Trash2, Image, Video, Link, ExternalLink, Briefcase, TrendingUp, ShieldAlert, Users, MoreHorizontal, MonitorSmartphone } from 'lucide-react';
import api from '../../api';

const CATEGORIES = [
  { key: 'sales_negotiation', label: '进货谈单实战', desc: '谈卖进、应对老板拒绝', icon: Briefcase, color: 'from-amber-50 to-orange-50 border-amber-200 hover:border-amber-300', activeColor: 'border-amber-500 bg-amber-50', iconBg: 'bg-amber-100 text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  { key: 'store_sales', label: '门店动销实操', desc: '提升门店电池销量', icon: TrendingUp, color: 'from-emerald-50 to-teal-50 border-emerald-200 hover:border-emerald-300', activeColor: 'border-emerald-500 bg-emerald-50', iconBg: 'bg-emerald-100 text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'store_issues', label: '门店难点处理', desc: '棘手门店问题处理', icon: ShieldAlert, color: 'from-rose-50 to-red-50 border-rose-200 hover:border-rose-300', activeColor: 'border-rose-500 bg-rose-50', iconBg: 'bg-rose-100 text-rose-700', badge: 'bg-rose-100 text-rose-700' },
  { key: 'customer_acquisition', label: '终端拓客秘籍', desc: '客户开发与维护', icon: Users, color: 'from-blue-50 to-indigo-50 border-blue-200 hover:border-blue-300', activeColor: 'border-blue-500 bg-blue-50', iconBg: 'bg-blue-100 text-blue-700', badge: 'bg-blue-100 text-blue-700' },
  { key: 'ai_tools', label: '数智工具赋能', desc: 'AI数字化平台实操', icon: MonitorSmartphone, color: 'from-cyan-50 to-sky-50 border-cyan-200 hover:border-cyan-300', activeColor: 'border-cyan-500 bg-cyan-50', iconBg: 'bg-cyan-100 text-cyan-700', badge: 'bg-cyan-100 text-cyan-700' },
  { key: 'other', label: '其他经验分享', desc: '未覆盖的实战干货', icon: MoreHorizontal, color: 'from-purple-50 to-violet-50 border-purple-200 hover:border-purple-300', activeColor: 'border-purple-500 bg-purple-50', iconBg: 'bg-purple-100 text-purple-700', badge: 'bg-purple-100 text-purple-700' },
];

const CATEGORY_LABEL_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));

const STATUS_MAP = {
  pending: { label: '待审核', icon: Clock, className: 'bg-amber-100 text-amber-700' },
  approved: { label: '已通过', icon: CheckCircle, className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: '已驳回', icon: XCircle, className: 'bg-rose-100 text-rose-700' },
};

export default function Submissions() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [catStats, setCatStats] = useState({});
  const [allTotal, setAllTotal] = useState(0);
  const [previewItem, setPreviewItem] = useState(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewingItem, setReviewingItem] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 12 };
      if (filterStatus) params.status = filterStatus;
      if (filterCategory) params.category = filterCategory;
      const res = await api.get('/submissions', { params });
      const data = res?.data || res;
      setList(data?.list || []);
      setTotal(data?.total || 0);
      setCatStats(data?.stats || {});
      setAllTotal(data?.allTotal || 0);
      setTotalPages(Math.ceil((data?.total || 0) / 12) || 1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, [page, filterStatus, filterCategory]);

  const handleReview = async (id, status) => {
    setActionLoading(true);
    try {
      await api.put(`/submissions/${id}/status`, { status, review_comment: reviewComment });
      setReviewingItem(null);
      setReviewComment('');
      fetchList();
    } catch (e) {
      alert(e.response?.data?.message || '操作失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确定删除这条投稿吗？')) return;
    try {
      await api.delete(`/submissions/${id}`);
      fetchList();
    } catch (e) {}
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-warm-900">风采投稿管理</h2>
          <p className="text-sm text-warm-500 mt-1">审核和管理业务员提交的风采投稿</p>
        </div>
        {/* 状态筛选 */}
        <div className="flex gap-2">
          {['', 'pending', 'approved', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => { setFilterStatus(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                filterStatus === s ? 'bg-primary-600 text-white' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
              }`}
            >
              {s === '' ? '全部' : STATUS_MAP[s]?.label || s}
            </button>
          ))}
        </div>
      </div>

      {/* 板块卡片 */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => { setFilterCategory(''); setPage(1); }}
          className={`shrink-0 flex flex-col items-center text-center px-5 py-3 rounded-xl border-2 bg-gradient-to-br transition-all duration-200 cursor-pointer
            ${filterCategory === '' ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]' : 'from-warm-50 to-warm-100 border-warm-200 hover:border-warm-300'}
          `}
        >
          <span className={`text-2xl font-bold mb-0.5 ${filterCategory === '' ? 'text-primary-600' : 'text-warm-600'}`}>{allTotal}</span>
          <span className="text-xs text-warm-500">全部投稿</span>
        </button>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 flex-1">
          {CATEGORIES.map(cat => {
            const CatIcon = cat.icon;
            const count = catStats[cat.key] || 0;
            const isActive = filterCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => { setFilterCategory(cat.key === filterCategory ? '' : cat.key); setPage(1); }}
                className={`relative flex flex-col items-center text-center p-3 rounded-xl border-2 bg-gradient-to-br transition-all duration-200 cursor-pointer
                  ${isActive ? cat.activeColor + ' shadow-md scale-[1.02]' : cat.color}
                `}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 ${cat.iconBg}`}>
                  <CatIcon className="w-5 h-5" />
                </div>
                <span className={`text-sm font-semibold ${isActive ? 'text-warm-900' : 'text-warm-700'} mb-0.5`}>{cat.label}</span>
                <span className="text-[11px] text-warm-400 leading-tight mb-1.5">{cat.desc}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.badge}`}>
                  {count} 篇
                </span>
                {isActive && (
                  <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary-600 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-white rounded-full" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 当前筛选条件提示 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-warm-600">
          {filterStatus && (
            <span className="mr-3">状态：<strong>{STATUS_MAP[filterStatus]?.label || filterStatus}</strong></span>
          )}
          {filterCategory ? (
            <>
              板块：<strong>{CATEGORY_LABEL_MAP[filterCategory]}</strong>
              <span className="mx-1 text-warm-400">·</span>
              共 <strong>{total}</strong> 篇
            </>
          ) : (
            <>全部投稿（共 <strong>{allTotal}</strong> 篇）</>
          )}
        </span>
        {(filterStatus || filterCategory) && (
          <button
            onClick={() => { setFilterStatus(''); setFilterCategory(''); setPage(1); }}
            className="text-xs text-primary-600 hover:text-primary-700 underline"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* 投稿网格 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-warm-400" />
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-20 text-warm-400">
          <Image className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>暂无投稿数据</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map(item => {
              const status = STATUS_MAP[item.status] || STATUS_MAP.pending;
              const StatusIcon = status.icon;
              return (
                <div key={item.id} className="card overflow-hidden">
                  <div className="relative cursor-pointer" onClick={() => setPreviewItem(item)}>
                    {item.type === 'link' ? (
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 h-44 flex flex-col items-center justify-center gap-2">
                        <Link className="w-10 h-10 text-blue-400" />
                        <span className="text-sm text-blue-600 font-medium">网盘链接</span>
                        {item.link_url && (
                          <span className="text-xs text-blue-400 truncate max-w-[180px]">{item.link_url}</span>
                        )}
                      </div>
                    ) : item.type === 'video' ? (
                      <div className="relative bg-black h-44 flex items-center justify-center">
                        <Video className="w-10 h-10 text-white/70" />
                      </div>
                    ) : (
                      <img src={item.file_url} alt={item.title} className="w-full h-44 object-cover" />
                    )}
                    <div className="absolute top-2 right-2">
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                        <StatusIcon className="w-3 h-3" />{status.label}
                      </span>
                    </div>
                  </div>
                  <div className="p-3">
                    <h4 className="font-medium text-warm-900 text-sm truncate">{item.title}</h4>
                    {item.category && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-warm-100 text-warm-500 rounded text-[11px]">
                        {CATEGORY_LABEL_MAP[item.category] || item.category}
                      </span>
                    )}
                    {item.link_url && (
                      <a href={item.link_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1 mt-1 ml-2 text-xs text-blue-600 hover:text-blue-700">
                        <ExternalLink className="w-3 h-3" />网盘链接
                      </a>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-warm-500">{item.real_name || item.username || '-'}</span>
                      <span className="text-xs text-warm-400">
                        {item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : ''}
                      </span>
                    </div>
                    {item.status === 'rejected' && item.review_comment && (
                      <p className="text-xs text-rose-500 mt-2 truncate">驳回：{item.review_comment}</p>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setPreviewItem(item)} className="btn-ghost text-xs flex items-center gap-1">
                        <Eye className="w-3 h-3" />查看
                      </button>
                      {item.status === 'pending' && (
                        <button
                          onClick={() => { setReviewingItem(item); setReviewComment(''); }}
                          className="btn-primary text-xs flex items-center gap-1"
                        >
                          <CheckCircle className="w-3 h-3" />审核
                        </button>
                      )}
                      {item.status !== 'pending' && (
                        <button
                          onClick={() => { setReviewingItem(item); setReviewComment(item.review_comment || ''); }}
                          className="btn-ghost text-xs"
                        >
                          重新审核
                        </button>
                      )}
                      <button onClick={() => handleDelete(item.id)} className="btn-ghost text-xs text-rose-500 flex items-center gap-1">
                        <Trash2 className="w-3 h-3" />删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-ghost text-sm">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-warm-500">第 {page} / {totalPages} 页</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn-ghost text-sm">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* 预览弹窗 */}
      {previewItem && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPreviewItem(null)}>
          <div className="max-w-3xl w-full max-h-[90vh] bg-white rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-warm-100">
              <div>
                <h3 className="font-semibold text-warm-900">{previewItem.title}</h3>
                <p className="text-xs text-warm-400">
                  {previewItem.real_name || previewItem.username} · {previewItem.created_at ? new Date(previewItem.created_at).toLocaleString('zh-CN') : ''}
                </p>
              </div>
              <button onClick={() => setPreviewItem(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-warm-100 text-warm-500"
              >✕</button>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              {previewItem.type === 'link' ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 bg-gradient-to-br from-blue-50 to-indigo-50">
                  <Link className="w-16 h-16 text-blue-400 mb-4" />
                  <p className="text-sm text-blue-600 font-medium mb-2">网盘链接投稿</p>
                  {previewItem.link_url ? (
                    <a href={previewItem.link_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 underline text-sm break-all max-w-full">
                      <ExternalLink className="w-4 h-4 shrink-0" />{previewItem.link_url}
                    </a>
                  ) : null}
                </div>
              ) : previewItem.type === 'video' ? (
                <video src={previewItem.file_url} controls className="w-full" />
              ) : (
                <img src={previewItem.file_url} alt={previewItem.title} className="w-full" />
              )}
            </div>
            {previewItem.description && (
              <p className="p-4 text-sm text-warm-600 border-t border-warm-100">{previewItem.description}</p>
            )}
          </div>
        </div>
      )}

      {/* 审核弹窗 */}
      {reviewingItem && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setReviewingItem(null)}>
          <div className="max-w-md w-full bg-white rounded-xl p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-warm-900 mb-4">审核投稿</h3>
            <div className="space-y-3 mb-6">
              <p className="text-sm text-warm-600">
                标题：<strong>{reviewingItem.title}</strong>
              </p>
              <p className="text-sm text-warm-500">
                投稿人：{reviewingItem.real_name || reviewingItem.username || '-'}
              </p>
              <div>
                <label className="block text-sm font-medium text-warm-600 mb-1">审核意见（驳回时填写）</label>
                <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)}
                  placeholder="请输入审核意见..." rows={3} className="input" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => handleReview(reviewingItem.id, 'approved')}
                disabled={actionLoading}
                className="btn-primary flex-1 flex items-center justify-center gap-2">
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                通过
              </button>
              <button onClick={() => handleReview(reviewingItem.id, 'rejected')}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 flex items-center justify-center gap-2">
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                驳回
              </button>
              <button onClick={() => setReviewingItem(null)} className="btn-ghost">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
