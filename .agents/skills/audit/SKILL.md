# 代码质量审计与修复

自动拉取最新代码，运行全量质量检查，修复所有发现的错误，然后提交推送。

## 步骤

1. **拉取最新代码**: `git pull origin master`
2. **基线检查**: 运行 `npm run check` (svelte-check) 和 `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`，确认当前状态
3. **运行格式化**: `npm run format`
4. **运行测试**: `npm test`
5. **修复所有发现的错误** — 按类型分组修复，每组修复后立即验证
6. **完整构建验证**: `npm run build`
7. **Commit 并 push**: 只有修复内容时才提交，用 `fix: audit — <描述>` 格式
8. **输出修复摘要**（中文）: 修了什么、多少处、验证结果

## 规则

- 只修复，不生成报告
- 每次修复后立即运行对应检查验证
- 如果基线就是干净的，直接报告"无问题"并结束
- 如果修复引入新问题，立即回滚该修复并尝试其他方案
