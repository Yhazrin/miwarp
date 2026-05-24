# MiWarp 发布前回归清单

在发版（`npm run release patch` 并打 tag）或合并稳定性分支前，按本清单在 **macOS** 与 **Windows** 各跑一遍。勾选 `[x]` 表示通过。

## 环境准备

```bash
npm install
npm run verify          # lint + format + check + i18n + test + build + rust
npm run version:check   # package.json / tauri / cargo 版本一致
npm run tauri dev       # 日常手动验收
```

---

## A. 冷启动与导航

| # | 步骤 | macOS | Windows |
|---|------|:-----:|:-------:|
| A1 | 冷启动应用，无白屏/崩溃 | [ ] | [ ] |
| A2 | 侧边栏展开/折叠项目文件夹 | [ ] | [ ] |
| A3 | 切换会话（含 10+ 条历史的项目） | [ ] | [ ] |
| A4 | 设置页各 Tab 可打开（通用/连接/数据/调试） | [ ] | [ ] |

---

## B. 聊天核心路径

| # | 步骤 | macOS | Windows |
|---|------|:-----:|:-------:|
| B1 | 新建会话并发送消息 | [ ] | [ ] |
| B2 | 流式输出正常结束，无空回答 | [ ] | [ ] |
| B3 | 停止生成 | [ ] | [ ] |
| B4 | Resume 继续会话 | [ ] | [ ] |
| B5 | 切换模型（若已配置） | [ ] | [ ] |

---

## C. 状态栏胶囊（Session Island）

| # | 步骤 | macOS | Windows |
|---|------|:-----:|:-------:|
| C1 | 胶囊始终屏幕水平居中 | [ ] | [ ] |
| C2 | Hover 展开不左右漂移 | [ ] | [ ] |
| C3 | Tier2 展开不挤压 Tier1 图标 | [ ] | [ ] |
| C4 | 运行中 morph（蓝/黄/绿）显示正常 | [ ] | [ ] |

---

## D. 视觉性能模式

在 **设置 → 通用 → 视觉性能模式** 分别测试三档（无需重启）：

| 模式 | 检查项 | macOS | Windows |
|------|--------|:-----:|:-------:|
| Quality | 玻璃 blur/阴影完整 | [ ] | [ ] |
| Balanced | blur 减轻，仍可读 | [ ] | [ ] |
| Performance | 状态栏/侧栏 blur 关闭，交互跟手 | [ ] | [ ] |

切换后应立即生效（`miwarp:visual-performance-changed`）。Windows 重点看状态栏 hover、聊天滚动、工具卡片展开。

详见 [performance-validation.md](./performance-validation.md)。

---

## E. 侧边栏交互

| # | 步骤 | macOS | Windows |
|---|------|:-----:|:-------:|
| E1 | **长按**会话进入多选 | [ ] | [ ] |
| E2 | 多选后单击切换选中 | [ ] | [ ] |
| E3 | **拖拽**会话到逻辑文件夹（不触发文件拖入 overlay） | [ ] | [ ] |
| E4 | Esc 清除多选 | [ ] | [ ] |

---

## F. Claude Code 历史迁移

| # | 步骤 | macOS | Windows |
|---|------|:-----:|:-------:|
| F1 | 设置 → 数据 → 扫描本机 `~/.claude/projects` | [ ] | [ ] |
| F2 | 导出 zip 成功 | [ ] | [ ] |
| F3 | 导入 zip，侧边栏出现会话 | [ ] | [ ] |
| F4 | 重复导入：Duplicates 计数增加，无重复消息洪水 | [ ] | [ ] |
| F5 | 导入会话只读查看，不自动 resume | [ ] | [ ] |

---

## G. 诊断（Doctor）

| # | 步骤 | macOS | Windows |
|---|------|:-----:|:-------:|
| G1 | 设置 → 通用 → 诊断 → 刷新有数据 | [ ] | [ ] |
| G2 | 复制报告到剪贴板 | [ ] | [ ] |
| G3 | CLI 路径/版本与终端 `claude --version` 一致 | [ ] | [ ] |

---

## H. 长会话性能（抽样）

在已有或导入的大会话上测试（目标规模）：

| 消息条数 | 切换会话 | 滚动聊天 | Timeline/Preview |
|----------|:--------:|:--------:|:----------------:|
| ~500 | [ ] | [ ] | [ ] |
| ~1000 | [ ] | [ ] | [ ] |
| ~2000 | [ ] | [ ] | [ ] |

若卡顿：记录 FPS 感受、是否 virtual list 生效、是否仅首屏慢。先局部优化，避免大重构。

---

## I. 发版链路

| # | 命令 / 动作 | 说明 |
|---|-------------|------|
| I1 | `npm run version:check` | 版本文件一致 |
| I2 | `npm run release:notes` | 生成 release notes 草稿 |
| I3 | `npm run release patch` |  bump + tag + push（需写权限） |
| I4 | GitHub Actions Release workflow 绿 | macOS universal + Windows NSIS |
| I5 | 应用内更新检查指向 `Yhazrin/miwarp` | 非 `miwarp-app/miwarp` |

### 本地打包（可选）

```bash
# macOS DMG（需先 clean）
npm run build:dmg
# 或 universal
npm run build:dmg:universal

# Windows（在 Windows 或 cross-compile 环境）
npm run build:win
```

---

## 已知限制

- Windows WebView2 在 Quality 模式下 glass 效果仍可能较重，默认 Auto 在 Windows 解析为 Performance。
- 历史迁移不迁移 OAuth/token/settings。
- 定时任务 Hub 需在项目内已有 `scheduled_task_id` 标记的 run（新执行自动写入，旧数据靠 backfill）。
