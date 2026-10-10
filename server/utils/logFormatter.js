/**
 * 活动日志统一格式化工具
 * 提供模块 / 动作的中文标签、详情摘要生成、详情格式化能力
 */

const MODULE_LABELS = {
  auth: '登录认证',
  users: '用户管理',
  knowledge: '知识库',
  questions: '题库',
  exams: '考试管理',
  courses: '课程学习',
  ai: '跑店问问',
  training: 'FU利陪陪',
  submissions: '风采投稿',
  checkin: '每日签到',
  shop: '积分商城',
  shares: '分享圈',
  announcements: '公告',
};

const ACTION_LABELS = {
  login: '登录',
  logout: '退出登录',
  create: '新增',
  update: '修改',
  delete: '删除',
  view: '查看',
  export: '导出',
  submit: '提交',
  complete: '完成',
  learn: '学习课程',
  update_progress: '更新学习进度',
  daily_question: '每日一题',
  check_in: '每日签到',
  pass: '通过',
  fail: '未通过',
  adjust_points: '调整积分',
  batch_import: '批量导入',
  batch_delete: '批量删除',
  start_exam: '开始考试',
  submit_exam: '提交答卷',
  retake_authorize: '授权补考',
  grade: '人工评分',
  compose: '组卷',
  publish: '发布',
  start_training: '开始FU利陪陪',
  end_training: '结束FU利陪陪',
  chat: 'AI 对话',
  rollback: '回滚版本',
  import_excel: '导入 Excel',
  complete_stage: '完成闯关',
  like: '点赞',
  unlike: '取消点赞',
  comment: '评论',
  reply: '回复',
  pin: '置顶',
  unpin: '取消置顶',
  approve: '审核通过',
  reject: '审核驳回',
};

// 目标类型中文标签
const TARGET_TYPE_LABELS = {
  user: '用户',
  group: '分组',
  course: '课程',
  question: '题目',
  questions: '题库',
  exam: '考试',
  exam_record: '考试记录',
  exam_records: '考试记录',
  scenario: 'FU利陪陪剧本',
  session: 'FU利陪陪会话',
  ai_config: 'AI 配置',
  ai_chat: 'AI 反馈',
  ai_conversation: 'AI 会话',
  kb_category: '知识库分类',
  kb_document: '知识库文档',
  category: '分类',
  roadmap_stage: '闯关阶段',
  shop_product: '积分商品',
  check_in: '签到',
  share: '分享',
  share_comment: '分享评论',
  comment: '评论',
  submission: '投稿',
  announcement: '公告',
};

/**
 * 解析 detail（字符串或对象）
 */
function parseDetail(detail) {
  if (detail == null) return {};
  if (typeof detail === 'object') return detail;
  try { return JSON.parse(detail); } catch (_) { return { text: String(detail) }; }
}

/**
 * 将秒数格式化为 "X分Y秒"
 */
function formatSeconds(s) {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return '0秒';
  const m = Math.floor(n / 60);
  const sec = n % 60;
  if (m === 0) return `${sec}秒`;
  if (sec === 0) return `${m}分`;
  return `${m}分${sec}秒`;
}

/**
 * 生成人类可读的中文 description
 * 例： "学习课程《销冠闯关秘籍》进度 80%"
 */
