# 指定视频：观看与核对记录

本文件记录 README 文字教程的实际视频来源、观看方式与纠错依据，便于维护者回到原片复核。正文为重新组织的技术笔记，不是逐字字幕转载。

## 视频信息

| 项目 | 核对结果 |
| --- | --- |
| 视频 | [2026 最强 Cloudflare 免费VPN自建！无限复活、永久可用｜全球高速节点｜秒开4K8K](https://www.youtube.com/watch?v=chcFg878840) |
| 作者 | [零度解说](https://www.youtube.com/@lingdujieshuo) |
| 视频 ID | `chcFg878840` |
| 发布日期 | 2026-04-02，来自 YouTube 视频元数据 |
| 时长 | 864 秒，约 14 分 24 秒 |
| 作者资料页 | [零度博客：原视频配套资料](https://www.freedidi.com/23618.html)，由视频说明栏链接确认 |
| 本次核对日期 | 2026-09-15 |

标题中的速度、永久可用等说法属于原作者的宣传用语，不是本项目的承诺。

## 实际观看方式

1. 请求 YouTube 原始 watch 页面，读取播放器元数据；播放器状态为 `OK`，取得标题、作者、发布日期、时长、字幕轨道及 storyboard 索引。
2. 使用 `yt-dlp` 下载 YouTube 提供的 `zh-Hant`、`zh-TW` 字幕，完整阅读从 `00:00.040` 到结尾的字幕内容。两条轨道内容基本相同。
3. 下载并查看 YouTube 提供的全部 20 张 storyboard 拼图，共 174 个有效预览画面，以约 5 秒间隔覆盖全片。
4. 进一步取得原视频 1080p 图像流，用 FFmpeg 提取关键时间点的高清帧，逐项校对变量、绑定、域名、订阅类型和客户端操作。

因此，教程依据包括完整字幕与实际视频画面；并非仅凭标题、博客或上游 README 推测。此次没有以连续实时播放、逐秒人工听音的方式审阅音轨。

早期访问中，网页搜索工具对 YouTube 返回限流，内嵌浏览器打开超时，直接字幕 URL 曾返回空响应；随后 `yt-dlp` 成功取得字幕和视频。博客正文的浏览请求返回 403，未将其视为已完整阅读的来源。

## 按时间核对的实际内容

以下时间为根据字幕与画面整理的段落起点，原视频没有提供章节标记。

| 原片位置 | 实际演示 | 文字教程的处理 |
| --- | --- | --- |
| [00:00](https://www.youtube.com/watch?v=chcFg878840&t=0s) | 展示节点、测速、视频播放及目标网站使用效果。 | 作为作者演示背景，不把结果写成当前保证。 |
| [00:52](https://www.youtube.com/watch?v=chcFg878840&t=52s) | 打开配套博客取得资料。 | 保留作者链接；本项目改用自己的构建产物。 |
| [01:01](https://www.youtube.com/watch?v=chcFg878840&t=61s) | 注册 DNSHE 账号，邮件验证，进入免费域名管理；选择域名前缀和后缀。 | 有可用域名的读者直接复用；第三方额度和期限按实际页面核对。 |
| [03:00](https://www.youtube.com/watch?v=chcFg878840&t=180s) | 演示域名注册成功，查看期限与续期说明。 | 说明这是 2026-04-02 的画面，不将其称为无需维护的永久域名。 |
| [03:25](https://www.youtube.com/watch?v=chcFg878840&t=205s) | 注册或登录 Cloudflare，把域名加入账号，选择 Free 计划。 | 使用读者自己的账号与域名。 |
| [04:47](https://www.youtube.com/watch?v=chcFg878840&t=287s) | 将 Cloudflare 分配的两条名称服务器填回域名服务商，检查域名状态。 | 每个账号的 NS 不同；保留已有业务所需的 DNS 记录。 |
| [05:59](https://www.youtube.com/watch?v=chcFg878840&t=359s) | 在存储和数据库中创建 Workers KV 命名空间。 | 区分可自定的空间名称与必须为 `KV` 的绑定名称。 |
| [06:26](https://www.youtube.com/watch?v=chcFg878840&t=386s) | Workers & Pages → 创建应用 → Pages → 拖放文件，建立项目并首次部署。 | 本项目先构建，再上传 `dist/brclio-edge-pages.zip`。 |
| [07:41](https://www.youtube.com/watch?v=chcFg878840&t=461s) | 在生产环境新增 `ADMIN`，值作为后台登录密码。 | 使用独立强密码并存为机密，修正字幕的拼写错误。 |
| [08:04](https://www.youtube.com/watch?v=chcFg878840&t=484s) | 新增 KV 绑定，变量名为 `KV`，选择先前的命名空间。 | 明确 `KV` 必须大写，且应绑定到生产环境。 |
| [08:32](https://www.youtube.com/watch?v=chcFg878840&t=512s) | 为 Pages 添加自定义域，查看并添加 CNAME，激活域名。 | 补充当前官方行为：托管在同账号的域名可能自动添加 CNAME，不必重复手工建立。 |
| [09:58](https://www.youtube.com/watch?v=chcFg878840&t=598s) | 再次上传同一文件并保存部署。 | 保留此关键步骤：新变量和绑定需随新部署生效。 |
| [10:21](https://www.youtube.com/watch?v=chcFg878840&t=621s) | 打开自定义域，在路径后加 `/admin`，跳到登录页后输入管理密码。 | 对应本项目 Brclio 登录页和概览。 |
| [10:40](https://www.youtube.com/watch?v=chcFg878840&t=640s) | 查看单节点链接、自适应订阅，设置优选模式、数量和端口并保存。 | 对应「订阅管理」；说明节点链接和订阅地址的区别。 |
| [11:25](https://www.youtube.com/watch?v=chcFg878840&t=685s) | v2rayN 从剪贴板导入链接，再更新订阅分组，生成节点列表。 | 保留导入和更新两个独立动作，提醒变更后重新更新订阅。 |
| [11:45](https://www.youtube.com/watch?v=chcFg878840&t=705s) | 测试节点、设为活动配置，再切换客户端代理模式。 | 通过客户端实际连接验收，不把后台加载成功当作连通成功。 |
| [12:01](https://www.youtube.com/watch?v=chcFg878840&t=721s) | 查看出口 IP，运行测速、播放视频、访问 ChatGPT 和 Gemini。 | 记录演示类型，不承诺任何地区、网站或速度。 |
| [13:02](https://www.youtube.com/watch?v=chcFg878840&t=782s) | 展开高级设置，调整 ProxyIP，选择区域，查看订阅转换后端与详细配置。 | 对应「路由与代理」「订阅转换选项」「原始配置 JSON」。 |
| [14:06](https://www.youtube.com/watch?v=chcFg878840&t=846s) | 提醒资料位于说明栏与博客，视频结束。 | 保留来源署名和回看入口。 |

## 高清画面纠错

| 时间点 | 高清帧确认 | 必须避免的错误 |
| --- | --- | --- |
| 02:31 / 03:07 | 域名平台为 DNSHE；原片涉及 `us.ci`、`ccwu.cc`，实际注册示例期限约十年。 | 不把第三方当时的注册额度、可选后缀、续期政策当作当前不变承诺。 |
| 07:29 | 上传列表出现 `edgetunnel-main.zip`；这是原片使用的上游文件结构。 | 本项目已拆分源码并增加构建流程，GitHub 的源码 ZIP 不能直接当部署包。 |
| 07:56 | 右侧变量名称清楚显示 `ADMIN`；底部说明下一次部署才生效。 | 字幕中的 `ADMN` 少了 `I`。 |
| 08:20 | 变量名是 `KV`；下方命名空间选项包含作者刚创建的空间。 | 绑定名和空间显示名不能混为一谈。 |
| 09:29 | CNAME 的目标为作者 Pages 项目的 `*.pages.dev` 地址。 | 读者要复制自己项目给出的名称与目标。 |
| 10:30 | 地址栏是 `/login`，为进入 `/admin` 后跳转的登录页。 | 后台入口仍使用 `/admin`，不应按误识别字幕写成 `/admn`。 |
| 10:47 | 第一栏是 `vless://` 单节点链接，第二栏是 `https://…/sub?token=…` 自适应订阅。 | 第二栏不是另一种节点协议；字幕对「自适应」识别不准。 |
| 11:09 | 原片将随机优选数量改为 `50`，端口菜单包括随机和多个 TLS 端口。 | `50` 是作者示例，不是安装必填值。 |
| 11:37 / 11:57 | 客户端标题为 v2rayN V7.16.8，演示订阅更新和设为活动节点。 | 新版客户端菜单名称可能变化。 |
| 13:35 / 13:54 | 手动 ProxyIP 与订阅转换后端均为单独配置项。 | 不能把 ProxyIP 域名、节点入口域名和订阅后端混用。 |

## 与当前官方文档的交叉核对

- [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)：控制台可上传 ZIP 或目录，支持 `_worker.js`；Wrangler 上传目录。拖放项目与 Git 集成的选择会影响后续发布方式。
- [Pages 绑定与机密](https://developers.cloudflare.com/pages/functions/bindings/)：生产与预览环境独立；KV 绑定完成后重新部署。
- [Pages 自定义域](https://developers.cloudflare.com/pages/configuration/custom-domains/)：先在 Pages 关联自定义域，再处理 DNS；Cloudflare 托管域可自动生成 CNAME；只添加 CNAME 而未关联项目可能返回 522。
- [v2rayN 官方 UI 说明](https://github.com/2dust/v2rayN/wiki/Description-of-some-ui)：订阅来源与更新逻辑，以实际客户端版本为准。

## 复核材料与再分发范围

本次研究原始文件仅保留在研究环境临时目录，未收入开源包：

```text
/tmp/brclio-tutorial-video/chcFg878840.info.json
/tmp/brclio-tutorial-video/chcFg878840.zh-Hant.vtt
/tmp/brclio-tutorial-video/chcFg878840.zh-TW.vtt
/tmp/brclio-tutorial-video/source-1080p.mp4
/tmp/brclio-video-frames/storyboard-00.jpg … storyboard-19.jpg
/tmp/brclio-video-frames/highres/
```

`zh-Hant` 字幕文件为 33,056 字节，SHA-256：

```text
4da30d62b674af1ee75f5da6d949aff1b9a04c5596124df21b48c90eb0acc43b
```

维护者可用当前 `yt-dlp` 重新获取公开字幕进行复核：

```sh
yt-dlp --skip-download --write-subs --sub-langs 'zh-Hant,zh-TW' \
  --sub-format vtt --write-info-json \
  'https://www.youtube.com/watch?v=chcFg878840'
```

字幕、视频、作者头像及其截图的权利属于原作者或相关权利人。仓库只发布独立编写的文字教程和本项目自己的界面截图；本项目代码许可证不替原视频授予再分发许可。
