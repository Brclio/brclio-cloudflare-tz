# 来源与开源许可

## 隧道内核

- 上游：[cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)
- 固定基线：`448a83ced00a43c1d892d5ecbed86a26ea9eeaff`
- 上游版本字符串：`2026-09-04 16:24:13`
- 来源文件：`_worker.js` → 本项目 `src/worker.js`
- 许可证：GNU GPL version 2，完整正文见 [LICENSE](LICENSE)。
- 2026-09-15，Brclio 修改：本地管理页面、会话与路由保护、配置校验、本地构建与测试；传输实现来自上游。文件头标明修改。

保留上游鸣谢：zizifn/edgetunnel、3Kmfi6HP/EDtunnel、SHIJS1999/cloudflare-worker-vless-ip、Stanley-baby、ACL4SSR、股神、Workers/Pages Metrics、白嫖哥、Mingyu、ToiCF/CF-Workers-HTTPS、ToiCF/CF-Workers-TURN、ToiCF/CF-Workers-SoftEther、eooce、Sukka、zhangtaile、1345695、ToiCF/GrainTCP、xream。完整关联链接见[固定版本上游 README](https://github.com/cmliu/edgetunnel/blob/448a83ced00a43c1d892d5ecbed86a26ea9eeaff/README.md)。

## Brclio 新增实现

Copyright (C) 2026 Brclio。新增程序、界面和本仓库自编文档以 GPL-2.0-only 提供，允许使用、修改、再分发及商业使用；分发修改版本时遵守 GPL 的源码和许可要求。软件不提供担保。

界面视觉方向参考 [Brclio Design System](https://github.com/Brclio/brclio-design-system) 的品牌配色与布局原则。设计系统及其上游模板本身采用 CC BY-NC-SA 4.0，**未重新许可，也未作为本项目源码或资源打包**。本项目独立编写布局、样式、交互、文字标志和节点图案，避免引入该非商业限制。品牌名称不表示任何第三方分发得到 Brclio 官方背书。

## 教程来源

用户指定视频：[YouTube · chcFg878840](https://www.youtube.com/watch?v=chcFg878840)。视频及作者素材版权归原作者；本项目不分发视频、音轨或完整字幕。核验范围与来源见 [docs/video-research.md](docs/video-research.md)。Cloudflare 文档只作为功能与操作步骤的参考，各自版权归权利人。

图文教程另使用用户提供的 28 张 Cloudflare 操作截图，仅用于说明相应界面的操作步骤。Cloudflare 界面、名称及标志的权利归相应权利人；本项目的代码许可不改变这些权利。发布素材保留截图的原生像素比例，按步骤裁剪、移除账号和凭据并增加教学标注；原始凭据截图不随仓库分发。来源尺寸、裁剪、标注、遮盖区域及 PNG 校验值见 [Cloudflare 截图清单](docs/tutorial-assets/cloudflare-captures.json)。

## 字体

本地中文标题字体 Noto Serif SC 来自 [Google Fonts / Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc)，采用 SIL Open Font License 1.1。仅包含界面所需字符的子集，许可全文见 [licenses/NotoSerifSC-OFL.txt](licenses/NotoSerifSC-OFL.txt)，字符、大小及哈希记录见 [docs/font-provenance.json](docs/font-provenance.json)。字体保留自身 OFL 许可。正文使用系统字体栈，不请求远程字体。

独立教程使用同一官方字体的 700 字重子集，来源提交、字符覆盖与校验记录见 [教程字体来源](docs/tutorial-assets/font-provenance.json)。OFL 全文同时保留在教程 HTML 和字体内。教程中的 9 张管理界面截图由本项目本地运行拍摄，未分发第三方视频截图；原始 PNG 与校验记录位于 [tutorial-assets](docs/tutorial-assets/local-captures.json)。

## 二维码与手动测速

- 本地二维码使用 Kazuhiko Arase 的 [qrcode-generator 2.0.4](https://github.com/kazuhikoarase/qrcode-generator)，采用 MIT 许可，正文见 [licenses/qrcode-generator-MIT.txt](licenses/qrcode-generator-MIT.txt)。本项目启用其 UTF-8 编码，二维码数据不上传外部服务。
- 测速及工具界面独立编写；功能对照参考 [EDT-Pages 管理页](https://edt-pages.github.io/admin)。BestCF 探测服务、公开代理目录及网络信息接口属于原版使用的第三方服务，仅在用户点击相应操作后请求；未复制该页面的界面模板、图片、混淆或 Snippets 内核。

## ZIP 打包

构建脚本与管理页部署包下载使用 Arjun Barrett 的 [fflate 0.8.3](https://github.com/101arrowz/fflate)，采用 MIT 许可。其 ZIP 实现会捆绑到独立 Worker 中；完整原始许可见 [licenses/fflate-MIT.txt](licenses/fflate-MIT.txt)，并随 Worker 的本地许可资源及两种 Pages ZIP 一同分发。
