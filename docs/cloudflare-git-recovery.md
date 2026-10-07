# Cloudflare Pages Git 连接恢复记录

## 2026-10-07 事件

`brclio-edge` 生产部署停留在 `196ff6c`；长连接修复提交 `0a19f7f`（v1.0.9）的 GitHub CI 已通过 421 项测试，但 Cloudflare 没有创建实际构建记录。控制台提示「Cloudflare Workers 和 Pages Git 安装存在内部问题」。

只读检查确认 GitHub 的 Cloudflare App 在 `Brclio` 组织中正常安装、覆盖该仓库且未挂起。Cloudflare 侧的 Git 账户关联仍需重新添加和授权：GitHub App 正常安装与 Cloudflare 项目保有可用的 Git 账户连接，是两个需要分别检查的状态。[官方排障说明](https://developers.cloudflare.com/pages/configuration/git-integration/troubleshooting/)将该横幅归为 Cloudflare SCM 系统内部错误；本次未确定其内部根因。

本次在原 Pages 项目内断开并重新连接 Git，经用户完成 GitHub 授权后保存成功。保留并核对的设置如下：

| 设置 | 实际值 |
| --- | --- |
| 仓库 / 生产分支 | `Brclio/brclio-cloudflare-tz` / `main` |
| 自动生产部署 | 启用 |
| 构建命令 / 输出目录 | `npm ci && npm run build` / `dist/pages` |
| 构建包含路径 / 构建系统 | `*` / 3 |
| KV 命名空间 | `brclio-edge-config`，原绑定保留 |
| 运行时兼容日期 | `2026-09-18`，原值保留 |

保存重新连接后，Cloudflare 自动为 `0a19f7f` 创建生产部署 `d1b8500b-72b2-45b9-ba65-1db0530293ef`，2026-10-07 09:03:57（Asia/Shanghai）GitHub Cloudflare Pages check 返回成功。`vpn.ip.us.brclio.com`、`brclio-edge.pages.dev` 及该部署 URL 均返回 `X-Brclio-Version: 1.0.9`。恢复后的正常 Git 推送可继续按下方清单验收。

新版上线后另通过现有 WS/TLS 节点及独立 Mihomo 完成 7,195,155 字节 HTTPS 下载：读取 256 KiB 后暂停 31 秒，同一 HTTP / TLS 连接继续并通过 SHA-256 校验。详见 [验证记录](validation.md)。

## 复用恢复步骤

1. 打开原 Pages 项目，在 Settings → Builds / Production 的 Git repository 区域记录仓库、分支、自动部署、构建命令、输出目录及路径过滤设置，同时核对原 KV、机密和兼容日期；不要复制机密值到日志。
2. 仅断开这个项目的 Git 连接。**断开后，新的 Git 推送不会触发该项目构建，直到重新连接并启用自动部署。** 组织级 GitHub App 由多个 Workers / Pages 项目共享，变更其授权可能影响其他项目。
3. 在同一项目中连接 GitHub，选择正确的组织和仓库；账户列表缺少对应组织时，使用添加账户 / 授权流程，并完成 GitHub 授权。
4. 重新选择生产分支并核对上表设置后保存；再核对项目、域名、KV、机密和运行时配置仍为原值。
5. 推送一次正常变更，或在原项目中发起目标提交的部署，按下方清单验证。

Cloudflare 团队成员于 2026-06-01 [确认现有 Pages 项目已支持连接和断开 SCM](https://github.com/cloudflare/workers-sdk/discussions/11050#discussioncomment-17140013)。界面位置可能变化，以原项目实际显示的连接操作为准。

## 部署验收清单

- [ ] 记录待发布的最新 `main` SHA；Cloudflare 新部署的仓库、生产分支和提交 SHA 与之吻合。
- [ ] Cloudflare 出现实际构建记录，日志运行预期构建命令并完成生产部署。
- [ ] GitHub 的 Cloudflare Pages check run 出现并报告成功。只有 `queued` check suite、没有 run，不能证明 Cloudflare 已开始构建；[GitHub 会在推送时自动创建 suite](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks)。
- [ ] 直接检查 `pages.dev` 和自定义域名的面板响应，`X-Brclio-Version` 均为预期版本；本次目标为 `1.0.9`。
- [ ] 在新生产实例核对后台版本、原配置读取及实际客户端连接；保存授权完成或设置成功本身不等于部署完成。

无需登录即可读取版本响应头，例如：

```sh
curl -fsS -A 'Mozilla/5.0' -D - -o /dev/null https://brclio-edge.pages.dev/login \
  | rg -i '^(HTTP/|x-brclio-version:)'
```

同一版本可能对应多个提交，响应头用于确认运行版本，具体 SHA 仍以 Cloudflare 生产部署记录为准。
