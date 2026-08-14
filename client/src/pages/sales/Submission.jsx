import { useState, useEffect, useRef } from 'react';
import { Upload, Image, Video, Trash2, Loader2, CheckCircle, Clock, XCircle, Eye, Plus, AlertCircle, Link, ExternalLink, Briefcase, TrendingUp, ShieldAlert, Users, MoreHorizontal, MonitorSmartphone } from 'lucide-react';
import api from '../../api';

const CATEGORIES = [
  { key: 'sales_negotiation', label: '进货谈单实战', desc: '谈卖进、应对老板拒绝的实战经验', icon: Briefcase, color: 'from-amber-50 to-orange-50 border-amber-200 hover:border-amber-300', activeColor: 'border-amber-500 bg-amber-50', iconBg: 'bg-amber-100 text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  { key: 'store_sales', label: '门店动销实操', desc: '提升门店电池销量的落地方法', icon: TrendingUp, color: 'from-emerald-50 to-teal-50 border-emerald-200 hover:border-emerald-300', activeColor: 'border-emerald-500 bg-emerald-50', iconBg: 'bg-emerald-100 text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'store_issues', label: '门店难点处理', desc: '棘手门店问题的处理经验', icon: ShieldAlert, color: 'from-rose-50 to-red-50 border-rose-200 hover:border-rose-300', activeColor: 'border-rose-500 bg-rose-50', iconBg: 'bg-rose-100 text-rose-700', badge: 'bg-rose-100 text-rose-700' },
  { key: 'customer_acquisition', label: '终端拓客秘籍', desc: '客户开发与日常维护的工作经验', icon: Users, color: 'from-blue-50 to-indigo-50 border-blue-200 hover:border-blue-300', activeColor: 'border-blue-500 bg-blue-50', iconBg: 'bg-blue-100 text-blue-700', badge: 'bg-blue-100 text-blue-700' },
  { key: 'ai_tools', label: '数智工具赋能', desc: 'AI数字化平台实操与效能提升指引', icon: MonitorSmartphone, color: 'from-cyan-50 to-sky-50 border-cyan-200 hover:border-cyan-300', activeColor: 'border-cyan-500 bg-cyan-50', iconBg: 'bg-cyan-100 text-cyan-700', badge: 'bg-cyan-100 text-cyan-700' },
  { key: 'other', label: '其他经验分享', desc: '以上分类未覆盖的实战干货', icon: MoreHorizontal, color: 'from-purple-50 to-violet-50 border-purple-200 hover:border-purple-300', activeColor: 'border-purple-500 bg-purple-50', iconBg: 'bg-purple-100 text-purple-700', badge: 'bg-purple-100 text-purple-700' },
];

const CATEGORY_LABEL_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));

const STATUS_MAP = {
  pending: { label: '审核中', icon: Clock, className: 'text-amber-600 bg-amber-50' },
  approved: { label: '已通过', icon: CheckCircle, className: 'text-emerald-600 bg-emerald-50' },
  rejected: { label: '已驳回', icon: XCircle, className: 'text-rose-600 bg-rose-50' },
};

