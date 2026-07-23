import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Edit3, Trash2, X, Cpu, Power, PowerOff, Eye, EyeOff,
} from 'lucide-react';
import api from '../../api';

/* ================= 配置弹窗表单 ================= */
function ConfigModal({ open, onClose, onSave, form, setForm, editingId }) {
  const [showKey, setShowKey] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{editingId ? '编辑配置' : '新建配置'}</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">提供商 *</label>
            <input
              className="input"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              placeholder="如 openai / azure / deepseek"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">API 密钥 *</label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showKey ? 'text' : 'password'}
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={editingId ? '留空则不修改（显示为 ****）' : '输入 API Key'}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">API 地址 *</label>
            <input
              className="input"
              value={form.api_base}
              onChange={(e) => setForm({ ...form, api_base: e.target.value })}
              placeholder="如 https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">模型 *</label>
            <input
              className="input"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="如 gpt-4o"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Temperature: <span className="text-primary-600 font-semibold">{form.temperature ?? 0.7}</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={form.temperature ?? 0.7}
              onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
              className="w-full accent-primary-600"
            />
            <div className="flex justify-between text-xs text-warm-400">
              <span>0 (精确)</span>
              <span>2 (创造)</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Max Tokens</label>
            <input
              className="input"
              type="number"
              value={form.max_tokens ?? ''}
              onChange={(e) => setForm({ ...form, max_tokens: e.target.value ? Number(e.target.value) : '' })}
              placeholder="如 4096"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">系统提示词 (System Prompt)</label>
            <textarea
              className="input min-h-[120px] resize-y font-mono text-sm"
              value={form.system_prompt || ''}
              onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              placeholder="你是一个专业的培训助手..."
            />
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

/* ================= 主页面 ================= */
export default function AIConfig() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    provider: '',
    api_key: '',
    api_base: '',
    model: '',
    temperature: 0.7,
    max_tokens: '',
    system_prompt: '',
  });

  /* ================= 数据加载 ================= */
  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/ai/configs');
      // 后端 ai/configs 直接返回 {code:0, data:[...]}，所以 res.data 就是数组
      const data = res?.data || res;
      const cfgs = Array.isArray(data) ? data : (data?.list || []);
      setConfigs(cfgs);
    } catch (err) {
      setError(err?.message || '获取 AI 配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  /* ================= 操作 ================= */
  const openAdd = () => {
    setEditingId(null);
    setForm({
      provider: '',
      api_key: '',
      api_base: '',
      model: '',
      temperature: 0.7,
      max_tokens: '',
      system_prompt: '',
    });
    setModalOpen(true);
  };

  const openEdit = (config) => {
    setEditingId(config.id);
    setForm({
      provider: config.provider || '',
      api_key: config.api_key || '', // 脱敏显示: 编辑时后端返回 ****
      api_base: config.api_base || '',
      model: config.model || '',
      temperature: config.temperature ?? 0.7,
      max_tokens: config.max_tokens ?? '',
      system_prompt: config.system_prompt || '',
    });
    setModalOpen(true);
  };

  const saveConfig = async () => {
    if (!form.provider.trim() || !form.api_base.trim() || !form.model.trim()) return;
    // 新建时必须填写 API key
    if (!editingId && !form.api_key.trim()) {
      alert('请输入 API 密钥');
      return;
    }
    try {
      const payload = { ...form };
      // 如果是编辑模式且 api_key 全是 * 号，则不发送
      if (editingId && /^\*+$/.test(payload.api_key)) {
        delete payload.api_key;
      }
      if (payload.max_tokens === '' || payload.max_tokens == null) {
        delete payload.max_tokens;
      }
      if (editingId) {
        await api.put(`/ai/configs/${editingId}`, payload);
      } else {
        await api.post('/ai/configs', payload);
      }
      setModalOpen(false);
      fetchConfigs();
    } catch (err) {
      alert(err?.message || '保存失败');
    }
  };

  const toggleActive = async (config) => {
    try {
      // 使用 PUT 接口传 is_active 参数，后端没有独立的 activate/deactivate 路由
      await api.put(`/ai/configs/${config.id}`, { is_active: !config.is_active });
      fetchConfigs();
    } catch (err) {
      alert(err?.message || '操作失败');
    }
  };

  const deleteConfig = async (config) => {
    if (!window.confirm(`确定删除配置「${config.provider} - ${config.model}」？`)) return;
    try {
      await api.delete(`/ai/configs/${config.id}`);
      fetchConfigs();
    } catch (err) {
      alert(err?.message || '删除失败');
    }
  };

  /* ================= 渲染 ================= */
  const maskKey = (key) => {
    if (!key) return '未设置';
    if (key.startsWith('sk-')) return key.slice(0, 6) + '****' + key.slice(-4);
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">AI 配置</h1>
        <button onClick={openAdd} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={16} /> 新建配置
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-rose-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">关闭</button>
        </div>
      )}

      {/* 配置列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
        </div>
      ) : configs.length === 0 ? (
        <div className="card text-center py-16 text-sm text-warm-400">
          <Cpu size={40} className="mx-auto mb-3 text-warm-300" />
          <p>暂无 AI 配置</p>
          <button onClick={openAdd} className="text-primary-600 hover:text-primary-800 mt-1 underline">新建配置</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {configs.map((config) => (
            <div key={config.id} className={`card relative ${config.is_active ? 'ring-2 ring-green-400' : ''}`}>
              {/* 激活状态标识 */}
              <div className="absolute top-4 right-4 flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${config.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <span className={`text-xs font-medium ${config.is_active ? 'text-emerald-600' : 'text-warm-400'}`}>
                  {config.is_active ? '已激活' : '未激活'}
                </span>
              </div>

              {/* 配置内容 */}
              <div className="space-y-3 pr-20">
                <div className="flex items-center gap-2">
                  <Cpu size={18} className="text-primary-600" />
                  <h3 className="font-semibold text-warm-900">{config.provider}</h3>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-warm-400">API 密钥:</span>
                    <span className="ml-1 text-warm-700 font-mono text-xs">{maskKey(config.api_key)}</span>
                  </div>
                  <div>
                    <span className="text-warm-400">模型:</span>
                    <span className="ml-1 text-warm-700 font-medium">{config.model}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-warm-400">API 地址:</span>
                    <span className="ml-1 text-warm-700 text-xs break-all">{config.api_base}</span>
                  </div>
                  <div>
                    <span className="text-warm-400">Temperature:</span>
                    <span className="ml-1 text-warm-700">{config.temperature ?? 0.7}</span>
                  </div>
                  <div>
                    <span className="text-warm-400">Max Tokens:</span>
                    <span className="ml-1 text-warm-700">{config.max_tokens || '默认'}</span>
                  </div>
                </div>

                {config.system_prompt && (
                  <div>
                    <span className="text-xs text-warm-400">System Prompt:</span>
                    <p className="text-xs text-warm-600 mt-1 bg-warm-50/80 rounded p-2 max-h-20 overflow-y-auto whitespace-pre-wrap">
                      {config.system_prompt}
                    </p>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                <button
                  onClick={() => toggleActive(config)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                    config.is_active
                      ? 'bg-warm-100 text-warm-600 hover:bg-warm-200'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {config.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                  {config.is_active ? '停用' : '激活'}
                </button>
                <div className="flex-1" />
                <button onClick={() => openEdit(config)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-sky-600" title="编辑">
                  <Edit3 size={14} />
                </button>
                <button onClick={() => deleteConfig(config)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-rose-600" title="删除">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========== 配置弹窗 ========== */}
      <ConfigModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={saveConfig}
        form={form}
        setForm={setForm}
        editingId={editingId}
      />
    </div>
  );
}
