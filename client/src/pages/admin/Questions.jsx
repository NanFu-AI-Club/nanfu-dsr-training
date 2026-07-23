import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Plus, Edit3, Trash2, Upload, Download, X, PlusCircle, MinusCircle, Power, PowerOff } from 'lucide-react';
import api from '../../api';

const QUESTION_TYPES = [
  { value: '', label: '全部类型' },
  { value: 'single', label: '单选题' },
  { value: 'multiple', label: '多选题' },
  { value: 'judge', label: '判断题' },
];

const DIFFICULTY_LEVELS = [
  { value: '', label: '全部难度' },
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];

const PAGE_SIZE = 15;

const typeBadgeClass = (type) => {
  switch (type) {
    case 'single': return 'badge-blue';
    case 'multiple': return 'badge-purple bg-purple-100 text-purple-800';
    case 'judge': return 'badge-yellow';
    default: return 'badge-gray';
  }
};

const typeLabel = (type) => {
  switch (type) {
    case 'single': return '单选题';
    case 'multiple': return '多选题';
    case 'judge': return '判断题';
    default: return type;
  }
};

const difficultyBadgeClass = (level) => {
  switch (level) {
    case 'easy': return 'badge-green';
    case 'medium': return 'badge-yellow';
    case 'hard': return 'badge-red';
    default: return 'badge-gray';
  }
};

const difficultyLabel = (level) => {
  switch (level) {
    case 'easy': return '简单';
    case 'medium': return '中等';
    case 'hard': return '困难';
    default: return level;
  }
};

