# services/ — 应用服务手册

- 职责：把端口与领域模型组织成用例（Layer 3）。**不直接碰 `ctx`，只依赖构造时注入的端口。**
- 变更影响路由：改解析链或调度策略 → 同步 [docs/BACKEND-ARCHITECTURE.md](../../docs/BACKEND-ARCHITECTURE.md) 的 §6；改错误分类 → 同步 §7.4。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 回根 → [../../AGENTS.md](../../AGENTS.md)。

## 文件

- `account-tag.ts`：`computeAccountTag(salt, apiKey)`（HMAC-SHA256 前 32 hex）与 `accountTag8`（日志用前 8 位）。**不可逆、不含明文。**
- `key-resolver.ts`：`KeyResolver` 与 `CREDENTIAL_REF_PATTERN`。解析链 = 配置 `apiKey` → `credentials.resolve(apiKeyRef)` → `process.env[apiKeyRef]` → 抛 `NoKeyError`。
  - **无 credentials seam 时吞掉异常继续往下**，不让它变成整个插件的失败。
  - **每次调用现读配置**，用户改了立刻生效。
- `config-service.ts`：`ConfigService` 与 `ConfigSource`。薄封装设置作用域：现读、订阅、派生阈值；`timeoutMs()` **每次现读环境变量**。
- `balance-source.ts`：`SourceLedger` 与 `SourceReader`。**一个来源一份账本**：快照、状态机、失败退避、手动冷却都在这里。
  - **对外永不抛错**：一切失败变成 `view.state` 与 `view.error`。
  - `getView` 合并并发请求（`inflight`）；不 force 且**可服务缓存**时直接返回。
  - **两个新鲜度谓词不能混**：`withinWindow()` 只看时间（`restore` 用）；`canServeCache()` 额外要求 `state === 'ok'`（`getView` 用）—— 混用会让一次失败之后永远不再重试。
  - `restore()` 按 `accountTag` 过滤恢复快照；凭据轮换后旧快照视为不存在。
  - 手动刷新的冷却**锚在上一次手动刷新**（`lastManualRefreshAt`），不是上一次抓取：锚在 `fetchedAt` 上时，一次自动刷新会把用户刚按下的一下吞掉 —— 界面转了圈、上游一次没打。
  - `persist()` 落盘后**按账本修剪**（`pruneByTag(tag, SNAPSHOT_KEEP_N)`），只留最近 20 条 ——
    落盘失败与修剪失败**分开记账**：写成功时把它报成「没落盘」会让日志说谎。
    `SNAPSHOT_KEEP_N` 取自 [../domain/balance.ts](../domain/balance.ts)；
    **为什么是 20 条、为什么不是配置项**见[决策记录](../../.agents/notes/2026-10-09-snapshot-retention.md)，
    契约见 [BACKEND-ARCHITECTURE.md](../../docs/BACKEND-ARCHITECTURE.md) §10.4 —— 本文件不重抄理由。
  - 只在**首次失败**打 warn，避免日志刷屏；指标键带 `source` 标签，两条路各自可看。
  - **没接入 ≠ 接入了但出错**：判定不在本文件，而在 [../domain/situation.ts](../domain/situation.ts)
    的 `situationOf` —— 账本只负责把六个事实（有无快照 / stale / isAvailable / hasSelected /
    severity / errorCode）交给它。`severityOf` 现在只服务颜色，不再决定界面形态。
  - `status()` 回报的切片比调度需要的那几项更宽（多带 `isAvailable` / `hasSelected` / `severity`）——
    那是给 `/healthz` 判处境用的，口径与 `toView` 完全同源，不开浏览器也能知道界面会画成什么。
  - `SourceReader` 是**换来源要换的那一件**：`available()` / `tag()` / `read()`，前两个是本地读、只有 `read()` 打上游。
- `source-readers.ts`：两条路的读取策略 —— `keyReader`（解析链 → 官方余额端点）与 `accountReader`（账号登录态 → 钱包查询 → 投影）。
  - 账号账本的 `tag` 用 `account:<userId>` 前缀，与密钥那条**永不共账本**；**id 拿不到时抛 `NoKeyError` 而不是退 `account:unknown`** —— 退化成占位键会把那条快照写进一个再也读不回来的账本（`loadLatestSnapshot` 严按当前键过滤）。`restore()` 静默吸收，下一轮拿到真 id 自愈。
- `source-selector.ts`：**选源判据的唯一一处**。`routeOf(provider)` 把宿主路由翻成来源；`pickSource` 走四层回落（会话 → 全局默认 → `FALLBACK_ORDER` → 默认来源）。新增一个来源只动这里 + 装配处。
- `balance-service.ts`：`BalanceService`（门面）、`RefreshResult`、`BalanceStatus`、`GetViewOptions`。
  - 门面**不持状态、不抓数据**：解析这一轮谁活跃，然后把活交给那条路的账本。
  - `mark(served)` 是这一层的关键：哪条把数字交出去，`active` 就是哪条 —— 展示、刷新、标签从此只认它，
    不会出现「数字是账号的、标签写 Key、刷新去刷 Key」。
  - 它同时记 `balance_source_switch_total{from,to}`：来源切换**刻意不给界面提示**
    （见 [决策记录](../../.agents/notes/2026-10-01-boundaries-left-as-is.md)），这是唯一观测出口。
  - **本插件只记官方那一个**：首选那条拿不出数字就按 `FALLBACK_ORDER` 退到另一条官方路（有旧快照也算）；
    **两条都拿不出数字才画叉**。一轮最多「首选一次 + 兜底一次」，**不来回重试**。
  - `refreshActive()` 刷 `active`（即展示的那条）；发现它不可用时**重判一次** —— 宿主刚起来时
    「服务已注册」不等于「它自己的凭据已可读」，那一刻只按兜底走。
  - `forceRefresh()` 刷**用户看到的那条**：首选那条一条数字都没有时，实际显示的是兜底那条，那就刷兜底那条。
  - `invalidateSource()` 作废「来源已定」，让下一次调度重新解析。
- `scheduler.ts`：`Scheduler`、`nextDelayMs`、`jitter`、`jitterWithin` 与常量。
  - `setTimeout` 链而非 `setInterval`：跑完才排下一轮，退避与 `Retry-After` 才生效。
  - 间隔优先级：`Retry-After` → 缺密钥快速重试 → 失败指数退避 → 配置频率。退避与缺密钥重试带对称 ±20% 抖动。
  - **健康态走单边抖动**（`jitterWithin`，`[base × (1-ratio), base - SCHEDULE_GUARD_MS]`）：缓存窗口就是 `serverRefreshSeconds`，对称抖动会让一半轮次的窗口先过期，界面轮询于是替它代打一次、tick 再打一次。
  - `start` / `stop` 幂等；**必须挂在 `ctx.effect` 的 disposer 上**。

## 被谁依赖

- `src/http/`（handler）与 `src/index.ts`（组装）。

## 改后必测

- `npx --no-install vitest run test/key-resolver.test.ts test/config-service.test.ts test/balance-service.test.ts test/scheduler.test.ts`
- 覆盖：密钥解析优先级与回落、每次现读配置、状态机（ok / stale / error / empty）、inflight 合并、冷却、按账本恢复、退避与抖动。
