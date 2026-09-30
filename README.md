# HabitCheck · 清单打卡 App

一款面向移动端的「习惯 + 任务」打卡应用。零依赖、零构建、离线可用，双击 `index.html` 即可运行。

- 技术栈：原生 HTML + CSS + ES5 语法的 JavaScript（模块化拆分，无框架 / 无打包器）
- 存储：localStorage（离线持久化，支持 JSON 导出导入）
- 适配：移动端优先（≤480px 居中容器 + 安全区适配），桌面打开自动居中显示为手机画布

---

## 1. 运行方式

```bash
# 方式一：直接打开（数据存于浏览器 localStorage）
双击 index.html

# 方式二：本地静态服务（推荐，便于手机同局域网访问）
cd habit-app
python -m http.server 8080     # 或 npx serve .
# 浏览器打开 http://localhost:8080

# 逻辑层冒烟测试（Node，无需浏览器）
node tools/smoke-test.js       # 31 项断言：排期判定 / 打卡 / 连续 / 统计 / 持久化
```

---

## 2. 整体信息架构（IA）

```
HabitCheck
├─ 今天（默认页）
│   ├─ 今日概览卡：完成率环形图 / 已完成数 / 连续全勤天数 / 本周完成率
│   ├─ 筛选 chips：全部 · 待完成 · 已完成
│   └─ 今日应做清单（按 未完成 → 优先级 排序）
│        └─ 单项：一键完成 ○ / 跳过 ↷ / 点击行 → 清单项详情
├─ 日历
│   ├─ 月视图：6×7 网格，日期按完成率着色 + 完成色点，Tap → 当日详情（补打卡）
│   │           底部：本月完成率 / 完成次数 / 连续全勤
│   └─ 周视图：清单 × 7 天矩阵，格子三态循环（完成 → 跳过 → 清除）
├─ 统计
│   ├─ 完成率三卡：今日 / 本周 / 本月
│   ├─ 趋势图：周（近 8 周）⇄ 月（近 6 月）切换
│   ├─ 打卡热力图：17 周 × 7 天
│   ├─ 连续记录：当前全勤 / 历史最长全勤 / 累计次数 / Top5 单项连续
│   └─ 分类分布：近 30 天各分类完成数
└─ 清单（管理）
    ├─ 进行中列表：编辑 ✎ / 归档 📥 / 删除 🗑
    ├─ 已归档（可展开恢复）
    ├─ 分类标签（新建）
    └─ 设置：提醒 · 免打扰 · 外观 · 数据导出导入
└─ 我的（v1.0.1 新增）
    ├─ 应用标识卡：名称 / 简介 / 版本号
    ├─ 功能亮点卡片网格（点按直接跳转对应页）
    ├─ 使用技巧列表
    ├─ 常见问题 FAQ（单开手风琴）
    └─ 数据说明 + 设置入口
```

二级弹层（Bottom Sheet）：**当日详情**、**清单项详情**、**新建/编辑表单**、**设置**、**新建分类**。

---

## 3. 页面核心元素与交互流程

### 3.1 今天
| 元素 | 说明 | 交互 |
|---|---|---|
| 环形进度 | 今日 `已完成 / 应做` | 只读 |
| 连续全勤徽标 | 顶栏 🔥 + 概览卡 | 只读，随打卡实时更新 |
| 筛选 chips | 全部 / 待完成 / 已完成 | Tap 切换，仅影响列表 |
| 清单行 | 色条(分类色) + 标题 + 元信息(重复·优先级·提醒·本周进度) | 点标题区 → 详情 |
| ○ 圆圈按钮 | 完成态 | 未打卡 → 完成；已完成 → **撤销**（Toast 亦可撤销） |
| ↷ 按钮 | 跳过态 | 未跳过 → 跳过；已跳过 → 清除 |
| FAB ＋ | 新建清单项 | 打开表单弹层 |

**主流程**：进入 → 渲染今日应做 → 点 ○ 完成 → Toast「已完成 · xxx｜撤销」→ 状态写入 → 顶栏连续天数、统计页同步刷新（订阅式重渲染）。

