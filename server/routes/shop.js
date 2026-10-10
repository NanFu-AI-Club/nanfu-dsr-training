const express = require('express');
const { nowShanghaiString } = require('../utils/time');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authRequired, systemAdminRequired, getOrgUserScope } = require('../middleware/auth');
const { logActivity } = require('./users');

// 图片上传存储配置
const uploadDir = path.join(__dirname, '..', 'uploads', 'shop');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `product_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(allowed.includes(ext) ? null : new Error('仅支持 jpg/png/gif/webp 格式'), allowed.includes(ext));
  },
});

// POST /shop/upload-image - 上传商品图片（管理员）
router.post('/upload-image', authRequired, systemAdminRequired, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件大小不能超过5MB' : (err.message || '文件上传失败');
      return res.status(400).json({ code: 400, message: msg });
    }
    if (!req.file) return res.status(400).json({ code: 400, message: '请选择图片文件' });
    const imageUrl = `/uploads/shop/${req.file.filename}`;
    res.json({ code: 0, data: { url: imageUrl } });
  });
});

// GET /shop/products - 获取商品列表
router.get('/products', authRequired, (req, res) => {
  try {
    const db = req.db;
    let sql = 'SELECT * FROM shop_products';
    const params = [];
    if (req.user.role !== 'admin' || req.user.manager_type === 'city_manager') {
      sql += ' WHERE status = ?';
      params.push('active');
    }
    sql += ' ORDER BY sort_order ASC, created_at DESC';
    const products = db.prepare(sql).all(...params);
    res.json({ code: 0, data: { list: products } });
  } catch (err) {
    console.error('[shop/products] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /shop/products - 创建商品（管理员）
router.post('/products', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const { name, description, image_url, points_required, stock, category, sort_order } = req.body;
    if (!name) return res.status(400).json({ code: 400, message: '商品名称不能为空' });
    const id = uuidv4();
    const now = nowShanghaiString();
    db.prepare(`INSERT INTO shop_products (id, name, description, image_url, points_required, stock, category, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(id, name, description || null, image_url || null, points_required || 0, stock || 0, category || null, sort_order || 0, now, now);
    logActivity(db, req.user.id, 'create', 'shop_product', id, JSON.stringify({ name }));
    res.json({ code: 0, message: '商品创建成功', data: { id } });
  } catch (err) {
    console.error('[shop/products/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /shop/products/:id - 更新商品（管理员）
router.put('/products/:id', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const { name, description, image_url, points_required, stock, category, status, sort_order } = req.body;
    const existing = db.prepare('SELECT id FROM shop_products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ code: 404, message: '商品不存在' });
    const now = nowShanghaiString();
    db.prepare(`UPDATE shop_products SET name = COALESCE(?, name), description = COALESCE(?, description), image_url = COALESCE(?, image_url), points_required = COALESCE(?, points_required), stock = COALESCE(?, stock), category = COALESCE(?, category), status = COALESCE(?, status), sort_order = COALESCE(?, sort_order), updated_at = ? WHERE id = ?`).run(name || null, description || null, image_url || null, points_required != null ? points_required : null, stock != null ? stock : null, category || null, status || null, sort_order != null ? sort_order : null, now, req.params.id);
    res.json({ code: 0, message: '商品更新成功' });
  } catch (err) {
    console.error('[shop/products/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /shop/products/:id - 删除商品（管理员）
router.delete('/products/:id', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    db.prepare('DELETE FROM shop_products WHERE id = ?').run(req.params.id);
    res.json({ code: 0, message: '商品已删除' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /shop/orders - 兑换商品
router.post('/orders', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { product_id, recipient_name, recipient_phone, recipient_address, remark } = req.body;
    const id = uuidv4();
    const now = nowShanghaiString();
    const createOrder = db.transaction(() => {
      const product = db.prepare('SELECT * FROM shop_products WHERE id = ? AND status = ?').get(product_id, 'active');
      if (!product) throw Object.assign(new Error('商品不存在或已下架'), { status: 404 });
      const user = db.prepare('SELECT id, points FROM users WHERE id = ?').get(req.user.id);
      if (!user || user.points < product.points_required) throw Object.assign(new Error('积分不足'), { status: 400 });
      const stockResult = db.prepare('UPDATE shop_products SET stock = stock - 1, updated_at = ? WHERE id = ? AND stock > 0').run(now, product_id);
      if (!stockResult.changes) throw Object.assign(new Error('商品库存不足'), { status: 400 });
      const pointsResult = db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?').run(product.points_required, req.user.id, product.points_required);
      if (!pointsResult.changes) throw Object.assign(new Error('积分不足'), { status: 400 });
      db.prepare(`INSERT INTO shop_orders (id, user_id, product_id, product_name, points_spent, status, recipient_name, recipient_phone, recipient_address, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`).run(id, req.user.id, product_id, product.name, product.points_required, recipient_name || null, recipient_phone || null, recipient_address || null, remark || null, now, now);
      db.prepare(`INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuidv4(), req.user.id, -product.points_required, '兑换商品: ' + product.name, 'shop_exchange', id, now);
      return product.points_required;
    });
    const pointsSpent = createOrder();
    res.json({ code: 0, message: '兑换成功！请等待管理员处理发货。', data: { order_id: id, points_spent: pointsSpent } });
  } catch (err) {
    console.error('[shop/orders/create] Error:', err);
    res.status(err.status || 500).json({ code: err.status || 500, message: err.status ? err.message : '服务器内部错误' });
  }
});

// GET /shop/orders - 我的兑换记录
router.get('/orders', authRequired, (req, res) => {
  try {
    const db = req.db;
    const orders = db.prepare('SELECT * FROM shop_orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ code: 0, data: { list: orders } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /shop/orders/all - 所有兑换记录（管理员）
router.get('/orders/all', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const scope = getOrgUserScope(db, req.user, 'u');
    let sql = `SELECT so.*, u.username, u.real_name FROM shop_orders so LEFT JOIN users u ON so.user_id = u.id WHERE ${scope.clause}`;
    const params = [...scope.params];
    if (req.query.status) { sql += ' AND so.status = ?'; params.push(req.query.status); }
    sql += ' ORDER BY so.created_at DESC';
    const orders = db.prepare(sql).all(...params);
    res.json({ code: 0, data: { list: orders } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /shop/orders/export - 批量导出兑换订单（CSV，管理员）
router.get('/orders/export', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const scope = getOrgUserScope(db, req.user, 'u');
    let sql = `SELECT so.*, u.username, u.real_name FROM shop_orders so LEFT JOIN users u ON so.user_id = u.id WHERE ${scope.clause}`;
    const params = [...scope.params];
    if (req.query.status) { sql += ' AND so.status = ?'; params.push(req.query.status); }
    sql += ' ORDER BY so.created_at DESC';
    const orders = db.prepare(sql).all(...params);

    const statusMap = { pending: '待处理', shipped: '已发货', completed: '已完成', cancelled: '已取消' };
    const headers = ['商品名称', '用户', '消耗积分', '收件人', '联系电话', '收货地址', '备注', '快递单号', '状态', '兑换时间'];
    const rows = orders.map(o => [
      o.product_name || '',
      o.real_name || o.username || '',
      o.points_spent ?? '',
      o.recipient_name || '',
      o.recipient_phone || '',
      o.recipient_address || '',
      o.remark || '',
      o.tracking_no || '',
      statusMap[o.status] || o.status || '',
      o.created_at || '',
    ]);

    const escapeCell = (v) => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [headers.map(escapeCell).join(','), ...rows.map(r => r.map(escapeCell).join(','))];
    const csv = '\uFEFF' + lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="shop_orders.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[shop/orders/export] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /shop/orders/:id/status - 更新订单状态（管理员）
router.put('/orders/:id/status', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const { status } = req.body;
    if (!['pending', 'shipped', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ code: 400, message: '无效的状态' });
    const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    if (status === 'cancelled' && order.status === 'pending') {
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(order.points_spent, order.user_id);
      db.prepare('UPDATE shop_products SET stock = stock + 1 WHERE id = ?').run(order.product_id);
      db.prepare(`INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuidv4(), order.user_id, order.points_spent, '兑换取消退还: ' + order.product_name, 'shop_refund', req.params.id, nowShanghaiString());
    }
    db.prepare('UPDATE shop_orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowShanghaiString(), req.params.id);
    res.json({ code: 0, message: '订单状态已更新' });
  } catch (err) {
    console.error('[shop/orders/status] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /shop/orders/:id/tracking - 更新快递单号（管理员）
router.put('/orders/:id/tracking', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const { tracking_no } = req.body;
    const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    db.prepare('UPDATE shop_orders SET tracking_no = ?, updated_at = ? WHERE id = ?').run(tracking_no || null, nowShanghaiString(), req.params.id);
    // 如果填了快递单号且状态还是待处理，自动改为已发货
    if (tracking_no && order.status === 'pending') {
      db.prepare('UPDATE shop_orders SET status = ?, updated_at = ? WHERE id = ?').run('shipped', nowShanghaiString(), req.params.id);
    }
    res.json({ code: 0, message: '快递单号已更新' });
  } catch (err) {
    console.error('[shop/orders/tracking] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
