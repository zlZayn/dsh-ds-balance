# 贡献指南

[English](CONTRIBUTING_en.md)

三类事情，各有各的前置。

## 报 bug 时附上

- DSH 宿主版本：`dsh --version` 的输出。
- 本插件的版本：`package.json` 的 `version`，以及产物来自哪个提交。
- 现象与最小复现：从哪一步开始不对、期望是什么、实际是什么。
- **脱敏后的**日志片段。本插件的日志不带凭据，但宿主日志里可能有别的插件的内容，贴之前看一眼。
- 界面问题附截图或录屏。

**不要贴 API Key。** 出现在 issue 里的 key 一律按已泄露处理，请先去控制台吊销重发。
本项目的凭据只从 DSH 的凭据通道读，任何要求你贴 key 才能复现的 bug，都是我们没设计好。

## 提功能前

先开 issue 说清楚「要解决什么」，不要直接提 PR。

- 本插件只做两件事：**展示余额**、**配置这个展示**。
  历史曲线、告警推送、多账户汇总这类都超出范围，需要先讨论归属。
- 界面必须走原生插槽与 `--dsw-*` 语义令牌。
  引入组件库、Tailwind 或字面色值的 PR 不会合。
- 颜色只由后端 `severity` 决定。任何「按金额阈值在前端上色」的设计都不接受。
- 新增配置字段要同时改宿主 schema、`CONFIG_FIELDS`、两份词典与根门面 ——
  四处清单与同步点见 [src/client/settings/README.md](src/client/settings/README.md)。

## 提 PR 前

- 跑 `npm run typecheck` 与 `npm test`，两条都要绿。
- 改过文档就跑一次链接校验，命令见 [AGENTS.md](AGENTS.md) 的「常用命令」。
- 提交信息写清「做了什么 / 为什么 / 怎么验证 / 怎么回滚」；一个逻辑改动一个提交。
- 改了卡片的渲染面就同批重截图，或在提交信息里说明为什么不重截 —— 判据见 [assets/AGENTS.md](assets/AGENTS.md)。
- 契约变更（对外可见行为、接口签名、配置项、输出格式）必须在同一次改动里
  同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

设计约束的完整清单在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；上手步骤在 [README.md](README.md)。
