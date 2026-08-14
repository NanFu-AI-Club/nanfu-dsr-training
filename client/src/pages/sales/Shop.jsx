import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, Award, ShoppingBag, Package, Clock, CheckCircle, XCircle } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

export default function Shop() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userPoints, setUserPoints] = useState(user?.points || 0);
  const [activeTab, setActiveTab] = useState('products');
  const [exchangeProduct, setExchangeProduct] = useState(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [exchangeForm, setExchangeForm] = useState({ recipient_name: '', recipient_phone: '', recipient_address: '', remark: '' });

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/shop/products');
      const data = res.data?.data || res.data || {};
      setProducts(data.list || []);
    } catch (err) {
      setError(err?.message || '加载商品失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await api.get('/shop/orders');
      const data = res.data?.data || res.data || {};
      setOrders(data.list || []);
    } catch (err) {
      console.error('加载订单失败:', err);
    }
  }, []);

  const loadUserPoints = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      // 拦截器返回 { code: 0, data: user }，res.data 是 user 对象
      const userData = res.data || res || {};
      setUserPoints(userData.points || 0);
    } catch (err) {
      console.error('加载积分失败:', err);
    }
  }, []);

  useEffect(() => {
    loadProducts();
    loadUserPoints();
  }, [loadProducts, loadUserPoints]);

  useEffect(() => {
    if (activeTab === 'orders') loadOrders();
  }, [activeTab, loadOrders]);

  const handleExchange = async () => {
    if (!exchangeProduct) return;
    if (!exchangeForm.recipient_name.trim()) { alert('请填写收件人姓名'); return; }
    if (!exchangeForm.recipient_phone.trim()) { alert('请填写收件人电话'); return; }
    if (!exchangeForm.recipient_address.trim()) { alert('请填写收件地址'); return; }
    try {
      setExchangeLoading(true);
      await api.post('/shop/orders', {
        product_id: exchangeProduct.id,
        ...exchangeForm,
      });
      setExchangeProduct(null);
      setExchangeForm({ recipient_name: '', recipient_phone: '', recipient_address: '', remark: '' });
      loadUserPoints();
      loadProducts();
      alert('兑换成功！');
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || '兑换失败');
    } finally {
      setExchangeLoading(false);
    }
  };

  const STATUS_CONFIG = {
    pending: { label: '待处理', color: 'text-amber-600', bg: 'bg-amber-50', icon: Clock },
    shipped: { label: '已发货', color: 'text-sky-600', bg: 'bg-sky-50', icon: Package },
    completed: { label: '已完成', color: 'text-emerald-600', bg: 'bg-emerald-50', icon: CheckCircle },
    cancelled: { label: '已取消', color: 'text-rose-600', bg: 'bg-rose-50', icon: XCircle },
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="page-title">积分商城</h2>
        <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-100">
          <Award size={18} className="text-amber-500" />
          <span className="text-sm font-semibold text-amber-700">我的积分: {userPoints}</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => setActiveTab('products')} className={`px-4 py-2 rounded-t-xl text-sm font-medium border-b-2 -mb-[2px] ${activeTab === 'products' ? 'text-primary-600 border-primary-600 bg-primary-50/50' : 'text-warm-500 border-transparent'}`}>
          <ShoppingBag size={14} className="inline mr-1" /> 商品列表
        </button>
        <button onClick={() => setActiveTab('orders')} className={`px-4 py-2 rounded-t-xl text-sm font-medium border-b-2 -mb-[2px] ${activeTab === 'orders' ? 'text-primary-600 border-primary-600 bg-primary-50/50' : 'text-warm-500 border-transparent'}`}>
          <Package size={14} className="inline mr-1" /> 兑换记录
        </button>
      </div>

      {/* 商品列表 */}
      {activeTab === 'products' && (
        loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-primary-600" /></div>
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag size={48} className="mx-auto mb-3 text-warm-300" />
            <p className="text-warm-400">商城暂无商品</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
            {products.map((product) => {
              const canAfford = userPoints >= product.points_required;
              const inStock = product.stock > 0;
              return (
                <div key={product.id} className="card overflow-hidden flex flex-col">
                  <div className="relative aspect-square rounded-xl mb-3 overflow-hidden bg-warm-100">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Package size={40} className="text-warm-300" />
                      </div>
                    )}
                    {product.stock <= 0 && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-white font-bold text-lg">已兑完</span>
                      </div>
                    )}
                  </div>
                  <h3 className="font-semibold text-warm-900 text-sm mb-1 line-clamp-2">{product.name}</h3>
                  {product.description && <p className="text-xs text-warm-400 mb-2 line-clamp-2">{product.description}</p>}
                  <div className="mt-auto">
                    <div className="flex items-center gap-1 mb-2">
                      <Award size={14} className="text-amber-500" />
                      <span className="font-bold text-amber-600">{product.points_required}</span>
                      <span className="text-xs text-warm-400">积分</span>
                      <span className="ml-auto text-xs text-warm-400">库存 {product.stock}</span>
                    </div>
                    <button
                      onClick={() => setExchangeProduct(product)}
                      disabled={!canAfford || !inStock}
                      className={`w-full py-2 rounded-xl text-sm font-medium transition ${canAfford && inStock ? 'btn-primary' : 'bg-warm-100 text-warm-400 cursor-not-allowed'}`}
                    >
                      {!inStock ? '已兑完' : !canAfford ? '积分不足' : '立即兑换'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* 兑换记录 */}
      {activeTab === 'orders' && (
        orders.length === 0 ? (
          <div className="text-center py-16">
            <Package size={48} className="mx-auto mb-3 text-warm-300" />
            <p className="text-warm-400">暂无兑换记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
              const StatusIcon = status.icon;
              return (
                <div key={order.id} className="card flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${status.bg}`}>
                    <StatusIcon size={20} className={status.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-warm-900 text-sm">{order.product_name}</p>
                    <p className="text-xs text-warm-400">{new Date(order.created_at).toLocaleString('zh-CN')}</p>
                    {order.recipient_name && <p className="text-xs text-warm-500 mt-1">收件人: {order.recipient_name} {order.recipient_phone}</p>}
                    {order.tracking_no && <p className="text-xs text-sky-600 mt-1">快递单号: {order.tracking_no}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-amber-600">-{order.points_spent}</p>
                    <span className={`text-xs ${status.color}`}>{status.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* 兑换弹窗 */}
      {exchangeProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setExchangeProduct(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-warm-900 mb-4">确认兑换</h3>
            <div className="flex items-center gap-3 mb-4 p-3 bg-warm-50 rounded-xl">
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-warm-100 shrink-0">
                {exchangeProduct.image_url ? (
                  <img src={exchangeProduct.image_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Package size={24} className="text-warm-300" /></div>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-warm-900 text-sm">{exchangeProduct.name}</p>
                <p className="text-amber-600 font-bold">{exchangeProduct.points_required} 积分</p>
                <p className="text-xs text-warm-400">兑换后剩余: {userPoints - exchangeProduct.points_required} 积分</p>
              </div>
            </div>
            <div className="space-y-3">
              <input className="input" placeholder="收件人姓名 *" value={exchangeForm.recipient_name} onChange={(e) => setExchangeForm({ ...exchangeForm, recipient_name: e.target.value })} />
              <input className="input" placeholder="收件人电话 *" value={exchangeForm.recipient_phone} onChange={(e) => setExchangeForm({ ...exchangeForm, recipient_phone: e.target.value })} />
              <textarea className="input" placeholder="收件地址/备注 *" rows={2} value={exchangeForm.recipient_address} onChange={(e) => setExchangeForm({ ...exchangeForm, recipient_address: e.target.value })} />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setExchangeProduct(null)} className="btn-secondary flex-1">取消</button>
              <button onClick={handleExchange} disabled={exchangeLoading} className="btn-primary flex-1">{exchangeLoading ? '兑换中...' : '确认兑换'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
