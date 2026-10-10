import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Edit3, Trash2, Eye, Send, Users as UsersIcon, X,
  ChevronUp, ChevronDown, RotateCcw, GripVertical, Clock, CheckCircle, XCircle, Check, ChevronLeft, ChevronRight,
  Download,
} from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { formatShanghai } from '../../utils/time';

// 随机抽题可选题型
const RANDOM_TYPES = [
  { value: 'single', label: '单选题' },
  { value: 'multiple', label: '多选题' },
  { value: 'judge', label: '判断题' },
  { value: 'fill', label: '填空题' },
  { value: 'short', label: '简答题' },
];

// 题型中文名
const TYPE_LABELS = { single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题', short: '简答题' };

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
  { value: 'all', label: '全体人员', systemAdminOnly: true },
  { value: 'scope', label: '按大区 / 区域' },
  { value: 'user', label: '指定人员' },
];

// 可发布的目标角色（与后端 AUDIENCE_ROLES 一致）
const AUDIENCE_ROLES = [
  { key: 'sales', label: '业务员' },
  { key: 'city_manager', label: '城市经理' },
  { key: 'area_manager', label: '区域经理' },
  { key: 'region_manager', label: '大区经理' },
  { key: 'system_admin', label: '系统管理员' },
];

// 大区/区域经理不可发布给系统管理员
const MANAGER_ALLOWED_ROLES = ['sales', 'city_manager', 'area_manager', 'region_manager'];

const PAGE_SIZE = 10;

// 发布范围摘要（列表展示）
function assignSummary(exam, regions) {
  const type = exam.assign_type || 'all';
  const targets = exam.assign_targets;
  if (type === 'all') return '全体人员';
  if (type === 'user') return `指定人员 ${Array.isArray(targets) ? targets.length : 0} 人`;
  if (type === 'group') return '按分组（旧）';
  if (type === 'scope') {
    const regionIds = targets?.region_ids || [];
    const roles = targets?.roles || [];
    const names = regionIds
      .map((id) => regions.find((r) => String(r.id) === String(id))?.name)
      .filter(Boolean);
    const regionText = names.length === 0
      ? '全部区域'
      : names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')} 等 ${names.length} 个`;
    const roleText = roles.length === 0
      ? '全部角色'
      : roles.map((k) => AUDIENCE_ROLES.find((r) => r.key === k)?.label || k).join('、');
    return `${regionText} · ${roleText}`;
  }
  return '-';
}