function formatLogDescription(log) {
  const detail = parseDetail(log.detail);
  const actionLabel = ACTION_LABELS[log.action] || log.action || '操作';
  const title = detail.title || detail.course_title || detail.name || detail.scenario_title;
  const subject = title ? `《${title}》` : '';

  switch (log.action) {
    case 'learn':
      if (detail.replay) {
        return `${actionLabel}${subject}（重复观看，进度保留 ${detail.progress ?? '-'}%）`;
      }
      return `${actionLabel}${subject}，进度 ${detail.progress ?? '-'}%`;
    case 'complete':
      return `完成${subject || '任务'}`;
    case 'complete_stage':
      return `完成闯关阶段《${detail.stage_name || title || ''}》`;
    case 'create':
      return `新增${subject || (TARGET_TYPE_LABELS[log.target_type] || '')}`;
    case 'update':
      return `修改${subject || (TARGET_TYPE_LABELS[log.target_type] || '')}`;
    case 'delete':
      return `删除${subject || (TARGET_TYPE_LABELS[log.target_type] || '')}`;
    case 'batch_delete':
      return `批量删除${subject || '数据'}`;
    case 'batch_import':
    case 'import_excel':
      return `批量导入${subject || '数据'}${detail.count ? `，共 ${detail.count} 条` : ''}`;
    case 'adjust_points':
      return `调整积分：${detail.username || subject || ''} ${detail.delta > 0 ? '+' : ''}${detail.delta ?? detail.points ?? 0} 分`;
    case 'check_in':
      return `每日签到${detail.streak ? `，连续 ${detail.streak} 天` : ''}`;
    case 'daily_question':
      return `每日一题${detail.correct === true ? '，答对' : detail.correct === false ? '，答错' : ''}`;
    case 'login':
      return `登录系统${detail.device ? `（${detail.device}）` : ''}`;
    case 'logout':
      return '退出系统';
    case 'start_exam':
      return `开始考试${subject}`;
    case 'submit_exam':
      return `提交答卷${subject}，得分 ${detail.score ?? '-'}`;
    case 'grade':
      return `评分${subject}，得分 ${detail.score ?? '-'}`;
    case 'retake_authorize':
      return `授权补考${subject}`;
    case 'compose':
      return `组卷${subject}`;
    case 'publish':
      return `发布${subject}`;
    case 'approve':
      return `审核通过投稿${subject}${detail.points ? `，奖励 ${detail.points} 分` : ''}`;
    case 'reject':
      return `审核驳回投稿${subject}`;
    case 'start_training':
      return `开始 FU利陪陪${subject}`;
    case 'end_training':
      return `结束 FU利陪陪${subject}，评分 ${detail.score ?? '-'}`;
    case 'chat':
      return '与 AI 助手对话';
    case 'rollback':
      return `回滚${subject || '版本'}至 v${detail.version ?? '?'}`;
    case 'pass':
      return `通过${subject || '考试'}`;
    case 'fail':
      return `未通过${subject || '考试'}`;
    case 'export':
      return `导出${subject || '数据'}${detail.count ? `（${detail.count} 条）` : ''}`;
    case 'view':
      return `查看${subject || ''}`;
    case 'submit':
      return `提交${subject || ''}`;
    default:
      return `${actionLabel}${subject}`;
  }
}

/**
 * 把 detail 对象格式化为多行 key: value 文本，供前端展示
 */
function formatDetailText(detail) {
  const obj = parseDetail(detail);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    let value = v;
    if (Array.isArray(v)) value = v.join('、');
    else if (typeof v === 'object') value = JSON.stringify(v);
    if (k === 'watch_time' || k === 'duration') value = formatSeconds(v);
    if (k === 'replay' && v === true) value = '是（重复观看）';
    if (k === 'correct' && typeof v === 'boolean') value = v ? '✓ 正确' : '✗ 错误';
    lines.push(`${k}: ${value}`);
  }
  return lines.join('\n');
}

/**
 * 统一格式化一条日志
 */
function normalizeLog(log) {
  return {
    ...log,
    module_label: MODULE_LABELS[log.module] || log.module || '其他',
    action_label: ACTION_LABELS[log.action] || log.action || '其他操作',
    target_type_label: TARGET_TYPE_LABELS[log.target_type] || log.target_type || '-',
    detail: parseDetail(log.detail),
    description: formatLogDescription(log),
    detail_text: formatDetailText(log.detail),
  };
}

// 默认需要从列表/统计中隐藏的高频噪声日志
const NOISY_ACTIONS = new Set(['learn', 'update_progress']);

module.exports = {
  MODULE_LABELS,
  ACTION_LABELS,
  TARGET_TYPE_LABELS,
  NOISY_ACTIONS,
  parseDetail,
  formatSeconds,
  formatLogDescription,
  formatDetailText,
  normalizeLog,
};
