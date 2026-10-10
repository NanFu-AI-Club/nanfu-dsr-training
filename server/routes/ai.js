/**
 * AI智能问答路由
 * 表: ai_configs, ai_feedbacks, ai_favorites, kb_documents
 */
const express = require('express');
const { formatShanghai, dateFilename } = require('../utils/time');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { authRequired, adminRequired, systemAdminRequired, getOrgUserScope } = require('../middleware/auth');
const { applyLevelBonus } = require('../utils/points');
const { cut, extract } = require('@node-rs/jieba');
const { searchByEmbedding, embedQuery, searchByVector } = require('../services/siliconflow_embedding');

// ==================== 辅助函数 ====================

function logActivity(db, userId, action, targetType, targetId, detail, ip) {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, action, 'ai', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
}

/**
 * 跑店问问积分发放：提问 / 反馈各按规则分值计分，单日该模块合计上限 50 分
 * @param {object} db
 * @param {string} userId
 * @param {'ai_ask'|'ai_feedback'} sourceType
 * @param {string} sourceId 关联记录 id（反馈场景用于幂等）
 * @returns {number} 实际发放的积分
 */
const DEFAULT_AI_DAILY_POINT_LIMIT = 50;
function awardAIPoints(db, userId, sourceType, sourceId) {
  try {
    const rule = db.prepare('SELECT points FROM point_rules WHERE source_type = ? AND enabled = 1').get(sourceType);
    const perTime = rule && rule.points > 0 ? rule.points : 5;

    // 模块级每日上限：统一取 ai_ask 规则的配置，可在后台「积分规则」调整（0 表示不限制）
    const askRule = db.prepare("SELECT daily_limit FROM point_rules WHERE source_type = 'ai_ask'").get();
    const dailyLimit = askRule && Number(askRule.daily_limit) > 0
      ? Number(askRule.daily_limit)
      : DEFAULT_AI_DAILY_POINT_LIMIT;

    // 同一条回答的反馈只计分一次
    if (sourceType === 'ai_feedback' && sourceId) {
      const dup = db.prepare(
        "SELECT id FROM point_logs WHERE user_id = ? AND source_type = 'ai_feedback' AND source_id = ?"
      ).get(userId, sourceId);
      if (dup) return 0;
    }

    const todayRow = db.prepare(
      `SELECT COALESCE(SUM(points), 0) AS total
       FROM point_logs
       WHERE user_id = ? AND source_type IN ('ai_ask', 'ai_feedback') AND date(created_at) = date('now','localtime')`
    ).get(userId);
    const dailyEarned = todayRow ? Number(todayRow.total) : 0;
    if (dailyEarned >= dailyLimit) return 0;

    const base = Math.max(0, Math.min(perTime, dailyLimit - dailyEarned));
    if (base <= 0) return 0;
    // 等级加成后再受每日上限约束，避免加成后突破上限
    const { awarded: boosted } = applyLevelBonus(db, userId, base);
    const give = Math.max(0, Math.min(boosted, dailyLimit - dailyEarned));
    if (give <= 0) return 0;

    db.prepare(`
      INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(uuidv4(), userId, give, sourceType === 'ai_feedback' ? '跑店问问反馈' : '跑店问问提问', sourceType, sourceId || '');
    db.prepare("UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(give, give, userId);
    return give;
  } catch (e) {
    console.error('[ai/points] 积分发放失败:', e.message);
    return 0;
  }
}

/**
 * 停用词表（过滤高频通用词，避免干扰检索）
 */
const STOP_WORDS = new Set([
  '怎么', '怎么办', '如何', '什么', '为什么', '哪里', '哪', '吗', '呢', '啊', '呀', '吧',
  '的', '了', '是', '在', '有', '我', '你', '他', '她', '它', '这', '那',
  '一个', '一下', '应该', '可以', '能', '会', '要', '给', '把', '被', '对', '从', '到',
  '很', '还', '就', '都', '我们', '你们', '他们', '这样', '那样', '这个', '那个',
]);

/**
 * 提取关键词：优先用 jieba TF-IDF，降级到 jieba 分词，再降级到简单切分
 */
function extractKeywords(question) {
  try {
    const extracted = extract(question, 6);
    const kws = extracted
      .map(e => e.keyword)
      .filter(w => w && w.length >= 2 && !STOP_WORDS.has(w));
    if (kws.length > 0) return kws.slice(0, 8);
  } catch (_) { /* 降级 */ }
  try {
    return cut(question, true)
      .filter(w => w.length >= 2 && !STOP_WORDS.has(w))
      .slice(0, 8);
  } catch (_) { /* 降级 */ }
  return question
    .split(/[，。！？；：、\s,\.!\?;:]+/)
    .filter(w => w.length >= 2)
    .slice(0, 8);
}

/**
 * 基于关键词的检索（jieba 分词 + LIKE 匹配）
 */
function searchByKeywords(db, question) {
  const keywords = extractKeywords(question);
  if (keywords.length === 0) return [];

  const conditions = keywords.map(() => '(d.title LIKE ? OR d.content LIKE ?)').join(' OR ');
  const params = [];
  for (const kw of keywords) {
    params.push(`%${kw}%`, `%${kw}%`);
  }

  return db.prepare(`
    SELECT d.id, d.title, d.content
    FROM kb_documents d
    WHERE d.status = 'published' AND d.is_current = 1 AND (${conditions})
    ORDER BY d.updated_at DESC
    LIMIT 20
  `).all(...params);
}

/**
 * 从知识库搜索相关上下文（多路检索：方法论 + 卖点 + 场景）
 */
async function searchKnowledgeBase(db, question) {
  // 1. 关键词检索（全库，场景）
  const keywordDocs = searchByKeywords(db, question);

  // 2. 问题向量化一次（1 次 embedding API 调用）
  let qVec = null;
  try {
    qVec = await embedQuery(question);
  } catch (e) {
    console.error('[ai/search] 查询向量化失败，降级为关键词检索:', e.message);
  }

  // 3. 本地计算各分类语义相似度（纯内存，不再调 API）
  let semanticDocs = [];
  let methodologyDocs = [];
  let sellingPointDocs = [];
  let salesSkillDocs = [];
  if (qVec) {
    semanticDocs = searchByVector(db, qVec, 10);
    methodologyDocs = searchByVector(db, qVec, 2, ['销售实战核心方法论']);
    sellingPointDocs = searchByVector(db, qVec, 3, ['话术三板斧知识库']);
    salesSkillDocs = searchByVector(db, qVec, 3, ['销售技巧']);
  }

  // 4. 品类卖点速查表 + 产品知识 全量注入（数量少，全量给 AI）
  let categoryDocs = [];
  try {
    categoryDocs = db.prepare(`
      SELECT d.id, d.title, d.content FROM kb_documents d
      JOIN kb_categories c ON d.category_id = c.id
      WHERE c.name IN ('品类卖点速查表', '产品知识')
        AND d.status = 'published' AND d.is_current = 1
      ORDER BY d.updated_at DESC
    `).all();
  } catch (e) { /* 忽略 */ }

  // 5. 合并：保证品类卖点、产品知识、方法论、销售技巧、卖点话术、场景都有代表
  const result = [];
  const seen = new Set();

  for (const d of categoryDocs) {
    if (!seen.has(d.id)) { result.push(d); seen.add(d.id); }
  }
  for (const d of methodologyDocs) {
    if (!seen.has(d.id)) { result.push(d); seen.add(d.id); }
  }
  for (const d of salesSkillDocs) {
    if (!seen.has(d.id)) { result.push(d); seen.add(d.id); }
  }
  for (const d of sellingPointDocs) {
    if (!seen.has(d.id)) { result.push(d); seen.add(d.id); }
  }
  // 场景文档按语义分排序后补充
  const sceneDocs = [...semanticDocs, ...keywordDocs].sort(
    (a, b) => (b._score || 0) - (a._score || 0)
  );
  for (const d of sceneDocs) {
    if (result.length >= 16) break;
    if (!seen.has(d.id)) { result.push(d); seen.add(d.id); }
  }

  // 6. 去掉临时字段
  return result.map(({ _kw, _semantic, _score, ...rest }) => rest);
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
function buildContext(docs, maxLength = 3000) {
  if (docs.length === 0) return '';
  let context = '\n以下是相关的参考资料，请参考这些内容回答问题：\n\n';
  for (const doc of docs) {
    context += `参考：${doc.title}\n${doc.content.substring(0, 800)}\n\n`;
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
 * 过滤掉文本中的 emoji 和特殊字符（防止显示为 □□）
 */
function filterEmoji(text) {
  if (!text) return text;
  // 过滤掉 emoji 和其他特殊符号（保留中文、英文、数字、常用标点）
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')  // 表情符号
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')  // 符号和象形文字
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')  // 交通和地图符号
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '')  // 炼金术符号
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')  // 几何图形扩展
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')  // 补充箭头-C
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')  // 补充符号和象形文字
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')  // 国际象棋符号
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')  // 符号和象形文字扩展-A
    .replace(/[\u{2600}-\u{26FF}]/gu, '')    // 杂项符号
    .replace(/[\u{2700}-\u{27BF}]/gu, '')    // 装饰符号
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')    // 变体选择符
    .replace(/[\u{200D}]/gu, '');            // 零宽连接符
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
    answer += `> [提示] AI 模型暂不可用：${errorReason}\n`;
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

  return filterEmoji(answer);
}

/**
 * 剥离模型内联的思考过程（如 MiniMax-M3 会输出 <think>...</think>）
 * 仅用于非流式响应；流式响应请用 createReasoningFilter
 */
function stripReasoning(text) {
  if (!text) return text;
  let out = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  // 未闭合的思考块（通常是输出被截断），直接丢弃
  out = out.replace(/<think(?:ing)?>[\s\S]*$/i, '');
  return out.replace(/^[\s]+/, '');
}

/**
 * 流式剥离思考过程。
 * 部分推理模型把思考内容内联在 content 里（<think>...</think>），
 * 必须在转发时就过滤，否则思考过程会显示在页面上并被写入数据库。
 */
function createReasoningFilter({ onChunk, onThinking }) {
  let buffer = '';
  let inThinking = false;
  let emitted = false;

  const flush = (text) => {
    // 正式回答的第一个片段去掉开头的空白，避免思考块剥离后留下空行
    const out = emitted ? text : String(text || '').replace(/^\s+/, '');
    if (!out) return;
    emitted = true;
    if (onChunk) onChunk(out);
  };

  return {
    push(chunk) {
      if (!chunk) return;
      buffer += chunk;
      for (;;) {
        if (!inThinking) {
          const idx = buffer.indexOf('<think');
          if (idx === -1) {
            // 结尾可能是被切断的 <think 前半段，先保留，等后续数据补全
            let hold = 0;
            const max = Math.min('<think'.length - 1, buffer.length);
            for (let len = max; len > 0; len -= 1) {
              if ('<think'.startsWith(buffer.slice(buffer.length - len))) { hold = len; break; }
            }
            if (hold > 0) {
              flush(buffer.slice(0, buffer.length - hold));
              buffer = buffer.slice(buffer.length - hold);
              return;
            }
            flush(buffer);
            buffer = '';
            return;
          }
          flush(buffer.slice(0, idx));
          buffer = buffer.slice(idx);
          inThinking = true;
          continue;
        }
        // 处于思考块内，等待 </think 闭合
        const end = buffer.indexOf('</think');
        if (end === -1) {
          if (onThinking) onThinking();
          return;
        }
        const gt = buffer.indexOf('>', end);
        if (gt === -1) {
          if (onThinking) onThinking();
          return;
        }
        buffer = buffer.slice(gt + 1).replace(/^\s+/, '');
        inThinking = false;
      }
    },
    end() {
      // 收尾：未闭合的思考内容直接丢弃
      if (!inThinking && buffer) flush(buffer);
      buffer = '';
      inThinking = false;
    },
  };
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
    max_tokens: config.max_tokens || 65536,
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
        console.log(`[AI] HTTP ${aiRes.statusCode} from ${apiUrl}, model=${config.model || 'gpt-4o-mini'}`);
        console.log(`[AI] Raw response (first 500 chars):`, body.substring(0, 500));
        try {
          const result = JSON.parse(body);
          if (result.choices && result.choices[0] && result.choices[0].message) {
            const msg = result.choices[0].message;
            // 剥离模型内联的思考过程（<think>...</think>），只保留正式回答
            const content = stripReasoning(msg.content);
            // 推理模型（如 deepseek-v4-flash）在 max_tokens 不够时会只输出推理过程
            // 这种情况应该报错，而不是用推理过程替代最终回答
            if (!content || !content.trim()) {
              const finishReason = result.choices[0].finish_reason;
              console.warn(`[AI] WARNING: model returned empty content! finish_reason=${finishReason}, model=${config.model || 'gpt-4o-mini'}`);
              if (finishReason === 'length') {
                reject(new Error('max_tokens 不足，模型未能完成输出。请提高 max_tokens 配置值（建议 16384 或更高）'));
              } else {
                console.warn(`[AI] Full response:`, JSON.stringify(result).substring(0, 1000));
                reject(new Error('AI 模型返回了空内容'));
              }
              return;
            }
            resolve(filterEmoji(content));
          } else if (result.error) {
            console.error(`[AI] API error:`, JSON.stringify(result.error));
            reject(new Error(`AI API HTTP ${aiRes.statusCode}: ${result.error.message || 'AI API error'}`));
          } else {
            console.error(`[AI] Unexpected response format:`, JSON.stringify(result).substring(0, 500));
            reject(new Error('AI API 返回格式异常'));
          }
        } catch (e) {
          console.error(`[AI] JSON parse failed, body:`, body.substring(0, 500));
          reject(new Error(aiRes.statusCode >= 400
            ? `AI API HTTP ${aiRes.statusCode}: ${body.substring(0, 200)}`
            : `AI API 响应解析失败: ${body.substring(0, 200)}`));
        }
      });
    });

    aiReq.on('error', (e) => reject(e));
    aiReq.on('timeout', () => { aiReq.destroy(); reject(new Error('AI 请求超时')); });
    aiReq.write(postData);
    aiReq.end();
  });
}

/**
 * 流式调用外部 AI API（SSE 流式输出，逐 token 回调）
 * @param {object} config AI 配置
 * @param {Array} messages 消息列表
 * @param {(chunk: string) => void} onChunk 每收到一段文本时回调
 */
async function callAIProviderStream(config, messages, onChunk, onThinking) {
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
    max_tokens: config.max_tokens || 65536,
    stream: true,
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
        'Accept': 'text/event-stream',
      },
      timeout: 60000,
    };

    const aiReq = transport.request(options, (aiRes) => {
      // 非 2xx 视为失败，读取错误体后 reject
      if (aiRes.statusCode < 200 || aiRes.statusCode >= 300) {
        let errBody = '';
        aiRes.on('data', (c) => { errBody += c.toString('utf-8'); });
        aiRes.on('end', () => reject(new Error(`AI API HTTP ${aiRes.statusCode}: ${errBody.slice(0, 200)}`)));
        return;
      }

      let buffer = '';
      const reasoningFilter = createReasoningFilter({ onChunk, onThinking });

      const handleLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = (json.choices && json.choices[0] && json.choices[0].delta) || {};
          if (delta.content) {
            reasoningFilter.push(delta.content);
          } else if (delta.reasoning_content) {
            // 推理模型会先输出思考过程，这里发心跳避免客户端长时间无数据
            if (onThinking) onThinking();
          }
        } catch (_) { /* 忽略非 JSON 行 */ }
      };

      aiRes.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留最后一行（可能不完整）
        for (const line of lines) handleLine(line);
      });

      aiRes.on('end', () => {
        if (buffer) handleLine(buffer);
        reasoningFilter.end();
        resolve();
      });
    });

    aiReq.on('error', (e) => reject(e));
    aiReq.on('timeout', () => { aiReq.destroy(); reject(new Error('AI 请求超时')); });
    aiReq.write(postData);
    aiReq.end();
  });
}

// ==================== AI 调用容错（重试 + 多 provider 兜底） ====================

// 单个 provider 的最大尝试次数 / 重试间隔
const AI_MAX_ATTEMPTS = parseInt(process.env.AI_MAX_ATTEMPTS, 10) || 3;
const AI_RETRY_DELAY_MS = parseInt(process.env.AI_RETRY_DELAY_MS, 10) || 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 瞬态错误（服务端 5xx / 超时 / 网络抖动）值得重试；参数类错误（4xx）不重试
function isRetryableError(err) {
  const msg = String((err && err.message) || '');
  if (/HTTP 4\d\d/.test(msg)) return false;
  return /HTTP 5\d\d/.test(msg)
    || /超时|timeout/i.test(msg)
    || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|network/i.test(msg);
}

// 可用的 AI 配置候选：激活的优先，其余有 key 的作为兜底
function getAIConfigCandidates(db) {
  return db.prepare(`
    SELECT * FROM ai_configs
    WHERE api_key IS NOT NULL AND api_key != ''
    ORDER BY is_active DESC, updated_at DESC
  `).all();
}

// 非流式调用：先重试当前 provider，再依次切换兜底 provider
async function callAIWithFallback(configs, messages) {
  const list = Array.isArray(configs) ? configs : (configs ? [configs] : []);
  let lastErr;
  for (const cfg of list) {
    for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt++) {
      try {
        return await callAIProvider(cfg, messages);
      } catch (e) {
        lastErr = e;
        console.warn(`[AI] ${cfg.provider || ''}/${cfg.model || ''} 第 ${attempt}/${AI_MAX_ATTEMPTS} 次失败: ${e.message}`);
        if (!isRetryableError(e) || attempt === AI_MAX_ATTEMPTS) break;
        await sleep(AI_RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr || new Error('没有可用的 AI 配置');
}

// 流式调用：只有在「尚未吐出任何内容」时才能重试，避免重复输出
async function callAIStreamWithFallback(configs, messages, onChunk, onThinking) {
  const list = Array.isArray(configs) ? configs : (configs ? [configs] : []);
  let lastErr;
  for (const cfg of list) {
    for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt++) {
      let emitted = '';
      try {
        await callAIProviderStream(cfg, messages, (chunk) => { emitted += chunk; if (onChunk) onChunk(chunk); }, onThinking);
        return cfg;
      } catch (e) {
        lastErr = e;
        console.warn(`[AI] 流式 ${cfg.provider || ''}/${cfg.model || ''} 第 ${attempt}/${AI_MAX_ATTEMPTS} 次失败: ${e.message}`);
        if (emitted) throw e; // 已经输出过内容，重试会导致重复
        if (!isRetryableError(e) || attempt === AI_MAX_ATTEMPTS) break;
        await sleep(AI_RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr || new Error('没有可用的 AI 配置');
}

// ==================== AI 配置管理 (admin) ====================

// GET /ai/configs - AI配置列表（admin）
router.get('/configs', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const configs = db.prepare(`
      SELECT * FROM ai_configs ORDER BY created_at DESC
    `).all();

    // 安全：完全隐藏 API key，不返回任何部分
    const list = configs.map(c => ({
      ...c,
      api_key: c.api_key ? '********' : null, // 完全隐藏，不泄露任何字符
      is_active: c.is_active === 1
    }));

    res.json({ code: 0, data: list });
  } catch (err) {
    console.error('[ai/configs] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /ai/configs - 新增配置（admin）
router.post('/configs', authRequired, systemAdminRequired, (req, res) => {
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
      max_tokens || 65536,
      is_active !== undefined ? (is_active ? 1 : 0) : 0
    );

    // 如果新配置激活，停用其他配置
    if (is_active) {
      db.prepare('UPDATE ai_configs SET is_active = 0 WHERE id != ?').run(id);
    }

    logActivity(db, req.user.id, 'create', 'ai_config', id, JSON.stringify({ provider }));

    res.json({ code: 0, message: 'AI配置创建成功', data: { id } });
  } catch (err) {
    console.error('[ai/configs/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /ai/configs/:id - 更新配置（admin）
router.put('/configs/:id', authRequired, systemAdminRequired, (req, res) => {
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
      JSON.stringify({ provider: provider || config.provider }), req.ip);

    res.json({ code: 0, message: 'AI配置更新成功' });
  } catch (err) {
    console.error('[ai/configs/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /ai/configs/:id - 删除配置（admin）
router.delete('/configs/:id', authRequired, systemAdminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const config = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(id);
    if (!config) {
      return res.status(404).json({ code: 404, message: 'AI配置不存在' });
    }

    db.prepare('DELETE FROM ai_configs WHERE id = ?').run(id);

    logActivity(db, req.user.id, 'delete', 'ai_config', id,
      JSON.stringify({ provider: config.provider }), req.ip);

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

    // 可用的 AI 配置（激活的优先，其余有 key 的作为兜底）
    const configs = getAIConfigCandidates(db);
    const config = configs[0] || null;

    // 从知识库搜索相关上下文
    const docs = await searchKnowledgeBase(db, trimmedQuestion);
    // 从题库搜索相关题目
    const relatedQuestions = searchQuestionBank(db, trimmedQuestion);

    // 生成或沿用 conversation_id
    const convId = conversation_id || uuidv4();

    let answer;
    let useMock = true;
    let mockReason = null;

    if (configs.length) {
      try {
        // 构建消息列表
        const messages = [];

        // 系统提示词 + 知识库 + 题库上下文
        const defaultPrompt = `你是南孚电池的智能销售助手"跑店问问"（你的销售随身问答助手，业务疑问，一问就懂），专门帮助销售代表解决销售难题。

**回答规则：**
1. 直接回答用户问题，像正常对话一样
2. 禁止输出任何方括号格式，如【知识库资料】、【来源：xxx】等
3. 禁止输出"基于知识库"、"基于销售实战经验"等说明性文字
4. 如果知识库有相关内容就用，没有就凭专业知识回答
5. 回答要专业、简洁、有针对性
6. 当用户需要"话术"（教 TA 怎么跟老板/顾客说）时，话术部分控制在 100 字以内，并严格按以下链路组织：先接纳异议（不否定、不纠正对方）→ 转换算账维度 → 陈述给门店带来的经营损益（收益 + 风险规避）→ 弱化对比、只讲自身价值 → 最后给出低风险行动方案收尾。

回答风格：像一位经验丰富的销售导师在跟同事聊天，自然、亲切、专业。`;

        const systemPrompt = config.system_prompt || defaultPrompt;
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
        answer = await callAIWithFallback(configs, messages);
        // 临时调试：把真实发给模型的内容写出来
        try { require('fs').writeFileSync(require('path').join(__dirname, '..', '.tmp-msg.json'), JSON.stringify({ model: config.model, temperature: config.temperature || 0.7, max_tokens: config.max_tokens || 65536, messages }, null, 2)); } catch (_) {}
        // 空内容也视为失败，降级到知识库兜底
        if (!answer || !answer.trim()) {
          throw new Error('AI 返回了空内容');
        }
        useMock = false;
      } catch (apiErr) {
        console.error('[ai/chat] API call failed, falling back to mock:', apiErr.message);
        // 用知识库+题库内容构建智能兜底回复，并提示错误原因
        mockReason = apiErr.message;
        answer = generateMockResponse(trimmedQuestion, docs, relatedQuestions, config.system_prompt, apiErr.message);
      }
    } else {
      // 无配置或没有 API key，使用模拟回复
      mockReason = '未配置AI模型或API Key';
      answer = generateMockResponse(trimmedQuestion, docs, relatedQuestions, config ? config.system_prompt : null, mockReason);
    }

    // 保存到 ai_feedbacks（含 sources）
    const feedbackId = uuidv4();
    const sources = [
      ...docs.map(d => ({ id: d.id, title: d.title, type: 'knowledge' })),
      ...relatedQuestions.map(q => ({ id: q.id, title: q.content.substring(0, 40), type: 'question' })),
    ];
    db.prepare(`
      INSERT INTO ai_feedbacks (id, conversation_id, question, answer, sources, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(feedbackId, convId, trimmedQuestion, answer, JSON.stringify(sources), userId);

    logActivity(db, userId, 'chat', 'ai_chat', feedbackId,
      { conversation_id: convId, question_length: trimmedQuestion.length, has_sources: sources.length > 0, use_mock: useMock }, req.ip);

    // 提问计分：每次 5 分，单日该模块合计上限 50 分
    const earnedPoints = awardAIPoints(db, userId, 'ai_ask', feedbackId);

    res.json({
      code: 0,
      data: {
        id: feedbackId,
        answer,
        conversation_id: convId,
        sources,
        use_mock: useMock,
        mock_reason: mockReason,
        earned_points: earnedPoints
      }
    });
  } catch (err) {
    console.error('[ai/chat] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /ai/chat/stream - AI 问答（SSE 流式输出，绕开微信 webview 30s 超时）
router.post('/chat/stream', authRequired, async (req, res) => {
  const db = req.db;
  const { question, conversation_id } = req.body;
  const userId = req.user.id;

  // SSE 响应头（X-Accel-Buffering: no 禁止 Nginx 缓冲）
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) { /* 连接可能已断开 */ }
  };

  // 立即发送初始事件，避免客户端（微信 webview）在 AI 首个 token 前超时断开
  send({ status: 'start' });

  try {
    if (!question || !question.trim()) {
      send({ error: '问题不能为空' });
      return res.end();
    }

    const trimmedQuestion = question.trim();

    const configs = getAIConfigCandidates(db);
    const config = configs[0] || null;

    const docs = await searchKnowledgeBase(db, trimmedQuestion);
    const relatedQuestions = searchQuestionBank(db, trimmedQuestion);

    const convId = conversation_id || uuidv4();

    let fullText = '';
    let useMock = true;
    let errorReason = null;

    if (configs.length) {
      try {
        const defaultPrompt = `你是南孚电池的智能销售助手"跑店问问"（你的销售随身问答助手，业务疑问，一问就懂），专门帮助销售代表解决销售难题。

**回答规则：**
1. 直接回答用户问题，像正常对话一样
2. 禁止输出任何方括号格式，如【知识库资料】、【来源：xxx】等
3. 禁止输出"基于知识库"、"基于销售实战经验"等说明性文字
4. 如果知识库有相关内容就用，没有就凭专业知识回答
5. 回答要专业、简洁、有针对性
6. 当用户需要"话术"（教 TA 怎么跟老板/顾客说）时，话术部分控制在 100 字以内，并严格按以下链路组织：先接纳异议（不否定、不纠正对方）→ 转换算账维度 → 陈述给门店带来的经营损益（收益 + 风险规避）→ 弱化对比、只讲自身价值 → 最后给出低风险行动方案收尾。

回答风格：像一位经验丰富的销售导师在跟同事聊天，自然、亲切、专业。`;

        const systemPrompt = config.system_prompt || defaultPrompt;
        let systemMsg = systemPrompt;
        if (docs.length > 0) systemMsg += '\n\n' + buildContext(docs);
        if (relatedQuestions.length > 0) systemMsg += '\n\n' + buildQuestionContext(relatedQuestions);

        const messages = [{ role: 'system', content: systemMsg }];

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

        // 流式转发 AI 的每个 token（带重试与多配置兜底）
        await callAIStreamWithFallback(configs, messages, (chunk) => {
          fullText += chunk;
          send({ delta: chunk });
        }, () => {
          // 推理阶段心跳，保持连接活跃
          send({ status: 'thinking' });
        });

        if (fullText.trim()) {
          useMock = false;
        } else {
          errorReason = 'AI 返回了空内容';
        }
      } catch (apiErr) {
        errorReason = apiErr.message;
        console.error('[ai/chat/stream] AI call failed:', apiErr.message);
      }
    } else {
      errorReason = '未配置AI模型或API Key';
    }

    // AI 失败或无配置时，用知识库+题库兜底（一次性发送）
    if (useMock) {
      const mockAnswer = generateMockResponse(trimmedQuestion, docs, relatedQuestions, config ? config.system_prompt : null, errorReason);
      fullText = mockAnswer;
      send({ delta: mockAnswer });
    }

    // 保存到 ai_feedbacks
    const feedbackId = uuidv4();
    const sources = [
      ...docs.map(d => ({ id: d.id, title: d.title, type: 'knowledge' })),
      ...relatedQuestions.map(q => ({ id: q.id, title: q.content.substring(0, 40), type: 'question' })),
    ];
    db.prepare(`
      INSERT INTO ai_feedbacks (id, conversation_id, question, answer, sources, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(feedbackId, convId, trimmedQuestion, fullText, JSON.stringify(sources), userId);

    logActivity(db, userId, 'chat', 'ai_chat', feedbackId,
      { conversation_id: convId, question_length: trimmedQuestion.length, has_sources: sources.length > 0, use_mock: useMock }, req.ip);

    // 提问计分：每次 5 分，单日该模块合计上限 50 分
    const earnedPoints = awardAIPoints(db, userId, 'ai_ask', feedbackId);

    send({ done: true, id: feedbackId, conversation_id: convId, sources, use_mock: useMock, mock_reason: useMock ? errorReason : null, earned_points: earnedPoints });
    res.end();
  } catch (err) {
    console.error('[ai/chat/stream] Error:', err);
    send({ error: '服务器内部错误' });
    res.end();
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

// POST /ai/feedback/:id - 对某条对话点赞/踩 {rating: 'like'|'dislike', reason?: string}
router.post('/feedback/:id', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { rating, reason } = req.body;
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

    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (cleanReason) {
      db.prepare('UPDATE ai_feedbacks SET rating = ?, feedback_reason = ? WHERE id = ?').run(rating, cleanReason, id);
    } else {
      db.prepare('UPDATE ai_feedbacks SET rating = ? WHERE id = ?').run(rating, id);
    }

    // 反馈计分：同一条回答只计一次，单日该模块合计上限 50 分
    const earnedPoints = awardAIPoints(db, userId, 'ai_feedback', id);

    res.json({ code: 0, message: '评价已提交', data: { id, rating, earned_points: earnedPoints } });
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
      JSON.stringify({ deleted_rows: result.changes }), req.ip);

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

    const scope = getOrgUserScope(req.db, admin, 'u');
    let whereClause = `WHERE ${scope.clause}`;
    const params = [...scope.params];

    if (userId) {
      whereClause += ' AND af.user_id = ?';
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
        af.id, af.conversation_id, af.question, af.answer, af.rating, af.feedback_reason, af.sources, af.created_at,
        u.id as user_id, u.username, u.real_name,
        fav.id as favorite_id
      FROM ai_feedbacks af
      JOIN users u ON af.user_id = u.id
      LEFT JOIN ai_favorites fav ON fav.feedback_id = af.id
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

// GET /ai/admin/dislikes - 查看所有"没用"反馈（含反馈原因）
router.get('/admin/dislikes', authRequired, adminRequired, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '只有管理员可以查看' });
    }
    const scope = getOrgUserScope(req.db, req.user, 'u');
    const rows = req.db.prepare(`
      SELECT af.id, af.conversation_id, af.question, af.answer, af.sources,
             af.feedback_reason, af.created_at,
             u.username, u.real_name
      FROM ai_feedbacks af
      JOIN users u ON af.user_id = u.id
      WHERE af.rating = 'dislike' AND af.feedback_reason IS NOT NULL AND af.feedback_reason != ''
        AND ${scope.clause}
      ORDER BY af.created_at DESC
    `).all(...scope.params);
    res.json({ code: 0, data: { list: rows } });
  } catch (err) {
    console.error('[ai/admin/dislikes] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /ai/admin/dislikes/export - 导出"没用"反馈
router.get('/admin/dislikes/export', authRequired, adminRequired, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '只有管理员可以导出' });
    }
    const scope = getOrgUserScope(req.db, req.user, 'u');
    const rows = req.db.prepare(`
      SELECT af.question, af.feedback_reason, af.created_at,
             u.username, u.real_name
      FROM ai_feedbacks af
      JOIN users u ON af.user_id = u.id
      WHERE af.rating = 'dislike' AND af.feedback_reason IS NOT NULL AND af.feedback_reason != ''
        AND ${scope.clause}
      ORDER BY af.created_at DESC
    `).all(...scope.params);

    const header = ['用户', '用户名', '问题', '回答', '反馈原因', '时间'];
    const csvRows = [header.map(h => `"${h}"`).join(',')];
    for (const r of rows) {
      const escapeCsv = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
      csvRows.push([
        escapeCsv(r.real_name || '-'),
        escapeCsv(r.username || '-'),
        escapeCsv(r.question || '-'),
        escapeCsv(r.answer || '-'),
        escapeCsv(r.feedback_reason || '-'),
        escapeCsv(formatShanghai(r.created_at)),
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=dislikes_${dateFilename()}.csv`);
    res.send('\uFEFF' + csvRows.join('\n'));
  } catch (err) {
    console.error('[ai/admin/dislikes/export] Error:', err);
    res.status(500).json({ code: 500, message: '导出失败' });
  }
});

// GET /ai/admin/conversations/export - 导出对话记录
router.get('/admin/conversations/export', authRequired, adminRequired, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '只有管理员可以导出' });
    }

    const scope = getOrgUserScope(req.db, req.user, 'u');
    const rows = req.db.prepare(`
      SELECT af.question, af.answer, af.rating, af.feedback_reason, af.created_at,
             u.username, u.real_name
      FROM ai_feedbacks af
      JOIN users u ON af.user_id = u.id
      WHERE ${scope.clause}
      ORDER BY af.created_at DESC
    `).all(...scope.params);

    const header = ['用户', '用户名', '问题', '回答', '评分', '反馈原因', '时间'];
    const csvRows = [header.map(h => `"${h}"`).join(',')];
    for (const r of rows) {
      const escapeCsv = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
      const ratingLabel = r.rating === 'like' ? '满意' : r.rating === 'dislike' ? '不满意' : '无评分';
      const time = formatShanghai(r.created_at);
      csvRows.push([
        escapeCsv(r.real_name || '-'),
        escapeCsv(r.username || '-'),
        escapeCsv(r.question || '-'),
        escapeCsv(r.answer || '-'),
        escapeCsv(ratingLabel),
        escapeCsv(r.feedback_reason || '-'),
        escapeCsv(time),
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=conversations_${dateFilename()}.csv`);
    res.send('\uFEFF' + csvRows.join('\n'));
  } catch (err) {
    console.error('[ai/admin/conversations/export] Error:', err);
    res.status(500).json({ code: 500, message: '导出失败' });
  }
});

// GET /ai/admin/conversations/:conversationId - 查看某个对话的完整记录
router.get('/admin/conversations/:conversationId', authRequired, adminRequired, (req, res) => {
  try {
    const admin = req.user;
    if (admin.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '只有管理员可以查看' });
    }
    const scope = getOrgUserScope(req.db, admin, 'u');

    const rows = req.db.prepare(`
      SELECT
        af.id, af.conversation_id, af.question, af.answer, af.rating, af.feedback_reason, af.sources, af.created_at,
        u.id as user_id, u.username, u.real_name,
        fav.id as favorite_id
      FROM ai_feedbacks af
      JOIN users u ON af.user_id = u.id
      LEFT JOIN ai_favorites fav ON fav.feedback_id = af.id
      WHERE af.conversation_id = ? AND ${scope.clause}
      ORDER BY af.created_at ASC
    `).all(req.params.conversationId, ...scope.params);

    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('[ai/admin/conversations/detail] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 语音服务（ASR + TTS） ====================
const { sentenceRecognition } = require('../services/tencent_asr');
const { textToSpeech } = require('../services/voice_edge');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 腾讯云「一句话识别」单次只支持 60 秒以内音频，超过就报 ErrorVoicedataTooLong。
// 这里把超长音频按 45 秒切片，逐片识别后拼接，让长语音也能正常转文字。
const ASR_SEGMENT_SECONDS = 45;
async function recognizeLongAudio(wavBuffer) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-split-'));
  const srcPath = path.join(workDir, 'src.wav');
  fs.writeFileSync(srcPath, wavBuffer);
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-y', '-i', srcPath,
        '-f', 'segment', '-segment_time', String(ASR_SEGMENT_SECONDS), '-segment_format', 'wav',
        '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000',
        path.join(workDir, 'part-%03d.wav'),
      ], { timeout: 60000 });
      let stderr = '';
      ff.stderr.on('data', (d) => { stderr += d; });
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 切片失败: ${stderr.slice(0, 200)}`))));
      ff.on('error', reject);
    });

    const parts = fs.readdirSync(workDir).filter((f) => /^part-\d+\.wav$/.test(f)).sort();
    const texts = [];
    for (const part of parts) {
      try {
        const r = await sentenceRecognition(fs.readFileSync(path.join(workDir, part)), 'wav');
        if (r.text) texts.push(r.text);
      } catch (e) {
        // 单片失败不影响其余片段，最后至少能拿到部分文字
        console.error('[ai/speech-to-text] 分段识别失败:', part, e.message);
      }
    }
    console.log(`[ai/speech-to-text] 长语音已切片 ${parts.length} 段，拼接完成`);
    return texts.join('');
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
}

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

    // 安全：使用 spawn 替代 exec，避免 shell 注入风险
    const convertAudio = () => new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', tmpIn,
        '-acodec', 'pcm_s16le',
        '-ac', '1',
        '-ar', '16000',
        '-f', 'wav',
        tmpOut
      ], { timeout: 45000 });
      
      let stderr = '';
      ffmpeg.stderr.on('data', (data) => { stderr += data; });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 200)}`));
      });
      
      ffmpeg.on('error', reject);
    });

    let wavBuffer = req.file.buffer;

    try {
      await convertAudio();
      if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size >= 100) {
        wavBuffer = fs.readFileSync(tmpOut);
        console.log(`[ai/speech-to-text] Converted ${(req.file.size / 1024).toFixed(1)}KB → ${(wavBuffer.length / 1024).toFixed(1)}KB WAV`);
      }
    } catch (ffErr) {
      console.error('[ai/speech-to-text] ffmpeg convert failed:', ffErr.message);
    }

    let text = '';
    // 仅使用腾讯云 ASR
    try {
      // WAV 已统一转成 16kHz / 单声道 / 16bit，直接按字节数算时长（44 字节为 WAV 头）
      const durationSec = Math.max(0, (wavBuffer.length - 44) / (16000 * 2));
      if (durationSec > 55) {
        text = await recognizeLongAudio(wavBuffer);
        console.log(`[ai/speech-to-text] 腾讯云ASR(长语音 ${durationSec.toFixed(1)}s):`, text);
      } else {
        const result = await sentenceRecognition(wavBuffer, 'wav');
        text = result.text;
        console.log(`[ai/speech-to-text] 腾讯云ASR(${durationSec.toFixed(1)}s):`, text);
      }
    } catch (tencentErr) {
      console.error('[ai/speech-to-text] 腾讯云ASR失败:', tencentErr.message);
      const tooLong = /TooLong|60 seconds/i.test(tencentErr.message);
      return res.status(500).json({
        code: 500,
        message: tooLong ? '语音时长超出限制，请分成几段说' : `语音识别失败：${tencentErr.message}`,
      });
    }

    if (!text || !text.trim()) {
      return res.json({ code: 0, data: { text: '' }, message: '未识别到语音内容' });
    }

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
// 供其他路由（如 FU利陪陪对练）复用流式调用能力
module.exports.callAIProviderStream = callAIProviderStream;
module.exports.callAIProvider = callAIProvider;
module.exports.callAIWithFallback = callAIWithFallback;
module.exports.callAIStreamWithFallback = callAIStreamWithFallback;
module.exports.getAIConfigCandidates = getAIConfigCandidates;
module.exports.stripReasoning = stripReasoning;
module.exports.createReasoningFilter = createReasoningFilter;
