/**
 * 视频/图片/资源代理路由
 * — 解决跨域及 Safari Range 请求兼容性
 * — 支持通过 token 查询参数认证（浏览器原生标签无法设置 Authorization header）
 */
const router = require('express').Router();
const https = require('https');
const http = require('http');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'n@nfu-dsr-tm!n!ng-s3cr3t-k3y-2024';

// 对 <video>/<img> 等浏览器原生标签，认证走 token 查询参数
function tokenAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;

  try {
    let token;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (queryToken) {
      token = queryToken;
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(401).json({ code: 401, message: '未提供认证令牌' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(401).json({ code: 401, message: '令牌无效或已过期' });
  }
}

// 允许代理的域名白名单（TOS + 腾讯云 COS）
const ALLOWED_HOSTS = [
  // 火山引擎 TOS
  'tos-cn-beijing.volces.com',
  'tos-s3-cn-beijing.volces.com',
  '.volces.com',
  // 腾讯云 COS
  '.cos.ap-shanghai.myqcloud.com',
  '.cos.ap-guangzhou.myqcloud.com',
  '.cos.ap-beijing.myqcloud.com',
  '.cos.ap-chengdu.myqcloud.com',
  '.cos.ap-nanjing.myqcloud.com',
  '.cos.ap-chongqing.myqcloud.com',
  '.myqcloud.com',       // 兜底：所有腾讯云 COS 子域名
];

function isAllowedUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    // 仅允许 https 协议
    if (parsed.protocol !== 'https:') return false;
    // 仅允许白名单域名
    return ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith(h));
  } catch {
    return false;
  }
}

// OPTIONS 预检（Safari 跨域媒体请求）
router.options('/video-proxy', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Origin');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

router.get('/video-proxy', tokenAuth, (req, res) => {
  const { url } = req.query;
  if (!url) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ code: 400, message: '缺少 url 参数' });
  }

  // SSRF 防护：仅允许白名单域名
  if (!isAllowedUrl(url)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(403).json({ code: 403, message: '不允许的代理目标' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const targetUrl = new URL(url);
    const client = targetUrl.protocol === 'https:' ? https : http;
    const clientRange = req.headers.range;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': targetUrl.origin,
        'Accept': '*/*',
      },
    };

    // 将客户端 Range 转发到上游（Safari 视频播放核心）
    if (clientRange) {
      options.headers.Range = clientRange;
    }

    const proxyReq = client.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
      const upstreamContentLength = proxyRes.headers['content-length'];
      const isRangeResponse = statusCode === 206;
      const isPartial = statusCode === 206;

      // --- 响应头 ---
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      // 浏览器缓存 1 小时，减少重复代理请求
      res.setHeader('Cache-Control', 'private, max-age=3600');

      if (isPartial) {
        // 206 响应：保持上游返回的 Content-Range 和 Content-Length
        if (proxyRes.headers['content-range']) {
          res.setHeader('Content-Range', proxyRes.headers['content-range']);
        }
        if (upstreamContentLength) {
          res.setHeader('Content-Length', upstreamContentLength);
        }
        res.status(206);
      } else {
        // 200 响应：完整的 Content-Length
        if (upstreamContentLength) {
          res.setHeader('Content-Length', upstreamContentLength);
        }
        res.status(200);
      }

      // 流式透传
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('代理请求失败:', url, err.message);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: '资源代理失败: ' + err.message });
      }
    });

    proxyReq.setTimeout(60000, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: '资源加载超时' });
      }
    });

    proxyReq.end();
  } catch (err) {
    return res.status(400).json({ code: 400, message: 'URL 格式错误: ' + err.message });
  }
});

// ==================== 基于 ID 的资源代理（不暴露原始 URL） ====================
// GET /api/course-media/:courseId?type=resource|cover
router.get('/course-media/:courseId', tokenAuth, (req, res) => {
  const { courseId } = req.params;
  const { type } = req.query; // 'resource' or 'cover'

  const db = req.db;
  if (!db) {
    return res.status(500).json({ code: 500, message: '数据库未初始化' });
  }

  try {
    const course = db.prepare('SELECT resource_url, cover_url FROM courses WHERE id = ?').get(courseId);
    if (!course) {
      return res.status(404).json({ code: 404, message: '课程不存在' });
    }

    const url = type === 'cover' ? course.cover_url : course.resource_url;
    if (!url) {
      return res.status(404).json({ code: 404, message: '资源不存在' });
    }

    if (!isAllowedUrl(url)) {
      return res.status(403).json({ code: 403, message: '不允许的代理目标' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const targetUrl = new URL(url);
    const client = targetUrl.protocol === 'https:' ? https : http;
    const clientRange = req.headers.range;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': targetUrl.origin,
        'Accept': '*/*',
      },
    };

    if (clientRange) {
      options.headers.Range = clientRange;
    }

    const proxyReq = client.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
      const upstreamContentLength = proxyRes.headers['content-length'];
      const isPartial = statusCode === 206;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');

      if (isPartial) {
        if (proxyRes.headers['content-range']) {
          res.setHeader('Content-Range', proxyRes.headers['content-range']);
        }
        if (upstreamContentLength) {
          res.setHeader('Content-Length', upstreamContentLength);
        }
        res.status(206);
      } else {
        if (upstreamContentLength) {
          res.setHeader('Content-Length', upstreamContentLength);
        }
        res.status(200);
      }

      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: '资源代理失败' });
      }
    });

    proxyReq.setTimeout(60000, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: '资源加载超时' });
      }
    });

    proxyReq.end();
  } catch (err) {
    return res.status(400).json({ code: 400, message: '请求错误' });
  }
});

module.exports = router;
