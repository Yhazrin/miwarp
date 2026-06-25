# MiWarp v1.1.0 计划书 · Open Agent Workbench

> **文档状态**：Living Plan / 锚点主账本
> **首次建立**：2026-06-23
> **适用范围**：v1.0.9 → v1.1.0
> **产品主题**：**Open Agent Workbench**
> **一句话承诺**：接入不同 Agent，看清执行过程，在关键节点干预，并在任何中断后继续工作。
> **英文承诺**：Connect any agent. See everything that matters. Intervene before damage. Resume without losing work.
> **上位约束**：[`core-experience-v1.md`](./core-experience-v1.md)
> **前置版本**：[`PLAN_V1.0.9.md`](./PLAN_V1.0.9.md)
> **趋势与证据池**：[`V1.1.0_TREND_RADAR.md`](./V1.1.0_TREND_RADAR.md)

---

## 零、版本总纲

### 0.1 v1.1.0 不是“再加一批页面”

MiWarp v1.1.0 的目标不是把现有 Claude Code / Codex 图形壳继续堆成功能集合，而是完成一次产品层级跃迁：

```text
AI CLI Desktop Wrapper
        ↓
Observable Agent Workbench
        ↓
Interactive + Reviewable + Recoverable Engineering System
```

版本必须同时建立六种能力：

1. **开放接入**：不同 CLI、Provider、Model 和协议可以通过统一适配层进入 MiWarp。
2. **过程可见**：用户能理解 Agent 当前阶段、工具活动、上下文消耗、等待原因和完成证据。
3. **实时干预**：用户能在计划、权限、高风险动作、检查点和运行过程中改变方向。
4. **工程验证**：完成不再等于“Agent 说完成”，而是绑定 Diff、测试、浏览器验证和交付制品。
5. **中断恢复**：断网、进程退出、App 崩溃、休眠和切换设备后，任务仍能明确恢复或明确降级。
6. **本地可信**：默认本地优先、权限可解释、第三方工具可审计、敏感数据可脱敏导出。

### 0.2 版本战略判断

v1.0.9 已经解决“桌面执行是否值得信任”的核心事务问题。v1.1.0 应把这个可信执行底盘向上扩展为完整闭环：

```text
需求
→ 计划
→ 环境隔离
→ Agent 执行
→ 人工干预
→ 文件变更
→ 测试 / 浏览器验证
→ Diff 审查
→ Artifact 交付
→ Commit / PR
→ 恢复与追踪
```

### 0.3 版本优先级

在 v1.1.0 冻结前，资源分配遵循：

| 层级                         | 比例 | 说明                                 |
| ---------------------------- | ---: | ------------------------------------ |
| 基础可靠性、性能、恢复、诊断 |  40% | 不允许被视觉功能挤占                 |
| 核心 Workbench 闭环          |  40% | 会话、任务、验证、审查、制品         |
| 开放协议与生态扩展           |  15% | ACP / AG-UI / MCP Apps / Registry 等 |
| 前瞻实验                     |   5% | A2A、多 Agent、远程沙箱等，不承诺 GA |

---

## 一、锚点治理规则

### 1.1 状态定义

| 状态        | 含义                                               |
| ----------- | -------------------------------------------------- |
| `Candidate` | 已发现价值，但尚未进入版本承诺                     |
| `Anchored`  | 已进入 v1.1.0 规划，允许继续拆解和验证             |
| `Frozen`    | 版本必须交付；范围只允许收缩细节，不允许无理由删除 |
| `Deferred`  | 明确不进入 v1.1.0 主线，保留后续版本               |
| `Rejected`  | 与产品定位、成本或架构冲突，当前否决               |

### 1.2 优先级定义

| 优先级 | 含义                         |
| ------ | ---------------------------- |
| `P0`   | 不完成则 v1.1.0 不应发布     |
| `P1`   | 构成版本竞争力，应尽量完成   |
| `P2`   | 有价值但可降级为实验性或延后 |

### 1.3 每个锚点必须具备的字段

- 稳定 ID，不因标题调整而变化；
- 用户问题；
- 当前基础；
- 缺口；
- 范围边界；
- 依赖；
- 验收标准；
- 风险与降级方案；
- 状态和优先级；
- 研究证据引用。

### 1.4 变更规则

1. 新想法先进入 [`V1.1.0_TREND_RADAR.md`](./V1.1.0_TREND_RADAR.md)，不能直接变成承诺。
2. 进入主计划后必须分配锚点 ID、状态、验收标准和依赖。
3. `Frozen` 锚点的删除必须记录原因和替代方案。
4. 不允许用“页面完成”“按钮存在”作为验收；必须以用户场景、故障路径和性能指标验收。
5. 不允许为了协议兼容推翻现有 Runtime Hub、BusEvent 和本地存储；采用 Adapter 和渐进迁移。

---

## 二、版本边界

### 2.1 v1.1.0 必须成为的产品

MiWarp 需要成为：

- Claude Code、Codex、第三方模型和内网模型的可靠桌面工作台；
- 面向真实仓库的多任务工程控制台；
- 能解释 Agent 行为、显示证据并允许用户接管的交互层；
- 支持本地工具、MCP、交互式 MCP App 和项目级技能的开放宿主；
- 能从运行、文件、测试、浏览器、Git 和诊断角度复盘任务的本地系统。

### 2.2 v1.1.0 明确不做

| 范围                              | 决策       | 原因                                                       |
| --------------------------------- | ---------- | ---------------------------------------------------------- |
| 完整 Personal AI / Life Assistant | `Deferred` | 与当前工程工作台主线差异过大                               |
| 数字分身、生活记忆、个人 Inbox    | `Deferred` | 需要独立隐私与数据产品架构                                 |
| 完整多 Agent 自主组织             | `Deferred` | 当前 `executeAgent` 仍是 mock，底层任务隔离尚未成熟        |
| Teams 实时协作平台                | `Deferred` | 当前 Teams chat 仍偏本地 mock，不应扩大假能力              |
| 自建通用云端 Agent 托管平台       | `Deferred` | 运维、安全和成本范围失控                                   |
| 复制完整 IDE                      | `Rejected` | MiWarp 应作为 Agent Workbench，不与 VS Code 正面重造编辑器 |
| 复制通用项目管理系统              | `Rejected` | Task 仅服务 Agent 工程闭环，不扩成 Jira/Linear             |
| 一次性改写全部 Runtime 协议       | `Rejected` | 风险过高，采用 Canonical Event + Adapter                   |
| 为追热点一次接入大量 Runtime      | `Rejected` | 先做能力矩阵和 Tier 1 稳定性                               |

---

## 三、总体架构目标

### 3.1 Canonical Agent Event Core

