const express = require('express');
const { formatShanghai, dateFilename, nowShanghaiString } = require('../utils/time');
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');
const { clearDocVectorCache } = require('../services/siliconflow_embedding');

function csvEscape(val) {
  const s = String(val || '').replace(/"/g, '""');
  return `"${s}"`;
}

/**
 * 记录操作日志
 */
function logActivity(db, userId, action, targetType, targetId, detail, module = 'knowledge', ip = null) {
  const id = uuidv4();
  const now = nowShanghaiString();
  const detailStr = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null;
  db.prepare(
    `INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, action, module, targetType, targetId, detailStr, ip, now);
}

/**
 * 文档内容变化后，删除其向量并清空缓存，下次检索时重新向量化
 */
function invalidateDocVector(db, docId) {
  try {
    db.prepare('DELETE FROM kb_document_vectors WHERE doc_id = ?').run(docId);
    clearDocVectorCache();
  } catch (_) { /* 向量表不存在或加载失败时忽略 */ }
}

// ============================================================
// 分类 CRUD
// ============================================================

/**
 * GET /knowledge/categories
 * 分类列表
 */
function listCategories(req, res) {
  const db = req.db;
  const rows = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM kb_documents d WHERE d.category_id = c.id) as doc_count
     FROM kb_categories c
     ORDER BY c.sort_order ASC, c.created_at DESC`
  ).all();

  res.json({ code: 0, data: rows });
}

/**
 * POST /knowledge/categories
 * 创建分类
 */
function createCategory(req, res) {
  const db = req.db;
  const { name, sort_order } = req.body;

  if (!name) {
    return res.status(400).json({ code: 400, message: '分类名称为必填项' });
  }

  const existing = db.prepare('SELECT id FROM kb_categories WHERE name = ?').get(name);
  if (existing) {
    return res.status(400).json({ code: 400, message: '分类名称已存在' });
  }

  const id = uuidv4();
  const now = nowShanghaiString();

  db.prepare(
    `INSERT INTO kb_categories (id, name, sort_order, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, name, sort_order || 0, now);

  logActivity(db, req.user.id, 'create', 'kb_category', id,
    `创建知识库分类：${name}`);

  const category = db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id);
  res.json({ code: 0, data: category });
}

/**
 * PUT /knowledge/categories/:id
 * 更新分类
 */
function updateCategory(req, res) {
  const db = req.db;
  const { id } = req.params;
  const { name, sort_order } = req.body;

  const existing = db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '分类不存在' });
  }

  if (name && name !== existing.name) {
    const dup = db.prepare('SELECT id FROM kb_categories WHERE name = ? AND id != ?').get(name, id);
    if (dup) {
      return res.status(400).json({ code: 400, message: '分类名称已存在' });
    }
  }

  const now = nowShanghaiString();
  db.prepare(
    `UPDATE kb_categories SET name = ?, sort_order = ? WHERE id = ?`
  ).run(
    name !== undefined ? name : existing.name,
    sort_order !== undefined ? sort_order : existing.sort_order,
    id
  );

  logActivity(db, req.user.id, 'update', 'kb_category', id,
    `更新知识库分类：${name || existing.name}`);

  const category = db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id);
  res.json({ code: 0, data: category });
}

/**
 * DELETE /knowledge/categories/:id
 * 删除分类
 */
function deleteCategory(req, res) {
  const db = req.db;
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '分类不存在' });
  }

  // 将该分类下的文档移至无分类
  db.prepare('UPDATE kb_documents SET category_id = NULL WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM kb_categories WHERE id = ?').run(id);

  logActivity(db, req.user.id, 'delete', 'kb_category', id,
    `删除知识库分类：${existing.name}`);

  res.json({ code: 0, data: null });
}

// ============================================================
// 文档 CRUD + 版本管理
// ============================================================

/**
 * GET /knowledge/documents
 * 文档列表（分页、搜索、按分类筛选）
 */
function listDocuments(req, res) {
  const db = req.db;
  const {
    page = 1,
    limit = 20,
    keyword = '',
    category_id = '',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const limitNum = Number(limit);

  let whereClauses = [];
  let params = [];

  if (keyword) {
    whereClauses.push('(d.title LIKE ? OR d.content LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  if (category_id) {
    whereClauses.push('d.category_id = ?');
    params.push(category_id);
  }

  const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM kb_documents d ${whereSQL}`
  ).get(...params);

  const rows = db.prepare(
    `SELECT d.id, d.title, d.content, d.category_id, d.version, d.created_at, d.updated_at,
            c.name as category_name,
            u.username as created_by_name
     FROM kb_documents d
     LEFT JOIN kb_categories c ON c.id = d.category_id
     LEFT JOIN users u ON u.id = d.created_by
     ${whereSQL}
     ORDER BY d.updated_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limitNum, offset);

  res.json({
    code: 0,
    data: {
      list: rows,
      total: countRow.total,
      page: Number(page),
      limit: limitNum,
    },
  });
}

/**
 * GET /knowledge/documents/:id
 * 文档详情
 */
function getDocument(req, res) {
  const db = req.db;
  const { id } = req.params;

  const doc = db.prepare(
    `SELECT d.*, c.name as category_name, u.username as created_by_name
     FROM kb_documents d
     LEFT JOIN kb_categories c ON c.id = d.category_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.id = ?`
  ).get(id);

  if (!doc) {
    return res.status(400).json({ code: 400, message: '文档不存在' });
  }

  res.json({ code: 0, data: doc });
}

/**
 * POST /knowledge/documents
 * 创建文档（自动保存版本到 kb_versions）
 */
function createDocument(req, res) {
  const db = req.db;
  const { title, content, category_id } = req.body;

  if (!title) {
    return res.status(400).json({ code: 400, message: '文档标题为必填项' });
  }

  const id = uuidv4();
  const now = nowShanghaiString();
  const version = 1;

  // 插入文档
  db.prepare(
    `INSERT INTO kb_documents (id, title, content, category_id, version, is_current, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 'published', ?, ?, ?)`
  ).run(id, title, content || '', category_id || null, version, req.user.id, now, now);

  // 保存初始版本
  const versionId = uuidv4();
  db.prepare(
    `INSERT INTO kb_versions (id, document_id, version, content, changed_by, change_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(versionId, id, version, content || '', req.user.id, '创建文档', now);

  logActivity(db, req.user.id, 'create', 'kb_document', id,
    `创建知识库文档：${title}`);

  const doc = db.prepare(
    `SELECT d.*, c.name as category_name, u.username as created_by_name
     FROM kb_documents d
     LEFT JOIN kb_categories c ON c.id = d.category_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.id = ?`
  ).get(id);

  res.json({ code: 0, data: doc });
}

/**
 * PUT /knowledge/documents/:id
 * 编辑文档：版本号 +1，旧版存入 kb_versions，is_current 更新
 */
function updateDocument(req, res) {
  const db = req.db;
  const { id } = req.params;
  const { title, content, category_id } = req.body;

  const existing = db.prepare('SELECT * FROM kb_documents WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '文档不存在' });
  }

  const now = nowShanghaiString();
  const newVersion = existing.version + 1;
  const newTitle = title !== undefined ? title : existing.title;
  const newContent = content !== undefined ? content : existing.content;
  const newCategoryId = category_id !== undefined ? category_id : existing.category_id;

  // 更新文档
  db.prepare(
    `UPDATE kb_documents SET title = ?, content = ?, category_id = ?, version = ?, updated_at = ? WHERE id = ?`
  ).run(newTitle, newContent, newCategoryId, newVersion, now, id);

  // 文档内容已变化，删除旧向量，下次检索时重新向量化
  invalidateDocVector(db, id);

  // 插入新版本记录
  const versionId = uuidv4();
  db.prepare(
    `INSERT INTO kb_versions (id, document_id, version, content, changed_by, change_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(versionId, id, newVersion, newContent, req.user.id, '编辑文档', now);

  logActivity(db, req.user.id, 'update', 'kb_document', id,
    `编辑知识库文档：${newTitle}（版本 ${newVersion}）`);

  const doc = db.prepare(
    `SELECT d.*, c.name as category_name, u.username as created_by_name
     FROM kb_documents d
     LEFT JOIN kb_categories c ON c.id = d.category_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.id = ?`
  ).get(id);

  res.json({ code: 0, data: doc });
}

/**
 * DELETE /knowledge/documents/:id
 * 删除文档
 */
function deleteDocument(req, res) {
  const db = req.db;
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM kb_documents WHERE id = ?').get(id);
  if (!existing) {
    return res.status(400).json({ code: 400, message: '文档不存在' });
  }

  // 删除文档及其所有版本
  db.prepare('DELETE FROM kb_versions WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM kb_documents WHERE id = ?').run(id);

  // 删除对应向量
  invalidateDocVector(db, id);

  logActivity(db, req.user.id, 'delete', 'kb_document', id,
    `删除知识库文档：${existing.title}`);

  res.json({ code: 0, data: null });
}

// ============================================================
// 版本历史与回滚
// ============================================================

/**
 * GET /knowledge/documents/:id/versions
 * 版本历史列表
 */
function getDocumentVersions(req, res) {
  const db = req.db;
  const { id } = req.params;

  const doc = db.prepare('SELECT id FROM kb_documents WHERE id = ?').get(id);
  if (!doc) {
    return res.status(400).json({ code: 400, message: '文档不存在' });
  }

  const rows = db.prepare(
    `SELECT v.*, u.username as changed_by_name
     FROM kb_versions v
     LEFT JOIN users u ON u.id = v.changed_by
     WHERE v.document_id = ?
     ORDER BY v.version DESC`
  ).all(id);

  res.json({ code: 0, data: rows });
}

/**
 * POST /knowledge/documents/:id/rollback/:versionId
 * 回滚到指定版本（生成新版本号，内容从目标版本复制）
 */
function rollbackDocument(req, res) {
  const db = req.db;
  const { id, versionId } = req.params;

  const doc = db.prepare('SELECT * FROM kb_documents WHERE id = ?').get(id);
  if (!doc) {
    return res.status(400).json({ code: 400, message: '文档不存在' });
  }

  const targetVersion = db.prepare(
    'SELECT * FROM kb_versions WHERE id = ? AND document_id = ?'
  ).get(versionId, id);
  if (!targetVersion) {
    return res.status(400).json({ code: 400, message: '目标版本不存在' });
  }

  const now = nowShanghaiString();
  const newVersion = doc.version + 1;

  // 更新文档为回滚版本的内容（仅内容回滚，标题和分类保持不变）
  db.prepare(
    `UPDATE kb_documents
     SET version = ?, updated_at = ?
     WHERE id = ?`
  ).run(newVersion, now, id);

  // 同时更新文档内容为旧版本的内容
  db.prepare(
    `UPDATE kb_documents
     SET content = ?, updated_at = ?
     WHERE id = ?`
  ).run(targetVersion.content, now, id);

  // 内容已回滚，删除旧向量，下次检索时重新向量化
  invalidateDocVector(db, id);

  // 插入新版本记录（记录回滚操作）
  const newVersionId = uuidv4();
  db.prepare(
    `INSERT INTO kb_versions (id, document_id, version, content, changed_by, change_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(newVersionId, id, newVersion, targetVersion.content,
        req.user.id, `回滚至版本 ${targetVersion.version}`, now);

  logActivity(db, req.user.id, 'rollback', 'kb_document', id,
    `回滚知识库文档：从版本 ${targetVersion.version} 回滚，生成新版本 ${newVersion}`);

  const updatedDoc = db.prepare(
    `SELECT d.*, c.name as category_name, u.username as created_by_name
     FROM kb_documents d
     LEFT JOIN kb_categories c ON c.id = d.category_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.id = ?`
  ).get(id);

  res.json({ code: 0, data: updatedDoc });
}

// ============================================================
// 全文搜索
// ============================================================

/**
 * POST /knowledge/search?keyword=xx
 * 全文搜索文档标题和内容
 */
function searchDocuments(req, res) {
  const db = req.db;
  const { keyword } = req.query;

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ code: 400, message: '搜索关键词为必填项' });
  }

  const { page = 1, limit = 20, category_id = '' } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const limitNum = Number(limit);

  let whereClauses = ['(d.title LIKE ? OR d.content LIKE ?)'];
  let params = [`%${keyword.trim()}%`, `%${keyword.trim()}%`];

  if (category_id) {
    whereClauses.push('d.category_id = ?');
    params.push(category_id);
  }

  const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM kb_documents d ${whereSQL}`
  ).get(...params);

  const rows = db.prepare(
    `SELECT d.id, d.title,
            SUBSTR(d.content, 1, 300) as content_snippet,
            d.category_id, d.version, d.created_at, d.updated_at,
            c.name as category_name,
            u.username as created_by_name
     FROM kb_documents d
     LEFT JOIN kb_categories c ON c.id = d.category_id
     LEFT JOIN users u ON u.id = d.created_by
     ${whereSQL}
     ORDER BY d.updated_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limitNum, offset);

  res.json({
    code: 0,
    data: {
      list: rows,
      total: countRow.total,
      page: Number(page),
      limit: limitNum,
      keyword: keyword.trim(),
    },
  });
}

// ============================================================
// 反馈工单
// ============================================================

/**
 * GET /knowledge/feedbacks
 * 反馈工单列表（admin 看全部，sales 看自己的 ai_feedbacks）
 */
function listFeedbacks(req, res) {
  const db = req.db;
  const { page = 1, limit = 20, rating = '' } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const limitNum = Number(limit);

  let whereClauses = [];
  let params = [];

  // 非 admin 只能看自己的反馈
  if (req.user.role !== 'admin') {
    whereClauses.push('f.user_id = ?');
    params.push(req.user.id);
  }

  // rating 筛选
  if (rating) {
    if (rating === 'none') {
      whereClauses.push("(f.rating IS NULL OR f.rating = '' OR f.rating = 'none')");
    } else {
      whereClauses.push('f.rating = ?');
      params.push(rating);
    }
  }

  const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM ai_feedbacks f ${whereSQL}`
  ).get(...params);

  const rows = db.prepare(
    `SELECT f.*, u.username, u.real_name as user_name,
            fav.id as favorite_id
     FROM ai_feedbacks f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN ai_favorites fav ON fav.feedback_id = f.id
     ${whereSQL}
     ORDER BY f.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limitNum, offset);

  res.json({
    code: 0,
    data: {
      list: rows,
      total: countRow.total,
      page: Number(page),
      limit: limitNum,
    },
  });
}

