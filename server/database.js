/**
 * 终端跑店宝典 - 数据库初始化
 * sql.js (WASM SQLite) + better-sqlite3 兼容包装器
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'nanfu_dsr.db');

// 驱动选择：better = better-sqlite3（原生、增量落盘、整库不常驻内存）；sqljs = 旧的 sql.js(WASM)
// 默认使用 better，若原生模块不可用则自动回退到 sql.js，保证服务不被拖垮
const DB_DRIVER = process.env.DB_DRIVER || 'better';

// ==================== better-sqlite3 兼容包装器 ====================
// 参数归一化：better-sqlite3 只接受 number/string/bigint/Buffer/null，
// boolean / undefined / NaN 会导致绑定报错，这里统一转换
function normalizeParam(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v;
}
const normalizeParams = (params) => (params.length ? params.map(normalizeParam) : params);

class Database {
  // driver: sql.js 的 Database 实例 或 better-sqlite3 的 Database 实例
  // kind: 'sqljs' | 'better'
  constructor(driver, kind = 'sqljs') {
    this._db = driver;
    this._kind = kind;
  }

  prepare(sql) {
    if (this._kind === 'better') {
      const stmt = this._db.prepare(sql);
      return {
        run(...params) {
          const r = stmt.run(...normalizeParams(params));
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        get(...params) {
          return stmt.get(...normalizeParams(params));
        },
        all(...params) {
          return stmt.all(...normalizeParams(params));
        }
      };
    }

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
    if (this._kind === 'better') return this._db.exec(sql);
    this._db.run(sql);
  }

  pragma(key) {
    if (this._kind === 'better') {
      const rows = this._db.pragma(key);
      return (Array.isArray(rows) && rows.length) ? Object.values(rows[0])[0] : null;
    }
    const row = this.prepare(`PRAGMA ${key}`).get();
    return row ? Object.values(row)[0] : null;
  }

  transaction(fn) {
    if (this._kind === 'better') return this._db.transaction(fn);
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

// 为迁移代码提供 sql.js 风格的 run/exec（better 模式下用）
function makeSqljsCompat(raw) {
  return {
    run(sql, params) {
      if (params && params.length) raw.prepare(sql).run(...normalizeParams(params));
      else raw.exec(sql);
    },
    exec(sql, params) {
      const stmt = raw.prepare(sql);
      const columns = stmt.columns().map(c => c.name);
      const rows = (params && params.length) ? stmt.raw().all(...normalizeParams(params)) : stmt.raw().all();
      return [{ columns, values: rows }];
    }
  };
}


// ==================== 全局 db 引用 ====================
let dbInstance = null;

function getDb() {
  if (!dbInstance) throw new Error('数据库尚未初始化');
  return dbInstance;
}

// ==================== 建表 SQL ====================
const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES regions(id),
  level INTEGER NOT NULL CHECK(level IN (1, 2)), code TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0, status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(parent_id, name)
);
CREATE TABLE IF NOT EXISTS cities (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, region_id TEXT NOT NULL REFERENCES regions(id),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(region_id, name)
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  real_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','sales')),
  manager_type TEXT CHECK(manager_type IN ('system_admin','region_manager','area_manager','city_manager',NULL)),
  phone TEXT, email TEXT, group_id TEXT REFERENCES groups(id),
  region_id TEXT REFERENCES regions(id), city_id TEXT REFERENCES cities(id),
  dealer_name TEXT,
  avatar TEXT, status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  points INTEGER DEFAULT 0, total_earned_points INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
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
CREATE TABLE IF NOT EXISTS kb_document_vectors (
  doc_id TEXT PRIMARY KEY REFERENCES kb_documents(id),
  vector TEXT NOT NULL,
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
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
  max_tokens INTEGER DEFAULT 65536, is_active INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('single','multiple','judge','fill','short')),
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
  assign_type TEXT DEFAULT 'all' CHECK(assign_type IN ('all','group','user','scope')),
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
  pending_manual INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS wrong_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  exam_id TEXT REFERENCES exams(id),
  wrong_count INTEGER DEFAULT 1,
  last_wrong_at DATETIME DEFAULT (datetime('now','localtime')),
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(user_id, question_id)
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
  learn_count INTEGER DEFAULT 0,
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
  comments_count INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  group_id TEXT REFERENCES groups(id),
  group_name TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS share_likes (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES shares(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(share_id, user_id)
);
CREATE TABLE IF NOT EXISTS share_comments (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES shares(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT REFERENCES share_comments(id),
  reply_to_user_id TEXT REFERENCES users(id),
  reply_to_user_name TEXT,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS share_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT,
  type TEXT NOT NULL CHECK(type IN ('like','comment','reply')),
  share_id TEXT,
  comment_id TEXT,
  content TEXT,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS level_bonuses (
  level INTEGER PRIMARY KEY,
  multiplier REAL NOT NULL DEFAULT 1.0,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
INSERT OR IGNORE INTO level_bonuses (level, multiplier, enabled) VALUES
  (1, 1.0, 1), (2, 1.0, 1), (3, 1.1, 1), (4, 1.2, 1), (5, 1.3, 1);
CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  content TEXT,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',   -- all=全员 / areas=指定大区
  target_areas TEXT,                   -- scope=areas 时存大区 id 的 JSON 数组
  is_published INTEGER DEFAULT 0,      -- 0=草稿 1=已发布
  published_at DATETIME,
  created_by TEXT,
  created_by_name TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(announcement_id, user_id)
);
`;

// ==================== 索引 ====================
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
  'CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id)',
  'CREATE INDEX IF NOT EXISTS idx_users_region ON users(region_id)',
  'CREATE INDEX IF NOT EXISTS idx_users_city ON users(city_id)',
  'CREATE INDEX IF NOT EXISTS idx_regions_parent ON regions(parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_cities_region ON cities(region_id)',
  'CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(is_published, published_at)',
  'CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id)',
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
  'CREATE INDEX IF NOT EXISTS idx_training_sessions_started ON training_sessions(started_at)',
  'CREATE INDEX IF NOT EXISTS idx_training_sessions_status ON training_sessions(status)',
  'CREATE INDEX IF NOT EXISTS idx_training_sessions_scenario ON training_sessions(scenario_id)',
  'CREATE INDEX IF NOT EXISTS idx_training_messages_session ON training_messages(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_training_reports_session ON training_reports(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_point_logs_training_source ON point_logs(source_type, source_id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_feedbacks_user ON ai_feedbacks(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_check_ins_user ON check_ins(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_check_ins_date ON check_ins(check_date)',
  'CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_shares_created ON shares(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_share_likes_share ON share_likes(share_id)',
  'CREATE INDEX IF NOT EXISTS idx_share_likes_user ON share_likes(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_shares_group ON shares(group_id)',
  'CREATE INDEX IF NOT EXISTS idx_share_comments_share ON share_comments(share_id)',
  'CREATE INDEX IF NOT EXISTS idx_share_comments_parent ON share_comments(parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_share_comments_user ON share_comments(user_id)',
];

// ==================== 组织架构初始化 ====================
const REGION_DATA = {
  '华东区': ['安徽AB区', '安徽CD区', '江苏AB区', '上海市', '苏北CD区', '苏南CD区', '浙东区', '浙西区'],
  '华北区': ['北京市', '河北AB区', '河北CD区', '河南AB区', '山东AB区', '山西省', '天津市', '豫北CD区', '豫南CD区', '鲁东CD区', '鲁西CD区'],
  '华南区': ['海南省', '湖北AB区', '湖北CD区', '湖南AB区', '湖南CD区', '江西省', '闽北区', '闽南区', '粤东A区', '粤东B区', '粤西A区', '粤西B区'],
  '东北区': ['黑龙江省', '吉林省', '辽北区', '辽南区', '内蒙古'],
  '西一区': ['甘青宁藏', '陕西AB区', '陕西CD区', '四川AB区', '四川CD区', '新疆省', '重庆AB区', '重庆CD区'],
  '西二区': ['贵州省', '桂北区', '桂南区', '桂中区', '云南省']
};

function initializeRegions(db) {
  const insertRegion = db.prepare(`
    INSERT OR IGNORE INTO regions (id, name, parent_id, level, code, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  Object.entries(REGION_DATA).forEach(([areaName, subRegions], areaIndex) => {
    const areaCode = `A${String(areaIndex + 1).padStart(2, '0')}`;
    const areaId = `region-${areaCode}`;
    insertRegion.run(areaId, areaName, null, 1, areaCode, areaIndex + 1);
    subRegions.forEach((name, index) => {
      const code = `${areaCode}-${String(index + 1).padStart(2, '0')}`;
      insertRegion.run(`region-${code}`, name, areaId, 2, code, index + 1);
    });
  });
}

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
    [uuidv4(), 'FU利陪陪', 'training_complete', 10, '完成FU利陪陪场景获得积分奖励', 'message', 1, 9],
    [uuidv4(), '风采投稿通过', 'submission_approved', 5, '风采投稿审核通过获得积分奖励', 'camera', 1, 10],
    [uuidv4(), '管理员调整', 'manual_adjust', 0, '管理员可手动为用户增减积分', 'user', 1, 11],
    [uuidv4(), '分享圈发帖', 'share_post', 10, '发布分享圈动态可获积分，每日上限20分（最多2次）', 'share', 1, 12],
    [uuidv4(), '分享圈内容被置顶', 'share_pin', 50, '发布的内容被管理员置顶，额外获得积分奖励', 'star', 1, 13],
    [uuidv4(), '跑店问问提问', 'ai_ask', 5, '每次提问获得积分；提问与反馈合计每日上限50分（以本行「每日上限」为准）', 'message', 1, 14],
    [uuidv4(), '跑店问问反馈', 'ai_feedback', 5, '对回答做出评价获得积分；提问与反馈合计每日上限50分（以「跑店问问提问」的每日上限为准）', 'star', 1, 15],
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
    [uuidv4(), 'learning_attitude', '学习投入', '课程完成率、学习时长与学习投入度', 'clock', 1.0, 1, 6],
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

  let useBetter = DB_DRIVER === 'better';
  const isNew = reset || !fs.existsSync(DB_PATH);

  let driverRaw;  // 底层驱动实例（sql.js 或 better-sqlite3）
  let sqlDb;      // 迁移代码句柄（sql.js 原生实例 / better 的兼容 shim）

  if (useBetter) {
    try {
      if (reset) {
        // 重建库：先清掉旧文件（含 WAL / SHM）
        ['', '-wal', '-shm'].forEach(s => { try { fs.rmSync(DB_PATH + s, { force: true }); } catch (_) {} });
      }
      const BetterSqlite3 = require('better-sqlite3');
      driverRaw = new BetterSqlite3(DB_PATH);
      // WAL + NORMAL：写入变成增量，不再整库重写
      driverRaw.pragma('journal_mode = WAL');
      driverRaw.pragma('synchronous = NORMAL');
      sqlDb = makeSqljsCompat(driverRaw);
    } catch (e) {
      console.error(`⚠️  better-sqlite3 不可用，自动回退到 sql.js：${e.message}`);
      useBetter = false;
    }
  }

  if (!useBetter) {
    const SQL = await initSqlJs();
    driverRaw = isNew ? new SQL.Database() : new SQL.Database(fs.readFileSync(DB_PATH));
    sqlDb = driverRaw;
  }

  if (!isNew) {
    // 已有数据库也执行建表语句（IF NOT EXISTS），确保新增的表能自动创建
    const statements = SCHEMA.split(';').filter(s => s.trim());
    statements.forEach(sql => { try { sqlDb.run(sql); } catch (e) { /* 忽略已存在表的错误 */ } });
    // 创建索引
    INDEXES.forEach(sql => { try { sqlDb.run(sql); } catch (e) {} });
    // 迁移：为已有表新增列
    const migrations = [
      { table: 'training_scenarios', column: 'sales_goal', sql: 'ALTER TABLE training_scenarios ADD COLUMN sales_goal TEXT' },
      { table: 'training_scenarios', column: 'link_url', sql: "ALTER TABLE training_scenarios ADD COLUMN link_url TEXT DEFAULT ''" },
      { table: 'training_reports', column: 'points_awarded', sql: 'ALTER TABLE training_reports ADD COLUMN points_awarded INTEGER DEFAULT 0' },
      { table: 'point_rules', column: 'daily_limit', sql: 'ALTER TABLE point_rules ADD COLUMN daily_limit INTEGER DEFAULT 0' },
      { table: 'point_rules', column: 'daily_max_times', sql: 'ALTER TABLE point_rules ADD COLUMN daily_max_times INTEGER DEFAULT 0' },
      { table: 'training_reports', column: 'point_skip_reason', sql: 'ALTER TABLE training_reports ADD COLUMN point_skip_reason TEXT' },
      { table: 'shop_orders', column: 'tracking_no', sql: 'ALTER TABLE shop_orders ADD COLUMN tracking_no TEXT' },
      { table: 'submissions', column: 'category', sql: "ALTER TABLE submissions ADD COLUMN category TEXT NOT NULL DEFAULT 'other'" },
      { table: 'submissions', column: 'link_url', sql: "ALTER TABLE submissions ADD COLUMN link_url TEXT DEFAULT ''" },
      { table: 'users', column: 'total_earned_points', sql: 'ALTER TABLE users ADD COLUMN total_earned_points INTEGER DEFAULT 0' },
      { table: 'users', column: 'manager_type', sql: "ALTER TABLE users ADD COLUMN manager_type TEXT" },
      { table: 'users', column: 'region_id', sql: 'ALTER TABLE users ADD COLUMN region_id TEXT REFERENCES regions(id)' },
      { table: 'users', column: 'city_id', sql: 'ALTER TABLE users ADD COLUMN city_id TEXT REFERENCES cities(id)' },
      { table: 'users', column: 'dealer_name', sql: 'ALTER TABLE users ADD COLUMN dealer_name TEXT' },
      { table: 'ai_feedbacks', column: 'sources', sql: 'ALTER TABLE ai_feedbacks ADD COLUMN sources TEXT' },
      { table: 'ai_feedbacks', column: 'feedback_reason', sql: 'ALTER TABLE ai_feedbacks ADD COLUMN feedback_reason TEXT' },
  { table: 'submissions', column: 'cos_key', sql: 'ALTER TABLE submissions ADD COLUMN cos_key TEXT' },
      { table: 'shares', column: 'group_id', sql: 'ALTER TABLE shares ADD COLUMN group_id TEXT REFERENCES groups(id)' },
      { table: 'shares', column: 'group_name', sql: 'ALTER TABLE shares ADD COLUMN group_name TEXT' },
      { table: 'shares', column: 'comments_count', sql: 'ALTER TABLE shares ADD COLUMN comments_count INTEGER DEFAULT 0' },
      { table: 'learning_progress', column: 'learn_count', sql: 'ALTER TABLE learning_progress ADD COLUMN learn_count INTEGER DEFAULT 0' },
      { table: 'exam_records', column: 'pending_manual', sql: 'ALTER TABLE exam_records ADD COLUMN pending_manual INTEGER DEFAULT 0' },
];
    try {
      sqlDb.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('share_min_length', '0')");
      sqlDb.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('share_blocked_keywords', '')");
    } catch (_) {}
    migrations.forEach(m => {
      try {
        const cols = sqlDb.exec(`PRAGMA table_info(${m.table})`) || [];
        const hasColumn = cols.length && cols[0].values.some(row => row[1] === m.column);
        if (!hasColumn) {
          sqlDb.run(m.sql);
          console.log(`✅ 迁移: ${m.table} 新增列 ${m.column}`);
        }
      } catch (e) { /* 列已存在或表不存在，忽略 */ }
    });
    // 迁移：放宽 questions.type 约束，支持填空题（fill）与简答题（short）
    try {
      const qDdlRes = sqlDb.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='questions'");
      const qDdl = (qDdlRes.length && qDdlRes[0].values.length) ? (qDdlRes[0].values[0][0] || '') : '';
      if (qDdl && !qDdl.includes("'fill'")) {
        sqlDb.run('PRAGMA foreign_keys = OFF');
        sqlDb.run('BEGIN TRANSACTION');
        sqlDb.run(`CREATE TABLE questions_new (
          id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('single','multiple','judge','fill','short')),
          category TEXT, content TEXT NOT NULL, options TEXT, answer TEXT NOT NULL,
          analysis TEXT, difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
          tags TEXT, status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
          created_by TEXT REFERENCES users(id), created_at DATETIME DEFAULT (datetime('now','localtime')),
          updated_at DATETIME DEFAULT (datetime('now','localtime'))
        )`);
        sqlDb.run(`INSERT INTO questions_new (id, type, category, content, options, answer, analysis, difficulty, tags, status, created_by, created_at, updated_at)
          SELECT id, type, category, content, options, answer, analysis, difficulty, tags, status, created_by, created_at, updated_at FROM questions`);
        sqlDb.run('DROP TABLE questions');
        sqlDb.run('ALTER TABLE questions_new RENAME TO questions');
        sqlDb.run('CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type)');
        sqlDb.run('CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category)');
        sqlDb.run('COMMIT');
        sqlDb.run('PRAGMA foreign_keys = ON');
        console.log('✅ 迁移: questions.type 支持填空题/简答题');
      }
    } catch (e) {
      try { sqlDb.run('ROLLBACK'); sqlDb.run('PRAGMA foreign_keys = ON'); } catch (_) {}
      console.error('❌ 迁移 questions.type 失败:', e.message);
    }

    // 迁移：放宽 exams.assign_type 约束，支持按大区/区域+角色（scope）
    // SQLite 无法直接修改 CHECK 约束，需重建表
    try {
      const ddlRes = sqlDb.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='exams'");
      const ddl = (ddlRes.length && ddlRes[0].values.length) ? (ddlRes[0].values[0][0] || '') : '';
      if (ddl && !ddl.includes("'scope'")) {
        sqlDb.run('PRAGMA foreign_keys = OFF');
        sqlDb.run('BEGIN TRANSACTION');
        sqlDb.run(`CREATE TABLE exams_new (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, duration INTEGER NOT NULL,
          total_score INTEGER DEFAULT 100, pass_score INTEGER DEFAULT 60,
          start_time DATETIME, end_time DATETIME,
          status TEXT DEFAULT 'draft' CHECK(status IN ('draft','published','ongoing','ended')),
          assign_type TEXT DEFAULT 'all' CHECK(assign_type IN ('all','group','user','scope')),
          assign_targets TEXT, max_attempts INTEGER DEFAULT 1,
          shuffle_questions INTEGER DEFAULT 1, shuffle_options INTEGER DEFAULT 0,
          show_answer INTEGER DEFAULT 0, created_by TEXT REFERENCES users(id),
          created_at DATETIME DEFAULT (datetime('now','localtime')),
          updated_at DATETIME DEFAULT (datetime('now','localtime'))
        )`);
        sqlDb.run(`INSERT INTO exams_new (id, title, description, duration, total_score, pass_score,
          start_time, end_time, status, assign_type, assign_targets, max_attempts,
          shuffle_questions, shuffle_options, show_answer, created_by, created_at, updated_at)
          SELECT id, title, description, duration, total_score, pass_score,
          start_time, end_time, status, assign_type, assign_targets, max_attempts,
          shuffle_questions, shuffle_options, show_answer, created_by, created_at, updated_at FROM exams`);
        sqlDb.run('DROP TABLE exams');
        sqlDb.run('ALTER TABLE exams_new RENAME TO exams');
        sqlDb.run('CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status)');
        sqlDb.run('COMMIT');
        sqlDb.run('PRAGMA foreign_keys = ON');
        console.log('✅ 迁移: exams.assign_type 支持按大区/区域+角色（scope）');
      }
    } catch (e) {
      try { sqlDb.run('ROLLBACK'); sqlDb.run('PRAGMA foreign_keys = ON'); } catch (_) {}
      console.error('❌ 迁移 exams.assign_type 失败:', e.message);
    }

    // 迁移：城市经理统一转为销售端角色，不再绑定组织范围
    try {
      sqlDb.run("UPDATE users SET role = 'sales', city_id = NULL WHERE manager_type = 'city_manager'");
      console.log('✅ 迁移: 城市经理统一为销售端角色');
    } catch (e) { /* 忽略 */ }
    // 迁移：插入新增的积分规则（签到）
    const newRules = [
      ['check_in', '每日签到（基础）', 5, '每天签到即可获得积分，连续签到越多奖励越多', 'calendar', 1, 1],
      ['check_in_streak_3', '连续签到3天加成', 10, '连续签到满3天额外奖励', 'flame', 1, 2],
      ['check_in_streak_7', '连续签到7天加成', 20, '连续签到满7天额外奖励', 'fire', 1, 3],
      ['check_in_streak_30', '连续签到30天加成', 50, '连续签到满30天额外奖励', 'crown', 1, 4],
    ];
    // 迁移：插入风采投稿通过积分规则
    const submissionRule = ['submission_approved', '风采投稿通过', 5, '风采投稿审核通过获得积分奖励', 'camera', 1, 11];
    // 迁移：插入分享圈发帖积分规则
    const sharePostRule = ['share_post', '分享圈发帖', 10, '发布分享圈动态可获积分，每日上限20分（最多2次）', 'share', 1, 12];
    // 迁移：插入分享圈置顶奖励规则
    const sharePinRule = ['share_pin', '分享圈内容被置顶', 50, '发布的内容被管理员置顶，额外获得积分奖励', 'star', 1, 13];
    // 迁移：插入跑店问问提问/反馈积分规则
    const aiAskRule = ['ai_ask', '跑店问问提问', 5, '每次提问获得积分；提问与反馈合计每日上限50分（以本行「每日上限」为准）', 'message', 1, 14];
    const aiFeedbackRule = ['ai_feedback', '跑店问问反馈', 5, '对回答做出评价获得积分；提问与反馈合计每日上限50分（以「跑店问问提问」的每日上限为准）', 'star', 1, 15];
    const allNewRules = [...newRules, submissionRule, sharePostRule, sharePinRule, aiAskRule, aiFeedbackRule];
    sqlDb.run("UPDATE point_rules SET points = 10, description = '发布分享圈动态可获积分，每日上限20分（最多2次）', updated_at = datetime('now','localtime') WHERE source_type = 'share_post'");
    // 迁移：给已有规则补默认的每日上限 / 每日次数上限（0 表示不限制，仅在未设置时写入）
    try {
      sqlDb.run("UPDATE point_rules SET daily_limit = 20, daily_max_times = 2 WHERE source_type = 'share_post' AND (daily_limit IS NULL OR daily_limit = 0)");
      sqlDb.run("UPDATE point_rules SET daily_limit = 50 WHERE source_type IN ('ai_ask', 'ai_feedback') AND (daily_limit IS NULL OR daily_limit = 0)");
      sqlDb.run("UPDATE point_rules SET daily_limit = 150, daily_max_times = 10 WHERE source_type = 'training_complete' AND (daily_limit IS NULL OR daily_limit = 0)");
      console.log('✅ 迁移: 积分规则补每日上限默认值');
    } catch (e) { /* 忽略 */ }
    // 迁移：跑店问问每日上限为「提问+反馈」合计，修正旧描述文案
    try {
      sqlDb.run("UPDATE point_rules SET description = '每次提问获得积分；提问与反馈合计每日上限50分（以本行「每日上限」为准）', updated_at = datetime('now','localtime') WHERE source_type = 'ai_ask' AND description LIKE '%该模块每日上限%'");
      sqlDb.run("UPDATE point_rules SET description = '对回答做出评价获得积分；提问与反馈合计每日上限50分（以「跑店问问提问」的每日上限为准）', updated_at = datetime('now','localtime') WHERE source_type = 'ai_feedback' AND description LIKE '%该模块每日上限%'");
      console.log('✅ 迁移: 修正跑店问问积分规则描述（合计上限）');
    } catch (e) { /* 忽略 */ }
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
    // 迁移：回填历史学习记录的 learn_count（已有学习记录默认 +1）
    try {
      sqlDb.run("UPDATE learning_progress SET learn_count = 1 WHERE learn_count = 0 AND (progress > 0 OR completed = 1 OR started_at IS NOT NULL)");
      console.log('✅ 迁移: 回填学习记录的 learn_count');
    } catch (e) { /* 忽略 */ }
    // 迁移：清理历史记录中泄漏的模型思考过程（<think>...</think>，MiniMax 等推理模型会内联进正文）
    try {
      // 1) 开头即思考块的（历史绝大多数）：直接用 SQL 批量处理
      const stripThinkSql = (table, column) => {
        sqlDb.run(`UPDATE ${table}
          SET ${column} = TRIM(SUBSTR(${column}, INSTR(${column}, '</think>') + 8), char(10) || char(13) || char(9) || ' ')
          WHERE ${column} LIKE '<think%' AND INSTR(${column}, '</think>') > 0`);
      };
      stripThinkSql('training_messages', 'content');
      stripThinkSql('ai_feedbacks', 'answer');

      // 2) 思考块夹在正文中间等剩余情况：逐条正则清理
      const stripThinkRegex = (table, column) => {
        let rows = [];
        try {
          const res = sqlDb.exec(`SELECT id, ${column} FROM ${table} WHERE ${column} LIKE '%<think%' LIMIT 2000`);
          rows = (res.length && res[0].values) ? res[0].values : [];
        } catch (_) { return; }
        for (const [id, text] of rows) {
          const cleaned = String(text)
            .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
            .replace(/<think(?:ing)?>[\s\S]*$/i, '')
            .replace(/^\s+/, '');
          if (cleaned !== text) sqlDb.run(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [cleaned, id]);
        }
      };
      stripThinkRegex('training_messages', 'content');
      stripThinkRegex('ai_feedbacks', 'answer');
      console.log('✅ 迁移: 清理历史记录中的思考过程泄漏');
    } catch (e) { /* 忽略 */ }
    // 迁移：为历史风采投稿回填操作日志（一次性，投稿模块已有日志则跳过）
    try {
      const hasSubLog = sqlDb.exec("SELECT 1 FROM activity_logs WHERE module = 'submissions' LIMIT 1");
      if (!(hasSubLog.length && hasSubLog[0].values.length)) {
        const ptRes = sqlDb.exec("SELECT source_id, SUM(points) FROM point_logs WHERE source_type = 'submission' GROUP BY source_id");
        const pointsMap = {};
        if (ptRes.length && ptRes[0].values) ptRes[0].values.forEach(([sid, pts]) => { pointsMap[sid] = pts; });
        const res = sqlDb.exec('SELECT id, user_id, title, category, type, status, reviewed_by, reviewed_at, created_at FROM submissions');
        const rows = (res.length && res[0].values) ? res[0].values : [];
        let backfilled = 0;
        for (const [id, userId, title, category, type, status, reviewedBy, reviewedAt, createdAt] of rows) {
          sqlDb.run(
            `INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip, created_at)
             VALUES (?, ?, 'create', 'submissions', 'submission', ?, ?, NULL, ?)`,
            [uuidv4(), userId, id, JSON.stringify({ title, category, type }), createdAt]
          );
          backfilled++;
          if ((status === 'approved' || status === 'rejected') && reviewedBy && reviewedAt) {
            sqlDb.run(
              `INSERT INTO activity_logs (id, user_id, action, module, target_type, target_id, detail, ip, created_at)
               VALUES (?, ?, ?, 'submissions', 'submission', ?, ?, NULL, ?)`,
              [uuidv4(), reviewedBy, status === 'approved' ? 'approve' : 'reject', id,
                JSON.stringify({ title, submitter_id: userId, points: pointsMap[id] || 0 }), reviewedAt]
            );
            backfilled++;
          }
        }
        if (backfilled > 0) console.log(`✅ 迁移: 回填历史风采投稿操作日志 ${backfilled} 条`);
      }
    } catch (e) { console.error('❌ 迁移 回填投稿日志失败:', e.message); }
  } else {
    // 执行建表
    const statements = SCHEMA.split(';').filter(s => s.trim());
    statements.forEach(sql => { sqlDb.run(sql); });
    // 创建索引
    INDEXES.forEach(sql => { sqlDb.run(sql); });
  }

  const db = new Database(driverRaw, useBetter ? 'better' : 'sqljs');
  dbInstance = db;

  initializeRegions(db);
  if (withSeed) seed(db);

  // sql.js 需要把内存库整体导出写回文件；better-sqlite3 已在磁盘上，无需处理
  if (!useBetter) {
    const data = sqlDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  console.log(`✅ 数据库初始化完成（驱动: ${useBetter ? 'better-sqlite3' : 'sql.js'}）:`, DB_PATH);
  return db;
}