### 3.2 日历
- 月/周切换（右上角分段控件），‹ 今天 › 导航；月视图按月翻页，周视图按 7 天翻页。
- 日期着色等级 `L0~L4` = 当日完成率 `0 / <34% / <67% / <100% / 100%`，完成的清单项以色点显示（最多 4 个）。
- **点击任意日期 → 当日详情弹层**：显示完成率/已完成/已跳过，逐项提供「完成 / 跳过 / 清除」——非今天的操作自动标记为**补打卡**（`makeup: true`）。
- 周视图矩阵支持**跨天批量补打卡**：格子点击循环 `空 → 完成 → 跳过 → 空`；非排期日显示为禁用虚框。

### 3.3 统计
- 完成率口径：`已完成 / 应做总数`（跳过计入未完成）。
- 趋势图用内联 SVG 绘制，100% 完成显示为绿色柱，其余为强调色柱。
- 热力图 7 行 × 17 列，按周起始日对齐，未来日期半透明。
- 连续口径：
  - **单项连续**：沿「应完成日序列」回溯，今天未完成不中断（宽容），跳过则中断。
  - **全局全勤连续**：自然日回溯，当日所有应做项 100% 完成才算一天；无排期日跳过不中断。

### 3.4 清单管理
- 新建/编辑表单字段：名称、类型（习惯/任务）、优先级、分类、重复规则、开始/结束日期、颜色、提醒开关+时间、备注。
- 重复规则切换时联动显示：自定义星期（多选周一~周日）/ 每周次数（1~7）/ 单次日期。
- 归档：归档后不再出现在每日应做与日历排期，但历史打卡数据保留，可一键恢复。
- 删除：二次确认，级联删除该清单项的打卡记录。

### 3.5 提醒与通知
- 每个清单项可独立设置提醒时间；全局可设免打扰时段（支持跨夜，如 22:30–07:00）。
- 调度器每 30s 轮询：命中提醒时刻（容差 2 分钟）+ 当日排期 + 尚未打卡 + 不在免打扰 → 触发。
- 优先使用 Web Notification（首次在设置中开启时申请权限），不支持/未授权时降级为应用内 Toast。
- 同一「清单项 + 日期 + 时刻」仅触发一次，避免重复打扰。

---

## 4. 数据模型

### 4.1 实体关系

```
Category(1) ──< Item(1) ──< CheckIn
  分类            清单项         打卡记录（复合唯一：itemId + date）
Settings（全局单例）
```

### 4.2 Item（清单项 / 习惯 / 任务）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 主键 |
| title | string | 名称 |
| type | `'habit' \| 'task'` | 习惯（可重复）/ 任务（单次） |
| category | string | → Category.id |
| priority | `'high' \| 'medium' \| 'low'` | 优先级 |
| color | string | 分类色之外的单项强调色（#hex） |
| note | string | 备注 |
| repeat | object | `{ type, days[], times }` |
| repeat.type | `'daily' \| 'weekly' \| 'times' \| 'once'` | 每天 / 自定义星期 / 每周 N 次 / 单次 |
| repeat.days | number[] | weekly 时生效，0=周日…6=周六 |
| repeat.times | number | times 时生效，每周目标次数 |
| startDate / endDate | `'YYYY-MM-DD'` | 生效区间，endDate 可空 |
| reminder | object | `{ enabled: boolean, time: 'HH:MM' }` |
| archived | boolean | 归档标记（软删除，保留历史） |
| createdAt / updatedAt | number | 时间戳 |

### 4.3 CheckIn（打卡记录）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 主键 |
| itemId | string | → Item.id |
| date | `'YYYY-MM-DD'` | 打卡日 |
| status | `'done' \| 'skipped'` | 完成 / 跳过；**撤销即删除记录** |
| makeup | boolean | 非当天补打卡自动置 true |
| ts | number | 写入时间 |

> 唯一约束：`(itemId, date)`。撤销 = 删除该组合记录，而非写入空状态，保证统计口径干净。

### 4.4 Category / Settings

