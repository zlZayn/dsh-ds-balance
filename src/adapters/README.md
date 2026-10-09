# adapters/ — 适配器层手册

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
  - **构造期永不抛错，打开是懒的且失败可重试**：`storageDomain` 可能晚到，构造期就打开会把一次过早的失败永久钉死。打开失败只记一次 error，之后每次操作重试一次；失败时按调用抛 `StorageError`、`health` 报 `ok: false`。未观察的 rejection 曾把宿主整个拖下水。
  - `loadLatestSnapshot` 按 `accountTag` 过滤，用 `snapshotId` 判新旧；**走 `entries()` 而不是 `keys()` + 逐键 `get()`**（后者每条记录两次查找）。
  - `pruneByTag(tag, keepN)`：只留该桶最新 `keepN` 条，**别的桶一条都不动**；没超期时**零写入**返回 0。
    **单次最多删一批**（`PRUNE_MAX_PER_CALL` 内部常量），剩下的交给后续启动或写入路径。
    内部**分批删 + 每批之后让出一次事件循环** —— 理由是**摊平写放大，不是防限流**：`single` 布局下每次 `delete` 都要原子重写整份单元文件，几十条挤在一个 tick 上会连带拖住同进程的取数与轮询。批次大小与上限是实现细节，不上端口。
  - **启动时一次性清理**：`initialize()` 里 `open` 成功后立刻把所有账本桶各修剪一次。
    写入路径只对稳态有效；首次升级存量很大时靠它收敛（实测 9000 条 / 3.8 MB 的场景）。
    扫全表而不是只清当前桶 —— 启动这一刻还不知道会用哪个 `accountTag`，只清一个桶的话凭据轮换出来的旧桶永远清不掉。
    **清理失败只记一条 warn、绝不影响 open 成功**：抛出去会让 `ensureOpen` 判成打开失败，整个存储被打成降级，那比慢更糟。
    进度日志带 `removed` 与 `remainingApprox`，否则使用者无从判断清理是否在推进。
  - `close()` 幂等，**必须挂在 `ctx.effect` 的 disposer 上**。
- `memory-metrics.ts`：`MemoryMetrics` 实现 `ReadableMetrics`；键的构造规则是 `名字{标签=值,...}`（标签按名排序）。默认组合没有指标 sink，所以聚合值由 `GET /api/v1/healthz` 的 `metrics` 段暴露。
- `console-logger.ts`：`createConsoleLogger` 实现 `Logger`，落 `console`。宿主半边没有统一的 logger 服务；**字段对象原样序列化，调用方不许把凭据传进来**。
- `salt-file.ts`：`loadOrCreateSalt`。已有非空盐直接返回；缺失则生成 32 字节随机并以 **0600** 落盘；空白视为缺失；幂等。**只收路径**，路径由组装点用 `dshHomePath()` 拼。

## 被谁依赖

- `src/services/` 与 `src/http/` 只在组装点（`src/index.ts`）拿到实例。

## 改后必测

- `npx --no-install vitest run test/http-deepseek-client.test.ts test/domain-core-store.test.ts test/salt-file.test.ts test/memory-metrics.test.ts`
- 覆盖：URL 拼接、Bearer 头、401/429、非 JSON 的 200、`fetch` 抛错、超时、调用方取消；存储的记录往返、按账本过滤、懒打开与失败重试、降级模式、幂等关闭；盐的生成 / 复用 / 权限 / 空白判定；指标键的稳定性与聚合。
