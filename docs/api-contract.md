# 管理 API：上游兼容契约

基线：[cmliu/edgetunnel @ 448a83c](https://github.com/cmliu/edgetunnel/blob/448a83ced00a43c1d892d5ecbed86a26ea9eeaff/_worker.js)。第 1–8 节记录上游实际行为，供本地管理界面及适配层维护。**本仓库当前接口以第 9 节“Brclio 本地版本差异”和第 10 节“本地管理工具接口”为准**，其中列出鉴权、保存校验和用量读取的已实现改动。

## 1. 通用规则

- 管理接口要求配置管理员密码、有效 KV 绑定以及登录 Cookie。
- 普通上游管理接口未登录时返回 **302 `/login`**，不是 JSON 401。浏览器 fetch 默认跟随重定向，最终可能取得 200 HTML；调用端必须识别重定向或响应 Content-Type。
- 页面请求使用同源相对 URL。Cookie 是 HttpOnly，前端不读取或自行计算它，也不把管理员密码保存在 localStorage。
- 大多数路由不区分大小写，但 `admin/getCloudflareUsage`、`admin/getADDAPI`、`admin/ADD.txt` 的匹配**区分大小写**。
- `POST /admin` 会被上游的通用代理 POST 入口截获。写操作必须使用具体 `/admin/…` 路由。
- 上游 GET 配置接口没有一致的 `Cache-Control: no-store`；本地适配应对管理 HTML、JSON 和文本统一设置私密、不可缓存响应。

## 2. 登录与会话

### `GET /login`

已登录返回 302 `/admin`；未登录返回远端登录 HTML。重做后可改为本地 HTML，保留入口路径。

### `POST /login`

请求体是 URL encoded 表单：

```http
Content-Type: application/x-www-form-urlencoded;charset=UTF-8

password=URL_ENCODED_PASSWORD
```

成功响应：

```json
{ "success": true }
```

成功会设置：

```http
Set-Cookie: auth=VALUE; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax
```

上游 `VALUE` 的计算过程：第一次 MD5 得到十六进制字符串，对其第 7 至 26 索引的字符再次 MD5；输入为 `User-Agent + KEY + 管理员密码`。**它不含时间戳，也没有服务器会话表。** 不能据 Cookie 的 Max-Age 声称服务器会在一天后拒绝旧 Cookie。

上游错误密码会退回登录 HTML，通常仍为 200；没有固定的 JSON 错误形状。新面板应给出明确的错误反馈，并兼容此行为或由本地适配统一为 JSON 401。

### `GET /logout`

上游返回 302 `/login` 并设置 `auth=; Path=/; Max-Age=0; HttpOnly`。这是当前浏览器退出；不会撤销其他地方保存的同值凭证。

## 3. 管理路由总表

表中“GET”表示前端应采用的读取方式；上游有些处理分支并未严格限定 method。

| 路由 | 请求 | 成功响应 | 错误或特殊行为 |
| --- | --- | --- | --- |
| `/admin` | GET | 管理 HTML | 上游运行时取远端页面；未知 admin GET 子路径也可能返回同一 HTML |
| `/admin/config.json` | GET | 完整有效配置 JSON | 会初始化缺失配置、合并凭证摘要和查询用量 |
| `/admin/config.json` | POST JSON | `{success:true,message:"配置已保存"}` | 缺 UUID 或 HOST 为 400；写入失败 / 非法 JSON 常为 500 |
| `/admin/ADD.txt` | GET | UTF-8 纯文本，带 `asn` 响应头 | KV 为空时生成随机列表并返回，不自动保存 |
| `/admin/ADD.txt` | POST text | `{success:true,message:"自定义IP已保存"}` | 错误 500；上游不校验列表合法性 |
| `/admin/cf.json` | GET | 当前请求的 `request.cf` JSON | **不是已保存的 Cloudflare 凭证** |
| `/admin/cf.json` | POST JSON | `{success:true,message:"配置已保存"}` | 专用 Cloudflare 凭证写入；缺少有效组合为 400 |
| `/admin/tg.json` | POST JSON | `{success:true,message:"配置已保存"}` | 专用 Telegram 凭证写入；缺字段为 400 |
| `/admin/log.json` | GET | 日志数组 JSON；空时 `[]` | 没有专用清空、删除或分页接口 |
| `/admin/init` | 上游任意 method；新面板应 POST | 重置后的完整配置，加 `init:"配置已重置为默认值"` | 上游 GET 有副作用；本地应拒绝 GET |
| `/admin/getCloudflareUsage` | query 参数，详见下文 | 用量对象 JSON | 多数查询失败仍为 200 + `success:false` |
| `/admin/getADDAPI` | `?url=…&port=443` | `{success:true,data:[…]}` | 缺 url 为 403 `{success:false,data:[]}`；解析 / fetch 错误为 500 |
| `/admin/check` | `?socks5=…` 或其他支持类型 | 代理检查结果 JSON | 缺代理参数为 400；实际连接失败常为 200 + `success:false` |

### 未提供的接口

上游没有通用 `PATCH`、配置版本号、ETag 乐观锁、单字段保存、改管理员密码、删除日志、GET Telegram 凭证等接口。前端不能显示对应按钮却只修改本地状态。

## 4. 配置读取与保存

### 推荐流程

1. GET `/admin/config.json`，保存完整快照。
2. 用快照填充表单；动态节点 LINK、UUID、TOKEN、用量等只读展示。
3. 提交时复制完整快照，只修改表单涉及的可编辑字段。
4. POST 完整 JSON，检查 HTTP 状态和 `{success:true}`。
5. 再次 GET 有效配置，确认环境覆盖、路径生成和新订阅结果；不要只凭按钮成功动画认为已保存。

上游保存会**整体替换** `config.json`，并只校验 `UUID` 和 `HOST`。只提交几个字段会破坏其余嵌套结构。服务端应增加 schema 校验或与默认配置进行受控合并。

### 配置字段表

| 路径 | 类型与默认值 | 语义 / 编辑限制 |
| --- | --- | --- |
| `TIME` | ISO 时间字符串 | 初始化时间 |
| `HOST` | string | 当前有效主域名；读取时覆盖 |
| `HOSTS` | string[] | 订阅候选域名；`env.HOST` 存在时覆盖 |
| `UUID` | UUID v4 string | 协议凭证；读取时按环境或派生值覆盖 |
| `PATH` | string，`/` | 基础节点路径；`env.PATH` 存在时覆盖 |
| `ALPN` | string，空 | 订阅中的 ALPN 参数 |
| `协议类型` | `vless` / `trojan` / `ss`；默认 `vless` | 客户端节点协议 |
| `传输协议` | `ws` / `grpc` / `xhttp`；默认 `ws` | 客户端传输类型 |
| `gRPC模式` | `gun` / `multi`；默认 `gun` | gRPC mode |
| `gRPCUserAgent` | string，默认请求 UA | 部分转换订阅中的 gRPC UA |
| `跳过证书验证` | boolean，false | 转换订阅参数，不是统一的服务端 TLS 开关 |
| `启用0RTT` | boolean，false | 生成路径附加 `ed=2560` |
| `TLS分片` | null / `Shadowrocket` / `Happ` | 客户端专属 fragment 参数 |
| `随机路径` | boolean，false | 输出订阅时产生随机路径 |
| `Fingerprint` | string，`chrome` | 客户端 TLS 指纹参数 |
| `ECH` | boolean，false | 输出 ECH 参数 |
| `ECHConfig.DNS` | string，`https://dns.alidns.com/dns-query` | ECH DNS 地址 |
| `ECHConfig.SNI` | string，`cloudflare-ech.com` | ECH SNI |
| `SS.加密方式` | string，`aes-128-gcm` | Shadowsocks 加密方法；选项应以实现能力为准 |
| `SS.TLS` | boolean，新配置默认 true | SS 插件是否启用 TLS；旧配置缺 SS 时的兼容默认是 false |
| `优选订阅生成.local` | boolean，true | true 用本地来源；false 用外部生成器 |
| `优选订阅生成.本地IP库.随机IP` | boolean，true | true 从 CIDR 随机选取候选地址 |
| `优选订阅生成.本地IP库.随机数量` | number，16 | 随机节点数，前端和服务器均应限制合理范围 |
| `优选订阅生成.本地IP库.指定端口` | number，-1 | -1 从预设 TLS 端口中随机；其他值是指定端口 |
| `优选订阅生成.SUB` | string / null | 外部优选订阅生成器来源 |
| `优选订阅生成.SUBNAME` | string，`edgetunnel` | 订阅显示名称 |
| `优选订阅生成.SUBUpdateTime` | number，3 | 订阅刷新间隔，小时 |
| `优选订阅生成.TOKEN` | string | 动态生成的订阅凭证；只读、敏感 |
| `订阅转换配置.SUBAPI` | URL string | 转换服务，原始默认为 `https://SUBAPI.cmliussss.net` |
| `订阅转换配置.SUBCONFIG` | URL string | 外部转换规则模板 |
| `订阅转换配置.SUBEMOJI` | boolean，false | 转换器 emoji 参数 |
| `订阅转换配置.SUBLIST` | boolean，false | 转换器 list 参数 |
| `订阅转换配置.UDP` | boolean，false | 输出订阅的 UDP 参数；不代表服务端具备任意 UDP 出站 |
| `订阅转换配置.XUDP` | boolean，false | 输出订阅的 XUDP 参数 |
| `订阅转换配置.TLS13` | boolean，false | 转换器 tls13 参数 |
| `订阅转换配置.APPEND_TYPE` | boolean，false | 转换器追加节点类型参数 |
| `订阅转换配置.SORT` | boolean，false | 转换器排序参数 |
| `反代.PROXYIP` | string，`auto` | 显式节点反代参数；auto 使用入口环境逻辑 |
| `反代.SOCKS5.启用` | null / `socks5` / `http` / `https` / `turn` / `sstp` | 名称沿用 SOCKS5，但实际承载多种代理类型 |
| `反代.SOCKS5.全局` | boolean，false | 使用全局代理形式 |
| `反代.SOCKS5.账号` | string，空 | 可含用户名、密码、主机、端口；敏感信息 |
| `反代.SOCKS5.白名单` | string[] | 默认域名白名单；实际转发还使用环境初始化白名单，不能仅凭表单宣称实时生效 |
| `反代.路径模板` | object | PROXYIP 及各协议的全局 / 标准路径模板；通常保留原样 |
| `TG.启用` | boolean，false | 是否发送通知；凭证仍走专用 tg 接口 |
| `TG.BotToken` | string / null | 返回的是掩码摘要；不要直接回写为真实 Token |
| `TG.ChatID` | string / null | Chat ID 摘要 |
| `CF` | object | 凭证摘要及 Usage；真实凭证走专用 cf 接口 |
| `完整节点路径` | string | 根据基础路径、反代配置与 0-RTT 动态计算；只读 |
| `LINK` | string | 动态生成的单节点 URL；只读、敏感 |
| `加载时间` | 如 `12.34ms` | 本次配置加载耗时；只读 |

### 路径模板结构

```json
{
  "PROXYIP": "proxyip={{IP:PORT}}",
  "SOCKS5": { "全局": "socks5://{{IP:PORT}}", "标准": "socks5={{IP:PORT}}" },
  "HTTP": { "全局": "http://{{IP:PORT}}", "标准": "http={{IP:PORT}}" },
  "HTTPS": { "全局": "https://{{IP:PORT}}", "标准": "https={{IP:PORT}}" },
  "TURN": { "全局": "turn://{{IP:PORT}}", "标准": "turn={{IP:PORT}}" },
  "SSTP": { "全局": "sstp://{{IP:PORT}}", "标准": "sstp={{IP:PORT}}" }
}
```

## 5. Cloudflare 与 Telegram 专用保存

### `POST /admin/cf.json`

下列四种请求任选其一，上游写入前会把其余凭证字段置为 null：

```json
{ "AccountID": "ACCOUNT_ID", "APIToken": "API_TOKEN" }
```

```json
{ "Email": "EMAIL", "GlobalAPIKey": "GLOBAL_API_KEY" }
```

```json
{ "UsageAPI": "https://example.com/usage" }
```

```json
{ "init": true }
```

同一请求如果同时提供多组，上游优先 `Email + GlobalAPIKey`，再 `AccountID + APIToken`，再 UsageAPI。前端应让用户明确选择一种。`init:true` 只清除用量凭证，不重置主配置。

GET `/admin/cf.json` 不能用于取回这里保存的凭证，它返回当前 Cloudflare 请求元数据。

### `POST /admin/tg.json`

```json
{ "BotToken": "BOT_TOKEN", "ChatID": "CHAT_ID" }
```

或者用 `{ "init": true }` 清空这两个字段。`TG.启用` 在主配置中单独保存；清空凭证与开关是不同操作。管理端显示掩码提示时，输入为空应理解为“尚未输入新凭证”，不能用掩码替代真实密钥提交。

### `GET/POST /admin/getCloudflareUsage`

原版曾通过 query 传递凭据；本地拒绝该方式。GET 使用已保存凭据；POST 以 JSON body 验证未保存输入，且不写 KV。详见 9.3。

响应形状：

```json
{
  "success": true,
  "pages": 120,
  "workers": 340,
  "total": 460,
  "max": 100000
}
```

统计范围是本日 UTC 00:00 起的账户聚合请求。`max:100000` 是源码固定值，不能当作从当前 Cloudflare 账户套餐读取的真实额度。`success:false` 可能意味着未配置、凭证无效、网络失败或权限不足；不是确认用量为零。

## 6. 地址列表与连通检查

### `GET/POST /admin/ADD.txt`

文本示例，地址与端口为说明格式，不代表测得可用：

```text
example.com:443#自定义节点
[2001:db8::1]:443#IPv6格式示例
https://example.com/addresses.txt
```

源码还解析 `sub://` 来源、其他协议节点 URL、部分 `sub=` 参数与备注中的链式代理信息。前端应保留原始文本，避免将高级条目误改成普通 IP。禁用“随机 IP”后，本地生成订阅才会优先使用 KV 中的 ADD.txt。

### `GET /admin/getADDAPI?url=…&port=443`

`url` 是待检查来源，`port` 默认 443。返回的 `data` 是地址或节点字符串数组，备注会做 URL decode。上游只尝试构造 URL 并请求，不应将 `success:true` 解读成所有节点已测速可用。

### `GET /admin/check`

query 类型只取以下顺序找到的第一个：`socks5`、`http`、`https`、`turn`、`sstp`。参数是代理账号或地址，例如 `user:password@example.com:1080`，必须 URL encode。

成功示例：

```json
{
  "success": true,
  "proxy": "socks5://example.com:1080",
  "ip": "203.0.113.1",
  "loc": "US",
  "responseTime": 245
}
```

实际连接失败通常仍是 HTTP 200：

```json
{
  "success": false,
  "error": "无法连接到代理服务器",
  "proxy": "socks5://example.com:1080",
  "responseTime": 245
}
```

这是通过所选代理访问 `cloudflare.com:443/cdn-cgi/trace` 的单次检查。`responseTime` 单位为毫秒，既不是吞吐测速，也不是访问所有站点的保证。`proxy` 可能包含账号密码，前端应脱敏显示。

## 7. 日志、重置与订阅

### 日志条目

```json
{
  "TYPE": "Save_Config",
  "IP": "203.0.113.1",
  "ASN": "AS0 Example",
  "CC": "CN Example",
  "URL": "https://example.com/admin/config.json",
  "UA": "ExampleBrowser",
  "TIME": 1789430400000
}
```

`TIME` 为 Unix 毫秒时间戳。已观察的 TYPE 包括 `Admin_Login`、`Save_Config`、`Save_Custom_IPs`、`Init_Config`、`Get_SUB`、`Get_Best_SUB`。上游会在 30 分钟内合并某些重复非订阅访问；这不是每次按钮点击的完整审计轨迹。渲染日志时使用文本节点，不把 URL、UA 或备注拼进 HTML。

### 重置

`/admin/init` 只将 `config.json` 重建为默认值，**保留 `ADD.txt`、`cf.json`、`tg.json` 和既有日志**。重置后 TG 主开关恢复为 false，保存的 TG 凭证仍可能存在。按钮文案应为“重置主要配置”，不要声称删除全部数据。

### 订阅与辅助路由

| 路由 | 用法与行为 |
| --- | --- |
| `/sub?token=…` | Token 为有效主 HOST + UUID 的上游双 MD5 派生值；浏览器通常得到明文 mixed |
| `/sub?token=…&b64` | Base64 mixed 订阅；`base64` 同义 |
| `/sub?token=…&target=clash` | 指定转换目标；也可使用 `clash`、`sb`、`singbox`、`surge`、`quanx`、`loon` 便捷参数 |
| `/sub?token=…&sub=…` | 临时使用指定优选来源 |
| `/locations` | 要求登录；代理 Cloudflare 的 locations 数据 |
| `/robots.txt` | 返回 `Disallow: /` |
| `/<非默认 KEY>` | 快捷跳到带 Token 的订阅；路径本身应视为秘密 |
| `/version?uuid=…` | 特定 UUID 比较后返回数字 Version；校验不是完整 UUID 相等，不能作为管理员身份验证 |

订阅响应可能带 `Profile-Update-Interval`、`Profile-web-page-url`、`Subscription-Userinfo`。其中用量字段由请求次数映射，不能作为实际网络流量统计显示。无效订阅 Token 在上游可能落入兜底网页，而不是稳定返回 JSON 错误。

## 8. 新管理页验收清单

- 未登录的直达管理页会跳到登录；错误密码有可读错误。
- 成功登录后读取真实配置；保存后再次读取能看到有效值。
- 普通表单保存不会删除未显示的高级配置。
- Cloudflare / Telegram 凭证采用独立接口；掩码不会覆盖真值。
- UI 区分 `success:false`、HTTP 错误、HTML 重定向、加载中和空数据。
- 订阅复制的是当前域名与有效 Token 生成的 URL，含适当编码。
- 地址列表保存后重载仍一致；用户能理解随机列表与已保存列表的差别。
- 重置范围明确，使用 POST 和同源保护。
- 日志和代理检查结果按文本显示，敏感 URL / 账号默认脱敏。
- 退出后重新访问管理页需要登录。
- 浏览器验证之外，另行记录 Worker 运行时与真实代理客户端测试结果。

## 9. Brclio 本地版本差异

以下对应本仓库 `src/panel.js` 与 `src/worker.js` 的 2026-09-15 改造，区别于前文固定上游版本。

### 9.1 页面和鉴权

| 项目 | 本地行为 |
| --- | --- |
| 页面来源 | 管理、登录、配置提示和页面资源由构建后的 Worker 本地提供，不再运行时读取 `edt-pages.github.io` |
| 未登录请求 | `GET /admin` 为 302 `/login`；`/admin/…` JSON API 为 401 JSON |
| 错误密码 | 401 `{error:"密码不正确，请重新输入"}`；正确密码仍为 200 `{success:true}` |
| 会话格式 | `auth=过期时间.随机nonce.HMAC-SHA256签名`；签名包含请求 UA、KEY 与管理员密码相关密钥 |
| 会话过期 | 服务端校验 24 小时有效期，拒绝过期、签名损坏和不合理未来时间；不是仅靠 Cookie Max-Age |
| Cookie | HttpOnly、SameSite=Strict、生产 HTTPS 下 Secure；仅本地 loopback HTTP 预览允许不加 Secure |
| 退出 | `GET /logout` 清除浏览器 Cookie，并在 KV 中记录 nonce 撤销项，TTL 为会话剩余有效期 |
| 登录节流 | 同一 isolate 内同一 IP 多次错误尝试会得到 429；这是尽力而为的本地限制，不是全局限速服务 |
| 管理写入来源 | POST 校验 Origin 与 Sec-Fetch-Site；跨源写入为 403 |
| 管理响应 | `Cache-Control: no-store`、CSP、nosniff、no-referrer、禁止 frame 嵌入 |
| 新接口 | 登录后 `GET /admin/meta` 返回品牌、版本、上游版本和 KV 状态 |
| 未知管理接口 | 404 JSON，不再返回管理 HTML |

撤销记录使用 Cloudflare KV。真实全球部署时仍受 KV 的缓存和最终一致性影响，不能承诺所有边缘位置在同一毫秒完成撤销。密钥或管理员密码变化会使旧签名失效。此处没有实现多账户、角色权限或全局会话列表。

### 9.2 主配置与表单值

`POST /admin/config.json` 仍提交**完整有效配置快照**。本地版新增类型、枚举、范围及嵌套结构校验；无效配置为 400 JSON，保存前不写 KV。

- `传输协议` 只接受 `ws`、`grpc`、`xhttp`；`gRPC模式` 只接受 `gun`、`multi`。
- Shadowsocks 只接受实际实现的 `aes-128-gcm` 与 `aes-256-gcm`。
- 布尔字段必须是 JSON 的 `true` / `false`，不能传字符串 `"false"`。
- 随机数量必须是 1–100 的整数，端口必须是整数 -1 或 1–65535；更新间隔必须是大于零的数值。表单须先 `Number(value)` 再提交。
- HOSTS 保留上游的 `*` 随机字符能力，例如 `*.example.com`、`edge-*.example.com`；不接受带协议或端口的内容。
- `反代.路径模板.PROXYIP`、每个支持代理的 `全局` / `标准` 模板必须为字符串，避免保存后路径生成抛错。
- 选择外部优选来源时，`优选订阅生成.SUB` 必须为非空地址字符串。
- SUBAPI、SUBCONFIG 必须是 HTTP 或 HTTPS URL；未知扩展字段仍保留。
- PATH 长度最多 2048 字符，配置 JSON 长度最多 256 KiB。

读取时以默认配置为基础递归合并已保存值，保留未知扩展字段，并排除危险原型键。配置变量已改为请求局部，不再共享模块级 `config_JSON`。

保存时会剥离 `CF`、`LINK`、`完整节点路径`、`加载时间`、`init`、订阅 TOKEN 等运行时字段；TG 在主配置中只保存 `启用`。真实 Cloudflare / Telegram 凭证由专用接口负责，界面中的掩码不会被主配置保存覆盖。

### 9.3 专用凭证与用量接口

凭证接口新增**部分更新**：省略字段或提交空字符串时保留已存值；`init:true` 显式清空该服务凭证。包含 `***` 的掩码、非字符串或超长字段会得到 400。更换 Cloudflare 认证方式时清除旧方式的字段；UsageAPI 要求 HTTPS。

本地用量刷新流程：

```text
POST /admin/getCloudflareUsage ← 可先验证未保存输入，不写 KV
POST /admin/cf.json  ← 在 JSON body 中保存一组凭证
GET  /admin/getCloudflareUsage  ← 读取 KV 中已保存的凭证查询
```

**与上游不兼容的安全改动**：`/admin/getCloudflareUsage` 不再读取 query 中的 Email、GlobalAPIKey、AccountID、APIToken 或 UsageAPI。URL 出现这些字段时返回 400，避免密钥进入地址栏、历史记录和访问 URL。新面板无需在刷新请求中再次发送凭证。

POST 验证请求示例：`{"mode":"token","AccountID":"账户ID","APIToken":"真实Token"}`。`mode` 为 `token`、`key` 或 `api`，对应 AccountID/APIToken、Email/GlobalAPIKey、UsageAPI。仅选中方式的字段参与查询；留空字段只在已保存方式相同时复用，不跨认证方式混合。验证成功/失败均不写 KV，无效输入为400；查询失败仍可能是200 + success:false。

`config.CF.UsageAPI` 仅返回固定 `********` 标记，不回显可能包含密钥的完整 URL。GraphQL 缺失数据集或无效计数视为失败；有效的两个空数组表示真实零请求。

自定义 UsageAPI 必须返回如下结构，所有计数必须是非负安全整数，max 必须大于零，total 必须等于 pages + workers：

```json
{ "success": true, "pages": 12, "workers": 34, "total": 46, "max": 100000 }
```

响应里的其他字段会被丢弃。HTTP 失败、超时、非法 JSON、null、数组或无效计数统一成为：

```json
{ "success": false, "pages": 0, "workers": 0, "total": 0, "max": 100000 }
```

这是“未获取到用量”，不是“确认用量为零”。每次用量网络请求有 4 秒超时；使用邮箱 / Global Key 时，账户查询与 GraphQL 是两次顺序请求。GraphQL 仍沿用上游固定的 max 值，实际套餐额度不由该接口自动识别。

### 9.4 日志、重置与外站转发

- `GET /admin/ADD.txt` 现在只返回 KV 已保存的原文；未保存时返回空字符串。读取地址编辑器不再生成随机候选、不初始化主配置，也不会触发 CIDR 或用量网络请求。界面中的“已同步”只表示与真实存储一致。
- `/sub` 保留随机候选生成逻辑。CIDR 来源请求设有 4 秒超时，只接受 IPv4 地址有效且前缀为 0–32 的 CIDR；网络失败、空响应或全部行无效时回退到 `104.16.0.0/13`。候选地址不会自动写入 ADD.txt。
- `/admin/init` 仅允许 POST，GET 返回 405。清理范围仍为主配置，地址库与专用凭证保留。
- 新日志只记录 `/admin`、`/sub` 等路由类别，移除 query 与可能藏有凭证的任意路径；Telegram 通知使用同一脱敏 URL。历史日志不会被自动重写。
- 伪装页转发不携带浏览器的 Cookie 或 Authorization。
- TCP 连接器新增官方 `cloudflare:sockets` 的 connect 适配；保留连接与协议处理代码。TLS、外部转换服务和全球 KV 行为仍有 [architecture.md](architecture.md) 中列出的验证边界。

### 9.5 对应验证

| 测试文件 | 验证内容 |
| --- | --- |
| `tests/panel.test.mjs` | 构建后 Worker 的登录、主配置保存、凭证保存、重置和退出流程 |
| `tests/config-validation.test.mjs` | 通配 HOSTS 可保存；损坏路径模板、错误字段类型和缺失来源被拒绝，原配置仍可读取 |
| `tests/address-list.test.mjs` | 地址编辑器空值 / 原文无出站读取；订阅生成过滤非法 CIDR，并为失败数据使用固定 fallback |
| `tests/tunnel-protocol.test.mjs` | 真实 workerd WebSocket → 测试拥有的本地 TCP 回显；错误 UUID / 命令拒绝，连续 64 KiB 数据保持一致 |
| `tests/usage-api.test.mjs` | 用受控出站 HTTP fixture 检验存储凭证、URL 拒绝、响应类型校验、null 不破坏订阅、4 秒超时 |

协议测试不依赖任何公共代理。用量测试使用受控 HTTP 响应，不使用真实 Cloudflare 账户密钥，也不宣称生产账户查询已验证。执行结果应以当次 `npm test` 输出为准。
## 10. 本地管理工具接口（2026-09-15）

本节描述新增的本地工具和兼容入口，区别于前文的固定上游 API。入口由 `src/worker.js` 鉴权，再调用 `src/admin-tools.js`；工具路径保留大小写，例如 `/admin/testSubAPI`。新增接口不会在模块加载时主动出站；由管理页的明确操作调用。

### 10.1 共同约定

- 所有 `/admin/*` 工具要求有效会话；未登录返回 HTTP 401 JSON。写入和检测 POST 还要求同源请求，来源不符返回 HTTP 403。
- 工具 POST 使用 `Content-Type: application/json`。`admin-tools.js` 的 JSON 对象上限为 8 KiB；不接受数组、null 或畸形 JSON。
- 一般成功响应包含 `success:true`；失败为 `{success:false,error:"用户可读说明"}`。参数错误通常为 400、错误方法为 405、远端 HTTP / 格式失败为 502、远端超时为 504。旧兼容接口的错误形状见各小节。
- 工具响应设置 `Cache-Control: no-store`；出站请求不转发浏览器 Cookie / Authorization。远端错误文本不会直接成为 Telegram 错误提示。
- 常规工具请求在 6 秒后超时；一般响应大小上限为 2 MiB。ProxyIP 大目录单独允许 15 秒和 20 MiB。单次 Telegram 检测包含两次顺序请求，因此整段最长约 12 秒。
- 新接口失败不自动切换第三方服务，也不启动重试循环。外部目录和服务仍可能因为源更新、可用性或 Cloudflare 网络条件失败。

### 10.2 GET /admin/catalog?kind=…

从固定来源读取目录；`kind` 必须为以下之一，不能通过 `url` 参数改写来源。响应保持第三方目录的原始 JSON 结构。

| kind | 固定来源 | `data` 结构 |
| --- | --- | --- |
| `subapi` | `https://raw.githubusercontent.com/cmliu/cmliu/main/SUBAPI.json` | `[{label,value}]` |
| `subconfig` | `https://raw.githubusercontent.com/cmliu/cmliu/main/SUBCONFIG.json` | `[{label,options:[{label,value}]}]` |
| `paths` | `https://raw.githubusercontent.com/cmliu/cmliu/main/json/edt-path-config.json` | `[{项目名,提示消息,路径模板:{…}}]` |
| `localtools` | `https://raw.githubusercontent.com/cmliu/cmliu/refs/heads/main/json/best-cf-tools.json` | `{projects:[{name,author,description,platforms:[],ui:[],stars,github,…}]}` |
| `socks5` | `https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/socks5.json` | 代理对象数组 |
| `http` | 同一目录的 `http.json` | 代理对象数组 |
| `https` | 同一目录的 `https.json` | 代理对象数组 |
| `proxyip` | `https://zip.cm.edu.kg.cmliussss.net/all.json` | `{generated_at,list,data:[{ip,port:[…],meta:{…}}]}` |
| `version` | `https://raw.githubusercontent.com/cmliu/edgetunnel/main/_worker.js` | `{version:"2026-09-04 16:24:13"}`；仅提取源码 `const Version`，不返回上游源码 |

成功示例：

```json
{"success":true,"kind":"subapi","source":"https://raw.githubusercontent.com/cmliu/cmliu/main/SUBAPI.json","data":[{"label":"示例","value":"https://converter.example"}]}
```

公共代理对象通常含 `proxy`（可能包括公开代理账号）、`protocol`、`ip`、数值 `port`、`country`、`city`、`asn`、`asOrganization`、`latitude` 和 `longitude`。经纬度可为数字或字符串，调用方需要归一化；它们不是当前用户保存的凭据。ProxyIP 的 `port` 是端口数组，地区信息在 `meta` 内，不能按普通代理数组直接读取。

`localtools` 是第三方工具介绍目录，`ui` 可含 `webui`、`gui`、`cli`。页面只在点击“加载”时请求，随后在本地筛选并打开项目链接；该接口不会安装、执行工具或启动测速。目录仍适用一般 6 秒 / 2 MiB 限制。

### 10.3 POST /admin/testSubAPI

请求：`{"url":"https://converter.example"}`。

- URL 最长 2,048 字符；接受 HTTP / HTTPS，未给协议默认 HTTPS；拒绝 URL 用户名和密码。
- 测试使用规范化 origin 的 `/version`，例如输入 `https://converter.example/sub?target=clash` 时测试 `https://converter.example/version`。
- 响应必须包含 `subconverter`（忽略大小写）；版本响应上限 8 KiB。
- 成功返回 `{"success":true,"url":"https://converter.example","version":"subconverter v0.9.0"}`。页面应使用返回的 `url` 作为转换后端保存值，不能把完整 `/sub?...` 再拼接 `/sub`。
- 该接口只验证，不写 `config.json`。应用字段后仍需保存主配置。

### 10.4 POST /admin/testTelegram

请求必须包含 `"sendMessage":true`；没有该明确字段返回400，不发送消息。默认 `{"sendMessage":true}` 使用已保存凭据。

默认从 `KV/tg.json` 读取已保存的 `BotToken` 和 `ChatID`，忽略请求体另传的凭据。显式设置 `useInput:true` 时，可在body传 BotToken/ChatID 验证未保存输入，空字段沿用已保存值；该验证不写KV。先向官方 `https://api.telegram.org/bot<TOKEN>/getMe` 发起 POST，确认有效机器人后再向 `sendMessage` POST 一条 Brclio 配置验证消息。Telegram 请求中的 `chat_id` 取所选验证凭据。

成功：`{"success":true,"sent":true,"username":"example_bot","message":"Telegram 测试消息已发送"}`，`username` 可省略。结果不返回 Bot Token、Chat ID、完整 Telegram 响应或远端错误描述。机器人验证失败时不发送消息。

该操作不会设置 `TG.启用`；启用后续日志通知仍需单独修改并保存主配置。测试使用受控本地 HTTP fixtures，不代表已向真实聊天投递。

### 10.5 POST /admin/check

请求：`{"type":"proxyip","address":"[2001:db8::1]:443"}`。

| type | 行为 | 限制 / 响应 |
| --- | --- | --- |
| `proxyip` | 固定调用 `https://api.090227.xyz/check?proxyip=<编码地址>` | 地址最长 512 字符，无账号、空白或路径；响应上限 64 KiB / 6 秒 |
| `socks5` / `http` / `https` / `turn` / `sstp` | 主 Worker 归一 JSON 参数，再进入原版 TCP / TLS 检查函数 | `address` 为非空字符串，最长 4,096 字符；原检查返回形状保留 |

ProxyIP 成功示例：

```json
{"success":true,"ip":"192.0.2.1","loc":"US","responseTime":124,"supports_ipv4":true,"supports_ipv6":true}
```

`ip`、`loc`、`responseTime` 只在来源提供相应有效值时返回；不能把缺失字段解释为已确认。失败可为 HTTP 200 + `success:false`，管理页必须同时检查业务状态。原版 GET `/admin/check?socks5=…` 等继续兼容，新页面使用 POST，避免账号密码进入浏览器 URL。

### 10.6 POST /admin/ipDetail

请求：`{"ip":"192.0.2.1"}` 或 IPv6 字面量，最长 45 字符。域名、URL、端口、CIDR 和无效 IP 返回 400。

固定请求 `https://api.ipapi.is/?q=<IP>`，6 秒超时、1 MiB 响应上限；成功为：

```json
{"success":true,"source":"https://api.ipapi.is/","data":{"ip":"192.0.2.1","location":{"country_code":"US"},"is_proxy":false}}
```

`data` 保留来源提供的 JSON，供页面显示地区、ASN、公司类型、标识及地理位置。信息是第三方数据库的判断，不代表本项目自行测得风险、身份或精确位置；没有备用来源自动切换。

### 10.7 POST /admin/getADDAPI

新增 POST 与原 GET 共享解析逻辑：`{"url":"https://addresses.example/list?port=8443&proxyip=true","port":8443}`。

- JSON 对象读取上限 16 KiB；`url` 要求 HTTP(S)。来源 URL 自己的 `port` / `proxyip` 参数仍按上游解析语义处理；外层 `port` 是默认端口。
- 成功形状仍为 `{"success":true,"data":["192.0.2.1:8443#示例"]}`。结果可能为空，页面应明确提示“未返回可用地址”。
- 接口只验证来源并返回结果，不追加或保存 `ADD.txt`。追加动态来源 URL 与追加静态结果由页面两个独立按钮完成。
- 新页面只在明确点击验证时请求；原 GET 兼容入口仍存在。

### 10.8 GET /admin/network

返回当前已认证请求的边缘元数据：`{ip,country,city,colo,asn}`，不带 `success` 包装。`asn` 未提供时为 null，地区字段未提供时为空串。

该结果描述浏览器访问**当前 Worker**时的入口，不是任意其他 Cloudflare 网站的出口，也不是本地运行中模拟 `request.cf` 的真实地理证明。页面只在点击网络信息查询后读取。

### 10.9 当前部署源码与 Pages ZIP

- `GET /admin/download/worker.js`：返回可独立部署的当前 Brclio Worker ESM 源码，`Content-Type: text/javascript`，附件名 `_worker.js`。
- `GET /admin/download/pages.zip`：返回由当前源码构建的 Pages ZIP，含 `_worker.js`、`_routes.json`、入口提示 HTML 以及许可证和第三方声明，`Content-Type: application/zip`。
- 这两个接口需要会话，不拉取另一个版本的上游源码；使用构建时源模板重建部署程序，不把运行时 `ADMIN`、KV、Bot Token 或 Cloudflare 密钥写入下载文件。
- 下载本身不升级或部署。安装到 Cloudflare 后仍需绑定 KV、配置环境变量、重新部署并进行客户端验收。

### 10.10 EXPAND 与手动检测边界

`订阅转换配置.EXPAND` 已成为布尔字段，默认 false；生成转换 URL 时带 `expand=true|false`。固定上游 Worker 未包含它，但审计到的远端管理页已有此选项，本地补全了实际参数传递。

用户要求的测速改变是：打开页面、展开工具、切换页面、选择地区或修改输入不启动检测；点击明确按钮后仅执行有限任务。停止、离页及页面隐藏终止测速；结果完成后不保留重复出站的循环。UTC 配额倒计时仅更新本地文字。

此前安全改动继续保留：24 小时签名会话、退出撤销、同源 POST、重置不接受 GET、凭据从 KV 读取、日志 URL 脱敏、配置对象校验和空 ADD 的真实持久化视图。它们属于接口安全边界，不应被“功能对齐”描述掩盖。

## 11. 2026-09-17 进阶配置补齐

- `GET /admin/upstream-changelog`：登录后、手动调用，返回 `{success:true, source, content}`。只读取固定上游 CHANGELOG URL；不接收自定义来源，限 1 MiB、6 秒超时，不转发浏览器凭据。界面按纯文本显示，不执行日志中的 HTML。
- 配置保存新增组合校验：SS 必须使用 ws；XUDP 需要 UDP；SS / gRPC 不能启用 0-RTT；无 TLS 的 SS 不能使用 ECH 或 TLS 分片。无效组合返回 400，不修改已保存配置。
- VLESS / Trojan 的 `LINK` 增加 ALPN，与通用订阅中的参数保持一致。
- 隧道请求读取已保存的 `反代.SOCKS5.白名单` 作为本请求路由快照；显式空列表不会回填内置默认，`GO2SOCKS5` 规则始终附加。仅 `*` 作为通配。读取过程不调用用量查询、通知或管理配置初始化。
