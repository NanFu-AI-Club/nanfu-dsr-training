import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Edit3, X, Users as UsersIcon, History, Eye, Download, Upload, FileSpreadsheet, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { formatShanghai, formatDateShanghai, todayShanghai } from '../../utils/time';

const ROLE_OPTIONS = [
  { value: 'sales', managerType: '', label: '业务员' },
  { value: 'admin', managerType: 'system_admin', label: '系统管理员' },
  { value: 'admin', managerType: 'region_manager', label: '大区经理' },
  { value: 'admin', managerType: 'area_manager', label: '区域经理' },
  { value: 'sales', managerType: 'city_manager', label: '城市经理（销售端）' },
];

function roleLabel(user) {
  if (user.manager_type === 'region_manager') return '大区经理';
  if (user.manager_type === 'area_manager') return '区域经理';
  if (user.manager_type === 'city_manager') return user.role === 'sales' ? '城市经理（销售端）' : '城市经理';
  if (user.manager_type === 'system_admin' || user.role === 'admin') return '系统管理员';
  return '业务员';
}

function getAreaId(regions, regionId) {
  const region = regions.find((item) => String(item.id) === String(regionId));
  return region?.level === 1 ? region.id : region?.parent_id || '';
}

function getAreaName(regions, regionId) {
  const region = regions.find((item) => String(item.id) === String(regionId));
  if (!region) return '-';
  if (region.level === 1) return region.name;
  const parent = regions.find((item) => String(item.id) === String(region.parent_id));
  return parent?.name || region.name || '-';
}

/* ========== 等级/称号配置 ========== */
const LEVELS = [
  { level: 1, title: '江湖跑侠', min: 0, max: 499, color: 'text-stone-500', bg: 'bg-stone-100', desc: '初闯终端江湖，开启跑店历练' },
  { level: 2, title: '拓店游侠', min: 500, max: 1499, color: 'text-emerald-600', bg: 'bg-emerald-50', desc: '奔走各大门店，拓店小有收获' },
  { level: 3, title: '终端先锋', min: 1500, max: 2999, color: 'text-blue-600', bg: 'bg-blue-50', desc: '熟稔门店谈判，终端得心应手' },
  { level: 4, title: '销冠大咖', min: 3000, max: 4999, color: 'text-purple-600', bg: 'bg-purple-50', desc: '实战战绩突出，团队中坚力量' },
  { level: 5, title: '销冠王者', min: 5000, max: Infinity, color: 'text-amber-500', bg: 'bg-amber-50', desc: '一线顶尖标杆，众人学习榜样' },
];

function getLevelInfo(totalEarnedPoints) {
  const pts = totalEarnedPoints || 0;
  const current = LEVELS.find(l => pts >= l.min && pts <= l.max) || LEVELS[0];
  return current;
}