```text
Claude Code / Codex / OpenCode / MiMo / Internal CLI
                         │
                         ▼
                Runtime Adapter Layer
                         │
                         ▼
              MiWarp Canonical Agent Events
                         │
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
Conversation UI     Durable Run Journal   Local Agent Trace
       │                 │                  │
       ├───────── Artifact Center ──────────┤
       │                                    │
       ▼                                    ▼
Intervention Layer                   Diagnostics Export
```

协议兼容作为边界适配：

```text
ACP Client Adapter    → Runtime / Agent 接入
AG-UI Adapter         → Agent ↔ UI 事件互操作
MCP / MCP Apps Host   → 工具、资源、交互式 UI
A2A Adapter           → 仅实验性 Agent 委派，不进入主流程依赖
```

### 3.2 核心领域对象

```text
Workspace
├── Task
│   ├── Objective
│   ├── Execution Environment
│   ├── Agent Run(s)
│   ├── Checkpoints
│   ├── Changed Files
│   ├── Verification Results
│   ├── Artifacts
│   └── Review Decision
├── Session
├── Runtime Profile
├── MCP Integration
└── Diagnostic Trace
```

**原则**：Session 是交流和执行通道；Task 才是跨会话、跨进程、跨验证阶段的工程工作单元。

---

## 四、锚点总账本

| ID        | 名称                                      | 状态        | 优先级 | v1.1.0 交付形态              |
| --------- | ----------------------------------------- | ----------- | ------ | ---------------------------- |
| `110-A0`  | Core Experience v1 Graduation             | `Frozen`    | P0     | 发布门槛                     |
| `110-A1`  | Conversation Workbench                    | `Frozen`    | P0     | 完整版                       |
| `110-A2`  | Interactive Visual Intelligence           | `Frozen`    | P0     | 完整版                       |
| `110-A3`  | Trustworthy Change Review                 | `Frozen`    | P0     | 核心版                       |
| `110-A4`  | Runtime Control Tower                     | `Frozen`    | P0     | 核心版                       |
| `110-A5`  | Workspace & Session Command Center        | `Anchored`  | P1     | 核心版                       |
| `110-A6`  | Mobile Companion                          | `Anchored`  | P1     | 窄范围 Companion             |
| `110-A7`  | MCP App Canvas                            | `Anchored`  | P1     | Host MVP + 安全边界          |
| `110-A8`  | Worktree Task Lab                         | `Frozen`    | P0     | 核心版                       |
| `110-A9`  | Browser Verification Studio               | `Anchored`  | P1     | Lite / 工程验证优先          |
| `110-A10` | Intervention Layer                        | `Frozen`    | P0     | 核心版                       |
| `110-A11` | MCP Trust Center                          | `Anchored`  | P1     | Registry + 审计 MVP          |
| `110-A12` | Skill Packs & Workflow Recipes            | `Anchored`  | P1     | 内置 Recipes                 |
| `110-A13` | Artifact Center                           | `Frozen`    | P0     | 核心版                       |
| `110-A14` | Agent Benchmark Lab                       | `Candidate` | P2     | 可实验                       |
| `110-A15` | Protocol Gateway & Capability Negotiation | `Anchored`  | P1     | ACP/AG-UI 试点适配           |
| `110-A16` | Quality Gate Engine                       | `Anchored`  | P1     | 本地规则 MVP                 |
| `110-A17` | Attention & Review Queue                  | `Anchored`  | P1     | Workspace Inbox MVP          |
| `110-A18` | Project Context Pack                      | `Anchored`  | P1     | Handoff / Context Manifest   |
| `110-A19` | Semantic Code Intelligence                | `Anchored`  | P1     | LSP / AST / 本地索引 MVP     |
| `110-A20` | Spec & Acceptance Workspace               | `Anchored`  | P1     | Spec → Plan → Task → Gate    |
| `110-A21` | Native Window Surface Contract            | `Frozen`    | P0     | macOS 原生几何与背景连续性   |
| `110-A22` | Change Graph & Undo Timeline              | `Anchored`  | P1     | 操作图谱 + 可逆变更          |
| `110-A23` | Reproducible Environment Capsule          | `Anchored`  | P1     | 环境清单 + 可重复执行        |
| `110-A24` | Project Memory Blocks                     | `Anchored`  | P1     | 可编辑、可溯源项目记忆       |
| `110-A25` | Agent Eval & Regression Studio            | `Anchored`  | P1     | 本地评测与版本回归           |
| `110-S1`  | Durable Run Journal                       | `Frozen`    | P0     | 核心版                       |
| `110-S2`  | Local Agent Trace                         | `Frozen`    | P0     | 核心版                       |
| `110-S3`  | Context Budget Manager                    | `Anchored`  | P1     | 可视化 + 减负 MVP            |
| `110-S4`  | Execution Profiles                        | `Anchored`  | P1     | Local / Worktree / Container |
| `110-S5`  | Resource & Cost Governor                  | `Anchored`  | P1     | 预算、并发、进程治理         |
| `110-S6`  | Capability Attestation & Policy Engine    | `Anchored`  | P1     | 来源、能力、权限运行时策略   |
| `110-G1`  | Diagnostics & Performance Gate            | `Frozen`    | P0     | 发布门槛                     |
| `110-R1`  | Architecture Evolution                    | `Frozen`    | P0     | 全周期约束                   |
| `110-X1`  | A2A Delegation Experiment                 | `Candidate` | P2     | Lab，不承诺 GA               |

---

## 五、P0 核心锚点

## `110-A0` Core Experience v1 Graduation

**状态**：`Frozen` · **优先级**：P0

### 用户问题

用户不能因为基础链路不稳定而质疑整个产品：启动、发送、流式输出、工具、权限、文件、终端、Git、恢复和停止都必须可信。

### 当前基础

- v1.0.9 Send transaction、幂等、草稿保留、队列、恢复和 typed failure；
- Runtime Hub 与基础 provider 配置；
- 已有大量前后端单测；
- [`core-experience-v1.md`](./core-experience-v1.md) 已定义 12 个领域和毕业要求。

### 缺口

- Tier 1 Provider fixture / capability matrix 未完整毕业；
- Golden-path 场景 E2E 不是默认发布门禁；
- 断网、休眠、CLI 崩溃、App 崩溃等 fault injection 不完整；
- 7 天真实项目 soak 未完成；
- 部分性能目标仍缺少真实 p50/p95 采样。

### 验收

- 12 个核心领域具备自动测试和失败路径证据；
- Tier 1 Runtime 的能力矩阵有最近验证时间；
- 关键故障注入通过；
- 完成连续 7 天真实项目 soak；
- 阻塞级问题为 0；
- 诊断包能还原关键链路但不包含敏感正文。

---