| 实体 | 字段 |
|---|---|
| Category | `id`, `name`, `color` |
| Settings | `weekStart`(0/1), `theme`(light/dark/auto), `notify{enabled}`, `dnd{enabled,start,end}`, `minDate`(派生：最早生效日-1，用于统计回溯下界) |

### 4.5 存储

```
localStorage['habitcheck.v1'] = { version, items[], checkins[], categories[], settings{} }
localStorage['habitcheck.ui.view'] = 'today' | 'calendar' | 'stats' | 'manage'
```
写入采用 150ms 去抖 + `beforeunload` / `visibilitychange` 强制落盘。

---

## 5. 状态管理方案

采用**单向数据流（类 Redux）**，但保持零依赖：

```
UI 事件 ──dispatch(action)──▶ reducer(state, action) ──▶ 新 state
                                                          │
                              ┌───────────────────────────┼───────────────┐
                              ▼                           ▼               ▼
                    持久化中间件（去抖写 localStorage）  订阅者通知       UI.state（视图局部）
                                                          │
                                                    UI.render() 全量重渲染当前页
```

- **单一数据源**：`App.store.getState()`，视图永不持有业务数据副本。
- **不可变更新**：reducer 每次返回新对象/新数组，避免引用共享导致的隐性 bug。
- **纯函数派生**：`App.logic.*` 全部为纯函数（排期判定、连续天数、统计聚合），与 UI 解耦，可直接在 Node 中测试（见 `tools/smoke-test.js`）。
- **订阅式渲染**：`store.subscribe(UI.render)`，任何 action 触发一次全量重渲染（数据量小，<1ms，无需虚拟 DOM）。
- **UI 局部状态分离**：`App.ui.state = { view, date, calMode, statsMode, filter, showArchived }` 只描述"正在看什么"，不混入业务数据，也不参与持久化（仅记忆当前页签）。
- **事件委托**：全局监听 `click / change / submit`，通过 `data-act` 分派，避免大量逐个绑定与内存泄漏。

### Action 一览

| Action | 载荷 | 说明 |
|---|---|---|
| `ITEM_CREATE` | payload: 表单 | 新建清单项 |
| `ITEM_UPDATE` | id, patch | 编辑 |
| `ITEM_DELETE` | id | 删除（级联清理打卡） |
| `ITEM_ARCHIVE` | id, value | 归档 / 恢复 |
| `CHECKIN_SET` | itemId, date, status | 打卡 / 跳过 / 撤销(null) |
| `CATEGORY_CREATE/UPDATE/DELETE` | — | 分类维护（删除时回落到"其他"） |
| `SETTINGS_UPDATE` | patch | 外观 / 周起始 / 通知 / 免打扰 |
| `DATA_IMPORT` / `DATA_RESET` | payload | 导入 / 恢复演示数据 |

---

## 6. 目录结构

```
habit-app/
├─ index.html            页面骨架（顶栏 / 视图容器 / FAB / TabBar / 弹层容器）
├─ css/styles.css        设计令牌（含深色主题）、组件样式、安全区适配
├─ js/utils.js           日期工具（周起始、月网格、时间换算）、转义、ID
├─ js/logic.js           领域纯函数：排期判定、连续天数、统计聚合
├─ js/store.js           数据源：reducer、持久化中间件、订阅、种子数据
├─ js/ui.js              视图渲染（字符串模板）+ 事件委托 + 弹层
├─ js/app.js             启动：初始化、跨天刷新、提醒调度、导出导入
└─ tools/smoke-test.js   Node 逻辑冒烟测试（31 项断言）
```

---

## 7. 后续可扩展

- 数据同步：将 `localStorage` 适配层替换为 IndexedDB / 云端接口（store 层接口不变，视图零改动）。
- 桌面小组件 / PWA：补充 `manifest.json` + Service Worker 即可离线安装到桌面与手机。
- 更丰富的统计：按分类的完成率趋势、按时段（早晨/晚间）分布。
- 提醒增强：Service Worker 的 `showTrigger` 定时通知（替代轮询，更省电）。
