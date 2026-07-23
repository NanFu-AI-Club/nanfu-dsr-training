/**
 * AI智能问答路由
 * 表: ai_configs, ai_feedbacks, ai_favorites, kb_documents
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { authRequired, adminRequired } = require('../middleware/auth');

// ==================== 辅助函数 ====================

function logActivity(db, userId, action, targetType, targetId, detail, ip) {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, action, 'ai', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
}

/**
 * 从知识库搜索相关上下文
 * 对 question 进行分词，匹配 kb_documents 的 title 和 content
 */
function searchKnowledgeBase(db, question) {
  // 提取中文关键词（简单分词：按常见分隔符切分，过滤短词）
  const keywords = question
    .split(/[，。！？；：、\s,\.!\?;:]+/)
    .filter(w => w.length >= 2)
    .slice(0, 5);

  if (keywords.length === 0) return [];

  const conditions = keywords.map(() => '(d.title LIKE ? OR d.content LIKE ?)').join(' OR ');
  const params = [];
  for (const kw of keywords) {
    params.push(`%${kw}%`, `%${kw}%`);
  }

  const docs = db.prepare(`
    SELECT d.id, d.title, d.content
    FROM kb_documents d
    WHERE d.status = 'published' AND d.is_current = 1 AND (${conditions})
    LIMIT 5
  `).all(...params);

  return docs;
}

/**
 * 从题库搜索相关题目（作为参考资料）
 */
function searchQuestionBank(db, question) {
  const keywords = question
    .split(/[，。！？；：、\s,\.!\?;:]+/)
    .filter(w => w.length >= 2)
    .slice(0, 5);

  if (keywords.length === 0) return [];

  const conditions = keywords.map(() => 'content LIKE ?').join(' OR ');
  const params = [];
  for (const kw of keywords) {
    params.push(`%${kw}%`);
  }

  const questions = db.prepare(`
    SELECT id, type, content, options, answer, analysis, category
    FROM questions
    WHERE status = 'active' AND (${conditions})
    LIMIT 5
  `).all(...params);

  return questions.map(q => ({
    ...q,
    options: q.options ? (() => { try { return JSON.parse(q.options); } catch (_) { return null; } })() : null,
    answer: (() => { try { return JSON.parse(q.answer); } catch (_) { return q.answer; } })(),
  }));
}

/**
 * 构建知识库上下文文本
 */
function buildContext(docs, maxLength = 2000) {
  if (docs.length === 0) return '';
  let context = '以下是与问题相关的知识库内容：\n\n';
  for (const doc of docs) {
    context += `【${doc.title}】\n${doc.content.substring(0, 600)}\n\n`;
  }
  return context.substring(0, maxLength);
}

/**
 * 构建题库上下文文本
 */
function buildQuestionContext(questions, maxLength = 1500) {
  if (!questions || questions.length === 0) return '';
  let context = '以下是相关的题库参考内容：\n\n';
  for (const q of questions) {
    const typeLabel = q.type === 'single' ? '单选题' : q.type === 'multiple' ? '多选题' : '判断题';
    context += `【${typeLabel}】${q.content}\n`;
    if (q.options && Array.isArray(q.options)) {
      q.options.forEach((opt, i) => {
        context += `${opt}\n`;
      });
    }
    context += `正确答案：${Array.isArray(q.answer) ? q.answer.join('、') : q.answer}\n`;
    if (q.analysis) context += `解析：${q.analysis}\n`;
    context += '\n';
  }
  return context.substring(0, maxLength);
}

/**
 * 基于知识库和题库生成智能兜底回复（AI不可用时的降级方案）
 */
