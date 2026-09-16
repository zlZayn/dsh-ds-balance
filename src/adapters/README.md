# src/adapters/ — 适配器层手册

- 职责：实现 `src/ports/` 定义的接口（Layer 2）。
- 变更影响路由：改行为 → 同步 [docs/backend-architecture.md](../../docs/backend-architecture.md) 的 §5 与 §7（错误分类）；改错误映射 → 同步 §7.4。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 回根 → [../../AGENTS.md](../../AGENTS.md)。

## 文件

- `http-deepseek-client.ts`：`HttpDeepSeekClient` 实现 `DeepSeekClient`。
  - 用 WHATWG `fetch`；**超时用自建 `AbortController + setTimeout`**（而不是 `AbortSignal.timeout`），这样测试能在不睡真实时间的前提下驱动超时分支。
  - 状态码映射：非 2xx 抛 `UpstreamError`，消息取自 `parseErrorBody`。
  - `testConnection` **不抛错**，失败回 `ok: false` + 错误码。
  - **`apiKey` 只在内存里流转，不落日志、不落盘。**

## 被谁依赖

- `src/services/` 与 `src/http/` 只在组装点（`src/index.ts`）拿到实例。

## 改后必测

- `npx --no-install vitest run test/http-deepseek-client.test.ts`
- 覆盖：URL 拼接、Bearer 头、401/429、非 JSON 的 200、`fetch` 抛错、超时、调用方取消、`testConnection` 成功与失败。
