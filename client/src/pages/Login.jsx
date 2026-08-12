import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, Eye, EyeOff, Sparkles } from 'lucide-react';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/sales/chat'} />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return setError('请输入用户名和密码');
    setLoading(true);
    setError('');
    try {
      const res = await login(username, password);
      if (res.code === 0) {
          navigate(res.data?.user?.role === 'admin' ? '/admin' : '/sales/chat');
      } else {
        setError(res.message || '登录失败');
      }
    } catch (err) {
      setError(err?.message || '登录失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden sky-gradient p-4">
      {/* 浮动云朵装饰 */}
      <div className="absolute top-[10%] left-[5%] w-48 h-16 bg-white/50 rounded-full blur-2xl animate-float" />
      <div className="absolute top-[20%] right-[8%] w-36 h-12 bg-white/40 rounded-full blur-xl animate-float-delay" />
      <div className="absolute bottom-[15%] left-[15%] w-40 h-14 bg-white/35 rounded-full blur-2xl animate-float-slow" />
      <div className="absolute bottom-[25%] right-[10%] w-28 h-10 bg-white/30 rounded-full blur-xl animate-float" />
      <div className="absolute top-[40%] left-[60%] w-20 h-8 bg-white/25 rounded-full blur-lg animate-float-delay" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white/80 backdrop-blur-xl rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-soft-lg animate-float">
            <span className="text-transparent bg-gradient-to-br from-sky-500 to-primary-700 bg-clip-text text-4xl font-bold">南</span>
          </div>
          <h1 className="text-2xl font-bold text-warm-800">欢迎来到终端跑店宝典</h1>
          <p className="text-warm-500 mt-1.5 text-sm flex items-center justify-center gap-1.5">
            <Sparkles size={14} className="text-accent-400" />
            跑店有方法，谈店有妙招
            <Sparkles size={14} className="text-accent-400" />
          </p>
          <p className="text-warm-400 mt-2 text-xs leading-relaxed px-4">
            汇集陈列标准、店主沟通话术、活动政策、竞品应对，跑店遇到任何难题，都能在这里找到实战答案。
          </p>
        </div>

        {/* 登录卡片 */}
        <div className="bg-white/85 backdrop-blur-xl rounded-3xl shadow-soft-xl border border-warm-100/60 p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1.5">用户名</label>
              <input
                type="text"
                className="input"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1.5">密码</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600 transition-colors"
                >
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-rose-600 bg-rose-50 px-4 py-3 rounded-xl flex items-center gap-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base"
            >
              {loading ? (
                <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <LogIn size={20} />
              )}
              {loading ? '登录中...' : '登 录'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
