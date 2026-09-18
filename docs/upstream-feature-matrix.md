# 上游功能对照矩阵

> 2026-09-17 重新下载实际上游源码与管理页核对，2026-09-18 复核上游 main 未变。当前源码为 v1.0.5，下方保留 v1.0.4 面板核对记录。**“已实现”不等于所有客户端与第三方服务均已在线验收**。公网部署、真实凭据与客户端验收边界见 [validation.md](validation.md)。

## v1.0.5 代理连接改进

保留上游转发队列、合包与代理握手，按需读取白名单、隔离每个请求的拨号参数、清理 TCP 建连定时器，并在完整校验后对 gRPC 单字段采用零复制。移除继承上游的测速域名本地 204 响应，所有测速目标真实转发。具体变化及 Clash Verge 对照方法见 [代理性能说明](proxy-performance.md)。

## 0. v1.0.4 在线页面重新核对

2026-09-17 再次访问用户指定的 `https://edt-pages.github.io/admin/`；`/admin` 返回 301 跳转至此，两者最终 HTML 均为 886,073 字节，SHA-256 均为 `3cb5b5fb00f66fff155105a90ff6d20864e510b33874341b7f6563145b7fdca6`。页面与上次抓取一致，但此前矩阵把“存在用量接口和设置页简表”记作完整首页功能，粒度不足；本次纠正并补齐：

- 概览独立 Workers/Pages 用量面板、两色分段条、总量/百分比、分类计数与日配额参考、北京时间 08:00 的时分秒倒计时、折叠记忆。
- 三选一认证方式、Account Analytics → Read 说明、未保存凭据的同源 POST 验证、保存后自动查询；自定义 API 仅回传固定掩码。
- 明确区分未配置、失败、真实零、超额和跨日旧数据；倒计时只更新文本，不轮询。修复缺失 GraphQL 数据被当作成功零值、旧响应覆盖新凭据和 JSON 恢复旧用量等问题。
- ALPN 确认/自动协商、ECH chrome/firefox/关闭三选、Telegram 新凭据确认后发送测试（不保存），以及 TOKEN/UUID/地址/ECH/ProxyIP/用量六类就近帮助。

以下继续记录协议与主要工具能力；不把外部工具、界面装饰或特意保留的安全差异宣称为逐字一致。管理工具使用 workerd 支持的 manual 重定向策略，并显式拒绝3xx；该路径新增真实构建 Worker 集成验证。

## 1.0.3 已完成的进阶配置补齐

本次实际获取的上游 Worker 仍为 `448a83ced00a43c1d892d5ecbed86a26ea9eeaff`，管理页 SHA-256 仍为 `3cb5b5fb00f66fff155105a90ff6d20864e510b33874341b7f6563145b7fdca6`。因此此次重点是补全可发现入口、字段选项、配置联动和失效行为，并非更换隧道内核。

- 新增侧栏「进阶配置」和「我是高手，我要折腾」模式开关；完整 / 简洁视图同步并本地记忆，显式工具跳转会展开对应工具。
- gRPC / Shadowsocks、TLS / ECH、订阅转换、全部代理路径模板集中在可编辑表单；分组撤销使用同一份配置基线，保留其他组修改。
- 补齐 `360` / `qq` 指纹及 `h3` ALPN 组合；VLESS / Trojan 单节点链接与订阅均带 ALPN。
- 补齐 XUDP / UDP、SS / WebSocket、0-RTT、TLS / ECH / 分片的兼容性联动，服务端拒绝对应无效配置组合。加载旧配置时提示冲突，由用户明确修正，不自动写回。
- **修复此前矩阵遗漏的实际问题：**保存的代理白名单此前未进入转发路由；现在 WS、gRPC、XHTTP 都使用请求自己的 KV 白名单快照，清空生效，保留 `GO2SOCKS5` 强制附加项。仅 `*` 是通配符，其他正则字符按字面匹配。
- 新增内置上游 CHANGELOG 手动读取、UUID 复制、测速网络隐私显示与 IP 详情、单行地址复制、七个字段双向排序和独立多选筛选。
- 补充 Cloudflare 部署变量说明；这些变量仍需在 Cloudflare 修改，不显示无法生效的保存按钮。

本地真实 TCP 代理测试、配置持久化与订阅参数测试见 [validation.md](validation.md)。公网客户端、外部转换器、公开代理可用性及通知投递仍按各自外部条件验收。保留手动、有限次测速语义：勾选或筛选不会自动启动测量。

