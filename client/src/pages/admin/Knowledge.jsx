import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Edit3, Trash2, ChevronRight, ChevronDown, FolderOpen,
  FileText, RotateCcw, ThumbsUp, ThumbsDown, Minus, X, Upload,
} from 'lucide-react';
import api from '../../api';

/* ======================= 分类树节点 ======================= */
function CategoryTreeNode({ node, selectedId, onSelect, onEdit, onDelete, level = 0 }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 rounded cursor-pointer text-sm transition group hover:bg-warm-100 ${
          selectedId === node.id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-warm-700'
        }`}
        style={{ paddingLeft: 12 + level * 16 }}
        onClick={() => onSelect(node)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="p-0.5 shrink-0"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <FolderOpen size={14} className="shrink-0 text-accent-500" />
        <span className="flex-1 truncate">{node.name}</span>
        <span className="text-xs text-warm-400">({node.doc_count ?? 0})</span>
        <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
          <button onClick={(e) => { e.stopPropagation(); onEdit(node); }} className="p-0.5 hover:text-sky-600">
            <Edit3 size={12} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(node); }} className="p-0.5 hover:text-rose-600">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {expanded && node.children?.map((child) => (
        <CategoryTreeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} level={level + 1} />
      ))}
    </div>
  );
}

/* ======================= 文档版本历史 ======================= */
function VersionHistory({ docId, onClose, onRollback }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/knowledge/documents/${docId}/versions`);
        if (cancelled) return;
        const data = res?.data || res;
        const vers = Array.isArray(data) ? data : (data?.list || []);
        setVersions(vers);
      } catch (err) {
        if (!cancelled) console.error('获取版本历史失败:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  if (loading) {
    return <div className="text-center py-4 text-sm text-warm-400">加载中...</div>;
  }

  return (
    <div className="bg-warm-50/80 rounded-xl p-4 mt-2 border">
      <div className="flex items-center justify-between mb-3">
        <h5 className="text-sm font-semibold text-warm-700">版本历史</h5>
        <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={14} /></button>
      </div>
      {versions.length === 0 ? (
        <div className="text-xs text-warm-400 text-center py-4">暂无版本记录</div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {versions.map((v) => (
            <div key={v.id || v.version} className="flex items-center justify-between bg-white rounded p-2 border text-xs">
              <div>
                <span className="font-medium">v{v.version}</span>
                <span className="text-warm-400 ml-2">{v.created_at}</span>
                {v.is_current && <span className="badge-green ml-2">当前</span>}
              </div>
              {!v.is_current && (
                <button
                  onClick={() => onRollback(docId, v.id)}
                  className="text-primary-600 hover:text-primary-800 flex items-center gap-1"
                >
                  <RotateCcw size={12} /> 回滚
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ======================= 主页面 ======================= */
export default function Knowledge() {
  // ---- 分类 ----
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', parent_id: '' });
  const [catEditingId, setCatEditingId] = useState(null);

  // ---- 文档 ----
  const [documents, setDocuments] = useState([]);
  const [docSearch, setDocSearch] = useState('');
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docForm, setDocForm] = useState({ title: '', content: '', category_id: '' });
  const [docEditingId, setDocEditingId] = useState(null);
  const [expandedDocId, setExpandedDocId] = useState(null);

  // ---- 通用 ----
  const [loading, setLoading] = useState({ cats: false, docs: false });

  // ---- 批量导入 ----
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [csvAllData, setCsvAllData] = useState([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null); // { current, total }

  /* ================= 数据加载 ================= */
  const fetchCategories = useCallback(async () => {
    setLoading((p) => ({ ...p, cats: true }));
    try {
      const res = await api.get('/knowledge/categories');
      const data = res?.data || res;
      const cats = Array.isArray(data) ? data : (data?.list || []);
      setCategories(cats);
    } catch (err) {
      console.error('获取分类失败:', err);
    } finally {
      setLoading((p) => ({ ...p, cats: false }));
    }
  }, []);

  const fetchDocuments = useCallback(async (categoryId, keyword) => {
    setLoading((p) => ({ ...p, docs: true }));
    try {
      let res;
      if (keyword) {
        res = await api.post('/knowledge/search', { keyword, category_id: categoryId || undefined });
      } else {
        res = await api.get('/knowledge/documents', { params: { category_id: categoryId || undefined } });
      }
      // 后端返回 {code:0, data:{total, list}} -> axios interceptor return res.data
      const data = res?.data || res;
      const docs = Array.isArray(data) ? data : (data?.list || []);
      setDocuments(docs);
    } catch (err) {
      console.error('获取文档失败:', err);
    } finally {
      setLoading((p) => ({ ...p, docs: false }));
    }
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => { fetchDocuments(selectedCategory?.id, docSearch); }, [selectedCategory, docSearch, fetchDocuments]);

  /* ================= 分类操作 ================= */
  const openAddCat = (parentId = '') => {
    setCatEditingId(null);
    setCatForm({ name: '', parent_id: parentId });
    setCatModalOpen(true);
  };
  const openEditCat = (node) => {
    setCatEditingId(node.id);
    setCatForm({ name: node.name, parent_id: node.parent_id || '' });
    setCatModalOpen(true);
  };
  const saveCat = async () => {
    if (!catForm.name.trim()) return;
    try {
      if (catEditingId) {
        await api.put(`/knowledge/categories/${catEditingId}`, catForm);
      } else {
        await api.post('/knowledge/categories', catForm);
      }
      setCatModalOpen(false);
      fetchCategories();
    } catch (err) {
      console.error('保存分类失败:', err);
    }
  };
  const deleteCat = async (node) => {
    if (!window.confirm(`确定删除分类「${node.name}」？`)) return;
    try {
      await api.delete(`/knowledge/categories/${node.id}`);
      if (selectedCategory?.id === node.id) setSelectedCategory(null);
      fetchCategories();
    } catch (err) {
      console.error('删除分类失败:', err);
    }
  };

  /* ================= 文档操作 ================= */
  const openAddDoc = () => {
    setDocEditingId(null);
    setDocForm({ title: '', content: '', category_id: selectedCategory?.id || '' });
    setDocModalOpen(true);
  };
  const openEditDoc = (doc) => {
    setDocEditingId(doc.id);
    setDocForm({ title: doc.title, content: doc.content, category_id: doc.category_id || '' });
    setDocModalOpen(true);
  };
  const saveDoc = async () => {
    if (!docForm.title.trim()) return;
    try {
      if (docEditingId) {
        await api.put(`/knowledge/documents/${docEditingId}`, docForm);
      } else {
        await api.post('/knowledge/documents', docForm);
      }
      setDocModalOpen(false);
      fetchDocuments(selectedCategory?.id, docSearch);
    } catch (err) {
      console.error('保存文档失败:', err);
    }
  };
  const deleteDoc = async (doc) => {
    if (!window.confirm(`确定删除文档「${doc.title}」？`)) return;
    try {
      await api.delete(`/knowledge/documents/${doc.id}`);
      fetchDocuments(selectedCategory?.id, docSearch);
    } catch (err) {
      console.error('删除文档失败:', err);
    }
  };
  const rollbackVersion = async (docId, versionId) => {
    if (!window.confirm(`确定回滚到该版本？`)) return;
    try {
      await api.post(`/knowledge/documents/${docId}/rollback/${versionId}`);
      setExpandedDocId(null);
      fetchDocuments(selectedCategory?.id, docSearch);
    } catch (err) {
      console.error('版本回滚失败:', err);
    }
  };

  /* ================= 批量导入 ================= */
  const downloadTemplate = () => {
    // 下载静态模板文件（含完整字段示例）
    const link = document.createElement('a');
    link.href = '/templates/knowledge_template.csv';
    link.download = '知识库导入模板.csv';
    link.click();
  };

  // Excel 文件上传处理
  const handleExcelFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setImporting(true);
    setImportProgress({ current: 0, total: 1 });
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await api.post('/knowledge/import-excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      const data = res?.data || res;
      alert(`导入成功！文件：${data?.data?.category || file.name}\n共导入 ${data?.data?.inserted || 0} 条记录`);
      
      // 刷新列表
      fetchCategories();
      fetchDocuments(selectedCategory?.id, docSearch);
    } catch (err) {
      console.error('Excel导入失败:', err);
      const msg = err?.response?.data?.message || err?.message || '导入失败';
      alert('导入失败: ' + msg);
    } finally {
      setImporting(false);
      setImportProgress(null);
      e.target.value = ''; // 清空文件选择
    }
  };

  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  // 完整 CSV 解析：支持字段内换行、引号转义（""）
  const parseCSV = (text) => {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(field.trim());
          field = '';
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(field.trim());
          if (row.some((c) => c !== '')) rows.push(row);
          row = [];
          field = '';
        } else {
          field += ch;
        }
      }
    }
    // 最后一行
    if (field !== '' || row.length > 0) {
      row.push(field.trim());
      if (row.some((c) => c !== '')) rows.push(row);
    }
    return rows;
  };

  const handleCSVFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const rows = parseCSV(text);
      if (rows.length < 2) {
        setCsvAllData([]);
        return;
      }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const dataRows = rows.slice(1);
      const result = [];
      for (const values of dataRows) {
        const row = {};
        header.forEach((h, idx) => {
          row[h] = (values[idx] || '').replace(/^"(.*)"$/, '$1');
        });
        // 支持 title 或 标题 字段
        const title = row['title'] || row['标题'];
        if (title) {
          result.push({
            title,
            content: row['content'] || row['内容'] || '',
            category: row['category'] || row['分类'] || '',
          });
        }
      }
      setCsvAllData(result);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleBatchImport = async () => {
    if (csvAllData.length === 0) return;
    setImporting(true);
    setImportProgress({ current: 0, total: csvAllData.length });

    let currentCategories = categories;
    if (currentCategories.length === 0) {
      try {
        const res = await api.get('/knowledge/categories');
        const data = res?.data || res;
        currentCategories = Array.isArray(data) ? data : (data?.list || []);
      } catch (err) {
        console.error('获取分类失败:', err);
      }
    }

    // Flatten category tree to get all name→id mappings
    const categoryMap = new Map();
    const flattenCats = (cats) => {
      cats.forEach((c) => {
        categoryMap.set(c.name, c.id);
        if (c.children) flattenCats(c.children);
      });
    };
    flattenCats(currentCategories);

    let successCount = 0;
    for (let i = 0; i < csvAllData.length; i++) {
      const row = csvAllData[i];
      let categoryId = '';

      if (row['category']) {
        if (categoryMap.has(row['category'])) {
          categoryId = categoryMap.get(row['category']);
        } else {
          try {
            const catRes = await api.post('/knowledge/categories', { name: row['category'], parent_id: '' });
            const catData = catRes?.data || catRes;
            const newCatId = catData?.id;
            if (newCatId) {
              categoryId = newCatId;
              categoryMap.set(row['category'], newCatId);
            }
          } catch (err) {
            console.error(`创建分类「${row['category']}」失败:`, err);
            setImportProgress({ current: i + 1, total: csvAllData.length });
            continue;
          }
        }
      }

      try {
        await api.post('/knowledge/documents', {
          title: row['title'] || '',
          content: row['content'] || '',
          category_id: categoryId,
        });
        successCount++;
      } catch (err) {
        console.error(`导入文档「${row['title']}」失败:`, err);
      }
      setImportProgress({ current: i + 1, total: csvAllData.length });
    }

    setImporting(false);
    setImportProgress(null);
    alert(`导入完成！成功导入 ${successCount} / ${csvAllData.length} 篇文档`);
    setBatchImportOpen(false);
    setCsvAllData([]);
    setCsvFileName('');
    fetchCategories();
    fetchDocuments(selectedCategory?.id, docSearch);
  };

  /* ================= 渲染 ================= */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">知识库管理</h1>
      </div>

      {/* ========== 文档管理 ========== */}
      <div className="flex gap-4 h-[calc(100vh-180px)] min-h-[500px]">
          {/* 左侧分类树 */}
          <div className="w-56 shrink-0 card overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-warm-700">分类目录</h3>
              <button onClick={() => openAddCat()} className="text-primary-600 hover:text-primary-800" title="新增分类">
                <Plus size={16} />
              </button>
            </div>
            <div className="space-y-0.5">
              {categories.map((node) => (
                <CategoryTreeNode
                  key={node.id}
                  node={node}
                  selectedId={selectedCategory?.id}
                  onSelect={(n) => setSelectedCategory(selectedCategory?.id === n.id ? null : n)}
                  onEdit={openEditCat}
                  onDelete={deleteCat}
                />
              ))}
              {categories.length === 0 && (
                <div className="text-xs text-warm-400 text-center py-6">暂无分类，点击 + 添加</div>
              )}
            </div>
          </div>

          {/* 右侧文档列表 */}
          <div className="flex-1 card flex flex-col min-w-0">
            {/* 搜索 + 操作栏 */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
                <input
                  className="input pl-9"
                  placeholder="搜索文档..."
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                />
              </div>
              <div className="flex-1" />
              <button onClick={openAddDoc} className="btn-primary flex items-center gap-1.5 text-sm">
                <Plus size={16} /> 新建文档
              </button>
              <button onClick={() => setBatchImportOpen(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
                <Upload size={16} /> 批量导入
              </button>
            </div>

            {/* 文档表格 */}
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    <th className="table-header">标题</th>
                    <th className="table-header w-24">分类</th>
                    <th className="table-header w-32">更新时间</th>
                    <th className="table-header w-32">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-100">
                  {documents.map((doc) => (
                    <>
                      <tr key={doc.id} className="hover:bg-warm-50/80">
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <FileText size={14} className="text-warm-400 shrink-0" />
                            <span className="font-medium text-warm-900">{doc.title}</span>
                          </div>
                        </td>
                        <td className="table-cell text-warm-500">{doc.category_name || '-'}</td>
                        <td className="table-cell text-warm-500 text-xs">{doc.updated_at || doc.created_at}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-1">
                            <button onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-primary-600" title="版本管理">
                              <RotateCcw size={14} />
                            </button>
                            <button onClick={() => openEditDoc(doc)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-sky-600" title="编辑">
                              <Edit3 size={14} />
                            </button>
                            <button onClick={() => deleteDoc(doc)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-rose-600" title="删除">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedDocId === doc.id && (
                        <tr key={`version-${doc.id}`}>
                          <td colSpan={4} className="px-4 pb-3">
                            <VersionHistory docId={doc.id} onClose={() => setExpandedDocId(null)} onRollback={rollbackVersion} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {!loading.docs && documents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-12 text-sm text-warm-400">
                        {selectedCategory ? '该分类下暂无文档' : '暂无文档'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      {/* ========== 分类弹窗 ========== */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCatModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{catEditingId ? '编辑分类' : '新增分类'}</h3>
              <button onClick={() => setCatModalOpen(false)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">分类名称</label>
                <input className="input" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="输入分类名称" />
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">上级分类</label>
                <select className="input" value={catForm.parent_id} onChange={(e) => setCatForm({ ...catForm, parent_id: e.target.value })}>
                  <option value="">无（顶级分类）</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setCatModalOpen(false)} className="btn-secondary">取消</button>
                <button onClick={saveCat} className="btn-primary">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== 文档弹窗 ========== */}
      {docModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDocModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{docEditingId ? '编辑文档' : '新建文档'}</h3>
              <button onClick={() => setDocModalOpen(false)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">标题</label>
                <input className="input" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} placeholder="输入文档标题" />
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">所属分类</label>
                <select className="input" value={docForm.category_id} onChange={(e) => setDocForm({ ...docForm, category_id: e.target.value })}>
                  <option value="">未分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">内容</label>
                <textarea className="input min-h-[200px] resize-y" value={docForm.content} onChange={(e) => setDocForm({ ...docForm, content: e.target.value })} placeholder="输入文档内容（支持 Markdown）" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setDocModalOpen(false)} className="btn-secondary">取消</button>
                <button onClick={saveDoc} className="btn-primary">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== 批量导入弹窗 ========== */}
      {batchImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!importing) { setBatchImportOpen(false); setCsvAllData([]); setCsvFileName(''); setImportProgress(null); } }}>
          <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-3xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">批量导入知识库</h3>
              <button onClick={() => { if (!importing) { setBatchImportOpen(false); setCsvAllData([]); setCsvFileName(''); setImportProgress(null); } }} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              {/* Excel 导入 */}
              <div className="bg-primary-50/50 border border-primary-100 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-primary-700 mb-2">推荐：Excel 智能导入</h4>
                <p className="text-xs text-primary-600 mb-3">
                  上传 Excel 文件（.xlsx），系统自动解析表头并智能提取内容。支持多种格式：
                  <span className="font-medium">话术三板斧、品类卖点速查表、销售实战方法论、DSR难题百问</span> 等。
                </p>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleExcelFile}
                  disabled={importing}
                  className="block w-full text-sm text-warm-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-primary-100 file:text-primary-700 hover:file:bg-primary-200"
                />
              </div>

              <div className="flex items-center gap-3 text-xs text-warm-400">
                <div className="flex-1 h-px bg-warm-200" />
                <span>或者使用 CSV 手动导入</span>
                <div className="flex-1 h-px bg-warm-200" />
              </div>

              {/* CSV 导入 */}
              <>
                {/* 下载模板 */}
                <div className="flex items-center gap-3">
                  <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-1.5 text-sm">
                    <FileText size={14} /> 下载CSV模板
                  </button>
                  <span className="text-xs text-warm-400">下载 CSV 模板文件，按格式填写后上传</span>
                </div>

                {/* CSV 文件上传 */}
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">选择 CSV 文件</label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCSVFile}
                    disabled={importing}
                    className="block w-full text-sm text-warm-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-warm-50 file:text-warm-700 hover:file:bg-warm-100"
                  />
                  {csvFileName && <p className="text-xs text-warm-500 mt-1">已选择: {csvFileName}（共 {csvAllData.length} 条数据）</p>}
                </div>
              </>

              {/* 预览表格 */}
              {csvAllData.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-warm-700 mb-2">数据预览（前 5 行）</h4>
                  <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-warm-50/80">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">#</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">title</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">category</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">content</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-warm-100">
                        {csvAllData.slice(0, 5).map((row, idx) => (
                          <tr key={idx} className="hover:bg-warm-50/80">
                            <td className="px-3 py-2 text-warm-400">{idx + 1}</td>
                            <td className="px-3 py-2 text-warm-800 max-w-[160px] truncate" title={row['title']}>{row['title'] || '-'}</td>
                            <td className="px-3 py-2 text-warm-600">{row['category'] || '-'}</td>
                            <td className="px-3 py-2 text-warm-600 max-w-[240px] truncate" title={row['content']}>{row['content']?.slice(0, 50) || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 导入进度 */}
              {importing && importProgress && (
                <div className="bg-sky-50 border border-blue-200 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-sky-700 font-medium">
                      正在导入 {importProgress.current} / {importProgress.total}...
                    </span>
                    <span className="text-xs text-sky-500">
                      {Math.round((importProgress.current / importProgress.total) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div
                      className="bg-sky-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* CSV 导入按钮 */}
              {csvAllData.length > 0 && (
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    onClick={() => { setBatchImportOpen(false); setCsvAllData([]); setCsvFileName(''); setImportProgress(null); }}
                    className="btn-secondary"
                    disabled={importing}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleBatchImport}
                    className="btn-primary flex items-center gap-1.5"
                    disabled={csvAllData.length === 0 || importing}
                  >
                    <Upload size={16} /> 导入 CSV
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
