# docs/ — 活文档

- 职责：只放**活文档** —— 描述现状、随代码改；改了对外行为要同批改它。
- 「为什么这么定」→ [.agents/notes/](../.agents/notes/README.md)（决策与依据）；
  「当时出了什么事」→ [postmortem/](postmortem/README.md)。
- 怎么在这里写 → [AGENTS.md](AGENTS.md)。
- 上层 → 根 [AGENTS.md](../AGENTS.md) 的文档地图；门面 → 根 [README.md](../README.md)。

## 文件

| 文件 | 一句话 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 不变的设计与防错清单：插件形态、slot、颜色口径、跨字段校验。 |
| [backend-architecture.md](backend-architecture.md) | 后端契约（端点 / 配置 / 存储 / 错误码）的 home。 |
| [ui-handoff.md](ui-handoff.md) | 界面的 home：处境 → 形态表、通道映射、来源标签规则、mock 覆盖。 |
| [PUBLISHING.md](PUBLISHING.md) | 发布手册：流程、版本号判定链、判例库。 |
| [RELEASE-DRAFTER.md](RELEASE-DRAFTER.md) | 草稿 Release 的维护：标签映射、本仓适配情况、草稿 tag 为什么用滚动名。 |
| [postmortem/](postmortem/README.md) | 事故复盘（**独立体裁与双件**，不在上面「活文档」之列）。 |

**为什么 `ui-handoff.md` 归活文档**：它写的是**当前**界面契约（处境表、通道映射、
来源标签规则、mock 覆盖），而这些必须与代码一致。归「依据」＝不追改，那它就会在下一次改形态时
静默变成假话 —— `account-unavailable` 的叉正是这么丢的：代码改了、跟着改的测试也改了，
而这份文档没改，双方长期矛盾。`test/client-situation.test.ts` 的分层表断言与它的 §四 表逐行对账
（文档与代码对不上时机器会红）。

## 变更影响路由

- 改对外可见行为 → 根 [README.md](../README.md)（中英双件同改）+ [ARCHITECTURE.md](ARCHITECTURE.md)。
- 改界面结构、颜色口径或阈值口径 → [ARCHITECTURE.md](ARCHITECTURE.md)。
- 改端点、配置字段或错误码 → [backend-architecture.md](backend-architecture.md) + [src/http/README.md](../src/http/README.md)。
- 改发布流程或版本号判定 → [PUBLISHING.md](PUBLISHING.md)。
- 改草稿 Release 的分类、触发条件或 tag → [RELEASE-DRAFTER.md](RELEASE-DRAFTER.md)。
- 新增、改名或删除本目录的文件 → 回填本文件与根 [AGENTS.md](../AGENTS.md) 的文档地图。
