# v1.0.9 长连接稳定性修复

本轮针对持续下载、Codex 等长连接频繁断续的反馈，检查连接建立、上传结束、下行背压、取消与回退。修改前本地版本为 v1.0.8 / `196ff6c`；另对照本地原版 EdgeTunnel `af4f983`。历史 v1.0.7 审计固定的 `448a83c` 保留为历史证据，不冒充本轮上游版本。

## 修复与证据

| 触发条件 | 旧行为和影响 | v1.0.9 行为及可复现验证 |
| --- | --- | --- |
| gRPC 上传 EOF，服务稍后返回 | 立即结束响应，截断晚到回包 | 排空上传后发送 TCP FIN，保留下行直到目标 EOF；gun/multi、残留帧、取消见 `tests/grpc-lifecycle.test.mjs` |
| gRPC 消费者暂停读取 | 下载继续进入无界响应队列 | 64 KiB 字节水位控制，等待消费者恢复，取消唤醒被阻塞发送；16 MiB 校验与暂停用例同上 |
| DNS TCP 解析器保持连接 | 完整第一条响应后仍等 EOF，后续查询不发出 | 按长度边界返回，关闭单次查询 socket；VLESS/Trojan × WS/gRPC/XHTTP 连续与逐字节分片用例见 `tests/dns-tunnel.test.mjs`、`tests/dns-udp.test.mjs` |
| Trojan DNS 事务 ID 恰似长度前缀 | 把原始 DNS 误当已带前缀，查询异常 | 始终按原始 payload 添加 DNS TCP 前缀，响应恢复 Trojan 地址与长度 |
| SS 地址跨认证 AEAD 记录 | 首记录目标地址不完整就关闭 | 认证后增量收集地址，再透传业务数据；`tests/ss-address.test.mjs`、`tests/tunnel-protocol.test.mjs` |
| 健康连接耗时超过 1 秒 | 过早放弃，转入其他出口 | 默认拨号期限 3 秒；1200 ms 打开连接仍成功，竞速失败者立即关闭；`tests/tcp-stability.test.mjs` |
| 写入失败，部分数据可能已发出 | 在新 TCP 连接重放后续字节，破坏 TLS 或重复请求 | 后续上传写入失败直接终止；仅初始独立 TLS ClientHello 或完整无请求体 GET/HEAD/OPTIONS 可在无响应、无后续上传时回退；同上及 `tests/tunnel-runtime.test.mjs` |
| 取消发生在 DNS、拨号、上传或下载中 | 残留连接、晚到 DNS 后仍拨号、排空等待无法退出 | 请求独立的连接世代跟踪 pending sockets，取消立即失效并释放流；`tests/tcp-stability.test.mjs`、`tests/xhttp-lifecycle.test.mjs`、`tests/long-connection.test.mjs` |
| SOCKS5/CONNECT 服务沉默或持续滴流 | 协商无限等候 | 一个总期限覆盖 opened、认证、全部响应分片与首包写入，成功后清除计时器；`tests/proxy-deadline.test.mjs`、`tests/proxy-handshake.test.mjs` |
| HTTPS 代理地址为 IP | 自定义 TLS 未完整验证证书，存在 30 秒读取策略和提前拉取问题 | 域名/IP 统一原生 TLS，要求受信任且匹配的证书；自签名代理在发送认证信息前失败；`tests/proxy-tls.test.mjs` |
| 2026 Cloudflare WS 默认二进制类型变化 | 旧同步解析依赖 ArrayBuffer | accept 前明确设置 arraybuffer，协调关闭；长连接集成测试使用生产兼容日期 `2026-09-01` |

这些测试使用实际 workerd、回环 TCP 服务和构建后的生产函数；生命周期测试的服务绑定只把出站目标映射到受控 TCP 服务。取消在 workerd 内触发，避免把 Miniflare/Undici 对客户端断开的转发行为当作生产流语义。HTTPS 不受信任证书为测试专用固定材料，不包含在发布包内。

WS/XHTTP 下载测试逐字节校验 16 MiB 加 64 KiB 尾部，期间放慢读取，真实静默 31 秒后继续收发；另检查暂停下行时不会预先排空全部目标数据，取消后释放 TCP 与未结束的上传 producer。gRPC 另有 16 MiB 暂停/恢复校验。这些受控实验验证对应故障，不能代替数小时或数天的实际网络稳定性观察。

## 配置与兼容变化

既有节点无需重新生成；发布通过 main 分支推送触发 Pages 自动部署。面板资源响应增加 `X-Brclio-Version`，可在不提供登录凭据的情况下确认实例版本；后台版本与构建清单从 package.json 统一读取。

| 环境变量 | 默认值 | 有效范围及含义 |
| --- | --- | --- |
| `CONNECT_TIMEOUT_MS` | 3000 | 250–15000 ms；单批 TCP opened 竞速的预算，不是完整端到端总期限 |
| `PROXY_HANDSHAKE_TIMEOUT_MS` | 10000 | 1000–60000 ms；SOCKS5、HTTP/HTTPS CONNECT、Trojan TCP relay 的协商与初始写入总预算 |
| `TCP_CONCURRENT_DIAL` | 2；移动网络 1 | 保留既有并发策略，最多 6 |
| `PROXY_CONCURRENT_DIAL` | 1 | 保留既有 ProxyIP 并发策略，最多 6 |

DNS 单次查询有 5 秒总预算。已建立的普通 TCP/原生 HTTPS 隧道不保留代理握手计时器，也没有新增固定空闲断开。不会自动重连并“接续”任意已发送的 TCP 流；TCP/TLS 上层应用负责重新发起失败的会话。HTTPS-IP 旧代理若只提供自签名证书，现在明确拒绝，需改用受信任且匹配的代理证书/域名。

半关闭和二进制类型选择依据 [Cloudflare TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) 与 [WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/) 文档。

## 验收边界与剩余问题

- TURN allocation/permission 刷新尚未实现，SSTP、真实 ECH 及全部客户端/代理组合未完成专项长时验收。这些高级出口不能套用普通 WS/TCP 验证结果。
- DNS UDP 只支持 DNS，不是任意 UDP；DoH 解析器本体仍沿用原内核，未宣称完成整个 DNS 协议审计。
- 目标已接受数据但一直不回应时，不会用任意短首响应期限重放业务请求。此类服务端或网络故障仍需应用层超时处理。
- 原生 WebSocket send 没有可等待的网络背压接口；保留有界合包与上传队列，受控 WS 慢读/长下载通过不代表任何客户端接收速度下都不会触达平台内存限制。
- 自定义 TLS 类仍用于历史管理诊断功能；本轮 HTTPS 代理凭据与业务隧道已移出该路径，不应扩大为所有诊断 TLS 行为均完成安全审计。
- 开发工具依赖的 npm audit 仍报告 Miniflare/Wrangler 的 sharp、undici 间接安全通告；这些是本地测试/构建依赖，不进入 Worker bundle。本轮未强制降级工具链。
- 公网入口、ProxyIP、运营商和目标服务均会影响稳定性；本轮不承诺带宽倍数或永久不断线。发布与线上验证结果见 [v1.0.9 Release](https://github.com/Brclio/brclio-cloudflare-tz/releases/tag/v1.0.9)，本地核验见 [validation.md](validation.md)。

完整复核命令：`npm test`、`npm run check`、`npm run build:tutorial`、`git diff --check`、`npx wrangler deploy --dry-run`。dry-run 不上传、不更改 KV。发布附件含 Worker、Pages ZIP、离线教程、构建清单及 SHA-256 清单，校验 ZIP 内 Worker 与独立附件逐字节相同。