function generateMockResponse(question, docs, relatedQuestions, systemPrompt, errorReason) {
  const knowledgeContext = buildContext(docs);
  const questionContext = buildQuestionContext(relatedQuestions);
  const hasContent = docs.length > 0 || (relatedQuestions && relatedQuestions.length > 0);

  let answer = '';

  // 头部说明
  answer += `您好！关于您的问题「**${question}**」，以下是系统为您检索到的相关信息：\n\n`;

  // AI 状态提示
  if (errorReason) {
    answer += `> :warning: **AI 模型暂不可用**：${errorReason}\n`;
    answer += `> 当前展示的是基于知识库和题库的检索结果，管理员可在「AI配置」中修正模型名称后激活。\n\n`;
  }

  if (hasContent) {
    // 知识库内容
    if (docs.length > 0) {
      answer += `## 知识库资料 (${docs.length} 篇相关)\n\n`;
      for (const doc of docs) {
        answer += `### ${doc.title}\n`;
        // 对内容做智能截断：优先展示含关键词的段落
        const keywords = question.split(/[，。！？；：、\s]+/).filter(w => w.length >= 2);
        const paragraphs = doc.content.split(/\n+/);
        let bestPara = paragraphs[0] || '';
        for (const p of paragraphs) {
          if (keywords.some(kw => p.includes(kw)) && p.length > bestPara.length) {
            bestPara = p;
          }
        }
        answer += `${bestPara.substring(0, 800)}\n\n`;
      }
    }

    // 题库内容
    if (relatedQuestions && relatedQuestions.length > 0) {
      answer += `## 相关题目 (${relatedQuestions.length} 道)\n\n`;
      for (const q of relatedQuestions) {
        const typeLabel = q.type === 'single' ? '单选题' : q.type === 'multiple' ? '多选题' : '判断题';
        answer += `**${typeLabel}**：${q.content.substring(0, 300)}\n`;
        if (q.options && Array.isArray(q.options)) {
          q.options.forEach(opt => { answer += `- ${opt}\n`; });
        }
        answer += `正确答案：${Array.isArray(q.answer) ? q.answer.join('、') : q.answer}\n`;
        if (q.analysis) answer += `解析：${q.analysis.substring(0, 200)}\n`;
        answer += '\n';
      }
    }
  } else {
    // 无匹配内容时的通用回复
    const lowerQ = question.toLowerCase();
    if (lowerQ.includes('电池') || lowerQ.includes('南孚') || lowerQ.includes('销售') || lowerQ.includes('产品')) {
      answer += `## 相关信息\n\n`;
      answer += `南孚电池作为中国碱性电池领导品牌，核心优势包括：\n\n`;
      answer += `- **聚能环技术**：防止自放电，保质期长达10年\n`;
      answer += `- **持久耐用**：电量比普通碳性电池高7倍\n`;
      answer += `- **环保安全**：无汞无镉，通过国家环保认证\n\n`;
      answer += `建议在知识库中补充更详细的产品资料以获得更精准的回答。\n`;
    } else {
      answer += `当前知识库和题库中暂无与您问题直接相关的内容。\n\n`;
      answer += `建议：\n`;
      answer += `1. 尝试用更具体的关键词提问\n`;
      answer += `2. 联系管理员在知识库中补充相关资料\n`;
      answer += `3. 在题库中添加相关题目\n`;
    }
  }

  answer += `\n---\n> 本回复由知识库检索自动生成。`;
  if (errorReason) {
    answer += `AI 模型未生效（${errorReason}），请在管理后台「AI配置」中检查模型名称和 API Key。`;
  }

  return answer;
}

/**
 * 调用外部 AI API（使用 http/https 模块，兼容所有 Node 版本）
 */
