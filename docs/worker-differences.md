# Worker 与原版的差异

核对日期：2026-09-18；本地源码版本：v1.0.5；上游基线：[cmliu/edgetunnel `448a83c`](https://github.com/cmliu/edgetunnel/blob/448a83ced00a43c1d892d5ecbed86a26ea9eeaff/_worker.js)。核对时上游 main 仍指向此提交。

**当前程序沿用原版大部分隧道实现，但不是原版文件完全照搬。** 改动包含实际路由、gRPC 解码、TCP 连接、配置与安全逻辑。不能将它描述为仅更换界面，或保证与原版逐行为等价。

| 范围 | 沿用或修改情况 |
| --- | --- |
| 协议主体 | 保留 VLESS、Trojan、Shadowsocks，以及 WebSocket、gRPC、XHTTP 体系。五种上游代理连接函数、合包队列与下行转发保留上游实现；WS / gRPC / XHTTP 移除了对特定测速域名的本地 204 响应，统一真实转发。支持的协议与传输组合仍受内核约束。 |
| 后台与打包 | 原版远程获取管理页；本地使用随程序打包的 Brclio 页面、脚本、字体、图标和管理工具。新增下载当前部署程序的接口。 |
| 登录和配置保护 | 固定 MD5 Cookie 改为 HMAC-SHA256 签名会话，包含随机数、服务端时效检查及退出撤销；配置写入检查来源，重置要求 POST，增加管理响应头与单实例登录失败节流。 |
| 代理白名单 | 原版使用全局默认名单加环境变量缓存。当前仅非全局链式代理读取 KV 中保存的名单；无链式代理或全局模式跳过读取。空数组清空默认名单，GO2SOCKS5 强制附加；仅 `*` 作为通配符。该调整影响实际代理路由。 |
| gRPC 和 TCP | 修复 Hunk / MultiHunk 多字段 protobuf 解码，拒绝压缩或超过 4 MiB 的 gRPC 帧；完整校验后单数据字段使用零复制视图。TCP 拨号设置按请求隔离，连接结束等待后清理超时定时器。缺少 `request.fetcher.connect` 时使用官方 `cloudflare:sockets` 连接器；原版此时会报错。 |
| 配置和订阅 | 主配置改为请求内变量，旧配置与默认值深合并，增加字段与协议组合校验；转换器增加 `expand` 参数，单节点链接补齐 ALPN。 |
| 凭据和外部请求 | 用量凭据从服务端存储读取，拒绝 URL 传凭据；日志隐藏敏感路径和参数；伪装请求移除 Cookie / Authorization。用量及随机地址源增加超时与响应校验。 |
| 默认交互 | 未设 URL 时根路径进入后台；缺少部署配置时显示本地引导；读取空 ADD.txt 不生成随机地址；默认订阅名为 Brclio Edge。前端测速保持手动、有限次执行。 |

v1.0.5 相对 v1.0.4 的新增是按需读取白名单、请求独立拨号配置、清理 TCP 建连定时器、gRPC 单字段零复制和测速域名真实转发。保持上游默认直连并发 2（移动网络 1）、ProxyIP 并发 1、建连超时 1000 ms；详见 [代理性能说明](proxy-performance.md)。

## 应当部署哪个文件

`src/worker.js` 是工程入口，会导入 `panel.js`、`grpc.js`、`proxy-whitelist.js` 等模块，**不能只复制这个源文件到 Workers 编辑器**。

- Workers 编辑器：使用 Release 附件 `_worker.js`，对应构建后的 `dist/_worker.js`，已包含依赖和静态资源。
- Pages 拖放部署：使用 Release 附件 `brclio-edge-pages.zip`。
- 从源码构建：执行 `npm ci`、`npm run build` 后使用 `dist/` 产物。

## 验证范围

v1.0.5 本地 210 项自动化测试通过，包含 workerd 到本机 TCP / HTTP CONNECT 的实际转发、按需读取 KV、测速域名透传、请求拨号隔离、配置保存和订阅参数检查；构建和 Wrangler dry-run 通过。进阶配置与网络工具的桌面 / 手机浏览器验收为此前版本记录。公网 Cloudflare 边缘、真实客户端速度、外部转换器和真实通知凭据仍需在目标环境验收。

完整功能对照见 [upstream-feature-matrix.md](upstream-feature-matrix.md)，验证记录见 [validation.md](validation.md)。
