import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, BookOpenCheck, CalendarCheck, ChevronLeft, ChevronRight, ClipboardCheck, Coins, Download, RefreshCw, Search, TrendingUp, Users } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { todayShanghai } from '../../utils/time';

const SUMMARY_CARDS = [
  { key: 'total_users', label: '业务员人数', icon: Users, color: 'text-sky-600', bg: 'bg-sky-50', description: '当前管理范围' },
  { key: 'users_completed_course', label: '完成过课程', icon: BookOpenCheck, color: 'text-emerald-600', bg: 'bg-emerald-50', description: '至少完成一门' },
  { key: 'users_taken_exam', label: '参加过考试', icon: ClipboardCheck, color: 'text-violet-600', bg: 'bg-violet-50', description: '已有考试记录' },
  { key: 'total_points', label: '当前积分总额', icon: Coins, color: 'text-amber-600', bg: 'bg-amber-50', description: '范围内合计' },
  { key: 'total_earned_points', label: '累计总积分', icon: TrendingUp, color: 'text-rose-600', bg: 'bg-rose-50', description: '含已兑换' },
];

const ROLE_OPTIONS = [
  { value: 'sales', label: '业务员' },
  { value: 'region_manager', label: '大区经理' },
  { value: 'area_manager', label: '区域经理' },
  { value: 'city_manager', label: '客户经理' },
];

const ACTIVE_OPTIONS = [
  { value: '', label: '全部活跃度' },
  { value: '7', label: '近 7 天活跃' },
  { value: '30', label: '近 30 天活跃' },
  { value: 'inactive', label: '近 30 天未活跃' },
];

// 把最近活跃时间显示成「日期 + 距今多久」
function formatLastActive(value) {
  if (!value) return null;
  const text = String(value);
  const date = text.slice(0, 10);
  const days = Math.floor((Date.now() - new Date(text.replace(' ', 'T')).getTime()) / 86400000);
  if (days <= 0) return { date, hint: '今天' };
  if (days === 1) return { date, hint: '昨天' };
  if (days < 30) return { date, hint: `${days} 天前` };
  return { date, hint: `${Math.floor(days / 30)} 个月前` };
}

function roleLabel(item) {
  if (item?.manager_type === 'region_manager') return '大区经理';
  if (item?.manager_type === 'area_manager') return '区域经理';
  if (item?.manager_type === 'city_manager') return '客户经理';
  if (item?.role === 'admin') return '系统管理员';
  return '业务员';
}

