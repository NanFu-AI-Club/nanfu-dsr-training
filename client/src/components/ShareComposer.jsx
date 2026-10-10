import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ImagePlus, X, Loader2, Send } from 'lucide-react';
import api from '../api';

/**
 * 全屏发布页（模仿微信朋友圈发布体验）
 * onClose: 关闭发布页
 * onPublished: (newShare, pointToast) => void 发布成功回调
 */
export default function ShareComposer({ onClose, onPublished }) {
  const [content, setContent] = useState('');
  const [settings, setSettings] = useState({ min_length: 0, blocked_keywords: '' });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get('/shares/settings').then((res) => setSettings(res.data || {})).catch(() => {});
  }, []);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + selectedFiles.length > 9) {
      setError('最多上传9张图片');
      return;
    }
    const newPreviews = files.map((f) => ({
      url: URL.createObjectURL(f),
      file: f,
    }));
    setSelectedFiles((prev) => [...prev, ...files]);
    setPreviews((prev) => [...prev, ...newPreviews]);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (idx) => {
    if (previews[idx]?.url) URL.revokeObjectURL(previews[idx].url);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handlePost = async () => {
    if (!content.trim() && selectedFiles.length === 0) return;
    if (settings.min_length > 0 && content.trim().length < settings.min_length) {
      setError(`分享内容至少需要 ${settings.min_length} 个字`);
      return;
    }
    try {
      setPosting(true);
      setError('');
      const formData = new FormData();
      formData.append('content', content.trim());
      selectedFiles.forEach((f) => formData.append('images', f));

      const res = await api.post('/shares', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const newShare = {
        ...res.data,
        images: typeof res.data.images === 'string' ? JSON.parse(res.data.images) : (res.data.images || []),
      };

      const earned = res.data?.earned_points || 0;
      const dailyEarned = res.data?.daily_earned ?? earned;
      const dailyLimit = res.data?.daily_limit ?? 30;
      const pointToast = { earned, dailyEarned, dailyLimit };

      onPublished(newShare, pointToast);
    } catch (err) {
      setError(err?.message || '发布失败');
    } finally {
      setPosting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-white flex flex-col">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-warm-100/60 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center text-warm-700 hover:text-warm-900 transition"
        >
          <ChevronLeft size={24} />
          <span className="text-sm">返回</span>
        </button>
        <span className="text-[15px] font-semibold text-warm-900">发表分享</span>
        <span className="w-14" />
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {settings.min_length > 0 && (
          <p className="mb-2 text-xs text-warm-400">发布提醒：文字内容至少 {settings.min_length} 个字{settings.blocked_keywords ? '，请勿包含屏蔽关键词' : ''}</p>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="分享你的销售心得..."
          rows={6}
          className="w-full border-0 bg-transparent text-[15px] resize-none focus:outline-none placeholder-warm-300"
        />

        {/* 图片九宫格 */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          {previews.map((p, i) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-warm-100">
              <img src={p.url} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removeImage(i)}
                className="absolute top-1 right-1 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {previews.length < 9 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border border-dashed border-warm-200 bg-warm-50 flex items-center justify-center text-warm-400 hover:border-primary-300 hover:text-primary-500 transition"
            >
              <ImagePlus size={24} />
            </button>
          )}
        </div>

        {error && (
          <p className="mt-3 text-sm text-rose-500">{error}</p>
        )}
      </div>

      {/* 底部发布按钮 */}
      <div className="px-4 py-3 border-t border-warm-100/60 shrink-0">
        <button
          onClick={handlePost}
          disabled={posting || (!content.trim() && selectedFiles.length === 0)}
          className="w-full h-11 bg-primary-500 hover:bg-primary-600 text-white text-base font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition"
        >
          {posting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
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
    </div>,
    document.body
  );
}