/* ================= 用户弹窗表单 ================= */
function UserModal({ open, onClose, onSave, form, setForm, regions = [], cities = [], editingId, canCreate, currentUser }) {
  if (!open) return null;

  const isSystemAdmin = form.manager_type === 'system_admin' || !form.manager_type && form.role === 'admin';
  const isSalesRole = form.role === 'sales';
  // 只有业务员有所属经销商，管理员 / 城市经理不涉及
  const isSalesmanRole = form.role === 'sales' && !form.manager_type;
  // 大区经理/区域经理只能在本辖区内建号：限制可选大区、细分区域与角色
  const viewerIsSystemAdmin = !currentUser?.manager_type || currentUser?.manager_type === 'system_admin';
  const myRegion = regions.find((region) => String(region.id) === String(currentUser?.region_id));
  const areaRegions = viewerIsSystemAdmin
    ? regions.filter((region) => region.level === 1)
    : (myRegion?.level === 1
        ? [myRegion]
        : (myRegion ? regions.filter((region) => String(region.id) === String(myRegion.parent_id)) : []));
  const subRegions = (() => {
    if (viewerIsSystemAdmin) {
      return regions.filter((region) => region.level === 2 && (!form.area_id || String(region.parent_id) === String(form.area_id)));
    }
    if (!myRegion) return [];
    if (myRegion.level === 1) {
      return regions.filter((region) => region.level === 2 && String(region.parent_id) === String(myRegion.id));
    }
    return [myRegion];
  })();
  const roleOptions = viewerIsSystemAdmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((option) => option.managerType === '' || option.managerType === 'city_manager');
  const visibleCities = cities.filter((city) => !form.region_id || String(city.region_id) === String(form.region_id));
  // 编辑已有用户时，各级经理不能修改角色与组织归属（后端会拒绝），直接锁定字段并给出提示，避免改了没反应
  const lockOrgFields = Boolean(editingId) && !viewerIsSystemAdmin;
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
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">角色 *</label>
            <select className="input" value={`${form.role}:${form.manager_type || ''}`} onChange={(e) => {
              const [role, manager_type] = e.target.value.split(':');
              const nextForm = { ...form, role, manager_type };
              if (manager_type === 'city_manager') {
                nextForm.role = 'sales';
                nextForm.city_id = '';
              }
              if (manager_type === 'system_admin') {
                nextForm.area_id = '';
                nextForm.region_id = '';
                nextForm.city_id = '';
              }
              if (manager_type === 'region_manager') {
                nextForm.area_id = '';
                nextForm.region_id = '';
                nextForm.city_id = '';
              }
              if (manager_type === 'area_manager') {
                nextForm.region_id = '';
                nextForm.city_id = '';
              }
              setForm(nextForm);
            }} disabled={!canCreate || lockOrgFields}>
              <option value=":">请选择</option>
              {roleOptions.map((option) => (
                <option key={`${option.value}:${option.managerType}`} value={`${option.value}:${option.managerType}`}>{option.label}</option>
              ))}
            </select>
          </div>
          {lockOrgFields && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
              各级经理不能修改已有用户的角色和组织归属（大区 / 细分区域 / 城市），如需调整请联系系统管理员。
              姓名、手机、邮箱、所属经销商、密码都可以直接改。
            </p>
          )}
          {!isSystemAdmin && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">所属大区</label>
                <select
                  className="input"
                  disabled={lockOrgFields}
                  value={form.area_id || ''}
                  onChange={(e) => setForm({
                    ...form,
                    area_id: e.target.value,
                    region_id: form.manager_type === 'region_manager' ? e.target.value : '',
                    city_id: ''
                  })}
                >
                  <option value="">请选择大区</option>
                  {areaRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">所属细分区域</label>
                <select
                  className="input"
                  value={form.region_id || ''}
                  disabled={!form.area_id || lockOrgFields}
                  onChange={(e) => setForm({ ...form, region_id: e.target.value, city_id: '' })}
                >
                  <option value="">{form.area_id ? '请选择细分区域' : '先选择大区'}</option>
                  {subRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">所属城市</label>
                <select
                  className="input"
                  value={form.city_id || ''}
                  disabled={!form.region_id || lockOrgFields}
                  onChange={(e) => setForm({ ...form, city_id: e.target.value })}
                >
                  <option value="">{form.region_id ? (visibleCities.length ? '请选择城市（可选）' : '该区域暂无城市') : '先选择细分区域'}</option>
                  {visibleCities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {isSystemAdmin && (
            <p className="text-xs text-warm-400">系统管理员不需要绑定大区、细分区域或城市。</p>
          )}
          {isSalesRole && (
            <p className="text-xs text-warm-400">业务员和城市经理必须绑定细分区域，城市可选。</p>
          )}
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
          {isSalesmanRole && (
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                所属经销商 <span className="text-rose-500">*</span>
              </label>
              <input className="input" value={form.dealer_name || ''} onChange={(e) => setForm({ ...form, dealer_name: e.target.value })} placeholder="如：合肥鑫达商贸有限公司" />
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button onClick={onSave} className="btn-primary">保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= 积分调整弹窗 ================= */
function PointModal({ open, onClose, onSave, user }) {
  const [amount, setAmount] = useState('');
  const [totalEarnedAmount, setTotalEarnedAmount] = useState('');
  const [reason, setReason] = useState('');

  if (!open) return null;

  const handleSave = () => {
    const amountNum = amount === '' ? 0 : Number(amount);
    const totalNum = totalEarnedAmount === '' ? 0 : Number(totalEarnedAmount);
    if (isNaN(amountNum) || isNaN(totalNum)) {
      alert('请输入有效的积分数值');
      return;
    }
    if (amountNum === 0 && totalNum === 0) {
      alert('请至少填写一项积分变动');
      return;
    }
    if (!reason.trim()) {
      alert('请输入调整原因');
      return;
    }
    onSave(user.id, amountNum, totalNum, reason);
    setAmount('');
    setTotalEarnedAmount('');
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
            <p className="text-xs text-warm-400">当前积分: {user?.points ?? 0} · 累计总积分: {user?.total_earned_points ?? 0}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">当前积分变动（正数增加，负数扣减）</label>
            <input
              className="input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="如 +10 或 -5"
            />
            <p className="text-xs text-warm-400 mt-1">用于可用余额（商城兑换会扣减）；填正数时会同步计入累计总积分</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">累计总积分变动（正数增加，负数扣减）</label>
            <input
              className="input"
              type="number"
              value={totalEarnedAmount}
              onChange={(e) => setTotalEarnedAmount(e.target.value)}
              placeholder="如 +100 或 -50"
            />
            <p className="text-xs text-warm-400 mt-1">用于称号等级与排行榜，不影响可用余额</p>
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
  const { user: currentUser } = useAuth();
  const isSystemAdmin = currentUser?.manager_type === 'system_admin' || !currentUser?.manager_type;
  const isOrgManager = currentUser?.manager_type === 'region_manager' || currentUser?.manager_type === 'area_manager';
  const canCreateUsers = isSystemAdmin || isOrgManager;
  const canManageTarget = (target) => {
    if (!target || target.id === currentUser?.id) return false;
    if (isSystemAdmin) return true;
    if (target.role !== 'sales') return false;
    if (currentUser?.manager_type === 'city_manager') return target.city_id === currentUser.city_id;
    const accessibleIds = new Set(
      regions
        .filter((region) => region.id === currentUser?.region_id || region.parent_id === currentUser?.region_id)
        .map((region) => region.id)
    );
    return accessibleIds.has(target.region_id);
  };
  const [regions, setRegions] = useState([]);
  const [cities, setCities] = useState([]);

  // ---- 大区过滤 ----
  const [selectedAreaId, setSelectedAreaId] = useState('');
  // ---- 细分区域过滤（选项跟随所选大区联动）----
  const [selectedRegionId, setSelectedRegionId] = useState('');

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
    username: '', real_name: '', password: '', role: '', manager_type: '', area_id: '', region_id: '', city_id: '', phone: '', email: '', dealer_name: '',
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
  const fetchOrg = useCallback(async () => {
    try {
      const [regionRes, cityRes] = await Promise.all([api.get('/users/regions'), api.get('/users/cities')]);
      setRegions(regionRes?.data || regionRes || []);
      setCities(cityRes?.data || cityRes || []);
    } catch (err) {
      console.error('获取组织架构失败:', err);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit };
      if (search) params.keyword = search;
      if (roleFilter) params.role_type = roleFilter;
      if (selectedAreaId) params.area_id = selectedAreaId;
      if (selectedRegionId) params.region_id = selectedRegionId;
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
  }, [search, roleFilter, selectedAreaId, selectedRegionId, page]);

  // 细分区域选项：未选大区时列出全部，选中大区后只显示该大区下的区域
  const areaSubRegions = regions.filter((r) => r.level === 2 && (!selectedAreaId || String(r.parent_id) === String(selectedAreaId)));

  useEffect(() => { fetchOrg(); }, [fetchOrg]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  /* ================= 用户操作 ================= */
  const openAddUser = () => {
    setUserEditingId(null);
    // 大区经理/区域经理新建时自动锁定自己的辖区，避免误选到别的区域
    const myRegion = regions.find((region) => String(region.id) === String(currentUser?.region_id));
    let areaId = '';
    let regionId = '';
    if (!isSystemAdmin && myRegion) {
      if (myRegion.level === 1) {
        areaId = myRegion.id;
      } else {
        areaId = myRegion.parent_id || '';
        regionId = myRegion.id;
      }
    }
    setUserForm({
      username: '', real_name: '', password: '', role: 'sales', manager_type: '', area_id: areaId, region_id: regionId, city_id: '', phone: '', email: '', dealer_name: '',
    });
    setUserModalOpen(true);
  };

  const openEditUser = (user) => {
    setUserEditingId(user.id);
    setUserForm({
      username: user.username || '',
      real_name: user.real_name || '',
      password: '',
      role: user.role || 'sales',
      manager_type: user.manager_type || '',
      area_id: getAreaId(regions, user.region_id),
      region_id: user.region_id || '',
      city_id: user.city_id || '',
      dealer_name: user.dealer_name || '',
      phone: user.phone || '',
      email: user.email || '',
    });
    setUserModalOpen(true);
  };

  const saveUser = async () => {
    // 原来这里校验不通过会静默返回（点了保存没反应），改为给出明确提示
    if (!userForm.username.trim()) { alert('请填写用户名'); return; }
    if (!userForm.real_name.trim()) { alert('请填写真实姓名'); return; }
    if (!userForm.role) { alert('请选择角色'); return; }
    if (!userEditingId && !userForm.password) {
      alert('请输入密码');
      return;
    }
    const isSalesmanForm = userForm.role === 'sales' && !userForm.manager_type;
    if (!userEditingId && isSalesmanForm && !userForm.dealer_name?.trim()) {
      alert('请填写所属经销商');
      return;
    }
    try {
      const payload = { ...userForm };
      delete payload.area_id;
      // 非业务员不保留经销商信息
      if (!isSalesmanForm) payload.dealer_name = '';
      if (userEditingId && !isSystemAdmin) {
        delete payload.role;
        delete payload.manager_type;
        delete payload.region_id;
        delete payload.city_id;
      }
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

  const savePointAdjust = async (userId, amount, totalEarnedAmount, reason) => {
    try {
      await api.put(`/users/${userId}/points`, { amount, total_earned_amount: totalEarnedAmount, reason });
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
      link.setAttribute('download', `profiles_${todayShanghai()}.csv`);
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
      const res = await api.post('/users/batch', { users: importPreview }, { timeout: 300000 });
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

      {/* 大区 / 细分区域筛选 */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setSelectedAreaId(''); setSelectedRegionId(''); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              selectedAreaId === '' ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
            }`}
          >
            全部
          </button>
          {regions.filter((r) => r.level === 1).map((area) => (
            <button
              key={area.id}
              onClick={() => { setSelectedAreaId(String(area.id)); setSelectedRegionId(''); }}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                selectedAreaId === String(area.id) ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg' : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
              }`}
            >
              {area.name}
            </button>
          ))}
          <div className="flex-1" />
          <select
            className="input w-full sm:w-44"
            value={selectedRegionId}
            onChange={(e) => setSelectedRegionId(e.target.value)}
            title="按区域筛选"
          >
            <option value="">全部区域</option>
            {areaSubRegions.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
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
        <select className="input w-full sm:w-32" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">全部角色</option>
          <option value="sales">业务员</option>
          <option value="system_admin">系统管理员</option>
          <option value="region_manager">大区经理</option>
          <option value="area_manager">区域经理</option>
          <option value="city_manager">城市经理</option>
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
          {isSystemAdmin && (
            <button onClick={() => { setImportModalOpen(true); setImportResult(null); setImportPreview([]); }} className="btn-secondary flex items-center gap-1.5 text-sm flex-1 sm:flex-none justify-center">
              <Upload size={16} /> 批量导入
            </button>
          )}
          {canCreateUsers && (
            <button onClick={openAddUser} className="btn-primary flex items-center gap-1.5 text-sm flex-1 sm:flex-none justify-center">
              <Plus size={16} /> 新建用户
            </button>
          )}
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
            {canCreateUsers && (
              <button onClick={openAddUser} className="text-primary-600 hover:text-primary-800 mt-1 underline">新建用户</button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px]">
                <thead>
                  <tr>
                    <th className="table-header sticky left-0 z-20 !bg-warm-50 w-12">
                      <input type="checkbox" checked={selectedIds.size === users.length && users.length > 0} onChange={toggleSelectAll} className="w-4 h-4 rounded accent-primary-600" />
                    </th>
                    <th className="table-header sticky left-12 z-20 !bg-warm-50 min-w-[92px]">姓名</th>
                    <th className="table-header whitespace-nowrap">用户名</th>
                    <th className="table-header whitespace-nowrap">角色</th>
                    <th className="table-header whitespace-nowrap">大区</th>
                    <th className="table-header whitespace-nowrap">区域</th>
                    <th className="table-header whitespace-nowrap">所属经销商</th>
                    <th className="table-header whitespace-nowrap">手机</th>
                    <th className="table-header whitespace-nowrap">状态</th>
                    <th className="table-header whitespace-nowrap">当前积分</th>
                    <th className="table-header whitespace-nowrap">累计积分</th>
                    <th className="table-header whitespace-nowrap">称号</th>
                    <th className="table-header whitespace-nowrap">创建时间</th>
                    <th className="table-header whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-100">
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="group hover:bg-warm-50/80 cursor-pointer"
                      onClick={() => openPointHistory(user)}
                    >
                      <td className="table-cell sticky left-0 z-10 w-12 bg-white group-hover:bg-warm-50" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(user.id)} onChange={() => toggleSelect(user.id)} className="w-4 h-4 rounded accent-primary-600" />
                      </td>
                      <td className="table-cell sticky left-12 z-10 bg-white group-hover:bg-warm-50 font-medium text-warm-900 whitespace-nowrap">{user.real_name || '-'}</td>
                      <td className="table-cell text-warm-600 whitespace-nowrap">{user.username}</td>
                      <td className="table-cell">
                        <span className={`badge text-xs whitespace-nowrap ${user.role === 'admin' ? 'badge-red' : 'badge-blue'}`}>
                          {roleLabel(user)}
                        </span>
                      </td>
                      <td className="table-cell text-warm-500 whitespace-nowrap">{getAreaName(regions, user.region_id)}</td>
                      <td className="table-cell text-warm-600 whitespace-nowrap">{user.region_name || '-'}</td>
                      <td className="table-cell text-warm-500 whitespace-nowrap">{user.dealer_name || '-'}</td>
                      <td className="table-cell text-warm-500 text-xs whitespace-nowrap">{user.phone || '-'}</td>
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
                        {isSystemAdmin ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); openPointAdjust(user); }}
                            className="font-semibold text-primary-600 hover:text-primary-800 hover:underline"
                            title="点击调整积分"
                          >
                            {user.points ?? 0}
                          </button>
                        ) : (
                          <span className="font-semibold text-warm-700">{user.points ?? 0}</span>
                        )}
                      </td>
                      <td className="table-cell">
                        {isSystemAdmin ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); openPointAdjust(user); }}
                            className="font-semibold text-amber-600 hover:text-amber-800 hover:underline"
                            title="点击调整累计总积分"
                          >
                            {user.total_earned_points ?? 0}
                          </button>
                        ) : (
                          <span className="font-semibold text-warm-700">{user.total_earned_points ?? 0}</span>
                        )}
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
                      <td className="table-cell text-xs text-warm-400 whitespace-nowrap">{(user.created_at || '').slice(0, 10) || '-'}</td>
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
                          {canManageTarget(user) && (
                            <>
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
                            </>
                          )}
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

      {/* ========== 用户弹窗 ========== */}
      <UserModal
        open={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        onSave={saveUser}
        form={userForm}
        setForm={setUserForm}
        regions={regions}
        cities={cities}
        editingId={userEditingId}
        canCreate={canCreateUsers}
        currentUser={currentUser}
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
                        {profileData.user?.region_name || '未分配区域'}
                        {profileData.user?.dealer_name ? ` · ${profileData.user.dealer_name}` : ''}
                        {' · 加入于 '}{profileData.user?.created_at ? formatDateShanghai(profileData.user.created_at) : '-'}
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
                    { label: 'FU利陪陪次数', value: profileData.stats?.total_training || 0, color: 'text-purple-500' },
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
                            {act.created_at ? formatShanghai(act.created_at) : ''}
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
                      CSV格式：username,real_name,password,role,manager_type,region_name,city_name,region_id,city_id,dealer_name,phone,email
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
                            <th className="px-3 py-2 text-left text-warm-600">区域</th>
                            <th className="px-3 py-2 text-left text-warm-600">城市</th>
                            <th className="px-3 py-2 text-left text-warm-600">所属经销商</th>
                            <th className="px-3 py-2 text-left text-warm-600">手机</th>
                            <th className="px-3 py-2 text-left text-warm-600">邮箱</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.map((row, idx) => (
                            <tr key={idx} className="border-t">
                              <td className="px-3 py-2">{row.username}</td>
                              <td className="px-3 py-2">{row.real_name || row.name || '-'}</td>
                              <td className="px-3 py-2">{roleLabel(row)}</td>
                              <td className="px-3 py-2">{row.region_name || row.region_id || '-'}</td>
                              <td className="px-3 py-2">{row.city_name || row.city_id || '-'}</td>
                              <td className="px-3 py-2">{row.dealer_name || '-'}</td>
                              <td className="px-3 py-2">{row.phone || '-'}</td>
                              <td className="px-3 py-2">{row.email || '-'}</td>
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
