/**
 * FU利陪陪角色扮演路由
 * 表: training_scenarios, training_sessions, training_messages, training_reports, ai_configs, activity_logs, users, point_logs
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authRequired, adminRequired, getOrgUserScope } = require('../middleware/auth');
const { applyLevelBonus } = require('../utils/points');
const { callAIStreamWithFallback, callAIWithFallback, getAIConfigCandidates } = require('./ai');

// 正在后台生成评估报告的会话（防止重复触发；单进程内存标记即可）
const generatingSessions = new Set();

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
 * AI生成评估报告（调用AI模型对对话进行智能评分）
 */
// 五维度权重（异议处理权重最高，是防刷核心）
const DIMENSION_WEIGHTS = {
  '需求挖掘': 0.20,
  '价值锚定': 0.20,
  '异议处理': 0.25,
  '促成推力': 0.20,
  '关系维系': 0.15,
};

async function generateAIEvaluation(aiConfigs, scenario, messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const aiMessages = messages.filter(m => m.role === 'ai');

  // 构建对话文本
  const dialogueText = messages
    .filter(m => m.role === 'user' || m.role === 'ai')
    .map(m => m.role === 'user' ? `销售代表: ${m.content}` : `客户: ${m.content}`)
    .join('\n');

  const evalPrompt = `你是一位资深的销售培训导师，请根据以下FU利陪陪对话记录对销售代表的表现进行专业评估。

【场景信息】
场景标题：${scenario.title}
扮演角色：${scenario.role_type}
场景描述：${scenario.scenario_prompt || '无'}
卖进目标：${scenario.sales_goal || '未设置'}

【对话记录】
${dialogueText}

【评估要求】
请从以下5个维度进行评分（各维度0-100分），并给出具体评语。各维度权重不同，权重越高对总分影响越大：

1. 需求挖掘（权重20%）
   核心规则：识别客户真实情况、抓取对话关键信息（库存、顾虑、诉求），主动挖掘门店痛点，可复述客户表达的信息。
   扣分条件：无视客户原话、不抓取客户业务信息、单向强行输出、不倾听，直接大幅扣分。

2. 价值锚定（权重20%）
   核心规则：结合南孚产品、政策，将方案和门店收益绑定（毛利、周转、降损耗、增收），传递客户可感知价值，不只讲产品参数。
   扣分条件：只有空泛套话、单纯推产品、不关联门店收益，本项无法拿到高分。

3. 异议处理（权重25%，最高权重）
   核心规则：直面客户顾虑，拆解疑问，输出可落地业务方案（补单数量、促销方案、调价收益、风险对策），不回避、不转移话题。
   扣分条件：客户提出异议后连续两轮回避或转移话题，本项低分；仅口头安抚、无实际解决方案直接降档。

4. 促成推力（权重20%）
   核心规则：循序渐进推进业务目标，给出清晰下一步落地动作，合理引导业务闭环；禁止强行逼单、仓促收尾。
   扣分条件：过早报价、强行逼单、跳过对话快速结束演练刷分，本项重扣。

5. 关系维系（权重15%）
   核心规则：共情店主，尊重门店现状，维护长期客情；沟通语气专业自然，避免生硬说教，减少模板话术。
   扣分条件：单场演练重复大段固定模板话术、沟通态度强势，扣减本项分数。

${scenario.sales_goal ? `【卖进目标达成度】
本次卖进目标为「${scenario.sales_goal}」，请评估销售代表是否达成了该目标，并在建议中说明达成情况。` : ''}

请严格按照以下JSON格式返回（不要包含其他文字）：
{
  "dimensions": [
    {"name": "需求挖掘", "score": 数字, "comment": "具体评语"},
    {"name": "价值锚定", "score": 数字, "comment": "具体评语"},
    {"name": "异议处理", "score": 数字, "comment": "具体评语"},
    {"name": "促成推力", "score": 数字, "comment": "具体评语"},
    {"name": "关系维系", "score": 数字, "comment": "具体评语"}
  ],
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["不足1", "不足2"],
  "suggestions": "改进建议${scenario.sales_goal ? '（包含卖进目标达成情况）' : ''}"
}

评分标准：90+优秀，75-89良好，60-74合格，60以下需提升。评分应基于对话实际内容，客观公正。${scenario.sales_goal ? '如果销售代表未能达成卖进目标，应在总分和促成推力、异议处理两个维度中体现。' : ''}`;

  const apiMessages = [
    { role: 'system', content: '你是一位专业的销售培训评估专家。请严格按照要求的JSON格式输出评估结果，不要包含markdown标记或其他多余文字。' },
    { role: 'user', content: evalPrompt }
  ];

  const response = await callAIWithFallback(aiConfigs, apiMessages);

  // 解析AI返回的JSON
  let cleaned = response.trim();
  // 移除可能的markdown代码块标记
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  const result = JSON.parse(cleaned);

  // 验证并规范化数据
  if (!result.dimensions || !Array.isArray(result.dimensions)) {
    throw new Error('AI返回格式错误：缺少dimensions');
  }

  // 确保分数是数字且在0-100范围
  result.dimensions = result.dimensions.map(d => ({
    name: d.name,
    score: Math.max(0, Math.min(100, Math.round(Number(d.score) || 0))),
    comment: d.comment || ''
  }));

  // 计算总分：按五维度权重加权（异议处理权重最高，权重缺失时降级为算术平均）
  let weightedSum = 0;
  let weightTotal = 0;
  result.dimensions.forEach((d) => {
    const w = DIMENSION_WEIGHTS[d.name];
    if (w) {
      weightedSum += d.score * w;
      weightTotal += w;
    }
  });
  result.total_score = weightTotal > 0
    ? Math.round(weightedSum / weightTotal)
    : Math.round(result.dimensions.reduce((sum, d) => sum + d.score, 0) / result.dimensions.length);

  // 确保其他字段
  result.strengths = Array.isArray(result.strengths) ? result.strengths : [];
  result.weaknesses = Array.isArray(result.weaknesses) ? result.weaknesses : [];
  if (result.strengths.length === 0) result.strengths.push('完成FU利陪陪对话');
  if (result.weaknesses.length === 0) result.weaknesses.push('整体表现有待提升');
  if (!result.suggestions) result.suggestions = '建议继续加强销售技能训练。';

  return result;
}

