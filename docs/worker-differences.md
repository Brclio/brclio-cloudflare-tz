# Worker 与原版的差异

核对日期：2026-09-18；本地源码版本：v1.0.7；上游基线：[cmliu/edgetunnel `448a83c`](https://github.com/cmliu/edgetunnel/blob/448a83ced00a43c1d892d5ecbed86a26ea9eeaff/_worker.js)。核对时上游 main 仍指向此提交。

**当前程序沿用原版大部分隧道实现，但不是原版文件完全照搬。** 改动包含实际路由、gRPC 解码、TCP 连接、配置与安全逻辑。不能将它描述为仅更换界面，或保证与原版逐行为等价。

| 范围 | 沿用或修改情况 |
| --- | --- |
| 协议主体 | 保留 VLESS、Trojan、Shadowsocks，以及 WebSocket、gRPC、XHTTP 体系。合包队列与主要转发策略保留上游实现；v1.0.7 修复首包分片、HTTP CONNECT / SOCKS5 握手和 TLS 读取定时器，五种代理连接函数不再全部与原版相同；WS / gRPC / XHTTP 移除了对特定测速域名的本地 204 响应，统一真实转发。支持的协议与传输组合仍受内核约束。 |
| 后台与打包 | 原版远程获取管理页；本地使用随程序打包的 Brclio 页面、脚本、字体、图标和管理工具。新增下载当前部署程序的接口。 |
| 登录和配置保护 | 固定 MD5 Cookie 改为 HMAC-SHA256 签名会话，包含随机数、服务端时效检查及退出撤销；配置写入检查来源，重置要求 POST，增加管理响应头与单实例登录失败节流。 |
| 代理白名单 | 原版使用全局默认名单加环境变量缓存。当前仅非全局链式代理读取 KV 中保存的名单；无链式代理或全局模式跳过读取。空数组清空默认名单，GO2SOCKS5 强制附加；仅 `*` 作为通配符。该调整影响实际代理路由。 |
| gRPC 和 TCP | 修复 Hunk / MultiHunk 多字段 protobuf 解码，拒绝压缩或超过 4 MiB 的 gRPC 帧；完整校验后单数据字段使用零复制视图。TCP 拨号设置按请求隔离，连接结束等待后清理超时定时器。缺少 `request.fetcher.connect` 时使用官方 `cloudflare:sockets` 连接器；原版此时会报错。 |
| 配置和订阅 | 主配置改为请求内变量，旧配置与默认值深合并，增加字段与协议组合校验；转换器增加 `expand` 参数，单节点链接补齐 ALPN。 |
| 凭据和外部请求 | 用量凭据从服务端存储读取，拒绝 URL 传凭据；日志隐藏敏感路径和参数；伪装请求移除 Cookie / Authorization。用量及随机地址源增加超时与响应校验。 |
| 默认交互 | 未设 URL 时根路径进入后台；缺少部署配置时显示本地引导；读取空 ADD.txt 不生成随机地址；默认订阅名为 Brclio Edge。前端测速保持手动、有限次执行。 |

v1.0.5 相对 v1.0.4 的新增是按需读取白名单、请求独立拨号配置、清理 TCP 建连定时器、gRPC 单字段零复制和测速域名真实转发。保持上游默认直连并发 2（移动网络 1）、ProxyIP 并发 1、建连超时 1000 ms；详见 [代理性能说明](proxy-performance.md)。

v1.0.6 修复移除本地 204 后暴露的 HTTP 回退端口错误：无端口 ProxyIP 对目标 80 使用 80，其余目标保持默认 443；显式端口保留，裸 TXT 条目继承父级端口，TXT 自带端口优先。另让显式 `cnIspCode` 参数在 Clash 转换回源中保留。这些是代理与订阅行为修复，不代表带宽已经提升。

v1.0.7 对上游和本地基线做了协议、路由、DNS、流生命周期逐项复核，修复已复现的握手、出口参数与查询等待问题；完整证据、测试位置以及 UDP DNS / gRPC 半关闭 / 自定义 TLS 等已知限制见 [代理深度排查](proxy-deep-audit.md)。

## 应当部署哪个文件

`src/worker.js` 是工程入口，会导入 `panel.js`、`grpc.js`、`proxy-whitelist.js` 等模块，**不能只复制这个源文件到 Workers 编辑器**。

- Workers 编辑器：使用 Release 附件 `_worker.js`，对应构建后的 `dist/_worker.js`，已包含依赖和静态资源。
- Pages 拖放部署：使用 Release 附件 `brclio-edge-pages.zip`。
- 从源码构建：执行 `npm ci`、`npm run build` 后使用 `dist/` 产物。

## 验证范围

v1.0.7 本地 **331 项自动化测试通过**，包含真实 workerd 到本机 TCP / HTTP CONNECT / SOCKS5 的转发与失败用例、三种传输的分片首包、路由和订阅闭环、DNS 时限和 TTL，以及既有配置与面板回归；构建和 Wrangler dry-run 通过。v1.0.6 的固定入口公网延迟对照和 HTTP 400 复现保留为历史诊断，不是 v1.0.7 线上验收。当前版本尚未执行 Cloudflare 部署、部署后客户端对照及长期吞吐验证。

完整功能对照见 [upstream-feature-matrix.md](upstream-feature-matrix.md)，验证记录见 [validation.md](validation.md)。
