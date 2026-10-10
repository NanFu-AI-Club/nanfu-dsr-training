/* ============================================================
   RAG 知识库管理模块
   基于 BGE-M3 向量语义检索（Silicon Flow Embedding），
   关键词倒排索引作为无 Embedding 时的降级兜底
   ============================================================ */

// ============ 知识库数据 ============
// 静态知识库：来自 PDF 文档的核心内容（无法前端解析 PDF，故手动提取）
const STATIC_KNOWLEDGE_BASE = [
  // ===== 处理反对意见 =====
  {
    id: 'handling_objections_overview',
    title: '处理反对意见四步骤概述',
    keywords: ['处理反对意见', '反对意见', '拒绝', '异议', 'D_U_V_H', '确定理解转化处理'],
    content: `## 处理反对意见四步骤

**前置原则**：不要见火就扑！良好的客户渗透是预处理反对意见的最佳方式。越让对方说，越容易处理反对意见。

### 四步骤流程

| 步骤 | 英文 | 名称 | 核心动作 |
|------|------|------|---------|
| 第一步 | Define | 确定真正的反对意见 | "除了这个还有别的原因吗？"直到对方说"没有了" |
| 第二步 | Understand | 理解反对意见 | 复述确认，问清细节，不急于反驳 |
| 第三步 | Verify | 转化为可解决的问题 | "如果这个问题解决了，您愿意进货吗？" |
| 第四步 | Handle | 处理反对意见 | 简明扼要，给出具体可验证的方案 |

### 关键技巧
- 熟能生巧：处理反对意见的最佳方式是多练习
- 先确定后处理：很多"反对意见"其实是借口，要穷尽追问
- 转化是关键：把"价格贵"转化为"利润够不够"的问题`
  },
  {
    id: 'handling_objections_define',
    title: '处理反对意见第一步：确定（Define）',
    keywords: ['确定', 'Define', '穷尽', '除了这个', '真正原因', '挖掘'],
    content: `## 第一步：确定真正的反对意见

**核心动作**：穷尽追问，直到对方承认"没有了"

### 标准话术
- "您刚才说价格贵，除了这个还有别的原因吗？"
- "还有其他顾虑吗？"
- "如果价格合适了，您还有其他考虑吗？"

### 常见错误
- ❌ 见火就扑：听到一个反对意见马上解释
- ❌ 假设原因：自己猜测对方为什么拒绝
- ❌ 急于辩解：还没确定问题就开始处理

### 判断标准
- 对方说"没有了，就这个"
- 对方开始详细描述具体顾虑
- 对方的表情从抗拒转为思考`
  },
  {
    id: 'handling_objections_understand',
    title: '处理反对意见第二步：理解（Understand）',
    keywords: ['理解', 'Understand', '复述', '确认', '倾听', '细节'],
    content: `## 第二步：理解反对意见

**核心动作**：复述确认，问清细节，不急于反驳

### 标准话术
- "您是说担心打火机打不着，还是担心利润不够？"
- "能具体说说您的顾虑吗？"
- "我理解您的意思是……对吗？"

### 关键技巧
- **复述确认**：用自己的话重述对方的顾虑
- **追问细节**：问清具体是哪个点有问题
- **倾听不反驳**：这一步只理解，不解释

### 判断标准
- 对方说"对，就是这个"
- 你能清楚复述对方的具体顾虑
- 双方对"问题是什么"达成共识`
  },
  {
    id: 'handling_objections_verify',
    title: '处理反对意见第三步：转化（Verify）',
    keywords: ['转化', 'Verify', '如果解决', '愿意进货', '假设性问题', '成交条件'],
    content: `## 第三步：转化为可解决的问题

**核心动作**：把反对意见转化为明确的成交条件

### 标准话术
- "如果利润问题解决了，您愿意拿两盒试试吗？"
- "如果我能证明这个打火机防风效果好，您愿意进货吗？"
- "您说价格贵，是担心卖不动还是觉得进价高？"

### 转化技巧
- **假设性提问**：把反对意见变成条件
- **具体化问题**：把笼统的"贵"变成具体的"利润多少"
- **锁定承诺**：确认如果问题解决，对方愿意行动

### 判断标准
- 对方给出明确条件："如果利润有30%，我愿意进"
- 问题从模糊变具体："卖不动"变成"没人买打火机"`
  },
  {
    id: 'handling_objections_handle',
    title: '处理反对意见第四步：处理（Handle）',
    keywords: ['处理', 'Handle', '解决', '回应', '方案', '证据'],
    content: `## 第四步：处理反对意见

**核心动作**：简明扼要，给出具体可验证的方案

### 处理原则
- **简明扼要**：不要长篇大论
- **具体可验证**：给数据、案例、承诺
- **了解业务**：把问题转化为利益

### 常见反对意见处理示例

#### 1. "价格贵/利润低"
- 转化："您是担心卖不动还是觉得进价高？"
- 处理："卡塔打火机卖3元，进价2元，利润50%。杂牌卖2元进价1.5元，利润33%。而且防风机客单价高，消费者更愿意买。"

#### 2. "卖不动/没人买"
- 转化："如果一个月能卖完，您愿意进吗？"
- 处理："我给您配试销装，两盒共40支。同类门店一周能卖15-20支。一个月卖不完我帮您调货。"

#### 3. "没地方放/货架满了"
- 转化："如果给您找个好位置，您愿意试试吗？"
- 处理："收银口挂条只要10cm，不影响现有陈列。而且防风机比普通打火机吸睛，消费者自己会拿。"

#### 4. "已有类似产品/有竞品了"
- 转化："您现在卖的是什么牌子？"
- 处理："杂牌打火机质量不稳定，消费者投诉多。卡塔是南孚旗下品牌，防风效果有保障，陈小春代言有认知度。"`
  },

  // ===== 客户渗透 =====
  {
    id: 'customer_penetration_overview',
    title: '客户渗透概述',
    keywords: ['客户渗透', '渗透', '信任', '关系', '了解客户', '信息收集'],
    content: `## 客户渗透（Customer Penetration）

**定义**：取得客户信任的一种途径——了解客户需求，才能做有效的说服性销售。

**核心信念**：一家企业的成败取决于客户。

### 客户渗透的 5 种信息类型

| 层次 | 信息类型 | 具体内容 |
|------|---------|---------|
| 1 | OGSM | 目标、目标、策略、衡量 |
| 2 | 财务数据 | 销量、毛利、库存周转 |
| 3 | 系统流程 | 进货流程、决策流程、支付流程 |
| 4 | 企业文化 | 老板性格、团队氛围、经营理念 |
| 5 | 个人关系 | 家庭、兴趣、价值观、信任程度 |

### 客户渗透三步法
1. **拉近距离**：自信主动、能吃苦、有诺必践
2. **从小事做起**：帮老板理货、调整陈列、解决小问题
3. **用业绩赢信任**：帮客户调研规划市场、共同开发网点、提高经营管理水平`
  },
  {
    id: 'customer_penetration_ogsm',
    title: '客户渗透第一层：OGSM',
    keywords: ['OGSM', '目标', '策略', '衡量', '经营目标', '年度计划'],
    content: `## 客户渗透第一层：OGSM

**OGSM** = Objective（目的）+ Goal（目标）+ Strategy（策略）+ Measure（衡量）

### 需要了解的信息
- 老板今年想达成什么目标？（销量、利润、扩张）
- 有哪些具体的量化指标？
- 准备用什么策略实现？
- 怎么衡量是否达成？

### 获取方式
- 直接询问："老板，今年生意有什么目标吗？"
- 观察推断：看门店规模、货架数量、客流情况
- 侧面了解：问员工、看进货记录

### 示例
- 目标："今年想开第二家店"
- 策略："多进货降低成本、提高周转"
- 衡量："年底前攒够20万启动资金"

**价值**：知道客户的目标，才能把你的产品和对方的目标联系起来。`
  },
  {
    id: 'customer_penetration_ipad',
    title: 'IPAD 经销商评估模型',
    keywords: ['IPAD', '经销商', '评估', '客户质量', '拓展型', '能力评估'],
    content: `## IPAD 经销商评估模型

用于评估经销商是否具备**拓展型**特征。

### IPAD 四维度

| 维度 | 英文 | 含义 | 权重 | 评估问题 |
|------|------|------|------|---------|
| **I** | Ideas | 老板有想法 | 35% | 有没有扩张意愿？想不想做大？ |
| **P** | People | 团队有能力 | 20% | 有没有业务员？团队能不能配合？ |
| **A** | Access | 终端有影响 | 30% | 下游网点多不多？影响力大不大？ |
| **D** | Data | 系统有支持 | 15% | 有没有进销存系统？数据化管理？ |

### 评分标准
- **I（想法）**：主动问你有没有新品？→ 高分
- **P（团队）**：有专门业务员跑店？→ 高分
- **A（影响）**：覆盖50+终端网点？→ 高分
- **D（数据）**：用软件管理库存？→ 高分

### 应用
- 高分客户：重点投入资源，深度合作
- 低分客户：维持关系，等待时机`
  },

  // ===== 说服性销售 =====
  {
    id: 'persuasive_selling_overview',
    title: '说服性销售五步骤概述',
    keywords: ['说服性销售', '说服性', '销售呈现', '五步骤', 'PSS', '卖进'],
    content: `## 说服性销售五步骤

说服性销售（Persuasive Selling Skills）是宝洁的核心销售方法论。

### 五步骤流程

| 步骤 | 名称 | 核心动作 | 关键要求 |
|------|------|---------|---------|
| 1 | 概述情况 | 描述现状和需求 | **严禁出现产品名/品牌名** |
| 2 | 陈述主意 | 提出你的建议 | 清晰具体，一句话说清 |
| 3 | 解释运作 | 说明怎么执行 | 步骤清晰，逻辑连贯 |
| 4 | 强调利益 | 讲清好处 | 用客户关心的指标 |
| 5 | 建议下一步 | 推动行动 | 给出明确可执行的动作 |

### 核心原则
- **第一步最关键**：概述情况要基于客户渗透拿到的事实，让老板自己意识到"我有问题需要解决"
- **严禁推销**：第一步绝不能出现产品名、品牌名、公司名
- **利益具体**：不要说"赚钱"，要说"利润提高30%"`
  },
  {
    id: 'persuasive_selling_step1',
    title: '说服性销售第一步：概述情况',
    keywords: ['概述情况', '概述', 'FABE', '需求分析', '问题呈现', '严禁品牌名'],
    content: `## 第一步：概述情况

**核心动作**：基于客户渗透拿到的事实，描述门店/顾客的现状和需求

### ❌ 严禁出现
- 产品名称（卡塔、南孚、丰蓝）
- 品牌名称（南孚集团）
- 公司名称

### ✅ 应该呈现
- 客流特点："小区门口人流量大，主要是下班族"
- 消费人群："年轻人多，喜欢尝试新东西"
- 现有产品缺口："店里打火机只有杂牌，1-2元的"
- 陈列问题："打火机放在角落，消费者不容易看到"

### FABE 加工观察结果
- **F（特征）**：门店位置、客流、现有产品
- **A（优势）**：人流量大、年轻人多、消费力强
- **B（利益）**：消费者愿意为品质买单、客单价可以更高
- **E（证据）**：同类门店的数据、案例

### 目的
让老板自己意识到："我的店有这个问题，需要解决"`
  },
  {
    id: 'persuasive_selling_step5',
    title: '说服性销售第五步：建议下一步',
    keywords: ['建议下一步', '下一步', '成交', '行动', '试销', '签约'],
    content: `## 第五步：建议下一步

**核心动作**：给出明确、可执行、低门槛的行动建议

### 常见下一步选项
- 试销："先拿两盒试卖，一周看看效果"
- 陈列调整："我帮您把打火机挂到收银口，试试一天"
- 签约："我们签个季度协议，保证供货稳定"
- 促销："下周搞个促销活动，我帮您准备物料"

### 关键技巧
- **低门槛**：不要一上来就"进一箱"，先试销
- **具体可执行**：给明确的时间、数量、动作
- **有承诺**："我下周二来补货""卖不完可以调货"

### 示例话术
- "老板，要不这样，我给您配两盒试销装，共40支。放收银口试试，一周看看动销。下周二我再来，卖不完我帮您调其他店。"`
  },

  // ===== 话术三板斧 =====
  {
    id: 'three_axes_overview',
    title: '话术三板斧框架',
    keywords: ['话术三板斧', '三板斧', '确定性', '领先性', '行动性', '话术'],
    content: `## 话术三板斧框架

话术三板斧是南孚集团的销售话术体系，适用于所有产品线。

### 三板斧结构

| 斧头 | 名称 | 核心话术 | 目的 |
|------|------|---------|------|
| 第一斧 | 确定性 | "利润高分" | 消除顾虑，建立信任 |
| 第二斧 | 领先性 | "全新升级" | 突出优势，建立认知 |
| 第三斧 | 行动性 | "先拿两盒试" | 推动行动，降低门槛 |

### 六大产品线话术

| 产品线 | 确定性 | 领先性 | 行动性 |
|--------|--------|--------|--------|
| 南孚电池 | 利润高分、品质稳定 | 碱性电池领导者 | 先拿一组试卖 |
| 卡塔打火机 | 防风效果有保障、陈小春代言 | 全新升级防风机 | 先拿两盒试销 |
| 丰蓝1号 | 电量持久、不漏液 | 燃气表专用电池 | 配合燃气公司推广 |
| 传应纽扣电池 | 电压稳定、寿命长 | 汽车钥匙专用 | 拿一盒放收银口 |
| 轻锋电动牙刷 | 声波清洁、牙龈呵护 | 医护级推荐 | 试销装先试试 |
| 坚果智能锁 | 指纹识别快、安全性高 | 米家生态链 | 配合物业推广 |`
  },
  {
    id: 'product_kata',
    title: '卡塔防风打火机话术',
    keywords: ['卡塔', '打火机', '防风', '陈小春', '利润', '话术'],
    content: `## 卡塔防风打火机话术

### 产品卖点
- 防风效果好，户外也能打着
- 陈小春代言，有认知度
- 售价3元，进价2元，利润50%
- 比杂牌打火机（利润33%）更赚钱

### 三板斧话术

**第一斧 - 确定性（利润高分）**
- "老板，卡塔打火机是南孚旗下的，质量有保障。消费者买个打火机最怕打不着，这个防风效果好，投诉少。"
- "利润方面，卖3元进2元，一盒20支能赚20块。比杂牌打火机利润高50%。"

**第二斧 - 领先性（全新升级）**
- "这是全新升级的防风机，防风效果比普通打火机强10倍。而且陈小春代言，消费者有认知度。"
- "同类产品里，卡塔是唯一有防风技术的，消费者一试就知道好。"

**第三斧 - 行动性（先拿两盒试）**
- "老板，要不先拿两盒试销？一共40支，放收银口挂条上，一周看看动销。我下周二来补货，卖不完帮您调货。"

### 常见反对意见处理

**"价格贵，卖不动"**
- "老板，您是担心卖不动还是觉得进价高？如果一周能卖15支，一个月一盒40支够不够？同类小区店一周能卖20支左右。"
- "而且防风机客单价高，消费者进店本来只想买包烟，看到打火机3块钱顺手就拿了，不会太纠结价格。"

**"已经有打火机了"**
- "您现在卖的是什么牌子？杂牌还是品牌？杂牌打火机质量不稳定，消费者投诉多。卡塔是南孚旗下，防风效果有保障。而且可以挂在现有打火机旁边，不占位置，给消费者多一个选择。"`
  },

  // ===== 门店类型 =====
  {
    id: 'store_type_gt',
    title: 'GT小店（传统渠道）',
    keywords: ['GT', '小店', '传统渠道', '夫妻店', '便利店', '社区店'],
    content: `## GT 小店（传统渠道）

### 定义
GT（General Trade）传统渠道，即传统的小型零售门店。

### 特征
- 面积：通常 < 50㎡
- 经营者：夫妻店、个体户
- 选址：小区门口、街道旁、村镇
- 顾客：周边居民、熟客为主

### 陈列特点
- **收银口黄金位**：最核心的陈列位置
- **挂条陈列**：适合打火机、电池等小商品
- **货架空间有限**：需要精打细算

### 拜访重点
- 建立客情：和老板建立个人关系是关键
- 陈列优化：争取收银口黄金位
- 新品推入：先用试销方式降低门槛
- 客户渗透：了解老板的家庭、经营状况、未来计划

### 常见机会
- 新品铺货：打火机、扑克牌等小商品
- 陈列升级：挂条、收银台展示
- 促销活动：配合节日、社区活动`
  },
  {
    id: 'store_type_mt',
    title: 'MT商超（现代渠道）',
    keywords: ['MT', '商超', '超市', '大卖场', '连锁', '现代渠道'],
    content: `## MT 商超（现代渠道）

### 定义
MT（Modern Trade）现代渠道，即大型连锁超市、卖场。

### 特征
- 面积：通常 > 500㎡
- 经营者：连锁企业、大型商超
- 选址：商业中心、大型社区
- 顾客：随机客流、促销驱动

### 销售特点
- **进场流程复杂**：需要和总部谈判，不是单个门店能决定
- **费用高**：进场费、条码费、促销费
- **销量大**：一旦进场，销量稳定且可观

### 拜访重点
- 联系采购：和总部采购建立关系
- 促销谈判：争取促销资源、端头位置
- 数据追踪：关注销量、库存、动销数据
- 库存管理：确保不缺货、不积压

### 常见机会
- 节日促销：配合超市的节日活动
- 端头陈列：争取更好的货架位置
- 新品进场：和总部谈判引进新品`
  },

  // ===== 有效沟通技巧 =====
  {
    id: 'communication_definition',
    title: '沟通的定义与重要性',
    keywords: ['沟通定义', '沟通', '有效沟通', '共同协议', '沟通重要性'],
    content: `## 沟通的定义与重要性

**定义**：沟通是为了一个设定目标，把信息、思想和情感在个体和群体间传递，并且达成共同协议的过程。

### 沟通的重要性
- 工作包含无数信息（处理、收集、分析、解释、分享），如果不能有效沟通，所有信息都将毫无用处
- 好的领导者是有效的沟通者
- 有效沟通会迫使你为你的主意提供支持，并进一步有效地组织你的想法
- 有效沟通使你自信而积极地参与业务，是深入业务的一把钥匙，而不是沦为旁观者

### 核心认知
- 对信息的理解是沟通的核心：理解 = 影响（Seek first to understand, then to be understood）
- 信任是沟通基础，双方缺乏信任则沟通一定是无效、失败的`
  },
  {
    id: 'communication_model',
    title: '沟通的模式（双向性）',
    keywords: ['沟通模式', '编码', '信道', '译码', '意图', '效果', '双向', '反馈'],
    content: `## 沟通的模式

### 六要素
发送者把「意图」经「编码」通过「信道」传递「信息」，接收者「译码」后产生「效果」，再由信道反馈给发送者。

| 要素 | 含义 |
|------|------|
| 意图 | 想表达的真实意思 |
| 编码 | 把想法转成语言/动作 |
| 信道 | 传递的媒介（语言、文字、肢体） |
| 信息 | 实际传递的内容 |
| 译码 | 接收者理解信息 |
| 效果 | 沟通产生的结果 |

### 双向性
沟通是双向的：传递者 → 接受者，接受者再反馈 → 传递者，形成循环。

### 核心
对信息的理解是沟通的核心，理解 = 影响；信任是沟通的基础。`
  },
  {
    id: 'communication_three_elements',
    title: '沟通三要素（听/问/说）',
    keywords: ['沟通三要素', '获取信息', '证实信息', '传递信息', '听', '问', '说'],
    content: `## 沟通三要素

| 要素 | 动作 | 含义 |
|------|------|------|
| 获取信息 | 听 | 信息收集 |
| 证实信息 | 问 | 确认信息真实性 |
| 传递信息 | 说 | 信息反馈 |

沟通技巧的目的：通过建立和保持沟通的敞开性，从而收集和传递重要的、清楚的、准确的事实和感觉。`
  },
  {
    id: 'listening_skills',
    title: '聆听的学问',
    keywords: ['聆听', '倾听', '听的五个层面', '聚焦', '反馈', '总结', '听到'],
    content: `## 聆听的学问

**听到 ≠ 聆听**：听到是生理学上的，聆听是心理学上的；不会听 = 不会理解 = 不会影响。

### 为什么销售人员无法聆听
- 预先设定了自己的想法
- 为了避免谈话被打断或失去控制
- 担心谈话中不必要的干扰或反对意见

### 听的五个层面（由浅到深）
1. 忽视，不听
2. 假装的听
3. 选择性的听
4. 专注的听
5. 感情投入的听

### 聆听三动作
- **聚焦**：安静（停顿）、保持倾听的姿态、创造鼓励对方说话的姿态和语气
- **反馈**：提开放式问题（刺探）、重复、用语言或行动反馈
- **总结**：陈述你对谈话的理解（演绎）`
  },
  {
    id: 'questioning_skills',
    title: '提问的技巧（开放式 vs 封闭式）',
    keywords: ['提问技巧', '开放式问题', '封闭式问题', '提问', '刺探'],
    content: `## 提问的技巧

### 开放式 vs 封闭式

| 类型 | 优势 | 风险 |
|------|------|------|
| 封闭式 | 节省时间、控制谈话内容 | 收集信息不全、谈话气氛紧张 |
| 开放式 | 收集信息全面、谈话氛围愉快 | 浪费时间、谈话不容易控制 |

### 提问技巧
- 为营造轻松氛围，谈话开始时问开放式问题
- 当发现话题跑偏时，可问一个封闭式问题
- 当发现对方比较紧张时，可问开放式问题，使气氛轻松`
  },
  {
    id: 'speaking_skills',
    title: '说的技巧与 FAB 原则',
    keywords: ['说的技巧', 'FAB', 'Feature', 'Advantage', 'Benefit', '组织表达核对', '说服力'],
    content: `## 说的技巧

### 五要点
明确、清晰、简洁、有重点、有说服力（没有影响的沟通是无用的）。

### 说三步
- **组织**：确定对方的需要、决定你想得到的结果、明确谈话要点
- **表达**：概述情况、陈述主意、解释主意如何运作、强调关键利益
- **核对**：确认对方的反馈

### FAB 原则
按顺序表达，对方容易听懂、容易接受：
- **F（Feature）属性特点**：你看我这沙发是皮的
- **A（Advantage）作用优点**：非常柔软
- **B（Benefit）利益好处**：坐上去舒服得很

采取 FAB 顺序表达，对方更容易听懂，印象更深。`
  },
  {
    id: 'communication_barriers',
    title: '沟通中的障碍与敞开性',
    keywords: ['沟通障碍', '价值性判断', '不变立场', '敞开性', '窗户关闭', '沟通不畅'],
    content: `## 沟通中的障碍与敞开性

### 沟通障碍
- 价值性判断
- 不变的立场
- 目的不明确
- 压力（时间、心理、任务等）
- 讨论话题的敏感性
- 讨论使用的方法

### 沟通敞开性
沟通敞开性是有效沟通的钥匙，是判断沟通障碍的关键。

### 沟通不畅（"窗户关闭"）的信号
- 借口、推脱
- 责备、抱怨
- 敌意、责备
- 逃避、退出`
  },

  // ===== CDM 职责 =====
  {
    id: 'cdm_responsibilities',
    title: '客户发展经理岗位职责（8大职责）',
    keywords: ['CDM', '客户发展经理', '职责', '岗位职责', '业务规划', '目标分解', '费用管理'],
    content: `## 客户发展经理（CDM）8大岗位职责

作为客户发展顾问、连接总部战略与区域实战的核心角色，做好客户生意发展的规划及公司战略的落地执行。

| 序号 | 职责 | 核心内容 |
|------|------|---------|
| 1 | 业务规划 | 根据公司年度战略目标和大区生意规划，制定所负责市场的生意规划，推动客户战略规划与公司战略方向一致，阶段性定期回顾 |
| 2 | 目标分解 | 根据客户（或所属市场）的销售目标，制定生意实现路径及可衡量的市场分销目标，推动目标达成，实现客户和公司共赢 |
| 3 | 费用管理 | 围绕市场分销目标和客户系统建设目标，与客户沟通共识，科学投入和使用费用，确保销售、分销和客户系统目标实现 |
| 4 | 客户开发与发展 | 梳理市场现状（现有渠道、空白市场/渠道），负责客户开发与发展工作（客户的发展、激励、评估与优化） |
| 5 | 成建制分销队伍 | 发展经销商分销队伍（拍档/业务员/理货员/导购），持续赋能经销商及分销团队，提升作战能力 |
| 6 | 数字化推进 | 推进客户数字化（店主自主下单、经销商自营产品上架等）成功转型 |
| 7 | 活动执行 | 负责终端/消费者活动的执行，及时反馈进度、总结经验和评估效果 |
| 8 | 项目执行 | 参与公司特定/测试项目的执行，完成问题反馈、阶段性总结和项目结果评估 |

### 新客户发展经理工作三板斧
1. 市场规划（市场竞争机会分析、内部现状扫描、团队能力评估、制定目标策略、执行跟进）
2. 客户发展（经销商开发与发展流程：客户开发 → PTS评估 → 制定规划 → 目标达成）
3. DSR赋能（有目标、有技能、有状态）`
  },
  {
    id: 'market_planning_logic',
    title: '市场规划核心逻辑',
    keywords: ['市场规划', '市场机会分析', '内部现状扫描', '团队能力评估', '目标策略', 'PDCA', 'OGSM'],
    content: `## 市场规划核心逻辑

通过市场竞争机会分析、内部现状扫描、团队能力评估，制定目标策略并以 PDCA 工具落地执行的全链路销售管理闭环。

### 五步闭环
1. **市场竞争机会分析**：市场宏观环境分析、竞品分析和机会识别
2. **内部现状分析**：生意现状扫描、分销现状分析、网点质量和运营扫描
3. **团队能力评估**：经销商能力扫描、DSR能力扫描、市场诊断和机会分析
4. **目标策略制定**：分销白皮书、OGSM落地一页纸
5. **执行跟进**：规划落地及跟进、PDCA跟进思路工具

### 市场规划要求
- 清晰目标，找差距，知道自己要去哪里
- 坚持做难而正确的事情
- 目标符合 SMART 原则`
  },
  {
    id: 'pts_assessment',
    title: 'PTS 经销商评估模型',
    keywords: ['PTS', '经销商评估', '产品竞争力', '团队战斗力', '数字化能力', 'P1', 'T1', 'S1'],
    content: `## PTS 经销商评估模型

### 三维度
| 维度 | 含义 |
|------|------|
| P（产品竞争力） | 产品组合的结构合理化，有利于提供店内粘性和盈利能力 |
| T（团队战斗力） | 业务团队能力决定经销商分销的边界线，决定市场竞争力 |
| S（数字化能力） | 随着店主年轻化，订货习惯改变，通过在线下单提高效率 |

### 分级标准
- **P 产品竞争力**：P1 初级（产品类型单一缺乏竞争力）→ P2 中级（跨品类经营具备一定竞争力）→ P3 高级（全品类经营、收银口结构化产品组合）
- **T 团队战斗力**：T1 初级（未达基本分销覆盖水平、DSR团队待扩张）→ T2 中级（基础覆盖达标、DSR形成标准化业务流程）→ T3 高级（分销根据地建立、业务团队片区化高效管理）
- **S 数字化能力**：S1 初级（发版小程序、在线化商城运营）→ S2 中级（业务流程和团队管理全面数字化）→ S3 高级（私域流量池运营、直播等营销在线化能力）`
  },
  {
    id: 'dsr_empowerment',
    title: 'DSR 赋能三大关键',
    keywords: ['DSR赋能', '有目标', '有技能', '有状态', '强聚焦', '强追踪', '强反馈'],
    content: `## DSR 赋能三大关键

### 有目标
- 有重点、有跟进、有反馈
- 每天、每周、每月的目标要清晰明确
- 强聚焦（阶段时间内只有一个重点）、强追踪（每日三次追踪：早上9点/中午12点/下午4点）、强反馈（问题不过夜）

### 有技能
- 懂产品、有方法、有技巧、有工具
- 养成持续性工作的习惯、挑战高目标的工作态度、培训持续不断坚持、数字化工具赋能

### 有状态
- 有荣誉、有激励、有标杆、有士气
- 相信相信的力量：荣誉激励机制、团队标杆打造、良好的个人关系建立`
  },
  {
    id: 'grai_review',
    title: 'GRAI 复盘法',
    keywords: ['GRAI', '复盘', '回顾目标', '评估结果', '分析原因', '总结经验'],
    content: `## GRAI 复盘法（以复盘促发展）

| 步骤 | 含义 | 要点 |
|------|------|------|
| G（Goal） | 回顾目标 | 回溯上个阶段设定的目标，明确希望达成的具体成果 |
| R（Result） | 评估结果 | 用具体、翔实的数据支撑和验证结果（无论成功与否） |
| A（Analysis） | 分析原因 | 深入分析原因：目标未达成找关键原因，达成则探究成功推动因素 |
| I（Insight） | 总结经验 | 提炼可借鉴的和需避免的，为下一阶段工作打基础 |

**核心**：没有复盘的工作只是低水平的重复；复盘不是一次性的，需要不断进行，通过巩固优势、弥补短板持续取得更好成绩。`
  },
  {
    id: 'market_four_stages',
    title: '市场发展四阶段诊断',
    keywords: ['市场四阶段', '经销商开发', '分销发展', 'KOC品类发展', '门店运营', '分销覆盖率'],
    content: `## 市场发展四阶段

| 阶段 | 名称 | 判断标准 |
|------|------|---------|
| 第一阶段 | 经销商开发与发展阶段 | 经销商匹配度 < 5 |
| 第二阶段 | 分销发展阶段 | 分销覆盖率 < 30% |
| 第三阶段 | KOC品类发展阶段 | KOC品类渗透 < 75%、小程序下单率 < 30% |
| 第四阶段 | 门店运营阶段 | KOC品类渗透 > 75%、小程序下单率 > 30% |

### 各阶段建设要求
- **第一阶段**：以经销商的开发或汰换为重心，快速建立一批有意愿发展的经销商团队
- **第二阶段**：深化数字化发展意识，实现业务在线化管理，高效覆盖快速扩张，建立分销根据地
- **第三阶段**：优化产品结构，转向数字化、营销在线化
- **第四阶段**：从分销到团队管理数字化全链路拉通，转向门店粘性及服务质量的提升`
  },
  {
    id: 'terminal_visit_flow',
    title: '小终端标准拜访流程 8.0',
    keywords: ['拜访流程', '标准拜访', '小终端', '五星服务承诺', '销售呈现', '拜访步骤'],
    content: `## 线下小终端开发与发展流程 8.0

### 标准拜访步骤（17步）
1. 沟通发展目标、制定赋能计划
2. 课堂赋能
3. 实地培训
4. 拜访资料准备
5. 校对门店基本信息
6. 销售开启、主动介绍
7. 客户渗透、门店检查
8. 找机会/定方案（4大机会）
9. 销售呈现 5 步骤
10. 处理反对意见 4 步骤
11. 销售达成、采取行动（11-1 产品库存货龄信息记录/检查；11-2 下单；11-3 陈列上传）
12. 五星服务承诺
13. 日工作总结
14. 跟进每日工作日志，并指导改进
15. 月工作总结
16. 周计划及复盘
17. 总结提炼方法论输出

### 流程闭环
围绕「沟通技巧、客户渗透、陈列标准、说服性销售、处理反对意见」六大环节形成拜访闭环（Loop01-06），贯穿拜访规划与赋能计划。`
  },

];