## `110-A1` Conversation Workbench

**状态**：`Frozen` · **优先级**：P0

### 目标

把当前线性聊天记录升级为“对话优先、过程可展开”的工程时间线。

### 当前基础

- 过程可见性正在从四模式收敛为“对话 / 全部”；
- Session Status Bar 已有 runtime、model、view、context；
- Tool activity、权限、状态事件已有展示基础；
- Continuity Capsule 已存在。

### 范围

- 默认“对话”只保留用户意图、Agent 结论、关键问题和结果；
- “全部”显示工具、命令、权限、过程事件和诊断细节；
- 阶段模型：Understanding / Planning / Editing / Verifying / Waiting / Reviewing / Complete；
- 长工具 burst 自动折叠并生成阶段摘要；
- 可跳转到下一个权限、失败、文件修改、测试结果和浏览器证据；
- Timeline 内统一显示 Task、Run、Checkpoint 和 Artifact 引用；
- 大会话采用 progressive timeline、虚拟化和局部加载。

### 验收

- 10,000 个 Timeline Event 滚动 ≥ 55 FPS；
- 同一 Run 在“对话 / 全部”切换时事件身份不改变；
- 权限、失败和未完成动作不能被摘要隐藏；
- 用户能在 3 次点击内定位最近一次失败及其证据；
- 会话恢复后阶段和关键事件一致。

---

## `110-A2` Interactive Visual Intelligence

**状态**：`Frozen` · **优先级**：P0

### 目标

把 Mermaid、Vega、KPI、Timeline、Mind Map 从静态美化升级为可交互、可追踪、可复用的 Agent 视觉语言。

### 当前基础

- streaming completed fence 检测；
- MermaidInteractive、pan/zoom/fullscreen、节点弹层和 send-to-prompt；
- Mermaid 安全、主题和图结构测试；
- VisualBlockHost 和内置可视化技能。

### 范围

- Streaming Visual Blocks；
- Mermaid、Vega-Lite、KPI、Timeline、Mind Map 统一 Host；
- 节点选择、范围选择、发送到输入框；
- Visual Block 与来源消息、工具、文件和 Artifact 绑定；
- 导出 SVG / PNG / JSON；
- 大图渐进渲染和超限降级；
- 不可信 HTML / SVG / URL 安全隔离；
- 为 MCP Apps 预留统一视觉容器，但不混淆两类安全模型。

### 验收

- 已闭合 fence 在流式期间最多一次挂载；
- 未闭合或异常内容不得破坏聊天页面；
- 交互操作可回填 Prompt，且保留结构化来源；
- 主题切换不重新执行不必要的远程资源；
- 大图超过预算时明确降级为静态或源码。

---

## `110-A3` Trustworthy Change Review

**状态**：`Frozen` · **优先级**：P0

### 目标

让用户知道“谁改了什么、为什么改、如何验证、能否安全撤销”。

### 范围

- 区分 Agent 修改、用户修改和会话开始前已有修改；
- 每个变更绑定 Run / action_id / tool call / Task；
- 文件级和行级 Diff；
- 大 Diff 虚拟化；
- 行内评论和批量发送给 Agent 修订；
- Checkpoint 前后比较；
- 按 Task 生成 Commit scope；
- 明确 rollback 能力边界；
- 检测 Agent 覆盖用户未提交修改的风险。

### 验收

- 10,000 行 Diff p95 ≤ 500ms 可操作；
- 所有 Agent 写入都能追踪到 action_id；
- 预存在修改不会被错误归因给 Agent；
- 回滚前展示将影响的文件和未提交修改；
- 用户能对具体行评论并一键发起修订回合。

---

## `110-A4` Runtime Control Tower

**状态**：`Frozen` · **优先级**：P0

### 目标

统一管理 Runtime、Provider、Model、CLI 配置、能力和健康状态，不让“能选择”被误认为“真实可用”。

### 范围

- Runtime / Provider / Model 三层身份明确；
- capability negotiation 与最近验证时间；
- CLI 路径、版本、登录状态、配置来源和环境变量诊断；
- 设置写入前备份、原子写入、验证和回滚；
- 配置 Diff；
- Provider 降级和能力缺失提示；
- Tier 1 / Experimental 标签；
- Runtime health probe；
- 统一能力矩阵：streaming、tool、permission、resume、image、MCP、browser、parallel tool 等。

### 验收

- 任何 Runtime 都不能仅凭配置存在就显示为 Healthy；
- 配置失败后原文件可恢复；
- 能力不支持时 UI 不展示虚假入口；
- 每个 Tier 1 Runtime 有真实 E2E 记录；
- Model 切换不能改变正在运行 Run 的身份。

---

## `110-A8` Worktree Task Lab

**状态**：`Frozen` · **优先级**：P0

### 目标

建立比 Session 更高一级的工程任务单元，让并行 Agent 工作具有隔离、验证和可收口的边界。

### Task 数据结构

```text
Task
├── objective / constraints
├── runtime / model
├── workspace / branch / worktree
├── runs / sessions
├── processes / dev servers
├── checkpoints
├── changed files
├── tests / browser verification
├── artifacts
├── review comments
└── merge / keep / discard decision
```

### 范围

- 从 Prompt、Issue、Diff 或现有 Session 创建 Task；
- 可选独立 Worktree；
- Task 状态：Draft / Ready / Running / Needs Attention / Verifying / Review / Done / Failed / Archived；
- 任务预算、最大文件数、允许目录和验证命令；
- 并行任务进程治理；
- Task 级恢复、归档和清理；
- 合并、保留分支或丢弃 Worktree；
- 不扩展成通用项目管理平台。

### 验收

- 两个 Task 可在独立 Worktree 并行运行而不串写；
- Task 结束后能回收 CLI、终端和 Dev Server；
- Task 级 changed files、tests、artifacts 与 Session 一致；
- 删除 Worktree 前必须检查未提交和未推送状态；
- App 重启后 Task 状态可恢复。

---

## `110-A10` Intervention Layer

**状态**：`Frozen` · **优先级**：P0

### 目标

从“允许 / 拒绝一次工具调用”升级为完整的人机共同控制层。

### 五种干预

1. **Plan Gate**：高风险或大范围任务开始前展示计划、预计文件和命令。
2. **Action Guard**：根据动作语义评估删除、迁移、Push、外网、敏感目录等风险。
3. **Live Steering**：运行中追加约束，不必销毁 Session。
4. **Pause at Checkpoint**：按阶段、文件数量或风险条件暂停。
5. **Take Over**：用户临时接管终端或浏览器，完成后交还 Agent。

### 验收