// 保存数据库到文件
let dbDirty = false;
let dbSaving = false;      // 是否有一次异步落盘正在进行
let dbSavePending = false; // 落盘期间又有新改动，完成后补一次

// 当前是否使用原生驱动（数据即时落盘，无需整库导出）
function isNativeDriver() {
  return !!(dbInstance && dbInstance._kind === 'better');
}

function markDbDirty() {
  dbDirty = true;
}

// 导出整库快照（export 本身是同步内存复制，sql.js 无法避免，但通常仅数百毫秒）
function exportSnapshot() {
  const data = dbInstance._db.export();
  // export() 已经把整库复制成一份 Uint8Array；Buffer.from(Uint8Array) 会再复制一份，
  // 数据库较大时内存峰值会翻倍（曾把 PM2 内存上限顶爆导致进程反复重启）。
  // 这里用零拷贝视图直接写出，避免第二次复制。
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

// 临时文件 + rename 原子替换：写一半被杀也不会破坏原库
function atomicWriteSync(buf) {
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, buf);
  fs.renameSync(tmpPath, DB_PATH);
}

// 异步落盘：整库数百 MB，用 writeFileSync 同步写会在内核回写限流时把事件循环
// 阻塞几十秒，导致所有接口（含健康检查）一起超时。改为异步写 + 原子替换。
function saveDb(force = false) {
  if (!dbInstance) return;

  // better-sqlite3：写入已增量落盘，这里只需要把 WAL 合并回主库，避免 WAL 无限增长
  if (isNativeDriver()) {
    try {
      dbInstance._db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.error('WAL checkpoint 失败:', e.message);
    }
    dbDirty = false;
    return;
  }

  if (!force && !dbDirty) return;
  if (dbSaving) { dbSavePending = true; return; }

  dbSaving = true;
  dbDirty = false;

  let buf;
  try {
    buf = exportSnapshot();
  } catch (e) {
    console.error('数据库导出失败:', e.message);
    dbDirty = true;
    dbSaving = false;
    return;
  }

  const tmpPath = `${DB_PATH}.tmp`;
  const startedAt = Date.now();
  const done = () => {
    dbSaving = false;
    if (dbSavePending) { dbSavePending = false; saveDb(true); }
  };

  fs.writeFile(tmpPath, buf, (writeErr) => {
    if (writeErr) {
      console.error('数据库保存失败:', writeErr.message);
      dbDirty = true;
      done();
      return;
    }
    fs.rename(tmpPath, DB_PATH, (renameErr) => {
      if (renameErr) {
        console.error('数据库替换失败:', renameErr.message);
        dbDirty = true;
      } else {
        const cost = Date.now() - startedAt;
        if (cost > 5000) {
          console.warn(`⚠️  数据库落盘耗时 ${(cost / 1000).toFixed(1)}s（库 ${(buf.length / 1048576).toFixed(0)}MB）`);
        }
      }
      done();
    });
  });
}

// 进程退出时同步落盘（异步写还没完成就退出了，会丢数据）
function saveDbSync() {
  if (!dbInstance) return;

  // better-sqlite3：数据已在磁盘，退出前把 WAL 合并回主库即可
  if (isNativeDriver()) {
    try {
      dbInstance._db.pragma('wal_checkpoint(TRUNCATE)');
      dbInstance._db.close();
    } catch (e) {
      console.error('退出时 checkpoint 失败:', e.message);
    }
    return;
  }

  try {
    atomicWriteSync(exportSnapshot());
  } catch (e) {
    console.error('数据库保存失败(退出):', e.message);
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

module.exports = { DB_PATH, initDatabase, getDb, saveDb, saveDbSync, markDbDirty, Database, REGION_DATA };