## 1. 对照对象与证据范围

| 对象 | 固定依据 |
| --- | --- |
| 上游 Worker | `cmliu/edgetunnel` 提交 `448a83ced00a43c1d892d5ecbed86a26ea9eeaff`；`Version = 2026-09-04 16:24:13` |
| 上游 Worker 本地审计副本 | `/tmp/brclio-edgetunnel-upstream-20260915/_worker.js` |
| 实际上游管理页 | `https://edt-pages.github.io/admin`；由上述 Worker 的 `Pages静态页面` 配置拼接 `/admin` 获取 |
| 管理页冻结副本 | `/tmp/brclio-upstream-admin-20260915.html`；886,073 字节；SHA-256 `3cb5b5fb00f66fff155105a90ff6d20864e510b33874341b7f6563145b7fdca6` |
| 本地实现 | `src/worker.js`、`src/panel.js`、`src/admin-tools.js`、`public/admin.html`、`public/assets/app.js`、`public/assets/tools.js`、`public/assets/speedtest.js`、`src/downloads.js` |
| 审计方式 | 读取上述实际 HTML/JavaScript、Worker 路由、默认配置、辅助函数；没有运行或复制上游面板源码到本地界面 |

远端管理页独立更新，**不与固定 Worker 提交一起版本锁定**。例如页面已有转换参数 `EXPAND`，但固定 Worker 的默认配置和转换 URL 中均没有该参数。下文将这种情况列为“远端页面新增”，不会把页面上的选项误称为固定 Worker 已实现的能力。

状态含义：

- **保留**：本地已有对应内核、API 或可操作字段；具体端到端验证仍看验证记录。
- **已实现**：当前本地页面有对应入口及逻辑，不是只有按钮或占位卡片。
- **行为调整**：功能仍存在，但触发方式或安全边界明确不同。
- **外部工具**：原版仅展示目录、打开第三方页面或下载资源，不是在 Worker 内实现该工具。
- **差异 / 未内置**：明确记录不同的交互、外链替代或尚不存在的操作，不计作逐字等价。

## 2. 管理、配置与订阅

| 功能 | 原版依据 | 当前本地状态 |
| --- | --- | --- |
| 登录、退出、无 KV / 无 ADMIN 提示 | Worker `/login`、`/logout`、初始化分支 | 保留；页面本地化；会话改为有时效签名并可撤销 |
| 当前 HOST、UUID、版本展示 | HTML `nodeHost`、`nodeUUID`；`loadVersionByUUID` | 保留 |
| 多 HOSTS 编辑、环境变量覆盖 | `openHostsEditModal`、Worker `env.HOST` | 已实现字段、配置来源说明、不匹配条件提示条与 24 小时忽略 |
| 主配置保存、取消修改、重置 | `saveConfig`、`cancelEdit`、`resetConfigWithConfirm` | 保留保存、恢复和重置；本地另有 JSON 导入/导出及离开提醒 |
| 分区修改状态 | `modifiedSections`、各区保存/取消按钮 | 本地统一配置保存，进阶配置支持分组撤销；ADD、CF、TG 独立保存 |
| 新手 / 高级模式 | `toggleUserMode` | 已实现显眼的「我是高手，我要折腾」开关和完整 / 简洁视图同步，浏览器保存偏好 |
| 暗色主题 / 低性能适配 | 主题 CSS；`LOW_PERF_STORAGE_KEY` 等 | 已实现日间 / 夜间主题；本地轻量 SVG 和 CSS；不复制上游性能彩蛋 |
| 单节点链接复制 | `LinkURL`、`copySubscription` | 保留 |
| 单节点链接二维码 | `showQRCode('LinkURL')` | 已实现本地 SVG 二维码，不向第三方发送链接 |
| 自适应订阅复制 / 二维码 | `subLink`、`showQRCode` | 已实现；按当前格式生成二维码 |
| Base64、Clash、Sing-box 订阅复制 / 二维码 | `base64Link`、`clashLink`、`singboxLink` | 已实现格式选择、复制、下载和二维码 |
| Surge、Quantumult X、Loon 等目标 | Worker `/sub` 客户端识别与 target 分支 | 内核保留；本地提供更多显式下载入口 |
| 订阅鉴权 TOKEN、KEY 快捷订阅 | Worker `/sub`、非默认 KEY 路径 | 保留；TOKEN 由主机名和 UUID 生成 |
| 自定义 HOSTS 随机选取 | Worker 订阅构造 | 保留 |
| 订阅名称 / 更新间隔 | `SUBNAME`、`SUBUpdateTime` | 保留 |
| 本地随机优选 | `ipMode=random`；随机数量/端口 | 保留；生成发生于订阅请求，不应在打开后台时生成 |
| 自定义 IP、域名、IPv6、端口、备注 | `customIPs`；Worker `ADD.txt` 解析 | 保留；空 ADD GET 返回空文本，不虚构“已保存”地址 |
| 汇聚订阅 / 地址 API 行 | `customIPs`、Worker 地址源解析 | 已实现验证预览、动态 URL 追加与静态结果追加 |
| 外部订阅生成器 | `ipMode=generator`、`SUB` | 保留 |
| 自定义列表行号、清空、去重追加 | 原版 line editor / 各工具 append | 可编辑完整原文并追加；原版装饰行号未复制；追加保留原始行，不自动去重 |
| 订阅 API 识别 GitHub URL / raw 转换 | `convertGitHubURLToRaw` | 已实现 GitHub blob / raw 链接转换 |
| API 验证、指定端口、作为 ProxyIP | `verifyAPIOptimize`；`getADDAPI` | 已实现端口和 ProxyIP 选项，POST 请求解析后展示实际结果 |
| API 原地址追加 / 验证结果追加 | `appendAPIToCustom`、`appendResultsToCustom` | 已实现两个独立按钮，编辑区明确提示分别保存地址与配置 |
| 单节点链式代理生成 | `openChainProxyModal`、`addChainProxyNode` | 已实现五种上游代理表单、优选主机/端口/名称及备注指令生成 |
| 链式节点验证 / 备注 / 出口展示 | `verifyChainProxyAvailability` | 已实现验证成功后追加；地址变化后重新验证；可查询出口 IP 详情 |

