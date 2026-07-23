import { useState } from 'react';
import { X, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import api from '../api';

export default function ChangePasswordModal({ onClose }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!oldPassword || !newPassword) {
      return setError('请输入旧密码和新密码');
    }
    if (newPassword.length < 4) {
      return setError('新密码至少4位');
    }
    if (newPassword !== confirmPassword) {
      return setError('两次输入的新密码不一致');
    }
    if (oldPassword === newPassword) {
      return setError('新密码不能与旧密码相同');
    }

    setLoading(true);
    try {
      await api.put('/auth/password', { old_password: oldPassword, new_password: newPassword });
      setSuccess(true);
    } catch (err) {
      setError(err?.message || '修改失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {success ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <Lock size={24} className="text-emerald-600" />
            </div>
            <h3 className="text-lg font-bold text-warm-900 mb-2">密码修改成功</h3>
            <p className="text-sm text-warm-500 mb-4">下次登录请使用新密码</p>
            <button onClick={onClose} className="btn-primary w-full">知道了</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center">
                  <Lock size={18} className="text-primary-600" />
                </div>
                <h3 className="font-bold text-warm-900">修改密码</h3>
              </div>
              <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-warm-100 transition-colors">
                <X size={18} className="text-warm-400" />
              </button>
            </div>

            {error && (
              <div className="bg-rose-50 text-rose-600 text-sm px-3 py-2 rounded-xl mb-4">{error}</div>
            )}

            {/* 旧密码 */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-warm-700 mb-1.5">旧密码</label>
              <div className="relative">
                <input
                  type={showOld ? 'text' : 'password'}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="input pr-10"
                  placeholder="请输入旧密码"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowOld(!showOld)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-warm-400 hover:text-warm-600"
                >
                  {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* 新密码 */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-warm-700 mb-1.5">新密码</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input pr-10"
                  placeholder="请输入新密码（至少4位）"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-warm-400 hover:text-warm-600"
                >
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* 确认新密码 */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-warm-700 mb-1.5">确认新密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input"
                placeholder="再次输入新密码"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? '修改中...' : '确认修改'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