export default function Exams() {
  const { user: currentUser } = useAuth();
  // 系统管理员可发布给全体人员 / 任意角色；大区、区域经理按辖区严格限定
  const isSystemAdmin = currentUser?.role === 'admin'
    && (!currentUser?.manager_type || currentUser.manager_type === 'system_admin');
  const availableRoles = isSystemAdmin
    ? AUDIENCE_ROLES
    : AUDIENCE_ROLES.filter((r) => MANAGER_ALLOWED_ROLES.includes(r.key));

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
  const [regions, setRegions] = useState([]);
  const [allUsers, setAllUsers] = useState([]);        // 指定人员：当前搜索结果
  const [allUsersTotal, setAllUsersTotal] = useState(0); // 匹配总人数
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [selectedAssignTargets, setSelectedAssignTargets] = useState([]); // [{id, name}]
  const [selectedRegions, setSelectedRegions] = useState([]); // 区域 id（大区含下属区域）
  const [selectedRoles, setSelectedRoles] = useState([]); // 角色 key
  const [examForm, setExamForm] = useState({
    title: '', description: '', duration: 60, pass_score: 60, max_attempts: 3,
    start_time: '', end_time: '', assign_type: 'scope',
  });

  // ---- 组卷弹窗 ----
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeExamId, setComposeExamId] = useState(null);
  // 随机抽题规则：{ single: { count, score }, multiple: {...}, judge: {...} }
  const [randomRules, setRandomRules] = useState({
    single: { count: '', score: '5' },
    multiple: { count: '', score: '5' },
    judge: { count: '', score: '5' },
  });
  const [composeRandomLoading, setComposeRandomLoading] = useState(false);
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
  const [recordsExamTitle, setRecordsExamTitle] = useState('');
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  // ---- 简答题批阅 ----
  const [gradingRecord, setGradingRecord] = useState(null);
  const [manualScores, setManualScores] = useState({}); // { 题目ID: 分数 }

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

  // 区域列表用于发布范围选择与列表摘要展示
  useEffect(() => { loadRegions(); }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  /* ================= 考试 CRUD ================= */
  // 区域列表（后端已按当前管理员的辖区过滤）
  const loadRegions = async () => {
    try {
      const res = await api.get('/users/regions');
      setRegions(Array.isArray(res.data) ? res.data : (res.data?.list || []));
    } catch (err) {
      console.error('加载区域失败:', err);
    }
  };

  // 指定人员：按姓名 / 工号搜索（服务端全库搜索，范围由后端按辖区限定）
  const searchUsers = useCallback(async (keyword = '') => {
    setUserSearchLoading(true);
    try {
      const res = await api.get('/users', {
        params: { page: 1, limit: 50, keyword: String(keyword || '').trim(), role: 'sales' },
      });
      const data = res?.data || res;
      setAllUsers(Array.isArray(data?.list) ? data.list : []);
      setAllUsersTotal(Number(data?.total) || 0);
    } catch (err) {
      console.error('搜索人员失败:', err);
      setAllUsers([]);
      setAllUsersTotal(0);
    } finally {
      setUserSearchLoading(false);
    }
  }, []);

  // 人员搜索防抖（下拉打开时才请求）
  useEffect(() => {
    if (!assignDropdownOpen) return;
    const timer = setTimeout(() => { searchUsers(assignSearch); }, 300);
    return () => clearTimeout(timer);
  }, [assignSearch, assignDropdownOpen, searchUsers]);

  const toggleAssignDropdown = () => {
    const next = !assignDropdownOpen;
    if (next) setAssignSearch('');
    setAssignDropdownOpen(next);
  };

  // 多选 / 取消选择某个人
  const toggleAssignUser = (item) => {
    const id = String(item.id);
    const name = item.real_name || item.username || id;
    setSelectedAssignTargets((prev) => (
      prev.some((t) => String(t.id) === id)
        ? prev.filter((t) => String(t.id) !== id)
        : [...prev, { id, name }]
    ));
  };

  // 把当前搜索结果全部加入已选
  const selectAllSearchResults = () => {
    setSelectedAssignTargets((prev) => {
      const map = new Map(prev.map((t) => [String(t.id), t]));
      allUsers.forEach((u) => {
        const id = String(u.id);
        if (!map.has(id)) map.set(id, { id, name: u.real_name || u.username || id });
      });
      return [...map.values()];
    });
  };

  const openAddExam = () => {
    setEditingId(null);
    setAssignDropdownOpen(false);
    setAssignSearch('');
    setSelectedAssignTargets([]);
    setSelectedRegions([]);
    setSelectedRoles([]);
    setAllUsers([]);
    setAllUsersTotal(0);
    setExamForm({
      title: '', description: '', duration: 60, pass_score: 60, max_attempts: 3,
      start_time: '', end_time: '', assign_type: 'scope',
    });
    setFormOpen(true);
    loadRegions();
  };

  const openEditExam = (exam) => {
    setEditingId(exam.id);
    setAssignDropdownOpen(false);
    setAssignSearch('');
    // 历史 group 等类型统一回落到「按大区/区域」
    const rawType = exam.assign_type || 'all';
    const type = ASSIGN_MODES.some((m) => m.value === rawType) ? rawType : 'scope';
    const targets = exam.assign_targets;
    if (type === 'scope' && targets && !Array.isArray(targets)) {
      setSelectedRegions((targets.region_ids || []).map(String));
      setSelectedRoles((targets.roles || []).map(String));
      setSelectedAssignTargets([]);
    } else if (type === 'user' && Array.isArray(targets)) {
      setSelectedRegions([]);
      setSelectedRoles([]);
      const initial = targets.map((id) => ({ id: String(id), name: '' }));
      setSelectedAssignTargets(initial);
      // 按 ID 批量回填姓名，避免只显示一串 ID
      if (initial.length > 0) {
        api.get('/users', { params: { ids: initial.map((t) => t.id).join(','), limit: 200 } })
          .then((res) => {
            const list = (res?.data || res)?.list || [];
            setSelectedAssignTargets((prev) => prev.map((t) => {
              const found = list.find((u) => String(u.id) === String(t.id));
              return { ...t, name: found ? (found.real_name || found.username) : (t.name || t.id) };
            }));
          })
          .catch((err) => console.error('回填人员姓名失败:', err));
      }
    } else {
      setSelectedRegions([]);
      setSelectedRoles([]);
      setSelectedAssignTargets([]);
    }
    setExamForm({
      title: exam.title || '',
      description: exam.description || '',
      duration: exam.duration ?? 60,
      pass_score: exam.pass_score ?? 60,
      max_attempts: exam.max_attempts ?? 3,
      start_time: exam.start_time ? exam.start_time.slice(0, 16) : '',
      end_time: exam.end_time ? exam.end_time.slice(0, 16) : '',
      assign_type: type,
    });
    setFormOpen(true);
    loadRegions();
  };

  // 大区/区域多选
  const areaRegions = regions.filter((r) => r.level === 1);
  const subRegionsOf = (areaId) => regions.filter((r) => r.level === 2 && String(r.parent_id) === String(areaId));
  // 区域经理等只能看到自己那级区域时，父级大区不在列表里
  const orphanRegions = regions.filter(
    (r) => r.level !== 1 && !areaRegions.some((a) => String(a.id) === String(r.parent_id))
  );
  // 提示当前管理员的发布权限范围
  const myRegionName = regions.find((r) => String(r.id) === String(currentUser?.region_id))?.name || '';
  const scopeHint = isSystemAdmin
    ? '系统管理员：可发布给全体人员，或任选大区/区域与角色'
    : currentUser?.manager_type === 'region_manager'
      ? `大区经理：只能发布给本大区${myRegionName ? `（${myRegionName}）` : ''}及下属区域的人员`
      : currentUser?.manager_type === 'area_manager'
        ? `区域经理：只能发布给本区域${myRegionName ? `（${myRegionName}）` : ''}的人员`
        : '只能发布给本辖区内的人员';
  const toggleRegion = (id) => {
    const key = String(id);
    setSelectedRegions((prev) => prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]);
  };
  // 某个大区下的所有细分区域是否已勾选
  const isAreaFullySelected = (areaId) => {
    const subs = subRegionsOf(areaId);
    if (subs.length === 0) return selectedRegions.includes(String(areaId));
    return subs.every((r) => selectedRegions.includes(String(r.id)));
  };
  // 勾选大区 = 选中该大区 + 其下属全部细分区域
  const toggleArea = (areaId) => {
    const subs = subRegionsOf(areaId);
    const ids = [String(areaId), ...subs.map((r) => String(r.id))];
    setSelectedRegions((prev) => {
      const allSelected = ids.every((id) => prev.includes(id));
      return allSelected ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])];
    });
  };
  const toggleRole = (key) => {
    setSelectedRoles((prev) => prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]);
  };

  const saveExam = async () => {
    if (!examForm.title.trim()) { alert('请填写考试标题'); return; }
    const payload = { ...examForm };
    if (payload.assign_type === 'all') {
      payload.assign_targets = null;
    } else if (payload.assign_type === 'scope') {
      if (selectedRegions.length === 0 && selectedRoles.length === 0) {
        alert('请至少选择一个区域或角色');
        return;
      }
      payload.assign_targets = { region_ids: selectedRegions, roles: selectedRoles };
    } else if (payload.assign_type === 'user') {
      if (selectedAssignTargets.length === 0) { alert('请至少选择一名人员'); return; }
      payload.assign_targets = selectedAssignTargets.map(t => String(t.id));
    } else {
      payload.assign_targets = null;
    }
    try {
      if (editingId) {
        await api.put(`/exams/${editingId}`, payload);
      } else {
        await api.post('/exams', payload);
      }
      setFormOpen(false);
      fetchExams(page);
    } catch (err) {
      console.error('保存考试失败:', err);
      alert(err?.message || '保存考试失败');
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

  const setRandomRule = (type, field, value) => {
    setRandomRules((prev) => ({ ...prev, [type]: { ...prev[type], [field]: value } }));
  };

  // 按题型 + 数量从前题库随机抽题（会覆盖当前已选题目）
  const composeRandom = async () => {
    const rules = RANDOM_TYPES
      .map((t) => ({
        type: t.value,
        count: Number(randomRules[t.value]?.count) || 0,
        score: Number(randomRules[t.value]?.score) || 0,
      }))
      .filter((r) => r.count > 0);

    if (rules.length === 0) {
      alert('请至少为一个题型填写抽题数量');
      return;
    }

    try {
      setComposeRandomLoading(true);
      const res = await api.post(`/exams/${composeExamId}/compose-random`, { rules });
      const data = res?.data || res;
      alert(`随机抽题成功：共 ${data.question_count} 题，总分 ${data.total_score} 分`);
      await openCompose({ id: composeExamId });
      fetchExams(page);
    } catch (err) {
      alert(err?.message || '随机抽题失败');
    } finally {
      setComposeRandomLoading(false);
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
    setRecordsExamTitle(exam.title || '');
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

  // 打开简答题批阅面板；该记录没有主观题时返回 false（走整卷给分）
  const openGrading = (record) => {
    const subjective = (record.answers || []).filter((a) => a.needs_manual);
    if (subjective.length === 0) return false;
    const init = {};
    subjective.forEach((a) => { init[a.question_id] = a.manual_score ?? ''; });
    setManualScores(init);
    setGradingRecord(record);
    return true;
  };

  const submitGrading = async () => {
    const scores = {};
    Object.entries(manualScores).forEach(([qid, val]) => {
      if (val !== '' && val !== null && val !== undefined) scores[qid] = Number(val);
    });
    if (Object.keys(scores).length === 0) {
      alert('请至少为一道简答题打分');
      return;
    }
    try {
      const res = await api.put(`/exams/records/${gradingRecord.id}/grade`, { question_scores: scores });
      setGradingRecord(null);
      await openRecords({ id: recordsExamId });
      if (res?.message) alert(res.message);
    } catch (err) {
      alert(err?.message || '批阅失败');
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

  // 导出考试记录为 Excel
  const exportRecords = async (examId) => {
    try {
      const res = await api.get(`/exams/${examId}/records/export`, { responseType: 'blob' });
      const blob = res instanceof Blob ? res : new Blob([res]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${recordsExamTitle || '考试'}_考试记录.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出失败:', err);
      alert('导出失败: ' + (err?.message || '请重试'));
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
              <th className="table-header w-52">发布范围</th>
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
                  <td className="table-cell text-xs text-warm-600">
                    <div className="line-clamp-2">{assignSummary(exam, regions)}</div>
                  </td>
                  <td className="table-cell text-xs text-warm-500">
                    <div>{formatShanghai(exam.start_time)}</div>
                    <div>~ {formatShanghai(exam.end_time)}</div>
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
                    <td colSpan={7} className="px-4 pb-4">
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
                <td colSpan={7} className="text-center py-12 text-sm text-warm-400">暂无考试数据</td>
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
                  <label className="block text-sm font-medium text-warm-700 mb-1">最大考试次数</label>
                  <input type="number" className="input" value={examForm.max_attempts} onChange={(e) => setExamForm({ ...examForm, max_attempts: Math.max(1, parseInt(e.target.value) || 1) })} min={1} />
                  <p className="text-xs text-warm-500 mt-1">每位考生最多可参加的考试次数</p>
                </div>
                <div></div>
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
                <label className="block text-sm font-medium text-warm-700 mb-1">发布范围</label>
                <div className="flex gap-2 flex-wrap">
                  {ASSIGN_MODES.filter((m) => !m.systemAdminOnly || isSystemAdmin).map((m) => (
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
                <p className="text-xs text-warm-400 mt-1.5">{scopeHint}</p>
              </div>

              {/* 按大区 / 区域 + 角色 */}
              {examForm.assign_type === 'scope' && (
                <div className="space-y-3 border border-warm-200 rounded-xl p-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-warm-600">大区 / 区域（可多选，勾选大区含其下属全部区域）</label>
                      {selectedRegions.length > 0 && (
                        <button type="button" onClick={() => setSelectedRegions([])} className="text-xs text-warm-400 hover:text-warm-600">清空</button>
                      )}
                    </div>
                    <div className="border border-warm-200 rounded-xl max-h-56 overflow-y-auto">
                      {regions.length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-warm-400">暂无可选区域</div>
                      )}
                      {areaRegions.map((area) => {
                        const subs = subRegionsOf(area.id);
                        const checked = isAreaFullySelected(area.id);
                        const partial = !checked && subs.some((s) => selectedRegions.includes(String(s.id)));
                        return (
                          <div key={area.id} className="border-b border-warm-100 last:border-b-0">
                            <label className="flex items-center gap-2 px-3 py-2 bg-warm-50/70 cursor-pointer hover:bg-warm-100/70">
                              <input
                                type="checkbox"
                                className="accent-primary-500"
                                checked={checked}
                                onChange={() => toggleArea(area.id)}
                              />
                              <span className="text-sm font-medium text-warm-700">{area.name}</span>
                              <span className="text-xs text-warm-400">
                                {subs.length > 0 ? `${subs.length} 个区域` : ''}{partial ? ' · 已选部分' : ''}
                              </span>
                            </label>
                            {subs.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 px-3 py-2">
                                {subs.map((r) => {
                                  const on = selectedRegions.includes(String(r.id));
                                  return (
                                    <button
                                      key={r.id}
                                      type="button"
                                      onClick={() => toggleRegion(r.id)}
                                      className={`px-2 py-0.5 rounded-lg text-xs border transition ${
                                        on ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-warm-200 text-warm-500 hover:bg-warm-50'
                                      }`}
                                    >
                                      {r.name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {orphanRegions.length > 0 && (
                        <div className="px-3 py-2">
                          {areaRegions.length > 0 && <div className="text-xs text-warm-400 mb-1.5">其他区域</div>}
                          <div className="flex flex-wrap gap-1.5">
                            {orphanRegions.map((r) => {
                              const on = selectedRegions.includes(String(r.id));
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => toggleRegion(r.id)}
                                  className={`px-2 py-0.5 rounded-lg text-xs border transition ${
                                    on ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-warm-200 text-warm-500 hover:bg-warm-50'
                                  }`}
                                >
                                  {r.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-warm-600 mb-1">角色（可多选，不选表示不限角色）</label>
                    <div className="flex flex-wrap gap-1.5">
                      {availableRoles.map((r) => {
                        const on = selectedRoles.includes(r.key);
                        return (
                          <button
                            key={r.key}
                            type="button"
                            onClick={() => toggleRole(r.key)}
                            className={`px-3 py-1 rounded-xl text-xs border transition ${
                              on ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white border-transparent shadow-soft hover:shadow-soft-lg' : 'border-warm-200 text-warm-600 hover:bg-warm-50'
                            }`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="text-xs text-warm-600 bg-warm-50 rounded-lg px-3 py-2">
                    发布对象：
                    <span className="font-medium text-primary-700">
                      {selectedRegions.length === 0 ? '全部区域' : `${selectedRegions.length} 个区域`}
                    </span>
                    {' · '}
                    <span className="font-medium text-primary-700">
                      {selectedRoles.length === 0
                        ? '全部角色'
                        : selectedRoles.map((k) => AUDIENCE_ROLES.find((x) => x.key === k)?.label || k).join('、')}
                    </span>
                  </div>
                </div>
              )}

              {/* 指定人员 */}
              {examForm.assign_type === 'user' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-warm-700">
                      选择人员
                      <span className="text-warm-400 font-normal ml-1">（可多选，支持按姓名或工号搜索）</span>
                    </label>
                    {selectedAssignTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedAssignTargets([])}
                        className="text-xs text-warm-400 hover:text-warm-600"
                      >
                        清空已选（{selectedAssignTargets.length}）
                      </button>
                    )}
                  </div>

                  {/* 已选标签 */}
                  {selectedAssignTargets.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-warm-50/70 rounded-xl border border-warm-100">
                      {selectedAssignTargets.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-50 text-primary-700 rounded-lg text-xs">
                          {t.name || t.id}
                          <button
                            type="button"
                            onClick={() => setSelectedAssignTargets(prev => prev.filter(s => String(s.id) !== String(t.id)))}
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
                      onClick={toggleAssignDropdown}
                      className="input flex items-center justify-between w-full text-left"
                    >
                      <span className="text-warm-400">
                        {selectedAssignTargets.length === 0 ? '点击搜索并选择人员...' : `已选 ${selectedAssignTargets.length} 人`}
                      </span>
                      <ChevronDown size={16} className={`transition-transform ${assignDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {assignDropdownOpen && (
                      <div className="absolute z-50 mt-1 w-full bg-white border border-warm-200 rounded-xl shadow-soft-lg overflow-hidden">
                        {/* 搜索 */}
                        <div className="p-2 border-b border-warm-100">
                          <input
                            type="text"
                            className="input text-sm py-1.5"
                            placeholder="输入姓名或工号搜索，支持模糊匹配"
                            value={assignSearch}
                            onChange={(e) => setAssignSearch(e.target.value)}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex items-center justify-between mt-1.5 px-0.5">
                            <span className="text-xs text-warm-400">
                              {userSearchLoading
                                ? '搜索中...'
                                : assignSearch.trim()
                                  ? `匹配到 ${allUsersTotal} 人`
                                  : `共 ${allUsersTotal} 人${allUsersTotal > allUsers.length ? `，仅显示前 ${allUsers.length} 人，建议输入关键词` : ''}`}
                            </span>
                            {allUsers.length > 0 && !userSearchLoading && (
                              <button
                                type="button"
                                onClick={selectAllSearchResults}
                                className="text-xs text-primary-600 hover:text-primary-800"
                              >
                                全选这 {allUsers.length} 人
                              </button>
                            )}
                          </div>
                        </div>
                        {/* 列表 */}
                        <div className="overflow-y-auto max-h-56">
                          {userSearchLoading ? (
                            <div className="py-6 text-center">
                              <span className="inline-block animate-spin w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full" />
                            </div>
                          ) : allUsers.length === 0 ? (
                            <div className="px-3 py-6 text-center text-xs text-warm-400">
                              {assignSearch.trim() ? '没有匹配的人员，换个关键词试试' : '暂无可选人员'}
                            </div>
                          ) : (
                            allUsers.map((item) => {
                              const isSelected = selectedAssignTargets.some((t) => String(t.id) === String(item.id));
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => toggleAssignUser(item)}
                                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-warm-50 transition ${
                                    isSelected ? 'bg-primary-50' : ''
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span className={`truncate ${isSelected ? 'text-primary-700 font-medium' : 'text-warm-800'}`}>
                                      {item.real_name || item.username}
                                    </span>
                                    <span className="text-xs text-warm-400 shrink-0">{item.username}</span>
                                    {item.region_name && (
                                      <span className="text-xs text-warm-400 shrink-0 truncate">· {item.region_name}</span>
                                    )}
                                  </span>
                                  {isSelected && <Check size={14} className="text-primary-500 shrink-0" />}
                                </button>
                              );
                            })
                          )}
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

            {/* 随机抽题：按题型+数量从题库抽取，会覆盖当前已选题目 */}
            <div className="px-6 py-3 border-b bg-warm-50/60 shrink-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-warm-700">随机抽题</span>
                <span className="text-xs text-warm-400">按题型设置数量与分值，点击「随机生成」自动从题库抽取（会覆盖当前已选题目）</span>
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-2">
                {RANDOM_TYPES.map((t) => (
                  <div key={t.value} className="flex items-center gap-1.5">
                    <span className="text-xs text-warm-600 w-12">{t.label}</span>
                    <input
                      type="number"
                      min="0"
                      className="input w-16 text-sm py-1 px-2"
                      placeholder="数量"
                      value={randomRules[t.value]?.count ?? ''}
                      onChange={(e) => setRandomRule(t.value, 'count', e.target.value)}
                    />
                    <span className="text-xs text-warm-400">题 ×</span>
                    <input
                      type="number"
                      min="0"
                      className="input w-16 text-sm py-1 px-2"
                      placeholder="分值"
                      value={randomRules[t.value]?.score ?? ''}
                      onChange={(e) => setRandomRule(t.value, 'score', e.target.value)}
                    />
                    <span className="text-xs text-warm-400">分</span>
                  </div>
                ))}
                <button
                  onClick={composeRandom}
                  disabled={composeRandomLoading}
                  className="btn-primary text-sm flex items-center gap-1.5"
                >
                  {composeRandomLoading
                    ? <span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                    : <RotateCcw size={14} />}
                  随机生成
                </button>
              </div>
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
                      {RANDOM_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
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
                            <span className={
                              q.type === 'single' ? 'badge-blue'
                                : q.type === 'multiple' ? 'badge bg-purple-100 text-purple-800'
                                : q.type === 'fill' ? 'badge-green'
                                : q.type === 'short' ? 'badge-red'
                                : 'badge-yellow'
                            }>
                              {(TYPE_LABELS[q.type] || q.type || '').replace('题', '')}
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportRecords(recordsExamId)}
                  className="btn-secondary text-sm flex items-center gap-1.5"
                >
                  <Download size={14} /> 导出 Excel
                </button>
                <button onClick={() => setRecordsOpen(false)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    <th className="table-header">姓名</th>
                    <th className="table-header w-20">考试次数</th>
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
                      <td className="table-cell text-warm-700 text-sm">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary-50 text-primary-700 font-medium">
                          第 {r.attempt ?? 1} 次
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className={`font-semibold ${(r.score ?? 0) >= (r.pass_score ?? 60) ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {r.score ?? '-'}
                        </span>
                      </td>
                      <td className="table-cell">
                        {r.pending_manual === 1 ? (
                          <span className="flex items-center gap-1 text-amber-600 text-sm"><Clock size={14} /> 待批阅</span>
                        ) : r.passed ? (
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
                          <button
                            onClick={() => { if (!openGrading(r)) gradeRecord(r.id); }}
                            className={`px-2 py-1 text-xs rounded transition ${
                              r.pending_manual === 1
                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                            }`}
                          >
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
                      <td colSpan={6} className="text-center py-12 text-sm text-warm-400">暂无考生记录</td>
                    </tr>
                  )}
                  {recordsLoading && (
                    <tr>
                      <td colSpan={6} className="text-center py-12">
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

      {/* ========== 简答题批阅弹窗 ========== */}
      {gradingRecord && (() => {
        const answers = gradingRecord.answers || [];
        const subjective = answers.filter((a) => a.needs_manual);
        const autoScore = answers.reduce((sum, a) => sum + (a.needs_manual ? 0 : Number(a.score) || 0), 0);
        const manualTotal = subjective.reduce((sum, a) => {
          const v = manualScores[a.question_id];
          return sum + (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
        }, 0);
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setGradingRecord(null)}>
            <div className="bg-white rounded-xl shadow-soft-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b shrink-0">
                <div>
                  <h3 className="text-lg font-semibold">批阅简答题</h3>
                  <p className="text-xs text-warm-400 mt-0.5">
                    考生：{gradingRecord.real_name || gradingRecord.username || gradingRecord.user_id}
                  </p>
                </div>
                <button onClick={() => setGradingRecord(null)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {subjective.map((a, idx) => (
                  <div key={a.question_id} className="border border-warm-200 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-warm-900 whitespace-pre-wrap">{idx + 1}. {a.content}</p>
                      <span className="text-xs text-warm-400 shrink-0">满分 {a.total_score} 分</span>
                    </div>
                    <div className="mt-3 bg-warm-50 rounded-lg p-3 text-sm text-warm-700 whitespace-pre-wrap">
                      <span className="text-xs text-warm-400 block mb-1">考生作答</span>
                      {a.user_answer ? String(a.user_answer) : '（未作答）'}
                    </div>
                    {a.correct_answer ? (
                      <div className="mt-2 text-xs text-warm-500 whitespace-pre-wrap">
                        <span className="text-warm-400">参考答案：</span>{String(a.correct_answer)}
                      </div>
                    ) : null}
                    {a.analysis ? (
                      <div className="mt-1 text-xs text-warm-400 whitespace-pre-wrap">解析：{a.analysis}</div>
                    ) : null}
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-sm text-warm-600">打分</span>
                      <input
                        type="number"
                        min="0"
                        max={a.total_score}
                        className="input w-24 text-sm"
                        value={manualScores[a.question_id] ?? ''}
                        onChange={(e) => setManualScores((prev) => ({ ...prev, [a.question_id]: e.target.value }))}
                      />
                      <span className="text-sm text-warm-400">/ {a.total_score} 分</span>
                      <div className="ml-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => setManualScores((prev) => ({ ...prev, [a.question_id]: a.total_score }))}
                          className="px-2 py-0.5 text-xs rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        >
                          满分
                        </button>
                        <button
                          type="button"
                          onClick={() => setManualScores((prev) => ({ ...prev, [a.question_id]: 0 }))}
                          className="px-2 py-0.5 text-xs rounded bg-warm-100 text-warm-600 hover:bg-warm-200"
                        >
                          0 分
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 border-t shrink-0 flex items-center justify-between">
                <span className="text-sm text-warm-500">
                  客观题自动得分 <strong className="text-warm-700">{autoScore}</strong> 分，简答题本次打分{' '}
                  <strong className="text-amber-600">{manualTotal}</strong> 分，合计{' '}
                  <strong className="text-primary-700">{autoScore + manualTotal}</strong> 分
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setGradingRecord(null)} className="btn-secondary">取消</button>
                  <button onClick={submitGrading} className="btn-primary">提交批阅</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