## 3. 全部高级配置

| 配置 / 能力 | 固定 Worker 实现 | 本地状态 |
| --- | --- | --- |
| `协议类型` VLESS / Trojan / Shadowsocks | WS 首包识别及相应解析函数 | 保留；面板可选三种 |
| `传输协议` ws / grpc / xhttp | WS、POST gRPC、POST XHTTP 入口 | 保留；协议组合仍受原内核能力约束 |
| `gRPC模式` gun / multi | gRPC 链接和转换修正 | 保留 |
| `gRPCUserAgent` | gRPC 客户端参数 | 已实现字段和填入当前浏览器 UA 按钮 |
| `PATH` / `env.PATH` | 节点路径和环境变量覆盖 | 保留 |
| `SS.加密方式` aes-128-gcm / aes-256-gcm | SS AEAD 内核 | 保留 |
| `SS.TLS` | SS WebSocket TLS 参数 | 已实现开关、部署/HTTP 端口说明和关闭确认；取消或 Esc 保持原值，确认后才标记待保存 |
| `Fingerprint` | 订阅 fingerprint 参数 | 保留，补齐 360 / qq；未知已保存值也保留展示 |
| `ALPN` | 原版 2026-09-04 新增参数 | 补齐h3组合、单节点LINK；非空ALPN先确认，取消恢复自动协商 |
| `TLS分片` Shadowrocket / Happ | 客户端对应参数修正 | 保留 |
| `跳过证书验证` | 订阅 skip-verify 参数 | 保留；不代表 Worker 自带 TLS 客户端已实现完整证书链校验 |
| `启用0RTT` / `随机路径` | 早期数据与随机路径构造 | 保留 |
| `ECH` / `ECHConfig.DNS` / `ECHConfig.SNI` | DoH / HTTPS RR 解析和客户端配置 | 已实现开关、DNS/SNI建议、自定义字段；冲突提供chrome/firefox/关闭ECH选择，取消保留旧状态 |
| `优选订阅生成.local` | 本地 / 外部来源开关 | 保留 |
| `本地IP库.随机IP` / `随机数量` / `指定端口` | 随机与自定义分支 | 保留 |
| `SUB` / `SUBNAME` / `SUBUpdateTime` / `TOKEN` | 来源、标题、更新时间、鉴权 | 保留；TOKEN 为计算值 |
| `订阅转换配置.SUBAPI` | 外部 subconverter | 已实现字段、手动目录加载与真实 /version 检测 |
| `订阅转换配置.SUBCONFIG` | 转换规则 URL | 已实现自定义地址及按组加载规则预设 |
| `SUBEMOJI` / `SUBLIST` | Emoji / 仅节点 | 保留 |
| `UDP` / `XUDP` / `TLS13` | 转换参数 | 保留；打开参数不等于所有传输均支持任意 UDP |
| `APPEND_TYPE` / `SORT` | 节点类型后缀和排序 | 保留 |
| `EXPAND` | **固定 Worker 未实现；远端页面新增** | 已实现布尔校验、默认值和转换 URL 的 expand 参数；属于对固定 Worker 的明确增补 |
| `反代.PROXYIP` | 自动 / 指定反代出口 | 保留 |
| `反代.SOCKS5.启用` | 关闭 / socks5 / http / https / turn / sstp | 保留五种上游代理 |
| `反代.SOCKS5.全局` / `账号` / `白名单` | 全局代理或域名匹配 | 修复 KV 白名单生效，按请求快照匹配；环境变量继续强制附加 |
| `路径模板.PROXYIP` | `{{IP:PORT}}` 替换 | 已实现专属字段与目录预设，保留 {{IP:PORT}} 校验 |
| SOCKS5 / HTTP / HTTPS / TURN / SSTP 标准与全局路径 | 每类两个模板，共十个 | 十个字段均可编辑；应用预设深合并，不丢掉预设未提供的类型 |
| `TG.启用` + 独立 `tg.json` | 日志事件通知 | 已实现保存、清除、通知开关与显式 getMe + 测试消息 |
| CF Email / GlobalAPIKey | 独立 `cf.json` | 保留 |
| CF AccountID / APIToken | 独立 `cf.json` | 保留 |
| CF UsageAPI | 外部计数接口 | 保留；增加响应数值校验、超时和失败状态 |
| 完整 JSON / 未知未来字段 | KV config | 本地支持导入导出、深度合并默认配置、保留合法未知字段；运行时派生字段不持久化 |

