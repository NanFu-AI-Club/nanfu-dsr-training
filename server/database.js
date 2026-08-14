/**
 * 终端跑店宝典 - 数据库初始化
 * sql.js (WASM SQLite) + better-sqlite3 兼容包装器
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'nanfu_dsr.db');

// ==================== better-sqlite3 兼容包装器 ====================
class Database {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self._db.run(sql, params.length > 0 ? params : undefined);
        return { changes: self._db.getRowsModified() };
      },
      get(...params) {
        const stmt = self._db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        let result = undefined;
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          result = {};
          cols.forEach((c, i) => { result[c] = vals[i]; });
        }
        stmt.free();
        return result;
      },
      all(...params) {
        const results = [];
        const stmt = self._db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const obj = {};
          cols.forEach((c, i) => { obj[c] = vals[i]; });
          results.push(obj);
        }
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) {
    this._db.run(sql);
  }

  pragma(key) {
    const row = this.prepare(`PRAGMA ${key}`).get();
    return row ? Object.values(row)[0] : null;
  }

  transaction(fn) {
    const self = this;
    return function(...args) {
      self._db.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        self._db.run('COMMIT');
        return result;
      } catch (err) {
        self._db.run('ROLLBACK');
        throw err;
      }
    };
  }
}

// ==================== 全局 db 引用 ====================
let dbInstance = null;

function getDb() {
  if (!dbInstance) throw new Error('数据库尚未初始化');
  return dbInstance;
}

// ==================== 建表 SQL ====================
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  real_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','sales')),
  phone TEXT, email TEXT, group_id TEXT REFERENCES groups(id),
  avatar TEXT, status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  points INTEGER DEFAULT 0, total_earned_points INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS kb_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES kb_categories(id),
  sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS kb_documents (
  id TEXT PRIMARY KEY, category_id TEXT REFERENCES kb_categories(id),
  title TEXT NOT NULL, content TEXT NOT NULL, version INTEGER DEFAULT 1,
  is_current INTEGER DEFAULT 1, status TEXT DEFAULT 'published' CHECK(status IN ('draft','published','archived')),
  created_by TEXT REFERENCES users(id), created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS kb_versions (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES kb_documents(id),
  version INTEGER NOT NULL, content TEXT NOT NULL, changed_by TEXT REFERENCES users(id),
  change_note TEXT, created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ai_feedbacks (
  id TEXT PRIMARY KEY, conversation_id TEXT, question TEXT, answer TEXT,
  rating TEXT CHECK(rating IN ('like','dislike',NULL)),
  sources TEXT,
  user_id TEXT REFERENCES users(id), created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ai_favorites (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
  feedback_id TEXT REFERENCES ai_feedbacks(id), created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ai_configs (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, api_key TEXT, api_base TEXT,
  model TEXT, system_prompt TEXT, temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 2048, is_active INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('single','multiple','judge')),
  category TEXT, content TEXT NOT NULL, options TEXT, answer TEXT NOT NULL,
  analysis TEXT, difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  tags TEXT, status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by TEXT REFERENCES users(id), created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, duration INTEGER NOT NULL,
  total_score INTEGER DEFAULT 100, pass_score INTEGER DEFAULT 60,
  start_time DATETIME, end_time DATETIME,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','published','ongoing','ended')),
  assign_type TEXT DEFAULT 'all' CHECK(assign_type IN ('all','group','user')),
  assign_targets TEXT, max_attempts INTEGER DEFAULT 1,
  shuffle_questions INTEGER DEFAULT 1, shuffle_options INTEGER DEFAULT 0,
  show_answer INTEGER DEFAULT 0, created_by TEXT REFERENCES users(id),
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS exam_questions (
  id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  score REAL DEFAULT 0, sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS exam_records (
  id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id),
  user_id TEXT NOT NULL REFERENCES users(id), attempt INTEGER DEFAULT 1,
  score REAL DEFAULT 0, total_score REAL DEFAULT 100, passed INTEGER DEFAULT 0,
  start_time DATETIME, end_time DATETIME, answers TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','ongoing','submitted','graded')),
  graded_by TEXT REFERENCES users(id), retake_authorized INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('video','ppt','pdf')),
  description TEXT, cover_url TEXT, resource_url TEXT NOT NULL, duration INTEGER,
  category TEXT, tags TEXT, sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published' CHECK(status IN ('draft','published','archived')),
  created_by TEXT REFERENCES users(id), created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS learning_progress (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL REFERENCES courses(id), progress REAL DEFAULT 0,
  watch_time INTEGER DEFAULT 0, completed INTEGER DEFAULT 0,
  started_at DATETIME, completed_at DATETIME,
  updated_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(user_id, course_id)
);
CREATE TABLE IF NOT EXISTS roadmap_stages (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  sort_order INTEGER DEFAULT 0, required_courses TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS user_roadmap_progress (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  stage_id TEXT NOT NULL REFERENCES roadmap_stages(id),
  completed INTEGER DEFAULT 0, completed_at DATETIME,
  UNIQUE(user_id, stage_id)
);
CREATE TABLE IF NOT EXISTS training_scenarios (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  role_type TEXT NOT NULL, scenario_prompt TEXT NOT NULL,
  sales_goal TEXT,
  difficulty TEXT DEFAULT 'medium', tags TEXT, status TEXT DEFAULT 'active',
  created_by TEXT REFERENCES users(id), created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  scenario_id TEXT NOT NULL REFERENCES training_scenarios(id),
  status TEXT DEFAULT 'ongoing' CHECK(status IN ('ongoing','completed','scored')),
  started_at DATETIME DEFAULT (datetime('now','localtime')), ended_at DATETIME
);
CREATE TABLE IF NOT EXISTS training_messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES training_sessions(id),
  role TEXT NOT NULL CHECK(role IN ('user','ai','system')),
  content TEXT NOT NULL, created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS training_reports (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES training_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id), total_score REAL,
  dimensions TEXT, strengths TEXT, weaknesses TEXT, suggestions TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS point_logs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL, reason TEXT,
  source_type TEXT, source_id TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS point_rules (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  source_type TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  icon TEXT DEFAULT 'star',
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS radar_dimensions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'star',
  weight REAL DEFAULT 1.0,
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS shop_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  points_required INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  points_spent INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  recipient_name TEXT,
  recipient_phone TEXT,
  recipient_address TEXT,
  remark TEXT,
  tracking_no TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL, module TEXT, target_type TEXT, target_id TEXT,
  detail TEXT, ip TEXT, created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS check_ins (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  check_date TEXT NOT NULL, points_earned INTEGER DEFAULT 0,
  streak_count INTEGER DEFAULT 0, created_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(user_id, check_date)
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT,
  type TEXT NOT NULL DEFAULT 'image',
  file_url TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  link_url TEXT DEFAULT '',
  cos_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  review_comment TEXT, reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  images TEXT DEFAULT '[]',
  likes_count INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  group_id TEXT REFERENCES groups(id),
  group_name TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS share_likes (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES shares(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(share_id, user_id)
);
`;

// ==================== 索引 ====================
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
  'CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id)',
  'CREATE INDEX IF NOT EXISTS idx_kb_documents_category ON kb_documents(category_id)',
  'CREATE INDEX IF NOT EXISTS idx_kb_documents_current ON kb_documents(is_current)',
  'CREATE INDEX IF NOT EXISTS idx_kb_versions_document ON kb_versions(document_id)',
  'CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type)',
  'CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category)',
  'CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status)',
  'CREATE INDEX IF NOT EXISTS idx_exam_records_exam ON exam_records(exam_id)',
  'CREATE INDEX IF NOT EXISTS idx_exam_records_user ON exam_records(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_exam_questions_exam ON exam_questions(exam_id)',
  'CREATE INDEX IF NOT EXISTS idx_learning_progress_user ON learning_progress(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_learning_progress_course ON learning_progress(course_id)',
  'CREATE INDEX IF NOT EXISTS idx_courses_type ON courses(type)',
  'CREATE INDEX IF NOT EXISTS idx_point_logs_user ON point_logs(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_activity_logs_module ON activity_logs(module)',
  'CREATE INDEX IF NOT EXISTS idx_training_sessions_user ON training_sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_training_messages_session ON training_messages(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_feedbacks_user ON ai_feedbacks(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_check_ins_user ON check_ins(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_check_ins_date ON check_ins(check_date)',
  'CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_shares_created ON shares(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_share_likes_share ON share_likes(share_id)',
  'CREATE INDEX IF NOT EXISTS idx_share_likes_user ON share_likes(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_shares_group ON shares(group_id)',
];

// ==================== 种子数据 ====================
function seed(db) {
  // 如果已有用户数据则跳过
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (existing && existing.cnt > 0) {
    console.log('⏭️  数据库已有数据，跳过种子数据');
    return;
  }
  console.log('🌱 开始插入种子数据...');

  const adminId = uuidv4(), salesId1 = uuidv4(), salesId2 = uuidv4(), groupId = uuidv4();

  db.prepare('INSERT OR IGNORE INTO groups (id, name, description) VALUES (?,?,?)').run(groupId, '华东区销售一组', '华东区域销售人员');

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, username, password, real_name, role, phone, email, group_id) VALUES (?,?,?,?,?,?,?,?)');
  insertUser.run(adminId, 'admin', bcrypt.hashSync('admin123', 10), '系统管理员', 'admin', '13800000000', 'admin@nanfu.com', null);
  insertUser.run(salesId1, 'sales01', bcrypt.hashSync('sales123', 10), '张销售', 'sales', '13800000001', 'sales01@nanfu.com', groupId);
  insertUser.run(salesId2, 'sales02', bcrypt.hashSync('sales123', 10), '李销售', 'sales', '13800000002', 'sales02@nanfu.com', groupId);

  const catId1 = uuidv4(), catId2 = uuidv4(), catId3 = uuidv4();
  const insertCat = db.prepare('INSERT OR IGNORE INTO kb_categories (id, name, parent_id, sort_order) VALUES (?,?,?,?)');
  insertCat.run(catId1, '产品知识', null, 1);
  insertCat.run(catId2, '销售技巧', null, 2);
  insertCat.run(catId3, '公司制度', null, 3);

  const aiConfigId = uuidv4();
  db.prepare('INSERT OR IGNORE INTO ai_configs (id, provider, api_key, api_base, model, system_prompt, is_active) VALUES (?,?,?,?,?,?,?)')
    .run(aiConfigId, 'openai', '', 'https://api.openai.com/v1', 'gpt-4o-mini',
      '你是南孚电池的智能销售助手，请基于知识库内容回答销售代表的问题。回答要专业、简洁、有针对性。', 1);

  // 题库 (6题)
  const qs = [[
    uuidv4(), 'single', '产品知识', '南孚电池的核心技术优势是什么？',
    JSON.stringify(['A. 聚能环技术', 'B. 锂电池技术', 'C. 太阳能技术', 'D. 核能技术']),
    'A', '南孚电池的核心技术是聚能环技术，能有效防止电池漏液，延长电池寿命。', 'easy', JSON.stringify(['产品','技术'])
  ],[
    uuidv4(), 'single', '销售技巧', '面对客户质疑价格高时，最有效的应对策略是？',
    JSON.stringify(['A. 直接降价', 'B. 强调品质和性价比', 'C. 贬低竞品', 'D. 放弃推销']),
    'B', '应强调产品的品质优势和长期性价比，帮助客户理解价值所在。', 'medium', JSON.stringify(['销售','话术'])
  ],[
    uuidv4(), 'multiple', '产品知识', '南孚电池适用于以下哪些设备？',
    JSON.stringify(['A. 遥控器', 'B. 玩具车', 'C. 无线鼠标', 'D. 智能门锁']),
    JSON.stringify(['A','B','C','D']), '南孚电池适用范围广泛，以上所有设备均可使用。', 'easy', JSON.stringify(['产品','适用场景'])
  ],[
    uuidv4(), 'judge', '产品知识', '碱性电池可以随意丢弃在普通垃圾桶中。',
    null, 'false', '碱性电池虽然不含汞，但建议分类投放至有害垃圾或专门回收点。', 'easy', JSON.stringify(['环保'])
  ],[
    uuidv4(), 'single', '公司制度', '销售代表的日报提交截止时间是？',
    JSON.stringify(['A. 当日18:00', 'B. 当日20:00', 'C. 次日9:00', 'D. 次日10:00']),
    'B', '根据公司规定，日报需在当日20:00前提交。', 'medium', JSON.stringify(['制度'])
  ],[
    uuidv4(), 'judge', '销售技巧', '拜访客户前不需要了解客户的经营情况。',
    null, 'false', '充分了解客户经营情况是拜访成功的基础，有利于精准推销。', 'easy', JSON.stringify(['销售','拜访'])
  ]];
  const insertQ = db.prepare('INSERT OR IGNORE INTO questions (id, type, category, content, options, answer, analysis, difficulty, tags) VALUES (?,?,?,?,?,?,?,?,?)');
  qs.forEach(q => insertQ.run(...q));

  // 课程 (4门)
  const insertCourse = db.prepare('INSERT OR IGNORE INTO courses (id, title, type, description, cover_url, resource_url, duration, category, tags) VALUES (?,?,?,?,?,?,?,?,?)');
  insertCourse.run(uuidv4(), '南孚品牌故事与企业文化', 'video', '了解南孚电池的发展历程、品牌理念和企业文化。', '', 'https://tos-nanfu.volces.com/training/videos/brand-story.mp4', 15, '企业概况', JSON.stringify(['品牌','文化']));
  insertCourse.run(uuidv4(), '聚能环技术深度解析', 'ppt', '详细介绍南孚聚能环技术的原理、优势和市场竞争地位。', '', 'https://tos-nanfu.volces.com/training/ppts/ju-neng-huan.pptx', 0, '产品知识', JSON.stringify(['技术','产品']));
  insertCourse.run(uuidv4(), '终端陈列标准与实操', 'video', '学习终端销售陈列的标准规范和实际操作方法。', '', 'https://tos-nanfu.volces.com/training/videos/display-standards.mp4', 25, '销售技巧', JSON.stringify(['陈列','实操']));
  insertCourse.run(uuidv4(), '2025年度销售政策解读', 'pdf', '详细解读2025年度销售政策、奖惩制度和绩效考核标准。', '', 'https://tos-nanfu.volces.com/training/pdfs/2025-policy.pdf', 0, '公司制度', JSON.stringify(['政策','考核']));

  // 情景演练
  db.prepare('INSERT OR IGNORE INTO training_scenarios (id, title, description, role_type, scenario_prompt, difficulty) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), '超市采购谈判', '模拟与大型超市采购经理进行南孚电池进货谈判的场景。', '超市采购经理',
      '你是一位大型连锁超市的采购经理，对电池品类有丰富的采购经验。你对南孚电池的品牌认知度认可，但对价格和供货条件有较高要求。你需要与销售代表进行谈判，争取更优惠的价格和更好的账期。请保持专业但强硬的谈判态度。', 'medium');

  // 积分规则默认数据
  const defaultRules = [
    [uuidv4(), '每日签到（基础）', 'check_in', 5, '每天签到即可获得积分，连续签到越多奖励越多', 'calendar', 1, 1],
    [uuidv4(), '连续签到3天加成', 'check_in_streak_3', 10, '连续签到满3天额外奖励', 'flame', 1, 2],
    [uuidv4(), '连续签到7天加成', 'check_in_streak_7', 20, '连续签到满7天额外奖励', 'fire', 1, 3],
    [uuidv4(), '连续签到30天加成', 'check_in_streak_30', 50, '连续签到满30天额外奖励', 'crown', 1, 4],
    [uuidv4(), '每日一题（答对）', 'daily_question_correct', 10, '每天随机一道题，答对获得积分', 'zap', 0, 5],
    [uuidv4(), '每日一题（答错）', 'daily_question_wrong', 2, '参与答题即可获得积分', 'zap', 0, 6],
    [uuidv4(), '完成课程', 'learning_complete', 5, '每完成一门课程获得积分，最低5分，每5分钟课程时长+1分', 'book', 1, 7],
    [uuidv4(), '考试通过', 'exam_pass', 0, '考试通过后按分数/10计算积分（如80分=8积分），0表示按公式计算', 'file', 1, 8],
    [uuidv4(), 'AI陪练', 'training_complete', 10, '完成陪练场景获得积分奖励', 'message', 1, 9],
    [uuidv4(), '风采投稿通过', 'submission_approved', 5, '风采投稿审核通过获得积分奖励', 'camera', 1, 10],
    [uuidv4(), '管理员调整', 'manual_adjust', 0, '管理员可手动为用户增减积分', 'user', 1, 11],
  ];
  const insertRule = db.prepare('INSERT OR IGNORE INTO point_rules (id, action, source_type, points, description, icon, enabled, sort_order) VALUES (?,?,?,?,?,?,?,?)');
  defaultRules.forEach(r => insertRule.run(...r));

  // 雷达维度默认数据
  const defaultDimensions = [
    [uuidv4(), 'product_knowledge', '产品知识', '产品参数、卖点、竞品对比的掌握程度', 'book', 1.0, 1, 1],
    [uuidv4(), 'sales_skills', '销售技巧', 'SPIN提问、FAB法则、促成话术等销售技能', 'trending', 1.0, 1, 2],
    [uuidv4(), 'communication', '沟通能力', '倾听、表达、共情及非暴力沟通能力', 'message', 1.0, 1, 3],
    [uuidv4(), 'customer_management', '客户管理', '客户分级、跟进节奏与售后处理', 'users', 1.0, 1, 4],
    [uuidv4(), 'customer_care', '客情维护', '客户关系维护、客情建立与长期合作经营', 'heart', 1.0, 1, 5],
    [uuidv4(), 'learning_attitude', '学习时长', '课程完成率、学习时长与学习投入度', 'clock', 1.0, 1, 6],
  ];
  const insertDim = db.prepare('INSERT OR IGNORE INTO radar_dimensions (id, key, name, description, icon, weight, enabled, sort_order) VALUES (?,?,?,?,?,?,?,?)');
  defaultDimensions.forEach(d => insertDim.run(...d));

  console.log('✅ 种子数据插入完成');
  console.log('  管理员: admin / admin123');
  console.log('  业务员: sales01 / sales123, sales02 / sales123');
}

// ==================== 初始化 ====================
async function initDatabase(reset = false, withSeed = false) {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  let existingData = null;
  if (!reset && fs.existsSync(DB_PATH)) {
    existingData = fs.readFileSync(DB_PATH);
  }

  const SQL = await initSqlJs();
  let sqlDb;

  if (existingData) {
    sqlDb = new SQL.Database(existingData);
    // 已有数据库也执行建表语句（IF NOT EXISTS），确保新增的表能自动创建
    const statements = SCHEMA.split(';').filter(s => s.trim());
    statements.forEach(sql => { try { sqlDb.run(sql); } catch (e) { /* 忽略已存在表的错误 */ } });
    // 创建索引
    INDEXES.forEach(sql => { try { sqlDb.run(sql); } catch (e) {} });
    // 迁移：为已有表新增列
    const migrations = [
      { table: 'training_scenarios', column: 'sales_goal', sql: 'ALTER TABLE training_scenarios ADD COLUMN sales_goal TEXT' },
      { table: 'shop_orders', column: 'tracking_no', sql: 'ALTER TABLE shop_orders ADD COLUMN tracking_no TEXT' },
      { table: 'submissions', column: 'category', sql: "ALTER TABLE submissions ADD COLUMN category TEXT NOT NULL DEFAULT 'other'" },
      { table: 'submissions', column: 'link_url', sql: "ALTER TABLE submissions ADD COLUMN link_url TEXT DEFAULT ''" },
      { table: 'users', column: 'total_earned_points', sql: 'ALTER TABLE users ADD COLUMN total_earned_points INTEGER DEFAULT 0' },
      { table: 'ai_feedbacks', column: 'sources', sql: 'ALTER TABLE ai_feedbacks ADD COLUMN sources TEXT' },
  { table: 'submissions', column: 'cos_key', sql: 'ALTER TABLE submissions ADD COLUMN cos_key TEXT' },
      { table: 'shares', column: 'group_id', sql: 'ALTER TABLE shares ADD COLUMN group_id TEXT REFERENCES groups(id)' },
      { table: 'shares', column: 'group_name', sql: 'ALTER TABLE shares ADD COLUMN group_name TEXT' },
];
    migrations.forEach(m => {
      try {
        const cols = sqlDb.exec(`PRAGMA table_info(${m.table})`);
        const hasColumn = cols.length && cols[0].values.some(row => row[1] === m.column);
        if (!hasColumn) {
          sqlDb.run(m.sql);
          console.log(`✅ 迁移: ${m.table} 新增列 ${m.column}`);
        }
      } catch (e) { /* 列已存在或表不存在，忽略 */ }
    });
    // 迁移：插入新增的积分规则（签到）
    const newRules = [
      ['check_in', '每日签到（基础）', 5, '每天签到即可获得积分，连续签到越多奖励越多', 'calendar', 1, 1],
      ['check_in_streak_3', '连续签到3天加成', 10, '连续签到满3天额外奖励', 'flame', 1, 2],
      ['check_in_streak_7', '连续签到7天加成', 20, '连续签到满7天额外奖励', 'fire', 1, 3],
      ['check_in_streak_30', '连续签到30天加成', 50, '连续签到满30天额外奖励', 'crown', 1, 4],
    ];
    // 迁移：插入风采投稿通过积分规则
    const submissionRule = ['submission_approved', '风采投稿通过', 5, '风采投稿审核通过获得积分奖励', 'camera', 1, 11];
    const allNewRules = [...newRules, submissionRule];
    allNewRules.forEach(r => {
      try {
        const exists = sqlDb.exec(`SELECT 1 FROM point_rules WHERE source_type = '${r[0]}'`);
        if (!exists.length || !exists[0].values.length) {
          const ruleId = uuidv4();
          sqlDb.run(`INSERT INTO point_rules (id, source_type, action, points, description, icon, enabled, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'),datetime('now','localtime'))`,
            [ruleId, r[0], r[1], r[2], r[3], r[4], r[5], r[6]]);
          console.log(`✅ 迁移: 新增积分规则 ${r[1]}`);
        }
      } catch (e) { /* 忽略 */ }
    });
    // 初始化现有用户的 total_earned_points（等于当前积分）
    try {
      sqlDb.run("UPDATE users SET total_earned_points = points WHERE total_earned_points = 0 AND points > 0");
    } catch (e) { /* 忽略 */ }
  } else {
    sqlDb = new SQL.Database();
    // 执行建表
    const statements = SCHEMA.split(';').filter(s => s.trim());
    statements.forEach(sql => { sqlDb.run(sql); });
    // 创建索引
    INDEXES.forEach(sql => { sqlDb.run(sql); });
  }

  const db = new Database(sqlDb);
  dbInstance = db;

  if (withSeed) seed(db);

  // 保存到文件
  const data = sqlDb.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);

  console.log('✅ 数据库初始化完成:', DB_PATH);
  return db;
}

// 保存数据库到文件
let dbDirty = false;

function markDbDirty() {
  dbDirty = true;
}

function saveDb(force = false) {
  if (dbInstance && (force || dbDirty)) {
    const data = dbInstance._db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    dbDirty = false;
  }
}

// 如果直接运行
if (require.main === module) {
  const args = process.argv.slice(2);
  initDatabase(args.includes('--reset'), args.includes('--seed')).then(() => {
    console.log('Done.');
    process.exit(0);
  });
}

module.exports = { DB_PATH, initDatabase, getDb, saveDb, markDbDirty, Database };
