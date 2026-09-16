# 教程源文件

读者使用 [`../tutorial.html`](../tutorial.html)：下载后可直接打开的单文件手册。此目录供维护者编辑。

## 修改与构建

- `index.html`：章节、中文操作说明、图片占位和许可入口。
- `styles.css`：独立编写的 Brclio 教程样式、响应式与打印布局。
- `app.js`：目录、进度勾选、复制、本地 UUID v4 生成、原图查看和问题搜索。无网络请求。
- `../tutorial-assets/original/`：实际运行界面的原始截图。
- `../../scripts/build-tutorial.mjs`：将原图、字体、样式和脚本嵌入单文件。

在项目根目录运行：

```sh
npm run build:tutorial
```

构建会核对每张 PNG 的原始 SHA-256 与宽高、保留脚本原始内容并检查语法，然后生成 `docs/tutorial.html` 与 `docs/tutorial-assets/build-manifest.json`。普通应用构建不包含教程，避免把图文材料打进 Worker 部署包。

源文件中的 `@@FIGURE:文件名:说明@@` 对应一张原图；`@@IMAGE:文件名@@` 用于封面复用。文件名不包含 `.png`，从 `local-captures.json` 读取尺寸与哈希。图片在浏览器内按 CSS 适配显示，下载和 100% 模式使用同一份原始字节。

## 更新截图

在本项目本地运行环境打开实际页面，使用应用自身的密码遮盖状态，先等待字体与界面稳定，再直接保存完整视口 PNG。不要裁剪、缩放、重新编码或添加遮挡图层；通过页面控件在拍摄前隐藏凭据。

替换原图时同步更新 `../tutorial-assets/local-captures.json` 的 URL、时间、视口、滚动位置、尺寸、字节数和 SHA-256，并核对图注是否描述了截图中可见的操作。构建会拒绝哈希不符的图片。

## 字体与许可

中文衬线标题使用官方 Noto Serif SC 700 的本地子集，完整 OFL 保留在 HTML 与字体文件内。来源、固定提交和字符记录见 `../tutorial-assets/font-provenance.json`。正文为系统字体。

新增标题字符后，使用 `../../scripts/subset-tutorial-font.py` 从记录的官方完整字体重建子集，再运行教程构建。重建工具需要 Python、fontTools 和 Brotli；普通阅读或构建 HTML 不需要安装这些字体工具。

本教程的布局、交互与正文独立编写，以 GPL-2.0-only 提供；采用 Brclio 品牌配色与中文衬线排版原则。未把带非商业限制的设计系统模板或第三方图片复制进发行文件。上游程序署名与字体许可保持独立清晰。

## 验证

参见 [`../tutorial-validation.md`](../tutorial-validation.md)。修改后至少检查桌面、390px 手机与最窄布局、导航、复制、进度、问题搜索、原图查看与下载；从 `file://` 离线打开，确认没有运行时外部资源请求。实际下载 PNG 的 SHA-256 应等于原文件。