- 高风险动作不会只依赖命令字符串正则判断；
- 新约束有明确生效边界，不伪装为已经影响历史动作；
- 暂停后不继续启动新工具；
- 接管期间 Agent 不与用户争抢输入；
- 所有干预进入 Durable Run Journal 和 Trace。

---

## `110-A13` Artifact Center

**状态**：`Frozen` · **优先级**：P0

### 目标

让 Agent 的交付物脱离聊天正文，成为可复用、可验证、可比较的一级对象。

### Artifact 类型

- Diff / Patch；
- File / Folder；
- Plan / Decision Record；
- Test Report / Coverage；
- Screenshot / Browser Recording；
- Mermaid / Vega / Mind Map；
- Terminal Log；
- Build / Package；
- PR / Commit；
- Diagnostic Bundle；
- Context Pack。

### 能力

- 按 Workspace、Task、Run、类型筛选；
- 固定、比较、导出、重新打开；
- 设为验收证据；
- 发送到其他 Session；
- 进入下一轮上下文时使用指针和摘要，不默认复制全部正文；
- 本地清理策略和引用完整性检查。

### 验收

- 每个 Artifact 有来源、时间、Task、Run 和内容哈希；
- 删除被引用 Artifact 前必须提示；
- 大 Artifact 不阻塞会话加载；
- 导出时不默认包含密钥和敏感正文；
- 会话被归档后 Artifact 仍可访问。

---

## `110-A21` Native Window Surface Contract

**状态**：`Frozen` · **优先级**：P0

### 用户问题

当前主内容左侧圆角与 macOS 原生窗口外轮廓并不一致；圆角切出的缺口也没有真实延续左侧会话栏的合成背景，导致透明、变色或出现不连续的色块。

### 当前实现缺口

- `.app-main-shell` 与 `.miwarp-main-surface` 分别硬编码 `0.75rem`，没有与原生窗口 mask、缩放和平台状态共享几何来源；
- 缺口只绘制 `--sidebar-background`，但真实左栏可能由透明层、系统 sidebar effect、渐变 overlay 和主题色共同合成；
- maximized、fullscreen、不同 UI zoom、原生玻璃开关和浏览器 fallback 没有统一 Surface Contract；
- 圆角和背景连续性主要依赖人工肉眼检查，没有截图回归。

### 范围

- 建立唯一几何 token：window mask、main surface、sidebar underlay 和交互卡片不得各自猜测圆角；
- macOS 使用平台状态决定角半径，最大化或全屏时归零，不用固定 Web CSS 冒充原生外窗；
- 圆角缺口必须绘制与左侧会话栏同源的 underlay，而不是近似颜色；
- 原生玻璃模式复用同一 overlay / tint 合成链路，禁止透明桌面壁纸从缺口意外穿透；
- fallback 模式使用同一 sidebar surface token，保证浅色、深色和自定义主题一致；
- 处理 100%、110%、125% 等 UI zoom 下的像素对齐和抗锯齿 halo；
- 将主窗体四角、左侧折叠/展开、主题切换、glass 开关纳入视觉回归矩阵。

### 验收

- 主内容左上、左下圆角与 macOS 窗口外轮廓在视觉上同心，不出现半径突变；
- 圆角空白区域与左侧会话栏在颜色、透明度、模糊和渐变上连续；
- light / dark、native glass on/off、sidebar collapsed/expanded、不同 zoom 下无透明漏底和色差 halo；
- maximized / fullscreen 不残留悬浮圆角；
- 自动截图差异超过阈值时阻止发布；
- Windows / Linux 使用各自平台 surface policy，不被 macOS 私有视觉逻辑污染。

---

## `110-S1` Durable Run Journal

**状态**：`Frozen` · **优先级**：P0

### 目标

把长任务建模为持久 Run，而不是依赖一个恰好还活着的 CLI 进程。

### 关键字段

```text
Run
├── objective
├── plan_revision
├── current_stage
├── accepted_user_messages
├── active / completed actions
├── checkpoints
├── process handles
├── file mutations
├── verification results
├── pending approvals
└── recovery cursor
```

### 不变量

- 一个用户意图只能形成一个 accepted transaction；
- 每个工具动作有唯一 action_id；
- 非幂等动作不能自动盲重试；
- 文件修改必须绑定来源动作；
- recovery cursor 单调前进；
- 不确定是否完成的动作必须标记 `uncertain`，不得伪装成功或失败。

### 验收

- App 崩溃后能说明完成到哪里；
- CLI 崩溃后能区分 safe retry、manual confirmation 和 impossible resume；
- 100 次人工断连无重复用户消息、无静默丢失；
- 休眠恢复后 pending approval 和 active process 状态能收敛；
- Journal 写入不会阻塞主渲染线程。

---

## `110-S2` Local Agent Trace

**状态**：`Frozen` · **优先级**：P0

### 目标

统一观测用户任务、模型请求、工具、权限、文件、测试、浏览器和恢复链路。

### Span 最小字段

- trace_id / span_id / parent_span_id；
- workspace / task / run / session；
- runtime / provider / model / version；
- start / end / duration；
- token / cost estimate / input-output size；
- tool / action_id / process；
- permission wait；
- cache hit；
- retry / recovery；
- result / typed error；
- artifact references。

### 验收

- 默认完全本地；
- 支持脱敏 JSON 和诊断包导出；
- Trace 页面能从失败跳到相关日志、文件和 Artifact；
- 不记录密钥、完整环境变量和默认用户正文；
- 能计算首 Token、工具等待、权限等待、恢复时间和总时长。

---

## `110-G1` Diagnostics & Performance Gate

**状态**：`Frozen` · **优先级**：P0

### 发布门槛

- Diagnostics / Doctor UI；
- 一键脱敏导出；
- p50 / p95 / p99 性能采样；
- 内存和进程泄漏检测；
- 关键版本 before / after 对比；
- Scenario E2E；
- Fault Injection；
- 7 天 soak；
- macOS / Windows 主路径验证；
- 移动 Companion 的窄路径验证。

---

## `110-R1` Architecture Evolution

**状态**：`Frozen` · **优先级**：P0

### 当前风险

现有代码中仍存在大型 God Object 和高耦合热点，包括但不限于：

- `session-store.svelte.ts`；
- `src/routes/+layout.svelte`；
- `src/routes/chat/+page.svelte`；
- `src/lib/api.ts`；
- `claude_protocol.rs`；
- `commands/session.rs`；
- `session_actor.rs`；
- `models.rs`。

### 约束

- 不做 flag-day rewrite；
- 每个新锚点先定义领域边界和所有权；
- 新功能不得继续把 chat page、root layout、SessionStore 和 session command 变大；
- 前端按 Task / Run / Artifact / Runtime / Trace 领域拆分；
- 后端 command handler 只负责边界转换，核心逻辑进入 service / domain；
- 事件模型采用版本化 Canonical Event；
- 每次拆分都先锁行为测试，再迁移实现。

