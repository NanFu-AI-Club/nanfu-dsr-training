/**
 * 南孚 DSR 销售培训系统 - Express 主入口
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, saveDb, markDbDirty } = require('./database');
const { authRequired, adminRequired } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3030;

// 中间件（非 db 依赖的放在前面）
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

// 健康检查（不需要 db）
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 每隔30秒自动保存数据库（仅在数据有变更时）
setInterval(() => {
  try { saveDb(); } catch (e) { console.error('数据库自动保存失败:', e.message); }
}, 30000);

// 进程退出时强制保存
process.on('SIGINT', () => { saveDb(true); process.exit(0); });
process.on('SIGTERM', () => { saveDb(true); process.exit(0); });

// 异步初始化后注册路由
initDatabase(false, true).then((db) => {
  // CRITICAL: db 中间件必须在路由之前注册
  app.use((req, _res, next) => { req.db = db; next(); });

  // 在写操作后标记脏数据
  app.use((req, _res, next) => {
    const originalEnd = _res.end;
    _res.end = function (...args) {
      if (req.method !== 'GET' && req.method !== 'HEAD' && _res.statusCode < 500) {
        markDbDirty();
      }
      originalEnd.apply(_res, args);
    };
    next();
  });

  // 路由注册（必须在 db 中间件后）
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', authRequired, require('./routes/users'));
  app.use('/api/knowledge', authRequired, require('./routes/knowledge'));
  app.use('/api/questions', authRequired, require('./routes/questions'));
  app.use('/api/exams', authRequired, require('./routes/exams'));
  app.use('/api/courses', authRequired, require('./routes/courses'));
  app.use('/api/ai', authRequired, require('./routes/ai'));
  app.use('/api/training', authRequired, require('./routes/training'));
  app.use('/api/statistics', authRequired, require('./routes/statistics'));
  app.use('/api/dashboard', authRequired, require('./routes/dashboard'));
  app.use('/api/logs', authRequired, adminRequired, require('./routes/logs'));
  app.use('/api', require('./routes/video-proxy'));   // 视频代理

  // SPA 回退
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
  });

  // 全局错误处理（必须在路由之后注册）
  app.use((err, _req, res, _next) => {
    console.error('Server Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  });

  app.listen(PORT, () => {
    console.log(`🚀 南孚 DSR 销售培训系统已启动: http://localhost:${PORT}`);
    console.log(`📋 API: http://localhost:${PORT}/api`);
    console.log(`🏥 健康检查: http://localhost:${PORT}/api/health`);
    console.log(`🔑 管理员: admin / admin123`);
    console.log(`👤 业务员: sales01 / sales123`);
  });
}).catch((err) => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});

module.exports = app;
