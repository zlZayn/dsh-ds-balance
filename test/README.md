# test/ — 测试手册

- 职责：领域层与服务的单元测试。**只测纯逻辑与端口替身，不做端到端。**
- 运行方式：`npx --no-install vitest run`（或 `npm test`）。
- 变更影响路由：改 `src/domain/` 的判定规则 → 必须同步对应测试；改契约形状 → 同步 [docs/backend-architecture.md](../docs/backend-architecture.md) §13 的测试表。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。

## 文件

- `money.test.ts`：解析、格式化、往返、边界与非法输入。
- `errors.test.ts`：错误码映射、`classify` 各分支、`parseRetryAfter`。
- `severity.test.ts`：五档 + 阈值边界（取等号）+ 不可用压过阈值。
- `select.test.ts`：稳定排序、偏好命中与回落、**数组顺序跳变不改变结果**。
- `normalize.test.ts`：快照归一化、结构 / 金额错误分流、`parseErrorBody` 三种形状。

## 覆盖范围（按类别）

- 已覆盖：领域层（Layer 0）。
- 待覆盖：端口替身下的服务状态机、调度退避、HTTP 契约快照 —— 见 [docs/backend-architecture.md](../docs/backend-architecture.md) §13。

## 约定入口

- 测试文件与被测模块同名，放平铺在 `test/` 下；**不建子目录**，直到类别超过三类再分。
