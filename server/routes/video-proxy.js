/**
 * 视频/图片/资源代理路由
 * — 解决跨域及 Safari Range 请求兼容性
 * — 支持通过 token 查询参数认证（浏览器原生标签无法设置 Authorization header）
 * — 支持本地文件和远程文件
 */
const router = require('express').Router();
const https = require('https');
const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../middleware/auth');

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
    // 允许本地文件路径（以 /uploads/ 开头）
    // 安全：防止路径遍历攻击
    if (urlStr.startsWith('/uploads/')) {
      // 拒绝包含路径遍历字符的请求
      if (urlStr.includes('..') || urlStr.includes('\\') || urlStr.includes('//')) {
        return false;
      }
      // 验证路径规范化后仍在 /uploads/ 目录内
      const normalized = path.normalize(urlStr);
      if (!normalized.startsWith('/uploads/')) {
        return false;
      }
      return true;
    }
    
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
  const { type, inline } = req.query; // 'resource' or 'cover', inline=true for PDF/PPT

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
    // 允许iframe加载
    res.removeHeader('X-Frame-Options');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // 本地文件：直接从文件系统读取
    if (url.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', url);
      const fs = require('fs');
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ code: 404, message: '文件不存在' });
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      // 根据扩展名设置 Content-Type
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.pdf': 'application/pdf',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);
        res.status(206);

        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
      } else {
        res.setHeader('Content-Length', fileSize);
        res.status(200);
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
      }
      return;
    }

    // 远程文件：代理请求
    const targetUrl = new URL(url);
    const client = targetUrl.protocol === 'https:' ? https : http;
    const clientRange = req.headers.range;

    // 检测文件类型，用于设置 Content-Type 和 Content-Disposition
    const urlPath = targetUrl.pathname.toLowerCase();
    const isPdf = urlPath.endsWith('.pdf');
    const isPpt = urlPath.endsWith('.ppt') || urlPath.endsWith('.pptx');
    const isVideo = urlPath.endsWith('.mp4') || urlPath.endsWith('.webm') || urlPath.endsWith('.mov');

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
      let contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
      const upstreamContentLength = proxyRes.headers['content-length'];
      const isPartial = statusCode === 206;

      // 强制修正 Content-Type（COS可能返回错误的类型）
      if (isPdf) contentType = 'application/pdf';
      else if (isPpt) contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      else if (isVideo) contentType = 'video/mp4';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');

      // PDF/PPT 强制预览（inline），禁止下载（attachment）
      if (isPdf || isPpt) {
        const filename = decodeURIComponent(targetUrl.pathname.split('/').pop());
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
      }

      // 允许iframe加载
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');

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

// ==================== PPT 转 PDF ====================
// GET /api/ppt-to-pdf/:courseId - 将PPT转换为PDF并返回
router.get('/ppt-to-pdf/:courseId', tokenAuth, (req, res) => {
  const { courseId } = req.params;
  const db = req.db;
  if (!db) return res.status(500).json({ code: 500, message: '数据库未初始化' });

  try {
    const course = db.prepare('SELECT resource_url, title FROM courses WHERE id = ?').get(courseId);
    if (!course) return res.status(404).json({ code: 404, message: '课程不存在' });

    const url = course.resource_url;
    if (!url) return res.status(404).json({ code: 404, message: '资源不存在' });
    if (!isAllowedUrl(url)) return res.status(403).json({ code: 403, message: '不允许的代理目标' });

    const https = require('https');
    const http = require('http');
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    const os = require('os');

    // 创建临时目录
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt2pdf-'));
    const targetUrl = new URL(url);
    const ext = path.extname(targetUrl.pathname) || '.pptx';
    const inputPath = path.join(tmpDir, `input${ext}`);
    const outputDir = path.join(tmpDir, 'output');

    // 下载PPT文件
    const client = targetUrl.protocol === 'https:' ? https : http;

    const downloadFile = () => new Promise((resolve, reject) => {
      client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
        if (response.statusCode >= 400) {
          return reject(new Error(`下载失败: ${response.statusCode}`));
        }
        const file = fs.createWriteStream(inputPath);
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    });

    downloadFile()
      .then(() => {
        // 使用 LibreOffice 转换
        execSync(`libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`, {
          timeout: 60000,
          stdio: 'pipe'
        });

        const pdfFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.pdf'));
        if (pdfFiles.length === 0) throw new Error('转换失败：未生成PDF文件');

        const pdfPath = path.join(outputDir, pdfFiles[0]);
        const pdfBuffer = fs.readFileSync(pdfPath);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(course.title || 'document')}.pdf`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(pdfBuffer);

        // 清理临时文件
        fs.rmSync(tmpDir, { recursive: true, force: true });
      })
      .catch((err) => {
        console.error('[ppt-to-pdf] Error:', err);
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        if (!res.headersSent) {
          res.status(500).json({ code: 500, message: 'PPT转换失败: ' + err.message });
        }
      });
  } catch (err) {
    console.error('[ppt-to-pdf] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
