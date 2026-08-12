import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Edit3, X, Users as UsersIcon, Settings, Coins, History, Phone, Mail, Eye, Download, Upload, FileSpreadsheet, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import api from '../../api';

/* ========== 等级/称号配置 ========== */
const LEVELS = [
  { level: 1, title: '江湖跑侠', min: 0, max: 199, color: 'text-stone-500', bg: 'bg-stone-100', desc: '初闯终端江湖，开启跑店历练' },
  { level: 2, title: '拓店游侠', min: 200, max: 499, color: 'text-emerald-600', bg: 'bg-emerald-50', desc: '奔走各大门店，拓店小有收获' },
  { level: 3, title: '终端先锋', min: 500, max: 999, color: 'text-blue-600', bg: 'bg-blue-50', desc: '熟稔门店谈判，终端得心应手' },
  { level: 4, title: '销冠大咖', min: 1000, max: 1999, color: 'text-purple-600', bg: 'bg-purple-50', desc: '实战战绩突出，团队中坚力量' },
  { level: 5, title: '城市英雄', min: 2000, max: Infinity, color: 'text-amber-500', bg: 'bg-amber-50', desc: '一线顶尖标杆，众人学习榜样' },
];

function getLevelInfo(totalEarnedPoints) {
  const pts = totalEarnedPoints || 0;
  const current = LEVELS.find(l => pts >= l.min && pts <= l.max) || LEVELS[0];
  return current;
}

