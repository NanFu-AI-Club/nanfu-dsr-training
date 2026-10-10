import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, AlertCircle, Plus, Edit2, Trash2, Package, Award, ShoppingBag, X, Upload, Download } from 'lucide-react';
import api from '../../api';
import { formatShanghai, todayShanghai } from '../../utils/time';

export default function AdminShop() {
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/shop/products');
      setProducts(res.data?.data?.list || res.data?.list || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/shop/orders/all');
      setOrders(res.data?.data?.list || res.data?.list || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (tab === 'products') loadProducts(); else loadOrders(); }, [tab, loadProducts, loadOrders]);

  const handleDelete = async (id) => {
    if (!confirm('确认删除该商品？')) return;
    try { await api.delete('/shop/products/' + id); loadProducts(); } catch (err) { alert('删除失败'); }
  };

  const handleOrderStatus = async (id, status) => {
    try { await api.put('/shop/orders/' + id + '/status', { status }); loadOrders(); } catch (err) { alert('更新失败'); }
  };

  const handleTrackingUpdate = async (id, trackingNo) => {
    try { await api.put('/shop/orders/' + id + '/tracking', { tracking_no: trackingNo }); loadOrders(); } catch (err) { alert('快递单号更新失败'); }
  };

  const handleExportOrders = async () => {
    try {
      const res = await api.get('/shop/orders/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data || res]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `兑换订单_${todayShanghai()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + (err?.message || '未知错误'));
    }
  };

  const STATUS_MAP = { pending: '待处理', shipped: '已发货', completed: '已完成', cancelled: '已取消' };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto space-y-6">
      <h2 className="page-title">积分商城管理</h2>
      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => setTab('products')} className={`px-4 py-2 rounded-t-xl text-sm font-medium border-b-2 -mb-[2px] ${tab === 'products' ? 'text-primary-600 border-primary-600' : 'text-warm-500 border-transparent'}`}>
          <Package size={14} className="inline mr-1" />商品管理
        </button>
        <button onClick={() => setTab('orders')} className={`px-4 py-2 rounded-t-xl text-sm font-medium border-b-2 -mb-[2px] ${tab === 'orders' ? 'text-primary-600 border-primary-600' : 'text-warm-500 border-transparent'}`}>
          <ShoppingBag size={14} className="inline mr-1" />兑换订单
        </button>
      </div>

      {tab === 'products' && (
        <>
          <div className="flex justify-end">
            <button onClick={() => { setEditProduct(null); setShowForm(true); }} className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={16} />添加商品
            </button>
          </div>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 size={28} className="animate-spin text-primary-600" /></div>
          ) : products.length === 0 ? (
            <p className="text-center text-warm-400 py-10">暂无商品</p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-warm-500">
                  <th className="text-left py-3 px-3">商品名称</th><th className="text-left py-3 px-3">图片</th>
                  <th className="text-left py-3 px-3">所需积分</th><th className="text-left py-3 px-3">库存</th>
                  <th className="text-left py-3 px-3">状态</th><th className="text-left py-3 px-3">操作</th>
                </tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} className="border-b border-warm-50 hover:bg-warm-50/50">
                      <td className="py-3 px-3 font-medium text-warm-900">{p.name}</td>
                      <td className="py-3 px-3">{p.image_url ? <img src={p.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <span className="text-warm-300">无</span>}</td>
                      <td className="py-3 px-3 text-amber-600 font-semibold">{p.points_required}</td>
                      <td className="py-3 px-3">{p.stock}</td>
                      <td className="py-3 px-3"><span className={`badge ${p.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{p.status === 'active' ? '上架' : '下架'}</span></td>
                      <td className="py-3 px-3"><div className="flex gap-2">
                        <button onClick={() => { setEditProduct(p); setShowForm(true); }} className="p-1.5 hover:bg-warm-100 rounded-lg text-warm-500"><Edit2 size={15} /></button>
                        <button onClick={() => handleDelete(p.id)} className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-500"><Trash2 size={15} /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'orders' && (
        <>
          <div className="flex justify-end">
            <button onClick={handleExportOrders} className="btn-secondary flex items-center gap-2 text-sm">
              <Download size={16} />导出订单
            </button>
          </div>
          {loading ? (<div className="flex justify-center py-10"><Loader2 size={28} className="animate-spin text-primary-600" /></div>) :
          orders.length === 0 ? (<p className="text-center text-warm-400 py-10">暂无兑换订单</p>) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-warm-500">
                <th className="text-left py-3 px-3">商品</th><th className="text-left py-3 px-3">用户</th>
                <th className="text-left py-3 px-3">消耗积分</th><th className="text-left py-3 px-3">收件信息</th>
                <th className="text-left py-3 px-3">快递单号</th>
                <th className="text-left py-3 px-3">时间</th><th className="text-left py-3 px-3">状态</th><th className="text-left py-3 px-3">操作</th>
              </tr></thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-warm-50 hover:bg-warm-50/50">
                    <td className="py-3 px-3 font-medium">{o.product_name}</td>
                    <td className="py-3 px-3">{o.real_name || o.username || '-'}</td>
                    <td className="py-3 px-3 text-amber-600 font-semibold">{o.points_spent}</td>
                    <td className="py-3 px-3 text-xs text-warm-500">{o.recipient_name} {o.recipient_phone}{o.recipient_address ? ' / ' + o.recipient_address : ''}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1">
                        <input
                          className="input text-xs py-1 px-2 w-32"
                          placeholder="输入快递单号"
                          defaultValue={o.tracking_no || ''}
                          onBlur={(e) => {
                            if (e.target.value !== (o.tracking_no || '')) {
                              handleTrackingUpdate(o.id, e.target.value);
                            }
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-3 text-xs text-warm-400">{formatShanghai(o.created_at)}</td>
                    <td className="py-3 px-3"><span className={`badge ${o.status === 'completed' ? 'badge-green' : o.status === 'pending' ? 'badge-amber' : o.status === 'shipped' ? 'badge-blue' : 'badge-gray'}`}>{STATUS_MAP[o.status]}</span></td>
                    <td className="py-3 px-3">
                      {o.status === 'pending' && (<div className="flex gap-1">
                        <button onClick={() => handleOrderStatus(o.id, 'shipped')} className="px-2 py-1 text-xs rounded-lg bg-sky-50 text-sky-600 hover:bg-sky-100">发货</button>
                        <button onClick={() => handleOrderStatus(o.id, 'cancelled')} className="px-2 py-1 text-xs rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">取消</button>
                      </div>)}
                      {o.status === 'shipped' && <button onClick={() => handleOrderStatus(o.id, 'completed')} className="px-2 py-1 text-xs rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100">完成</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {showForm && <ProductForm product={editProduct} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); loadProducts(); }} />}
    </div>
  );
}

function ProductForm({ product, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: product?.name || '', description: product?.description || '', image_url: product?.image_url || '',
    points_required: product?.points_required || 0, stock: product?.stock || 0, category: product?.category || '',
    status: product?.status || 'active', sort_order: product?.sort_order || 0,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post('/shop/upload-image', formData);
      const url = res.data?.url || res.data?.data?.url;
      if (url) {
        setForm(prev => ({ ...prev, image_url: url }));
      } else {
        alert('上传成功但未返回图片地址');
      }
    } catch (err) {
      alert('图片上传失败：' + (err?.message || '未知错误'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.name) { alert('请输入商品名称'); return; }
    try {
      setSaving(true);
      if (product) { await api.put('/shop/products/' + product.id, form); }
      else { await api.post('/shop/products', form); }
      onSaved();
    } catch (err) { alert('保存失败'); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{product ? '编辑商品' : '添加商品'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-warm-100 rounded-lg"><X size={20} className="text-warm-400" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-warm-700 mb-1">商品名称 *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="block text-sm font-medium text-warm-700 mb-1">商品描述</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">商品图片</label>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-xl overflow-hidden bg-warm-100 border border-warm-200 shrink-0">
                {form.image_url ? <img src={form.image_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Package size={24} className="text-warm-300" /></div>}
              </div>
              <div className="flex-1">
                <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary flex items-center gap-2 text-sm">
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploading ? '上传中...' : '选择图片'}
                </button>
                {form.image_url && <button type="button" onClick={() => setForm({ ...form, image_url: '' })} className="ml-2 text-xs text-rose-500 hover:text-rose-700">移除</button>}
                <p className="text-xs text-warm-400 mt-1">支持 jpg/png/gif/webp，最大5MB</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-warm-700 mb-1">所需积分</label><input type="number" className="input" value={form.points_required} onChange={e => setForm({ ...form, points_required: parseInt(e.target.value) || 0 })} /></div>
            <div><label className="block text-sm font-medium text-warm-700 mb-1">库存</label><input type="number" className="input" value={form.stock} onChange={e => setForm({ ...form, stock: parseInt(e.target.value) || 0 })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-warm-700 mb-1">分类</label><input className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-warm-700 mb-1">状态</label>
              <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="active">上架</option><option value="inactive">下架</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