---

## 六、P1 竞争力锚点

## `110-A5` Workspace & Session Command Center

- Workspace 首页展示 Active、Needs Attention、Review、Failed、Recently Completed；
- 支持 Peek，不切换主会话即可查看任务状态和最近证据；
- 项目级 Git 状态、运行进程、Runtime 健康、MCP 健康；
- 近期 Session / Task 秒开；
- Workspace Inbox 与 `110-A17` 共用数据模型。

**验收重点**：100+ Session、20+ Task 仍能快速加载；首页不启动多余 CLI；所有状态来自真实 Journal / Trace，不靠前端猜测。

## `110-A6` Mobile Companion

v1.1.0 只做窄范围：

- 查看 Task / Run 状态；
- 权限审批；
- 发送短消息或 steering；
- Stop / Pause；
- 查看结果摘要和关键 Artifact；
- Live Activity；
- 重连后的状态收敛。

明确不做移动 IDE、完整 Diff 编辑和复杂终端。

## `110-A7` MCP App Canvas

### 目标

让 MCP Tool 返回的交互式界面在会话中安全运行：图表、表单、Dashboard、设计画布、监控面板等。

### MVP

- `ui://` 资源识别；
- sandboxed iframe Host；
- Host ↔ App 双向消息；
- Tool result 注入；
- App 发起受控 Tool call；
- 主题、尺寸、全屏；
- 网络、剪贴板、文件和导航权限；
- crash / timeout / fallback；
- Artifact snapshot。

### 安全红线

- 默认无任意本地文件访问；
- 默认无宿主 DOM 权限；
- App 不继承 CLI 进程权限；
- 外部导航必须明确；
- Tool call 继续经过 MiWarp 权限和 Trace。

## `110-A9` Browser Verification Studio

### 定位

服务软件工程验证，不做通用网页自治平台。

### 能力

- Task 对应 Dev Server；
- 内置 Browser Preview；
- DOM / Accessibility Tree；
- Console / Network / Storage / Page Error；
- 结构化 Playwright 动作；
- 步骤截图和可选录像；
- 设备尺寸模拟；
- 稳定步骤固化为脚本；
- 页面改变时才调用模型重新规划；
- Verification Report 进入 Artifact Center。

### 验收

- 稳定脚本重放不调用模型；
- 每张截图绑定 step_id；
- 浏览器崩溃不拖垮 Agent Run；
- Task 完成后 Dev Server 和 Browser 可回收；
- Console Error 自动进入报告。

## `110-A11` MCP Trust Center

### 能力

- 官方 Registry 浏览和搜索；
- 发布者、命名空间和来源验证；
- 安装前权限摘要；
- 环境变量、目录、网络域名和命令风险；
- Schema 静态检查；
- 沙箱 health probe；
- tools/list 和最小调用验证；
- 更新前后 capability / permission diff；
- 慢工具、失败次数、崩溃、熔断和回退；
- MCP App 标识。

### 原则

Registry 提供发现，不代表 MiWarp 替第三方 Server 背书。所有“已验证”都必须注明验证范围、平台和时间。

## `110-A12` Skill Packs & Workflow Recipes

### Recipe 结构

```yaml
name: frontend-feature
steps:
  - inspect
  - plan
  - create-worktree
  - implement
  - run-tests
  - launch-dev-server
  - browser-verify
  - review-diff
  - prepare-commit
```

### 内置 Packs

- Frontend Feature；
- Bug Investigation；
- Dependency Upgrade；
- Security Audit；
- Test Coverage；
- Documentation；
- Release Preparation；
- Performance Regression；
- Code Review；
- Repository Onboarding。

每个 Recipe 可设置 Runtime、模型、工具白名单、检查点、验证命令、预算、最大文件数和失败策略。

## `110-A15` Protocol Gateway & Capability Negotiation

### 目标

建立开放协议边界，但不让协议细节污染核心领域。

### v1.1.0 范围

- ACP Client Adapter 原型：initialize、capabilities、session、prompt、tool / permission 映射；
- AG-UI Export / Import 原型：将 Canonical Events 映射到标准事件；
- MCP / MCP Apps 保持独立 Tool 层；
- A2A 仅研究，不成为主依赖；
- Adapter conformance fixtures；
- capability negotiation 和版本记录。

## `110-A16` Quality Gate Engine

### 目标

把“完成条件”从 Prompt 文本升级为可执行规则。

### 规则类型

- 必须通过的命令；
- 禁止修改路径；
- 最大文件数 / 最大 Diff；
- 必须存在的测试；
- Console Error 上限；
- 浏览器步骤；
- Coverage 阈值；
- 敏感文件检查；
- Git clean / no untracked policy；
- 用户自定义验收项。

Gate 结果进入 Task 和 Artifact，Agent 不能仅靠文字声明绕过。

## `110-A17` Attention & Review Queue

### 目标

让用户面对并行任务时只处理真正需要人的地方。

### Attention 类型

- Permission；
- Question；
- Plan Review；
- Failed Verification；
- Merge Conflict；
- Uncertain Recovery；
- Budget Limit；
- Runtime Offline；
- MCP Risk / Crash；
- Final Review。

支持按风险、等待时间和 Workspace 分组；已解决项保留审计记录。

## `110-A18` Project Context Pack

### 目标

把跨 Session、跨模型的项目上下文变成可审计的 Context Manifest，而不是无边界复制历史。

### 内容

- 当前目标和约束；
- 架构摘要；
- 关键文件和符号；
- 最近决策；
- 已完成 / 未完成；
- 已知失败；
- 重要 Artifact 指针；
- Worktree / branch / Git 状态；
- 建议下一步。

支持 Continuity Capsule、Task handoff、新模型接力和导出。

## `110-A19` Semantic Code Intelligence

### 目标

让 Agent 以符号、引用、类型和 AST 结构理解仓库，减少整文件扫描、文本替换和重复上下文消耗。

### 能力

- LSP-backed symbol outline、definition、references、implementations、diagnostics；
- 本地增量 Symbol Index 和跨文件关系缓存；
- Tree-sitter / AST structural search；
- 结构化 rename、replace symbol body、insert before / after symbol；
- 变更前引用影响分析；
- 大仓库按 package / module / symbol 构建 Context Map；
- 索引状态、语言服务健康和重建入口；
- 与 Context Budget Manager 联动，只把相关 symbol 和关系放入上下文；
- 与 Trustworthy Change Review 联动，标识结构化重构和纯文本修改。

### 边界

- 不在 v1.1.0 重造完整 IDE；
- 优先复用系统已有 Language Server 或可插拔 Adapter；
- 语义编辑失败时明确降级为普通文件工具；
- Index 只作为加速层，不能成为文件真实来源。