// ============ CSV 解析器 ============
/**
 * 标准 CSV 解析器（RFC 4180）
 * 支持：逗号分隔、双引号包裹字段（含逗号/换行）、双引号转义（""）
 */
function parseCSV(text) {
  if (!text) return [];
  // 去除 UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else if (c === '\r') {
        if (text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }

  // 处理最后一行（无结尾换行符时）
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ============ CSV 行 → 知识文档映射 ============
// 销售实战核心方法论.csv 表头：序号,模块,章节,知识点,核心定义/要点,详细内容,关键词
function mapMethodologyRow(row) {
  if (!row || row.length < 4) return null;
  const [no, module, chapter, point, definition, detail, keywords] = row;
  if (!point || point === '知识点') return null; // 跳过表头
  const kw = (keywords || '').split(/[;；]/).map(k => k.trim()).filter(Boolean);
  return {
    id: `csv_meth_${(no || '').trim() || 'x'}`,
    title: point.trim(),
    keywords: kw,
    content: `## ${point.trim()}\n\n**模块**：${module || ''}\n**章节**：${chapter || ''}\n\n**核心定义/要点**：\n${definition || ''}\n\n**详细内容**：\n${detail || ''}`,
  };
}

// DSR难题百问.csv 表头：序号,核心模块,问题类型,具体难题,问题的本质,答案（思路+关键点）,话术（白话）,关键词
function mapDsrRow(row) {
  if (!row || row.length < 4) return null;
  const [no, module, type, problem, essence, answer, script, keywords] = row;
  if (!problem || problem === '具体难题') return null; // 跳过表头
  const kw = (keywords || '').split(/[;；]/).map(k => k.trim()).filter(Boolean);
  const title = problem.length > 50 ? problem.slice(0, 50) + '…' : problem;
  return {
    id: `csv_dsr_${(no || '').trim() || 'x'}`,
    title: title.trim(),
    keywords: kw,
    content: `## ${problem.trim()}\n\n**核心模块**：${module || ''}\n**问题类型**：${type || ''}\n\n**问题的本质**：\n${essence || ''}\n\n**思路与关键点**：\n${answer || ''}\n\n**话术（白话）**：\n${script || ''}`,
  };
}

// ============ 同义词/近义词映射（查询扩展） ============
// 将用户口语化/同义表达映射到知识库常见关键词，提升召回率
const SYNONYM_MAP = {
  '贵': ['价格贵', '太贵', '进价高', '利润低'],
  '价格贵': ['贵', '太贵', '进价高', '利润低'],
  '太贵': ['贵', '价格贵', '进价高'],
  '便宜': ['价格低', '实惠', '利润高'],
  '卖不动': ['没人买', '滞销', '卖不出去', '销量差', '卖不完'],
  '没人买': ['卖不动', '滞销', '卖不出去'],
  '卖不出去': ['卖不动', '没人买', '滞销'],
  '赚钱': ['利润', '毛利', '利润高'],
  '利润': ['赚钱', '毛利', '利润高', '利润低'],
  '不赚钱': ['利润低', '利润不够'],
  '客户': ['老板', '店主', '经销商', '门店'],
  '老板': ['客户', '店主', '经销商'],
  '打火机': ['卡塔', '防风打火机', '防风机'],
  '卡塔': ['打火机', '防风打火机'],
  '反对意见': ['异议', '拒绝', '顾虑', '反对'],
  '异议': ['反对意见', '拒绝', '顾虑'],
  '拒绝': ['反对意见', '异议'],
  '顾虑': ['担心', '反对意见', '异议'],
  '担心': ['顾虑', '反对意见'],
  '话术': ['说辞', '沟通话术', '销售话术'],
  '拜访': ['巡店', '跑店', '终端拜访'],
  '巡店': ['拜访', '跑店'],
  '陈列': ['货架', '展示', '摆货', '陈列管理'],
  '货架': ['陈列', '展示'],
  '促销': ['活动', '推广', '促销活动'],
  '推广': ['促销', '活动'],
  '动销': ['销量', '卖得动', '周转'],
  '进货': ['拿货', '补货', '进购'],
  '补货': ['进货', '拿货'],
  '防风': ['防风打火机', '卡塔'],
  '利润低': ['利润不够', '不赚钱', '进价高'],
  '进价高': ['价格贵', '利润低', '贵'],
  '沟通': ['交流', '沟通技巧', '有效沟通'],
  '交流': ['沟通', '沟通技巧'],
  '倾听': ['聆听'],
  '聆听': ['倾听'],
  '提问': ['发问', '提问技巧'],
  '复盘': ['总结', '回顾', '反思'],
  '总结': ['复盘', '回顾'],
  '回顾': ['复盘', '总结'],
  '市场规划': ['生意规划', '市场计划'],
  '生意规划': ['市场规划'],
  '规划': ['市场规划', '生意规划'],
  '经销商评估': ['PTS', '评估'],
  'PTS': ['经销商评估', '评估'],
  '赋能': ['DSR赋能', '带教', '培训'],
  'DSR赋能': ['赋能', '带教', '培训'],
  '拜访流程': ['标准拜访', '拜访步骤'],
  '标准拜访': ['拜访流程', '拜访步骤'],
};

// 停用字（仅用于过滤 n-gram 首尾，不用于切分，避免破坏"卖不动/说服性销售"等词）
const STOPWORD_EDGES = new Set('的了和是吗呢吧啊呀哦们这那么就都也与或及而并但却因为所以于对从到把被让给向跟按凭靠等各每某其之可会要想说做搞弄用在再又才刚上下里外中前后左右'.split(''));

// ============ 向量语义检索（Silicon Flow BGE-M3） ============

/**
 * 调用 Embedding API 将文本批量转为向量
 * 通过 /api/embed 服务端代理调用（密钥仅保存在服务端，不暴露到浏览器）
 * @param {string[]} texts - 待编码文本数组
 * @returns {Promise<number[][]>} 与 texts 一一对应的向量数组
 */
async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  // http(s) 走服务端代理；file:// 直接请求（无密钥时会由服务端返回 503，进而触发关键词兜底）
  const useProxy = /^https?:$/.test(window.location.protocol);
  const url = useProxy ? '/api/embed' : 'https://api.siliconflow.cn/v1/embeddings';

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'BAAI/bge-m3', input: texts, encoding_format: 'float' }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Embedding HTTP ${resp.status} ${detail.slice(0, 200)}`);
  }

  const json = await resp.json();
  if (!json || !Array.isArray(json.data)) {
    throw new Error('Embedding 响应格式异常');
  }

  // 按 index 排序，保证与输入顺序一致
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

/**
 * 余弦相似度（两个向量均为 number[]）
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ============ RAG 管理器 ============
const RAGManager = {
  // 合并后的知识库（静态 PDF + 动态 CSV）
  _docs: [],
  _keywordMap: null,
  _loaded: false,
  _loading: null,

  // 语义向量缓存（与 _docs 一一对应；为空表示 Embedding 不可用，走关键词兜底）
  _vectors: null,
  _vectorsReady: false,
  _vectorsBuilding: null,

  /**
   * 初始化：加载静态知识 + 动态 CSV 知识库，并构建倒排索引
   */
  async init() {
    if (this._loaded) return;
    if (this._loading) return this._loading;
    this._loading = this._loadAll();
    await this._loading;
    this._loaded = true;
  },

  /**
   * 加载全部知识来源
   */
  async _loadAll() {
    // 1. 静态知识库（PDF 核心内容，手动提取）
    this._docs = [...STATIC_KNOWLEDGE_BASE];

    // 2. 动态加载 CSV 知识库（RAG 文件夹下的 CSV 文件）
    const csvSources = [
      { path: 'RAG/销售实战核心方法论.csv', mapper: mapMethodologyRow },
      { path: 'RAG/DSR难题百问.csv', mapper: mapDsrRow },
    ];

    for (const src of csvSources) {
      try {
        const resp = await fetch(src.path);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        const rows = parseCSV(text);
        const docs = rows.map(src.mapper).filter(Boolean);
        this._docs.push(...docs);
        console.log(`[RAG] 已加载 ${src.path}（${docs.length} 条）`);
      } catch (e) {
        console.warn(`[RAG] 加载 ${src.path} 失败：${e.message}`);
      }
    }

    // 3. 构建关键词倒排索引
    this._buildIndex();
  },

  /**
   * 构建关键词倒排索引：关键词 -> 文档ID列表
   */
  _buildIndex() {
    // 倒排索引：关键词 -> Map(文档ID -> 来源权重)
    // 来源权重：标题=3（最准确）、预定义关键词=2（人工精选）、内容=1（兜底）
    this._keywordMap = new Map();

    const addKeyword = (kw, docId, weight) => {
      if (!kw || kw.length < 2) return;
      const normalized = kw.toLowerCase();
      if (!this._keywordMap.has(normalized)) {
        this._keywordMap.set(normalized, new Map());
      }
      const docMap = this._keywordMap.get(normalized);
      docMap.set(docId, Math.max(docMap.get(docId) || 0, weight));
    };

    this._docs.forEach(doc => {
      // 标题关键词：权重最高
      this._extractKeywords(doc.title).forEach(kw => addKeyword(kw, doc.id, 3));

      // 预定义关键词：权重次之
      (doc.keywords || []).forEach(kw => addKeyword(kw, doc.id, 2));

      // 内容关键词：权重最低（覆盖口语化/未收录表达）
      this._extractKeywords(doc.content).forEach(kw => addKeyword(kw, doc.id, 1));
    });

    console.log(`[RAG] 索引构建完成: ${this._docs.length} 篇文档, ${this._keywordMap.size} 个关键词`);
  },

  /**
   * 从文本中提取关键词
   * 策略：标点切分 -> 保留完整短片段 -> 生成 2-4 字 n-gram（过滤首尾停用字降噪）
   */
  _extractKeywords(text) {
    if (!text) return [];

    // 1. 小写化 + 标点转空格（标点作为词边界）
    const cleaned = text.toLowerCase().replace(/[，。！？、；：""''（）【】《》〈〉…—\-·%％,.!?;:'"()\[\]<>\/\\|+=_*&^$#@~`\n\r\t]/g, ' ');

    // 2. 按空白切分成片段
    const segments = cleaned.split(/\s+/).filter(s => s.length >= 2);

    const keywords = new Set();

    for (const seg of segments) {
      // 3. 保留较短的完整片段（含英文缩写/术语，如 OGSM、CDM、Define、利润50%）
      if (seg.length <= 8 && /^[a-z0-9\u4e00-\u9fa5]+$/.test(seg)) {
        keywords.add(seg);
      }

      // 4. 对纯中文片段生成 2-4 字 n-gram，过滤首尾为停用字的噪声词
      if (/^[\u4e00-\u9fa5]+$/.test(seg)) {
        for (let len = 2; len <= 4; len++) {
          for (let i = 0; i + len <= seg.length; i++) {
            const gram = seg.slice(i, i + len);
            if (!STOPWORD_EDGES.has(gram[0]) && !STOPWORD_EDGES.has(gram[gram.length - 1])) {
              keywords.add(gram);
            }
          }
        }
      }
    }

    return Array.from(keywords);
  },

  /**
   * 检索相关知识
   * @param {string} query - 查询文本
   * @param {number} topK - 返回前K个结果
   * @returns {Promise<Array>} 匹配的知识块
   */
  async search(query, topK = 5) {
    await this.init();

    if (!query || !query.trim()) {
      return this._docs.slice(0, topK);
    }

    // 优先语义检索；Embedding 不可用或失败时，降级为关键词检索
    try {
      const vectorResults = await this._vectorSearch(query, topK);
      if (vectorResults.length > 0) return vectorResults;
    } catch (e) {
      console.warn('[RAG] 语义检索失败，回退关键词检索:', e.message);
    }

    return this._keywordSearch(query, topK);
  },

  /**
   * 语义向量检索：Embedding 查询 -> 余弦相似度 -> TopK
   */
  async _vectorSearch(query, topK) {
    await this._ensureVectors();

    if (!this._vectors || this._vectors.length !== this._docs.length) {
      return [];
    }

    const queryVec = (await embedTexts([query]))[0];
    if (!queryVec) return [];

    const scored = this._docs.map((doc, i) => ({
      ...doc,
      score: Math.round(cosineSimilarity(queryVec, this._vectors[i]) * 1000) / 1000,
    }));
    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, topK);
    console.log(`[RAG] 语义检索 "${query.slice(0, 30)}" 命中 ${results.length} 条`);
    return results;
  },

  /**
   * 关键词倒排索引检索（Embedding 不可用时的降级兜底）
   */
  _keywordSearch(query, topK) {
    const queryKeywords = this._extractKeywords(query);
    const scoreMap = new Map();

    // 1. 展开同义词，提升召回率
    const expanded = new Set();
    queryKeywords.forEach(kw => {
      expanded.add(kw);
      (SYNONYM_MAP[kw] || []).forEach(s => expanded.add(s));
    });

    // 2. 计算加权匹配分数：关键词越长越具体、来源权重越高得分越高
    expanded.forEach(kw => {
      const normalized = kw.toLowerCase();
      const docMap = this._keywordMap.get(normalized);
      if (!docMap) return;

      const kwWeight = Math.max(1, normalized.length);

      docMap.forEach((sourceWeight, docId) => {
        scoreMap.set(docId, (scoreMap.get(docId) || 0) + kwWeight * sourceWeight);
      });
    });

    // 3. 用文档长度做轻微归一化，避免长文档占优
    const scored = [];
    scoreMap.forEach((score, docId) => {
      const doc = this._docs.find(d => d.id === docId);
      if (!doc) return;
      const norm = score / Math.log2(doc.content.length + 2);
      scored.push({ ...doc, score: Math.round(norm * 100) / 100 });
    });

    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, topK);

    console.log(`[RAG] 关键词检索 "${query.slice(0, 30)}" 匹配 ${results.length} 条`);

    return results;
  },

  /**
   * 懒构建全库语义向量（首次检索时触发，批量请求，仅内存缓存）
   */
  async _ensureVectors() {
    if (this._vectorsReady) return;
    if (this._vectorsBuilding) return this._vectorsBuilding;
    this._vectorsBuilding = this._buildVectors();
    try {
      await this._vectorsBuilding;
    } finally {
      this._vectorsBuilding = null;
    }
  },

  async _buildVectors() {
    if (!this._docs.length) {
      this._vectors = [];
      this._vectorsReady = true;
      return;
    }

    try {
      const texts = this._docs.map(d => `${d.title}\n${d.content}`);
      const BATCH = 32;
      const vectors = [];

      for (let i = 0; i < texts.length; i += BATCH) {
        const batchVecs = await embedTexts(texts.slice(i, i + BATCH));
        vectors.push(...batchVecs);
      }

      this._vectors = vectors;
      console.log(`[RAG] 语义向量构建完成: ${vectors.length} 条`);
    } catch (e) {
      console.warn('[RAG] 语义向量构建失败，将使用关键词检索:', e.message);
      this._vectors = [];
    } finally {
      this._vectorsReady = true;
    }
  },

  /**
   * 构建 RAG 增强的 System Prompt
   * @param {string} originalPrompt - 原始 prompt
   * @param {string} userQuery - 用户查询
   * @returns {Promise<string>} 增强后的 prompt
   */
  async buildPrompt(originalPrompt, userQuery, topK = 3) {
    const relevantDocs = await this.search(userQuery, topK);

    if (relevantDocs.length === 0) {
      return originalPrompt;
    }

    // 构建 RAG 知识块
    const ragSection = relevantDocs.map((doc, i) => {
      return `### 参考资料 ${i + 1}：${doc.title}\n${doc.content}`;
    }).join('\n\n---\n\n');

    // 插入到原始 prompt 中
    const ragInstruction = `\n
## RAG 动态知识库（本次查询相关）

以下是从知识库中检索到的参考资料，**优先使用这些资料中的具体内容**来支撑你的分析和预设：

${ragSection}

---

`;

    // 在原始 prompt 的 "RAG 融合指令" 部分之后插入
    if (originalPrompt.includes('## RAG 融合指令')) {
      return originalPrompt.replace(
        '## RAG 融合指令（核心）',
        ragInstruction + '## RAG 融合指令（核心）'
      );
    }

    // 如果没有 RAG 融合指令部分，追加到末尾
    return originalPrompt + '\n\n' + ragInstruction;
  }
};

// 导出
if (typeof window !== 'undefined') {
  window.RAGManager = RAGManager;
}
