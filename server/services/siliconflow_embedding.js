/**
 * 知识库 Embedding 向量化服务（用于语义检索）
 * 走硅基流动（SiliconFlow）的 BAAI/bge-m3 模型（与库中已存向量维度 1024 一致，不随后台 AI 配置变动）。
 * 其他模型调用（跑店问问对话、FU利陪陪）走后台「AI 配置」；唯独向量化保留独立硅基流动通道。
 */
const https = require('https');
const http = require('http');
const url = require('url');
const { markDbDirty } = require('../database');

const API_BASE = (process.env.EMBEDDING_API_BASE || 'https://api.siliconflow.cn/v1/embeddings').replace(/\/+$/, '');
const API_KEY = process.env.SILICONFLOW_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3';
// 单个文档用于向量化的文本最大长度（bge-m3 支持 8192 token，中文约 1 字/1 token）
const DOC_TEXT_MAX_LEN = 2000;

// 内存缓存：文档向量（Map<docId, number[]>）
let docVectorCache = null;

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 调用硅基流动 embedding API（批量）
 * @param {string[]} texts 待向量化的文本数组
 * @returns {Promise<number[][]>} 与 texts 对应的向量数组
 */
function callEmbeddingApi(texts) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(API_BASE);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const postData = JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      encoding_format: 'float',
    });

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 30000,
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString('utf-8'); });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300 && Array.isArray(json.data)) {
            resolve(json.data.map(d => d.embedding));
          } else {
            reject(new Error(`Embedding API HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Embedding 请求超时')); });
    req.write(postData);
    req.end();
  });
}

/**
 * 批量向量化（自动分批，每批最多 16 条）
 */
async function embedTexts(texts) {
  if (!API_KEY) throw new Error('未配置 SILICONFLOW_API_KEY');
  const batchSize = 16;
  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await callEmbeddingApi(batch);
    results.push(...vectors);
  }
  return results;
}

/**
 * 构建文档向量缓存（全量预计算，懒加载）
 */
async function buildDocVectorCache(db) {
  const docs = db.prepare(`
    SELECT id, title, content FROM kb_documents
    WHERE status = 'published' AND is_current = 1
  `).all();

  if (docs.length === 0) {
    docVectorCache = new Map();
    return docVectorCache;
  }

  // 从数据库加载已有向量（持久化，避免重启后重复 embedding）
  const cache = new Map();
  const existingRows = db.prepare(`SELECT doc_id, vector FROM kb_document_vectors`).all();
  const existingMap = new Map();
  for (const row of existingRows) {
    try {
      existingMap.set(row.doc_id, JSON.parse(row.vector));
    } catch (_) { /* 忽略损坏的向量 */ }
  }

  const missingDocs = [];
  for (const doc of docs) {
    if (existingMap.has(doc.id)) {
      cache.set(doc.id, existingMap.get(doc.id));
    } else {
      missingDocs.push(doc);
    }
  }

  // 只对缺失向量的文档做 embedding（增量）
  if (missingDocs.length > 0) {
    console.log(`[embedding] 发现 ${missingDocs.length} 篇文档缺失向量，开始增量向量化...`);
    const texts = missingDocs.map(d => ((d.title || '') + '\n' + (d.content || '')).substring(0, DOC_TEXT_MAX_LEN));
    const vectors = await embedTexts(texts);

    let dirty = false;
    for (let i = 0; i < missingDocs.length; i++) {
      const doc = missingDocs[i];
      const vec = vectors[i];
      if (vec) {
        cache.set(doc.id, vec);
        try {
          db.prepare(
            `INSERT OR REPLACE INTO kb_document_vectors (doc_id, vector, updated_at) VALUES (?, ?, datetime('now','localtime'))`
          ).run(doc.id, JSON.stringify(vec));
          dirty = true;
        } catch (e) {
          console.error('[embedding] 向量写入数据库失败:', e.message);
        }
      }
    }
    if (dirty) markDbDirty();
  }

  docVectorCache = cache;
  return cache;
}

/**
 * 清空缓存（文档更新后调用）
 */
function clearDocVectorCache() {
  docVectorCache = null;
}

/**
 * 向量化单个查询文本（只调一次 embedding API）
 */
async function embedQuery(question) {
  if (!API_KEY) return null;
  try {
    const [qVec] = await embedTexts([question]);
    return qVec || null;
  } catch (e) {
    console.error('[embedding] 查询向量化失败:', e.message);
    return null;
  }
}

/**
 * 用已计算好的查询向量在本地做语义检索（纯内存计算，不调 API）
 * @param {object} db
 * @param {number[]} qVec 查询向量
 * @param {number} topK 返回数量
 * @param {string[]|null} categoryNames 限定分类名（可选）
 */
function searchByVector(db, qVec, topK = 10, categoryNames = null) {
  const cache = docVectorCache;
  if (!cache || cache.size === 0 || !qVec) return [];

  // 分类过滤（可选）
  let allowedIds = null;
  if (categoryNames && categoryNames.length > 0) {
    const placeholders = categoryNames.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT d.id FROM kb_documents d
      JOIN kb_categories c ON d.category_id = c.id
      WHERE c.name IN (${placeholders}) AND d.status = 'published' AND d.is_current = 1
    `).all(...categoryNames);
    allowedIds = new Set(rows.map(r => r.id));
  }

  const scored = [];
  for (const [docId, docVec] of cache.entries()) {
    if (allowedIds && !allowedIds.has(docId)) continue;
    scored.push({ id: docId, score: cosineSimilarity(qVec, docVec) });
  }
  scored.sort((a, b) => b.score - a.score);

  const topIds = scored.slice(0, topK).map(s => s.id);
  if (topIds.length === 0) return [];

  const placeholders = topIds.map(() => '?').join(',');
  const docs = db.prepare(`
    SELECT id, title, content
    FROM kb_documents
    WHERE id IN (${placeholders}) AND status = 'published' AND is_current = 1
  `).all(...topIds);

  const scoreMap = {};
  scored.forEach(s => { scoreMap[s.id] = s.score; });
  docs.forEach(d => { d._score = scoreMap[d.id] || 0; });
  docs.sort((a, b) => (b._score || 0) - (a._score || 0));

  return docs;
}

/**
 * 语义检索：返回与 question 语义最相似的文档（兼容接口 = embedQuery + searchByVector）
 */
async function searchByEmbedding(db, question, topK = 10, categoryNames = null) {
  if (!API_KEY) return [];

  let cache = docVectorCache;
  if (!cache) {
    cache = await buildDocVectorCache(db);
  }

  const qVec = await embedQuery(question);
  if (!qVec) return [];

  return searchByVector(db, qVec, topK, categoryNames);
}

module.exports = {
  embedTexts,
  embedQuery,
  searchByVector,
  searchByEmbedding,
  buildDocVectorCache,
  clearDocVectorCache,
  cosineSimilarity,
};