export default function Questions() {
  // ---- 筛选 ----
  const [filters, setFilters] = useState({ type: '', category_id: '', difficulty: '', keyword: '' });
  const [categories, setCategories] = useState([]);

  // ---- 列表 ----
  const [questions, setQuestions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // ---- 编辑弹窗 ----
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    type: 'single', category_id: '', content: '', options: ['', ''],
    answer: '', explanation: '', difficulty: 'medium', tags: '',
  });

  // ---- 批量导入弹窗 ----
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);

  /* ================= 数据加载 ================= */
  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get('/questions/categories');
      const data = res?.data || res;
      const cats = Array.isArray(data) ? data : (data?.list || []);
      setCategories(cats);
    } catch (err) { console.error('获取分类失败:', err); }
  }, []);

  const fetchQuestions = useCallback(async (currentPage) => {
    setLoading(true);
    try {
      const params = { page: currentPage, pageSize: PAGE_SIZE };
      if (filters.type) params.type = filters.type;
      if (filters.category_id) params.category = filters.category_id;
      if (filters.difficulty) params.difficulty = filters.difficulty;
      if (filters.keyword) params.keyword = filters.keyword;
      const res = await api.get('/questions', { params });
      const data = res?.data || res;
      setQuestions(data.list || data || []);
      setTotal(data.total || (data.list || data || []).length);
    } catch (err) {
      console.error('获取题目失败:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => { setPage(1); fetchQuestions(1); }, [fetchQuestions]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  /* ================= 题目 CRUD ================= */
  const openAdd = () => {
    setEditingId(null);
    setForm({ type: 'single', category_id: '', content: '', options: ['', ''], answer: '', explanation: '', difficulty: 'medium', tags: '' });
    setModalOpen(true);
  };

  const openEdit = (q) => {
    setEditingId(q.id);
    setForm({
      type: q.type || 'single',
      category_id: q.category || '',
      content: q.content || '',
      options: q.options?.length ? [...q.options] : ['', ''],
      answer: typeof q.answer === 'string' ? q.answer : (typeof q.answer === 'boolean' ? String(q.answer) : (Array.isArray(q.answer) ? q.answer.join(',') : '')),
      explanation: q.analysis || q.explanation || '',
      difficulty: q.difficulty || 'medium',
      tags: Array.isArray(q.tags) ? q.tags.join(',') : (q.tags || ''),
    });
    setModalOpen(true);
  };

  const addOption = () => {
    setForm((f) => ({ ...f, options: [...f.options, ''] }));
  };

  const removeOption = (idx) => {
    setForm((f) => ({ ...f, options: f.options.filter((_, i) => i !== idx) }));
  };

  const updateOption = (idx, value) => {
    setForm((f) => {
      const opts = [...f.options];
      opts[idx] = value;
      return { ...f, options: opts };
    });
  };

  const saveQuestion = async () => {
    if (!form.content.trim()) return;
    try {
      const payload = {
        type: form.type,
        category: form.category_id || null,  // 后端字段名为 category
        content: form.content,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        options: form.options.filter((o) => o.trim()),
        answer: form.type === 'multiple'
          ? form.answer.split(',').map((a) => a.trim()).filter(Boolean)
          : form.answer,
        analysis: form.explanation || null,  // 后端字段名为 analysis
        difficulty: form.difficulty,
      };
      if (editingId) {
        await api.put(`/questions/${editingId}`, payload);
      } else {
        await api.post('/questions', payload);
      }
      setModalOpen(false);
      fetchQuestions(page);
    } catch (err) {
      console.error('保存题目失败:', err);
    }
  };

  const deleteQuestion = async (q) => {
    if (!window.confirm(`确定删除该题目？`)) return;
    try {
      await api.delete(`/questions/${q.id}`);
      fetchQuestions(page);
    } catch (err) {
      console.error('删除题目失败:', err);
    }
  };

  const toggleStatus = async (q) => {
    const newStatus = q.status === 'active' ? 'inactive' : 'active';
    try {
      await api.put(`/questions/${q.id}`, { status: newStatus });
      fetchQuestions(page);
    } catch (err) {
      console.error('切换状态失败:', err);
    }
  };

  /* ================= 批量导入 ================= */
  // CSV 解析：处理引号包裹的字段（含逗号）
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleFileChange = (e) => {
    setImportError('');
    setImportPreview([]);
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        setImportError('CSV 文件至少需要包含表头和一行数据');
        return;
      }
      // 解析表头，建立列名→索引映射（支持中英文表头）
      const headerFields = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
      const colMap = {};
      headerFields.forEach((h, idx) => { colMap[h] = idx; });

      const dataLines = lines.slice(1);
      const parsed = [];
      for (let i = 0; i < dataLines.length; i++) {
        const fields = parseCSVLine(dataLines[i]);

        // 按模板 type,question,options,answer,score,category,difficulty,analysis,tags 取值
        const getType = () => (fields[colMap['type']] || fields[colMap['类型']] || '').trim();
        const getQuestion = () => (fields[colMap['question']] || fields[colMap['题目内容']] || fields[colMap['题目']] || '').trim();
        const getOptions = () => (fields[colMap['options']] || fields[colMap['选项']] || '').trim();
        const getAnswer = () => (fields[colMap['answer']] || fields[colMap['正确答案']] || fields[colMap['答案']] || '').trim();
        const getScore = () => (fields[colMap['score']] || fields[colMap['分值']] || '5').trim();
        const getCategory = () => (fields[colMap['category']] || fields[colMap['分类']] || '').trim();
        const getDifficulty = () => (fields[colMap['difficulty']] || fields[colMap['难度']] || 'medium').trim();
        const getAnalysis = () => (fields[colMap['analysis']] || fields[colMap['解析']] || fields[colMap['解析说明']] || '').trim();
        const getTags = () => (fields[colMap['tags']] || fields[colMap['标签']] || '').trim();

        const typeRaw = getType();
        const questionText = getQuestion();
        if (!typeRaw || !questionText) {
          continue;
        }

        parsed.push({
          type: typeRaw,
          content: questionText,
          optionsRaw: getOptions(),
          answer: getAnswer(),
          score: getScore(),
          category: getCategory(),
          difficulty: getDifficulty(),
          analysis: getAnalysis(),
          tags: getTags(),
        });
      }
      if (parsed.length === 0) {
        setImportError('未解析到有效数据，请检查 CSV 格式');
        return;
      }
      setImportPreview(parsed);
    };
    reader.onerror = () => {
      setImportError('文件读取失败，请重试');
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    // 下载静态模板文件（含完整字段示例）
    const link = document.createElement('a');
    link.href = '/templates/questions_template.csv';
    link.download = '批量导入题目模板.csv';
    link.click();
  };

  const handleCsvImport = async () => {
    if (importPreview.length === 0) return;
    setImporting(true);
    setImportError('');
    setImportProgress({ current: 0, total: importPreview.length });

    // 类型映射：支持中文和英文
    const typeMap = {
      '单选题': 'single', 'single': 'single',
      '多选题': 'multiple', 'multiple': 'multiple',
      '判断题': 'judge', 'judge': 'judge',
    };

    // 难度映射：支持中文和英文
    const difficultyMap = {
      '简单': 'easy', 'easy': 'easy',
      '中等': 'medium', 'medium': 'medium',
      '困难': 'hard', 'hard': 'hard',
    };

    // 构建批量导入数据
    const batchItems = [];
    for (let i = 0; i < importPreview.length; i++) {
      const row = importPreview[i];
      const type = typeMap[row.type?.toLowerCase()] || typeMap[row.type] || row.type;

      if (!['single', 'multiple', 'judge'].includes(type)) {
        setImportError(`第 ${i + 1} 行类型无效: ${row.type}（应为 single/multiple/judge 或 单选题/多选题/判断题）`);
        setImporting(false);
        return;
      }

      // 解析选项：用 | 分隔
      let options;
      if (type === 'judge') {
        options = ['是', '否'];
      } else {
        options = row.optionsRaw
          ? row.optionsRaw.split('|').map((o) => o.trim()).filter(Boolean)
          : [];
        if (options.length < 2) {
          setImportError(`第 ${i + 1} 行选项不足（需要至少 2 个选项，用 | 分隔）`);
          setImporting(false);
          return;
        }
      }

      // 解析答案
      let answer;
      if (type === 'single') {
        answer = row.answer;
      } else if (type === 'multiple') {
        // 支持 "A|B|D" 或 "ABD" 或 "A,B,D"
        const rawAnswer = String(row.answer || '');
        answer = rawAnswer.includes('|')
          ? rawAnswer.split('|').map((a) => a.trim()).filter(Boolean)
          : rawAnswer.includes(',')
          ? rawAnswer.split(',').map((a) => a.trim()).filter(Boolean)
          : rawAnswer.split('').filter(Boolean);
      } else { // judge
        answer = (row.answer === '是' || row.answer === '正确' || row.answer.toLowerCase() === 'true') ? 'true' : 'false';
      }

      // 解析难度
      const difficulty = difficultyMap[row.difficulty?.toLowerCase()] || difficultyMap[row.difficulty] || 'medium';

      // 解析标签
      const tags = row.tags
        ? row.tags.split('|').map((t) => t.trim()).filter(Boolean)
        : [];

      batchItems.push({
        type,
        category: row.category || null,
        content: row.content,
        options,
        answer,
        difficulty,
        analysis: row.analysis || null,
        tags,
      });

      setImportProgress({ current: i + 1, total: importPreview.length });
    }

    // 调用后端批量导入接口
    try {
      const res = await api.post('/questions/batch', batchItems);
      const result = res?.data || res;
      const success = result?.success ?? batchItems.length;
      const fail = result?.fail ?? 0;

      setImporting(false);
      setImportOpen(false);
      setImportPreview([]);
      setImportProgress({ current: 0, total: 0 });
      fetchQuestions(1);

      if (fail > 0) {
        alert(`导入完成：成功 ${success} 条，失败 ${fail} 条`);
      } else {
        alert(`导入成功！共导入 ${success} 道题目`);
      }
    } catch (err) {
      setImportError(`批量导入失败: ${err?.message || '未知错误'}`);
      setImporting(false);
    }
  };

  /* ================= 导出 ================= */
  const handleExport = async () => {
    try {
      const params = {};
      if (filters.type) params.type = filters.type;
      if (filters.category_id) params.category_id = filters.category_id;
      if (filters.difficulty) params.difficulty = filters.difficulty;
      if (filters.keyword) params.keyword = filters.keyword;

      const res = await api.get('/questions/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `题库导出_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出失败:', err);
    }
  };

  /* ================= 渲染 ================= */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">题库管理</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Upload size={16} /> 批量导入
          </button>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Download size={16} /> 导出
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={16} /> 新建题目
          </button>
        </div>
      </div>

      {/* 筛选工具栏 */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="input w-32"
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select
            className="input w-32"
            value={filters.category_id}
            onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))}
          >
            <option value="">全部分类</option>
            {categories.map((c) => (
              <option key={c.id || c.value} value={c.id || c.value}>{c.name || c.label}</option>
            ))}
          </select>
          <select
            className="input w-28"
            value={filters.difficulty}
            onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value }))}
          >
            {DIFFICULTY_LEVELS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <div className="relative flex-1 max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
            <input
              className="input pl-9"
              placeholder="搜索题目内容..."
              value={filters.keyword}
              onChange={(e) => setFilters((f) => ({ ...f, keyword: e.target.value }))}
            />
          </div>
          <div className="text-sm text-warm-400">共 {total} 道题目</div>
        </div>
      </div>

      {/* 题目列表 */}
      <div className="card overflow-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header w-16">编号</th>
              <th className="table-header w-20">类型</th>
              <th className="table-header">题目</th>
              <th className="table-header w-24">分类</th>
              <th className="table-header w-20">难度</th>
              <th className="table-header w-16">状态</th>
              <th className="table-header w-24">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-100">
            {questions.map((q, idx) => (
              <tr key={q.id} className="hover:bg-warm-50/80">
                <td className="table-cell text-warm-400 text-xs">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                <td className="table-cell">
                  <span className={typeBadgeClass(q.type)}>{typeLabel(q.type)}</span>
                </td>
                <td className="table-cell">
                  <div className="max-w-md truncate text-warm-900">{q.content}</div>
                </td>
                <td className="table-cell text-warm-500 text-sm">{q.category || q.category_name || '-'}</td>
                <td className="table-cell">
                  <span className={difficultyBadgeClass(q.difficulty)}>{difficultyLabel(q.difficulty)}</span>
                </td>
                <td className="table-cell">
                  <button
                    onClick={() => toggleStatus(q)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition ${
                      q.status === 'active'
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
                    }`}
                    title={q.status === 'active' ? '点击停用' : '点击启用'}
                  >
                    {q.status === 'active' ? <Power size={11} /> : <PowerOff size={11} />}
                    {q.status === 'active' ? '启用' : '停用'}
                  </button>
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(q)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-sky-600">
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => deleteQuestion(q)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-rose-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && questions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-sm text-warm-400">暂无题目数据</td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t mt-4">
            <span className="text-sm text-warm-500">
              第 {page}/{totalPages} 页，共 {total} 条
            </span>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => { const p = page - 1; setPage(p); fetchQuestions(p); }}
                className="btn-secondary text-sm py-1 px-3 disabled:opacity-40"
              >
                上一页
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (page <= 4) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => { setPage(pageNum); fetchQuestions(pageNum); }}
                    className={`w-8 h-8 rounded text-sm ${
                      pageNum === page ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                disabled={page >= totalPages}
                onClick={() => { const p = page + 1; setPage(p); fetchQuestions(p); }}
                className="btn-secondary text-sm py-1 px-3 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ========== 题目编辑弹窗 ========== */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editingId ? '编辑题目' : '新建题目'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              {/* 类型 + 分类 + 难度 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">类型</label>
                  <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {QUESTION_TYPES.filter((t) => t.value).map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">分类</label>
                  <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                    <option value="">未分类</option>
                    {categories.map((c) => (
                      <option key={c.id || c.value} value={c.id || c.value}>{c.name || c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">难度</label>
                  <select className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                    {DIFFICULTY_LEVELS.filter((d) => d.value).map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 题目内容 */}
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">题目内容</label>
                <textarea className="input min-h-[80px] resize-y" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="输入题目内容" />
              </div>

              {/* 选项（单选/多选） */}
              {(form.type === 'single' || form.type === 'multiple') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-warm-700">选项</label>
                    <button onClick={addOption} className="text-primary-600 hover:text-primary-800 flex items-center gap-1 text-xs">
                      <PlusCircle size={14} /> 添加选项
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.options.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-warm-400 w-6 shrink-0">{String.fromCharCode(65 + idx)}.</span>
                        <input
                          className="input flex-1"
                          value={opt}
                          onChange={(e) => updateOption(idx, e.target.value)}
                          placeholder={`选项 ${String.fromCharCode(65 + idx)}`}
                        />
                        {form.options.length > 2 && (
                          <button onClick={() => removeOption(idx)} className="text-warm-400 hover:text-rose-500 shrink-0">
                            <MinusCircle size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 正确答案 */}
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">
                  正确答案
                  {form.type === 'single' && <span className="text-warm-400 font-normal ml-1">（输入选项字母，如 A）</span>}
                  {form.type === 'multiple' && <span className="text-warm-400 font-normal ml-1">（多个用逗号分隔，如 A,C）</span>}
                  {form.type === 'judge' && <span className="text-warm-400 font-normal ml-1">（正确/错误 或 true/false）</span>}
                </label>
                <input className="input" value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} placeholder="正确答案" />
              </div>

              {/* 解析 */}
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">解析</label>
                <textarea className="input min-h-[60px] resize-y" value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} placeholder="输入答案解析（可选）" />
              </div>

              {/* 标签 */}
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">标签 <span className="text-warm-400 font-normal">（逗号分隔）</span></label>
                <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="例如: 产品知识, 销售技巧" />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setModalOpen(false)} className="btn-secondary">取消</button>
                <button onClick={saveQuestion} className="btn-primary">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== 批量导入弹窗 ========== */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!importing) { setImportOpen(false); setImportPreview([]); setImportProgress({ current: 0, total: 0 }); } }}>
          <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">批量导入题目</h3>
              <button onClick={() => { setImportOpen(false); setImportPreview([]); setImportProgress({ current: 0, total: 0 }); }} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-warm-500 mb-4">支持 CSV 格式批量导入，请先下载模板按格式填写</p>

            <div className="space-y-4">
              {/* 下载模板 */}
              <button
                onClick={handleDownloadTemplate}
                className="btn-secondary flex items-center gap-1.5 text-sm"
              >
                <Download size={16} /> 下载模板
              </button>

              {/* 上传文件 */}
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">选择 CSV 文件</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  disabled={importing}
                  className="block w-full text-sm text-warm-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50"
                />
              </div>

              {/* 预览表格 */}
              {importPreview.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-warm-700 mb-2">
                    预览（共 {importPreview.length} 条，仅显示前 5 条）
                  </p>
                  <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-warm-50/80">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">序号</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">type</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">category</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">question</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">answer</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-warm-500">score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-warm-100">
                        {importPreview.slice(0, 5).map((row, idx) => (
                          <tr key={idx} className="hover:bg-warm-50/80">
                            <td className="px-3 py-2 text-warm-400 text-xs">{idx + 1}</td>
                            <td className="px-3 py-2 text-warm-700">{row.type}</td>
                            <td className="px-3 py-2 text-warm-700">{row.category}</td>
                            <td className="px-3 py-2 text-warm-700 max-w-[200px] truncate">{row.content}</td>
                            <td className="px-3 py-2 text-warm-700">{row.answer}</td>
                            <td className="px-3 py-2 text-warm-700">{row.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 进度条 */}
              {importing && importProgress.total > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-warm-600">
                      正在导入 {importProgress.current} / {importProgress.total}...
                    </span>
                    <span className="text-sm text-warm-400">
                      {Math.round((importProgress.current / importProgress.total) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-warm-200 rounded-full h-2">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 错误信息 */}
              {importError && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">{importError}</div>}

              {/* 按钮 */}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setImportOpen(false); setImportPreview([]); setImportProgress({ current: 0, total: 0 }); }}
                  disabled={importing}
                  className="btn-secondary disabled:opacity-50"
                >
                  取消
                </button>
                {importPreview.length > 0 && !importing && (
                  <button onClick={handleCsvImport} className="btn-primary flex items-center gap-1.5">
                    <Upload size={16} /> 导入 ({importPreview.length} 条)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
