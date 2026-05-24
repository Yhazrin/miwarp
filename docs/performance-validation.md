# 视觉性能模式验证指南

MiWarp 通过 `document.documentElement` 上的 class 控制视觉档位：

| 设置值 | DOM class | 作用范围 |
|--------|-----------|----------|
| `quality` | `perf-quality` | 默认，无覆盖 |
| `balanced` | `perf-balanced` | 仅 `.glass-*` blur 减半 |
| `performance` | `perf-performance` | glass blur/shadow 关闭；装饰动画关闭；状态岛 transition 缩短 |
| `auto` | 按平台解析 | macOS → quality；Linux → balanced；Windows → performance |

**不会**使用 `.perf-performance *` 全局禁用动画（避免破坏必要交互）。

## Windows 三档对比表

在 **Windows 10/11 + 独立显卡/集显** 各测一轮，记录主观帧率（流畅 / 可接受 / 卡顿）：

| 场景 | Quality | Balanced | Performance |
|------|---------|----------|-------------|
| 状态栏 hover 展开/收起 | | | |
| 聊天区快速滚动（长会话） | | | |
| 工具卡片展开/折叠 | | | |
| 侧栏项目文件夹展开 | | | |
| 切换会话（冷切换） | | | |
| 设置页切换 Tab | | | |

### 验收标准（建议）

- **Performance**：上述场景均应「流畅」或「可接受」，无明显掉帧、无 hover 粘滞。
- **Balanced**：视觉略好于 Performance，仍不明显卡。
- **Quality**：仅在高配机或 macOS 上作为默认；Windows 用户可建议手动选 Performance。

## 热更新验证

1. 打开 **设置 → 通用 → 视觉性能模式**
2. 依次点击 Quality → Balanced → Performance
3. 每次切换后 **无需重启**，观察：
   - 侧栏玻璃效果变化
   - 顶部状态栏 blur 变化
4. DevTools（若可用）：`document.documentElement.className` 应含对应 `perf-*`

## 长会话性能

与视觉模式正交，但常在同一轮测试：

1. 准备含 500+ 条 user/assistant 的 run（导入 Claude 历史或长期使用积累）
2. 切换进入该 run，计时首屏可交互时间
3. 快速滚动到底部再滚回顶部
4. 打开右侧 Preview / Tools 面板

若仅首屏慢、滚动流畅 → 优先 snapshot/首屏加载优化。  
若滚动也卡 → 检查 timeline 条目数、Markdown 渲染、virtual list。

## 回归命令

```bash
npm run verify
npm run version:check
```
