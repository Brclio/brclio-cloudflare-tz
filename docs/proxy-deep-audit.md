# 代理逻辑深度对照与故障排查

核对日期：2026-09-18。上游固定为 [cmliu/edgetunnel `448a83c`](https://github.com/cmliu/edgetunnel/blob/448a83ced00a43c1d892d5ecbed86a26ea9eeaff/_worker.js)，本地修改前基线为 [`dc663db` / v1.0.6](https://github.com/Brclio/brclio-cloudflare-tz/tree/dc663db0307b64b8d1bbeb111119e34e56b5cf3a)。当天重新查询上游 main，并下载精确提交文件，确认与对照副本逐字节相同，SHA-256 为 `f4deaac96bb6ab5bcdd1b27b20bfce7c51d0210caf4c4620ee291f57b5b83fc7`。

**结论：两边共享大部分代理内核；不能依据 Clash 的一张延迟截图判定整个内核谁更快。原版的本地测速响应掩盖了部分真实出口问题，本项目此前也确实存在需要修正的兼容缺陷。此外，两边共用的握手、路由和 DNS 代码都有可复现问题。** 本轮改进以真实转发正确、出口选择正确和消除无界等待为目标，没有提高并发来掩盖故障，也没有重新合成测速响应。

## 对照范围与方法

审阅链路为：订阅候选与转换 → WS / gRPC / XHTTP 入站 → VLESS / Trojan / Shadowsocks 识别 → URL 出口解析与白名单 → 直连 / ProxyIP / 链式代理建连 → 上下行队列与关闭 → DoH / UDP DNS。另检查了面板打包、请求隔离、超时和日志对隧道路径的影响。

修改前的具名顶层函数和类中，**108 个函数体逐字节相同，10 个不同，上游独有 4 个、本地新增 6 个**。这只是具名声明的结构对照，不包含入口对象、箭头函数、全局变量、import 或独立模块，也不等同于行为等价证明；这些部分另行检查。基线统计、变化函数名和两边的协议复现结果保存在 [审计证据 JSON](audits/proxy-2026-09-18-baseline.json)。其中 `current` 指修改前的 v1.0.6。

验证同时使用固定源码函数、受控时钟、实际构建后的 Worker、workerd 与本机 TCP / HTTP / SOCKS5 服务。实际 TCP 测试阻断其他出站连接；不会用在 Worker 内直接返回成功的方式代替出口。对“原版同样存在”的判断，来自逐字节相同的函数或对两份源码分别执行相同失败用例。

## 截图为什么会与原版差很多

已有实测记录见 [代理连接与测速说明](proxy-performance.md)，这里区分三件事：

| 因素 | 已取得的证据 | 可以得出的结论 |
| --- | --- | --- |
| 手动和自动测速地址不同 | Clash Verge 2.5.2 手动选择组缺少自定义 URL 时使用 `cp.cloudflare.com`；自动组可用 gstatic | 只检查订阅的自动检测 URL 不够。[客户端源码](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.2/src/components/proxy/proxy-head.tsx#L63-L70) |
| 原版特殊处理检测域名 | 原版在 Worker 内直接返回本地 204；本项目 v1.0.5 起实际访问目标 | 原版部分数字只覆盖入口，不能与完整出口链路直接比较；其 TLS / 下载请求也可能受此特殊处理干扰 |
| 本项目暴露了实际 HTTP 400 | 移除本地 204 后，隐式 ProxyIP 443 接收了 HTTP 80 明文；临时改同区域出口为 80 后返回真实 204 | 这是实际兼容错误，已在 v1.0.6 修复；不能只解释为“真实测速所以更慢” |
| 候选池不一致 | 原版使用电信池，项目截图为官方池；原版和本地默认都按请求网络识别运营商，再从 CIDR 随机选候选 | “优选”名称不代表已经在用户的网络逐个测速；v1.0.6 已修复显式运营商参数在转换回源中被覆盖 |
| 同入口 gstatic 小样本 | 相同 4 组入口、同核心和 WS/TLS，交替每侧 12 次；中位数原版 193.5 ms、项目 214.5 ms，均核验过真实 204 | 此样本不支持“所有链路都慢数倍”，也不能证明长期带宽或尾延迟相同 |

当前这些数据来自修复前已有部署，**不是本轮新代码的线上验收**。Cloudflare 对访问其自身 IP 的出站 TCP 有平台限制，触发 ProxyIP 回退不必然意味着入口代码出错。[Cloudflare TCP 文档](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#tcp-loop-detected)

## 本轮修复的确定问题

下表问题均存在于上游基线和修改前的本地代码。它们证明了触发条件下的缺陷，不能单独解释两边相对速度，因为原版也会触发。

| 范围 | 触发与影响 | 修复与验证位置 |
| --- | --- | --- |
| VLESS / Trojan 识别 | 仅看第 56、57 字节是否为 CRLF；合法 VLESS HTTP 首包也可满足，因而误判 Trojan、零拨号关闭 | 按认证前缀与协议结构识别，见 `src/tunnel-handshake.js` 及首包回归 |
| WS / gRPC 首包分片 | 将一个 WS 消息或一个 gRPC Hunk 当作完整协议头；跨消息、跨 Hunk、部分 early-data 失败 | 有界缓存未完成协议头，认证和结构完整后才拨号，后续应用数据原样转发 |
| HTTP CONNECT 粘包 | 200 响应头和目标首批数据同时到达时，在消费者尚不存在的 TransformStream 上等待 write，握手无法返回 | 按 pull 先输出剩余字节，再读取 socket；`tests/proxy-handshake.test.mjs` |
| SOCKS5 分片与粘包 | 单次 read 当完整 method / auth / CONNECT 回复；拆包失败、回复尾部污染业务流、目标 greeting 丢失 | 按协议长度增量读取，校验整个回复，保留剩余业务数据；同上 |
| TLS 读取定时器 | 每次成功读取仍遗留一个 30 秒定时器；受控执行 2,000 次留下 2,000 个 | 复用带 finally 清理的超时函数；`tests/proxy-streams.test.mjs`。保留原 30 秒策略 |
| 代理账号大小写 | `/proxyip=socks5://User:Pass@host` 被整体转为小写，认证失败 | 仅关键字忽略大小写，账号原样保存；`tests/proxy-route.test.mjs` |
| 编码链式路径与 gRPC | `/video/<编码>/Tun`、`/TunMulti` 被当作整个编码解密，失败后走默认出口 | 优先尝试原路径，再识别 RPC 后缀；失败不再静默回退 |
| gRPC query 路由 | 生成 serviceName 时简单删除 `?` 后全部内容，连 `socks5` / `proxyip` / `globalproxy` 一起丢掉 | 使用与入站相同的解析规则，将选中出口规范化成路径；保留非全局白名单语义，普通 `ed` 不充当路由；实际订阅到 gRPC 再到认证代理回显 |
| 显式坏出口配置 | 空地址、坏编码、错误账号、非法端口被 catch 后设置为空，可能改走直连 | 识别到显式出口后返回固定 400；测试拒绝前零拨号，错误不回显凭据 |
| 账号和混合路由 | `User:one:two` 的密码被截成 `one`；路径选中一个地址后又被 query 单独改写协议类型 | 密码按第一个冒号拆分；协议、账号和全局设置作为整套出口选取 |
| ProxyIP 池匹配 | 用 substring 查找入口 `198.51.100.1`，可能错误匹配 `198.51.100.10` | 按解析出的 host 精确匹配；`tests/subscription-routing.test.mjs` |
| Clash ECH 参数补丁 | 合法 YAML 的 UUID / password 加单、双引号后，身份比较失败，漏掉 `ech-opts` | 先读取带引号的凭据标量再匹配；覆盖 flow / block 格式。这不等于真实 ECH 握手已经验收 |
| DoH 请求卡住 | TXT 和 A 同时查询，但 TXT 正文无限等待，阻塞已成功的 A 记录 | 每个查询 3 秒预算覆盖响应头和正文；真实 workerd 中约 3 秒取消 TXT 后完成 HTTP 回退；`tests/proxyip-port.test.mjs` |
| DoH 缓存过期 | 1 秒 TTL 被强制延长到至少 300 秒，出口换 IP 后持续用旧值 | 正缓存尊重记录和 CNAME 的最短 TTL；负缓存按 SOA TTL / MINIMUM 且最多 300 秒，无 SOA / TTL 0 不缓存；解析服务独立缓存；`tests/doh-cache.test.mjs` |

DNS 缓存调整遵循 [RFC 1035 的 TTL 语义](https://www.rfc-editor.org/rfc/rfc1035.html#section-3.2.1) 和 [RFC 2308 的负缓存规则](https://www.rfc-editor.org/rfc/rfc2308.html#section-5)。3 秒是单次 DoH 请求期限；后续再尝试 AAAA 时可能累计更长，不应描述为整个连接最多 3 秒。

路由兼容性变化：隧道 URL 和订阅节点备注中已识别的显式坏代理现在报错，过去可能静默走默认出口；一条节点备注中的坏链式指令会使本次订阅返回固定 400，而不是发布出口已改变的节点。`/video` 编码支持可选的布尔 `global:false`，旧编码仍默认全局；空的保留编码路径也不再当作普通直连路径使用。坏旧配置仍可读取并在后台修改，配置 JSON 中的 `routeError` 是临时诊断，不写回 KV。保存接口目前保留原结构校验，语义错误的新 gRPC 路由仍可能保存，但读取时禁用链接并给诊断、订阅返回错误。节点参数修复需在部署后更新订阅才会进入客户端。

## 已发现、尚未修复或验证不足的范围

以下限制同样继承自原版。本轮没有将握手修复扩大为所有传输生命周期的重写；它们仍需独立修改和回归，不能将本轮结果称为“代理内核已没有问题”。

| 范围 | 证据与影响 | 当前边界 |
| --- | --- | --- |
| UDP DNS 生命周期 | VLESS / Trojan 收到第一条 DNS 响应后仍等 DNS TCP EOF；本机 DNS 保持连接时第二次查询不发出，主动关闭第一条 DNS TCP 后才继续 | 已对两边真实复现。UDP 首部拆分到不同消息还可能卡住。需要按完整 DNS 帧收发与独立上下行状态处理 |
| gRPC 上传 EOF | 客户端上传结束后，下游立即被关闭；目标晚 75 ms 返回时只收到 VLESS 响应头。相同 XHTTP 用例收到完整回复 | 已对两边真实复现。需要明确半关闭、响应完成和客户端取消的区别，不能只删除 close |
| Shadowsocks 地址跨 AEAD 记录 | 第一个解密记录只有部分目标地址时关闭，后面的已认证记录无法补齐地址 | 已对两边真实复现。普通完整地址记录仍有通过用例；需另做 SS 增量地址状态 |
| socket 已建立但目标不回应 | 当前回退主要等建连失败或无数据 EOF；受控静默连接 1,200 ms 内不回退，EOF 后才重试 | 缺少首响应策略。任意 TCP 超时后重放已发送数据可能重复操作，不能用激进重试作为通用修复 |
| 代理握手总期限 | SOCKS5 / HTTP CONNECT 读取仍没有统一总时限；TCP opened 的期限不包含整个代理协商 | 源码确认，未做本轮期限重构。不能把 DoH 和 TCP opened 的有限等待表述为端到端连接都有总期限 |
| HTTPS 代理使用 IP 地址 | 自定义 `TlsClient.acceptCertificate` 只检查非空，没有完整信任链、主机名验证；这与域名 HTTPS 代理的原生 TLS 路径不同 | 源码确认的安全限制。需要替换或完整补足该 TLS 实现；不应将外层客户端的“跳过证书验证”开关视为已覆盖它 |
| HTTPS-IP 包装层背压 | readable 在 async start 中循环拉取；消费者不读取时，受控输入仍提前读入 100 × 64 KiB | 已复现提前排空，不是已复现公网 OOM。需要连同自定义 TLS 的取消与收尾一起修复 |
| TURN 长连接 | 实现 Allocate / Permission / Connect / Bind 后不维护 Refresh | 源码与标准确认；尚无真实 TURN 长时间验收。服务按 allocation 生命周期关闭连接时会影响长连接。[RFC 6062](https://www.rfc-editor.org/rfc/rfc6062.html#section-4.6) |
| SSTP / ECH / 客户端矩阵 | 常规路由与配置回归不能覆盖内层 TCP 重传、所有远端代理实现、真实 ECH 握手及全部转换器 YAML | 未完成专项线上验收，不能因订阅能生成就判定全部可用 |

调试开关的全局粘滞也与上游相同；常规部署的环境变量通常固定，现有证据不足以将其解释为此次延迟主因。DoH 报文解析仍沿用原内核，缓存与超时修复不等于完成全部 DNS 协议健壮性审计。

## 性能判断与验收边界

直连默认并发仍为 2、移动网络为 1，ProxyIP 并发为 1，建连超时为 1,000 ms。保持队列串行写入和现有合包策略。本地内嵌面板与下载源码使 bundle 大于原版，但隧道每个数据块不会重新解码全部面板资源；没有生产冷启动对照，不能把页面体积直接算成每次代理延迟。较大 bundle 可能增加启动成本，Workers 还有 isolate 内存及单次调用待建连接限制，详见 [官方限制](https://developers.cloudflare.com/workers/platform/limits/)。

本轮没有更换用户的 Clash 配置、订阅、默认出口或 Cloudflare 部署。源码提交、构建包与线上部署是不同状态。部署后需要更新订阅，再用相同入口、出口、协议、DNS、测试 URL 与统一延迟设置做交替对照；分别核验 HTTP 状态、实际传输字节、连接成功率、延迟分布、持续下载和长连接。短时 URL 延迟不能代替这些结果。

复核命令为 `npm test`、`npm run check`、`git diff --check` 及 `npx wrangler deploy --dry-run`。前者先生成实际 bundle，再执行全部协议、路由、配置与面板回归；dry-run 只验证部署打包，不上传代码。还核对 ZIP 内 Worker 与独立 Worker 的字节和 manifest 哈希一致。

集成验证和产物状态记录在 [validation.md](validation.md)。只有完成目标环境的对照，才有依据评价本轮修复后的实际速度；目前可以确认的是已列出的协议和路由缺陷得到定向修复，而不是已经获得某个公网加速倍数。
