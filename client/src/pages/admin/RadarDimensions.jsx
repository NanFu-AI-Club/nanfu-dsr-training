import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Save, Trash2, Loader2, Star, BookOpen, TrendingUp, MessageSquare,
  Users, FileText, Heart, Clock, ToggleLeft, ToggleRight, X, Edit3, Target,
} from 'lucide-react';
import api from '../../api';

const ICON_OPTIONS = [
  { value: 'book', label: '书本', Icon: BookOpen },
  { value: 'trending', label: '趋势', Icon: TrendingUp },
  { value: 'message', label: '消息', Icon: MessageSquare },
  { value: 'users', label: '用户', Icon: Users },
  { value: 'heart', label: '心形', Icon: Heart },
  { value: 'clock', label: '时钟', Icon: Clock },
  { value: 'file', label: '文件', Icon: FileText },
  { value: 'star', label: '星星', Icon: Star },
  { value: 'target', label: '目标', Icon: Target },
];

export default function RadarDimensions() {
  const [dimensions, setDimensions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState({});
  const [message, setMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ key: '', name: '', description: '', icon: 'star', weight: 1.0 });

  const loadDimensions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/statistics/radar-dimensions');
      setDimensions(res.data || []);
    } catch (err) {
      console.error('加载雷达维度失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDimensions(); }, [loadDimensions]);

  const handleUpdate = async (id, field, value) => {
    setSaving(prev => ({ ...prev, [id]: true }));
    try {
      await api.put(`/statistics/radar-dimensions/${id}`, { [field]: value });
      setDimensions(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
      setMessage('保存成功');
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      setMessage('保存失败');
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setSaving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleAdd = async () => {
    if (!addForm.key.trim() || !addForm.name.trim()) {
      alert('key 和名称为必填项');
      return;
    }
    try {
      await api.post('/statistics/radar-dimensions', {
        ...addForm,
        sort_order: dimensions.length + 1,
      });
      setShowAddModal(false);
      setAddForm({ key: '', name: '', description: '', icon: 'star', weight: 1.0 });
      loadDimensions();
      setMessage('添加成功');
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      alert(err?.message || '添加失败');
    }
  };

  const handleDelete = async (dim) => {
    if (!window.confirm(`确定删除维度「${dim.name}」？删除后雷达图将不再显示该维度。`)) return;
    try {
      await api.delete(`/statistics/radar-dimensions/${dim.id}`);
      loadDimensions();
    } catch (err) {
      alert('删除失败');
    }
  };

  const getIconComponent = (iconKey) => {
    const found = ICON_OPTIONS.find(o => o.value === iconKey);
    return found ? found.Icon : Star;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="page-title">能力维度设置</h2>
        <div className="flex items-center gap-3">
          {message && (
            <span className={`px-3 py-1.5 rounded-xl text-sm font-medium ${
              message.includes('成功') ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
            }`}>
              {message}
            </span>
          )}
          <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={16} /> 新增维度
          </button>
        </div>
      </div>

      <div className="card">
        <p className="text-sm text-warm-500 mb-6">
          配置用户画像雷达图的维度。维度名称、描述、权重和启用状态均可调整，修改后立即生效。
        </p>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={28} className="animate-spin text-primary-600" />
          </div>
        ) : (
          <div className="space-y-3">
            {dimensions.map((dim) => {
              const Icon = getIconComponent(dim.icon);
              const isSaving = saving[dim.id];
              return (
                <div
                  key={dim.id}
                  className={`flex items-center gap-4 p-5 rounded-2xl border transition-all duration-200 ${
                    dim.enabled ? 'bg-white border-warm-100' : 'bg-warm-50/50 border-warm-100/60 opacity-60'
                  }`}
                >
                  {/* 图标 */}
                  <div className="w-11 h-11 rounded-xl bg-sky-50 flex items-center justify-center shrink-0">
                    <Icon size={20} className="text-sky-500" />
                  </div>

                  {/* 维度信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-warm-900 text-sm">{dim.name}</h4>
                      <span className="px-2 py-0.5 bg-warm-100 text-warm-500 rounded text-[11px] font-mono">
                        {dim.key}
                      </span>
                    </div>
                    <p className="text-xs text-warm-400 mt-1">{dim.description}</p>
                  </div>

                  {/* 权重 */}
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-sm text-warm-500">权重:</label>
                    <input
                      type="number"
                      min={0.1}
                      max={5}
                      step={0.1}
                      value={dim.weight}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 1.0;
                        setDimensions(prev => prev.map(d => d.id === dim.id ? { ...d, weight: val } : d));
                      }}
                      onBlur={(e) => handleUpdate(dim.id, 'weight', parseFloat(e.target.value) || 1.0)}
                      disabled={!dim.enabled}
                      className="input w-20 text-center text-sm font-bold py-1.5"
                    />
                  </div>

                  {/* 启用开关 */}
                  <button
                    onClick={() => handleUpdate(dim.id, 'enabled', dim.enabled ? 0 : 1)}
                    className="shrink-0"
                    title={dim.enabled ? '点击禁用' : '点击启用'}
                  >
                    {dim.enabled ? (
                      <ToggleRight size={32} className="text-primary-600" />
                    ) : (
                      <ToggleLeft size={32} className="text-warm-300" />
                    )}
                  </button>

                  {/* 删除 */}
                  <button
                    onClick={() => handleDelete(dim)}
                    className="p-2 text-warm-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition shrink-0"
                    title="删除维度"
                  >
                    <Trash2 size={16} />
                  </button>

                  {/* 保存中指示 */}
                  {isSaving && (
                    <Loader2 size={16} className="animate-spin text-primary-500 shrink-0" />
                  )}
                </div>
              );
            })}

            {dimensions.length === 0 && (
              <div className="text-center py-10 text-warm-400 text-sm">
                暂无雷达维度，点击右上角"新增维度"添加
              </div>
            )}
          </div>
        )}
      </div>

      {/* 维度说明 */}
      <div className="card">
        <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
          <Target size={18} className="text-sky-500" />
          维度说明
        </h3>
        <div className="space-y-3 text-sm">
          <div className="p-3 bg-warm-50/80 rounded-xl">
            <p className="font-medium text-warm-800">维度 Key</p>
            <p className="text-warm-500 text-xs mt-0.5">用于后端计算分数时的标识符，创建后不可修改。建议使用英文下划线命名，如 product_knowledge。</p>
          </div>
          <div className="p-3 bg-warm-50/80 rounded-xl">
            <p className="font-medium text-warm-800">权重</p>
            <p className="text-warm-500 text-xs mt-0.5">控制该维度在综合能力评分中的占比。权重越大，该维度对总分的影响越大。默认为 1.0，范围 0.1~5.0。</p>
          </div>
          <div className="p-3 bg-warm-50/80 rounded-xl">
            <p className="font-medium text-warm-800">启用/禁用</p>
            <p className="text-warm-500 text-xs mt-0.5">禁用后该维度不会出现在用户画像的雷达图中。注意：至少保留 3 个启用的维度才能正常显示雷达图。</p>
          </div>
        </div>
      </div>

      {/* 新增维度弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-soft-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">新增维度</h3>
              <button onClick={() => setShowAddModal(false)} className="text-warm-400 hover:text-warm-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">维度 Key *</label>
                <input
                  className="input"
                  value={addForm.key}
                  onChange={e => setAddForm({ ...addForm, key: e.target.value.replace(/[^a-z0-9_]/g, '_') })}
                  placeholder="如: product_knowledge"
                />
                <p className="text-xs text-warm-400 mt-1">英文+下划线，创建后不可修改</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">维度名称 *</label>
                <input
                  className="input"
                  value={addForm.name}
                  onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                  placeholder="如: 产品知识"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">描述</label>
                <textarea
                  className="input min-h-[60px] resize-y"
                  value={addForm.description}
                  onChange={e => setAddForm({ ...addForm, description: e.target.value })}
                  placeholder="维度说明..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">图标</label>
                  <select
                    className="input"
                    value={addForm.icon}
                    onChange={e => setAddForm({ ...addForm, icon: e.target.value })}
                  >
                    {ICON_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">权重</label>
                  <input
                    type="number"
                    min={0.1}
                    max={5}
                    step={0.1}
                    className="input"
                    value={addForm.weight}
                    onChange={e => setAddForm({ ...addForm, weight: parseFloat(e.target.value) || 1.0 })}
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setShowAddModal(false)} className="btn-secondary">取消</button>
                <button onClick={handleAdd} className="btn-primary">确认添加</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