async function callAIProvider(config, messages) {
  const https = require('https');
  const http = require('http');
  const url = require('url');

  const apiBase = (config.api_base || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiUrl = apiBase + '/chat/completions';
  const parsedUrl = url.parse(apiUrl);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const postData = JSON.stringify({
    model: config.model || 'gpt-4o-mini',
    messages: messages,
    temperature: config.temperature !== undefined ? config.temperature : 0.7,
    max_tokens: config.max_tokens || 2048,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 60000,
    };

    const aiReq = transport.request(options, (aiRes) => {
      let body = '';
      aiRes.on('data', (chunk) => { body += chunk; });
      aiRes.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.choices && result.choices[0] && result.choices[0].message) {
            resolve(result.choices[0].message.content);
          } else if (result.error) {
            reject(new Error(result.error.message || 'AI API error'));
          } else {
            reject(new Error('AI API 返回格式异常'));
          }
        } catch (e) {
          reject(new Error(`AI API 响应解析失败: ${body.substring(0, 200)}`));
        }
      });
    });

    aiReq.on('error', (e) => reject(e));
    aiReq.on('timeout', () => { aiReq.destroy(); reject(new Error('AI 请求超时')); });
    aiReq.write(postData);
    aiReq.end();
  });
}

// ==================== AI 配置管理 (admin) ====================

