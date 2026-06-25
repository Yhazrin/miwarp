# MiWarp Release Process

> **适用范围**：v1.1.0 及后续版本（含 `-rc.N` RC 标签）。
> **配套脚本**：`scripts/verify-rc.sh` + `npm run verify:rc`。
> **配套检查表**：`docs/v1.1.0-rc-checklist.md`（12 条冻结条件）。
> **配套计划书**：`docs/PLAN_Vx.y.z.md`（每个大版本独立维护）。

---

## 1. 版本与标签约定

MiWarp 采用 [Semantic Versioning](https://semver.org/spec/v2.0.0.html) + 显式 RC 标签：

| 标签              | 含义                                         | 何时创建                                |
| ----------------- | -------------------------------------------- | --------------------------------------- |
| `vX.Y.Z-rc.N`     | Release Candidate 第 N 个候选               | 满足 `docs/vX.Y.Z-rc-checklist.md` 全部 12 条冻结条件（允许有 `DEFERRED` 决策）|
| `vX.Y.Z`          | 正式发布                                     | RC 通过 7 天真实项目 soak 后            |

不创建 `alpha` / `beta` 标签 — 内部 nightly 通过 `feat/*` / `fix/*` 分支承担。

## 2. RC 流水线（核心流程）

### 2.1 前置条件

- 当前工作分支为 `feat/vX.Y.Z-final`（或其分叉）；
- `git status` 干净（无 untracked `apps/ios/MiWarpMobile/build-*` 等无关产物）；
- `package.json` / `tauri.conf.json` / `Cargo.toml` 版本号已同步；
- `CHANGELOG.md` 顶部已加入 `## [X.Y.Z-rc.N] - YYYY-MM-DD` 段。

### 2.2 执行 verify:rc

```bash
# 完整流水线（默认 + dev smoke）
npm run verify:rc

# 仅静态门禁（CI 场景，跳过 dev smoke）
npm run verify:rc:skip-dev

# 子集（适用于本地的快速反馈）
npm run verify:rc -- --only=lint,check,test
```

`verify-rc.sh` 内置 8 个步骤：

| 步骤     | 命令                       | 阻断级别 |
| -------- | -------------------------- | -------- |
| `lint`   | `npm run lint`             | 阻断     |
| `format` | `npm run format:check`     | 阻断     |
| `check`  | `npm run check`            | 阻断     |
| `i18n`   | `npm run i18n:check`       | 阻断     |
| `test`   | `npm test`                 | 阻断     |
| `rust`   | `npm run rust:check`       | 阻断     |
| `build`  | `npm run build`            | 阻断     |
| `dev`    | `npm run dev` (8s smoke)   | 软门禁   |

任何阻断步骤失败 → exit code 1 → 禁止打 RC 标签。

### 2.3 失败处理

```text
RC verify-rc summary
✗ Failed steps:
  - rust
  - test
See docs/v1.1.0-rc-checklist.md for the 12-condition gate.
```

按以下顺序处理：

1. **rust / test 失败**：定位到具体失败 case，单开 `fix/<scope>` 分支修复；
2. **check / lint / i18n 失败**：单开 `chore/<scope>` 分支修复；
3. **build 失败**：检查 `tauri.conf.json` 的 `beforeBuildCommand` 与 `prebuild` 脚本；
4. **dev smoke 失败**：检查 Vite 启动日志 `/tmp/miwarp-verify-rc-dev.log`。

不允许在一个 fix 分支里同时改 RC 锁链 + 加新功能。

### 2.4 签字

通过 `verify:rc` 后，逐条核对 `docs/vX.Y.Z-rc-checklist.md`：

- `DONE` 项 → 签字；
- `PARTIAL` 项 → 必须有书面 DEFERRED 决策，列入 `PLAN_VX.Y.Z.md` §十一；
- `NOT-STARTED` 项 → 必须明确 DEFERRED 至下个 RC，且不得影响 RC 门禁；
- `DEFERRED` 项 → 签字。

## 3. 创建 RC 标签

```bash
# 1. 同步版本
npm run version:sync

# 2. 提交版本号 + CHANGELOG + 锁链文档
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
        CHANGELOG.md docs/RELEASE_NOTES_VX.Y.Z.md \
        docs/vX.Y.Z-rc-checklist.md docs/PLAN_VX.Y.Z.md
git commit -m "chore(release): vX.Y.Z-rc.N"

# 3. 打标签（annotated tag）
git tag -a vX.Y.Z-rc.N -m "Release Candidate N — see docs/vX.Y.Z-rc-checklist.md"

# 4. 推送分支 + 标签（需用户确认）
git push origin feat/vX.Y.Z-final
git push origin vX.Y.Z-rc.N
```

> **红线**：不允许 `git push --force`；不允许在没有用户授权时 push。

## 4. RC 后续

### 4.1 RC 反馈收集

RC 标签创建后，监控以下通道至少 3 个工作日：

- GitHub Issues / Discussions；
- 用户反馈群 / Discord；
- Sentry / 应用内 diagnostics 导出。

每个 P0 / P1 问题都开 `fix/<scope>` 分支单独修复，并打 `vX.Y.Z-rc.N+1` 标签。

### 4.2 GA 签字

满足以下全部条件后，可签 `vX.Y.Z` GA 标签：

- ✅ 7 天真实项目 soak 完成（无阻断级问题）；
- ✅ `verify:rc` 在 RC 标签上最新 commit 上通过；
- ✅ Tier 1 provider 全量 E2E 矩阵毕业；
- ✅ 关键性能指标（10,000 Timeline Event ≥ 55 FPS / 10,000 行 Diff p95 ≤ 500ms / 冷启动 ≤ 150ms 等）有真实采样数据；
- ✅ `CHANGELOG.md` 的 RC 段已合并到 GA 段。

### 4.3 回滚

如果 GA 后发现 P0 阻断级问题：

1. 创建 `hotfix/<scope>` 分支；
2. 在 `CHANGELOG.md` 顶部加 `## [X.Y.Z+1] - YYYY-MM-DD` 段（hotfix 段）；
3. `npm run verify:rc` 通过后打 `vX.Y.Z+1` 标签；
4. 在用户文档中说明 hotfix 内容。

## 5. 自动化检查清单

`verify-rc.sh` 在每次执行时输出以下结构化摘要：

```
MiWarp RC verify-rc pipeline
Steps: lint format check i18n test rust build dev

═══ Lint (ESLint) ═══
✓ Lint (ESLint) — passed

═══ Format check (Prettier) ═══
✓ Format check (Prettier) — passed

…（每个步骤一段）

═══ RC verify-rc summary ═══
✓ All steps passed. Safe to tag vX.Y.Z-rc.N.
```

CI 可通过 `npm run verify:rc:skip-dev` 跳过 dev smoke（更快），release worker 在本地完整跑一次。

## 6. 常见问题

### 6.1 `cargo: command not found`

Rust toolchain 未安装。运行：

```bash
./scripts/setup.sh --yes
```

或在 macOS 上：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 6.2 `beforeBuildCommand` 缺失

Tauri 桌面构建要求 `tauri.conf.json` 中的 `build.beforeBuildCommand` 不为空。验证：

```bash
node -e "console.log(require('./src-tauri/tauri.conf.json').build.beforeBuildCommand)"
```

应当输出 `npm run build` 或类似命令。

### 6.3 iOS build 产物干扰

`apps/ios/MiWarpMobile/build-*/` 不会进 git，但会出现在 `git status` 中。`verify-rc.sh` 不检查这些目录；如需清理：

```bash
rm -rf apps/ios/MiWarpMobile/build-ipad apps/ios/MiWarpMobile/build-test
```

### 6.4 RC 与 master 分歧

RC 标签始终基于 `feat/vX.Y.Z-final` 分支的最后一次 `verify:rc` 通过的 commit。`master` 上的 hotfix 通过 cherry-pick 流入 RC 分支；不允许直接从 `master` 打 RC 标签。

## 7. 变更记录

| 日期          | 变更                                                  | 作者           |
| ------------- | ----------------------------------------------------- | -------------- |
| 2026-06-25    | 首次建立（v1.1.0-rc.1）                                | MiWarp release worker |
