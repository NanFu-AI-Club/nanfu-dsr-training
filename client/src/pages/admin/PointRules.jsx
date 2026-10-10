import { useState, useEffect, useCallback } from 'react';
import { Award, Zap, BookOpen, FileText, MessageSquare, Users, Star, Save, Loader2, ToggleLeft, ToggleRight, CalendarDays, Flame, Crown, Camera } from 'lucide-react';
import api from '../../api';

const ICON_MAP = {
  zap: Zap,
  book: BookOpen,
  file: FileText,
  message: MessageSquare,
  user: Users,
  star: Star,
  calendar: CalendarDays,
  flame: Flame,
  fire: Flame,
  crown: Crown,
  camera: Camera,
};

// 与后端 utils/levels.js 保持一致
const LEVEL_TITLES = { 1: '江湖跑侠', 2: '拓店游侠', 3: '终端先锋', 4: '销冠大咖', 5: '销冠王者' };
const LEVEL_MIN = { 1: 0, 2: 500, 3: 1500, 4: 3000, 5: 5000 };

export default function PointRules() {
  const [rules, setRules] = useState([]);
  const [levelBonuses, setLevelBonuses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState({});
  const [message, setMessage] = useState('');

  const loadRules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/statistics/point-rules');
      setRules(res.data || []);
    } catch (err) {
      console.error('加载积分规则失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLevelBonuses = useCallback(async () => {
    try {
      const res = await api.get('/statistics/level-bonuses');
      setLevelBonuses(res.data || []);
    } catch (err) {
      console.error('加载等级加成失败:', err);
    }
  }, []);

  useEffect(() => { loadRules(); loadLevelBonuses(); }, [loadRules, loadLevelBonuses]);

  const handleBonusUpdate = async (level, changes) => {
    const cur = levelBonuses.find(b => b.level === level);
    const payload = { multiplier: changes.multiplier !== undefined ? changes.multiplier : (parseFloat(cur?.multiplier) || 1) };
    if (changes.enabled !== undefined) payload.enabled = changes.enabled;

    setSaving(prev => ({ ...prev, [`lv${level}`]: true }));
    try {
      await api.put(`/statistics/level-bonuses/${level}`, payload);
      setLevelBonuses(prev => prev.map(b => b.level === level ? { ...b, ...payload } : b));
      setMessage('保存成功');
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      console.error('更新等级加成失败:', err);
      setMessage(err?.response?.data?.message || '保存失败');
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setSaving(prev => ({ ...prev, [`lv${level}`]: false }));
    }
  };

  const handleUpdate = async (id, field, value) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;

    setSaving(prev => ({ ...prev, [id]: true }));
    try {
      await api.put(`/statistics/point-rules/${id}`, { [field]: value });
      setRules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
      setMessage('保存成功');
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      console.error('更新积分规则失败:', err);
      setMessage('保存失败');
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setSaving(prev => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="page-title">积分设置</h2>
        {message && (
          <span className={`px-3 py-1.5 rounded-xl text-sm font-medium ${
            message.includes('成功') ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
          }`}>
            {message}
          </span>
        )}
      </div>

      <div className="card">
        <p className="text-sm text-warm-500 mb-6">
          配置各场景的积分获取规则。修改后立即生效，已发放的积分不受影响。
          「每日上限」为该模块每日可获得的积分总额，「每日次数」为每日可计分的次数，两项填 0 表示不限制。
          <br />
          注：跑店问问的「提问」与「反馈」共用同一个每日上限，统一以「跑店问问提问」这一行填写的数值为准（默认 50）。
        </p>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={28} className="animate-spin text-primary-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {rules.map((rule) => {
              const Icon = ICON_MAP[rule.icon] || Star;
              const isSaving = saving[rule.id];
              return (
                <div
                  key={rule.id}
                  className={`flex items-center gap-4 p-5 rounded-2xl border transition-all duration-200 ${
                    rule.enabled ? 'bg-white border-warm-100' : 'bg-warm-50/50 border-warm-100/60 opacity-60'
                  }`}
                >
                  {/* 图标 */}
                  <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                    <Icon size={20} className="text-amber-500" />
                  </div>

                  {/* 规则信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-warm-900 text-sm">{rule.action}</h4>
                      <span className="px-2 py-0.5 bg-warm-100 text-warm-500 rounded text-[11px] font-mono">
                        {rule.source_type}
                      </span>
                    </div>
                    <p className="text-xs text-warm-400 mt-1">{rule.description}</p>
                  </div>

                  {/* 积分数值 */}
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-sm text-warm-500">积分:</label>
                    <input
                      type="number"
                      min={0}
                      value={rule.points}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, points: val } : r));
                      }}
                      onBlur={(e) => handleUpdate(rule.id, 'points', parseInt(e.target.value) || 0)}
                      disabled={!rule.enabled}
                      className="input w-20 text-center text-sm font-bold py-1.5"
                    />
                  </div>

                  {/* 每日上限 / 每日次数（仅对设置了限额的模块显示，0 表示不限制） */}
                  {['share_post', 'ai_ask', 'training_complete'].includes(rule.source_type) && (
                    <div className="flex items-center gap-2 shrink-0">
                      <label
                        className="text-sm text-warm-500"
                        title={rule.source_type === 'ai_ask' ? '跑店问问「提问+反馈」合计每日上限，0 表示不限制' : '每日可获得的总积分上限，0 表示不限制'}
                      >
                        {rule.source_type === 'ai_ask' ? '每日上限(提问+反馈):' : '每日上限:'}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={rule.daily_limit ?? 0}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setRules(prev => prev.map(r => r.id === rule.id ? { ...r, daily_limit: val } : r));
                        }}
                        onBlur={(e) => handleUpdate(rule.id, 'daily_limit', parseInt(e.target.value) || 0)}
                        disabled={!rule.enabled}
                        className="input w-20 text-center text-sm py-1.5"
                      />
                    </div>
                  )}
                  {['share_post', 'training_complete'].includes(rule.source_type) && (
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="text-sm text-warm-500" title="每日计分次数上限，0 表示不限制">每日次数:</label>
                      <input
                        type="number"
                        min={0}
                        value={rule.daily_max_times ?? 0}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setRules(prev => prev.map(r => r.id === rule.id ? { ...r, daily_max_times: val } : r));
                        }}
                        onBlur={(e) => handleUpdate(rule.id, 'daily_max_times', parseInt(e.target.value) || 0)}
                        disabled={!rule.enabled}
                        className="input w-20 text-center text-sm py-1.5"
                      />
                    </div>
                  )}

                  {/* 启用开关 */}
                  <button
                    onClick={() => handleUpdate(rule.id, 'enabled', rule.enabled ? 0 : 1)}
                    className="shrink-0"
                    title={rule.enabled ? '点击禁用' : '点击启用'}
                  >
                    {rule.enabled ? (
                      <ToggleRight size={32} className="text-primary-600" />
                    ) : (
                      <ToggleLeft size={32} className="text-warm-300" />
                    )}
                  </button>

                  {/* 保存中指示 */}
                  {isSaving && (
                    <Loader2 size={16} className="animate-spin text-primary-500 shrink-0" />
                  )}
                </div>
              );
            })}

            {rules.length === 0 && (
              <div className="text-center py-10 text-warm-400 text-sm">
                暂无积分规则
              </div>
            )}
          </div>
        )}
      </div>

      {/* 等级加成 */}
      <div className="card">
        <h3 className="font-semibold text-warm-900 mb-2 flex items-center gap-2">
          <Crown size={18} className="text-amber-500" />
          等级加成
        </h3>
        <p className="text-sm text-warm-500 mb-5">
          用户达到对应等级后，<span className="font-medium text-warm-700">后续获得</span>的所有积分按此倍率计算（出现小数四舍五入取整）。
          历史已获得的积分不变；倍率按当前等级取用、不累乘。倍率填 1 表示不加成。
        </p>
        <div className="space-y-3">
          {levelBonuses.map((b) => {
            const isSaving = saving[`lv${b.level}`];
            return (
              <div
                key={b.level}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all duration-200 ${
                  b.enabled ? 'bg-white border-warm-100' : 'bg-warm-50/50 border-warm-100/60 opacity-60'
                }`}
              >
                <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center shrink-0 font-bold text-amber-500 text-sm">
                  L{b.level}
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-warm-900 text-sm">{LEVEL_TITLES[b.level] || `等级 ${b.level}`}</h4>
                  <p className="text-xs text-warm-400 mt-1">累计 {LEVEL_MIN[b.level]} 分以上</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-sm text-warm-500" title="该等级后续获得积分的倍率">积分倍率:</label>
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    max={5}
                    value={b.multiplier}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLevelBonuses(prev => prev.map(x => x.level === b.level ? { ...x, multiplier: val } : x));
                    }}
                    onBlur={(e) => handleBonusUpdate(b.level, { multiplier: parseFloat(e.target.value) || 1 })}
                    disabled={!b.enabled}
                    className="input w-20 text-center text-sm font-bold py-1.5"
                  />
                  <span className="text-xs text-warm-400">倍</span>
                </div>

                <button
                  onClick={() => handleBonusUpdate(b.level, { enabled: b.enabled ? 0 : 1 })}
                  className="shrink-0"
                  title={b.enabled ? '点击停用' : '点击启用'}
                >
                  {b.enabled ? (
                    <ToggleRight size={32} className="text-primary-600" />
                  ) : (
                    <ToggleLeft size={32} className="text-warm-300" />
                  )}
                </button>

                {isSaving && <Loader2 size={16} className="animate-spin text-primary-500 shrink-0" />}
              </div>
            );
          })}

          {levelBonuses.length === 0 && (
            <div className="text-center py-8 text-warm-400 text-sm">暂无等级加成配置</div>
          )}
        </div>
      </div>

      {/* 积分说明 */}
      <div className="card">
        <h3 className="font-semibold text-warm-900 mb-4 flex items-center gap-2">
          <Award size={18} className="text-amber-500" />
          积分规则说明
        </h3>
        <div className="space-y-3 text-sm text-warm-600">
          <div className="flex items-start gap-3 p-3 bg-warm-50/80 rounded-xl">
            <CalendarDays size={16} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-warm-800">每日签到</p>
              <p className="text-warm-500 text-xs mt-0.5">每天签到获得基础积分。连续签到3/7/30天分别获得额外奖励。签到日历可查看记录。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-warm-50/80 rounded-xl">
            <BookOpen size={16} className="text-sky-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-warm-800">完成课程</p>
              <p className="text-warm-500 text-xs mt-0.5">首次完成一门课程时获得积分。基础积分 + 课程时长加成（每5分钟+1分），仅首次完成时发放。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-warm-50/80 rounded-xl">
            <FileText size={16} className="text-emerald-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-warm-800">考试通过</p>
              <p className="text-warm-500 text-xs mt-0.5">考试分数达到及格线时发放积分。积分数 = 考试分数 / 10（如80分=8积分）。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-warm-50/80 rounded-xl">
            <MessageSquare size={16} className="text-purple-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-warm-800">FU利陪陪</p>
              <p className="text-warm-500 text-xs mt-0.5">完成FU利陪陪后按得分比例获取积分。积分 = 配置分值 × (得分/100)，保底1分。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-warm-50/80 rounded-xl">
            <Users size={16} className="text-orange-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-warm-800">管理员调整</p>
              <p className="text-warm-500 text-xs mt-0.5">管理员可在用户管理页面手动为用户增减积分，此规则无固定积分数。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
