import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, BookOpen, HelpCircle, FileText, PlaySquare, Bot, MessageSquare, Users, ScrollText, LogOut, Menu, X, Cloud, Award, Target, KeyRound, ShoppingBag, ClipboardList, Camera, Share2, ChevronDown, Megaphone } from 'lucide-react';
import ChangePasswordModal from '../components/ChangePasswordModal';

const menuGroups = [
  {
    key: 'workspace', label: '工作台', items: [
      { path: '/admin', icon: LayoutDashboard, label: '仪表盘', end: true },
      { path: '/admin/user-statistics', icon: Users, label: '用户统计' },
    ]
  },
  {
    key: 'people', label: '人员运营', manager: true, items: [
      { path: '/admin/users', icon: Users, label: '用户管理' },
      { path: '/admin/exams', icon: FileText, label: '考试记录' },
      { path: '/admin/training-records', icon: ClipboardList, label: 'FU利陪陪记录' },
      { path: '/admin/submissions', icon: Camera, label: '投稿' },
      { path: '/admin/shares', icon: Share2, label: '分享圈' },
      { path: '/admin/announcements', icon: Megaphone, label: '公告' },
    ]
  },
  {
    key: 'content', label: '培训内容', system: true, items: [
      { path: '/admin/knowledge', icon: BookOpen, label: '知识库' },
      { path: '/admin/questions', icon: HelpCircle, label: '题库' },
      { path: '/admin/courses', icon: PlaySquare, label: '课程管理' },
      { path: '/admin/exams', icon: FileText, label: '考试管理' },
    ]
  },
  {
    key: 'operations', label: '运营管理', system: true, items: [
      { path: '/admin/training-scenarios', icon: MessageSquare, label: 'FU利陪陪' },
      { path: '/admin/chat-logs', icon: Cloud, label: '跑店问问' },
    ]
  },
  {
    key: 'settings', label: '系统设置', system: true, items: [
      { path: '/admin/ai-config', icon: Bot, label: 'AI 配置' },
      { path: '/admin/point-rules', icon: Award, label: '积分设置' },
      { path: '/admin/radar-dimensions', icon: Target, label: '能力维度' },
      { path: '/admin/shop', icon: ShoppingBag, label: '积分商城' },
      { path: '/admin/logs', icon: ScrollText, label: '活动日志' },
    ]
  },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [openGroups, setOpenGroups] = useState({ workspace: true, people: true, content: true, operations: false, settings: false });
  const handleLogout = () => { logout(); navigate('/login'); };
  const closeSidebar = () => setSidebarOpen(false);
  const canUseSalesExperience = user?.role === 'sales' || ['system_admin', 'region_manager', 'area_manager'].includes(user?.manager_type);
  const canUseAdminExperience = user?.role === 'admin' && user?.manager_type !== 'city_manager';
  const isSystemAdmin = user?.manager_type === 'system_admin' || !user?.manager_type;
  const visibleMenuGroups = menuGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => isSystemAdmin || (group.manager ? ['/admin/users', '/admin/exams', '/admin/training-records', '/admin/submissions', '/admin/shares', '/admin/announcements'].includes(item.path) : group.key === 'workspace'))
  })).filter((group) => group.items.length > 0);
  const managerLabel = user?.manager_type === 'region_manager'
    ? `大区经理${user.region_name ? `：${user.region_name}` : ''}`
    : user?.manager_type === 'area_manager'
      ? `区域经理${user.region_name ? `：${user.region_name}` : ''}`
      : user?.manager_type === 'city_manager'
        ? `城市经理${user.city_name ? `：${user.city_name}` : ''}`
        : '系统管理员';

  const sidebarContent = (
    <>
      {/* 品牌区 — 更柔和的吉卜力风格 */}
      <div className="h-16 flex items-center px-5 border-b border-warm-100/60 shrink-0">
        <div className="w-9 h-9 bg-gradient-to-br from-sky-400 to-primary-600 rounded-2xl flex items-center justify-center text-white font-bold text-sm mr-3 shrink-0 shadow-soft">
          跑
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm text-warm-800 truncate">终端跑店宝典</div>
          <div className="text-[11px] text-warm-500 truncate">销售培训系统</div>
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-3">
        {visibleMenuGroups.map((group) => (
          <div key={group.key}>
            {group.items.length > 1 && (
              <button
                type="button"
                onClick={() => setOpenGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                className="w-full flex items-center justify-between px-3 mb-2 mt-2 text-sm font-bold tracking-wide text-warm-800"
              >
                <span>{group.label}</span>
                <ChevronDown size={17} strokeWidth={2.5} className={`text-warm-500 transition-transform ${openGroups[group.key] ? '' : '-rotate-90'}`} />
              </button>
            )}
            {(group.items.length === 1 || openGroups[group.key]) && group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                onClick={closeSidebar}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-sky-50 to-primary-50 text-primary-700 font-medium shadow-inner-soft'
                      : 'text-warm-600 hover:bg-warm-50 hover:text-warm-800'
                  }`
                }
              >
                <item.icon size={18} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* 底部用户区 */}
      <div className="border-t border-warm-100/60 p-3 shrink-0">
        {canUseSalesExperience && canUseAdminExperience && (
          <button
            onClick={() => navigate('/sales/chat')}
            className="flex items-center gap-2.5 text-sm text-sky-600 hover:text-primary-700 transition-all duration-200 w-full px-3 py-2 rounded-xl hover:bg-sky-50 mb-2"
          >
            <MessageSquare size={16} />
            进入销售端
          </button>
        )}
        <div className="flex items-center gap-3 mb-3 px-2">
          <div className="w-9 h-9 bg-gradient-to-br from-sky-200 to-primary-300 rounded-full flex items-center justify-center text-primary-700 text-sm font-bold shrink-0 shadow-soft">
            {user?.real_name?.[0] || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-warm-800 truncate">{user?.real_name}</div>
            <div className="text-xs text-warm-400 truncate" title={managerLabel}>{managerLabel}</div>
          </div>
        </div>
        <button
          onClick={() => setShowChangePassword(true)}
          className="flex items-center gap-2.5 text-sm text-warm-500 hover:text-primary-600 transition-all duration-200 w-full px-3 py-2 rounded-xl hover:bg-primary-50 mb-1"
        >
          <KeyRound size={16} />
          修改密码
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 text-sm text-warm-500 hover:text-rose-500 transition-all duration-200 w-full px-3 py-2.5 rounded-xl hover:bg-rose-50"
        >
          <LogOut size={16} />
          退出登录
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-full overflow-hidden bg-warm-50">
      {/* 桌面端侧边栏 — 柔和白底 */}
      <aside className="hidden md:flex w-60 bg-white/90 backdrop-blur-xl border-r border-warm-100/60 flex-col shrink-0">
        {sidebarContent}
      </aside>

      {/* 移动端汉堡按钮 */}
      <div className="md:hidden fixed top-0 left-0 z-40 p-3">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2.5 bg-white/90 backdrop-blur rounded-2xl shadow-soft text-warm-600 hover:text-warm-800 transition-all duration-200"
        >
          <Menu size={22} />
        </button>
      </div>

      {/* 移动端侧边栏抽屉 */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-warm-900/20 backdrop-blur-sm z-40 md:hidden animate-fade-in" onClick={closeSidebar} />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-white flex flex-col shadow-soft-xl md:hidden animate-slide-up">
            <div className="flex items-center justify-between h-16 px-5 border-b border-warm-100/60 shrink-0">
              <div className="font-bold text-sm text-warm-800">终端跑店宝典 管理</div>
              <button onClick={closeSidebar} className="p-2 rounded-xl hover:bg-warm-50 text-warm-500 transition-all duration-200">
                <X size={20} />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </>
      )}

      {/* 主内容 — 天空渐变背景 + 云朵装饰 */}
      <main className="flex-1 overflow-y-auto relative sky-gradient">
        {/* 浮动云朵装饰 */}
        <div className="absolute top-8 right-[15%] w-32 h-12 bg-white/40 rounded-full blur-xl pointer-events-none animate-float-slow" />
        <div className="absolute top-20 right-[40%] w-24 h-8 bg-white/30 rounded-full blur-lg pointer-events-none animate-float-delay" />
        <div className="absolute bottom-20 left-[10%] w-28 h-10 bg-white/25 rounded-full blur-xl pointer-events-none animate-float" />
        <div className="absolute top-40 left-[20%] w-20 h-6 bg-white/20 rounded-full blur-lg pointer-events-none animate-float-delay" />

        <div className="h-12 md:h-0" />
        <div className="p-3 md:p-6 relative z-10">
          <Outlet />
        </div>
      </main>

      {/* 修改密码弹窗 */}
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