## 4. 网络、测速与代理工具

| 用户能力 | 原版位置 / 行为 | 当前本地状态 |
| --- | --- | --- |
| 国内出口 IP / 地区 | `loadIPIPInfo` 等 | 已实现手动国内资源响应头探测；来源不返回地区时只显示 IP |
| 未封锁国外出口 IP / 地区 | `loadOverseasInfo` 等 | 已实现手动浏览器查询 api.ipapi.is |
| Cloudflare 访问出口 / colo | `loadCFInfo` 等 | 已实现显示当前 Worker 请求入口 IP / 地区 / colo；名称明确为当前 Cloudflare 入口 |
| 墙外出口 IP / 地区 | `loadTwitterInfo` 等 | 已实现手动查询 X.com trace；跨域失败明确显示未获取 |
| 八站延迟检测 | `startLatencyTest` | 已实现原八站默认列表、自定义列表、1–16 次采样；手动有限次，可停止 |
| 每站最近 16 个样本 / 图表 | `latencyTestConfig.count = 16` | 已实现逐次样本和均值展示，最多 16 次；用结果文字替代原滑动柱图，无后台循环 |
| BestCF 本地在线优选视图 | `onlineOptimizeTemplate` 内嵌 iframe | 已实现独立本地测速页，候选/结果/操作闭环；没有复制原 HTML |
| IPv4 / IPv6 网络可用性与测试节点检测 | BestCF `detectNetwork` | 已实现手动 IPv4 / IPv6 检测及主/备用探测服务切换 |
| IP、IPv6、CIDR、IPv4 范围展开 | BestCF 输入解析 | 已实现 BigInt 网段/范围解析、随机候选生成及本地 TXT / CSV 导入 |
| 官方 v4/v6、CM、AS13335、AS209242 库 | BestCF `libraries` | 已实现原七项远端目录快捷选择与自定义 URL；选择只填字段，点击获取才出站 |
| 样本数量 1–4096、超时、并发 1–32、端口 | BestCF `readSettings` | 已实现候选 1–4096、超时、并发设置及端口 0 随机选择；可调整每项下载流量和时限 |
| 候选延迟 / 可用性批量检测 | `startLatencyRun` | 已实现有限并发队列、超时、进度、停止与离页取消 |
| 单行下载测速 | `startSingleSpeedTest` | 已实现每行测速按钮；手动启动一项有限下载 |
| 全部 / 所选批量下载测速 | `startAllSpeedTests`、拖选逻辑 | 已实现选中或全部有限队列；显式按钮替代拖选结束即启动 |
| 下载测速量与时限 | `__down?bytes=20000000`，10 秒上限 | 已实现每项 1–100 MB、1–30 秒，上限默认 20 MB / 10 秒；结束取消读取 |
| 结果 IP、端口、colo、国家、网络类型、延迟、Mbps | BestCF 结果表 | 已实现地址/端口、国家、colo、类型、延迟、Mbps 和状态；CSV 保留独立字段 |
| 结果排序、国家/机房/类型过滤 | BestCF `sort/filter` | 已实现关键词、状态及 IP 族/类型/国家/colo 多选筛选，地址/IP族/类型/国家/colo/延迟/速度七字段双向排序 |
| 全选、反选、清除选择、保存到 ADD | `saveSelectedResults` | 已实现选中筛选结果、反选、取消全部、复制与追加 ADD |
| CSV 导出 | BestCF 保存按钮长按导出 | 已实现显式导出当前筛选结果，包含公式前缀转义 |
| 本地测速工具目录及 UI 类型筛选 | `best-cf-tools.json` | 已实现手动加载原目录、Web UI / GUI / CLI 筛选、名称/作者/平台搜索及独立项目外链；不复制或执行第三方工具代码 |
| SOCKS5 / HTTP / HTTPS / TURN / SSTP 可用性检查 | `verifyProxyAvailability` → `/admin/check` | 已实现五类输入检测、填当前出口、应用结果；POST 避免凭据放 URL |
| 公共 SOCKS5 / HTTP / HTTPS 目录 | `proxyConfigs` | 已实现手动加载、地区/关键词筛选、分页、单条/批量验证与应用 |
| 公共 ProxyIP 目录 | `https://zip.cm.edu.kg.cmliussss.net/all.json` | 已实现手动加载与 443 端口过滤（同原版），支持多选、验证和应用 |
| 代理地区筛选、排序、验证进度 | `loadProxyList`、`onProxyRegionChange`、`verifyProxies` | 已实现地区/关键词筛选、整区全选、任意所选最多 8 并发验证、停止、进度与按可用性/延迟排序 |
| ProxyIP IPv4 / IPv6 支持检测 | `verifySingleProxyIP` → `api.090227.xyz/check` | 已实现 POST /admin/check type=proxyip，展示服务实际返回的能力标记 |
| 公共代理选择填入配置、ProxyIP 多选追加 | `confirmSelectProxy`、`confirmSelectProxyIP` | 已实现；检测候选可批量选择，应用时单个上游代理或最多 8 个 ProxyIP，应用限制不限制检测数量 |
| 代理出口地图 / IP 详情 | `updateProxyMap`、`showIpDetailForProxy` | 已实现来源经纬度数值归一、本地 SVG 地图与 IP 详情；不加载第三方地图瓦片 |