/**
 * 模拟生成评估报告（无AI API时的降级方案）
 */
function generateEvaluationReport(scenario, messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const messageCount = userMessages.length;
  const allText = userMessages.map(m => m.content.toLowerCase()).join(' ');

  // 五维度评分（模拟评分逻辑，与AI评分维度保持一致）
  // 需求挖掘：是否主动了解客户情况、抓取门店信息
  let needsDiscovery = 55;
  if (allText.includes('库存') || allText.includes('进货') || allText.includes('销量')) needsDiscovery += 10;
  if (allText.includes('了解') || allText.includes('请问') || allText.includes('情况')) needsDiscovery += 8;
  if (allText.includes('咱们') || allText.includes('您这边')) needsDiscovery += 5;
  if (messageCount >= 5) needsDiscovery += 10;
  needsDiscovery = Math.min(100, needsDiscovery);

  // 价值锚定：是否把方案与门店收益绑定
  let valueAnchoring = 55;
  if (allText.includes('毛利') || allText.includes('利润') || allText.includes('周转')) valueAnchoring += 12;
  if (allText.includes('收益') || allText.includes('增收') || allText.includes('动销')) valueAnchoring += 10;
  if (allText.includes('损耗') || allText.includes('售后') || allText.includes('漏液')) valueAnchoring += 8;
  if (allText.includes('品质') || allText.includes('质量') || allText.includes('电池')) valueAnchoring += 5;
  valueAnchoring = Math.min(100, valueAnchoring);

  // 异议处理：直面顾虑并给出可落地方案
  let objectionHandling = 50;
  if (allText.includes('理解') || allText.includes('明白')) objectionHandling += 8;
  if (allText.includes('方案') || allText.includes('建议')) objectionHandling += 8;
  if (allText.includes('补单') || allText.includes('促销') || allText.includes('试销')) objectionHandling += 10;
  if (allText.includes('风险') || allText.includes('保障') || allText.includes('不好卖')) objectionHandling += 7;
  if (messageCount >= 5) objectionHandling += 10;
  objectionHandling = Math.min(100, objectionHandling);

  // 促成推力：推进业务目标、给出清晰下一步
  let closingPush = 50;
  if (allText.includes('下一步') || allText.includes('先')) closingPush += 8;
  if (allText.includes('活动') || allText.includes('政策') || allText.includes('优惠')) closingPush += 8;
  if (allText.includes('合作') || allText.includes('长期')) closingPush += 7;
  if (allText.includes('试试') || allText.includes('一板') || allText.includes('一箱')) closingPush += 8;
  if (messageCount >= 6) closingPush += 10;
  closingPush = Math.min(100, closingPush);

  // 关系维系：共情店主、维护长期客情
  let relationship = 55;
  if (allText.includes('谢谢') || allText.includes('感谢')) relationship += 8;
  if (allText.includes('咱') || allText.includes('门店')) relationship += 5;
  if (allText.includes('长期') || allText.includes('一直') || allText.includes('老客户')) relationship += 8;
  if (allText.includes('服务') || allText.includes('支持')) relationship += 5;
  if (messageCount >= 5) relationship += 10;
  relationship = Math.min(100, relationship);

  const dimensions = [
    { name: '需求挖掘', score: needsDiscovery, comment: needsDiscovery >= 80 ? '主动了解门店情况，能抓取客户真实诉求' : needsDiscovery >= 60 ? '有一定的需求挖掘意识，可再深入一些' : '需求挖掘不足，建议多询问库存与经营情况' },
    { name: '价值锚定', score: valueAnchoring, comment: valueAnchoring >= 80 ? '能把方案与门店收益挂钩，价值传递到位' : valueAnchoring >= 60 ? '价值传递较好，可更多关联门店收益' : '价值锚定偏弱，建议多讲毛利、周转等门店收益' },
    { name: '异议处理', score: objectionHandling, comment: objectionHandling >= 80 ? '能直面客户顾虑并给出可落地方案' : objectionHandling >= 60 ? '异议处理良好，可加强方案的具体性' : '异议处理需加强，避免回避或只做口头安抚' },
    { name: '促成推力', score: closingPush, comment: closingPush >= 80 ? '推进节奏得当，有明确的下一步动作' : closingPush >= 60 ? '推进能力良好，可更明确落地动作' : '促成推力不足，建议明确下一步动作' },
    { name: '关系维系', score: relationship, comment: relationship >= 80 ? '共情店主，客情维护意识好' : relationship >= 60 ? '沟通态度良好，可更多共情客户' : '关系维系偏弱，注意语气与长期客情' }
  ];

  // 加权总分（与AI评分口径一致）
  let weightedSum = 0;
  let weightTotal = 0;
  dimensions.forEach((d) => {
    const w = DIMENSION_WEIGHTS[d.name];
    if (w) {
      weightedSum += d.score * w;
      weightTotal += w;
    }
  });
  const totalScore = weightTotal > 0
    ? Math.round(weightedSum / weightTotal)
    : Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);

  // 生成优缺点和建议
  const strengths = [];
  const weaknesses = [];

  if (needsDiscovery >= 75) strengths.push('主动了解门店情况，能抓取客户真实诉求');
  else weaknesses.push('需求挖掘不足，建议多询问客户库存与经营情况');

  if (valueAnchoring >= 75) strengths.push('能把方案与门店收益挂钩，价值传递到位');
  else weaknesses.push('价值锚定偏弱，建议多讲毛利、周转等门店收益');

  if (objectionHandling >= 75) strengths.push('能直面客户顾虑并给出可落地方案');
  else weaknesses.push('异议处理需要加强，建议准备具体的解决方案');

  if (closingPush >= 75) strengths.push('推进节奏得当，有明确的下一步动作');
  else weaknesses.push('促成推力不足，建议给出清晰的下一步动作');

  if (relationship >= 75) strengths.push('共情店主，客情维护意识好');
  else weaknesses.push('关系维系偏弱，注意沟通语气与长期客情');

  if (messageCount >= 6) strengths.push('对话积极性高，与客户互动充分');
  if (messageCount < 3) weaknesses.push('对话轮次偏少，应更主动地与客户展开交流');

  if (strengths.length === 0) strengths.push('基本完成FU利陪陪对话');
  if (weaknesses.length === 0) weaknesses.push('整体表现良好，继续保持');

  const suggestions = totalScore >= 80
    ? '整体表现优秀，建议在实际销售工作中继续保持良好的沟通风格和专业水准。可以尝试挑战更高难度的情景演练。'
    : totalScore >= 60
      ? '基础能力达标，建议针对薄弱环节进行专项训练。多参与不同场景的FU利陪陪，积累更多实战经验。'
      : '需要系统性加强训练。建议先完成相关产品知识和销售技巧课程，再进行FU利陪陪实战。';

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
    const { title, description, role_type, scenario_prompt, sales_goal, difficulty, tags, link_url } = req.body;

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
      INSERT INTO training_scenarios (id, title, description, role_type, scenario_prompt, sales_goal, difficulty, tags, link_url, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, title, description || null, role_type, scenario_prompt, sales_goal || null, difficulty || 'medium', parsedTags, link_url || null, req.user.id);

    logActivity(db, req.user.id, 'create', 'scenario', id, JSON.stringify({ title, role_type }));

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
    const fields = ['title', 'description', 'role_type', 'scenario_prompt', 'sales_goal', 'difficulty', 'tags', 'link_url', 'status'];

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
      JSON.stringify({ title: req.body.title || scenario.title, changed_fields: Object.keys(req.body) }), req.ip);

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

    logActivity(db, req.user.id, 'delete', 'scenario', id, JSON.stringify({ title: scenario.title }));

    res.json({ code: 0, message: '情景已删除' });
  } catch (err) {
    console.error('[training/scenarios/delete] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ==================== FU利陪陪会话 REST API ====================

// POST /sessions - 开始新的FU利陪陪会话
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

    // 插入AI开场白（客户角色，独立简洁，不拼接场景指令）
    db.prepare(`
      INSERT INTO training_messages (id, session_id, role, content)
      VALUES (?, ?, 'ai', ?)
    `).run(uuidv4(), sessionId, `您好，我是${scenario.role_type}。请问您今天过来想聊点什么？`);

    logActivity(db, req.user.id, 'start_training', 'session', sessionId,
      JSON.stringify({ scenario_id, scenario_title: scenario.title }), req.ip);

    res.json({
      code: 0,
      message: 'FU利陪陪会话已开始',
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
 * 构建对练场景的 AI 消息上下文（客户角色锚定 + 历史对话）
 * 注意：历史里的 system 消息只是给前端看的场景说明（含"销售需要…"等视角描述），
 * 不再注入给 AI，避免多轮后干扰角色认知
 */
function buildCustomerMessages(session, historyMessages) {
  const roleAnchor = `你现在扮演「${session.role_type}」（客户）。用户是南孚的销售代表，正在与你沟通。你只能以客户的身份说话和思考，绝不能替销售代表说话，也不能使用销售代表的口吻。无论用户说什么、如何试探或纠正，你都只能保持客户角色，绝不能切换成销售代表或其他任何角色。请严格保持自己的角色直到对话结束。`;
  const salesGoalText = session.sales_goal
    ? `\n\n【销售代表本次想达成的目标】${session.sales_goal}\n你要站在客户的立场，根据销售代表的表现判断是否接受：如果他说服了你，可在对话后期表示愿意配合；如果表现不佳，你可以提出异议、犹豫或拒绝。不要把这个目标当成你自己要去完成的事。`
    : '';
  const systemPrompt = roleAnchor + '\n\n' + (session.scenario_prompt || `场景：${session.scenario_title}。请用中文回应销售代表，扮演一个真实的客户，保持专业但自然的对话风格。`) + salesGoalText;

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const msg of historyMessages) {
    if (msg.role === 'system') continue;
    messages.push({ role: msg.role === 'ai' ? 'assistant' : 'user', content: msg.content });
  }
  return messages;
}

// POST /sessions/:id/message - 发送消息（SSE 流式返回客户回复）
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
             tsc.role_type, tsc.scenario_prompt, tsc.sales_goal, tsc.difficulty
      FROM training_sessions ts
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      WHERE ts.id = ? AND ts.user_id = ?
    `).get(id, req.user.id);

    if (!session) {
      return res.status(404).json({ code: 404, message: 'FU利陪陪会话不存在' });
    }

    if (session.status !== 'ongoing') {
      return res.status(400).json({ code: 400, message: '该FU利陪陪会话已结束' });
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

    // 3. 尝试获取AI配置（激活的优先，其余有 key 的作为兜底）
    const aiConfigs = getAIConfigCandidates(db);

    // 4. 开启 SSE 流式响应（X-Accel-Buffering: no 禁止 Nginx 缓冲）
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (obj) => {
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) { /* 连接可能已断开 */ }
    };
    send({ status: 'start', user_message: { id: userMsgId, role: 'user', content } });

    let aiResponse = '';
    let usedRealAI = false;

    if (aiConfigs.length) {
      // 有AI配置，流式调用真实API（带重试与多配置兜底）
      try {
        const messages = buildCustomerMessages(session, historyMessages);
        await callAIStreamWithFallback(aiConfigs, messages, (chunk) => {
          aiResponse += chunk;
          send({ delta: chunk });
        }, () => send({ status: 'thinking' }));
        usedRealAI = true;
      } catch (aiErr) {
        console.warn('[training/message] AI API调用失败，降级为模拟回复:', aiErr.message);
      }
    }

    // AI 调用失败或未配置时，降级为模拟回复（一次性发送）
    if (!aiResponse.trim()) {
      const scenarioObj = {
        title: session.scenario_title,
        role_type: session.role_type,
        scenario_prompt: session.scenario_prompt
      };
      aiResponse = simulateCustomerReply(scenarioObj, historyMessages, content);
      usedRealAI = false;
      send({ delta: aiResponse });
    }

    // 5. 保存AI回复
    const aiMsgId = uuidv4();
    db.prepare(`
      INSERT INTO training_messages (id, session_id, role, content)
      VALUES (?, ?, 'ai', ?)
    `).run(aiMsgId, id, aiResponse);

    send({ done: true, used_ai_api: usedRealAI, ai_message: { id: aiMsgId, role: 'ai', content: aiResponse } });
    res.end();
  } catch (err) {
    console.error('[training/sessions/message] Error:', err);
    if (res.headersSent) {
      try {
        res.write(`data: ${JSON.stringify({ error: '服务器内部错误' })}\n\n`);
        res.end();
      } catch (_) { /* 连接已断开 */ }
    } else {
      res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
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
      return res.status(404).json({ code: 404, message: 'FU利陪陪会话不存在' });
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
// 后台生成评估报告（不阻塞 HTTP 响应，避免微信 30 秒超时）
async function generateReportInBackground(db, sessionId, userId, session) {
  try {
    const messages = db.prepare(`
      SELECT role, content FROM training_messages WHERE session_id = ? ORDER BY created_at ASC
    `).all(sessionId);

    const aiConfigs = getAIConfigCandidates(db);
    const hasAI = aiConfigs.length > 0;

    const scenarioObj = {
      title: session.scenario_title,
      role_type: session.role_type,
      scenario_prompt: session.scenario_prompt,
      sales_goal: session.sales_goal
    };

    let evaluation;
    if (hasAI) {
      try {
        console.log('[training/end] 使用AI模型生成评估报告');
        evaluation = await generateAIEvaluation(aiConfigs, scenarioObj, messages);
      } catch (aiErr) {
        console.warn('[training/end] AI评估失败，降级为关键词评分:', aiErr.message);
        evaluation = generateEvaluationReport(scenarioObj, messages);
      }
    } else {
      console.log('[training/end] 无AI配置，使用关键词评分');
      evaluation = generateEvaluationReport(scenarioObj, messages);
    }

    // 幂等：已存在报告则不再重复写入/发积分
    const existingReport = db.prepare('SELECT id FROM training_reports WHERE session_id = ?').get(sessionId);
    if (existingReport) return;

    // ===== 计分校验（三把锁）：任一条不满足则照常出报告，但不发积分 =====
    const MIN_ROUNDS = 4;          // 有效演练至少 4 轮对话（一轮 = 学员发一条）
    const MIN_SECONDS = 60;        // 单次时长不足 60 秒不计分
    // 每日次数 / 每日积分上限均可在后台「积分规则」配置（0 表示不限制）
    const DEFAULT_DAILY_MAX_TIMES = 10;
    const DEFAULT_DAILY_POINT_LIMIT = 150;
    const trainingRule = db.prepare(
      "SELECT daily_limit, daily_max_times FROM point_rules WHERE source_type = 'training_complete'"
    ).get();
    const DAILY_MAX_TIMES = trainingRule && Number(trainingRule.daily_max_times) > 0
      ? Number(trainingRule.daily_max_times)
      : DEFAULT_DAILY_MAX_TIMES;
    const DAILY_POINT_LIMIT = trainingRule && Number(trainingRule.daily_limit) > 0
      ? Number(trainingRule.daily_limit)
      : DEFAULT_DAILY_POINT_LIMIT;

    const roundRow = db.prepare(
      "SELECT COUNT(*) AS rounds FROM training_messages WHERE session_id = ? AND role = 'user'"
    ).get(sessionId);
    const rounds = roundRow ? Number(roundRow.rounds) : 0;

    // started_at 存的是本地时间字符串，用 JS 按本地时区解析后算时长，避免 SQLite 时区偏移
    const sessionRow = db.prepare('SELECT started_at FROM training_sessions WHERE id = ?').get(sessionId);
    const startedAtMs = sessionRow && sessionRow.started_at
      ? new Date(String(sessionRow.started_at).replace(' ', 'T')).getTime()
      : 0;
    const durationSec = startedAtMs ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : 0;

    const todayRow = db.prepare(
      `SELECT COUNT(*) AS times, COALESCE(SUM(points), 0) AS total
       FROM point_logs
       WHERE user_id = ? AND source_type = 'training' AND date(created_at) = date('now','localtime')`
    ).get(userId);
    const dailyTimes = todayRow ? Number(todayRow.times) : 0;
    const dailyEarned = todayRow ? Number(todayRow.total) : 0;

    let skipReason = '';
    if (rounds < MIN_ROUNDS) {
      skipReason = `有效对话不足 ${MIN_ROUNDS} 轮（本次 ${rounds} 轮），本次不计分`;
    } else if (durationSec < MIN_SECONDS) {
      skipReason = `演练时长不足 ${MIN_SECONDS} 秒（本次 ${durationSec} 秒），本次不计分`;
    } else if (dailyTimes >= DAILY_MAX_TIMES) {
      skipReason = `今日计分次数已达上限（${DAILY_MAX_TIMES} 次），本次不计分`;
    } else if (dailyEarned >= DAILY_POINT_LIMIT) {
      skipReason = `今日FU利陪陪积分已达上限（${DAILY_POINT_LIMIT} 分），本次不计分`;
    }

    let pointsAwarded = 0;
    if (!skipReason) {
      const alreadyAwarded = db.prepare(
        `SELECT id FROM point_logs WHERE user_id = ? AND source_type = 'training' AND source_id = ?`
      ).get(userId, sessionId);
      if (!alreadyAwarded) {
        const rule = db.prepare(
          `SELECT points FROM point_rules WHERE source_type = 'training_complete' AND enabled = 1`
        ).get();
        const maxPoints = rule ? rule.points : 10;
        const rawPoints = Math.max(1, Math.floor(maxPoints * evaluation.total_score / 100));
        // 等级加成后再受每日上限约束
        const base = Math.max(0, Math.min(rawPoints, DAILY_POINT_LIMIT - dailyEarned));
        const { awarded: boosted } = applyLevelBonus(db, userId, base);
        pointsAwarded = Math.max(0, Math.min(boosted, DAILY_POINT_LIMIT - dailyEarned));
      }
    }

    const reportId = uuidv4();
    db.prepare(`
      INSERT INTO training_reports (id, session_id, user_id, total_score, dimensions, strengths, weaknesses, suggestions, points_awarded, point_skip_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reportId,
      sessionId,
      userId,
      evaluation.total_score,
      JSON.stringify(evaluation.dimensions),
      JSON.stringify(evaluation.strengths),
      JSON.stringify(evaluation.weaknesses),
      evaluation.suggestions,
      pointsAwarded,
      skipReason || null
    );

    // 写入积分流水并累加用户积分
    if (pointsAwarded > 0) {
      db.prepare(`
        INSERT INTO point_logs (id, user_id, points, reason, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), userId, pointsAwarded, `完成FU利陪陪: ${session.scenario_title} (得分${evaluation.total_score})`, 'training', sessionId);
      db.prepare('UPDATE users SET points = points + ?, total_earned_points = total_earned_points + ? WHERE id = ?').run(pointsAwarded, pointsAwarded, userId);
    }

    db.prepare(`
      UPDATE training_sessions
      SET status = 'completed', ended_at = datetime('now','localtime')
      WHERE id = ?
    `).run(sessionId);

    const dimSummary = evaluation.dimensions.map(d => `${d.name}: ${d.score}分`).join('；');
    const pointSummary = pointsAwarded > 0
      ? `\n\n本次得分: 获得 ${pointsAwarded} 积分`
      : `\n\n本次得分: 未获得积分（${skipReason}）`;
    db.prepare(`
      INSERT INTO training_messages (id, session_id, role, content)
      VALUES (?, ?, 'system', ?)
    `).run(uuidv4(), sessionId,
      `[演练评估] 综合得分: ${evaluation.total_score}分\n各项评分: ${dimSummary}${pointSummary}\n\n优势: ${evaluation.strengths.join('；')}\n待改进: ${evaluation.weaknesses.join('；')}\n\n建议: ${evaluation.suggestions}`
    );

    logActivity(db, userId, 'end_training', 'session', sessionId,
      JSON.stringify({ scenario_title: session.scenario_title, score: evaluation.total_score, used_ai: hasAI }));

    console.log('[training/end] 评估报告已生成:', sessionId);
  } catch (err) {
    console.error('[training/end] 后台生成评估报告失败:', err);
  } finally {
    generatingSessions.delete(sessionId);
  }
}

// POST /sessions/:id/end - 结束会话（立即返回，报告后台生成，避免长时间等待导致客户端超时）
router.post('/sessions/:id/end', authRequired, (req, res) => {
  try {
    const db = req.db;
    const { id } = req.params;

    const session = db.prepare(`
      SELECT ts.*, tsc.title as scenario_title, tsc.role_type, tsc.scenario_prompt, tsc.sales_goal, tsc.difficulty
      FROM training_sessions ts
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      WHERE ts.id = ? AND ts.user_id = ?
    `).get(id, req.user.id);

    if (!session) {
      return res.status(404).json({ code: 404, message: 'FU利陪陪会话不存在' });
    }

    // 已在后台生成中 → 直接返回生成中状态，避免重复触发
    if (generatingSessions.has(id)) {
      return res.json({ code: 0, message: '报告生成中', data: { status: 'generating' } });
    }

    if (session.status !== 'ongoing') {
      return res.status(400).json({ code: 400, message: '该FU利陪陪会话已结束' });
    }

    // 标记生成中并立即响应，报告在后台异步生成
    generatingSessions.add(id);
    res.json({ code: 0, message: '报告生成中', data: { status: 'generating' } });

    generateReportInBackground(db, id, req.user.id, session);
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
      return res.status(404).json({ code: 404, message: 'FU利陪陪会话不存在' });
    }

    const report = db.prepare(`
      SELECT * FROM training_reports WHERE session_id = ?
    `).get(id);

    if (!report) {
      // 会话仍在进行或报告正在后台生成 → 返回生成中状态，供前端轮询
      if (session.status === 'ongoing' || generatingSessions.has(id)) {
        return res.json({
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
            report: null,
            status: 'generating'
          }
        });
      }
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

// ==================== 管理员 API ====================

// GET /training/admin/sessions - 查看所有用户的FU利陪陪会话
router.get('/admin/sessions', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const { user_id, status, scenario_id, date_from, date_to } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;
    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const scope = getOrgUserScope(db, actor, 'u');
    const conditions = [scope.clause];
    const params = [...scope.params];
    if (status) { conditions.push('ts.status = ?'); params.push(status); }
    if (user_id) { conditions.push('ts.user_id = ?'); params.push(user_id); }
    if (scenario_id) { conditions.push('ts.scenario_id = ?'); params.push(scenario_id); }
    if (date_from) { conditions.push('DATE(ts.started_at) >= ?'); params.push(date_from); }
    if (date_to) { conditions.push('DATE(ts.started_at) <= ?'); params.push(date_to); }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const total = db.prepare(`
      SELECT COUNT(*) as total
      FROM training_sessions ts
      LEFT JOIN users u ON ts.user_id = u.id
      ${whereClause}
    `).get(...params).total;

    const sessions = db.prepare(`
      SELECT ts.*, u.username, u.real_name,
             tsc.title as scenario_title, tsc.role_type, tsc.difficulty,
             tr.total_score as report_score,
             pl.points as earned_points
      FROM training_sessions ts
      LEFT JOIN users u ON ts.user_id = u.id
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      LEFT JOIN training_reports tr ON tr.session_id = ts.id
      LEFT JOIN point_logs pl ON pl.user_id = ts.user_id AND pl.source_type = 'training' AND pl.source_id = ts.id
      ${whereClause}
      ORDER BY ts.started_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);

    res.json({ code: 0, data: { list: sessions, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) {
    console.error('[training/admin/sessions] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /training/admin/sessions/:id/messages - 管理员查看会话消息
router.get('/admin/sessions/:id/messages', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const session = db.prepare(`
      SELECT ts.*, tsc.title as scenario_title, tsc.role_type, u.username, u.real_name
      FROM training_sessions ts
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      LEFT JOIN users u ON ts.user_id = u.id
      WHERE ts.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ code: 404, message: 'FU利陪陪会话不存在' });

    const messages = db.prepare('SELECT * FROM training_messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.id);
    res.json({ code: 0, data: { session, messages } });
  } catch (err) {
    console.error('[training/admin/messages] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// GET /training/admin/sessions/:id/report - 管理员查看会话报告
router.get('/admin/sessions/:id/report', authRequired, adminRequired, (req, res) => {
  try {
    const db = req.db;
    const report = db.prepare(`
      SELECT tr.*, ts.started_at, ts.ended_at, tsc.title as scenario_title,
             u.username, u.real_name
      FROM training_reports tr
      JOIN training_sessions ts ON tr.session_id = ts.id
      JOIN training_scenarios tsc ON ts.scenario_id = tsc.id
      LEFT JOIN users u ON ts.user_id = u.id
      WHERE tr.session_id = ? AND ${getOrgUserScope(db, db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id), 'u').clause}
    `).get(req.params.id, ...getOrgUserScope(db, db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id), 'u').params);
    if (!report) return res.status(404).json({ code: 404, message: '暂无评估报告' });
    res.json({ code: 0, data: report });
  } catch (err) {
    console.error('[training/admin/report] Error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