export default function UserStatistics() {
  const { user } = useAuth();
  const [regions, setRegions] = useState([]);
  const [cities, setCities] = useState([]);
  const [draftFilters, setDraftFilters] = useState({ keyword: '', area_id: '', region_id: '', city_id: '', role_type: 'sales', active: '' });
  const [filters, setFilters] = useState({ keyword: '', area_id: '', region_id: '', city_id: '', role_type: 'sales', active: '', page: 1 });
  const [data, setData] = useState({ summary: {}, list: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOptions = useCallback(async () => {
    setError('');
    try {
      const [regionRes, cityRes] = await Promise.all([
        api.get('/users/regions'), api.get('/users/cities')
      ]);
      setRegions(regionRes?.data || regionRes || []);
      setCities(cityRes?.data || cityRes || []);
    } catch (err) {
      setError(err?.message || '筛选条件加载失败');
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/statistics/admin-user-summary', { params: filters });
      setData(res?.data || res || { summary: {}, list: [], total: 0 });
    } catch (err) {
      setError(err?.message || '用户统计加载失败');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadOptions(); }, [loadOptions]);
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (!user || regions.length === 0) return;
    const currentRegion = regions.find((item) => String(item.id) === String(user.region_id));
    if (user.manager_type === 'region_manager' && currentRegion) {
      setDraftFilters((prev) => ({ ...prev, area_id: currentRegion.id }));
    }
    if (user.manager_type === 'area_manager' && currentRegion) {
      setDraftFilters((prev) => ({ ...prev, area_id: currentRegion.parent_id || '', region_id: currentRegion.id }));
    }
  }, [user, regions]);

  const areaRegions = regions.filter((item) => item.level === 1);
  const subRegions = regions.filter((item) => item.level === 2 && (!draftFilters.area_id || String(item.parent_id) === String(draftFilters.area_id)));
  const visibleCities = cities.filter((city) => !draftFilters.region_id || String(city.region_id) === String(draftFilters.region_id));
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 20)));
  const scopeLabel = user?.manager_type === 'region_manager' ? '本大区' : user?.manager_type === 'area_manager' ? '本细分区域' : '全系统';
  const currentRoleLabel = ROLE_OPTIONS.find((r) => r.value === draftFilters.role_type)?.label || '业务员';

  const updateDraftFilter = (key, value) => {
    setDraftFilters((prev) => ({ ...prev, [key]: value, ...(key === 'area_id' ? { region_id: '', city_id: '' } : {}), ...(key === 'region_id' ? { city_id: '' } : {}) }));
  };
  const applyFilters = () => setFilters({ ...draftFilters, page: 1 });
  const changePage = (page) => setFilters((prev) => ({ ...prev, page }));
  const clearFilters = () => {
    const empty = { keyword: '', area_id: '', region_id: '', city_id: '', role_type: 'sales', active: '' };
    setDraftFilters(empty);
    setFilters({ ...empty, page: 1 });
  };
  const exportData = async () => {
    try {
      const query = new URLSearchParams(Object.entries(filters).filter(([key, value]) => key !== 'page' && value));
      const res = await api.get(`/statistics/admin-user-summary/export?${query.toString()}`, { responseType: 'blob' });
      const blob = new Blob([res.data || res], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `用户统计-${todayShanghai()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || '导出失败');
    }
  };
  const summary = data.summary || {};

  const tableRows = useMemo(() => data.list || [], [data.list]);

  return (
    <div className="space-y-5 pb-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 via-primary-600 to-indigo-700 px-6 py-6 text-white shadow-soft-lg">
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-sky-100 text-sm mb-2"><Award size={16} /> 人员运营分析</div>
          <h1 className="text-2xl font-bold tracking-tight">用户统计</h1>
          <p className="mt-2 text-sm text-sky-100">查看{scopeLabel}的{currentRoleLabel}明细及其学习、考试、FU利陪陪、签到、积分表现。</p>
        </div>
        <div className="absolute -right-8 -top-12 w-48 h-48 rounded-full bg-white/10" />
        <div className="absolute right-20 -bottom-20 w-56 h-56 rounded-full bg-white/5" />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        {SUMMARY_CARDS.map(({ key, label, icon: Icon, color, bg, description }) => {
          const displayLabel = key === 'total_users' ? `${currentRoleLabel}人数` : label;
          return (
            <div className="card group transition hover:-translate-y-0.5 hover:shadow-soft-lg" key={key}>
              <div className="flex items-start justify-between">
                <div><p className="text-sm text-warm-500">{displayLabel}</p><p className="text-2xl font-bold text-warm-900 mt-2">{Number(summary[key] || 0).toLocaleString()}</p><p className="text-xs text-warm-400 mt-1">{description}</p></div>
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${bg}`}><Icon size={21} className={color} /></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-warm-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div><h2 className="font-semibold text-warm-900">人员明细</h2><p className="text-xs text-warm-400 mt-1">共 {data.total || 0} 位{currentRoleLabel} · 导出当前已应用筛选</p></div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center justify-center gap-1.5 text-sm" onClick={exportData}><Download size={15} />导出统计</button>
            <button className="btn-secondary flex items-center justify-center gap-1.5 text-sm" onClick={loadData}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新数据</button>
          </div>
        </div>
        <div className="px-5 py-4 bg-warm-50/60 border-b border-warm-100">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-warm-500">
              <span className="font-medium text-warm-700">组织筛选</span>
              <span>大区、细分区域、城市都是可选的；只选大区也可以直接查询。</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[180px_220px_180px_minmax(220px,1fr)] gap-3">
              <select className="input bg-white" value={draftFilters.area_id} onChange={(e) => updateDraftFilter('area_id', e.target.value)} disabled={user?.manager_type === 'region_manager' || user?.manager_type === 'area_manager'} title="大区可单独查询，不选择细分区域也可以直接查询"><option value="">全部大区</option>{areaRegions.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
              <select className="input bg-white" value={draftFilters.region_id} onChange={(e) => updateDraftFilter('region_id', e.target.value)} disabled={user?.manager_type === 'area_manager' || (!draftFilters.area_id && user?.manager_type !== 'area_manager')}><option value="">{draftFilters.area_id || user?.manager_type === 'area_manager' ? '全部细分区域' : '先选择大区'}</option>{subRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select>
              <select className="input bg-white disabled:bg-warm-100" value={draftFilters.city_id} onChange={(e) => updateDraftFilter('city_id', e.target.value)} disabled={!draftFilters.region_id}><option value="">{draftFilters.region_id ? '全部城市' : '先选择细分区域'}</option>{visibleCities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select>
              <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" /><input className="input pl-9 w-full bg-white" placeholder="搜索姓名、用户名或手机号" value={draftFilters.keyword} onChange={(e) => updateDraftFilter('keyword', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-warm-500 font-medium">角色</span>
              <select className="input bg-white w-full sm:w-40" value={draftFilters.role_type} onChange={(e) => updateDraftFilter('role_type', e.target.value)}>{ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
              <select className="input bg-white w-full sm:w-40" value={draftFilters.active} onChange={(e) => updateDraftFilter('active', e.target.value)} title="按最近活跃时间筛选">{ACTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <button className="btn-primary flex items-center justify-center gap-1.5 text-sm" onClick={applyFilters}><Search size={15} />查询</button>
              <button className="text-sm text-warm-500 hover:text-primary-600" onClick={clearFilters}>重置</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-warm-400">已应用：</span>
              {[
                filters.area_id && areaRegions.find((item) => item.id === filters.area_id)?.name,
                filters.region_id && regions.find((item) => item.id === filters.region_id)?.name,
                filters.city_id && cities.find((item) => item.id === filters.city_id)?.name,
                filters.keyword && `关键词：${filters.keyword}`,
                filters.active && ACTIVE_OPTIONS.find((option) => option.value === filters.active)?.label
              ].filter(Boolean).map((label) => <span key={label} className="rounded-full bg-primary-50 text-primary-700 px-2.5 py-1">{label}</span>)}
              {!filters.area_id && !filters.region_id && !filters.city_id && !filters.keyword && !filters.active && <span className="text-warm-400">当前权限范围内全部人员</span>}
            </div>
          </div>
        </div>

        {error && <div className="mx-5 mt-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl px-4 py-3 text-sm">{error}</div>}
        <div className="overflow-x-auto">
          {loading ? <div className="py-20 text-center text-warm-400"><RefreshCw size={24} className="mx-auto mb-2 animate-spin text-primary-500" />正在加载统计数据...</div> : (
            <table className="w-full min-w-[1220px]">
              <thead className="bg-white"><tr>{['姓名', '角色', '组织归属', '所属经销商', '课程完成', '考试表现', 'FU利陪陪', '签到', '最近活跃', '当前积分', '累计积分'].map((label) => <th className="table-header first:pl-5 last:pr-5" key={label}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-warm-100">
                {tableRows.map((item) => {
                  const isManager = item.role === 'admin';
                  const passRate = item.exam_count ? Math.round((item.passed_exam_count / item.exam_count) * 100) : 0;
                  const lastActive = formatLastActive(item.last_active_at);
                  return <tr key={item.id} className="hover:bg-sky-50/40 transition-colors">
                    <td className="table-cell pl-5"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-100 to-indigo-100 text-primary-700 flex items-center justify-center font-semibold">{(item.real_name || item.username || '?').slice(0, 1)}</div><div><div className="font-medium text-warm-900">{item.real_name || '-'}</div><div className="text-xs text-warm-400 mt-0.5">{item.username}</div></div></div></td>
                    <td className="table-cell"><span className="inline-flex rounded-full bg-sky-50 text-sky-700 px-2.5 py-1 text-xs font-medium">{roleLabel(item)}</span></td>
                    <td className="table-cell"><div className="text-sm text-warm-700">{item.region_name || '-'}</div><div className="text-xs text-warm-400 mt-1">{item.city_name || '未绑定城市'}</div></td>
                    <td className="table-cell">{item.dealer_name ? <span className="inline-flex rounded-full bg-warm-100 px-2.5 py-1 text-xs text-warm-600">{item.dealer_name}</span> : <span className="text-warm-300">-</span>}</td>
                    <td className="table-cell">{isManager ? <span className="text-warm-300">-</span> : <><span className="font-semibold text-emerald-600">{item.completed_courses || 0}</span><span className="text-xs text-warm-400 ml-1">门</span></>}</td>
                    <td className="table-cell">{isManager ? <span className="text-warm-300">-</span> : <><div className="font-semibold text-violet-600">{item.passed_exam_count || 0}<span className="text-xs text-warm-400 font-normal">/{item.exam_count || 0}</span></div><div className="text-[11px] text-warm-400 mt-1">通过率 {passRate}%</div></>}</td>
                    <td className="table-cell">{isManager ? <span className="text-warm-300">-</span> : <span className="inline-flex items-center gap-1 text-sm text-orange-600"><Award size={14} />{item.training_count || 0}</span>}</td>
                    <td className="table-cell">{isManager ? <span className="text-warm-300">-</span> : <span className="inline-flex items-center gap-1 text-sm text-sky-600"><CalendarCheck size={14} />{item.checkin_count || 0}</span>}</td>
                    <td className="table-cell">
                      {lastActive ? (
                        <>
                          <div className="text-sm text-warm-700">{lastActive.date}</div>
                          <div className="text-[11px] text-warm-400 mt-1">{lastActive.hint}</div>
                        </>
                      ) : (
                        <span className="text-sm text-warm-300">从未活跃</span>
                      )}
                    </td>
                    <td className="table-cell">{isManager ? <span className="text-warm-300">-</span> : <span className="font-bold text-amber-600">{Number(item.points || 0).toLocaleString()}</span>}</td>
                    <td className="table-cell pr-5">{isManager ? <span className="text-warm-300">-</span> : <span className="font-bold text-rose-500">{Number(item.total_earned_points || 0).toLocaleString()}</span>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loading && tableRows.length === 0 && <div className="py-14 text-center text-warm-400">暂无符合条件的用户</div>}
        {!loading && data.total > 0 && <div className="px-5 py-4 border-t border-warm-100 flex items-center justify-between text-sm"><span className="text-warm-500">第 {data.page || 1} / {totalPages} 页</span><div className="flex items-center gap-2"><button className="p-2 rounded-lg border border-warm-200 hover:bg-warm-50 disabled:opacity-40" disabled={(data.page || 1) <= 1} onClick={() => changePage(Math.max(1, (data.page || 1) - 1))}><ChevronLeft size={16} /></button><button className="p-2 rounded-lg border border-warm-200 hover:bg-warm-50 disabled:opacity-40" disabled={(data.page || 1) >= totalPages} onClick={() => changePage(Math.min(totalPages, (data.page || 1) + 1))}><ChevronRight size={16} /></button></div></div>}
      </div>
    </div>
  );
}