### 验收

- 修改文件后相关 symbol 增量更新，不要求全仓重建；
- 能在大仓库中按 symbol 查询引用而不读取全部文件；
- rename 前展示影响范围，失败时不留下半完成修改；
- 索引损坏可安全重建；
- 所有结构化编辑仍进入 action_id、Journal、Diff 和 Trace。

## `110-A20` Spec & Acceptance Workspace

### 目标

把需求、约束、技术计划、任务和验收条件变成 Task 的结构化前置与收口依据，降低 Agent“理解偏了但仍大量实现”的风险。

### 工作流

```text
Project Principles
→ Feature Spec（what / why）
→ Clarification
→ Technical Plan
→ Executable Tasks
→ Consistency Analysis
→ Implementation
→ Quality Gates
→ Convergence Review
```

### 能力

- 项目级 Principles / Constitution；
- Feature Spec、用户故事、非目标和成功标准；
- Clarification Queue；
- 技术计划和架构影响；
- 从计划生成 Worktree Task；
- Spec / Plan / Task / Diff / Test 双向追踪；
- 完成前检查遗漏、冲突和未覆盖需求；
- Spec、Plan 和 Checklist 作为 Artifact；
- 可由 Skill Pack / Recipe 提供模板，但数据归 MiWarp Task 所有。

### 验收

- 每个实现 Task 可追踪到至少一个需求或明确标记为维护任务；
- Quality Gate 可引用 Spec acceptance criteria；
- Agent 无法用最终文字声明代替未通过的验收项；
- Spec 变更能显示受影响 Task 和已完成实现；
- 用户可跳过完整流程创建轻量 Task，不强迫所有改动走重型 SDD。

## `110-A22` Change Graph & Undo Timeline

### 目标

把 Agent 产生的文件修改、提交、分支和用户干预建模为可解释的变更图，而不是只保留最终 Diff。

### 能力

- 每次写入、移动、删除、格式化、提交和冲突处理形成 operation node；
- Task、Run、action_id、文件块和 Git commit 之间可双向追踪；
- 支持按 operation、文件、hunk 或 checkpoint 预览撤销影响；
- 支持将混合修改拆分、移动到不同 Task / change stack、重新排序和组合；
- 并行 Agent 修改以独立 change lane 展示，合并前执行冲突和依赖分析；
- 用户操作与 Agent 操作使用不同 provenance；
- Git 是默认持久边界，可选研究兼容 Jujutsu operation log 的实验 Adapter。

### 边界

- 不直接复制第三方 VCS 客户端代码或受限许可实现；
- 不在 v1.1.0 替换 Git；
- “Undo”必须说明文件、提交、工作区和外部副作用的可逆范围，不能承诺撤销已执行的部署或远程 API。

### 验收

- 用户能从最终 Diff 回到对应 action、Prompt、检查点和验证结果；
- 撤销前可预览影响，不覆盖无关的用户修改；
- 并行 Task 的 change lane 不静默串写；
- operation history 在 App 重启后仍可恢复；
- 大变更图按需加载，不阻塞聊天首屏。

## `110-A23` Reproducible Environment Capsule

### 目标

让“在我的电脑上能跑”升级为可检查、可重建、可迁移的任务执行环境。

### 能力

- 检测 `devcontainer.json`、Dockerfile、Compose、toolchain、package manager、环境变量引用和端口；
- 生成 Environment Manifest：OS、架构、Runtime、工具版本、依赖锁、服务、网络和 secret 引用；
- Task 可选择 Local、Worktree、Dev Container、Container 或 Remote Sandbox；
- 环境准备、依赖安装、测试和构建步骤可缓存并显示 cache key；
- 同一 Recipe 可以在本机、CI 或沙箱重放；
- 环境差异在失败报告中明确展示；
- 产出可导出的 Capsule Artifact，但不打包 secret 明文。

### 边界

- Docker / Dev Container 不是强制依赖；
- 不替用户隐藏昂贵的镜像构建、网络下载和磁盘占用；
- 环境缓存必须有来源、失效和清理策略。

### 验收

- 同一 Capsule 在支持的平台上得到一致工具链和验证命令；
- 缺失依赖时给出结构化差异，而不是笼统“command not found”；
- 缓存命中、失效原因和节省时间可观察；
- Task 完成后容器、端口和临时卷可回收；
- Local 路径始终可用，不因容器功能引入启动回归。

## `110-A24` Project Memory Blocks

### 目标

为工程项目建立少量、可编辑、可溯源的长期记忆块，避免每个 Session 重新发现架构约束、用户决策和已知失败。

### Memory Block 类型

- Project Principles；
- Architecture Decisions；
- Coding Conventions；
- Known Failures / Workarounds；
- Runtime / Environment Notes；
- User-approved Preferences；
- Active Risks；
- Rejected Alternatives。

### 能力

- 每个 block 有来源、作者、更新时间、适用范围、置信度和过期策略；
- 用户可锁定、编辑、拒绝和查看变更历史；
- Agent 建议写入记忆时必须展示 diff，不允许静默自我改写；
- Context Budget Manager 只注入与当前 Task 相关的 blocks；
- 与 Spec、ADR、Artifact 和 Context Pack 双向引用；
- 分支 / Worktree 可以继承并局部覆盖项目记忆。

### 验收

- 任何注入模型的长期记忆都可在 UI 中看到其来源；
- 过期或冲突 block 会提示，不静默覆盖新事实；
- 用户能一键禁用某个 block 并重新运行 Task；
- memory 注入量有明确 token 预算；
- 删除项目时可完整导出或清理本地记忆。

## `110-A25` Agent Eval & Regression Studio

### 目标

把模型、Runtime、Prompt、Skill 和协议升级从“凭感觉更好”升级为当前仓库上的可重复评测。

### 能力

- 从真实成功 / 失败 Task 保存脱敏 Eval Case；
- Case 包含初始仓库状态、目标、约束、允许工具、验收 Gate 和期望 Artifact；
- 并排比较 Runtime、Model、Recipe、Prompt 和 Context Strategy；
- 指标覆盖成功率、测试、Diff 质量、人工干预、恢复、时间、token 和成本；
- 支持 MCP tool poisoning、越权调用、危险命令和 secret exposure 的本地安全测试；
- 结果形成版本趋势和 release regression；
- 失败案例可直接转为修复 Task。

### 边界

- 不把少量私有任务包装成通用模型排行榜；
- 默认本地运行和本地保存，分享前脱敏；
- 自动评分与人工 Review 分开显示。

### 验收

