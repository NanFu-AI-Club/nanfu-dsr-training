# 南孚DSR销售培训系统 - 开发文档

> 版本: 1.0.0
> 最后更新: 2025年

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术架构](#2-技术架构)
3. [环境搭建](#3-环境搭建)
4. [数据库设计](#4-数据库设计)
5. [API接口文档](#5-api接口文档)
6. [核心功能模块](#6-核心功能模块)
7. [开发规范](#7-开发规范)
8. [部署指南](#8-部署指南)

---

## 1. 项目概述

### 1.1 项目背景

南孚DSR销售培训系统是一个面向销售业务员的在线培训平台，旨在通过游戏化的方式提升销售人员的产品知识、销售技能和实战能力。

### 1.2 核心功能

| 模块 | 功能描述 |
|------|----------|
| 知识库 | 产品知识、销售技巧、公司制度的文档管理系统 |
| 题库答题 | 单选、多选、判断题的闯关答题系统 |
| 课程学习 | 视频、PPT、PDF等多种形式的学习课程 |
| AI销售陪练 | 基于GPT的智能对话陪练系统 |
| 积分激励 | 签到、答题、学习获得积分，兑换奖励 |
| 社区互动 | 分享圈、AI问答、用户风采投稿 |

### 1.3 用户角色

| 角色 | 权限说明 |
|------|----------|
| admin (管理员) | 用户管理、内容管理、数据统计、系统配置 |
| sales (销售业务员) | 学习课程、答题闯关、AI陪练、积分商城 |

---

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (React + Vite)                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │ 管理端  │ │ 学习端  │ │ 答题端  │ │ 陪练端  │ │ 商城端 │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ │
└───────┼──────────┼──────────┼──────────┼──────────┼───────┘
        │          │          │          │          │
        └──────────┴──────────┼──────────┴──────────┘
                              │
                    ┌─────────▼─────────┐
                    │   API Gateway     │
                    │   (Express.js)    │
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
  ┌─────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐
  │ 认证中间件 │         │ 业务路由  │         │ 安全中间件 │
  │   (JWT)   │         │ (16个模块)│         │(限流/验证)│
  └───────────┘         └─────┬─────┘         └───────────┘
                              │
                    ┌─────────▼─────────┐
                    │   数据访问层       │
                    │   (sql.js)        │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │   SQLite 数据库    │
                    │   (30张表)        │
                    └───────────────────┘
```

### 2.2 技术栈

#### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.3.1 | 前端框架 |
| Vite | 6.0.3 | 构建工具 |
| React Router | 6.28.0 | 路由管理 |
| Tailwind CSS | 3.4.17 | 样式框架 |
| Recharts | 2.15.0 | 图表库 |
| Axios | 1.7.9 | HTTP客户端 |
| Lucide React | 0.468.0 | 图标库 |
| PDF.js | 6.1.200 | PDF预览 |

#### 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Express.js | 4.21.1 | Web框架 |
| sql.js | 1.12.0 | SQLite数据库 (WASM) |
| better-sqlite3 | 13.0.1 | SQLite数据库 (原生) |
| JWT | 9.0.2 | 身份认证 |
| bcryptjs | 2.4.3 | 密码加密 |
| Multer | 1.4.5 | 文件上传 |
| 腾讯云COS SDK | 3.0.0 | 云存储 |
| xlsx | 0.18.5 | Excel导入导出 |

### 2.3 目录结构

```
nanfu-dsr-training/
├── client/                     # 前端项目
│   ├── public/                 # 静态资源
│   │   ├── pdfjs/              # PDF.js库
│   │   └── templates/          # 导入模板
│   ├── src/
│   │   ├── api/                # API封装
│   │   ├── components/         # 公共组件
│   │   ├── contexts/           # React Context
│   │   ├── layouts/            # 布局组件
│   │   ├── pages/              # 页面组件
│   │   │   ├── admin/          # 管理员页面
│   │   │   └── sales/          # 业务员页面
│   │   ├── App.jsx             # 路由配置
│   │   └── main.jsx            # 入口文件
│   └── package.json
│
├── server/                     # 后端项目
│   ├── data/                   # 数据库文件
│   │   └── nanfu_dsr.db
│   ├── middleware/             # 中间件
│   │   ├── auth.js             # 认证中间件
│   │   └── security.js         # 安全中间件
│   ├── routes/                 # 路由模块 (16个)
│   │   ├── auth.js             # 认证
│   │   ├── users.js            # 用户管理
│   │   ├── knowledge.js        # 知识库
│   │   ├── questions.js        # 题库
│   │   ├── exams.js            # 考试
│   │   ├── courses.js          # 课程
│   │   ├── training.js         # AI陪练
│   │   ├── ai.js               # AI问答
│   │   ├── checkin.js          # 签到
│   │   ├── shop.js             # 积分商城
│   │   ├── statistics.js       # 数据统计
│   │   ├── dashboard.js        # 仪表盘
│   │   ├── logs.js             # 操作日志
│   │   ├── submissions.js      # 风采投稿
│   │   ├── shares.js           # 分享圈
│   │   └── video-proxy.js      # 视频代理
│   ├── services/               # 业务服务
│   │   ├── cos.js              # 腾讯云COS
│   │   ├── tencent_asr.js      # 腾讯云ASR
│   │   └── voice.js            # 语音服务
│   ├── utils/                  # 工具函数
│   ├── database.js             # 数据库初始化
│   ├── index.js                # 服务入口
│   └── package.json
│
└── package.json                # 根项目配置
```

---

## 3. 环境搭建

### 3.1 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- 操作系统: macOS / Linux / Windows

### 3.2 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd nanfu-dsr-training

# 2. 安装依赖
npm install
cd server && npm install
cd ../client && npm install
cd ..

# 3. 初始化数据库 (含种子数据)
cd server
npm run db:init

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置必要参数

# 5. 启动开发服务器
cd server && npm run dev    # 后端 (http://localhost:3030)
cd client && npm run dev    # 前端 (http://localhost:5173)
```

### 3.3 环境变量

创建 `server/.env` 文件：

```env
# 服务配置
NODE_ENV=development
PORT=3030

# 安全配置
JWT_SECRET=your-jwt-secret-key-change-in-production
CORS_ORIGIN=http://localhost:5173

# AI配置 (可选)
OPENAI_API_KEY=your-openai-api-key
OPENAI_API_BASE=https://api.openai.com/v1

# 腾讯云配置 (可选)
TENCENT_SECRET_ID=your-secret-id
TENCENT_SECRET_KEY=your-secret-key
COS_BUCKET=your-bucket-name
COS_REGION=ap-shanghai
```

### 3.4 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | admin | admin123 |
| 业务员 | sales01 | sales123 |

**⚠️ 生产环境务必修改默认密码！**

---

## 4. 数据库设计

### 4.1 数据库概览

系统使用 SQLite 数据库，共 **30张表**，采用 sql.js (WASM) 实现，支持内存运行和文件持久化。

### 4.2 核心表结构

#### users (用户表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 (UUID) |
| username | TEXT | 用户名 (唯一) |
| password | TEXT | 密码 (bcrypt加密) |
| real_name | TEXT | 真实姓名 |
| role | TEXT | 角色 (admin/sales) |
| phone | TEXT | 电话 |
| email | TEXT | 邮箱 |
| group_id | TEXT | 分组ID |
| avatar | TEXT | 头像URL |
| status | TEXT | 状态 (active/inactive) |
| points | INTEGER | 当前积分 |
| total_earned_points | INTEGER | 累计积分 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

#### kb_documents (知识库文档表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| category_id | TEXT | 分类ID |
| title | TEXT | 标题 |
| content | TEXT | 内容 |
| version | INTEGER | 版本号 |
| is_current | INTEGER | 是否当前版本 |
| status | TEXT | 状态 (draft/published/archived) |
| created_by | TEXT | 创建人ID |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

#### questions (题库表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| type | TEXT | 题型 (single/multiple/judge) |
| category | TEXT | 分类 |
| content | TEXT | 题目内容 |
| options | TEXT | 选项 (JSON) |
| answer | TEXT | 答案 |
| analysis | TEXT | 解析 |
| difficulty | TEXT | 难度 (easy/medium/hard) |
| tags | TEXT | 标签 (JSON) |
| status | TEXT | 状态 (active/inactive) |
| created_by | TEXT | 创建人ID |

#### courses (课程表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| title | TEXT | 标题 |
| type | TEXT | 类型 (video/ppt/pdf) |
| description | TEXT | 描述 |
| cover_url | TEXT | 封面URL |
| resource_url | TEXT | 资源URL |
| duration | INTEGER | 时长(分钟) |
| category | TEXT | 分类 |
| tags | TEXT | 标签 (JSON) |
| status | TEXT | 状态 (draft/published/archived) |

#### training_scenarios (AI陪练场景表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| title | TEXT | 场景标题 |
| description | TEXT | 场景描述 |
| role_type | TEXT | AI角色类型 |
| scenario_prompt | TEXT | 场景提示词 |
| sales_goal | TEXT | 销售目标 |
| difficulty | TEXT | 难度 |
| status | TEXT | 状态 |

#### point_rules (积分规则表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| action | TEXT | 行为标识 |
| source_type | TEXT | 来源类型 |
| points | INTEGER | 积分值 |
| description | TEXT | 描述 |
| icon | TEXT | 图标 |
| enabled | INTEGER | 是否启用 |
| sort_order | INTEGER | 排序 |

### 4.3 表关系

```
users ─────┬─────> groups (分组)
           │
           ├──> learning_progress (学习进度)
           ├──> exam_records (考试记录)
           ├──> training_sessions (陪练会话)
           ├──> point_logs (积分日志)
           ├──> check_ins (签到记录)
           ├──> submissions (风采投稿)
           └──> shop_orders (兑换订单)

kb_documents ───> kb_categories (知识库分类)
              └──> kb_versions (文档版本)

questions ───> exam_questions (考试题目)
            └──> exams (考试)

training_scenarios ───> training_sessions (陪练会话)
                      └──> training_messages (对话消息)
```

---

## 5. API接口文档

### 5.1 接口规范

#### 基础URL

```
开发环境: http://localhost:3030/api
生产环境: https://your-domain.com/api
```

#### 认证方式

使用 JWT Token 认证，在请求头中携带：

```
Authorization: Bearer <token>
```

#### 响应格式

```json
{
  "code": 0,          // 0表示成功，非0表示错误
  "message": "成功",   // 提示信息
  "data": {}          // 响应数据
}
```

#### 错误码

| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未认证/认证失败 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

### 5.2 认证接口

#### POST /api/auth/login

用户登录

**请求体:**

```json
{
  "username": "admin",
  "password": "admin123"
}
```

**响应:**

```json
{
  "code": 0,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "xxx",
      "username": "admin",
      "real_name": "系统管理员",
      "role": "admin"
    }
  }
}
```

#### GET /api/auth/me

获取当前用户信息

**请求头:**

```
Authorization: Bearer <token>
```

**响应:**

```json
{
  "code": 0,
  "data": {
    "id": "xxx",
    "username": "admin",
    "real_name": "系统管理员",
    "role": "admin",
    "points": 100
  }
}
```

#### PUT /api/auth/password

修改密码

**请求体:**

```json
{
  "old_password": "admin123",
  "new_password": "newpassword"
}
```

### 5.3 用户管理接口

#### GET /api/users

获取用户列表 (管理员)

**查询参数:**

- `page`: 页码 (默认1)
- `pageSize`: 每页条数 (默认20)
- `role`: 角色筛选
- `group_id`: 分组筛选
- `keyword`: 搜索关键词

#### POST /api/users

创建用户 (管理员)

**请求体:**

```json
{
  "username": "newuser",
  "password": "password123",
  "real_name": "新用户",
  "role": "sales",
  "phone": "13800138000",
  "group_id": "group_id"
}
```

#### PUT /api/users/:id

更新用户信息 (管理员)

#### DELETE /api/users/:id

删除用户 (管理员)

### 5.4 知识库接口

#### GET /api/knowledge/categories

获取知识库分类列表

#### GET /api/knowledge/documents

获取文档列表

**查询参数:**

- `category_id`: 分类ID
- `keyword`: 搜索关键词
- `page`: 页码
- `pageSize`: 每页条数

#### POST /api/knowledge/documents

创建文档 (管理员)

#### PUT /api/knowledge/documents/:id

更新文档 (管理员)

#### DELETE /api/knowledge/documents/:id

删除文档 (管理员)

### 5.5 题库接口

#### GET /api/questions

获取题目列表

#### POST /api/questions

创建题目 (管理员)

**请求体:**

```json
{
  "type": "single",
  "category": "产品知识",
  "content": "南孚电池的核心技术是什么?",
  "options": ["聚能环", "双核动力", "锁电宝", "智慧芯"],
  "answer": "A",
  "analysis": "聚能环是南孚的核心技术...",
  "difficulty": "medium"
}
```

#### POST /api/questions/import

批量导入题目 (管理员)

### 5.6 考试接口

#### GET /api/exams

获取考试列表

#### POST /api/exams

创建考试 (管理员)

#### POST /api/exams/:id/start

开始考试

#### POST /api/exams/:id/submit

提交考试答案

### 5.7 课程接口

#### GET /api/courses

获取课程列表

#### GET /api/courses/:id

获取课程详情

#### POST /api/courses/:id/progress

更新学习进度

### 5.8 AI陪练接口

#### GET /api/training/scenarios

获取陪练场景列表

#### POST /api/training/sessions

开始陪练会话

**请求体:**

```json
{
  "scenario_id": "scenario_id"
}
```

#### POST /api/training/sessions/:id/chat

发送消息

**请求体:**

```json
{
  "content": "您好，我是南孚的销售代表..."
}
```

#### POST /api/training/sessions/:id/end

结束陪练并生成报告

### 5.9 AI问答接口

#### POST /api/ai/chat

AI智能问答

**请求体:**

```json
{
  "question": "南孚电池的卖点是什么?",
  "conversation_id": "optional_conversation_id"
}
```

### 5.10 积分商城接口

#### GET /api/shop/products

获取可兑换商品列表

#### POST /api/shop/orders

兑换商品

**请求体:**

```json
{
  "product_id": "product_id",
  "recipient_name": "张三",
  "recipient_phone": "13800138000",
  "recipient_address": "上海市xxx"
}
```

### 5.11 签到接口

#### POST /api/checkin

每日签到

#### GET /api/checkin/status

获取签到状态

### 5.12 统计接口

#### GET /api/statistics/overview

获取数据概览 (管理员)

#### GET /api/statistics/learning

获取学习统计

#### GET /api/statistics/points

获取积分统计

---

## 6. 核心功能模块

### 6.1 认证模块

**文件:** `server/middleware/auth.js`

**功能:**

- JWT Token 生成与验证
- 用户身份认证中间件 `authRequired`
- 管理员权限验证中间件 `adminRequired`

**关键代码:**

```javascript
// Token签名
const signToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// 认证中间件
const authRequired = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ code: 401, message: '请先登录' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: 'Token无效或已过期' });
  }
};
```

### 6.2 安全模块

**文件:** `server/middleware/security.js`

**功能:**

- API 请求限流
- 登录速率限制 (防暴力破解)
- 输入净化
- 安全响应头

**关键代码:**

```javascript
// 登录限流: 每分钟最多5次
const loginLimiter = (max, windowMs) => {
  const attempts = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const userAttempts = attempts.get(key) || [];
    const recentAttempts = userAttempts.filter(t => now - t < windowMs);

    if (recentAttempts.length >= max) {
      return res.status(429).json({ code: 429, message: '尝试次数过多，请稍后再试' });
    }

    attempts.set(key, [...recentAttempts, now]);
    next();
  };
};
```

### 6.3 AI陪练模块

**文件:** `server/routes/training.js`, `server/services/voice.js`

**功能:**

- 场景管理: 创建陪练场景，配置AI角色和提示词
- 会话管理: 开始/结束陪练会话
- 对话管理: 用户消息、AI回复、上下文管理
- 语音识别: 腾讯云ASR语音转文字
- 报告生成: 自动生成陪练评估报告

**技术要点:**

1. **上下文管理:** 保存历史对话，支持多轮对话
2. **流式响应:** 支持SSE流式返回AI回复
3. **语音集成:** 前端录音 → ASR转文字 → GPT回复 → TTS转语音

### 6.4 积分系统

**文件:** `server/routes/checkin.js`, `server/routes/shop.js`

**积分规则:**

| 行为 | 积分 |
|------|------|
| 每日签到 | +5分 |
| 连续3天签到 | +10分 |
| 连续7天签到 | +20分 |
| 连续30天签到 | +50分 |
| 答题正确 | +10分 |
| 完成课程 | +5分起 |
| 完成陪练 | +10分 |
| 风采投稿通过 | +5分 |

**关键逻辑:**

```javascript
// 连续签到判断
const getLastCheckIn = (userId) => {
  return db.prepare(`
    SELECT check_date FROM check_ins
    WHERE user_id = ?
    ORDER BY check_date DESC LIMIT 1
  `).get(userId);
};

const isConsecutive = (lastDate) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return lastDate === yesterday.toISOString().split('T')[0];
};
```

### 6.5 知识库RAG

**文件:** `server/routes/ai.js`

**功能:**

- 文档检索: 基于关键词匹配的知识库检索
- 智能问答: GPT-4o-mini 模型 + 知识库上下文
- 引用标注: 返回答案来源文档

**流程:**

```
用户提问 → 关键词提取 → 知识库检索 → 构建Prompt → GPT生成答案 → 返回结果+引用
```

---

## 7. 开发规范

### 7.1 代码规范

#### 命名规范

- 文件名: 小写+连字符 `user-management.js`
- 组件名: 大驼峰 `UserManagement.jsx`
- 函数名: 小驼峰 `getUserList`
- 常量名: 全大写+下划线 `MAX_PAGE_SIZE`
- 数据库表名: 小写+下划线 `kb_documents`

#### 注释规范

```javascript
/**
 * 函数功能说明
 * @param {string} userId - 用户ID
 * @param {object} options - 配置选项
 * @returns {Promise<object>} 返回结果
 */
async function getUserInfo(userId, options) {
  // 实现逻辑
}
```

### 7.2 Git规范

#### 分支命名

- `main`: 主分支
- `develop`: 开发分支
- `feature/xxx`: 功能分支
- `bugfix/xxx`: 修复分支
- `release/x.x.x`: 发布分支

#### 提交信息

```
feat: 新增AI陪练场景管理
fix: 修复登录接口参数验证问题
docs: 更新API接口文档
style: 统一代码格式
refactor: 重构积分计算逻辑
test: 添加用户管理单元测试
chore: 更新依赖版本
```

### 7.3 接口规范

#### RESTful设计

- `GET /api/users`: 获取用户列表
- `GET /api/users/:id`: 获取单个用户
- `POST /api/users`: 创建用户
- `PUT /api/users/:id`: 更新用户
- `DELETE /api/users/:id`: 删除用户

#### 分页参数

```javascript
const page = parseInt(req.query.page) || 1;
const pageSize = parseInt(req.query.pageSize) || 20;
const offset = (page - 1) * pageSize;

const list = db.prepare(`
  SELECT * FROM users
  LIMIT ? OFFSET ?
`).all(pageSize, offset);
```

### 7.4 安全规范

#### 密码安全

- 最小长度: 6位
- bcrypt加密: 轮数 >= 10
- 禁止明文存储

#### Token安全

- 有效期: 7天
- 刷新机制: 前端401响应时重新登录
- 存储位置: localStorage (生产环境建议使用HttpOnly Cookie)

#### 输入验证

- 所有用户输入必须验证和净化
- SQL参数化查询，禁止拼接字符串
- 文件上传类型、大小限制

---

## 8. 部署指南

### 8.1 构建生产版本

```bash
# 前端构建
cd client
npm run build

# 后端准备
cd ../server
# 确保 data 目录存在
mkdir -p data
```

构建后前端静态文件在 `client/dist` 目录。

### 8.2 环境配置

生产环境 `.env`:

```env
NODE_ENV=production
PORT=3030
JWT_SECRET=生产环境密钥-请使用强随机字符串
CORS_ORIGIN=https://your-domain.com
```

### 8.3 启动服务

```bash
cd server
npm start
```

服务启动后访问: `http://localhost:3030`

### 8.4 Nginx反向代理 (推荐)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/nanfu-dsr-training/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # API代理
    location /api {
        proxy_pass http://127.0.0.1:3030;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 上传文件代理
    location /uploads {
        proxy_pass http://127.0.0.1:3030;
    }
}
```

### 8.5 PM2进程管理

```bash
# 安装PM2
npm install -g pm2

# 启动应用
cd server
pm2 start index.js --name nanfu-dsr

# 查看状态
pm2 status

# 查看日志
pm2 logs nanfu-dsr
```

### 8.6 数据备份

```bash
# 备份数据库
cp server/data/nanfu_dsr.db server/data/nanfu_dsr_backup_$(date +%Y%m%d).db

# 定时备份脚本 (crontab)
0 2 * * * cp /path/to/server/data/nanfu_dsr.db /backup/nanfu_dsr_$(date +\%Y\%m\%d).db
```

### 8.7 监控告警

建议监控指标:

- 服务存活状态 (健康检查: `/api/health`)
- 响应时间 (P99 < 500ms)
- 错误率 (< 1%)
- 内存使用 (< 80%)
- 数据库大小

---

## 附录

### A. 常见问题

#### Q1: 数据库文件丢失怎么办?

A: 数据库文件位于 `server/data/nanfu_dsr.db`，定期备份。如丢失，重新初始化:

```bash
cd server
npm run db:init
```

#### Q2: AI陪练不响应?

A: 检查以下配置:

1. `.env` 中的 `OPENAI_API_KEY` 是否配置
2. 网络是否能访问 OpenAI API
3. AI配置表中是否启用了模型

#### Q3: 前端路由404?

A: 生产环境需要配置服务器回退到 `index.html` (Nginx配置见8.4节)。

### B. 技术支持

- 项目地址: `<repository-url>`
- 问题反馈: 提交 Issue
- 文档更新: 2025年

---

**© 南孚DSR销售培训系统开发团队**