# Brclio Edge 图文教程

- [部署与使用教程](https://brclio.github.io/brclio-cloudflare-tz/)
- [GitHub 自动部署与同步教程](https://brclio.github.io/brclio-cloudflare-tz/github-deploy.html)

本分支只存放可直接发布的教程文件。GitHub Pages 从 `codex/deploy-tutorial` 分支根目录发布，推送更新后自动生效，无需构建或安装依赖。

`index.html` 和 `tutorial.html` 是同一篇基础教程；保留后者以兼容两篇教程之间的链接。图片、字体、样式和交互脚本均已内嵌，HTML 下载后也可离线阅读。

教程源文件及应用代码在 [main 分支](https://github.com/Brclio/brclio-cloudflare-tz/tree/main)。更新时在源码分支运行 `npm run build:tutorial`，将生成的 `docs/tutorial.html` 同时复制为本分支的 `index.html` 和 `tutorial.html`，将 `docs/github-deploy.html` 复制为本分支的同名文件，再提交推送。无需把应用代码合并到本分支。

Copyright © 2026 Brclio。教程采用 GPL-2.0-only，见 [LICENSE.txt](LICENSE.txt)。字体 OFL 许可、上游与截图署名保留在教程 HTML 中。