/* ================= 用户弹窗表单 ================= */
function UserModal({ open, onClose, onSave, form, setForm, groups, editingId }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft-xl p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{editingId ? '编辑用户' : '新建用户'}</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">用户名 *</label>
              <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="登录用户名" />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">真实姓名 *</label>
              <input className="input" value={form.real_name} onChange={(e) => setForm({ ...form, real_name: e.target.value })} placeholder="真实姓名" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">密码{editingId ? '（留空则不修改）' : ' *'}</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editingId ? '留空则不修改密码' : '输入密码'} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">角色 *</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="">请选择</option>
                <option value="admin">管理员</option>
                <option value="sales">业务员</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">分组</label>
              <select className="input" value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
                <option value="">未分组</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">手机</label>
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="手机号" />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">邮箱</label>
              <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="邮箱地址" />
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button onClick={onSave} className="btn-primary">保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= 分组管理弹窗 ================= */
function GroupModal({ open, onClose, groups, onSaveGroup, onDeleteGroup }) {
  const [editId, setEditId] = useState(null);
  const [groupName, setGroupName] = useState('');

  if (!open) return null;

  const handleSave = () => {
    if (!groupName.trim()) return;
    onSaveGroup(editId, groupName.trim());
    setGroupName('');
    setEditId(null);
  };

  const openEdit = (group) => {
    setEditId(group.id);
    setGroupName(group.name);
  };

  const handleDelete = (group) => {
    if (!window.confirm(`确定删除分组「${group.name}」？该分组下的用户将变为未分组。`)) return;
    onDeleteGroup(group.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft-xl p-4 md:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">管理分组</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
        </div>

        {/* 新建 / 编辑 */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            className="input flex-1"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="输入分组名称"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-primary text-sm flex-1 sm:flex-none">{editId ? '更新' : '新建'}</button>
            {editId && (
              <button onClick={() => { setEditId(null); setGroupName(''); }} className="btn-secondary text-sm">取消</button>
            )}
          </div>
        </div>

        {/* 分组列表 */}
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {groups.length === 0 && (
            <div className="text-sm text-warm-400 text-center py-6">暂无分组</div>
          )}
          {groups.map((group) => (
            <div key={group.id} className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-warm-50/80">
              <div>
                <span className="text-sm font-medium text-warm-700">{group.name}</span>
                <span className="text-xs text-warm-400 ml-2">{group.user_count ?? 0} 人</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(group)} className="p-1 text-warm-400 hover:text-sky-600">
                  <Edit3 size={13} />
                </button>
                <button onClick={() => handleDelete(group)} className="p-1 text-warm-400 hover:text-rose-600">
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= 积分调整弹窗 ================= */
function PointModal({ open, onClose, onSave, user }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  if (!open) return null;

  const handleSave = () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) === 0) {
      alert('请输入有效的积分数值');
      return;
    }
    if (!reason.trim()) {
      alert('请输入调整原因');
      return;
    }
    onSave(user.id, Number(amount), reason);
    setAmount('');
    setReason('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft-xl p-4 md:p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">积分调整</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-warm-500 mb-1">用户</label>
            <p className="text-sm font-medium text-warm-900">{user?.real_name || user?.username}</p>
            <p className="text-xs text-warm-400">当前积分: {user?.points ?? 0}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">积分变动（正数增加，负数扣减）</label>
            <input
              className="input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="如 +10 或 -5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">调整原因</label>
            <textarea
              className="input min-h-[60px] resize-y"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="调整原因..."
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button onClick={handleSave} className="btn-primary">确认调整</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= 积分流水弹窗 ================= */
function PointHistoryModal({ open, onClose, userId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.get(`/users/${userId}/point-logs`);
        if (cancelled) return;
        const data = res?.data || res;
        const recs = Array.isArray(data) ? data : (data?.list || []);
        setRecords(recs);
      } catch (err) {
        if (!cancelled) console.error('获取积分流水失败:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft-xl p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2"><History size={18} /> 积分流水记录</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full" />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-10 text-sm text-warm-400">暂无积分流水记录</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">时间</th>
                <th className="table-header">变动</th>
                <th className="table-header">原因</th>
                <th className="table-header">操作人</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {records.map((r, idx) => (
                <tr key={r.id || idx} className="hover:bg-warm-50/80">
                  <td className="table-cell text-xs text-warm-500">{r.created_at}</td>
                  <td className="table-cell">
                    <span className={`font-medium ${(r.points ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {(r.points ?? 0) >= 0 ? '+' : ''}{r.points}
                    </span>
                  </td>
                  <td className="table-cell text-sm text-warm-600">{r.reason || '-'}</td>
                  <td className="table-cell text-sm text-warm-500">{r.operator_name || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ================= 主页面 ================= */
export default function Users() {
  // ---- 分组过滤 ----
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupModalOpen, setGroupModalOpen] = useState(false);

  // ---- 用户列表 ----
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 15;
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ---- 用户弹窗 ----
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userEditingId, setUserEditingId] = useState(null);
  const [userForm, setUserForm] = useState({
    username: '', real_name: '', password: '', role: '', group_id: '', phone: '', email: '',
  });

  // ---- 积分调整 ----
  const [pointModalOpen, setPointModalOpen] = useState(false);
  const [pointTarget, setPointTarget] = useState(null);

  // ---- 积分流水 ----
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyUserId, setHistoryUserId] = useState(null);

  // ---- 用户画像 ----
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // ---- 批量导入 ----
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  /* ================= 数据加载 ================= */
  const fetchGroups = useCallback(async () => {
    try {
      const res = await api.get('/users/groups');
      const data = res?.data || res;
      const grps = Array.isArray(data) ? data : (data?.list || []);
      setGroups(grps);
    } catch (err) {
      console.error('获取分组失败:', err);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit };
      if (search) params.keyword = search;
      if (roleFilter) params.role = roleFilter;
      if (selectedGroupId) params.group_id = selectedGroupId;
      const res = await api.get('/users', { params });
      const data = res?.data || res;
      const list = data?.list || [];
      const totalCount = data?.total || 0;
      setUsers(list);
      setTotal(totalCount);
    } catch (err) {
      setError(err?.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, selectedGroupId, page]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  /* ================= 分组操作 ================= */
  const saveGroup = async (editId, name) => {
    try {
      if (editId) {
        await api.put(`/users/groups/${editId}`, { name });
      } else {
        await api.post('/users/groups', { name });
      }
      fetchGroups();
    } catch (err) {
      alert(err?.message || '保存分组失败');
    }
  };

  const deleteGroup = async (groupId) => {
    try {
      await api.delete(`/users/groups/${groupId}`);
      if (selectedGroupId === String(groupId)) setSelectedGroupId('');
      fetchGroups();
    } catch (err) {
      alert(err?.message || '删除分组失败');
    }
  };

  /* ================= 用户操作 ================= */
  const openAddUser = () => {
    setUserEditingId(null);
    setUserForm({
      username: '', real_name: '', password: '', role: '', group_id: '', phone: '', email: '',
    });
    setUserModalOpen(true);
  };

  const openEditUser = (user) => {
    setUserEditingId(user.id);
    setUserForm({
      username: user.username || '',
      real_name: user.real_name || '',
      password: '',
      role: user.role || '',
      group_id: user.group_id || '',
      phone: user.phone || '',
      email: user.email || '',
    });
    setUserModalOpen(true);
  };

  const saveUser = async () => {
    if (!userForm.username.trim() || !userForm.real_name.trim() || !userForm.role) return;
    if (!userEditingId && !userForm.password) {
      alert('请输入密码');
      return;
    }
    try {
      const payload = { ...userForm };
      if (userEditingId && !payload.password) delete payload.password;
      if (userEditingId) {
        await api.put(`/users/${userEditingId}`, payload);
      } else {
        await api.post('/users', payload);
      }
      setUserModalOpen(false);
      fetchUsers();
    } catch (err) {
      alert(err?.message || '保存失败');
    }
  };

  const toggleUserStatus = async (user) => {
    const action = user.status === 'active' ? '停用' : '启用';
    if (!window.confirm(`确定${action}用户「${user.real_name || user.username}」？`)) return;
    try {
      await api.put(`/users/${user.id}`, { status: user.status === 'active' ? 'inactive' : 'active' });
      fetchUsers();
    } catch (err) {
      alert(err?.message || '操作失败');
    }
  };

  /* ================= 批量选择 ================= */
  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === users.length && users.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(users.map(u => u.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selectedIds.size} 个用户？此操作不可恢复。`)) return;
    try {
      await api.post('/users/batch-delete', { ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      fetchUsers();
    } catch (err) {
      alert(err?.message || '批量删除失败');
    }
  };

  const handleDeleteUser = async (user) => {
    if (!window.confirm(`确定删除用户「${user.real_name || user.username}」？此操作不可恢复。`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      fetchUsers();
    } catch (err) {
      alert(err?.message || '删除失败');
    }
  };

  /* ================= 积分操作 ================= */
  const openPointAdjust = (user) => {
    setPointTarget(user);
    setPointModalOpen(true);
  };

  const savePointAdjust = async (userId, amount, reason) => {
    try {
      await api.put(`/users/${userId}/points`, { amount, reason });
      setPointModalOpen(false);
      setPointTarget(null);
      fetchUsers();
    } catch (err) {
      alert(err?.message || '积分调整失败');
    }
  };

  const openPointHistory = (user) => {
    setHistoryUserId(user.id);
    setHistoryModalOpen(true);
  };

  const openProfile = async (user) => {
    setProfileModalOpen(true);
    setProfileLoading(true);
    try {
      const res = await api.get(`/statistics/user-profile/${user.id}`);
      setProfileData(res.data);
    } catch (err) {
      console.error('获取用户画像失败:', err);
      setProfileData(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleExportProfiles = async () => {
    try {
      const res = await api.get('/statistics/export-profiles', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data || res]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `profiles_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + (err?.message || '未知错误'));
    }
  };

  /* ================= 批量导入 ================= */
  const parseCSV = (text) => {
    const lines = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (inQuote && text[i + 1] === '"') { current += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === '\n' && !inQuote) {
        lines.push(current);
        current = '';
      } else if (ch === '\r' && !inQuote) {
        // skip
      } else {
        current += ch;
      }
    }
    if (current) lines.push(current);

    const parseRow = (line) => {
      const cols = [];
      let col = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { col += '"'; i++; }
          else { inQ = !inQ; }
        } else if (ch === ',' && !inQ) {
          cols.push(col.trim());
          col = '';
        } else {
          col += ch;
        }
      }
      cols.push(col.trim());
      return cols;
    };

    const header = parseRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
    return lines.slice(1).map(line => {
      const vals = parseRow(line);
      const row = {};
      header.forEach((h, i) => { row[h] = vals[i] || ''; });
      return row;
    }).filter(r => r.username?.trim());
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = parseCSV(ev.target.result);
        setImportPreview(data);
      } catch (err) {
        alert('文件解析失败，请检查CSV格式');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleImport = async () => {
    if (importPreview.length === 0) return;
    setImporting(true);
    try {
      const res = await api.post('/users/batch', { users: importPreview });
      setImportResult(res.data || res);
      fetchUsers();
    } catch (err) {
      alert('导入失败: ' + (err?.message || '未知错误'));
    } finally {
      setImporting(false);
    }
  };

  /* ================= 渲染 ================= */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">用户管理</h1>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-rose-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">关闭</button>
        </div>
      )}

      {/* 分组标签行 */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedGroupId('')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              selectedGroupId === '' ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
            }`}
          >
            全部
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelectedGroupId(String(g.id))}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                selectedGroupId === String(g.id) ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
              }`}
            >
              {g.name} ({g.user_count ?? 0})
            </button>
          ))}
          <button
            onClick={() => setGroupModalOpen(true)}
            className="px-3 py-1.5 rounded-full text-sm text-warm-500 border border-dashed border-warm-200 hover:border-primary-400 hover:text-primary-600 transition flex items-center gap-1"
          >
            <Settings size={14} /> 管理分组
          </button>
          <div className="flex-1" />
        </div>
      </div>

      {/* 筛选 + 操作行 */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
        <div className="relative flex-1 min-w-0 sm:min-w-[200px] sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
          <input
            className="input pl-9 w-full"
            placeholder="搜索用户名/姓名..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-full sm:w-28" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">全部角色</option>
          <option value="admin">管理员</option>
          <option value="sales">业务员</option>
        </select>
        <div className="hidden sm:block flex-1" />
        <div className="flex flex-wrap gap-2">
          {selectedIds.size > 0 && (
            <button onClick={handleBatchDelete} className="btn-danger flex items-center gap-1.5 text-sm flex-1 sm:flex-none justify-center">
              <Trash2 size={16} /> 删除选中 ({selectedIds.size})
            </button>
          )}
          <button onClick={handleExportProfiles} className="btn-secondary flex items-center gap-1.5 text-sm flex-1 sm:flex-none justify-center">
            <Download size={16} /> 导出画像
          </button>
          <button onClick={() => { setImportModalOpen(true); setImportResult(null); setImportPreview([]); }} className="btn-secondary flex items-center gap-1.5 text-sm flex-1 sm:flex-none justify-center">
            <Upload size={16} /> 批量导入
          </button>
          <button onClick={openAddUser} className="btn-primary flex items-center gap-1.5 text-sm flex-1 sm:flex-none justify-center">
            <Plus size={16} /> 新建用户
          </button>
        </div>
      </div>

      {/* 用户列表 */}
      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-sm text-warm-400">
            <UsersIcon size={40} className="mx-auto mb-3 text-warm-300" />
            <p>暂无用户数据</p>
            <button onClick={openAddUser} className="text-primary-600 hover:text-primary-800 mt-1 underline">新建用户</button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr>
                    <th className="table-header w-10">
                      <input type="checkbox" checked={selectedIds.size === users.length && users.length > 0} onChange={toggleSelectAll} className="w-4 h-4 rounded accent-primary-600" />
                    </th>
                    <th className="table-header">姓名</th>
                    <th className="table-header">用户名</th>
                    <th className="table-header">角色</th>
                    <th className="table-header">分组</th>
                    <th className="table-header">手机</th>
                    <th className="table-header">状态</th>
                    <th className="table-header">积分</th>
                    <th className="table-header">称号</th>
                    <th className="table-header">创建时间</th>
                    <th className="table-header">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-100">
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="hover:bg-warm-50/80 cursor-pointer"
                      onClick={() => openPointHistory(user)}
                    >
                      <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(user.id)} onChange={() => toggleSelect(user.id)} className="w-4 h-4 rounded accent-primary-600" />
                      </td>
                      <td className="table-cell font-medium text-warm-900">{user.real_name || '-'}</td>
                      <td className="table-cell text-warm-600">{user.username}</td>
                      <td className="table-cell">
                        <span className={`badge text-xs ${user.role === 'admin' ? 'badge-red' : 'badge-blue'}`}>
                          {user.role === 'admin' ? '管理员' : '业务员'}
                        </span>
                      </td>
                      <td className="table-cell text-warm-500">{user.group_name || '-'}</td>
                      <td className="table-cell text-warm-500 text-xs">{user.phone || '-'}</td>
                      <td className="table-cell">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                          user.status === 'active' ? 'text-emerald-600' : 'text-rose-500'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            user.status === 'active' ? 'bg-emerald-500' : 'bg-rose-300'
                          }`} />
                          {user.status === 'active' ? '正常' : '停用'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={(e) => { e.stopPropagation(); openPointAdjust(user); }}
                          className="font-semibold text-primary-600 hover:text-primary-800 hover:underline"
                          title="点击调整积分"
                        >
                          {user.points ?? 0}
                        </button>
                      </td>
                      <td className="table-cell">
                        {(() => {
                          const lvl = getLevelInfo(user.total_earned_points);
                          return (
                            <span className={`text-xs font-medium ${lvl.color}`} title={`${lvl.desc || ''}`}>
                              {lvl.title}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="table-cell text-xs text-warm-400">{user.created_at || '-'}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1">
                          {user.role === 'sales' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); openProfile(user); }}
                              className="p-1.5 rounded-lg hover:bg-sky-50 text-warm-400 hover:text-sky-600 transition"
                              title="查看画像"
                            >
                              <Eye size={15} />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditUser(user); }}
                            className="p-1.5 rounded-lg hover:bg-warm-50 text-warm-400 hover:text-primary-600 transition"
                            title="编辑"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteUser(user); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-warm-400 hover:text-red-600 transition"
                            title="删除"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            <div className="flex items-center justify-between px-1 pt-3">
              <span className="text-sm text-warm-500">
                共 {total} 条，第 {page}/{Math.ceil(total / limit) || 1} 页
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setPage(p => Math.max(1, p - 1)); setSelectedIds(new Set()); }}
                  disabled={page <= 1}
                  className="p-2 rounded-lg border border-warm-200 hover:bg-warm-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} className="text-warm-600" />
                </button>
                {Array.from({ length: Math.min(5, Math.ceil(total / limit)) }, (_, i) => {
                  const totalPages = Math.ceil(total / limit);
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const pageNum = start + i;
                  if (pageNum > totalPages) return null;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => { setPage(pageNum); setSelectedIds(new Set()); }}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition ${
                        page === pageNum
                          ? 'bg-primary-600 text-white'
                          : 'border border-warm-200 text-warm-600 hover:bg-warm-50'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => { setPage(p => p + 1); setSelectedIds(new Set()); }}
                  disabled={page >= Math.ceil(total / limit)}
                  className="p-2 rounded-lg border border-warm-200 hover:bg-warm-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} className="text-warm-600" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ========== 分组管理弹窗 ========== */}
      <GroupModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        groups={groups}
        onSaveGroup={saveGroup}
        onDeleteGroup={deleteGroup}
      />

      {/* ========== 用户弹窗 ========== */}
      <UserModal
        open={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        onSave={saveUser}
        form={userForm}
        setForm={setUserForm}
        groups={groups}
        editingId={userEditingId}
      />

      {/* ========== 积分调整弹窗 ========== */}
      <PointModal
        open={pointModalOpen}
        onClose={() => { setPointModalOpen(false); setPointTarget(null); }}
        onSave={savePointAdjust}
        user={pointTarget}
      />

      {/* ========== 积分流水弹窗 ========== */}
      <PointHistoryModal
        open={historyModalOpen}
        onClose={() => { setHistoryModalOpen(false); setHistoryUserId(null); }}
        userId={historyUserId}
      />

      {/* ========== 用户画像弹窗 ========== */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setProfileModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-soft-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {profileLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
              </div>
            ) : !profileData ? (
              <div className="text-center py-20 text-warm-400">加载失败</div>
            ) : (
              <>
                {/* 头部 */}
                <div className="flex items-center justify-between p-6 border-b">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
                      <UsersIcon size={24} className="text-primary-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-warm-900">{profileData.user?.real_name || profileData.user?.username}</h3>
                      <p className="text-sm text-warm-500">
                        {profileData.user?.group_name || '未分组'} · 加入于 {profileData.user?.created_at ? new Date(profileData.user.created_at).toLocaleDateString('zh-CN') : '-'}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setProfileModalOpen(false)} className="text-warm-400 hover:text-warm-600">
                    <X size={20} />
                  </button>
                </div>

                {/* 统计概览 */}
                <div className="grid grid-cols-4 gap-3 p-6 border-b">
                  {[
                    { label: '总积分', value: profileData.stats?.total_points || 0, color: 'text-amber-500' },
                    { label: '完成课程', value: `${profileData.stats?.completed_courses || 0}/${profileData.stats?.total_courses || 0}`, color: 'text-sky-500' },
                    { label: '通过考试', value: `${profileData.stats?.passed_exams || 0}/${profileData.stats?.total_exams || 0}`, color: 'text-emerald-500' },
                    { label: '陪练次数', value: profileData.stats?.total_training || 0, color: 'text-purple-500' },
                  ].map((item, idx) => (
                    <div key={idx} className="text-center p-3 bg-warm-50/80 rounded-xl">
                      <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                      <p className="text-xs text-warm-400 mt-1">{item.label}</p>
                    </div>
                  ))}
                </div>

                {/* 六维能力 */}
                <div className="p-6">
                  <h4 className="font-semibold text-warm-900 mb-4">能力维度</h4>
                  {profileData.radar?.dimensions?.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {profileData.radar.dimensions.map((dim, idx) => {
                        const colors = ['bg-sky-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500', 'bg-indigo-500', 'bg-pink-500'];
                        const barColor = colors[idx % colors.length];
                        return (
                          <div key={idx} className="p-3 bg-warm-50/80 rounded-xl">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-warm-800">{dim.name}</span>
                              <span className="text-sm font-bold text-warm-900">{dim.score}<span className="text-warm-400 font-normal">/100</span></span>
                            </div>
                            <div className="w-full bg-warm-200 rounded-full h-2">
                              <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(100, dim.score)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-warm-400 text-center py-6">暂无能力数据</p>
                  )}
                </div>

                {/* 最近活动 */}
                <div className="p-6 border-t">
                  <h4 className="font-semibold text-warm-900 mb-4">最近活动</h4>
                  {profileData.recent_activities?.length > 0 ? (
                    <div className="space-y-2">
                      {profileData.recent_activities.map((act, idx) => (
                        <div key={idx} className="flex items-center gap-3 py-2 text-sm">
                          <span className="text-warm-400 text-xs shrink-0">
                            {act.created_at ? new Date(act.created_at).toLocaleString('zh-CN') : ''}
                          </span>
                          <span className="text-warm-700">{act.action || act.detail || '-'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-warm-400 text-center py-4">暂无活动记录</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ========== 批量导入弹窗 ========== */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setImportModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">批量导入用户</h3>
              <button onClick={() => setImportModalOpen(false)} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
            </div>

            {!importResult ? (
              <>
                {importPreview.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 border-2 border-dashed border-warm-200 rounded-xl">
                    <FileSpreadsheet size={48} className="text-warm-300 mb-3" />
                    <p className="text-warm-500 mb-3">选择 CSV 文件导入用户</p>
                    <div className="flex gap-3">
                      <a href="/templates/users_template.csv" download className="btn-secondary flex items-center gap-1.5 text-sm">
                        <Download size={14} /> 下载模板
                      </a>
                      <label className="btn-primary flex items-center gap-1.5 text-sm cursor-pointer">
                        <Upload size={14} /> 选择文件
                        <input type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
                      </label>
                    </div>
                    <p className="text-xs text-warm-400 mt-3">
                      CSV格式：username,real_name,password,role,phone,email,group_name
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-sm text-warm-600">
                        已选择 <strong>{importPreview.length}</strong> 条用户数据
                      </span>
                      <div className="flex-1" />
                      <button onClick={() => setImportPreview([])} className="text-sm text-warm-400 hover:text-warm-600">重新选择</button>
                    </div>
                    <div className="flex-1 overflow-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-warm-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-warm-600">用户名</th>
                            <th className="px-3 py-2 text-left text-warm-600">姓名</th>
                            <th className="px-3 py-2 text-left text-warm-600">角色</th>
                            <th className="px-3 py-2 text-left text-warm-600">手机</th>
                            <th className="px-3 py-2 text-left text-warm-600">邮箱</th>
                            <th className="px-3 py-2 text-left text-warm-600">分组</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.map((row, idx) => (
                            <tr key={idx} className="border-t">
                              <td className="px-3 py-2">{row.username}</td>
                              <td className="px-3 py-2">{row.real_name || row.name || '-'}</td>
                              <td className="px-3 py-2">{row.role === 'admin' ? '管理员' : '业务员'}</td>
                              <td className="px-3 py-2">{row.phone || '-'}</td>
                              <td className="px-3 py-2">{row.email || '-'}</td>
                              <td className="px-3 py-2">{row.group_name || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end gap-3 mt-4">
                      <button onClick={() => { setImportModalOpen(false); setImportPreview([]); }} className="btn-secondary text-sm">取消</button>
                      <button onClick={handleImport} disabled={importing} className="btn-primary text-sm">
                        {importing ? '导入中...' : `确认导入 ${importPreview.length} 条`}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-8">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-lg font-semibold text-warm-700 mb-2">导入完成</p>
                <div className="text-sm text-warm-500 space-y-1 text-center">
                  <p>成功导入 <strong className="text-green-600">{importResult.success}</strong> 个用户</p>
                  {importResult.skipped > 0 && <p>跳过 <strong className="text-amber-600">{importResult.skipped}</strong> 个（用户名已存在）</p>}
                  {importResult.errors?.length > 0 && (
                    <div className="mt-2 text-left">
                      <p className="text-red-500 font-medium mb-1">失败 {importResult.errors.length} 条：</p>
                      <div className="max-h-32 overflow-auto">
                        {importResult.errors.map((err, i) => (
                          <p key={i} className="text-red-400 text-xs">第{err.row}行 {err.username}: {err.reason}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={() => { setImportModalOpen(false); setImportPreview([]); setImportResult(null); }} className="btn-primary mt-6 text-sm">完成</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