// ============================================================
// 路由注册
// ============================================================

const router = express.Router();

// 所有路由需要登录
router.use(authRequired);

// ---- 分类 ----
// 分类的写操作需要 admin 权限，读操作所有人可用
router.get('/categories', listCategories);
router.post('/categories', adminRequired, createCategory);
router.put('/categories/:id', adminRequired, updateCategory);
router.delete('/categories/:id', adminRequired, deleteCategory);

// ---- 搜索 ----
// 搜索需要放在 /documents/:id 路由之前，否则会被 :id 匹配
router.post('/search', searchDocuments);

// ---- 推荐问题（从知识库随机获取） ----
router.get('/suggestions', (req, res) => {
  try {
    const db = req.db;
    const docs = db.prepare(
      `SELECT title FROM kb_documents WHERE status = 'published' AND is_current = 1 ORDER BY RANDOM() LIMIT 4`
    ).all();
    const suggestions = (docs || []).map(d => ({ text: d.title }));
    // 如果知识库为空，返回默认问题兜底
    if (suggestions.length === 0) {
      return res.json({
        code: 0,
        data: [
          { text: '如何向门店推荐南孚电池？' },
          { text: '南孚和竞品相比有什么优势？' },
        ],
      });
    }
    res.json({ code: 0, data: suggestions });
  } catch (err) {
    console.error('[knowledge/suggestions] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ---- 文档 ----
// 文档的写操作需要 admin 权限，读操作所有人可用
router.get('/documents', listDocuments);
router.post('/documents', adminRequired, createDocument);
router.get('/documents/:id', getDocument);
router.put('/documents/:id', adminRequired, updateDocument);
router.delete('/documents/:id', adminRequired, deleteDocument);

// ---- 版本管理 ----
router.get('/documents/:id/versions', getDocumentVersions);
router.post('/documents/:id/rollback/:versionId', adminRequired, rollbackDocument);

// ---- 反馈工单 ----
router.get('/feedbacks', listFeedbacks);

// 导出反馈评分（仅管理员）
router.get('/feedbacks/export', adminRequired, (req, res) => {
  try {
    const db = req.db;
    const rows = db.prepare(
      `SELECT f.*, u.username, u.real_name as user_name
       FROM ai_feedbacks f
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC`
    ).all();

    const header = ['用户', '关联文档', '评分', '反馈内容', '问题', '时间'];
    const csvRows = [header.join(',')];
    for (const r of rows) {
      const ratingLabel = r.rating === 'like' ? '满意' : r.rating === 'dislike' ? '不满意' : '无评分';
      const time = formatShanghai(r.created_at);
      csvRows.push([
        csvEscape(r.user_name || r.username || '-'),
        csvEscape(r.doc_title || '-'),
        csvEscape(ratingLabel),
        csvEscape(r.content || r.comment || '-'),
        csvEscape(r.question || '-'),
        csvEscape(time),
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=feedbacks_${dateFilename()}.csv`);
    res.send('\uFEFF' + csvRows.join('\n'));
  } catch (err) {
    console.error('[feedbacks/export] Error:', err);
    res.status(500).json({ code: 500, message: '导出失败' });
  }
});

// ---- Excel批量导入 ----
const multer = require('multer');
const XLSX = require('xlsx');
const uploadExcel = multer({ dest: 'uploads/kb/' });

/**
 * POST /knowledge/import-excel
 * 批量导入Excel知识库文件
 */
router.post('/import-excel', authRequired, adminRequired, uploadExcel.single('file'), async (req, res) => {
  try {
    const db = req.db;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ code: 400, message: '请上传Excel文件' });
    }

    // 解析Excel
    const workbook = XLSX.readFile(file.path);
    const allRecords = [];
    let categoryName = '';
    
    // 从文件名提取分类名
    const originalName = req.file.originalname || '';
    const fileNameMatch = originalName.match(/^(.+?)\.xlsx?$/i);
    if (fileNameMatch) {
      categoryName = fileNameMatch[1].replace(/[\/\\?*:|"<>]/g, '_');
    } else {
      categoryName = '导入知识库';
    }

    // 遍历所有Sheet
    workbook.SheetNames.forEach(sheetName => {
      const ws = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (data.length < 2) return; // 跳过空表
      
      const headers = data[0];
      
      // 解析每一行数据
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        
        // 构建文档对象
        const record = {
          sheet: sheetName,
          headers: headers,
          data: row,
          title: '',
          content: '',
          keywords: ''
        };
        
        // 根据表头智能提取内容
        headers.forEach((h, idx) => {
          const val = row[idx];
          if (val === undefined || val === null) return;
          
          const headerLower = String(h).toLowerCase();
          
          // 提取标题
          if (['标题', '主题', '问题', '具体难题', '知识点'].includes(h)) {
            record.title = String(val);
          }
          // 提取内容
          else if (['内容', '详细内容', '答案', '答案（思路+关键点）', '话术（白话）', '核心定义/要点'].includes(h)) {
            record.content = (record.content ? record.content + '\n' : '') + String(val);
          }
          // 提取关键词
          else if (['关键词', '标签'].includes(h)) {
            record.keywords = String(val);
          }
        });
        
        // 如果没有提取到标题，用第一个非空字段
        if (!record.title) {
          record.title = row.find(v => v !== undefined && v !== null && String(v).trim()) 
            ? String(row.find(v => v !== undefined && v !== null && String(v).trim())).substring(0, 50)
            : `记录 ${i}`;
        }
        
        // 如果没有提取到内容，把整行数据格式化
        if (!record.content) {
          record.content = headers.map((h, idx) => `${h}: ${row[idx] || ''}`).join('\n');
        }
        
        allRecords.push(record);
      }
    });

    // 创建或获取分类
    let category = db.prepare('SELECT * FROM kb_categories WHERE name = ?').get(categoryName);
    if (!category) {
      const catId = uuidv4();
      db.prepare('INSERT INTO kb_categories (id, name, sort_order) VALUES (?, ?, ?)').run(catId, categoryName, 0);
      category = { id: catId, name: categoryName };
    }

    // 批量插入文档
    let inserted = 0;
    const now = nowShanghaiString();
    
    for (const record of allRecords) {
      const docId = uuidv4();
      const content = `【${record.title}】\n\n${record.content}`;
      
      db.prepare(`
        INSERT INTO kb_documents (id, category_id, title, content, version, is_current, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, 'published', ?, ?, ?)
      `).run(docId, category.id, record.title, content, req.user.id, now, now);
      
      inserted++;
    }

    // 清理临时文件
    const fs = require('fs');
    try { fs.unlinkSync(file.path); } catch (e) {}

    logActivity(db, req.user.id, 'import_excel', 'category', category.id, 
      JSON.stringify({ file: originalName, records: inserted }), req.ip);

    res.json({ 
      code: 0, 
      message: '导入成功', 
      data: { 
        category: category.name, 
        total: allRecords.length, 
        inserted 
      } 
    });
  } catch (err) {
    console.error('[knowledge/import-excel] Error:', err);
    res.status(500).json({ code: 500, message: '导入失败: ' + err.message });
  }
});

module.exports = router;