- 同一 Case 可在固定环境和随机种子策略下重放；
- 模型或 Runtime 升级前后显示显著回归；
- Release Gate 可引用关键 Eval Suite；
- 评测产生的进程、Worktree 和 Artifact 有界回收；
- 用户可以追溯每个分数到具体步骤和证据。

## `110-S3` Context Budget Manager

### 可视化

```text
System / Project Instructions / Conversation / Files / Tool Outputs /
MCP Schemas / Memory / Reserved
```

### 优化

- Tool Schema lazy loading；
- 大 Tool Output Artifact 化；
- 重复文件读取去重；
- 历史工具摘要；
- Context Manifest 缓存；
- Compact 前后差异；
- 预计剩余空间和 Handoff 建议；
- Prompt Cache 命中观测。

## `110-S4` Execution Profiles

| Profile         | v1.1.0                         |
| --------------- | ------------------------------ |
| Read Only       | 必须                           |
| Workspace Write | 必须                           |
| Full Local      | 必须                           |
| Local Worktree  | 必须                           |
| Container       | P1，优先 Docker/Podman Adapter |
| Remote Sandbox  | 实验性                         |
| SSH Host        | Candidate                      |

统一接口负责 prepare、execute、read/write、exposePort、snapshot 和 dispose。

## `110-S5` Resource & Cost Governor

### 目标

防止并行 Agent、浏览器、Dev Server、MCP 和模型调用无限消耗资源。

### 能力

- Workspace / Task 并发上限；
- CLI、Browser、Dev Server 进程配额；
- 内存和 CPU 软阈值；
- Token / 金额预算；
- 长时间 idle 回收；
- 异常进程孤儿检测；
- 高消耗提示和停止策略；
- 按 Runtime / Task 的成本追踪。

## `110-S6` Capability Attestation & Policy Engine

### 目标

在 Runtime、MCP、Skill、Recipe 和远程 Agent 之间建立统一的来源、能力和权限证明，并在每次执行时真正强制策略。

### 能力

- 保存组件来源、发布者、版本、内容哈希、签名状态和安装时间；
- capability manifest 明确声明文件、命令、网络、secret、采样和 UI 权限；
- 更新时显示 manifest / schema / permission diff；
- Tool call 绑定 origin、Task、user intent 和 policy decision；
- 支持 allow / ask / deny、目录和域名范围、时效授权和单次授权；
- 运行中检测工具描述漂移、未知二进制和越权行为并熔断；
- 所有决定写入 Local Agent Trace 和诊断包。

### 验收

- Registry 中“可发现”不会被显示为“已信任”；
- 组件内容或能力变化后旧授权自动失效或要求复核；
- 任一 Tool call 可以回答“谁提供、为何允许、访问了什么”；
- Policy Engine 不依赖模型自行遵守文字说明；
- 默认策略在本地离线可运行。

---

## 七、实验性锚点

## `110-A14` Agent Benchmark Lab

**状态**：`Candidate` · **优先级**：P2

针对当前仓库用同一测试任务比较不同 Runtime / Model：

- 启动、首 Token、总时间；
- Token / 成本；
- 测试通过率；
- 修改文件数；
- 人工干预次数；
- 恢复成功率；
- 任务类型适配。

不允许把一次小样本结果包装成普遍模型排行榜。

## `110-X1` A2A Delegation Experiment

**状态**：`Candidate` · **优先级**：P2

只验证：

- Agent Card / capability discovery；
- 一个 Task 向外部 Agent 委派受限子任务；
- 结果作为 Artifact 返回；
- 权限、预算、Trace 和取消边界。

不在 v1.1.0 承诺复杂自主 Agent 团队。

---

## 八、性能与稳定性目标

> 以下是 v1.1.0 目标，不代表当前已经达到。

### 8.1 启动与导航

| 指标                    |        目标 |
| ----------------------- | ----------: |
| 缓存 Shell 首次可见     | p95 ≤ 150ms |
| 最近会话列表可交互      | p95 ≤ 250ms |
| 缓存 Session 首屏       | p95 ≤ 300ms |
| 缓存命中 Session 切换   | p95 ≤ 120ms |
| 缓存未命中首批 Timeline | p95 ≤ 500ms |

### 8.2 长会话与大数据

| 指标                          |               目标 |
| ----------------------------- | -----------------: |
| 10,000 Timeline Event 滚动    |           ≥ 55 FPS |
| 追加单个流式 Event 主线程占用 |          p95 ≤ 8ms |
| 10,000 行 Diff 首次可操作     |        p95 ≤ 500ms |
| 连续切换 20 次 Session        |     不新增孤儿 CLI |
| 8 小时 Task                   | 内存无持续线性增长 |

### 8.3 恢复

| 指标           |               目标 |
| -------------- | -----------------: |
| 正常重连       |           p95 ≤ 2s |
| 100 次人工断连 | 0 重复、0 静默丢失 |
| App 崩溃重启   | 明确恢复或明确降级 |
| 非幂等 Tool    |       不自动盲重试 |
| 未确认动作     |   显示 `uncertain` |

### 8.4 Browser Studio

| 指标           |                        目标 |
| -------------- | --------------------------: |
| 稳定脚本重放   |                  0 模型调用 |
| 截图与步骤绑定 |                        100% |
| Console Error  |                自动进入报告 |
| Browser crash  |                  不拖垮 Run |
| Task 结束      | Browser / Dev Server 可回收 |

### 8.5 MCP

| 指标        |            目标 |
| ----------- | --------------: |
| Server 启动 |        有界超时 |
| tools/list  |     Schema 校验 |
| Tool 调用   |  可取消、可超时 |
| 连续失败    |            熔断 |
| MCP App     |        沙箱隔离 |
| 更新        | 能力与权限 Diff |

---

## 九、交付波次

### Wave 0 · 基线和文档收口

- 对齐 README、CHANGELOG、版本计划和真实代码；
- 固化 v1.0.9 当前能力矩阵；
- 建立 Trace / Performance 基线；
- 先收口 Native Window Surface Contract：统一 macOS 圆角几何、sidebar underlay 和视觉回归；
- 锚点拆 Issue，不开始大规模并行实现。

### Wave 1 · Conversation Foundation

- 完成当前 Conversation Workbench WIP；
- 统一 Canonical Event / phase；
- progressive timeline 和长会话性能；
- Architecture seam，阻止大型文件继续膨胀。

### Wave 2 · Durable Task Core

- Task、Run Journal、Checkpoint、Attention Queue；
- Worktree Task Lab；
- Spec & Acceptance Workspace 基础模型；
- Change Graph / operation provenance 基础模型；
- Resource Governor；
- 恢复和 fault injection。

