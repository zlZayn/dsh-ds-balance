# src/services/ — 应用服务手册

- 职责：把端口与领域模型组织成用例（Layer 3）。**不直接碰 `ctx`，只依赖构造时注入的端口。**
- 变更影响路由：改解析链或调度策略 → 同步 [docs/backend-architecture.md](../../docs/backend-architecture.md) 的 §6；改错误分类 → 同步 §7.4。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 回根 → [../../AGENTS.md](../../AGENTS.md)。

## 文件

- `account-tag.ts`：`computeAccountTag(salt, apiKey)`（HMAC-SHA256 前 32 hex）与 `accountTag8`（日志用前 8 位）。**不可逆、不含明文。**
- `key-resolver.ts`：`KeyResolver` 与 `CREDENTIAL_REF_PATTERN`。解析链 = 配置 `apiKey` → `credentials.resolve(apiKeyRef)` → `process.env[apiKeyRef]` → 抛 `NoKeyError`。
  - **无 credentials seam 时吞掉异常继续往下**，不让它变成整个插件的失败。
  - **每次调用现读配置**，用户改了立刻生效。
- `config-service.ts`：`ConfigService` 与 `ConfigSource`。薄封装设置作用域：现读、订阅、派生阈值；`timeoutMs()` **每次现读环境变量**。
- `balance-service.ts`：`BalanceService`、`RefreshResult`、`BalanceStatus`、`GetViewOptions`。
  - **对外永不抛错**：一切失败变成 `view.state` 与 `view.error`。
  - `getView` 合并并发请求（`inflight`）；不 force 且**可服务缓存**时直接返回。
  - **两个新鲜度谓词不能混**：`withinWindow()` 只看时间（`restore` 用）；`canServeCache()` 额外要求 `state === 'ok'`（`getView` 用）—— 混用会让一次失败之后永远不再重试。
  - `restore()` 按 `accountTag` 过滤恢复快照；凭据轮换后旧快照视为不存在。
  - 只在**首次失败**打 warn，避免日志刷屏。
- `scheduler.ts`：`Scheduler`、`nextDelayMs`、`jitter` 与常量。
  - `setTimeout` 链而非 `setInterval`：跑完才排下一轮，退避与 `Retry-After` 才生效。
  - 间隔优先级：`Retry-After` → 缺密钥快速重试 → 失败指数退避 → 配置频率；一律带 ±20% 抖动。
  - `start` / `stop` 幂等；**必须挂在 `ctx.effect` 的 disposer 上**。

## 被谁依赖

- `src/http/`（handler）与 `src/index.ts`（组装）。

## 改后必测

- `npx --no-install vitest run test/key-resolver.test.ts test/config-service.test.ts test/balance-service.test.ts test/scheduler.test.ts`
- 覆盖：密钥解析优先级与回落、每次现读配置、状态机（ok / stale / error / empty）、inflight 合并、冷却、按账本恢复、退避与抖动。
