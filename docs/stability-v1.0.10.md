# v1.0.10 订阅深测与首次 TLS 连接修复

2026-10-07，在恢复 Cloudflare Git 自动部署并上线 v1.0.9 后，使用用户提供的真实订阅继续检查。订阅令牌、UUID、认证路径和客户端配置不进入仓库或公开报告；测试使用独立 Mihomo，未修改当前客户端、系统代理或 TUN。

## 已复现并修复的边界

- 代理握手与 TLS ClientHello 分开发送，或 ClientHello 跨消息到达时，旧逻辑会把第一段 TLS 握手当作后续业务上传，禁止本可安全执行的初始 ProxyIP 回退。真实 Node TLS、明确受信任的测试 CA 与回环服务器复现了合并成功、分片失败的差异。修复仅缓存第一条 TLS record 中的完整 ClientHello，总上限 16,389 字节，内部向量与扩展长度全部校验后才允许回退；第一段下行、后续数据或取消后停止缓存。禁止业务写入失败后的任意重连重放，POST、TLS 应用数据和包含 early_data 扩展的 ClientHello 不获得重放许可。
- 完整 ClientHello 的续写尚未结束就遇 EOF 或读取错误时，立即关闭旧 socket 会导致原本可成功的写入拒绝，上传清理随后可能误关备用连接。现在仅在此时按已有 `CONNECT_TIMEOUT_MS` 有界等待写入结果，再检查连接世代与回退许可；失败、取消或超时仍关闭且零回退。没有新增常驻的首响应超时。
- Mihomo 的 `expected-status` 默认是 `*`，因此 HTTP 400/403 也可能被健康检测记录为可达。对订阅中已知的 204 测速地址，补齐缺省的 `expected-status: 204`；保留用户显式指定的状态、自定义测速 URL 及手动选择组。[官方参数说明](https://wiki.metacubex.one/config/proxy-groups/#expected-status)

这次 TLS 修复改善首次建连回退，不会把已中断的任意 TCP/TLS 业务流接续到另一条连接。如果远端在完整 ClientHello 形成前就结束（例如仅接收前 19 字节），仍保守关闭，不能把不完整前缀当成可重放握手；跨多条 TLS record 的 ClientHello 也不获得新增许可。XHTTP 的上传直通路径保持前版生命周期保护，不能套用 WS/gRPC 的新增握手分片回退结果。

## v1.0.9 上线后的真实订阅基线

以下测试运行在生产 `a79ef37` / v1.0.9，新版 v1.0.10 的发布后结果以 Release 记录为准。

| 检查 | 实际结果 |
| --- | --- |
| 原始、Clash、sing-box 订阅 | HTTP 200，各 16 个 VLESS/WS/TLS 节点；证书校验开启，静态认证与传输参数一致 |
| 全入口 HTTPS 探测 | 16 个入口、两个目标、32 次请求，15/16 入口全部通过 HTTP 204 与空正文校验 |
| 失败入口定向重测 | `162.159.37.203` 原 2083 端口与改 443 均在入口 TCP 阶段超时；相同节点参数仅改部署域名入口 / 443 则成功 |
| 同 TLS 连接空闲恢复 | 65 秒静默前后各 64 KiB，HTTP 200、SHA-256 正确；实际 connect 次数为 1 |
| 同 TLS 连续请求 | 10 次 64 KiB，状态、长度及 SHA-256 全部正确，未自动重连 |
| 下载暂停恢复 | 7,195,155 字节公开 Release 附件，读取 256 KiB 后暂停 65 秒，再沿同一 HTTP 响应 / TLS 连接完整恢复 |
| 并发下载 | 4 并发，共 28,780,620 字节；每份 SHA-256 与发行清单一致 |
| HTTPS 上传回显 | 4 KiB 合成数据，上传与回显 SHA-256 相同 |
| 连续 SSE | Wikimedia 公共 EventStreams 同 TLS 连接运行 65.006 秒，HTTP 200，2186 个事件 / 3,252,186 字节后由测试端主动关闭 |
| OpenAI 网络连通 | 不发送 API key 的 models 请求返回预期 HTTP 401；仅证明此时 TLS / HTTP 可达 |

单节点下载专项约 36.76 MB，最多 4 并发；全入口探测最多 3 个并发客户端。没有读取或调用 Codex 的会话密钥，不据此声称真实 Codex 会话或数小时网络稳定性已验收。SSE 使用[官方公共流接口](https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams)，只保留计数与时间，不保存事件内容。

随机入口是候选地址，并不保证每个运营商都可达。当前订阅已有自动选择、故障转移与负载均衡组；应更新订阅并使用自动选择或故障转移，避免固定使用本机不可达入口。仅把节点数量扩为 1000，不能解决入口可达性或已建立连接中途断开的原因。

## 验证与发布

本地完整 `npm test` **455/455 通过，0 失败、0 跳过**；TLS/TCP 专项 43/43、订阅补丁 9/9 通过。真实 Node TLS 经 workerd 的 WS 合并/分离/分片与 gRPC gun/multi 六种布局均成功，回退端实际完成证书校验与 64 KiB 下载哈希校验。确定性流夹具另覆盖 EOF/读取错误分别组合写入成功、拒绝、取消与超时，并断言释放计时器。原生 Mihomo 六项本地 HEAD 夹具确认状态误判及修正，实际订阅 YAML 深比较只新增三个状态要求。

`npm run check`、`git diff --check`、离线教程构建与 `wrangler deploy --dry-run` 通过；dry-run gzip 700.27 KiB，未通过该命令上传或改 KV。新 TLS 回归在旧代码上复现失败后执行修复；精确源码提交、Node 22 CI、产物校验及生产部署后的复验记录在 [v1.0.10 Release](https://github.com/Brclio/brclio-cloudflare-tz/releases/tag/v1.0.10)。Git 自动部署恢复过程见 [恢复记录](cloudflare-git-recovery.md)。
