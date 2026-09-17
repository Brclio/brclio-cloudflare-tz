# 教程站部署

两篇教程发布到 GitHub Pages：

- 首页（部署与使用）：https://brclio.github.io/brclio-cloudflare-tz/
- GitHub 自动部署与同步：https://brclio.github.io/brclio-cloudflare-tz/github-deploy.html
- 保留的基础教程地址：https://brclio.github.io/brclio-cloudflare-tz/tutorial.html

## 发布配置

- 仓库：`Brclio/brclio-cloudflare-tz`
- 教程部署分支：`codex/deploy-tutorial`
- GitHub 仓库 **Settings → Pages → Build and deployment → Source**：`GitHub Actions`
- 工作流：`.github/workflows/deploy-tutorial.yml`
- 构建命令：`npm run build:tutorial-site`
- 发布目录：`dist/tutorial`

工作流使用 Node.js 22，先核对图片哈希、尺寸和内嵌脚本，再生成两篇独立 HTML。教程构建仅使用 Node.js 内置模块，无需安装应用依赖。发布目录只包含教程页面、GPL 许可证与 `.nojekyll`；图片、字体、样式和交互脚本已内嵌在 HTML 中。

`index.html` 与 `tutorial.html` 保持相同字节，首页可直接阅读，同时保留两篇之间的文件名链接和章节锚点。应用的 Cloudflare Worker、管理后台、KV 与机密不参与这个教程站的部署。

## 更新教程

在 `codex/deploy-tutorial` 分支修改 `docs/tutorial-src/` 或教程素材后运行：

```sh
npm run build:tutorial-site
npm run check
git diff --check
```

把教程源码、必要素材及生成的 HTML / 清单一同提交到该分支并推送，GitHub Actions 会自动构建、发布。`dist/` 是忽略的构建产物，不提交。到仓库 **Actions → Deploy tutorials to GitHub Pages** 确认发布结果。

`main` 上的应用更新不会自动发布到教程站。需要同步教程时，先将有关改动合入部署分支，再推送。维护及故障排查可参考 [GitHub Pages 自定义工作流文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