## 5. 测速触发机制的准确结论

以下行号指冻结的原管理 HTML，描述的是源码中明确存在的触发链；不是猜测其截图行为。

1. **主页八站延迟不是打开页面就立刻运行，但展开网络详情会自动开始并持续运行。** 初始内容在 10389 行 `display:none`；20506 行 `toggleNetworkModule()` 的展开分支在 20523 行调用 `startLatencyTest()`，折叠才调用停止。
2. `startLatencyTest()` 在 17882 行建立会话，每个站点先采 16 次；17927 行为每站安装 `setInterval`，17949 行间隔为 `618 * 3`，即 **1,854 毫秒**。之后不断更新 16 次滑动窗口，直到停止。这是真实重复请求，不只是图表动画。
3. **BestCF 延迟 / 下载任务主要由手动操作启动，并按有限候选队列结束。** 延迟按钮监听在 13892 行，全部下载按钮在 13906 行，单行测速在 13939 行；拖选结束也可启动所选下载。下载函数在 14896 行；其 250 ms interval 只计算正在下载任务的进度，并在 finally 中清理，不代表持续重测。
4. **另外存在自动网络信息探测。** 主页面 `scheduleNetworkInfoLoad()` 在页面完成后约 1.2 秒及浏览器空闲时获取一次出口信息；BestCF 的 `DOMContentLoaded` 在 13870 行调用 `detectNetwork()`。这些不是持续带宽测速，但仍是用户未点检测按钮就发生的网络探测。
5. 公共代理探索窗口会加载目录；选择地区时 `onProxyRegionChange()` 调用 `verifyProxies()`，最多 8 并发，自动验证该地区代理。这是有限任务，但也应改为显式“验证所选 / 验证当前地区”按钮启动。

