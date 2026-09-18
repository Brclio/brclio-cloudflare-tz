# 教程源文件

读者使用两篇独立 HTML：[部署与使用](../tutorial.html)、[GitHub 自动部署与同步](../github-deploy.html)。每篇内嵌自己的图片、字体、样式和脚本，下载后可直接离线打开。两篇放在同一文件夹时，文内链接可互相跳转。GitHub 文件页的 **Download raw file** 可以下载 HTML；Release 历史附件不会随仓库文件自动更新。

## 修改与构建

- `index.html`：手动上传 Pages、配置、域名与日常使用。
- `github.html`：Fork、Pages Git 集成、更新、同步、迁移与回滚。
- `styles.css`、`app.js`：共享排版和交互。两篇使用独立进度记录。
- `../tutorial-assets/original/`：9 张本地管理后台原始截图，保持已有字节。
- `../tutorial-assets/cloudflare/`：28 张用户提供实操截图制作的教学 PNG，已裁切、遮挡账号和凭据、添加编号与箭头。
- `../tutorial-assets/github/`：12 张 Git 集成实操教学 PNG，来自 2026-09-18 提供的 5120×2704 截图；保留原像素裁剪、编号箭头及中文说明，ADMIN 与 UUID 已遮盖。
- `../../scripts/build-tutorial.mjs`：生成两篇可离线阅读的 HTML，以及各自构建清单。

```sh
npm run build:tutorial
```

构建会核对所有 PNG 的 SHA-256 和宽高，检查内嵌脚本语法与字节一致性，拒绝未替换占位符和外部运行资源。每篇只嵌入自己使用的图片。普通应用构建不包含教程，避免把教学材料打进 Worker。

`@@FIGURE:文件名:说明@@` 插入可放大的图片，`@@IMAGE:文件名@@` 用于封面。文件名不带 `.png`；后台图从 `local-captures.json` 读取，Cloudflare 图从 `cloudflare-captures.json` 读取。查看器支持适应窗口、100% 像素尺寸、前后切图、键盘切图、Esc 关闭与下载。100% 模式保留方向键滚动。

## 配图维护

新提供的 Cloudflare 操作截图按用户要求裁切、标注。教学组件使用真实截图作为底图，在原始像素比例下保留操作区域；中文编号说明与箭头由浏览器绘制，保持 UI 文案原貌。多数来源为 5120×2704，DNS 弹窗来源为 3456×1924。

账号、ADMIN、UUID 等在教学 PNG 中不透明遮挡或由裁切彻底移除。**含凭据的原始截图不得复制进仓库、HTML、SVG、打包产物或公开下载。** 清单只记录来源文件名、尺寸、SHA-256、裁切、遮挡与标注信息；阅读时仅使用处理后的 PNG。不要用可被关闭的 HTML 遮挡层代替图片像素中的遮挡。

`../../scripts/prepare-cloudflare-screenshots.mjs` 记录了素材制作流程。该脚本只在重新制作教学图时使用；普通构建与阅读不需要原始截图或浏览器工具。更换教学 PNG 后，同步更新 `cloudflare-captures.json` 的尺寸、字节数与 SHA-256，再运行教程构建。

Git 篇的 12 张新图另由 `github-captures.json` 记录，裁剪和标注位置在 `../../scripts/github-screenshot-specs.mjs` 中。重新制作时运行下面的命令；原始截图目录由维护者在本地提供，不进入仓库。成功提示图省略中间的后续步骤面板，KV 表单省略中间空白，两张图均明确标出拼接间隔。

```sh
node scripts/prepare-cloudflare-screenshots.mjs --set github --source-dir /path/to/captures
npm run build:tutorial
```

已有 9 张后台原图仍遵循原有无后处理流程：在本地运行页面中使用原生凭据遮盖控件，等待界面稳定后保存视口 PNG，更新 `local-captures.json`。新图和旧图的处理方式分别记录，不将标注图称为未经处理的原始截图。

## 字体与许可

标题使用官方 Noto Serif SC 700 的本地子集；完整 OFL 保留在 HTML 与字体文件内。来源、固定提交与字符记录见 `../tutorial-assets/font-provenance.json`，正文使用系统字体。

新增标题字符后，使用 `../../scripts/subset-tutorial-font.py` 从记录的官方完整字体重建子集，再构建两篇教程。脚本检查两篇 HTML 的标题覆盖；需要 Python、fontTools 和 Brotli，阅读和普通 HTML 构建不需要这些工具。

教程的布局、交互与正文独立编写，以 GPL-2.0-only 提供，沿用 Brclio 品牌配色与中文衬线排版原则。没有将带非商业限制的设计模板复制进发行文件。Cloudflare 控制台画面用于操作说明，相关标识归其权利人所有；上游程序与字体许可独立保留。

## 验证

参见 [验证记录](../tutorial-validation.md)。检查两篇的桌面、390px 与 320px 手机布局、章节锚点、两篇互链、复制、独立进度、问题搜索、图片放大与下载。用 `file://` 离线打开确认无外部资源请求，下载图片的 SHA-256 应等于对应已审核 PNG。
