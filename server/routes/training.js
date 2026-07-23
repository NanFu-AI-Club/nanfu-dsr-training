/**
 * AI陪练角色扮演路由
 * 表: training_scenarios, training_sessions, training_messages, training_reports, ai_configs, activity_logs, users, point_logs
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired } = require('../middleware/auth');

// ==================== 辅助函数 ====================

function logActivity(db, userId, action, targetType, targetId, detail, ip) {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, action, 'training', targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null);
}

/**
 * 根据场景prompt模拟客户回复（无AI API时的回退方案）
 */
function simulateCustomerReply(scenario, historyMessages, userMessage) {
  const prompt = scenario.scenario_prompt || '';
  const roleType = scenario.role_type || '客户';
  const scenarioTitle = scenario.title || '';
  const lowerMsg = userMessage.toLowerCase();

  // 根据历史对话轮数调整回复策略
  const userMessageCount = historyMessages.filter(m => m.role === 'user').length;

  // 开场阶段（第一轮）
  if (userMessageCount <= 1) {
    if (scenarioTitle.includes('谈判') || scenarioTitle.includes('采购')) {
      if (lowerMsg.includes('你好') || lowerMsg.includes('您好') || lowerMsg.includes('介绍')) {
        return `你好，我是${roleType}。我们最近在考虑电池品类的供应商调整，你们南孚有什么优势？直接说重点吧。`;
      }
      return `嗯，我时间有限。你们南孚电池的价格和供货条件怎么样？先说报价。`;
    }
    if (scenarioTitle.includes('异议') || scenarioTitle.includes('投诉')) {
      return `你好，我是${roleType}。老实说，我对你们的产品有些顾虑，上批货出了点问题，你说说怎么解决？`;
    }
    return `你好，我是${roleType}。听说你们南孚的产品不错，不过我需要了解更多细节，你先介绍下吧。`;
  }

  // 中间阶段
  if (userMessageCount <= 3) {
    if (lowerMsg.includes('产品') || lowerMsg.includes('优势') || lowerMsg.includes('特点') || lowerMsg.includes('质量')) {
      return '产品优势说得不错，但我想知道你们跟竞品比有什么核心竞争力？价格方面有优势吗？';
    }
    if (lowerMsg.includes('价格') || lowerMsg.includes('报价') || lowerMsg.includes('优惠') || lowerMsg.includes('成本')) {
      return '这个价格说实话没什么吸引力。我手上还有其他品牌的报价，你们的优势在哪里？能再优惠些吗？';
    }
    if (lowerMsg.includes('售后') || lowerMsg.includes('服务') || lowerMsg.includes('保障')) {
      return '售后保障这块说得挺好。不过具体执行起来怎么样？你们有没有实际的处理案例？';
    }
    return '嗯，这些我了解了。不过我关心的是长期合作的利益保障，你们能提供什么长期支持？';
  }

  // 深入阶段
  if (userMessageCount <= 6) {
    if (lowerMsg.includes('促销') || lowerMsg.includes('活动') || lowerMsg.includes('支持')) {
      return '促销支持方案听着还行。那陈列物料和人员培训这块呢？你们有没有专门的团队来对接？';
    }
    if (lowerMsg.includes('陈列') || lowerMsg.includes('物料') || lowerMsg.includes('培训')) {
      return '不错，有具体的落地支持方案。那我们聊聊合作模式吧，首批订单怎么操作？';
    }
    if (lowerMsg.includes('合同') || lowerMsg.includes('合作') || lowerMsg.includes('订单')) {
      return '合作模式我基本认可。不过我对账期和退换货政策比较关心，这些细节怎么约定的？';
    }
    if (lowerMsg.includes('物流') || lowerMsg.includes('配送') || lowerMsg.includes('库存')) {
      return '物流配送效率很关键，我们店面的库存周转比较快，补货能跟得上吗？';
    }
    return '你说的这些我认真考虑了。还有其他需要让我知道的吗？综合来看你的方案还不错。';
  }

  // 收尾阶段
  if (lowerMsg.includes('谢谢') || lowerMsg.includes('感谢') || lowerMsg.includes('合作愉快')) {
    return '好，既然细节都谈妥了，我也觉得合作前景不错。回头你把合同发过来，我看看没问题就可以签了。';
  }
  if (lowerMsg.includes('合同') || lowerMsg.includes('签约') || lowerMsg.includes('确认')) {
    return '合同没问题的话我们可以尽快推进。希望合作愉快，后续服务一定要跟上啊！';
  }
  return '整体来看你的表现不错，方案也比较有诚意。我们把合作推进到下一步吧，等你的正式方案。';
}

