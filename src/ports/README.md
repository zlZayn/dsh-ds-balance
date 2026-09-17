# ports/ — 端口层手册

- 职责：定义上层依赖的**接口**（Layer 1）。只有类型与常量，没有实现。
- 变更影响路由：改端口签名 → 同步实现（`src/adapters/`）与 [docs/backend-architecture.md](../../docs/backend-architecture.md) 的 §5。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 回根 → [../../AGENTS.md](../../AGENTS.md)。

## 文件

- `clock.ts`：`Clock`。时间必须可注入，测试不许依赖真实时钟。
- `logger.ts`：`Logger`。字段化结构化日志。
- `metrics.ts`：`Metrics`、`noopMetrics`，以及 `MetricsSnapshot` / `ReadableMetrics`（能读出聚合值的实现，供没有外部 sink 的装配把数字暴露出去）。
- `deepseek-client.ts`：`DeepSeekClient`、`DeepSeekCallOptions`、`TestConnectionResult`、`DEFAULT_BASE_URL`。
- `core-store.ts`：`CoreStore`。**`loadLatestSnapshot` 必须按 `accountTag` 过滤** —— 凭据轮换后 tag 会变，旧快照不得混用。
- `credentials.ts`：`Credentials` / `ResolvedCredential` / `CredentialDescription`。**`describe` 的类型里根本没有装值的槽**；装配里可能**没有**这个 seam，消费方必须自己兜。

## 被谁依赖

- `src/adapters/`（实现）、`src/services/`（消费）、`src/http/`（消费）。

## 改后必测

- `npm run typecheck`（端口一改，实现立刻要跟上）。
- 新增端口必须同步 [docs/backend-architecture.md](../../docs/backend-architecture.md) 的 §5 与 [src/adapters/README.md](../adapters/README.md)。
