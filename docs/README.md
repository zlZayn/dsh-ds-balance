# docs/ — 活文档

- 职责：只放**活文档** —— 描述现状、随代码改；改了对外行为要同批改它。
- 「为什么这么定」→ [.agents/notes/](../.agents/notes/README.md)（决策与依据）；
  「当时出了什么事」→ [postmortem/](postmortem/README.md)。
- 怎么在这里写 → [AGENTS.md](AGENTS.md)。
- 上层 → 根 [AGENTS.md](../AGENTS.md) 的文档地图；门面 → 根 [README.md](../README.md)。

## 文件

| 文件 | 一句话 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | **不变的设计与防错清单**：设计取舍、数据流语义、不许怎么改。 |
| [BACKEND-ARCHITECTURE.md](BACKEND-ARCHITECTURE.md) | **后端契约**：领域模型 / 端口 / 服务 / HTTP API / 配置 / 存储的字段与形状。 |
| [UI-HANDOFF.md](UI-HANDOFF.md) | **界面契约**：处境 → 形态表、通道映射、来源标签规则、mock 覆盖。 |
| [PUBLISHING.md](PUBLISHING.md) | 发布手册：流程、版本号判定链、判例库。 |
| [RELEASE-DRAFTER.md](RELEASE-DRAFTER.md) | 草稿 Release 的维护：标签映射、本仓适配情况、草稿 tag 为什么用滚动名。 |
| [postmortem/](postmortem/README.md) | 事故复盘（**独立体裁与双件**，不在上面「活文档」之列）。 |

### 前两份怎么分（本轮定案）

两份都叫「架构」，容易不知道看哪份。**判据一句话**：

> **这一条会不会随「加了什么」而改？**
> 会（加了模块 / 字段 / 端点）→ [BACKEND-ARCHITECTURE.md](BACKEND-ARCHITECTURE.md)；
> 不会（它是「为什么这么定」与「不许怎么改」）→ [ARCHITECTURE.md](ARCHITECTURE.md)。

按这条判据，`BACKEND-ARCHITECTURE.md` 本轮**删掉 85 行**：§13 测试表、§15「需要一并修的 UI 侧」、
§16「待验证（实现阶段第一件事）」、§19「实现细则」、以及开头的「本版修正」表 ——
它们都是**一次性 how-to / 已完成的待办**，不属于「契约」这个层。
其中 §15 还列着 `installSection`，而那个宿主接缝**早已被删除**（红线明令源码不许再出现它）——
活文档里躺着已过时的 API 名，正是「活文档随代码走」被违反的样子。

**为什么 `UI-HANDOFF.md` 归活文档**：它写的是**当前**界面契约（处境表、通道映射、
来源标签规则、mock 覆盖），而这些必须与代码一致。归「依据」＝不追改，那它就会在下一次改形态时
静默变成假话 —— `account-unavailable` 的叉正是这么丢的：代码改了、跟着改的测试也改了，
而这份文档没改，双方长期矛盾。`test/client-situation.test.ts` 的分层表断言与它的 §四 表逐行对账
（文档与代码对不上时机器会红）。

**文件名一律全大写**：本目录 7 份文件统一 `UPPERCASE.md`（`AGENTS.md` / `README.md` 本来就是这个形状）。
本轮把 `backend-architecture.md` → `BACKEND-ARCHITECTURE.md`、`ui-handoff.md` → `UI-HANDOFF.md`。

## 变更影响路由

- 改对外可见行为 → 根 [README.md](../README.md)（中英双件同改）+ [ARCHITECTURE.md](ARCHITECTURE.md)。
- 改界面结构、颜色口径或阈值口径 → [ARCHITECTURE.md](ARCHITECTURE.md)。
- 改端点、配置字段或错误码 → [BACKEND-ARCHITECTURE.md](BACKEND-ARCHITECTURE.md) + [src/http/README.md](../src/http/README.md)。
- 改发布流程或版本号判定 → [PUBLISHING.md](PUBLISHING.md)。
- 改草稿 Release 的分类、触发条件或 tag → [RELEASE-DRAFTER.md](RELEASE-DRAFTER.md)。
- 新增、改名或删除本目录的文件 → 回填本文件与根 [AGENTS.md](../AGENTS.md) 的文档地图。