/**
 * 模拟生成评估报告（无AI API时）
 */
function generateEvaluationReport(scenario, messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const messageCount = userMessages.length;
  const allText = userMessages.map(m => m.content.toLowerCase()).join(' ');

  // 六维度评分（模拟评分逻辑）
  // 沟通表达：基于对话轮次、礼貌用语
  let communication = 60;
  if (messageCount >= 8) communication = 90;
  else if (messageCount >= 6) communication = 80;
  else if (messageCount >= 4) communication = 70;
  else if (messageCount >= 2) communication = 55;
  if (allText.includes('你好') || allText.includes('您好')) communication += 3;
  if (allText.includes('谢谢') || allText.includes('感谢')) communication += 2;
  communication = Math.min(100, communication);

  // 产品知识：基于提及产品相关内容
  let productKnowledge = 55;
  if (allText.includes('产品') || allText.includes('优势') || allText.includes('特点')) productKnowledge += 10;
  if (allText.includes('聚能环') || allText.includes('技术') || allText.includes('电池')) productKnowledge += 8;
  if (allText.includes('品质') || allText.includes('质量')) productKnowledge += 7;
  productKnowledge = Math.min(100, productKnowledge);

  // 异议处理：基于回应客户质疑
  let objectionHandling = 50;
  if (allText.includes('价格') && allText.includes('价值')) objectionHandling += 10;
  if (allText.includes('解决') || allText.includes('方案')) objectionHandling += 8;
  if (allText.includes('售后') || allText.includes('保障')) objectionHandling += 7;
  if (messageCount >= 5) objectionHandling += 10;
  objectionHandling = Math.min(100, objectionHandling);

  // 谈判技巧：基于协商推进
  let negotiation = 50;
  if (allText.includes('优惠') || allText.includes('折扣') || allText.includes('活动')) negotiation += 8;
  if (allText.includes('合作') || allText.includes('长期')) negotiation += 7;
  if (allText.includes('合同') || allText.includes('签约') || allText.includes('下一步')) negotiation += 10;
  if (messageCount >= 6) negotiation += 10;
  negotiation = Math.min(100, negotiation);

  // 客户关系：基于关系维护
  let customerRelation = 55;
  if (allText.includes('谢谢') || allText.includes('感谢')) customerRelation += 8;
  if (allText.includes('服务') || allText.includes('支持')) customerRelation += 7;
  if (allText.includes('满意') || allText.includes('放心')) customerRelation += 5;
  if (messageCount >= 5) customerRelation += 10;
  customerRelation = Math.min(100, customerRelation);

  // 职业素养：基于专业性
  let professionalism = 60;
  if (allText.includes('你好') || allText.includes('您好')) professionalism += 5;
  if (allText.includes('谢谢') || allText.includes('感谢')) professionalism += 5;
  if (allText.includes('了解') || allText.includes('理解')) professionalism += 5;
  if (messageCount >= 4) professionalism += 10;
  professionalism = Math.min(100, professionalism);

  const dimensions = [
    { name: '沟通表达', score: communication, comment: communication >= 80 ? '表达流畅，沟通积极' : communication >= 60 ? '沟通能力良好，可进一步提升表达丰富度' : '建议加强沟通练习，丰富表达方式' },
    { name: '产品知识', score: productKnowledge, comment: productKnowledge >= 80 ? '产品知识扎实，能有效介绍卖点' : productKnowledge >= 60 ? '产品知识掌握较好，可继续深入学习' : '建议加强产品知识学习' },
    { name: '异议处理', score: objectionHandling, comment: objectionHandling >= 80 ? '异议处理能力强，应变出色' : objectionHandling >= 60 ? '异议处理能力良好，可加强应对策略' : '建议学习异议处理技巧' },
    { name: '谈判技巧', score: negotiation, comment: negotiation >= 80 ? '谈判策略得当，推进有力' : negotiation >= 60 ? '谈判技巧良好，可提升协商策略' : '建议加强谈判技巧训练' },
    { name: '客户关系', score: customerRelation, comment: customerRelation >= 80 ? '善于维护客户关系' : customerRelation >= 60 ? '客户关系维护较好' : '建议加强客户关系管理意识' },
    { name: '职业素养', score: professionalism, comment: professionalism >= 80 ? '职业素养优秀，专业性强' : professionalism >= 60 ? '职业素养良好' : '建议提升职业化训练' }
  ];

  const totalScore = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);

  // 生成优缺点和建议
  const strengths = [];
  const weaknesses = [];

  if (communication >= 75) strengths.push('沟通表达流畅自然，能有效传递信息');
  else weaknesses.push('沟通表达能力有待提升，建议多加练习');

  if (productKnowledge >= 75) strengths.push('产品知识掌握扎实，能专业地介绍产品卖点');
  else weaknesses.push('产品知识需要进一步学习，建议深入学习产品资料');

  if (objectionHandling >= 75) strengths.push('能灵活应对客户异议，处理方式得体');
  else weaknesses.push('异议处理能力需要加强，建议学习常见异议处理话术');

  if (negotiation >= 75) strengths.push('谈判技巧运用得当，能有效推进合作进程');
  else weaknesses.push('谈判策略需要提升，建议多参与实战模拟');

  if (customerRelation >= 75) strengths.push('注重客户关系维护，服务意识强');
  else weaknesses.push('客户关系管理需要加强，建议学习客户维护技巧');

  if (professionalism >= 75) strengths.push('职业素养良好，专业形象突出');
  else weaknesses.push('职业素养需要提升，注意专业形象塑造');

  if (messageCount >= 6) strengths.push('对话积极性高，与客户互动充分');
  if (messageCount < 3) weaknesses.push('对话轮次偏少，应更主动地与客户展开交流');

  if (strengths.length === 0) strengths.push('基本完成陪练对话');
  if (weaknesses.length === 0) weaknesses.push('整体表现良好，继续保持');

  const suggestions = totalScore >= 80
    ? '整体表现优秀，建议在实际销售工作中继续保持良好的沟通风格和专业水准。可以尝试挑战更高难度的情景演练。'
    : totalScore >= 60
      ? '基础能力达标，建议针对薄弱环节进行专项训练。多参与不同场景的陪练，积累更多实战经验。'
      : '需要系统性加强训练。建议先完成相关产品知识和销售技巧课程，再进行陪练实战。';

  return {
    total_score: totalScore,
    dimensions,
    strengths,
    weaknesses,
    suggestions
  };
}

