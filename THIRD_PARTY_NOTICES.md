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

## 字体

本地中文标题字体 Noto Serif SC 来自 [Google Fonts / Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc)，采用 SIL Open Font License 1.1。仅包含界面所需字符的子集，许可全文见 [licenses/NotoSerifSC-OFL.txt](licenses/NotoSerifSC-OFL.txt)，字符、大小及哈希记录见 [docs/font-provenance.json](docs/font-provenance.json)。字体保留自身 OFL 许可。正文使用系统字体栈，不请求远程字体。
