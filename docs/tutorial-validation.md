# 独立 HTML 教程验证

日期：2026-09-16。对象：`docs/tutorial.html`，源码位于 `docs/tutorial-src/`。本次版本使用 Release 预构建下载作为部署入口，并加入本地 UUID 生成。发布前另补齐 Worker 与 Pages 包内的组件许可，未改动隧道逻辑。

## 结果

**50 项浏览器检查通过**，详细结果与最终文件 SHA-256 见 [validation.json](tutorial-assets/validation.json)。

- 桌面与手机宽度：1920、1440、1024、900、768、390、375、320 px，正文无横向溢出。320 px 展开全部折叠内容后仍通过。
- 目录定位、当前章节、短桌面视口目录滚动，以及手机目录的打开、跳转、Esc 关闭和 Tab 焦点循环通过。
- 8 步勾选、刷新后恢复与重置通过；进度仅保存在浏览器。
- 复制得到真实多行命令；问题搜索、无结果提示和清空恢复通过。
- 本地生成符合格式的 UUID v4，每次生成不同；复制一致、不写入存储，刷新后清除。Release 下载链接指向正确版本附件。
- 原图弹窗、适应窗口、100% 尺寸、Esc 关闭与焦点恢复通过。
- 实际下载概览 PNG，下载文件 SHA-256 与仓库原图逐字节匹配。
- 本地 HTTP 与直接 `file://` 打开通过；关闭网络后，正文、交互、本地字体和 9 张图均可用。
- 禁用 JavaScript 后仍能阅读完整 12 章正文和截图；打印前展开内容、打印后恢复状态通过。
- 浏览器无 JavaScript 运行错误，阅读与操作未产生外部 HTTP 请求。

## 图片与字体

9 张管理界面截图全部为 **1920×1200 的原生视口 PNG**，没有裁剪、缩放、重新编码或后处理。凭据通过应用原有遮盖控件隐藏。拍摄过程中没有触发网络查询、测速、消息发送或服务配置变更。

HTML 内有 10 个图片实例，其中概览同时用于封面和正文；它们解码后均与各自源 PNG 完全一致。尺寸、URL、滚动位置、时间与 SHA-256 记录见 [local-captures.json](tutorial-assets/local-captures.json)。

Noto Serif SC 700 已核对全部标题字符覆盖，并保留完整 OFL。字体来源和重建方式见 [font-provenance.json](tutorial-assets/font-provenance.json)。

## 内容与结构

- README 本地文档与图片链接存在，教程页内锚点、复制目标和 ARIA 引用有效，无重复 ID。
- 标题层级、表头、输入标签、可见焦点及减少动态设置已检查。
- 对照当前项目源代码核对保存范围、订阅格式、手动测速、备份与下载行为。
- Cloudflare 上传、KV、机密、自定义域、Workers 域名和 gRPC 条件，以及 v2rayN 订阅步骤，按各自官方文档核对。
- 原图说明对应实际画面；订阅默认值与初次设置建议的区别已说明。
- 生成器验证图片哈希、PNG 宽高、内嵌脚本字节一致性与语法，并拒绝未替换占位或远程运行资源。

## 预览

[![教程桌面预览](images/tutorial-desktop.png)](images/tutorial-desktop.png)

[手机预览](images/tutorial-mobile.png) · [打开教程文件](tutorial.html) · [教程源文件与维护说明](tutorial-src/README.md)

## 验证范围

以上验证针对文档和本地实际管理界面的截图，不代表在个人 Cloudflare 账号新建资源、迁移 DNS 或完成公网客户端验收。教程中的 Cloudflare 和客户端步骤由官方文档与项目实现核对；本轮未登录或变更生产账号，发布版本另完成 119 项自动化测试。项目功能的独立验证记录见 [validation.md](validation.md)。
