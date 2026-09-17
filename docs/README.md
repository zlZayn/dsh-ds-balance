# docs/ — 设计与契约文档

- 职责：放跨阶段的**设计 / 契约 / 流程**；实现细节进 [src/](../src/README.md) 的手册，过程记录进 [.agents/notes/](../.agents/notes/)。
- 怎么在这里写 → [AGENTS.md](AGENTS.md)。
- 上层 → 根 [AGENTS.md](../AGENTS.md) 的文档地图；门面 → 根 [README.md](../README.md)。

## 三层

- **活文档**：描述现状，随代码改；改了代码要同批改它。
- **设计依据**：某个阶段定契约的那一份，写完即冻结；后来变了就新写一条决策记录，不回头改它。
- **记录**：勘察与复盘，只写当时发生了什么。

层的判据决定它能不能被改，所以每份文件先归层再动笔。

## 文件

| 文件 | 层 | 一句话 |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 活 | 不变的设计与防错清单：插件形态、slot、颜色口径、跨字段校验。 |
| [PUBLISHING.md](PUBLISHING.md) | 活 | 发布手册：流程、版本号判定链、判例库。 |
| [backend-architecture.md](backend-architecture.md) | 活 | 后端契约（端点 / 配置 / 存储 / 错误码）的 home。 |
| [ui-handoff.md](ui-handoff.md) | 依据 | 移交给后端的那份 UI 契约：消费哪些字段、不消费哪些。 |
| [model-integration-assessment.md](model-integration-assessment.md) | 依据 | 与官方模型机制（凭据继承）的融合判定。 |
| [backend-architecture-review.md](backend-architecture-review.md) | 依据 | 后端架构文档的逐条对照审查。 |
| [recon-native-integration.md](recon-native-integration.md) | 记录 | 阶段 0 勘察：原生 slot / 组件 / token / 数据获取的实测结论。 |
| [postmortem/](postmortem/README.md) | 记录 | 按日期归档的事故复盘：现象、根因、防错。 |

## 变更影响路由

- 改对外可见行为 → 根 [README.md](../README.md)（中英双件同改）+ [ARCHITECTURE.md](ARCHITECTURE.md)。
- 改界面结构、颜色口径或阈值口径 → [ARCHITECTURE.md](ARCHITECTURE.md)。
- 改端点、配置字段或错误码 → [backend-architecture.md](backend-architecture.md) + [src/http/README.md](../src/http/README.md)。
- 改发布流程或版本号判定 → [PUBLISHING.md](PUBLISHING.md)。
- 新增、改名或删除本目录的文件 → 回填本文件与根 [AGENTS.md](../AGENTS.md) 的文档地图。