本地验收标准：页面初始加载、切换页签、展开模块、加载目录、选择地区、修改输入均不能隐式启动测速；只有明确的检测按钮启动有限任务；支持停止、关闭后取消；测试结束后不保留再次出站的 interval。配额倒计时和单次任务的进度刷新可以保留，它们不应触发新网络测量。

## 6. 统计、帮助、版本与独立下载

| 功能 | 原版实现 | 当前本地状态 / 边界 |
| --- | --- | --- |
| Workers / Pages / 总量 / 配额 | CF 用量模块 | 概览与设置均有独立面板、Workers/Pages 两色分段、三项计数、百分比、时分秒与北京时间08:00说明；折叠记忆；区分失败/零/跨日/超额；时钟不发请求 |
| CF 凭据验证 / 保存 / 清除 | `testCloudflareConfig` | 三种认证方式选择；GET刷新已保存凭据，POST验证未保存输入且不写KV；不把凭据放query |
| TG 凭据验证 / 测试通知 / 保存 / 清除 | `testTelegramConfig` | 支持已保存凭据与未保存输入验证；发送前明确确认，未保存验证不写KV，不自动开启通知 |
| 最近 / 全部日志 | `openLogsModal` | 保留；本地新增搜索、类型过滤、分页和详情 |
| TOKEN / UUID / 自定义 ADD 写法帮助 | `showAuthTokenHelpModal` | 配置和教程提供说明；原版独立帮助弹窗及长篇内容未照搬 |
| ProxyIP 用途、ECH 原理/使用/验证帮助 | `proxyIPHelpModal`、`echHelpModal` | 新增就近帮助入口、目录弹窗及入口/反代/上游路由图；ECH说明DNS/SNI/指纹/客户端条件，原创内容不逐字复制 |
| gRPC 平台开启提示 | `transportGrpcModal` | 已实现折叠说明和 Cloudflare 官方文档链接 |
| 当前域名不在 HOSTS 的提示 | `hostsMismatchModal` | 已实现非空 HOSTS 与当前 hostname 不匹配时的条件提示条、查看配置及本地 24 小时忽略；不自动改配置或请求网络 |
| 上游当前 / 最新版本比较 | `fetchLatestOnlineVersionNumber` | 已实现手动读取最新版本，并并列展示集成版本；不自动覆盖项目 |
| 上游 CHANGELOG 查看 | `loadVersionChangelog` | 已实现手动读取上游固定 CHANGELOG 地址并在本地展示纯文本，失败可重试；同时保留提交记录外链 |
| 复制原版 Worker 源码 | `copyLatestWorkerSourceToClipboard` | 已实现复制当前部署的 Brclio 完整源码；刻意不回退为未修改上游源码 |
| 下载 Pages ZIP | `openLatestPagesZipDownload` | 已实现由当前部署源码生成 ZIP，包含许可证文件 |
| 隐藏源码混淆复制 | `obfuscateWorkerSourceWithJShaman` | 原版超过免费 512 KiB 门槛会直接复制原源码；当前 Brclio 源码已超限，本地提供当前源码复制和 JShaman 官方外链，不上传服务 |
| UUID 专属 Snippet.js 生成 / 复制（残留代码） | `openUUIDSnippetModal`、`generateUUIDSnippetCode` | 冻结原页面未找到入口调用或事件绑定，不属于当前可点击功能；本地保留第三方项目外链，不收录授权未确认模板 |
| 作者 / 项目 / 教程链接 | 页脚和帮助链接 | 品牌可调整；继承代码的许可证和作者声明必须保留 |

### Snippet 与 JShaman 的可达性和边界

**Snippet 的原始判断已根据调用链纠正。** 冻结 HTML 中 `openUUIDSnippetModal` 只出现一次，即第 22354 行的函数定义；`generateUUIDSnippetCode` 出现两次，分别是该函数中的调用（22368 行）与自身定义（22589 行）。第 22717 行的 `initNodeUUIDEasterEgg()` 实际仅为 UUID 输入框绑定“点击复制 UUID”。未找到打开 Snippet 弹窗的 HTML 按钮、事件绑定或其他调用，因此不能把残留生成器函数当成原页面现有可点击功能。

