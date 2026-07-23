import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Edit3, Trash2, Eye, Send, Users as UsersIcon, X,
  ChevronUp, ChevronDown, RotateCcw, GripVertical, Clock, CheckCircle, XCircle, Check, ChevronLeft, ChevronRight,
} from 'lucide-react';
import api from '../../api';

const EXAM_STATUS = [
  { value: '', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'ongoing', label: '进行中' },
  { value: 'ended', label: '已结束' },
];

const STATUS_BADGE = {
  draft: 'badge-gray',
  published: 'badge-blue',
  ongoing: 'badge-green',
  ended: 'badge-yellow',
};

const STATUS_LABEL = {
  draft: '草稿',
  published: '已发布',
  ongoing: '进行中',
  ended: '已结束',
};

const ASSIGN_MODES = [
  { value: 'all', label: '全体人员' },
  { value: 'group', label: '按分组' },
  { value: 'user', label: '指定人员' },
];

const PAGE_SIZE = 10;

export default function Exams() {
  // ---- 筛选 ----
  const [statusFilter, setStatusFilter] = useState('');

  // ---- 考试列表 ----
  const [exams, setExams] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // ---- 考试表单弹窗 ----
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [groups, setGroups] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [selectedAssignTargets, setSelectedAssignTargets] = useState([]); // [{id, name}]
  const [examForm, setExamForm] = useState({
    title: '', description: '', duration: 60, pass_score: 60,
    start_time: '', end_time: '', assign_type: 'all', assign_ids: '',
  });

  // ---- 组卷弹窗 ----
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeExamId, setComposeExamId] = useState(null);
  const [questionBank, setQuestionBank] = useState([]);
  const [qbSearch, setQbSearch] = useState('');
  const [qbType, setQbType] = useState('');
  const [selectedQuestions, setSelectedQuestions] = useState([]);
  const [qbLoading, setQbLoading] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);

  // ---- 试卷预览展开 ----
  const [previewExamId, setPreviewExamId] = useState(null);
  const [previewQuestions, setPreviewQuestions] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ---- 考生记录弹窗 ----
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsExamId, setRecordsExamId] = useState(null);
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  /* ================= 数据加载 ================= */
  const fetchExams = useCallback(async (currentPage) => {
    setLoading(true);
    try {
      const params = { page: currentPage, pageSize: PAGE_SIZE };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/exams', { params });
      const data = res?.data || res;
      setExams(data?.list || data || []);
      setTotal(data?.total || (data?.list || data)?.length || 0);
    } catch (err) {
      console.error('获取考试列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { setPage(1); fetchExams(1); }, [fetchExams]);

  // 编辑模式：加载分组/用户后解析已选目标的名称
  useEffect(() => {
    if (!editingId || formOpen) return;
  }, []);
  // 当 groups/allUsers 加载完成后，解析 editingId 对应的 assign_targets
  useEffect(() => {
    if (!editingId || groups.length === 0 && allUsers.length === 0) return;
    const targets = examForm.assign_ids ? examForm.assign_ids.split(',').filter(Boolean) : [];
    if (targets.length === 0 || selectedAssignTargets.length > 0) return;
    const resolved = [];
    const source = examForm.assign_type === 'group' ? groups : allUsers;
    targets.forEach(id => {
      const found = source.find(item => String(item.id) === String(id));
      if (found) {
        resolved.push({ id: String(found.id), name: found.name || found.real_name || found.username });
      }
    });
    if (resolved.length > 0) setSelectedAssignTargets(resolved);
  }, [groups, allUsers, editingId]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  /* ================= 考试 CRUD ================= */
  const loadGroupsAndUsers = async () => {
    try {
      const [gRes, uRes] = await Promise.all([
        api.get('/users/groups'),
        api.get('/users', { params: { limit: 1000 } }),
      ]);
      // 分组列表
      setGroups(Array.isArray(gRes.data) ? gRes.data : (gRes.data?.list || []));
      // 用户列表（只取 sales 角色）
      const users = uRes.data?.list || [];
      setAllUsers(Array.isArray(users) ? users.filter(u => u.role === 'sales') : []);
    } catch (err) {
      console.error('加载分组/用户失败:', err);
    }
  };

  const openAddExam = () => {
    setEditingId(null);
    setAssignDropdownOpen(false);
    setAssignSearch('');
    setSelectedAssignTargets([]);
    setExamForm({
      title: '', description: '', duration: 60, pass_score: 60,
      start_time: '', end_time: '', assign_type: 'all', assign_ids: '',
    });
    setFormOpen(true);
    loadGroupsAndUsers();
  };

  const openEditExam = (exam) => {
    setEditingId(exam.id);
    setAssignDropdownOpen(false);
    setAssignSearch('');
    const targets = Array.isArray(exam.assign_targets) ? exam.assign_targets : [];
    setExamForm({
      title: exam.title || '',
      description: exam.description || '',
      duration: exam.duration ?? 60,
      pass_score: exam.pass_score ?? 60,
      start_time: exam.start_time ? exam.start_time.slice(0, 16) : '',
      end_time: exam.end_time ? exam.end_time.slice(0, 16) : '',
      assign_type: exam.assign_type || 'all',
      assign_ids: targets.join(','),
    });
    setFormOpen(true);
    loadGroupsAndUsers();
  };

  const saveExam = async () => {
    if (!examForm.title.trim()) return;
    try {
      const payload = { ...examForm };
      if (payload.assign_type !== 'all' && selectedAssignTargets.length > 0) {
        payload.assign_targets = selectedAssignTargets.map(t => String(t.id));
      } else {
        payload.assign_targets = null;
      }
      delete payload.assign_ids;
      if (editingId) {
        await api.put(`/exams/${editingId}`, payload);
      } else {
        await api.post('/exams', payload);
      }
      setFormOpen(false);
      fetchExams(page);
    } catch (err) {
      console.error('保存考试失败:', err);
    }
  };

  const publishExam = async (exam) => {
    if (!window.confirm(`确定发布考试「${exam.title}」？发布后考生即可参加。`)) return;
    try {
      await api.post(`/exams/${exam.id}/publish`);
      fetchExams(page);
    } catch (err) {
      console.error('发布失败:', err);
    }
  };

  const deleteExam = async (exam) => {
    if (!window.confirm(`确定删除考试「${exam.title}」？此操作不可恢复。`)) return;
    try {
      await api.delete(`/exams/${exam.id}`);
      fetchExams(page);
    } catch (err) {
      console.error('删除失败:', err);
    }
  };

  /* ================= 组卷 ================= */
  const openCompose = async (exam) => {
    setComposeExamId(exam.id);
    setComposeOpen(true);
    setQbSearch('');
    setQbType('');
    setSelectedQuestions([]);
    // 已绑定的题目
    try {
      const res = await api.get(`/exams/${exam.id}/questions`);
      const data = res?.data || res;
      // 后端可能返回 {code:0, data:{questions:[...]}} 或 {code:0, data:[...]}
      const existing = data?.questions || (Array.isArray(data) ? data : (data?.list || []));
      setSelectedQuestions(existing.map((q) => ({ ...q, score: q.score || 5 })));
    } catch { setSelectedQuestions([]); }
    fetchQuestionBank('', '');
  };

  const fetchQuestionBank = async (keyword, type) => {
    setQbLoading(true);
    try {
      const params = { pageSize: 50 };
      if (keyword) params.keyword = keyword;
      if (type) params.type = type;
      const res = await api.get('/questions', { params });
      const data = res?.data || res;
      setQuestionBank(data.list || data || []);
    } catch (err) {
      console.error('获取题库失败:', err);
    } finally {
      setQbLoading(false);
    }
  };

  const addQuestionToExam = (q) => {
    if (selectedQuestions.find((s) => s.id === q.id)) return;
    setSelectedQuestions((prev) => [...prev, { ...q, score: 5 }]);
  };

  const removeQuestionFromExam = (qId) => {
    setSelectedQuestions((prev) => prev.filter((q) => q.id !== qId));
  };

  const updateQuestionScore = (qId, score) => {
    setSelectedQuestions((prev) => prev.map((q) => (q.id === qId ? { ...q, score: Number(score) || 0 } : q)));
  };

  const moveQuestion = (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= selectedQuestions.length) return;
    const list = [...selectedQuestions];
    const [item] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);
    setSelectedQuestions(list);
  };

  const saveCompose = async () => {
    try {
      const payload = selectedQuestions.map((q, idx) => ({
        question_id: q.id,
        sort_order: idx,
        score: q.score,
      }));
      // 后端用 POST，字段名为 question_ids
      await api.post(`/exams/${composeExamId}/questions`, { question_ids: payload });
      setComposeOpen(false);
      fetchExams(page);
    } catch (err) {
      console.error('保存组卷失败:', err);
      alert(err?.message || '保存组卷失败');
    }
  };

  /* ================= 试卷预览 ================= */
  const togglePreview = async (exam) => {
    if (previewExamId === exam.id) {
      setPreviewExamId(null);
      setPreviewQuestions([]);
      return;
    }
    setPreviewExamId(exam.id);
    setPreviewLoading(true);
    try {
      const res = await api.get(`/exams/${exam.id}/questions`);
      const data = res?.data || res;
      // 后端可能返回 {code:0, data:{questions:[...]}} 或 {code:0, data:[...]}
      const qList = data?.questions || (Array.isArray(data) ? data : (data?.list || []));
      setPreviewQuestions(qList);
    } catch (err) {
      console.error('获取试卷题目失败:', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  /* ================= 考生记录 ================= */
  const openRecords = async (exam) => {
    setRecordsExamId(exam.id);
    setRecordsOpen(true);
    setRecordsLoading(true);
    try {
      const res = await api.get(`/exams/${exam.id}/records`);
      const data = res?.data || res;
      const recs = data?.records || (Array.isArray(data) ? data : (data?.list || []));
      setRecords(recs);
    } catch (err) {
      console.error('获取考生记录失败:', err);
    } finally {
      setRecordsLoading(false);
    }
  };

  const gradeRecord = async (recordId) => {
    const score = window.prompt('输入分数（手动批阅）：');
    if (score === null) return;
    try {
      await api.put(`/exams/records/${recordId}/grade`, { score: Number(score) });
      openRecords({ id: recordsExamId });
    } catch (err) {
      console.error('批阅失败:', err);
    }
  };

  const authorizeRetake = async (recordId) => {
    if (!window.confirm('确定授权该考生补考？')) return;
    try {
      // 后端用 PUT
      await api.put(`/exams/records/${recordId}/retake`);
      openRecords({ id: recordsExamId });
    } catch (err) {
      console.error('授权补考失败:', err);
    }
  };

  /* ================= 渲染 ================= */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">考试管理</h1>
        <button onClick={openAddExam} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={16} /> 新建考试
        </button>
      </div>

      {/* 状态筛选 */}
      <div className="card">
        <div className="flex items-center gap-2">
          {EXAM_STATUS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
                statusFilter === s.value ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 考试列表 */}
      <div className="card overflow-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">考试标题</th>
              <th className="table-header w-20">时长</th>
              <th className="table-header w-20">合格分</th>
              <th className="table-header w-24">状态</th>
              <th className="table-header w-44">时间范围</th>
              <th className="table-header w-56">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-100">
            {exams.map((exam) => (
              <>
                <tr key={exam.id} className="hover:bg-warm-50/80">
                  <td className="table-cell">
                    <div className="font-medium text-warm-900">{exam.title}</div>
                    {exam.description && <div className="text-xs text-warm-400 mt-0.5 truncate max-w-xs">{exam.description}</div>}
                  </td>
                  <td className="table-cell text-warm-600">{exam.duration}分钟</td>
                  <td className="table-cell text-warm-600">{exam.pass_score}分</td>
                  <td className="table-cell">
                    <span className={STATUS_BADGE[exam.status] || 'badge-gray'}>
                      {STATUS_LABEL[exam.status] || exam.status}
                    </span>
                  </td>
                  <td className="table-cell text-xs text-warm-500">
                    <div>{exam.start_time?.replace('T', ' ')}</div>
                    <div>~ {exam.end_time?.replace('T', ' ')}</div>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-1 flex-wrap">
                      {/* 组卷 */}
                      <button onClick={() => openCompose(exam)} className="px-2 py-1 text-xs rounded bg-sky-50 text-purple-700 hover:bg-purple-100 transition">
                        组卷
                      </button>
                      {/* 预览 */}
                      <button onClick={() => togglePreview(exam)} className="px-2 py-1 text-xs rounded bg-warm-100 text-warm-600 hover:bg-warm-200 transition flex items-center gap-1">
                        <Eye size={12} /> 预览
                      </button>
                      {/* 编辑 */}
                      <button onClick={() => openEditExam(exam)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-sky-600">
                        <Edit3 size={14} />
                      </button>
                      {/* 发布 */}
                      {(exam.status === 'draft') && (
                        <button onClick={() => publishExam(exam)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-emerald-600" title="发布">
                          <Send size={14} />
                        </button>
                      )}
                      {/* 考生记录 */}
                      <button onClick={() => openRecords(exam)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-primary-600" title="考生记录">
                        <UsersIcon size={14} />
                      </button>
                      {/* 删除 */}
                      <button onClick={() => deleteExam(exam)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-rose-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                {/* 试卷预览展开行 */}
                {previewExamId === exam.id && (
                  <tr key={`preview-${exam.id}`}>
                    <td colSpan={6} className="px-4 pb-4">
                      <div className="bg-warm-50/80 rounded-xl p-4 border">
                        <div className="flex items-center justify-between mb-3">
                          <h5 className="text-sm font-semibold text-warm-700">试卷预览</h5>
                          <button onClick={() => { setPreviewExamId(null); setPreviewQuestions([]); }} className="text-warm-400 hover:text-warm-600"><X size={14} /></button>
                        </div>
                        {previewLoading ? (
                          <div className="text-center py-4"><div className="animate-spin w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" /></div>
                        ) : previewQuestions.length === 0 ? (
                          <div className="text-xs text-warm-400 text-center py-4">暂未组卷</div>
                        ) : (
                          <div className="space-y-3">
                            {previewQuestions.map((q, idx) => (
                              <div key={q.id} className="bg-white rounded p-3 border">
                                <div className="flex items-start gap-2">
                                  <span className="text-sm font-bold text-primary-600 shrink-0">{idx + 1}.</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm text-warm-900">{q.content}</div>
                                    <div className="text-xs text-warm-400 mt-1">({q.score ?? 5}分)</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!loading && exams.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-sm text-warm-400">暂无考试数据</td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t mt-4">
            <span className="text-sm text-warm-500">第 {page}/{totalPages} 页，共 {total} 条</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); fetchExams(p); }} className="btn-secondary text-sm py-1 px-3 disabled:opacity-40">上一页</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let n;
                if (totalPages <= 7) n = i + 1;
                else if (page <= 4) n = i + 1;
                else if (page >= totalPages - 3) n = totalPages - 6 + i;
                else n = page - 3 + i;
                return (
                  <button key={n} onClick={() => { setPage(n); fetchExams(n); }} className={`w-8 h-8 rounded text-sm ${n === page ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'}`}>{n}</button>
                );
              })}
              <button disabled={page >= totalPages} onClick={() => { const p = page + 1; setPage(p); fetchExams(p); }} className="btn-secondary text-sm py-1 px-3 disabled:opacity-40">下一页</button>
            </div>
          </div>
        )}
      </div>

      {/* ========== 考试表单弹窗 ========== */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setFormOpen(false)}>
          <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editingId ? '编辑考试' : '新建考试'}</h3>
              <button onClick={() => setFormOpen(false)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">考试标题</label>
                <input className="input" value={examForm.title} onChange={(e) => setExamForm({ ...examForm, title: e.target.value })} placeholder="输入考试标题" />
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">描述</label>
                <textarea className="input min-h-[60px] resize-y" value={examForm.description} onChange={(e) => setExamForm({ ...examForm, description: e.target.value })} placeholder="考试描述（可选）" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">考试时长（分钟）</label>
                  <input type="number" className="input" value={examForm.duration} onChange={(e) => setExamForm({ ...examForm, duration: e.target.value })} min={1} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">合格分数线</label>
                  <input type="number" className="input" value={examForm.pass_score} onChange={(e) => setExamForm({ ...examForm, pass_score: e.target.value })} min={0} max={100} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">开始时间</label>
                  <input type="datetime-local" className="input" value={examForm.start_time} onChange={(e) => setExamForm({ ...examForm, start_time: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">结束时间</label>
                  <input type="datetime-local" className="input" value={examForm.end_time} onChange={(e) => setExamForm({ ...examForm, end_time: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">分配方式</label>
                <div className="flex gap-2">
                  {ASSIGN_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setExamForm({ ...examForm, assign_type: m.value })}
                      className={`px-3 py-1.5 rounded-xl text-sm transition ${
                        examForm.assign_type === m.value ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {examForm.assign_type !== 'all' && (
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">
                    {examForm.assign_type === 'group' ? '选择分组' : '选择人员'}
                  </label>
                  {/* 已选标签 */}
                  {selectedAssignTargets.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {selectedAssignTargets.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-50 text-primary-700 rounded-lg text-xs">
                          {t.name}
                          <button
                            onClick={() => setSelectedAssignTargets(prev => prev.filter(s => s.id !== t.id))}
                            className="p-0.5 hover:bg-primary-100 rounded"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* 下拉选择器 */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setAssignDropdownOpen(!assignDropdownOpen)}
                      className="input flex items-center justify-between w-full text-left"
                    >
                      <span className="text-warm-400">
                        {selectedAssignTargets.length === 0
                          ? (examForm.assign_type === 'group' ? '请选择分组...' : '请选择人员...')
                          : `已选 ${selectedAssignTargets.length} 个`}
                      </span>
                      <ChevronDown size={16} className={`transition-transform ${assignDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {assignDropdownOpen && (
                      <div className="absolute z-50 mt-1 w-full bg-white border border-warm-200 rounded-xl shadow-soft-lg max-h-48 overflow-hidden">
                        {/* 搜索 */}
                        <div className="p-2 border-b border-warm-100">
                          <input
                            type="text"
                            className="input text-sm py-1.5"
                            placeholder="搜索..."
                            value={assignSearch}
                            onChange={(e) => setAssignSearch(e.target.value)}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        {/* 列表 */}
                        <div className="overflow-y-auto max-h-36">
                          {(examForm.assign_type === 'group' ? groups : allUsers)
                            .filter((item) => {
                              const name = item.name || item.real_name || item.username || '';
                              return name.toLowerCase().includes(assignSearch.toLowerCase());
                            })
                            .map((item) => {
                              const id = item.id;
                              const name = item.name || item.real_name || item.username || id;
                              const isSelected = selectedAssignTargets.some(t => t.id === id);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => {
                                    if (isSelected) {
                                      setSelectedAssignTargets(prev => prev.filter(t => t.id !== id));
                                    } else {
                                      setSelectedAssignTargets(prev => [...prev, { id, name }]);
                                    }
                                  }}
                                  className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-warm-50 transition ${
                                    isSelected ? 'bg-primary-50 text-primary-700' : 'text-warm-700'
                                  }`}
                                >
                                  <span>{name}</span>
                                  {isSelected && <Check size={14} className="text-primary-500 shrink-0" />}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* 点击外部关闭下拉 */}
                  {assignDropdownOpen && (
                    <div className="fixed inset-0 z-40" onClick={() => setAssignDropdownOpen(false)} />
                  )}
                </div>
              )}
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setFormOpen(false)} className="btn-secondary">取消</button>
                <button onClick={saveExam} className="btn-primary">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== 组卷弹窗 ========== */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setComposeOpen(false)}>
          <div className="bg-white rounded-xl shadow-soft-xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b shrink-0">
              <h3 className="text-lg font-semibold">组卷</h3>
              <button onClick={() => setComposeOpen(false)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>
            <div className="flex-1 flex overflow-hidden">
              {/* 左侧：题库 */}
              <div className="w-1/2 border-r flex flex-col">
                <div className="p-4 border-b shrink-0 space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-warm-400" />
                      <input className="input pl-8 text-sm" placeholder="搜索题目..." value={qbSearch} onChange={(e) => { setQbSearch(e.target.value); fetchQuestionBank(e.target.value, qbType); }} />
                    </div>
                    <select className="input w-28 text-sm" value={qbType} onChange={(e) => { setQbType(e.target.value); fetchQuestionBank(qbSearch, e.target.value); }}>
                      <option value="">全部类型</option>
                      <option value="single">单选题</option>
                      <option value="multiple">多选题</option>
                      <option value="judge">判断题</option>
                    </select>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {qbLoading ? (
                    <div className="text-center py-8"><div className="animate-spin w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" /></div>
                  ) : (
                    questionBank.map((q) => {
                      const added = selectedQuestions.find((s) => s.id === q.id);
                      return (
                        <div key={q.id} className={`p-3 rounded-xl border mb-2 cursor-pointer transition ${
                          added ? 'border-primary-300 bg-primary-50' : 'hover:border-primary-200 hover:bg-warm-50/80'
                        }`} onClick={() => addQuestionToExam(q)}>
                          <div className="text-sm text-warm-900 line-clamp-2">{q.content}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={q.type === 'single' ? 'badge-blue' : q.type === 'multiple' ? 'badge bg-purple-100 text-purple-800' : 'badge-yellow'}>
                              {q.type === 'single' ? '单选' : q.type === 'multiple' ? '多选' : '判断'}
                            </span>
                            <span className="text-xs text-warm-400">{q.category_name || ''}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  {!qbLoading && questionBank.length === 0 && (
                    <div className="text-center py-8 text-sm text-warm-400">暂无题目</div>
                  )}
                </div>
              </div>
              {/* 右侧：已选题目 */}
              <div className="w-1/2 flex flex-col">
                <div className="p-4 border-b shrink-0 flex items-center justify-between">
                  <span className="text-sm font-semibold text-warm-700">已选题目（{selectedQuestions.length}题）</span>
                  <span className="text-sm text-warm-500">总分：{selectedQuestions.reduce((s, q) => s + (q.score || 0), 0)}分</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {selectedQuestions.map((q, idx) => (
                    <div key={q.id} className="flex items-center gap-2 p-2 rounded-xl border mb-2 bg-white group"
                      draggable
                      onDragStart={() => setDragIdx(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { if (dragIdx !== null && dragIdx !== idx) moveQuestion(dragIdx, idx); setDragIdx(null); }}
                    >
                      <GripVertical size={14} className="text-warm-300 cursor-grab shrink-0" />
                      <span className="text-xs font-bold text-primary-600 w-5">{idx + 1}</span>
                      <span className="flex-1 text-sm truncate">{q.content}</span>
                      <input
                        type="number"
                        className="w-16 input text-xs py-1 px-2"
                        value={q.score}
                        onChange={(e) => updateQuestionScore(q.id, e.target.value)}
                        min={0}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="text-xs text-warm-400">分</span>
                      <button onClick={() => moveQuestion(idx, idx - 1)} disabled={idx === 0} className="p-0.5 text-warm-300 hover:text-warm-600 disabled:opacity-30">
                        <ChevronUp size={14} />
                      </button>
                      <button onClick={() => moveQuestion(idx, idx + 1)} disabled={idx === selectedQuestions.length - 1} className="p-0.5 text-warm-300 hover:text-warm-600 disabled:opacity-30">
                        <ChevronDown size={14} />
                      </button>
                      <button onClick={() => removeQuestionFromExam(q.id)} className="p-0.5 text-warm-300 hover:text-rose-500">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {selectedQuestions.length === 0 && (
                    <div className="text-center py-12 text-sm text-warm-400">从左侧题库选择题目</div>
                  )}
                </div>
                <div className="p-4 border-t shrink-0 flex justify-end gap-3">
                  <button onClick={() => setComposeOpen(false)} className="btn-secondary">取消</button>
                  <button onClick={saveCompose} className="btn-primary">保存组卷</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== 考生记录弹窗 ========== */}
      {recordsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRecordsOpen(false)}>
          <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-lg font-semibold">考生记录</h3>
              <button onClick={() => setRecordsOpen(false)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    <th className="table-header">姓名</th>
                    <th className="table-header w-24">分数</th>
                    <th className="table-header w-20">是否通过</th>
                    <th className="table-header w-24">用时</th>
                    <th className="table-header w-44">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-100">
                  {records.map((r) => (
                    <tr key={r.id} className="hover:bg-warm-50/80">
                      <td className="table-cell font-medium">{r.user_name || r.real_name || r.user_id}</td>
                      <td className="table-cell">
                        <span className={`font-semibold ${(r.score ?? 0) >= (r.pass_score ?? 60) ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {r.score ?? '-'}
                        </span>
                      </td>
                      <td className="table-cell">
                        {r.passed ? (
                          <span className="flex items-center gap-1 text-emerald-600 text-sm"><CheckCircle size={14} /> 通过</span>
                        ) : (
                          <span className="flex items-center gap-1 text-rose-500 text-sm"><XCircle size={14} /> 未通过</span>
                        )}
                      </td>
                      <td className="table-cell text-warm-500 text-sm">
                        {r.duration != null ? `${Math.floor(r.duration / 60)}分${r.duration % 60}秒` : '-'}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1">
                          <button onClick={() => gradeRecord(r.id)} className="px-2 py-1 text-xs rounded bg-sky-50 text-sky-700 hover:bg-sky-100 transition">
                            批阅
                          </button>
                          {!r.passed && (
                            <button onClick={() => authorizeRetake(r.id)} className="px-2 py-1 text-xs rounded bg-accent-50 text-orange-700 hover:bg-orange-100 transition flex items-center gap-1">
                              <RotateCcw size={12} /> 补考
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!recordsLoading && records.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-sm text-warm-400">暂无考生记录</td>
                    </tr>
                  )}
                  {recordsLoading && (
                    <tr>
                      <td colSpan={5} className="text-center py-12">
                        <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 隐藏的文件输入用于导入（如果需要） */}
    </div>
  );
}
