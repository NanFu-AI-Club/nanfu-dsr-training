import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Edit3, Trash2, X, Power, PowerOff, MessageSquare,
} from 'lucide-react';
import api from '../../api';
import { formatShanghai } from '../../utils/time';

const STATUS_LABELS = {
  active: '启用',
  inactive: '停用',
};

const DIFFICULTY_LABELS = {
  hot: '热点必练',
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

/* ================= 弹窗表单 ================= */
function ScenarioModal({ open, onClose, onSave, form, setForm, editingId }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{editingId ? '编辑情景' : '新建情景'}</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          {/* 情景名称 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">情景名称 *</label>
            <input
              className="input"
              value={form.title || ''}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="如：超市采购经理谈判"
            />
          </div>
          {/* 角色类型 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">角色类型 *</label>
            <input
              className="input"
              value={form.role_type || ''}
              onChange={(e) => setForm({ ...form, role_type: e.target.value })}
              placeholder="如：超市采购经理"
            />
          </div>
          {/* 难度 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">难度 *</label>
            <select
              className="input"
              value={form.difficulty || 'medium'}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
            >
              <option value="hot">热点必练</option>
              <option value="easy">简单</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
          </div>
          {/* 描述 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">描述</label>
            <textarea
              className="input min-h-[80px] resize-y"
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="情景描述，帮助用户了解该场景的背景和目的"
            />
          </div>
          {/* 提示词 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">提示词 (Scenario Prompt) *</label>
            <textarea
              className="input min-h-[160px] resize-y font-mono text-sm"
              value={form.scenario_prompt || ''}
              onChange={(e) => setForm({ ...form, scenario_prompt: e.target.value })}
              placeholder="AI 角色扮演的系统提示词，定义 AI 的角色、行为、对话风格等。这是最重要的字段。"
            />
          </div>
          {/* 卖进目标 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">卖进目标</label>
            <textarea
              className="input min-h-[60px] resize-y"
              value={form.sales_goal || ''}
              onChange={(e) => setForm({ ...form, sales_goal: e.target.value })}
              placeholder="如：成功说服客户采购南孚电池200箱 / 达成首单合作 / 促成季度框架协议"
            />
            <p className="text-xs text-warm-500 mt-1">本次FU利陪陪的销售目标，AI会根据销售代表的表现决定是否达成，评估报告也会基于目标达成度打分</p>
          </div>
          {/* 跳转链接 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">跳转链接</label>
            <input
              className="input"
              type="url"
              value={form.link_url || ''}
              onChange={(e) => setForm({ ...form, link_url: e.target.value })}
              placeholder="如：https://example.com/product（选填，场景卡片上会显示跳转入口）"
            />
            <p className="text-xs text-warm-500 mt-1">选填。配置后，业务员在情景卡片上可点击跳转到该外部链接。</p>
          </div>
          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">标签</label>
            <input
              className="input"
              value={form.tags || ''}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="多个标签用逗号分隔，如：谈判,采购,电池"
            />
          </div>
          {/* 状态 */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">状态</label>
            <select
              className="input"
              value={form.status || 'active'}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
          {/* 按钮 */}
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button onClick={onSave} className="btn-primary">保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= 主页面 ================= */
export default function TrainingScenarios() {
  const [scenarios, setScenarios] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    title: '',
    role_type: '',
    difficulty: 'medium',
    description: '',
    scenario_prompt: '',
    sales_goal: '',
    link_url: '',
    tags: '',
    status: 'active',
  });

  /* ================= 数据加载 ================= */
  const fetchScenarios = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      } else {
        params.status = 'all';
      }
      const res = await api.get('/training/scenarios', { params });
      const data = res?.data || res;
      setScenarios(data?.list || []);
      setTotal(data?.total || 0);
    } catch (err) {
      setError(err?.message || '获取情景列表失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchScenarios(); }, [fetchScenarios]);

  /* ================= 表单操作 ================= */
  const openCreate = () => {
    setEditingId(null);
    setForm({
      title: '',
      role_type: '',
      difficulty: 'medium',
      description: '',
      scenario_prompt: '',
      sales_goal: '',
      link_url: '',
      tags: '',
      status: 'active',
    });
    setModalOpen(true);
  };

  const openEdit = (scenario) => {
    setEditingId(scenario.id);
    setForm({
      title: scenario.title || '',
      role_type: scenario.role_type || '',
      difficulty: scenario.difficulty || 'medium',
      description: scenario.description || '',
      scenario_prompt: scenario.scenario_prompt || '',
      sales_goal: scenario.sales_goal || '',
      link_url: scenario.link_url || '',
      tags: Array.isArray(scenario.tags) ? scenario.tags.join(', ') : (scenario.tags || ''),
      status: scenario.status || 'active',
    });
    setModalOpen(true);
  };

  const saveScenario = async () => {
    if (!form.title.trim()) {
      alert('请输入情景名称');
      return;
    }
    if (!form.role_type.trim()) {
      alert('请输入角色类型');
      return;
    }
    if (!form.scenario_prompt.trim()) {
      alert('请输入提示词');
      return;
    }
    try {
      const payload = {
        ...form,
        tags: form.tags
          ? form.tags.split(',').map((t) => t.trim()).filter(Boolean).join(',')
          : null,
      };
      if (editingId) {
        await api.put(`/training/scenarios/${editingId}`, payload);
      } else {
        await api.post('/training/scenarios', payload);
      }
      setModalOpen(false);
      fetchScenarios();
    } catch (err) {
      alert(err?.message || '保存失败');
    }
  };

  /* ================= 删除 ================= */
  const deleteScenario = async (scenario) => {
    if (!window.confirm(`确定删除情景「${scenario.title}」？此操作不可撤销，相关FU利陪陪会话数据也会被清除。`)) return;
    try {
      await api.delete(`/training/scenarios/${scenario.id}`);
      fetchScenarios();
    } catch (err) {
      alert(err?.message || '删除失败');
    }
  };

  /* ================= 切换状态 ================= */
  const toggleStatus = async (scenario) => {
    const newStatus = scenario.status === 'active' ? 'inactive' : 'active';
    try {
      await api.put(`/training/scenarios/${scenario.id}`, { status: newStatus });
      fetchScenarios();
    } catch (err) {
      alert(err?.message || '操作失败');
    }
  };

  /* ================= 渲染辅助 ================= */
  const difficultyBadge = (d) => {
    const map = {
      hot: 'bg-orange-100 text-orange-700',
      easy: 'bg-emerald-100 text-emerald-700',
      medium: 'bg-accent-100 text-yellow-700',
      hard: 'bg-rose-100 text-red-700',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[d] || 'bg-warm-100 text-warm-600'}`}>
        {DIFFICULTY_LABELS[d] || d}
      </span>
    );
  };

  const statusBadge = (s) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
      s === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-warm-100 text-warm-500'
    }`}>
      {STATUS_LABELS[s] || s}
    </span>
  );

  /* ================= 渲染 ================= */
  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h1 className="page-title">FU利陪陪情景管理</h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={16} /> 新建情景
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-rose-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">关闭</button>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-warm-500 mr-1">状态筛选：</span>
        {[
          { key: 'all', label: '全部' },
          { key: 'active', label: '启用' },
          { key: 'inactive', label: '停用' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setStatusFilter(item.key)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
              statusFilter === item.key
                ? 'bg-gradient-to-br from-sky-500 to-primary-600 text-white shadow-soft hover:shadow-soft-lg'
                : 'bg-white text-warm-600 border border-warm-100/60 hover:bg-warm-50/80'
            }`}
          >
            {item.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-warm-400">共 {total} 个情景</span>
      </div>

      {/* 表格 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
        </div>
      ) : scenarios.length === 0 ? (
        <div className="card text-center py-16 text-sm text-warm-400">
          <MessageSquare size={40} className="mx-auto mb-3 text-warm-300" />
          <p>暂无情景数据</p>
          <button onClick={openCreate} className="text-primary-600 hover:text-primary-800 mt-1 underline">新建情景</button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-warm-50/80">
                  <th className="text-left px-4 py-3 font-medium text-warm-500">情景名称</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-500">角色类型</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-500">卖进目标</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-500">难度</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-500">状态</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-500">创建时间</th>
                  <th className="text-center px-4 py-3 font-medium text-warm-500">操作</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => (
                  <tr key={s.id} className="border-b last:border-b-0 hover:bg-warm-50/80 transition">
                    <td className="px-4 py-3">
                      <div className="font-medium text-warm-900">{s.title}</div>
                      {s.tags && (Array.isArray(s.tags) ? s.tags.filter(Boolean) : []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(Array.isArray(s.tags) ? s.tags : []).filter(Boolean).map((tag, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 bg-warm-100 text-warm-500 rounded text-xs">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-warm-700">{s.role_type}</td>
                    <td className="px-4 py-3 text-warm-600 text-xs">{s.sales_goal || '-'}</td>
                    <td className="px-4 py-3">{difficultyBadge(s.difficulty)}</td>
                    <td className="px-4 py-3">{statusBadge(s.status)}</td>
                    <td className="px-4 py-3 text-warm-500 text-xs">
                      {s.created_at ? formatShanghai(s.created_at) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {/* 启用/停用切换 */}
                        <button
                          onClick={() => toggleStatus(s)}
                          className={`p-1.5 rounded hover:bg-warm-100 transition ${
                            s.status === 'active' ? 'text-warm-400 hover:text-orange-500' : 'text-warm-400 hover:text-green-500'
                          }`}
                          title={s.status === 'active' ? '停用' : '启用'}
                        >
                          {s.status === 'active' ? <PowerOff size={15} /> : <Power size={15} />}
                        </button>
                        {/* 编辑 */}
                        <button
                          onClick={() => openEdit(s)}
                          className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-sky-500 transition"
                          title="编辑"
                        >
                          <Edit3 size={15} />
                        </button>
                        {/* 删除 */}
                        <button
                          onClick={() => deleteScenario(s)}
                          className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-rose-500 transition"
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
        </div>
      )}

      {/* 弹窗 */}
      <ScenarioModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={saveScenario}
        form={form}
        setForm={setForm}
        editingId={editingId}
      />
    </div>
  );
}
