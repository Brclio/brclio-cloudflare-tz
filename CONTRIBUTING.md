# 一起改进 Brclio Edge

## 开发

使用 Node.js 22 或更新版本。克隆后执行 `npm ci`，复制 `.dev.vars.example` 为 `.dev.vars` 并替换本地测试密码，再执行 `npm run dev`。本地页面位于 `http://localhost:8787`；本地 KV 由 Wrangler 保存，默认不会读取你的云端 KV。

修改前先阅读 [架构分析](docs/architecture.md) 与 [API 契约](docs/api-contract.md)。`src/worker.js` 是上游适配内核，`src/panel.js` 是本项目页面服务和管理保护，`public/` 是独立界面源码。不要直接编辑 `dist/`，每次构建会重新生成。

## 提交前

```sh
npm run build
npm run check
npm test
git diff --check
```

涉及 UI 时，检查桌面及 390px 手机宽度，实际完成登录、编辑、保存、刷新、复制、导出和退出。错误、空数据、会话过期也应有明确反馈。不要用演示数据掩盖 API 失败。

涉及协议时，至少运行本地 VLESS WebSocket/TCP 回显测试。它不能替代真实 Cloudflare 与不同客户端的验收；PR 中应注明具体跑过哪些场景。

## PR 内容

说明解决的问题、改动后的行为和验证结果；保留无关工作区文件。请勿提交 `.dev.vars`、`.wrangler`、真实订阅、管理员密码、Cloudflare Token、Telegram Token 或含凭据的截图。

## 上游同步

上游来源固定在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。比较新版本与该提交，单独审阅协议差异，再保留本地面板适配。不要用新 `_worker.js` 直接覆盖本项目入口，也不要恢复外部管理页面依赖。

提交贡献表示你有权以本项目 GPL-2.0-only 许可提供这些改动。第三方依赖和资源需要记录其独立许可证；不要引入非商业模板或无法核实来源的资源。
