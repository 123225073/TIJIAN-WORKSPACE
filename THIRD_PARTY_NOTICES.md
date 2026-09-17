# 第三方来源与许可

本项目没有因上传公开 GitHub 仓库而自动选择整体开源许可证。项目自身源码的进一步授权由权利人决定；以下第三方文件按各自原有许可提供，不能将上游许可扩大解释为本项目全部文件的许可。

## Easel

- 来源：[ZJU-REAL/Easel](https://github.com/ZJU-REAL/Easel)
- 参考提交：`3ce9d40b47794db13e22523e0e8df13ee1ba5f7a`
- 许可：[Apache License 2.0](vendor/Easel/LICENSE)
- 随源码提供的子集：RSS/Atom 解析、内容提示检查、公众号 HTML 转换及主题、写作/研究/对标/定位/选题/风格方法文本。
- `src/Markdown.tsx` 参考上游 Markdown 安全渲染方式；其余调用边界见 `backend/upstream.py`。
- 没有集成上游全权限 OpenClaw 运行进程。方法文本作为参考数据加载，不赋予脚本执行或对外发布权限。

上游文件保留其来源和版权说明，当前发布子集未改写原文件。原仓库完整历史、账号资料、输出和无关组件不随本次发布上传。

## we-mp-rss

- 来源：[rachelos/we-mp-rss](https://github.com/rachelos/we-mp-rss)
- 参考提交：`d8feb6a42c6773d7374e03c487d3ae3426084af8`
- 许可：[MIT，Copyright 2025 RACHEL](desktop/third-party/we-mp-rss-LICENSE.txt)
- 参考范围：微信读书列表、cover 降级、reviewId 及正文端点处理思路。
- 工作台适配层位于 `backend/weread.py`，另行实现身份校验、预算限制、加密会话、去重、补漏、错误延后和应用内提醒。
- 不要求部署或启动上游服务，不包含其完整程序，也没有以其 Webhook 声称接入微信官方实时推送。

## 包管理依赖

JavaScript 依赖及锁定版本见 `package.json` / `package-lock.json`；Python 依赖范围见 `requirements.txt`。Electron、React、FastAPI 等第三方包各自保留其许可证，安装及分发时应随包管理器或打包产物保留适用声明。