// ==================== 情景管理 REST API ====================

// GET /scenarios - 情景列表，支持分页、difficulty筛选
router.get('/scenarios', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { page = 1, pageSize = 20, difficulty, keyword, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const conditions = [];
    const params = [];

    if (difficulty) {
      conditions.push('ts.difficulty = ?');
      params.push(difficulty);
    }
    if (keyword) {
      conditions.push('(ts.title LIKE ? OR ts.description LIKE ? OR ts.tags LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (status && status !== 'all') {
      conditions.push('ts.status = ?');
      params.push(status);
    } else if (!status) {
      // 默认只返回 active 状态的情景（供前端培训模块使用）
      conditions.push("ts.status = 'active'");
    }
    // status === 'all' 时不添加 status 过滤，返回所有情景

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM training_scenarios ts WHERE ${whereClause}
    `).get(...params).count;

    const scenarios = db.prepare(`
      SELECT ts.*, u.real_name as creator_name
      FROM training_scenarios ts
      LEFT JOIN users u ON ts.created_by = u.id
      WHERE ${whereClause}
      ORDER BY ts.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const list = scenarios.map(s => ({
      ...s,
      tags: s.tags ? (() => { try { return JSON.parse(s.tags); } catch (_) { return []; } })() : []
    }));

    res.json({
      code: 0,
      data: { list, total, page: parseInt(page), pageSize: limit }
    });
  } catch (err) {
    console.error('[training/scenarios] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /scenarios - 创建情景（admin）
router.post('/scenarios', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { title, description, role_type, scenario_prompt, difficulty, tags } = req.body;

    if (!title) {
      return res.status(400).json({ code: 400, message: '情景标题不能为空' });
    }
    if (!role_type) {
      return res.status(400).json({ code: 400, message: '客户角色类型不能为空' });
    }
    if (!scenario_prompt) {
      return res.status(400).json({ code: 400, message: '场景提示词不能为空' });
    }

    const id = uuidv4();
    const parsedTags = tags ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : null;

    db.prepare(`
      INSERT INTO training_scenarios (id, title, description, role_type, scenario_prompt, difficulty, tags, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, title, description || null, role_type, scenario_prompt, difficulty || 'medium', parsedTags, req.user.id);

    logActivity(db, req.user.id, 'create', 'scenario', id, { title, role_type }, req.ip);

    res.json({ code: 0, message: '情景创建成功', data: { id } });
  } catch (err) {
    console.error('[training/scenarios/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// PUT /scenarios/:id - 编辑情景（admin）
router.put('/scenarios/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const fields = ['title', 'description', 'role_type', 'scenario_prompt', 'difficulty', 'tags', 'status'];

    const scenario = db.prepare('SELECT * FROM training_scenarios WHERE id = ?').get(id);
    if (!scenario) {
      return res.status(404).json({ code: 404, message: '情景不存在' });
    }

    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (field === 'tags') {
          updates.push('tags = ?');
          params.push(typeof req.body.tags === 'string' ? req.body.tags : JSON.stringify(req.body.tags));
        } else {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }
    }

    if (updates.length > 0) {
      params.push(id);
      db.prepare(`UPDATE training_scenarios SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    logActivity(db, req.user.id, 'update', 'scenario', id,
      { title: req.body.title || scenario.title, changed_fields: Object.keys(req.body) }, req.ip);

    res.json({ code: 0, message: '情景更新成功' });
  } catch (err) {
    console.error('[training/scenarios/update] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// DELETE /scenarios/:id - 删除情景（admin）
router.delete('/scenarios/:id', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const scenario = db.prepare('SELECT * FROM training_scenarios WHERE id = ?').get(id);
    if (!scenario) {
      return res.status(404).json({ code: 404, message: '情景不存在' });
    }

    // 级联删除关联数据
    const sessions = db.prepare('SELECT id FROM training_sessions WHERE scenario_id = ?').all(id);
    for (const session of sessions) {
      db.prepare('DELETE FROM training_messages WHERE session_id = ?').run(session.id);
      db.prepare('DELETE FROM training_reports WHERE session_id = ?').run(session.id);
    }
    db.prepare('DELETE FROM training_sessions WHERE scenario_id = ?').run(id);
    db.prepare('DELETE FROM training_scenarios WHERE id = ?').run(id);

    logActivity(db, req.user.id, 'delete', 'scenario', id, { title: scenario.title }, req.ip);

    res.json({ code: 0, message: '情景已删除' });
  } catch (err) {
    console.error('[training/scenarios/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== 陪练会话 REST API ====================

// POST /sessions - 开始新的陪练会话
router.post('/sessions', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { scenario_id } = req.body;

    if (!scenario_id) {
      return res.status(400).json({ code: 400, message: '请选择演练情景' });
    }

    const scenario = db.prepare('SELECT * FROM training_scenarios WHERE id = ? AND status = ?')
      .get(scenario_id, 'active');
    if (!scenario) {
      return res.status(404).json({ code: 404, message: '情景不存在或已下架' });
    }

    const sessionId = uuidv4();

    db.prepare(`
      INSERT INTO training_sessions (id, user_id, scenario_id, status)
      VALUES (?, ?, ?, 'ongoing')
    `).run(sessionId, req.user.id, scenario_id);

    // 插入系统提示消息
    db.prepare(`
      INSERT INTO training_messages (id, session_id, role, content)
      VALUES (?, ?, 'system', ?)
    `).run(uuidv4(), sessionId, `[情景] ${scenario.title}: ${scenario.description || ''}`);

    // 插入AI开场白
    db.prepare(`
      INSERT INTO training_messages (id, session_id, role, content)
      VALUES (?, ?, 'ai', ?)
    `).run(uuidv4(), sessionId, `您好！我是${scenario.role_type}。${scenario.scenario_prompt ? scenario.scenario_prompt.split('。')[0] + '。请开始你的演示吧。' : '请开始你的销售演示吧。'}`);

    logActivity(db, req.user.id, 'start_training', 'session', sessionId,
      { scenario_id, scenario_title: scenario.title }, req.ip);

    res.json({
      code: 0,
      message: '陪练会话已开始',
      data: {
        session_id: sessionId,
        scenario: {
          id: scenario.id,
          title: scenario.title,
          description: scenario.description,
          role_type: scenario.role_type,
          difficulty: scenario.difficulty
        }
      }
    });
  } catch (err) {
    console.error('[training/sessions/create] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * 调用AI API生成回复（异步）
 */
function callAIAPI(aiConfig, messages) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const http = require('http');
    const url = require('url');

    const apiUrl = aiConfig.api_base.replace(/\/+$/, '') + '/chat/completions';
    const parsedUrl = url.parse(apiUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const postData = JSON.stringify({
      model: aiConfig.model || 'gpt-4o-mini',
      messages: messages,
      temperature: aiConfig.temperature || 0.8,
      max_tokens: aiConfig.max_tokens || 500
    });

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.api_key}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
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
            reject(new Error('Invalid AI response format'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    aiReq.on('error', (e) => reject(e));
    aiReq.on('timeout', () => { aiReq.destroy(); reject(new Error('AI request timeout')); });
    aiReq.write(postData);
    aiReq.end();
  });
}

// POST /sessions/:id/message - 发送消息（async，支持真实AI API调用）
router.post('/sessions/:id/message', authRequired, async (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ code: 400, message: '消息内容不能为空' });
    }

    const session = db.prepare(`
      SELECT ts.*, tsc.title as scenario_title, tsc.description as scenario_description,
             tsc.role_type, tsc.scenario_prompt, tsc.difficulty
      FROM training_sessions ts
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      WHERE ts.id = ? AND ts.user_id = ?
    `).get(id, req.user.id);

    if (!session) {
      return res.status(404).json({ code: 404, message: '陪练会话不存在' });
    }

    if (session.status !== 'ongoing') {
      return res.status(400).json({ code: 400, message: '该陪练会话已结束' });
    }

    // 1. 保存用户消息
    const userMsgId = uuidv4();
    db.prepare(`
      INSERT INTO training_messages (id, session_id, role, content)
      VALUES (?, ?, 'user', ?)
    `).run(userMsgId, id, content);

    // 2. 获取历史消息构建上下文
    const historyMessages = db.prepare(`
      SELECT role, content FROM training_messages WHERE session_id = ? ORDER BY created_at ASC
    `).all(id);

    // 3. 尝试获取AI配置
    const aiConfig = db.prepare('SELECT * FROM ai_configs WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();

    let aiResponse;
    let usedRealAI = false;

    if (aiConfig && aiConfig.api_key && aiConfig.api_base) {
      // 有AI配置，尝试调用真实API
      try {
        const messages = [
          { role: 'system', content: session.scenario_prompt || `你扮演${session.role_type}角色，场景：${session.scenario_title}。请用中文回应销售代表的对话，扮演一个真实的客户。保持专业但自然的对话风格。` }
        ];

        for (const msg of historyMessages) {
          if (msg.role === 'system') {
            messages.push({ role: 'system', content: msg.content });
          } else if (msg.role === 'user') {
            messages.push({ role: 'user', content: msg.content });
          } else if (msg.role === 'ai') {
            messages.push({ role: 'assistant', content: msg.content });
          }
        }

        aiResponse = await callAIAPI(aiConfig, messages);
        usedRealAI = true;
      } catch (aiErr) {
        console.warn('[training/message] AI API调用失败，使用模拟回复:', aiErr.message);
        const scenarioObj = {
          title: session.scenario_title,
          role_type: session.role_type,
          scenario_prompt: session.scenario_prompt
        };
        aiResponse = simulateCustomerReply(scenarioObj, historyMessages, content);
      }
    } else {
      // 无AI配置，使用模拟回复
      const scenarioObj = {
        title: session.scenario_title,
        role_type: session.role_type,
        scenario_prompt: session.scenario_prompt
      };
      aiResponse = simulateCustomerReply(scenarioObj, historyMessages, content);
    }

    // 4. 保存AI回复
    const aiMsgId = uuidv4();
    db.prepare(`
      INSERT INTO training_messages (id, session_id, role, content)
      VALUES (?, ?, 'ai', ?)
    `).run(aiMsgId, id, aiResponse);

    res.json({
      code: 0,
      data: {
        user_message: { id: userMsgId, role: 'user', content },
        ai_message: { id: aiMsgId, role: 'ai', content: aiResponse },
        used_ai_api: usedRealAI
      }
    });
  } catch (err) {
    console.error('[training/sessions/message] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /sessions/:id/messages - 获取会话所有消息
router.get('/sessions/:id/messages', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const session = db.prepare(`
      SELECT ts.*, tsc.title as scenario_title, tsc.role_type
      FROM training_sessions ts
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      WHERE ts.id = ? AND ts.user_id = ?
    `).get(id, req.user.id);

    if (!session) {
      return res.status(404).json({ code: 404, message: '陪练会话不存在' });
    }

    const messages = db.prepare(`
      SELECT * FROM training_messages WHERE session_id = ? ORDER BY created_at ASC
    `).all(id);

    res.json({
      code: 0,
      data: {
        session: {
          id: session.id,
          scenario_title: session.scenario_title,
          role_type: session.role_type,
          status: session.status,
          started_at: session.started_at,
          ended_at: session.ended_at
        },
        messages
      }
    });
  } catch (err) {
    console.error('[training/sessions/messages] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /sessions - 我的会话列表（分页）
router.get('/sessions', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { page = 1, pageSize = 20, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const conditions = ['ts.user_id = ?'];
    const params = [req.user.id];

    if (status) {
      conditions.push('ts.status = ?');
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM training_sessions ts WHERE ${whereClause}
    `).get(...params).count;

    const sessions = db.prepare(`
      SELECT ts.*, tsc.title as scenario_title, tsc.role_type, tsc.difficulty,
             (SELECT COUNT(*) FROM training_messages WHERE session_id = ts.id AND role = 'user') as message_count,
             (SELECT tr.total_score FROM training_reports tr WHERE tr.session_id = ts.id) as report_score
      FROM training_sessions ts
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      WHERE ${whereClause}
      ORDER BY ts.started_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      code: 0,
      data: { list: sessions, total, page: parseInt(page), pageSize: limit }
    });
  } catch (err) {
    console.error('[training/sessions] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// POST /sessions/:id/end - 结束会话并生成评估报告
router.post('/sessions/:id/end', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const session = db.prepare(`
      SELECT ts.*, tsc.title as scenario_title, tsc.role_type, tsc.scenario_prompt, tsc.difficulty
      FROM training_sessions ts
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      WHERE ts.id = ? AND ts.user_id = ?
    `).get(id, req.user.id);

    if (!session) {
      return res.status(404).json({ code: 404, message: '陪练会话不存在' });
    }

    if (session.status !== 'ongoing') {
      return res.status(400).json({ code: 400, message: '该陪练会话已结束' });
    }

    // 获取所有消息
    const messages = db.prepare(`
      SELECT role, content FROM training_messages WHERE session_id = ? ORDER BY created_at ASC
    `).all(id);

    // 尝试获取AI配置来判断是否能调用真实AI
    const aiConfig = db.prepare('SELECT * FROM ai_configs WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
    const hasAI = aiConfig && aiConfig.api_key && aiConfig.api_base;

    // 生成评估报告（目前使用模拟评分，后续可接入AI）
    const scenarioObj = {
      title: session.scenario_title,
      role_type: session.role_type,
      scenario_prompt: session.scenario_prompt
    };
    const evaluation = generateEvaluationReport(scenarioObj, messages);

    // 写入 training_reports 表
    const reportId = uuidv4();
    db.prepare(`
      INSERT INTO training_reports (id, session_id, user_id, total_score, dimensions, strengths, weaknesses, suggestions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reportId,
      id,
      req.user.id,
      evaluation.total_score,
      JSON.stringify(evaluation.dimensions),
      JSON.stringify(evaluation.strengths),
      JSON.stringify(evaluation.weaknesses),
      evaluation.suggestions
    );

    // 更新会话状态
    db.prepare(`
      UPDATE training_sessions
      SET status = 'completed', ended_at = datetime('now','localtime')
      WHERE id = ?
    `).run(id);

    // 插入系统评估消息
    const dimSummary = evaluation.dimensions.map(d => `${d.name}: ${d.score}分`).join('；');
    db.prepare(`
      INSERT INTO training_messages (id, session_id, role, content)
      VALUES (?, ?, 'system', ?)
    `).run(uuidv4(), id,
      `[演练评估] 综合得分: ${evaluation.total_score}分\n各项评分: ${dimSummary}\n\n优势: ${evaluation.strengths.join('；')}\n待改进: ${evaluation.weaknesses.join('；')}\n\n建议: ${evaluation.suggestions}`
    );

    // 发放积分奖励
    const earnedPoints = Math.max(5, Math.floor(evaluation.total_score / 10));
    db.prepare(`
      INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), req.user.id, earnedPoints, `完成陪练: ${session.scenario_title}`, 'training', id);
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(earnedPoints, req.user.id);

    logActivity(db, req.user.id, 'end_training', 'session', id,
      { scenario_title: session.scenario_title, score: evaluation.total_score, used_ai: hasAI }, req.ip);

    res.json({
      code: 0,
      message: '陪练会话已结束',
      data: {
        report_id: reportId,
        total_score: evaluation.total_score,
        dimensions: evaluation.dimensions,
        strengths: evaluation.strengths,
        weaknesses: evaluation.weaknesses,
        suggestions: evaluation.suggestions,
        earned_points: earnedPoints
      }
    });
  } catch (err) {
    console.error('[training/sessions/end] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /sessions/:id/report - 查看评估报告
router.get('/sessions/:id/report', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const session = db.prepare(`
      SELECT ts.*, tsc.title as scenario_title, tsc.role_type, tsc.difficulty
      FROM training_sessions ts
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      WHERE ts.id = ? AND ts.user_id = ?
    `).get(id, req.user.id);

    if (!session) {
      return res.status(404).json({ code: 404, message: '陪练会话不存在' });
    }

    const report = db.prepare(`
      SELECT * FROM training_reports WHERE session_id = ?
    `).get(id);

    if (!report) {
      return res.status(404).json({ code: 404, message: '暂无评估报告，请先结束会话' });
    }

    res.json({
      code: 0,
      data: {
        session: {
          id: session.id,
          scenario_title: session.scenario_title,
          role_type: session.role_type,
          difficulty: session.difficulty,
          status: session.status,
          started_at: session.started_at,
          ended_at: session.ended_at
        },
        report: {
          id: report.id,
          total_score: report.total_score,
          dimensions: (() => { try { return JSON.parse(report.dimensions || '[]'); } catch (_) { return []; } })(),
          strengths: (() => { try { return JSON.parse(report.strengths || '[]'); } catch (_) { return []; } })(),
          weaknesses: (() => { try { return JSON.parse(report.weaknesses || '[]'); } catch (_) { return []; } })(),
          suggestions: report.suggestions,
          created_at: report.created_at
        }
      }
    });
  } catch (err) {
    console.error('[training/sessions/report] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /reports - 我的评估报告列表
router.get('/reports', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM training_reports WHERE user_id = ?
    `).get(req.user.id).count;

    const reports = db.prepare(`
      SELECT tr.*, tsc.title as scenario_title, tsc.role_type, tsc.difficulty,
             ts.status as session_status, ts.started_at, ts.ended_at,
             (SELECT COUNT(*) FROM training_messages WHERE session_id = tr.session_id AND role = 'user') as message_count
      FROM training_reports tr
      JOIN training_sessions ts ON tr.session_id = ts.id
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      WHERE tr.user_id = ?
      ORDER BY tr.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    const list = reports.map(r => ({
      id: r.id,
      session_id: r.session_id,
      scenario_title: r.scenario_title,
      role_type: r.role_type,
      difficulty: r.difficulty,
      total_score: r.total_score,
      dimensions: (() => { try { return JSON.parse(r.dimensions || '[]'); } catch (_) { return []; } })(),
      strengths: (() => { try { return JSON.parse(r.strengths || '[]'); } catch (_) { return []; } })(),
      weaknesses: (() => { try { return JSON.parse(r.weaknesses || '[]'); } catch (_) { return []; } })(),
      suggestions: r.suggestions,
      message_count: r.message_count,
      session_status: r.session_status,
      started_at: r.started_at,
      ended_at: r.ended_at,
      created_at: r.created_at
    }));

    res.json({
      code: 0,
      data: { list, total, page: parseInt(page), pageSize: limit }
    });
  } catch (err) {
    console.error('[training/reports] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
