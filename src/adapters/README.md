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

- `domain-core-store.ts`：`DomainCoreStore` 实现 `CoreStore`，走 dsh 官方存储接缝。
  - `DS_BALANCE_DOMAIN` 用 `defineDomain` + `domainTable`；**不写 `backend`**（路由归部署方）。
  - **构造期永不抛错**：打开失败被吸收成降级状态，之后每次操作按调用抛 `StorageError`、`health` 报 `ok: false`。未观察的 rejection 曾把宿主整个拖下水。
  - `loadLatestSnapshot` 按 `accountTag` 过滤，用 `snapshotId` 判新旧。
  - `close()` 幂等，**必须挂在 `ctx.effect` 的 disposer 上**。
- `salt-file.ts`：`loadOrCreateSalt`。已有非空盐直接返回；缺失则生成 32 字节随机并以 **0600** 落盘；空白视为缺失；幂等。**只收路径**，路径由组装点用 `dshHomePath()` 拼。

## 被谁依赖

- `src/services/` 与 `src/http/` 只在组装点（`src/index.ts`）拿到实例。

## 改后必测

- `npx --no-install vitest run test/http-deepseek-client.test.ts test/domain-core-store.test.ts test/salt-file.test.ts`
- 覆盖：URL 拼接、Bearer 头、401/429、非 JSON 的 200、`fetch` 抛错、超时、调用方取消；存储的记录往返、按账本过滤、降级模式、幂等关闭；盐的生成 / 复用 / 权限 / 空白判定。
