# Browser Runtime 双引擎实现计划

## 目标
实现 MiWarp Browser Runtime：一个拥有长期身份、可被用户使用、可被 AI 观察并在授权后操作的网页工作空间。

## 架构设计

### 双引擎模式
```
Browser Runtime
├── Real Chrome Mode
│   └── 系统 Chrome + MiWarp 独立持久化 Profile + CDP
│
└── Embedded Web App Mode (Phase 3)
    └── Tauri Child WebView + 持久化 Data Store
```

### 核心接口
```rust
#[async_trait]
pub trait BrowserRuntime: Send + Sync {
    async fn launch_profile(&self, profile_id: &str) -> Result<BrowserSession, Error>;
    async fn list_tabs(&self, session_id: &str) -> Result<Vec<BrowserTab>, Error>;
    async fn observe(&self, tab_id: &str) -> Result<BrowserObservation, Error>;
    async fn navigate(&self, tab_id: &str, url: &str) -> Result<(), Error>;
    async fn perform(&self, action: BrowserAction) -> Result<(), Error>;
    async fn close(&self, session_id: &str) -> Result<(), Error>;
}
```

## Phase 1: Real Chrome Companion (本次实现)

### Agent 1: Chrome进程管理 + Profile管理 (Rust)
- chrome_process.rs: 找到本机Chrome、启动子进程
- profile_manager.rs: Profile元数据管理、持久化
- 端口管理：随机端口分配

### Agent 2: CDP客户端实现 (Rust)
- cdp_client.rs: WebSocket连接、JSON-RPC
- cdp_target.rs: Tab管理、事件订阅
- Page域：导航、截图、DOM获取
- Runtime域：执行JavaScript

### Agent 3: Browser Runtime抽象层 (Rust)
- runtime_registry.rs: 运行时注册、健康检查
- ChromeCdpRuntime实现
- BrowserSession生命周期
- Tauri命令集成

### Agent 4: 前端组件重构 (Svelte)
- browser-runtime-store.svelte.ts
- browser-session-store.svelte.ts
- browser-observation-store.svelte.ts
- BrowserPanel组件重写
- 双窗口同屏UI

### Agent 5: 集成测试 + 文档
- 测试Chrome启动
- 测试CDP连接
- 测试页面导航和截图
- 架构文档

## Phase 2: 受控浏览器操作 (未来)
- Accessibility Tree
- DOM Snapshot
- 元素引用、点击、输入、滚动
- 动作审批、操作审计

## Phase 3: Embedded Web App (未来)
- Tauri Child WebView
- 持久化 Data Store
- 原生地址栏、前进/后退/刷新

## 安全红线
1. 不控制默认Chrome Profile
2. CDP只监听127.0.0.1
3. 远程网页不能拥有Tauri权限
4. 默认观察，操作需审批
