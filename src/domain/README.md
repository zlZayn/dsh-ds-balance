# domain/ — 领域模型手册

- 职责：纯逻辑的领域层（Layer 0）。**不依赖任何 dsh 服务、不发网络请求、不碰文件系统。**
- 变更影响路由：改契约形状 → 同步 [docs/backend-architecture.md](../../docs/backend-architecture.md) 的 §4 与 [docs/ui-handoff.md](../../docs/ui-handoff.md)；改判定规则 → 同步 §7。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 回根 → [../../AGENTS.md](../../AGENTS.md)。

本目录按**符号名**引用代码，不写行号。

## 文件

- `money.ts`：定点金额。`Units` 是 `bigint` 最小单位；`parseMoney` 只接受十进制定点、超 8 位**截断不四舍五入**、失败抛 `ParseError`；`formatMoney(units, decimals)` 默认 8 位给 API、2 位给 UI。
- `errors.ts`：错误码闭集、`AppError` 家族、`upstreamCodeOf`（状态码 → 错误码）、`parseRetryAfter`、`classify`（任意异常 → `ErrorInfo`）。
- `balance.ts`：契约类型。`BalanceSnapshot` 是内部形状（金额为 `bigint`），`BalanceView` 是对外形状，`RawBalanceResponse` 是上游形状（字段名保持上游拼写）。
- `severity.ts`：`thresholdsOf` / `thresholdsFor` / `severityOf`。**阈值只在这里被读**，前端不参与任何金额比较。
- `select.ts`：`stableOrder`（CNY 提前、其余保序）与 `pickBalance`（后端权威的币种选择）。
- `normalize.ts`：`normalize`（上游 JSON → 快照，结构不符抛 `ShapeError`、金额坏掉抛 `ParseError`）、`nextSnapshotId`、`parseErrorBody`（容错解析三种错误体形状）。

## 关键导出与依赖方向

- 只被 `src/ports/`、`src/adapters/`、`src/services/`、`src/http/` 依赖。
- **domain 不许反向依赖上层** —— 它连 `ports` 都不该 import。

## 改后必测

- `npx --no-install vitest run test/money.test.ts test/severity.test.ts test/select.test.ts test/normalize.test.ts`
- 金额：往返一致、超 8 位截断、非法输入抛错。
- 严重度：五档 + 阈值边界取等号 + 不可用压过阈值。
- 选择：数组顺序跳变不改变结果。