**2026-06-23 进展**：Task aggregate、run/artifact/worktree/verification/review/merge 链接已进入实现；Task 快照现具备单调 `revision` / `last_event_seq`，每项有效变更写入 typed lifecycle journal。`mutation.json → events.jsonl → task.json` 的本地 WAL 顺序支持中断后的幂等恢复，重复 link/no-op 不推进版本；桌面 IPC 与 WebSocket 均可增量读取 Task events。启动时先收敛 orphan run，再把失去活跃 run 的执行中 Task 原子迁移到 `needs_attention` 并记录 `restart_reconciled`。

**2026-06-23 Run Journal 切片**：Durable Run Journal 基础层已落地——每 run 独立 `run-journal.json` / `run-journal-events.jsonl` / `run-journal-mutation.json` WAL（与 chat `events.jsonl` 分离）；typed `RunStage` / `RunActionRecord` / `RecoveryCursor` / `RunCheckpoint` 领域模型；保守幂等分类；`start_run` 在 meta 创建后初始化 journal（失败则回滚 run）；`session_actor` stdin 前检查 durable accepted IDs，stdin 成功后同步持久化 `UserMessageAccepted`；`BroadcastEmitter` 在 bus seq 分配后投影粗粒度语义事件（delta 噪声忽略，投影失败仅 degraded）；启动顺序 `reconcile_orphaned_runs → run_journal::reconcile_after_restart → tasks::reconcile_after_restart → attention_queue::reconcile`。

**2026-06-23 Attention Queue 切片**：Durable Attention Queue + HITL 基础层已落地——单一全局 aggregate（`~/.miwarp/attention/queue.json` / `events.jsonl` / `mutation.json`），typed `AttentionKind` / `AttentionSeverity` / `AttentionStatus` / `AttentionAction` 领域模型与 `stable_key` 幂等 upsert；来源映射覆盖 `Task.needs_attention`、run journal `pending_approvals` / `manual_confirmation` / `impossible_resume` / `journal_degraded`（只读已有 journal，corrupt journal 投影 `impossible_resume`）；`retry_task` / `mark_task_failed` 采用“来源聚合先变更、Attention WAL 后审计”的收敛编排，且不持有跨聚合嵌套锁；pending approval 仅 acknowledge、不可由队列伪装成已批准；其他恢复决定只记录 operator disposition，不改写或伪造 Run action 成功；run journal 发生语义投影 / degraded 与 task status 变更后 best-effort `sync_run` / `sync_task`；桌面 IPC + WebSocket + 前端 `AttentionQueueStore`（load / incremental events / ack / resolve / reconcile / single-flight / derived 查询）。**仍未做**：Attention Queue 可见 UI 与实时 push 订阅、历史事件压缩/归档、Run 级恢复执行编排、Worktree Task Lab、完整 v1.1.0 闭环。

### Wave 3 · Visual + Artifact

- Visual Intelligence 完成；
- Artifact Center；
- Context Pack；
- Project Memory Blocks；
- Semantic Code Intelligence 基础索引；
- MCP App Canvas Host MVP。

### Wave 4 · Review + Quality

- Change provenance；
- Change Graph、Undo Timeline 和 change lanes；
- 大 Diff；
- 行内评论；
- Quality Gate；
- Commit / merge / discard 决策。

### Wave 5 · Runtime + Protocol

- Runtime Control Tower；
- Tier 1 capability matrix；
- ACP / AG-UI Adapter 试点；
- MCP Trust Center；
- Capability Attestation & Policy Engine。

### Wave 6 · Verification

- Browser Verification Studio Lite；
- Reproducible Environment Capsule；
- Agent Eval & Regression Studio；
- Test / Browser Artifact；
- Verification Report；
- Skills / Recipes。

### Wave 7 · Companion + Diagnostics

- Mobile 窄路径；
- Doctor / Trace UI；
- 脱敏导出；
- 跨端状态收敛。

### Wave 8 · Release Hardening

- Scenario E2E；
- Fault Injection；
- 性能预算；
- 7 天 soak；
- macOS / Windows release regression；
- RC 和发布说明。

---

## 十、版本冻结条件

v1.1.0 只有同时满足以下条件才能进入 RC：

1. 所有 P0 锚点达到验收标准或有书面降级决策；
2. Core Experience v1 毕业；
3. Task → Run → Diff → Verification → Artifact → Review 闭环可用；
4. Runtime capability matrix 不再依赖手工猜测；
5. App / CLI / Browser / MCP 故障不会造成静默数据损失；
6. 关键性能指标有真实 p95 数据；
7. 7 天真实项目 soak 完成；
8. README、CHANGELOG、用户文档与真实能力一致；
9. 所有实验性能力有清晰标签和降级路径；
10. 不携带已知 mock 能力伪装成正式功能；
11. macOS 主窗口圆角与原生窗口几何一致，圆角缺口与左侧 sidebar surface 连续且通过截图回归；
12. 关键 Runtime / MCP / Skill 具备来源、版本、能力和权限证明。

---

## 十一、锚点增量记录

### 2026-06-23 · 初始锚定

- 确立 `Open Agent Workbench` 版本主题；
- 冻结 Conversation、Visual、Review、Runtime、Task、Intervention、Artifact、Durable Run、Trace、Diagnostics 和 Architecture 主线；
- 新增 MCP App Canvas、Browser Verification、MCP Trust、Protocol Gateway、Quality Gate、Attention Queue、Context Pack、Semantic Code Intelligence、Spec & Acceptance Workspace、Resource Governor；
- A2A 和 Agent Benchmark 保持 Candidate；
- Personal AI、完整多 Agent、Teams 和云托管延后。

### 2026-06-23 · 第二轮扩展

- 将用户反馈的两项 macOS 视觉问题冻结为 `110-A21 Native Window Surface Contract`：主内容圆角必须与原生窗口同源，圆角缺口必须真实延续 sidebar 合成背景；
- 新增 `110-A22 Change Graph & Undo Timeline`，吸收 GitButler 与 Jujutsu 的操作历史、并行变更和可逆工作流思想，但不复制受限许可实现、不替换 Git；
- 新增 `110-A23 Reproducible Environment Capsule`，吸收 Dev Containers 与 Dagger 的环境清单、可重复执行、增量缓存和可观测交付；
- 新增 `110-A24 Project Memory Blocks`，吸收 stateful agent 的可编辑 memory block 思路，但要求来源、过期、用户审批和 token 预算；
- 新增 `110-A25 Agent Eval & Regression Studio`，将真实仓库任务、模型比较、安全回归和发布门禁连接起来；
- 新增 `110-S6 Capability Attestation & Policy Engine`，强化 MCP、Skill、Recipe 和远程 Agent 的来源证明、权限变更和运行时强制。

后续每次新增、冻结、延后或拒绝锚点，都必须在此追加日期、决策、原因和影响范围。
