import { useState, useEffect, useCallback } from 'react';
import { Megaphone, Plus, Trash2, Pencil, Send, Undo2, Loader2, Search, RefreshCw, X, Users, Eye } from 'lucide-react';
import api from '../../api';

const EMPTY_FORM = { title: '', content: '', scope: 'all', target_areas: [] };

export default function AdminAnnouncements() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState({});

  const [areas, setAreas] = useState([]);
  const [canAll, setCanAll] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async (pageNum = 1) => {
    try {
      setLoading(true);
      setError('');
      let url = `/announcements/admin/list?page=${pageNum}&limit=20`;
      if (appliedKeyword) url += `&keyword=${encodeURIComponent(appliedKeyword)}`;
      if (status) url += `&status=${status}`;
      const res = await api.get(url);
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
  }, [appliedKeyword, status]);

  const loadAreas = useCallback(async () => {
    try {
      const res = await api.get('/announcements/admin/areas');
      setAreas(res.data?.areas || []);
      setCanAll(!!res.data?.can_all);
      if (!res.data?.can_all && res.data?.areas?.length) {
        setForm(prev => ({ ...prev, scope: prev.scope === 'all' ? 'areas' : prev.scope }));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadAreas(); }, [loadAreas]);
  useEffect(() => { loadList(1); }, [loadList]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, scope: canAll ? 'all' : 'areas' });
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      title: item.title || '',
      content: item.content || '',
      scope: item.scope || 'all',
      target_areas: Array.isArray(item.target_areas) ? item.target_areas : [],
    });
    setShowForm(true);
  };

  const toggleArea = (id) => {
    setForm(prev => {
      const has = prev.target_areas.includes(id);
      return { ...prev, target_areas: has ? prev.target_areas.filter(a => a !== id) : [...prev.target_areas, id] };
    });
  };

  const submitForm = async (publish) => {
    if (!form.title.trim()) return alert('请填写标题');
    if (!form.content.trim()) return alert('请填写内容');
    if (form.scope === 'areas' && form.target_areas.length === 0) return alert('请至少选择一个大区');
    try {
      setSaving(true);
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        scope: form.scope,
        target_areas: form.scope === 'areas' ? form.target_areas : [],
        publish,
      };
      if (editingId) await api.put(`/announcements/${editingId}`, payload);
      else await api.post('/announcements', payload);
      setShowForm(false);
      setEditingId(null);
      await loadList(editingId ? page : 1);
    } catch (err) {
      alert(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (item) => {
    const next = item.is_published ? false : true;
    setBusy(prev => ({ ...prev, [`pub_${item.id}`]: true }));
    try {
      await api.post(`/announcements/${item.id}/publish`, { published: next });
      setList(prev => prev.map(x => x.id === item.id ? { ...x, is_published: next ? 1 : 0 } : x));
    } catch (err) {
      alert(err?.message || '操作失败');
    } finally {
      setBusy(prev => ({ ...prev, [`pub_${item.id}`]: false }));
    }
  };

  const handleDelete = async (item) => {
    if (!confirm(`确定删除公告「${item.title}」吗？`)) return;
    setBusy(prev => ({ ...prev, [`del_${item.id}`]: true }));
    try {
      await api.delete(`/announcements/${item.id}`);
      setList(prev => prev.filter(x => x.id !== item.id));
      setTotal(prev => Math.max(0, prev - 1));
    } catch (err) {
      alert(err?.message || '删除失败');
    } finally {
      setBusy(prev => ({ ...prev, [`del_${item.id}`]: false }));
    }
  };

  const clearSearch = () => { setKeyword(''); setAppliedKeyword(''); setPage(1); };
  const formatTime = (ts) => (ts ? String(ts).slice(0, 16) : '-');

  const scopeLabel = (item) => {
    if (item.scope === 'all') return '全员';
    const names = (item.target_areas || []).map(id => areas.find(a => a.id === id)?.name || id);
    return names.length ? names.join('、') : '指定大区';
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h2 className="page-title mb-1">公告管理</h2>
          <p className="text-sm text-warm-400">共 {total} 条公告 · 发布后业务员登录会收到提醒</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => loadList(page)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm text-warm-600 hover:text-warm-800 hover:bg-warm-100 rounded-xl transition disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> 新建公告
          </button>
        </div>
      </div>

      {/* 筛选 */}
      <div className="flex flex-col gap-2.5 mb-4">
        <div className="flex items-center gap-2 sm:max-w-md">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setAppliedKeyword(keyword.trim()); setPage(1); } }}
              placeholder="搜索标题或内容，回车搜索"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-warm-200 bg-white focus:border-primary-400 focus:outline-none"
            />
            {keyword && (
              <button type="button" onClick={clearSearch} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600" title="清空">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={() => { setAppliedKeyword(keyword.trim()); setPage(1); }} className="btn-primary px-4 py-2 text-sm shrink-0">
            搜索
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: '', label: '全部' },
            { key: 'published', label: '已发布' },
            { key: 'draft', label: '草稿' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => { setStatus(opt.key); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition ${
                status === opt.key ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl mb-4 text-sm">
          {error}
          <button onClick={() => loadList()} className="ml-2 underline">重试</button>
        </div>
      )}

      {loading && list.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary-600" />
        </div>
      ) : list.length === 0 ? (
        <div className="card text-center py-16">
          <Megaphone size={48} className="mx-auto mb-3 text-warm-300" />
          <p className="text-warm-400">还没有公告</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {list.map(item => (
              <div key={item.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-base font-semibold text-warm-900">{item.title}</span>
                      {item.is_published === 1
                        ? <span className="badge-blue text-xs">已发布</span>
                        : <span className="px-2 py-0.5 rounded bg-warm-100 text-warm-500 text-xs">草稿</span>}
                      <span className={`text-xs px-2 py-0.5 rounded flex items-center gap-1 ${
                        item.scope === 'all' ? 'bg-emerald-50 text-emerald-600' : 'bg-primary-50 text-primary-600'
                      }`}>
                        <Users size={11} /> {scopeLabel(item)}
                      </span>
                    </div>
                    <p className="text-sm text-warm-600 whitespace-pre-wrap break-words mb-2">{item.content}</p>
                    <div className="flex items-center gap-3 text-xs text-warm-400 flex-wrap">
                      <span>{item.created_by_name || '—'}</span>
                      <span>创建 {formatTime(item.created_at)}</span>
                      {item.is_published === 1 && <span>发布 {formatTime(item.published_at)}</span>}
                      <span className="flex items-center gap-1"><Eye size={11} /> 已读 {item.read_count || 0} 人</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(item)}
                      className="p-2 rounded-lg text-warm-500 hover:bg-warm-100 hover:text-warm-800 transition"
                      title="编辑"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => togglePublish(item)}
                      disabled={busy[`pub_${item.id}`]}
                      className={`p-2 rounded-lg transition ${
                        item.is_published
                          ? 'text-amber-600 hover:bg-amber-50'
                          : 'text-emerald-600 hover:bg-emerald-50'
                      } disabled:opacity-50`}
                      title={item.is_published ? '撤回' : '发布'}
                    >
                      {item.is_published ? <Undo2 size={15} /> : <Send size={15} />}
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      disabled={busy[`del_${item.id}`]}
                      className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 transition disabled:opacity-50"
                      title="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                disabled={page <= 1}
                onClick={() => loadList(page - 1)}
                className="px-3 py-1.5 text-sm rounded-lg bg-warm-100 text-warm-600 disabled:opacity-40"
              >
                上一页
              </button>
              <span className="text-sm text-warm-500">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => loadList(page + 1)}
                className="px-3 py-1.5 text-sm rounded-lg bg-warm-100 text-warm-600 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      {/* 新建 / 编辑弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => !saving && setShowForm(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[86vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-warm-100">
              <h3 className="font-semibold text-warm-900">{editingId ? '编辑公告' : '新建公告'}</h3>
              <button onClick={() => !saving && setShowForm(false)} className="text-warm-400 hover:text-warm-700">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1.5">标题</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="如：10 月终端陈列专项活动通知"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-warm-200 focus:border-primary-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1.5">内容</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={6}
                  placeholder="填写公告正文，换行会原样展示"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-warm-200 focus:border-primary-400 focus:outline-none resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1.5">发送范围</label>
                <div className="flex items-center gap-2 mb-2">
                  {canAll && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, scope: 'all' })}
                      className={`px-3 py-1.5 rounded-full text-xs transition ${
                        form.scope === 'all' ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
                      }`}
                    >
                      全员
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, scope: 'areas' })}
                    className={`px-3 py-1.5 rounded-full text-xs transition ${
                      form.scope === 'areas' ? 'bg-primary-500 text-white' : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
                    }`}
                  >
                    指定大区
                  </button>
                </div>
                {form.scope === 'areas' && (
                  <div className="flex flex-wrap gap-2">
                    {areas.length === 0 ? (
                      <span className="text-xs text-warm-400">暂无可选大区</span>
                    ) : areas.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleArea(a.id)}
                        className={`px-3 py-1.5 rounded-full text-xs transition ${
                          form.target_areas.includes(a.id)
                            ? 'bg-primary-500 text-white'
                            : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
                        }`}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-warm-100">
              <button
                onClick={() => submitForm(false)}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-xl bg-warm-100 text-warm-600 hover:bg-warm-200 disabled:opacity-50"
              >
                存为草稿
              </button>
              <button onClick={() => submitForm(true)} disabled={saving} className="btn-primary min-w-24 disabled:opacity-50">
                {saving ? '保存中...' : '发布'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