export default function Submission() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [catStats, setCatStats] = useState({});
  const [myTotal, setMyTotal] = useState(0);
  const [activeCategory, setActiveCategory] = useState(''); // '' = all
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('sales_negotiation');
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [fileType, setFileType] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [previewItem, setPreviewItem] = useState(null);
  const fileRef = useRef(null);

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (activeCategory) params.category = activeCategory;
      const res = await api.get('/submissions/my', { params });
      const data = res?.data || res;
      setSubmissions(data?.list || []);
      setTotal(data?.total || 0);
      setCatStats(data?.stats || {});
      setMyTotal(data?.myTotal || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSubmissions(); }, [page, activeCategory]);

  const handleTabClick = (catKey) => {
    setActiveCategory(catKey === activeCategory ? '' : catKey);
    setPage(1);
  };

  const handleOpenForm = () => {
    if (activeCategory) setCategory(activeCategory);
    setShowForm(true);
    setError('');
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
    setFile(f);
    setFileType(isVideo ? 'video' : 'image');
    if (isVideo) {
      setFilePreview(URL.createObjectURL(f));
    } else {
      const reader = new FileReader();
      reader.onload = () => setFilePreview(reader.result);
      reader.readAsDataURL(f);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return setError('请输入标题');
    if (!file && !linkUrl.trim()) return setError('请上传文件或填写网盘链接');
    setError('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('description', description.trim());
      formData.append('category', category);
      if (linkUrl.trim()) formData.append('link_url', linkUrl.trim());
      if (file) formData.append('file', file);
      await api.post('/submissions', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setShowForm(false);
      setTitle('');
      setDescription('');
      setCategory('sales_negotiation');
      setFile(null);
      setFilePreview(null);
      setLinkUrl('');
      setPage(1);
      fetchSubmissions();
    } catch (e) {
      setError(e.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确定删除这条投稿吗？')) return;
    try {
      await api.delete(`/submissions/${id}`);
      fetchSubmissions();
    } catch (e) {}
  };

  const totalPages = Math.ceil(total / 10);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-warm-900">风采投稿</h2>
          <p className="text-sm text-warm-500 mt-1">选择板块浏览投稿，或发布你的实战经验（通过审核可获积分奖励）</p>
        </div>
        <button
          onClick={handleOpenForm}
          className="btn-primary flex items-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" />发布投稿
        </button>
      </div>

      {/* 五大板块卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {CATEGORIES.map(cat => {
          const CatIcon = cat.icon;
          const count = catStats[cat.key] || 0;
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => handleTabClick(cat.key)}
              className={`relative flex flex-col items-center text-center p-4 rounded-xl border-2 bg-gradient-to-br transition-all duration-200 cursor-pointer
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

      {/* 已选板块提示 + 总数 */}
      <div className="flex items-center gap-2 mb-4">
        {activeCategory ? (
          <>
            <span className="text-sm text-warm-600">
              当前板块：<strong>{CATEGORY_LABEL_MAP[activeCategory]}</strong>
            </span>
            <button
              onClick={() => { setActiveCategory(''); setPage(1); }}
              className="text-xs text-primary-600 hover:text-primary-700 underline"
            >
              查看全部
            </button>
          </>
        ) : (
          <span className="text-sm text-warm-600">
            全部投稿（共 <strong>{myTotal}</strong> 篇）
          </span>
        )}
      </div>

      {/* 投稿表单 */}
      {showForm && (
        <div className="card mb-6">
          <div className="p-4 space-y-4">
            <h3 className="font-semibold text-warm-800">
              发布新投稿
              {activeCategory && (
                <span className="ml-2 text-sm font-normal text-primary-600">
                  — 当前板块：{CATEGORY_LABEL_MAP[activeCategory]}
                </span>
              )}
            </h3>
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-1">标题 *</label>
              <input
                type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="给你的风采作品取个名字" maxLength={100}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-1">描述</label>
              <textarea
                value={description} onChange={e => setDescription(e.target.value)}
                placeholder="介绍一下这张图/视频背后的故事..." rows={3} maxLength={500}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-2">发布到板块</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {CATEGORIES.map(cat => {
                  const CatIcon = cat.icon;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setCategory(cat.key)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs transition ${
                        category === cat.key
                          ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
                          : 'border-warm-200 text-warm-500 hover:border-warm-300'
                      }`}
                    >
                      <CatIcon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-1">选择文件（图片/视频）</label>
              <input type="file" ref={fileRef} onChange={handleFileChange}
                accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
                className="hidden" />
              <button
                type="button" onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-warm-300 rounded-lg text-warm-500 hover:border-primary-400 hover:text-primary-600 transition w-full justify-center"
              >
                <Upload className="w-5 h-5" />{file ? '更换文件' : '点击选择文件'}
              </button>
              {file && <p className="text-xs text-warm-400 mt-1">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-1">
                网盘链接 <span className="text-warm-400 font-normal">（如果内容文件比较大，请上传网盘链接）</span>
              </label>
              <input
                type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
                placeholder="请粘贴百度网盘/阿里云盘等分享链接" maxLength={500}
                className="input"
              />
            </div>
            {filePreview && (
              <div className="rounded-lg overflow-hidden border border-warm-200">
                {fileType === 'video' ? (
                  <video src={filePreview} controls className="w-full max-h-64 object-contain bg-black" />
                ) : (
                  <img src={filePreview} alt="预览" className="w-full max-h-64 object-contain bg-warm-50" />
                )}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded">
                <AlertCircle className="w-4 h-4" />{error}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={uploading} className="btn-primary flex-1 flex items-center justify-center gap-2">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{uploading ? '上传中...' : '提交审核'}
              </button>
              <button onClick={() => { setShowForm(false); setError(''); }} className="btn-ghost">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 投稿列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-warm-400" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-16 text-warm-400">
          <Image className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{activeCategory ? `"${CATEGORY_LABEL_MAP[activeCategory]}" 板块暂无投稿` : '还没有投稿'}</p>
          <button onClick={handleOpenForm} className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium">
            去发布第一篇 →
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map(item => {
            const status = STATUS_MAP[item.status] || STATUS_MAP.pending;
            const StatusIcon = status.icon;
            return (
              <div key={item.id} className="card overflow-hidden">
                <div className="relative cursor-pointer" onClick={() => setPreviewItem(item)}>
                  {item.type === 'link' ? (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 h-48 flex flex-col items-center justify-center gap-2">
                      <Link className="w-10 h-10 text-blue-400" />
                      <span className="text-sm text-blue-600 font-medium">网盘链接</span>
                      {item.link_url && (
                        <span className="text-xs text-blue-400 truncate max-w-[200px]">{item.link_url}</span>
                      )}
                    </div>
                  ) : item.type === 'video' ? (
                    <div className="relative bg-black">
                      <video src={item.file_url} className="w-full max-h-48 object-contain" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                          <Video className="w-6 h-6 text-white" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <img src={item.file_url} alt={item.title} className="w-full h-48 object-cover" />
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-warm-900 truncate">{item.title}</h4>
                        {item.category && (
                          <span className="px-2 py-0.5 bg-warm-100 text-warm-500 rounded text-[11px] shrink-0">
                            {CATEGORY_LABEL_MAP[item.category] || item.category}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-sm text-warm-500 mt-1 line-clamp-2">{item.description}</p>
                      )}
                      {item.link_url && (
                        <a href={item.link_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-blue-600 hover:text-blue-700">
                          <ExternalLink className="w-3 h-3" />网盘链接
                        </a>
                      )}
                      <p className="text-xs text-warm-400 mt-2">
                        {item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : ''}
                      </p>
                    </div>
                    <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium shrink-0 ${status.className}`}>
                      <StatusIcon className="w-3 h-3" />{status.label}
                    </span>
                  </div>
                  {item.status === 'rejected' && item.review_comment && (
                    <p className="text-xs text-rose-500 mt-2 bg-rose-50 px-2 py-1 rounded">驳回原因：{item.review_comment}</p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setPreviewItem(item)} className="btn-ghost text-xs flex items-center gap-1">
                      <Eye className="w-3 h-3" />查看
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="btn-ghost text-xs text-rose-500 flex items-center gap-1">
                      <Trash2 className="w-3 h-3" />删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-ghost text-sm">上一页</button>
              <span className="text-sm text-warm-500">{page}/{totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn-ghost text-sm">下一页</button>
            </div>
          )}
        </div>
      )}

      {/* 预览弹窗 */}
      {previewItem && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPreviewItem(null)}>
          <div className="max-w-3xl w-full max-h-[90vh] bg-white rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-warm-100">
              <h3 className="font-semibold text-warm-900">{previewItem.title}</h3>
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
    </div>
  );
}
