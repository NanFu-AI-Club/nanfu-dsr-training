/**
 * 终端跑店宝典 - Express 主入口
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, saveDb, saveDbSync, markDbDirty } = require('./database');
const { authRequired, adminRequired } = require('./middleware/auth');
const { securityHeaders, apiLimiter } = require('./middleware/security');

// 确保 .mjs 文件被正确识别为 JavaScript
express.static.mime.define({ 'text/javascript': ['mjs'] });

const app = express();
// Nginx 反向代理负责传递 X-Forwarded-For，信任一层代理后 req.ip 才能识别真实客户端 IP。
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3030;

// 安全头
app.use(securityHeaders);

// API 速率限制（默认每分钟 2000 次，可通过环境变量 API_RATE_LIMIT / API_RATE_WINDOW_MS 调整）
const apiRateLimit = parseInt(process.env.API_RATE_LIMIT, 10) || 2000;
const apiRateWindow = parseInt(process.env.API_RATE_WINDOW_MS, 10) || 60000;
app.use('/api', apiLimiter(apiRateLimit, apiRateWindow));

// 中间件（非 db 依赖的放在前面）
// 安全：生产环境必须配置具体的前端域名
const corsOrigin = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*');
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.warn('⚠️  警告: 生产环境未设置 CORS_ORIGIN，将拒绝所有跨域请求');
}
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 明确提供 .mjs 文件并设置正确的 Content-Type（必须在 static 之前）
app.get('/pdfjs/:file', (req, res, next) => {
  const filePath = path.join(__dirname, '..', 'client', 'dist', 'pdfjs', req.params.file);
  res.type('application/javascript');
  res.sendFile(filePath, (err) => {
    if (err) next();
  });
});

app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 健康检查（不需要 db）
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 定时自动保存数据库（仅在数据有变更时）
// 整库全量重写，数据库较大时开销明显；间隔可通过 DB_SAVE_INTERVAL_MS 调整，默认 180 秒
const dbSaveInterval = parseInt(process.env.DB_SAVE_INTERVAL_MS, 10) || 180000;
setInterval(() => {
  try { saveDb(); } catch (e) { console.error('数据库自动保存失败:', e.message); }
}, dbSaveInterval);

// 进程退出时强制保存
process.on('SIGINT', () => { saveDbSync(); process.exit(0); });
process.on('SIGTERM', () => { saveDbSync(); process.exit(0); });

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

  // 兼容部分安卓浏览器（vivo 等）把整条路径整体 URL 编码后请求的问题
  // 例：/api%2Fcourse-media%2Fxxx%3Ftype%3Dresource → /api/course-media/xxx?type=resource
  app.use((req, _res, next) => {
    if (req.url && /%2f/i.test(req.url)) {
      try {
        const decoded = decodeURIComponent(req.url);
        if (decoded.startsWith('/api/')) {
          req.url = decoded;
          delete req._parsedUrl; // 清除 parseurl 缓存，让 req.path 按新 URL 解析
          // Express 4 内置的 query 中间件已在更早阶段按原始 URL 解析并赋值 req.query，需重新解析
          const qIndex = decoded.indexOf('?');
          req.query = qIndex === -1
            ? {}
            : Object.fromEntries(new URLSearchParams(decoded.slice(qIndex + 1)));
        }
      } catch (_) { /* 解码失败则忽略，按原样处理 */ }
    }
    next();
  });

  // 路由注册（必须在 db 中间件后；认证路由保持公开以支持登录）
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', authRequired, require('./routes/users'));
  app.use('/api/knowledge', authRequired, require('./routes/knowledge'));
  app.use('/api/questions', authRequired, require('./routes/questions'));
  app.use('/api/exams', authRequired, require('./routes/exams'));
  app.use('/api/courses', authRequired, require('./routes/courses'));
  app.use('/api/checkin', authRequired, require('./routes/checkin'));
  app.use('/api/shop', authRequired, require('./routes/shop')); // 安全：添加认证保护
  app.use('/api/ai', authRequired, require('./routes/ai'));
  app.use('/api/training', authRequired, require('./routes/training'));
  app.use('/api/statistics', authRequired, require('./routes/statistics'));
  app.use('/api/dashboard', authRequired, adminRequired, require('./routes/dashboard'));
  app.use('/api/bi', authRequired, adminRequired, require('./routes/bi'));
  app.use('/api/logs', authRequired, adminRequired, require('./routes/logs'));
  app.use('/api/submissions', authRequired, require('./routes/submissions'));
  app.use('/api/shares', authRequired, require('./routes/shares'));
  app.use('/api/notifications', authRequired, require('./routes/notifications'));
  app.use('/api/announcements', authRequired, require('./routes/announcements'));
  app.use('/api', require('./routes/video-proxy'));   // 视频代理

  // 预热知识库向量缓存（异步执行，不阻塞服务启动；失败时首次检索会自动重试）
  try {
    const { buildDocVectorCache } = require('./services/siliconflow_embedding');
    buildDocVectorCache(db)
      .then(() => console.log('[embedding] 知识库向量缓存已预热'))
      .catch((e) => console.warn('[embedding] 预热失败（首次检索将重试）:', e.message));
  } catch (_) { /* 忽略加载失败 */ }

  // SPA 回退
  app.get('*', (req, res) => {
    // 接口路径不应回退到 HTML：否则带 Range 的请求会由 sendFile 抛出 416，并掩盖真实的 404
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ code: 404, message: '接口不存在' });
    }
    res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
  });

  // 全局错误处理（必须在路由之后注册）
  app.use((err, _req, res, _next) => {
    // 安全：不暴露详细错误信息
    const isDev = process.env.NODE_ENV === 'development';
    const message = isDev ? err.message : '服务器内部错误';

    console.error('Server Error:', {
      message: err.message,
      stack: isDev ? err.stack : undefined,
      path: _req.path,
      method: _req.method,
    });

    res.status(err.status || 500).json({
      code: err.status || 500,
      message,
      ...(isDev && { stack: err.stack })
    });
  });

  app.listen(PORT, () => {
    console.log(`🚀 终端跑店宝典已启动: http://localhost:${PORT}`);
    console.log(`📋 API: http://localhost:${PORT}/api`);
    console.log(`🏥 健康检查: http://localhost:${PORT}/api/health`);
    // 安全：仅在开发环境显示默认密码提示
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔑 管理员: admin / admin123 (仅开发环境)`);
      console.log(`👤 业务员: sales01 / sales123 (仅开发环境)`);
      console.log(`⚠️  生产环境请务必修改默认密码！`);
    }
  });
}).catch((err) => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});

module.exports = app;