该残留流程会读取第三方 `EDT.min.js` 与字典，在浏览器中替换 UUID 和其 SHA-224 密码，再随机替换字符和缩进。审计时 [Snippets 分支](https://github.com/EDT-Pages/EDT.min.js/tree/Snippets)只有两个 JS 文件与字典，未附 LICENSE；GitHub 仓库许可字段为空。这里仅记录来源和处理行为，不将这些模板当作可随本项目再许可的源码，也没有把它们打包。

**JShaman 长按流程在原版中可达，但有大小门槛。** 原版复制按钮长按 618 ms 后尝试调用外部服务，使用 `{js_code, vip_code:"free"}`，60 秒超时；源码超过 `512 * 1024` 字节时根本不发请求，直接复制原源码。失败或用户中途松手也回退复制原文。当前本地独立 Worker 源码约 1.9 MB，已超过这个原版免费门槛。本地保留“复制当前 Worker 源码”和 [JShaman 官方网站](https://www.jshaman.com/)入口，外链不自动上传源码、配置或凭据。没有测试真实服务混淆，也未将该服务声明为本项目的开源内置组件。

HOSTS 条件提示和 SS TLS 确认撤销已通过代码与语法核对；最终浏览器操作结果由 [validation.md](validation.md)记录，不以这里的实现说明代替点击验收。

## 7. Worker 接口与协议入口

| 入口 | 原版能力 | 本地状态 |
| --- | --- | --- |
| `GET /version?uuid=…` | UUID 验证版本读取 | 保留 |
| 任意路径 WebSocket Upgrade | VLESS / Trojan / SS 首包和早期数据 | 保留 |
| 非管理 POST | 根据内容/路径识别 gRPC 或 XHTTP | 保留 |
| TCP 直连 / 反代兜底 / 代理链 | 各连接辅助函数 | 保留；正式 Cloudflare `connect()` 适配 |
| UDP / DNS 路径 | 原版协议内 UDP 分支和 DNS 特例 | 保留代码；不能扩大为任意客户端、任意 UDP 已验证 |
| `/login` / `/logout` | 管理会话 | 保留功能；签名、时效、撤销和同源写入加强 |
| `GET /admin` | 远端 HTML 代理 | 行为调整为本地资源 |
| `GET/POST /admin/config.json` | 配置读取/写入 | 保留；对象校验/默认合并/字段分层 |
| `/admin/init` | 重置配置 | 保留，改为 POST；GET 不再写 KV |
| `GET /admin/log.json` | 日志 | 保留；URL 凭据脱敏 |
| `POST /admin/cf.json` | CF 凭据保存/清除 | 保留；局部更新不覆盖未提交的秘密 |
| `GET /admin/cf.json` | 返回 request.cf 元数据 | 保留；不返回存储凭据 |
| `POST /admin/tg.json` | TG 凭据保存/清除 | 保留 |
| `GET/POST /admin/ADD.txt` | 自定义列表 | 保留读写；空库 GET 返回空串 |
| `/admin/getCloudflareUsage` | CF / UsageAPI 计数 | GET读已保存凭据、POST验证指定认证方式输入；含URL密钥返回400 |
| `/admin/getADDAPI` | 下载/解析优选和订阅源 | 保留；已增加 POST body 入口 |
| `/admin/check` | 五类代理连通检查 | 保留；已增加 POST，ProxyIP 单独工具模块 |
| `/sub` + format / 客户端识别 | 节点订阅、转换、内容修正 | 保留 |
| 非默认 KEY 快捷路径 | 跳转 / 生成订阅 | 保留 |
| `/locations` | Cloudflare 测试节点地理信息 | 保留；需要会话 |
| `/robots.txt` | 禁止索引 | 保留 |
| 根目录 / 未命中路径 | 伪装页、反向代理或跳转 | 保留；不转发管理员 Cookie / Authorization |
| `GET /admin/meta` | 原版无此入口 | 本地增加：构建与许可元数据 |
| `GET /admin/network` | 原版浏览器读取多个网络来源 | 新增返回当前 Worker 入口元数据，页面手动查询 |
| `GET /admin/download/worker.js` / `pages.zip` | 原版下载上游源码或归档 | 已实现当前部署源码和带许可证的 Pages ZIP |
| `GET /admin/catalog?kind=…` | 原版浏览器直取目录 | 已新增受鉴权、固定来源目录接口 |
| `POST /admin/testSubAPI` | 原版浏览器 GET `/version` | 已新增；返回真实版本识别结果 |
| `POST /admin/testTelegram` | 原版浏览器 getMe + sendMessage | 已新增；默认读KV，`useInput:true`验证候选输入；必须`sendMessage:true` |
| `POST /admin/ipDetail` | 原版浏览器请求 IP 详情 | 已新增；只接收 IPv4/IPv6 字面量，固定查询 api.ipapi.is |

完整原始字段和兼容差异另见 [api-contract.md](api-contract.md)；结构、安全边界和外部依赖另见 [architecture.md](architecture.md)。

## 8. 新增工具的实现与验证边界

`src/admin-tools.js` 已由主 Worker 在鉴权及同源写入检查之后调用，并使用原始大小写路径匹配工具接口：

- 固定目录 `subapi`、`subconfig`、`paths`、`localtools`、`socks5`、`http`、`https`、`proxyip`、`version`，返回 `{success, kind, source, data}`。目录不会接受任意来源覆盖；版本只返回解析后的版本号。
- `POST /admin/testSubAPI {url}` 真实请求来源的 `/version`，须包含 `subconverter` 标识；返回规范化 origin 和版本。
- `POST /admin/testTelegram {sendMessage:true}` 使用保存的 Bot Token / Chat ID，向官方 Telegram API 依次请求 getMe 和 sendMessage；错误响应不回显凭据或远端描述。
- `POST /admin/check {type:'proxyip', address}` 使用原版检查服务，仅返回支持字段；其他代理类型返回 null，且不消耗原始 request body，由主 Worker 继续处理。
- `POST /admin/ipDetail {ip}` 仅读取指定 IPv4/IPv6 的第三方信息，保留来源数据与 `source` 标注；只在显式操作调用，不自动切换来源。
- 默认请求 6 秒超时；ProxyIP 大目录 15 秒 / 20 MiB；设置输入和响应大小限制；不转发用户 Cookie / Authorization。

`node --test tests/admin-tools.test.mjs` 已通过 11 项计数（10 个子用例与 1 个父用例），使用实际本机 HTTP 服务作为受控响应，不连接生产 Telegram 或代理检查服务；覆盖目录 allowlist、原 body 可继续读取、敏感头过滤、真实响应识别、消息发送次数、IP 字面量校验、错误、响应大小和超时。此结果是模块测试，不能替代主 Worker 集成鉴权和浏览器按钮验收。

### 本次明确的行为边界

用户明确要求改变的是测速触发：改为手动启动的有限任务，取消展开即启动、自动网络探测、选地区即验证和持续重测。之前完成的安全改动仍保留：有期限且可撤销的会话、同源 POST、GET 不重置、凭据独立存储、日志脱敏、配置校验及空 ADD 的真实读取。这些差异不会在“功能对齐”中被隐去。

界面布局、说明文字、图表表现与长按/彩蛋入口按 Brclio 设计重写。第三方 Snippet 生成器、混淆服务、外部下载工具不自动成为本项目内置功能；具体入口见矩阵。不能宣称所有页面逐字等价，也不能把本地受控测试等同于公网部署、真实 Telegram 投递、公共代理可用性或所有真实客户端组合验收。

## 9. 来源

- [固定上游 Worker](https://github.com/cmliu/edgetunnel/blob/448a83ced00a43c1d892d5ecbed86a26ea9eeaff/_worker.js)
- [实际管理页](https://edt-pages.github.io/admin)
- [订阅转换后端目录](https://raw.githubusercontent.com/cmliu/cmliu/main/SUBAPI.json)
- [转换规则目录](https://raw.githubusercontent.com/cmliu/cmliu/main/SUBCONFIG.json)
- [路径模板目录](https://raw.githubusercontent.com/cmliu/cmliu/main/json/edt-path-config.json)
- [代理目录](https://github.com/EDT-Pages/Proxy-List)
- [上游 GPL v2 许可证](https://github.com/cmliu/edgetunnel/blob/448a83ced00a43c1d892d5ecbed86a26ea9eeaff/LICENSE)