// GET /ai/configs - AI配置列表（admin）
router.get('/configs', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const configs = db.prepare(`
      SELECT * FROM ai_configs ORDER BY created_at DESC
    `).all();

    // Mask API key
    const list = configs.map(c => ({
      ...c,
      api_key: c.api_key ? c.api_key.substring(0, 8) + '****' + c.api_key.substring(c.api_key.length - 4) : null,
      is_active: c.is_active === 1
    }));

    res.json({ code: 0, data: list });
  } catch (err) {
    console.error('[ai/configs] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /ai/configs - 新增配置（admin）
router.post('/configs', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { provider, api_key, api_base, model, system_prompt, temperature, max_tokens, is_active } = req.body;

    if (!provider) {
      return res.status(400).json({ code: 400, message: 'AI提供商不能为空' });
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO ai_configs (id, provider, api_key, api_base, model, system_prompt, temperature, max_tokens, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      provider,
      api_key || null,
      api_base || null,
      model || 'gpt-4o-mini',
      system_prompt || null,
      temperature !== undefined ? temperature : 0.7,
      max_tokens || 2048,
      is_active !== undefined ? (is_active ? 1 : 0) : 0
    );

    // 如果新配置激活，停用其他配置
    if (is_active) {
      db.prepare('UPDATE ai_configs SET is_active = 0 WHERE id != ?').run(id);
    }

    logActivity(db, req.user.id, 'create', 'ai_config', id, { provider }, req.ip);

    res.json({ code: 0, message: 'AI配置创建成功', data: { id } });
  } catch (err) {
    console.error('[ai/configs/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /ai/configs/:id - 更新配置（admin）
router.put('/configs/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { provider, api_key, api_base, model, system_prompt, temperature, max_tokens, is_active } = req.body;

    const config = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(id);
    if (!config) {
      return res.status(404).json({ code: 404, message: 'AI配置不存在' });
    }

    const updates = [];
    const params = [];
    if (provider !== undefined) { updates.push('provider = ?'); params.push(provider); }
    if (api_key !== undefined && !api_key.includes('****')) {
      updates.push('api_key = ?');
      params.push(api_key);
    }
    if (api_base !== undefined) { updates.push('api_base = ?'); params.push(api_base); }
    if (model !== undefined) { updates.push('model = ?'); params.push(model); }
    if (system_prompt !== undefined) { updates.push('system_prompt = ?'); params.push(system_prompt); }
    if (temperature !== undefined) { updates.push('temperature = ?'); params.push(temperature); }
    if (max_tokens !== undefined) { updates.push('max_tokens = ?'); params.push(max_tokens); }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
      // 如果设置为激活，停用其他配置
      if (is_active) {
        db.prepare('UPDATE ai_configs SET is_active = 0 WHERE id != ?').run(id);
      }
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now','localtime')");
      params.push(id);
      db.prepare(`UPDATE ai_configs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    logActivity(db, req.user.id, 'update', 'ai_config', id,
      { provider: provider || config.provider }, req.ip);

    res.json({ code: 0, message: 'AI配置更新成功' });
  } catch (err) {
    console.error('[ai/configs/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /ai/configs/:id - 删除配置（admin）
router.delete('/configs/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const config = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(id);
    if (!config) {
      return res.status(404).json({ code: 404, message: 'AI配置不存在' });
    }

    db.prepare('DELETE FROM ai_configs WHERE id = ?').run(id);

    logActivity(db, req.user.id, 'delete', 'ai_config', id,
      { provider: config.provider }, req.ip);

    res.json({ code: 0, message: 'AI配置已删除' });
  } catch (err) {
    console.error('[ai/configs/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== AI 对话 ====================

// POST /ai/chat - 发送对话消息
router.post('/chat', authRequired, async (req, res) => {
  try {
    const db = req.db;
    const { question, conversation_id } = req.body;
    const userId = req.user.id;

    if (!question || !question.trim()) {
      return res.status(400).json({ code: 400, message: '问题不能为空' });
    }

    const trimmedQuestion = question.trim();

    // 获取激活的AI配置
    const config = db.prepare(`
      SELECT * FROM ai_configs WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1
    `).get();

    // 从知识库搜索相关上下文
    const docs = searchKnowledgeBase(db, trimmedQuestion);
    // 从题库搜索相关题目
    const relatedQuestions = searchQuestionBank(db, trimmedQuestion);

    // 生成或沿用 conversation_id
    const convId = conversation_id || uuidv4();

    let answer;
    let useMock = true;

    if (config && config.api_key) {
      try {
        // 构建消息列表
        const messages = [];

        // 系统提示词 + 知识库 + 题库上下文
        const systemPrompt = config.system_prompt || '你是南孚电池的智能销售助手，请基于知识库内容回答销售代表的问题。回答要专业、简洁、有针对性。';
        let systemMsg = systemPrompt;
        if (docs.length > 0) {
          systemMsg += '\n\n' + buildContext(docs);
        }
        if (relatedQuestions.length > 0) {
          systemMsg += '\n\n' + buildQuestionContext(relatedQuestions);
        }
        messages.push({ role: 'system', content: systemMsg });

        // 获取历史对话（当前 conversation）
        const history = db.prepare(`
          SELECT question, answer FROM ai_feedbacks
          WHERE conversation_id = ?
          ORDER BY created_at ASC
          LIMIT 10
        `).all(convId);

        for (const h of history) {
          messages.push({ role: 'user', content: h.question });
          messages.push({ role: 'assistant', content: h.answer });
        }

        messages.push({ role: 'user', content: trimmedQuestion });

        // 调用 AI API
        answer = await callAIProvider(config, messages);
        useMock = false;
      } catch (apiErr) {
        console.error('[ai/chat] API call failed, falling back to mock:', apiErr.message);
        // 用知识库+题库内容构建智能兜底回复，并提示错误原因
        answer = generateMockResponse(trimmedQuestion, docs, relatedQuestions, config.system_prompt, apiErr.message);
      }
    } else {
      // 无配置或没有 API key，使用模拟回复
      answer = generateMockResponse(trimmedQuestion, docs, relatedQuestions, config ? config.system_prompt : null, '未配置AI模型或API Key');
    }

    // 保存到 ai_feedbacks
    const feedbackId = uuidv4();
    db.prepare(`
      INSERT INTO ai_feedbacks (id, conversation_id, question, answer, user_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(feedbackId, convId, trimmedQuestion, answer, userId);

    // 构建 sources（知识库 + 题库）
    const sources = [
      ...docs.map(d => ({ id: d.id, title: d.title, type: 'knowledge' })),
      ...relatedQuestions.map(q => ({ id: q.id, title: q.content.substring(0, 40), type: 'question' })),
    ];

    logActivity(db, userId, 'chat', 'ai_chat', feedbackId,
      { conversation_id: convId, question_length: trimmedQuestion.length, has_sources: sources.length > 0, use_mock: useMock }, req.ip);

    res.json({
      code: 0,
      data: {
        id: feedbackId,
        answer,
        conversation_id: convId,
        sources
      }
    });
  } catch (err) {
    console.error('[ai/chat] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /ai/history - 对话历史（当前用户，支持分页）
router.get('/history', authRequired, (req, res) => {
  try {
    const db = req.db;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const userId = req.user.id;

    const total = db.prepare(
      'SELECT COUNT(*) as count FROM ai_feedbacks WHERE user_id = ?'
    ).get(userId).count;

    const history = db.prepare(`
      SELECT id, conversation_id, question, answer, rating, created_at
      FROM ai_feedbacks
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, pageSize, offset);

    // 批量查询收藏状态（避免 N+1）
    const feedbackIds = history.map(h => h.id);
    const favMap = {};
    if (feedbackIds.length > 0) {
      const placeholders = feedbackIds.map(() => '?').join(',');
      const favs = db.prepare(
        `SELECT id, feedback_id FROM ai_favorites WHERE user_id = ? AND feedback_id IN (${placeholders})`
      ).all(userId, ...feedbackIds);
      for (const f of favs) {
        favMap[f.feedback_id] = f;
      }
    }

    const list = history.map(h => {
      const fav = favMap[h.id];
      return {
        ...h,
        is_favorite: !!fav,
        favorite_id: fav ? fav.id : null
      };
    });

    // 按 conversation_id 分组
    const conversations = {};
    for (const item of list) {
      if (!conversations[item.conversation_id]) {
        conversations[item.conversation_id] = {
          conversation_id: item.conversation_id,
          title: item.question.substring(0, 30) + (item.question.length > 30 ? '...' : ''),
          items: [],
          created_at: item.created_at
        };
      }
      conversations[item.conversation_id].items.push(item);
    }

    res.json({
      code: 0,
      data: {
        list: Object.values(conversations),
        total,
        page,
        pageSize
      }
    });
  } catch (err) {
    console.error('[ai/history] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /ai/feedback/:id - 对某条对话点赞/踩 {rating: 'like'|'dislike'}
router.post('/feedback/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { rating } = req.body;
    const userId = req.user.id;

    if (!['like', 'dislike'].includes(rating)) {
      return res.status(400).json({ code: 400, message: '评价类型无效，必须是 like 或 dislike' });
    }

    const feedback = db.prepare('SELECT * FROM ai_feedbacks WHERE id = ?').get(id);
    if (!feedback) {
      return res.status(404).json({ code: 404, message: '对话记录不存在' });
    }

    // 验证属于当前用户
    if (feedback.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无权操作此记录' });
    }

    db.prepare('UPDATE ai_feedbacks SET rating = ? WHERE id = ?').run(rating, id);

    res.json({ code: 0, message: '评价已提交', data: { id, rating } });
  } catch (err) {
    console.error('[ai/feedback] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /ai/favorites - 收藏列表
router.get('/favorites', authRequired, (req, res) => {
  try {
    const db = req.db;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const userId = req.user.id;

    const total = db.prepare(
      'SELECT COUNT(*) as count FROM ai_favorites WHERE user_id = ?'
    ).get(userId).count;

    const favorites = db.prepare(`
      SELECT f.id as favorite_id, f.created_at as favorited_at,
             fb.id, fb.conversation_id, fb.question, fb.answer, fb.rating, fb.created_at
      FROM ai_favorites f
      JOIN ai_feedbacks fb ON f.feedback_id = fb.id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, pageSize, offset);

    const list = favorites.map(f => ({
      favorite_id: f.favorite_id,
      favorited_at: f.favorited_at,
      id: f.id,
      conversation_id: f.conversation_id,
      question: f.question,
      answer: f.answer,
      rating: f.rating,
      created_at: f.created_at
    }));

    res.json({
      code: 0,
      data: { list, total, page, pageSize }
    });
  } catch (err) {
    console.error('[ai/favorites] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /ai/favorites/:id - 收藏某条对话
// :id 为 ai_feedbacks 记录的 id
router.post('/favorites/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const userId = req.user.id;

    const feedback = db.prepare('SELECT * FROM ai_feedbacks WHERE id = ?').get(id);
    if (!feedback) {
      return res.status(404).json({ code: 404, message: '对话记录不存在' });
    }

    // 验证属于当前用户
    if (feedback.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无权操作此记录' });
    }

    // 检查是否已收藏
    const existing = db.prepare(
      'SELECT id FROM ai_favorites WHERE user_id = ? AND feedback_id = ?'
    ).get(userId, id);

    if (existing) {
      return res.json({ code: 0, message: '已收藏', data: { favorite_id: existing.id } });
    }

    const favoriteId = uuidv4();
    db.prepare(`
      INSERT INTO ai_favorites (id, user_id, feedback_id)
      VALUES (?, ?, ?)
    `).run(favoriteId, userId, id);

    res.json({ code: 0, message: '收藏成功', data: { favorite_id: favoriteId } });
  } catch (err) {
    console.error('[ai/favorites/add] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /ai/favorites/:id - 取消收藏
// :id 为 ai_favorites 记录的 id
router.delete('/favorites/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const userId = req.user.id;

    const fav = db.prepare('SELECT * FROM ai_favorites WHERE id = ? AND user_id = ?').get(id, userId);
    if (!fav) {
      return res.status(404).json({ code: 404, message: '收藏记录不存在' });
    }

    db.prepare('DELETE FROM ai_favorites WHERE id = ?').run(id);

    res.json({ code: 0, message: '已取消收藏' });
  } catch (err) {
    console.error('[ai/favorites/remove] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /ai/conversations/:conversationId - 删除整个对话
router.delete('/conversations/:conversationId', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { conversationId } = req.params;
    const userId = req.user.id;

    // 删除该对话下所有收藏
    db.prepare(`
      DELETE FROM ai_favorites WHERE feedback_id IN (
        SELECT id FROM ai_feedbacks WHERE conversation_id = ? AND user_id = ?
      )
    `).run(conversationId, userId);

    // 删除该对话下所有反馈
    const result = db.prepare(
      'DELETE FROM ai_feedbacks WHERE conversation_id = ? AND user_id = ?'
    ).run(conversationId, userId);

    logActivity(db, userId, 'delete', 'ai_conversation', conversationId,
      { deleted_rows: result.changes }, req.ip);

    res.json({ code: 0, message: '对话已删除', data: { deleted: result.changes } });
  } catch (err) {
    console.error('[ai/conversations/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 管理员：查看所有对话记录 ====================

// GET /ai/admin/conversations - 管理员查看所有业务员的对话记录
router.get('/admin/conversations', authRequired, (req, res) => {
  try {
    const admin = req.user;
    if (admin.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '只有管理员可以查看' });
    }

    const { search, userId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    let whereClause = '';
    const params = [];

    if (userId) {
      whereClause += 'WHERE af.user_id = ?';
      params.push(userId);
    }

    if (search) {
      whereClause += whereClause ? ' AND (af.question LIKE ? OR u.real_name LIKE ? OR u.username LIKE ?)' : 'WHERE (af.question LIKE ? OR u.real_name LIKE ? OR u.username LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // 总数
    const countSql = `SELECT COUNT(*) as total FROM ai_feedbacks af JOIN users u ON af.user_id = u.id ${whereClause}`;
    const countResult = req.db.prepare(countSql).get(...params);
    const total = countResult?.total || 0;

    // 分页查询
    const dataSql = `
      SELECT
        af.id, af.conversation_id, af.question, af.answer, af.rating, af.created_at,
        u.id as user_id, u.username, u.real_name
      FROM ai_feedbacks af
      JOIN users u ON af.user_id = u.id
      ${whereClause}
      ORDER BY af.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = req.db.prepare(dataSql).all(...params, pageSize, offset);

    res.json({
      code: 0,
      data: {
        list: rows,
        total,
        page,
        pageSize,
      },
    });
  } catch (err) {
    console.error('[ai/admin/conversations] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /ai/admin/conversations/:conversationId - 查看某个对话的完整记录
router.get('/admin/conversations/:conversationId', authRequired, (req, res) => {
  try {
    const admin = req.user;
    if (admin.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '只有管理员可以查看' });
    }

    const rows = req.db.prepare(`
      SELECT
        af.id, af.conversation_id, af.question, af.answer, af.rating, af.created_at,
        u.id as user_id, u.username, u.real_name
      FROM ai_feedbacks af
      JOIN users u ON af.user_id = u.id
      WHERE af.conversation_id = ?
      ORDER BY af.created_at ASC
    `).all(req.params.conversationId);

    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('[ai/admin/conversations/detail] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 语音服务（ASR + TTS） ====================
const { speechToText } = require('../services/voice');
const { textToSpeech } = require('../services/voice_edge');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /ai/speech-to-text — 语音转文字（自动转换格式兼容 iPhone/Android） 
router.post('/speech-to-text', authRequired, upload.single('audio'), async (req, res) => {
  const tmpIn = path.join(os.tmpdir(), `asr-in-${uuidv4()}`);
  const tmpOut = path.join(os.tmpdir(), `asr-out-${uuidv4()}.wav`);
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ code: 400, message: '请上传音频文件' });
    }

    // 写入临时文件
    fs.writeFileSync(tmpIn, req.file.buffer);

    // 用 ffmpeg 统一转成 16kHz/16bit/mono WAV（异步，不阻塞事件循环）
    const convertAudio = () => new Promise((resolve, reject) => {
      exec(
        `ffmpeg -y -i "${tmpIn}" -acodec pcm_s16le -ac 1 -ar 16000 -f wav "${tmpOut}" 2>/dev/null`,
        { timeout: 15000 },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    try {
      await convertAudio();
    } catch (ffErr) {
      console.error('[ai/speech-to-text] ffmpeg convert failed:', ffErr.message);
      // 转换失败则用原始数据尝试（可能是已经正确的 WAV）
      const text = await speechToText(req.file.buffer);
      return res.json({ code: 0, data: { text } });
    }

    // 检查转换结果
    if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size < 100) {
      console.error('[ai/speech-to-text] ffmpeg output empty, using raw');
      const text = await speechToText(req.file.buffer);
      return res.json({ code: 0, data: { text } });
    }

    const wavBuffer = fs.readFileSync(tmpOut);
    console.log(`[ai/speech-to-text] Converted ${(req.file.size / 1024).toFixed(1)}KB → ${(wavBuffer.length / 1024).toFixed(1)}KB WAV`);
    const text = await speechToText(wavBuffer);
    res.json({ code: 0, data: { text } });
  } catch (err) {
    console.error('[ai/speech-to-text] Error:', err.message);
    res.status(500).json({ code: 500, message: '语音识别失败，请重试' });
  } finally {
    // 清理临时文件
    try { fs.unlinkSync(tmpIn); } catch (_) {}
    try { fs.unlinkSync(tmpOut); } catch (_) {}
  }
});

// POST /ai/text-to-speech — 文字转语音
router.post('/text-to-speech', authRequired, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ code: 400, message: '请提供要转换的文字' });
    }
    // 限制长度避免超时（火山 TTS 有最长文本限制）
    const trimmed = text.trim().substring(0, 300);
    const audioBuffer = await textToSpeech(trimmed);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.send(audioBuffer);
  } catch (err) {
    console.error('[ai/text-to-speech] Error:', err.message);
    res.status(500).json({ code: 500, message: '语音合成失败，请重试' });
  }
});

module.exports = router;
