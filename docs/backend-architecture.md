# ds-balance 后端架构（修正版）

> 本文面向实现 Agent，自包含，可直接执行。
> 来源：架构师原稿 + 本仓[后端架构文档对照审查](backend-architecture-review.md)的九条修正。
> **状态：待架构师复审。**

## 本版修正（相对原稿）

| # | 位置 | 修正 |
|---|---|---|
| 1 | §1.1 | `selected` 改为**后端权威**：前端直接读它，`displayCurrency` 由前端作为查询参数传入；`isAvailable` 改为纯 `boolean` |
| 2 | §1.1 / §8.3 | `thresholds` 改为**按币种分**：`{ CNY: {warn, critical}, USD: {...} }` |
| 3 | §6.2 / §9.1 | `timeoutMs` **移出设置 schema**：常量 8000，环境变量 `DS_BALANCE_TIMEOUT_MS` 覆盖，UI 不暴露 |
| 4 | §9.1 | `register(ns, schema, { base: <值> })`，schema 是 **schemastery** |
| 5 | §9.4 | 配置变更改用 **`scope.watch`** |
| 6 | §3.3 / §8.1 | `fetch` 注册补 `requestBody`；`fetch` 返回 `Response`；返回值是**异步 disposer**，用 `ctx.effect` 包 |
| 7 | §10 | 整节重写为 **`ctx.storageDomain`**，删掉 `better-sqlite3` |
| 8 | §6.1 / §10 | `$DSH_HOME` 改用官方包 **`@deepseek-ai/dsh-home-paths`** |
| 9 | §9.2 | 补：`connection` 的 HTTP 可达性**依赖组合里有 webServer** |

---

## 〇、一句话任务

在现有 UI 基础上实现后端：读取 DeepSeek 官方余额，通过 `ctx.connection.fetch` 暴露给前端，产出 [UI 侧契约与移交](ui-handoff.md) 定义的契约形状。

**不做 Estimation**（账本 / 投影 / 估算）—— 那是第二版。

---

## 一、与 UI 的边界

### 1.1 UI 消费什么

| 字段 | 类型 | 说明 |
|---|---|---|
| `state` | `empty` / `ok` / `stale` / `error` | 缓存状态 |
| `severity` | `ok` / `warn` / `critical` / `unavailable` / `unknown` | 颜色来源 |
| `balances[]` | 数组 | 全币种 |
| `selected` | 对象或 `null` | **后端选定的币种；前端直接读它，不再自己挑** |
| `isAvailable` | **纯 `boolean`** | 账户可用性 |
| `ageMs` | number 或 `null` | 后端算好的年龄 |
| `error.code` | 字符串或 `null` | 错误码 |
| `fetchedAt` | number 或 `null` | 时间戳 |

**`selected` 的权威性**：前端把 `displayCurrency` 作为查询参数传给后端，后端按它挑，前端只负责显示。

**币种不匹配的判定**在 UI 侧用 `selected.currency` 与配置的 `displayCurrency` 比较得出，UX 不变（浮层说明 + 两个动作）。

### 1.2 UI 不消费什么

| 字段 | 状态 |
|---|---|
| `todayUsage` 整组 | 第一版不产出 |
| `thresholds` | 产出；UI 只用 `warn` 当圆环弧长的刻度，不用它配色（`critical` 不消费） |
| `requestId` / `schemaVersion` / `accountTag8` | 产出（保留） |

### 1.3 后端必须遵守的不变量

- 金额一律**字符串**，8 位小数。
- 金额比较与累加**只在后端做**。
- `balances[]` 顺序**可能跳变**，前端不依赖顺序。
- `selected` 可以为 `null`。
- `state` 与 `severity` 是**两个独立维度**。
- `severity` 与 `state` 都是**闭集**，未知回落。

---

## 二、架构分层

### 2.1 Core 与 Estimation 分离

| 层 | 内容 | 本版 |
|---|---|---|
| **Core** | 余额获取、缓存、调度、配置、severity | **做** |
| **Estimation** | 账本、投影、定价、融合估算 | **不做** |

理由：UI 第一版只消费 Core；Estimation 依赖 Core，Core 不依赖 Estimation；未来加「今日已用」时 Core 一行不改。

### 2.2 完整分层

```
Layer 5: dsh 宿主适配
Layer 4: HTTP 通道（connection.fetch）
Layer 3: 应用服务
  - KeyResolver / ConfigService / BalanceService / Scheduler
Layer 2: 适配器
  - HttpDeepSeekClient / DomainCoreStore / SystemClock
Layer 1: 端口
  - DeepSeekClient / CoreStore / Clock / Logger / Metrics
Layer 0: 领域模型
  - Money / Balance / Severity / Errors / Time
```

依赖方向：上层依赖下层，下层不知道上层。

---

## 三、关键决策

### 3.1 凭据继承官方

默认 `apiKeyRef = 'DEEPSEEK_API_KEY'`。

理由：官方 `web-search-deepseek` 插件共用同一引用名，与 `llm-deepseek` 默认逐字相同；用户在模型页配一次，本插件自动继承。

**解析链**（优先级从高到低）：

1. 配置 `apiKey`（用户显式覆盖）
2. `ctx.credentials.resolve(apiKeyRef)`
3. `process.env[apiKeyRef]`
4. 全空 → `NO_KEY`

注意事项：

- `apiKeyRef` 必须是环境变量名形状 `^[A-Za-z_][A-Za-z0-9_]*$`。
- **`deepseek-api-key` 连字符非法**，UI 侧默认值需改为 `DEEPSEEK_API_KEY`。
- `deriveKeyRef('deepseek-official')` = `DEEPSEEK_OFFICIAL_API_KEY`，**不要用它**。
- **无 credentials seam 时捕获异常，回落 `NO_KEY`**，测试要覆盖这条。
- **已实测（阶段 0）**：本机 `resolve('DEEPSEEK_API_KEY')` 命中，`source: 'env'`，`valueLength: 35`。
- **已实测**：`describe('DEEPSEEK_API_KEY')` → `{ configured: true, source: 'env', writable: false }`。
  **环境层只读**，所以卡片**不许**把 `apiKeyRef` 做成「覆盖宿主凭据」的入口。

### 3.2 端点独立

自带 `baseUrl`，不继承 `llm-deepseek` 的端点。

理由：官方 `web-search-deepseek` 刻意不继承 —— 辅助端点独立于对话适配器选择的协议，对话适配器可能切协议，余额端点不应跟着变。

### 3.3 数据通道选 `connection.fetch`

所有 HTTP 端点走 `ctx.connection.fetch.register`。物理载体已先施加信任与浏览器鉴权，余额与 Key 都是敏感面。

**真实签名**：

```ts
export interface ConnectionFetchRoute {
  path: string                                        // 必须含 /api 前缀，实现按完整 pathname 精确匹配
  methods: readonly ('GET' | 'HEAD' | 'POST')[]       // 空数组 / 重复项注册即抛
  requestBody: 'buffered' | 'streaming'               // 必填
  fetch: (request: Request) => Promise<Response>      // WHATWG 类型，必须 return Response
}
register(route: ConnectionFetchRoute): () => Promise<void>   // 返回异步 disposer
```

```ts
ctx.inject(['connection'], (connectionCtx) => {
  ctx.effect(() => connectionCtx.connection.fetch.register({
    path: '/api/v1/balance',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => new Response(JSON.stringify(view), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  }), 'ds-balance: http routes')
})
```

**规则**：

- `path` 写死精确路径，**不写尾随斜杠，不依赖归一化**（实现是 Map 精确键匹配）。
- 用 `ctx.effect` 包住，让 disposer 随 fiber 卸载。

**禁止**：不走 `ctx.webServer.register`（无鉴权）；不走 Typert `@Remote`（第三方成本高）。

### 3.4 只挂 Core

本版只挂 Core，不挂 Estimation。

---

## 四、领域模型

### 4.1 Money

```ts
const SCALE = 100_000_000n
type Units = bigint

function parseMoney(input: string | number): Units
function formatMoney(units: Units, decimals?: number): string
function addMoney(a: Units, b: Units): Units
function subMoney(a: Units, b: Units): Units
function cmpMoney(a: Units, b: Units): -1 | 0 | 1
```

规则：

- `parseMoney` 只接受 `^-?\d+(\.\d+)?$`。
- 超过 8 位小数**截断，不四舍五入**。
- 解析失败抛 `ParseError`，**不静默归 0**。
- `formatMoney` 默认 8 位给 API，2 位给 UI。

### 4.2 Balance

```ts
type Currency = string

interface BalanceInfo {
  currency: Currency
  total: Units
  granted: Units
  toppedUp: Units
}

interface BalanceSnapshot {
  snapshotId: string       // ULID
  accountTag: string       // HMAC(serverSalt, apiKey) 前 32 hex
  fetchedAt: number
  isAvailable: boolean
  balances: BalanceInfo[]
  source: 'deepseek-http'
  raw: unknown             // 原始响应，审计用
}

type CacheState = 'empty' | 'ok' | 'stale' | 'error'
type Severity = 'ok' | 'warn' | 'critical' | 'unavailable' | 'unknown'

interface ThresholdPair { warn: Units; critical: Units }

interface BalanceView {
  state: CacheState
  stale: boolean
  fetchedAt: number | null
  ageMs: number | null
  isAvailable: boolean | null
  balances: BalanceInfo[]
  selected: { currency: Currency; total: Units } | null
  severity: Severity
  thresholds: Record<Currency, ThresholdPair>   // 按币种分
  error: ErrorInfo | null
}
```

### 4.3 Errors

```ts
type ErrorCode =
  | 'NO_KEY'
  | 'NO_NETWORK'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_401' | 'UPSTREAM_402' | 'UPSTREAM_422' | 'UPSTREAM_429'
  | 'UPSTREAM_4XX' | 'UPSTREAM_5XX' | 'UPSTREAM_503'
  | 'PARSE_ERROR' | 'SHAPE_ERROR'
  | 'COOLDOWN' | 'CONFLICT' | 'VALIDATION'
  | 'UNAUTHORIZED' | 'NOT_FOUND' | 'STORAGE_ERROR'

interface ErrorInfo {
  code: ErrorCode
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}
```

前端只需处理 `NO_KEY`，其余落到通用错误文案。完整枚举已就位，供未来细分。

---

## 五、端口

### 5.1 DeepSeekClient

```ts
interface RawBalanceResponse {
  is_available: boolean
  balance_infos: Array<{
    currency: string
    total_balance: string
    granted_balance: string
    topped_up_balance: string
  }>
}

interface DeepSeekClient {
  fetchBalance(opts: {
    baseUrl: string; apiKey: string; timeoutMs: number; signal?: AbortSignal
  }): Promise<RawBalanceResponse>

  testConnection(opts: {
    baseUrl: string; apiKey: string; timeoutMs: number
  }): Promise<TestConnectionResult>
}
```

### 5.2 CoreStore

```ts
interface CoreStore {
  saveSnapshot(s: BalanceSnapshot): Promise<void>
  loadLatestSnapshot(accountTag: string): Promise<BalanceSnapshot | null>
  health(): Promise<{ ok: boolean; detail?: string }>
}
```

**实现走官方存储接缝**，见 §10。配置不在这里 —— 配置归 `ctx.settings`。

### 5.3 Clock / Logger / Metrics

```ts
interface Clock { now(): number; timezone(): 'Asia/Shanghai' }
interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}
interface Metrics {
  counter(name: string, labels?: Record<string, string>): void
  gauge(name: string, labels: Record<string, string>, value: number): void
  histogram(name: string, labels: Record<string, string>, value: number): void
}
```

---

## 六、应用服务

### 6.1 KeyResolver

```ts
class KeyResolver {
  async resolve(): Promise<string>
  accountTag(key: string): string
}
```

解析顺序见 §3.1。规则：

- `serverSalt` 存在**存档目录**下的 `.salt`（路径用 `dshHomePath()` 拼，见 §10），不存在则生成 32 字节随机，文件权限 `0o600`。
- `accountTag` 只作账本作用域标识，**不落明文**；日志只记前 8 位。
- 换 key 自动开新账本。

### 6.2 ConfigService 与 schema

**字段名与 [UI 侧契约与移交](ui-handoff.md) 第六节逐字一致，共 11 个。**

```ts
const Config = z.object({
  // 连接
  apiKey: z.string().role('secret').default(''),
  apiKeyRef: z.string().role('credential-ref').default('DEEPSEEK_API_KEY'),
  baseUrl: z.string().default('https://api.deepseek.com'),

  // 刷新
  serverRefreshSeconds: z.natural().min(10).max(3600).default(60),
  clientPollSeconds: z.natural().min(5).max(600).default(30),
  manualRefreshCooldownSeconds: z.natural().min(0).max(600).default(30),

  // 展示
  displayCurrency: z.string().default('auto'),

  // 阈值
  cnyWarn: z.number().min(0).default(10),
  cnyCritical: z.number().min(0).default(5),
  usdWarn: z.number().min(0).default(2),
  usdCritical: z.number().min(0).default(1),
})
```

`z` 来自 **`@deepseek-ai/schemastery`**，不是 zod。

**`timeoutMs` 不在 schema 里**：

```ts
const DEFAULT_TIMEOUT_MS = 8000
function timeoutMs(): number {
  const raw = Number(process.env.DS_BALANCE_TIMEOUT_MS)
  return Number.isFinite(raw) && raw >= 1000 && raw <= 60000 ? raw : DEFAULT_TIMEOUT_MS
}
```

环境变量覆盖，**UI 不暴露**。

**`apiKeyRef` 的正则在 schema 里强制**：`/^[A-Za-z_][A-Za-z0-9_]*$/`。

### 6.3 BalanceService

核心状态：

```ts
interface CacheEntry {
  state: CacheState
  snapshot: BalanceSnapshot | null
  fetchedAt: number | null
  lastErrorAt: number | null
  error: ErrorInfo | null
  consecutiveFailures: number
  inflight: Promise<BalanceView> | null
}
```

方法：

```ts
class BalanceService {
  async getView(opts?: { force?: boolean; currency?: string }): Promise<BalanceView>
  async forceRefresh(reason: string): Promise<RefreshResult>
  state(): CacheState
}
```

`getView` 的核心逻辑：有 inflight 就 join；不 force 且未过期就返回缓存；否则发起拉取。失败时若已有快照则转 `stale`，否则 `error`；只在**首次失败**打 warn，避免日志刷屏。

`isFresh` 判据：`state === 'ok'` 且 `now - fetchedAt < serverRefreshSeconds * 1000`。

`forceRefresh` 先查冷却（`manualRefreshCooldownSeconds`），冷却中返回 `{ triggered: false, cooldownMs }`；有 inflight 则返回 `{ triggered: true, joined: true }`。

### 6.4 Scheduler

**`setTimeout` 链，不用 `setInterval`。**

- 首拉延迟 1s。
- 正常间隔 `serverRefreshSeconds * 1000`，带 ±20% 抖动。
- 失败指数退避：`min(300_000, 5_000 * 2 ** consecutiveFailures)` + 抖动。
- 缺 key 时 5s 快速重试。
- 429 / 503 带 `Retry-After` 时优先用它。
- 配置更新后 `reset()`。

---

## 七、关键算法

### 7.1 归一化

```ts
function normalize(raw: RawBalanceResponse, accountTag: string, now: number): BalanceSnapshot
```

- 结构不符抛 `ShapeError`（`raw` / `is_available` / `balance_infos` 逐项校验）。
- 金额解析失败抛 `ParseError`。
- **不静默归 0。**

### 7.2 多币种选择（后端权威）

```ts
function pickBalance(balances: BalanceInfo[], preferred?: string): BalanceInfo | null
```

- 空数组 → `null`。
- **稳定排序**：`CNY` 优先，其余保持原有相对顺序，消除数组跳变的影响。
- `preferred`（来自前端的 `displayCurrency` 查询参数）不为 `auto` 时：命中且 `total > 0` 就用它。
- 默认链：`CNY 且 > 0` → 任一 `> 0` → `CNY` → 第一个 → `null`。

**前端不再自己挑**，只读 `selected`。

### 7.3 severity 判定

```ts
function severityOf(
  selected: BalanceInfo | null,
  isAvailable: boolean,
  thresholds: ThresholdPair,
): Severity
```

- `selected === null` → `unknown`。
- `isAvailable === false` → `unavailable`（**优先于阈值**）。
- `total <= critical` → `critical`。
- `total <= warn` → `warn`。
- 否则 `ok`。

阈值按币种取（`CNY` / `USD` 从配置读，其它币种 `{warn: 0, critical: 0}`），**每次计算时重读**。

返回 `unavailable` 时 `isAvailable` 同时为 `false`。

### 7.4 错误分类

按异常类型与 HTTP 状态映射到 §4.3 的 `ErrorCode`：

- `NoKeyError` → `NO_KEY`（不可重试）
- 超时 → `UPSTREAM_TIMEOUT`（可重试）
- 网络不可达 → `NO_NETWORK`（可重试）
- 401 → `UPSTREAM_401`（不可重试）
- 402 → `UPSTREAM_402`（不可重试）
- 422 → `UPSTREAM_422`（不可重试）
- 429 → `UPSTREAM_429`（可重试，带 `retryAfterMs`）
- 503 → `UPSTREAM_503`（可重试，带 `retryAfterMs`）
- 其它 5xx → `UPSTREAM_5XX`（可重试）
- 其它 4xx → `UPSTREAM_4XX`（不可重试）
- `ParseError` → `PARSE_ERROR`；`ShapeError` → `SHAPE_ERROR`
- 存储异常 → `STORAGE_ERROR`（可重试）
- 兜底 → `STORAGE_ERROR`

### 7.5 错误体容错解析

官方错误体未文档化，至少两种格式。解析顺序：

1. `{ error: { type | code, message } }`
2. `{ detail: "..." }`
3. `{ message: "..." }`
4. 兜底：`JSON.stringify(body).slice(0, 200)`

JSON 解析失败时退回纯文本前 200 字符。

---

## 八、HTTP API

### 8.1 通道

全部走 `ctx.connection.fetch.register`，注册写法见 §3.3。

### 8.2 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/balance` | 读余额视图 |
| POST | `/api/v1/balance/refresh` | 强制刷新 |
| GET | `/api/v1/config` | 读配置（掩码） |
| PUT | `/api/v1/config` | 改配置 |
| POST | `/api/v1/test-connection` | 测连接 |
| GET | `/api/v1/healthz` | 健康 |

**所有 `path` 写死精确值，不带尾随斜杠。**

### 8.3 `GET /api/v1/balance`

**Query**：`currency`（可选；前端传 `displayCurrency`）

**响应 200**：

```json
{
  "requestId": "req_...",
  "schemaVersion": 1,
  "state": "ok",
  "stale": false,
  "fetchedAt": 1760000000000,
  "ageMs": 12000,
  "isAvailable": true,
  "accountTag8": "a1b2c3d4",
  "balances": [
    { "currency": "CNY", "total": "110.00000000", "granted": "10.00000000", "toppedUp": "100.00000000" }
  ],
  "selected": { "currency": "CNY", "total": "110.00000000" },
  "severity": "ok",
  "thresholds": {
    "CNY": { "warn": "10.00000000", "critical": "5.00000000" },
    "USD": { "warn": "2.00000000", "critical": "1.00000000" }
  },
  "error": null
}
```

**状态码始终 `200`**，业务错误走 `state` + `error`。理由：UI 需要拿到 `error` 结构展示，不应被 HTTP 错误吞掉。

### 8.4 `POST /api/v1/balance/refresh`

请求 `{ "reason": "manual" }`；响应 `{ triggered, joined, cooldownMs, state }`。

### 8.5 `GET /api/v1/config`

返回掩码后的配置。**`apiKey` 永不返回，只返回 `apiKeyMasked`。**
另回一段 `credential`（`{ ref, configured, source, writable }`），形状逐字对齐官方
`credentialProvider.describe()`：**只有三个事实，没有装值的槽**。界面靠它决定凭据字段是
「可编辑」还是「由启动环境提供（只读）」。凭据端口缺席或 `describe` 失败时回 `null`。

### 8.6 `PUT /api/v1/config`

请求为任意字段子集；校验失败 `422`；成功后调用 §9.4 的钩子。

### 8.7 `POST /api/v1/test-connection`

请求 `{ baseUrl, apiKey?, timeoutMs? }`；**不动活动缓存**。成功返回延迟与余额预览，失败返回 `code` + `message`。

### 8.8 `GET /api/v1/healthz`

返回 `state` / `lastSuccessAt` / `consecutiveFailures` / `scheduler.nextRunAt` / `store.ok` / `version`。

---

## 九、配置与集成

### 9.1 注册设置命名空间

```ts
ctx.inject(['settings'], (settingsCtx) => {
  settingsCtx.settings.register(SETTINGS_NAMESPACE, Config, { base: baseConfig })
})
```

- **`base` 是值**（`Partial<T>`），不是字符串。
- schema 是 **schemastery**（`import z from '@deepseek-ai/schemastery'`）。
- 返回 `SettingsScope`（`get` / `watch` / `update` / `replace`），**不是 disposer**；注册本身挂在 caller fiber 的 effect 上。
- namespace `ds-balance` 必须匹配 `/^[a-z][a-z0-9-]*$/`。
- 需要跨字段校验时用 `validate`（抛错即拒绝写入）；`applies` 默认 `'live'`。

**本插件是常驻 owner，用 `register`；`installSection` 是给「provider 缺席要回落」的可选消费者用的。**

### 9.2 注入

```ts
export const inject = ['settings', 'credentials', 'connection']
```

- 三个服务名都真实存在。
- `connection` 的类型声明包叫 `@deepseek-ai/dsh-client-connection`（名字带 client，实际是宿主半边）。
- **`connection` 只保证注册表在；HTTP 可达性依赖组合里有没有 webServer。**
- **无 credentials seam 时捕获异常，回落 `NO_KEY`。**

### 9.3 生命周期

```ts
ctx.effect(() => {
  scheduler.start()
  const disposeHttp = registerHttpRoutes(ctx, core)
  return () => {
    scheduler.stop()
    disposeHttp()
    store.close()
  }
}, 'ds-balance')
```

**存储句柄必须由调用方关闭**：facility 不绑消费方 fiber。

### 9.4 配置变更

**用 `scope.watch`**，它只关心自己那一节、拿的是**解析值**、自带 disposer：

```ts
const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, Config, { base: baseConfig })
scope.watch((next, prev) => {
  configService.apply(next)
  scheduler.reset()
})
```

需要进程级关心任意 namespace 时才用 `ctx.on('settings/updated', (ns, next, prev, source) => ...)`。

`settings/document-updated` 的签名是 **`(ns, revision)` 两个参数**（不是对象），只在「需要知道 revision 过期」时才用。

---

## 十、存储

### 10.0 生命周期（已实测）

**用 `ctx.effect` 注册 `domain.close()` 就是正确写法，不需要把句柄提到模块级复用。**

阶段 0 在宿主进程里做了两代 apply：第一代 `open` 成功 → patch 行置 `disabled` 触发 disposer → `close()` 成功 → 重新启用 → **同名 domain 再 `open` 成功**。

源码印证：`reserved` 只在 `close()` 的 `onClosed` 钩子里释放，注释原文「only then does the name free up for reopening」。

**必须吸收打开失败、不留未观察的 rejection** —— 已装插件的源码注释说它曾把整个宿主拖下水。

### 10.1 用官方接缝，不自建 sqlite

`ctx.storageDomain.open(spec) → Promise<Domain<S>>`。

- **后端路由归部署方**：`spec.backend` 必填，插件**不能自己选 sqlite**。
- **默认组合只有 json 后端**：base bundle 挂 `dsh-storage` + `dsh-storage-json` + `dsh-storage-domain(backend: json)`；落点 `$DSH_HOME/storages/`。
- **`open` 每进程只能一次**，重名抛 `DomainError('already-open')`。
- **schema 分裂**：插件配置是 schemastery，**domain 内部记录 schema 是 zod**。

可照抄的现行先例：已装第三方插件 `dsh-usage-statistics-panel/src/store.ts` 用 `defineDomain` + `domainTable` + `ctx.open(domain)`，落盘 `$DSH_HOME/storages/usage_history.json`。

### 10.2 域定义

> 下例的**字段形状以已装插件的真实用法为准** —— 本文没有逐字转录 `defineDomain` / `domainTable` 的类型定义。
> 实现时打开 profile 里已装插件 `dsh-usage-statistics-panel` 的 `src/store.ts` 照抄，不要照抄本文的示意。
> （该包在 `<DSH_HOME>/profiles/<profile>/node_modules/` 下。）

```ts
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const balanceSnapshots = domainTable({
  name: 'balance_snapshots',
  // 记录 schema 用 zod
})

export const dsBalanceDomain = defineDomain({
  name: 'ds-balance',
  backend: 'json',        // 部署方决定的默认；不要写死 sqlite
  tables: [balanceSnapshots],
})

const domain = await ctx.open(dsBalanceDomain)
```

### 10.3 记录内容

每条快照记录：`snapshotId` / `accountTag` / `fetchedAt` / `isAvailable` / `balances`（币种 + 三个金额，字符串形式）/ `raw`。

### 10.4 保留策略

- 快照：90 天。
- 配置：**不在这里** —— 归 `ctx.settings`，永久。
- 超期由实现方在写入路径上清理。

### 10.5 路径

**一律用 `@deepseek-ai/dsh-home-paths`**：

```ts
import { resolveDshHome, dshHomePath, dshCachePath, dshHomeDisplay } from '@deepseek-ai/dsh-home-paths'
```

**不要自己读 `process.env.DSH_HOME`** —— 会漏掉显式配置层与空白值处理。

存储落点由 `ctx.storageDomain` 决定（`$DSH_HOME/storages/`），**不要自建 `$DSH_HOME/ds-balance/`**。

只有 `.salt` 这类非记录型文件才由自己落盘，路径用 `dshHomePath()` 拼。

---

## 十一、安全

| 项 | 措施 |
|---|---|
| 密钥 | 只经 KeyResolver；不落日志；不返前端 |
| accountTag | HMAC-SHA256(serverSalt, apiKey) 前 32 hex |
| serverSalt | 权限 `0o600`，路径由 `dshHomePath()` 拼 |
| HTTP | 走 `connection.fetch`（自带鉴权与信任） |
| 配置回传 | `apiKey` 只回掩码 |
| 日志脱敏 | accountTag 只记前 8 位 |

---

## 十二、可观测

日志字段：`ts` / `level` / `event`（如 `balance.fetch.ok`）/ `accountTag8` / `state` / `durationMs`。

指标：

| 名称 | 类型 | 标签 |
|---|---|---|
| `balance_fetch_total` | counter | `result` |
| `balance_fetch_duration_ms` | histogram | — |
| `cache_state` | gauge | `state` |
| `force_rejected_total` | counter | — |

---

## 十三、测试

| 层 | 类型 | 覆盖 |
|---|---|---|
| Money | 单元 | 解析、格式化、往返 |
| normalize | 单元 | 结构校验、多币种、非法金额 |
| pickBalance | 单元 | 顺序跳变、偏好、空数组 |
| severityOf | 单元 | 5 档 + 阈值边界 |
| classify | 单元 | 全部错误码 |
| parseErrorBody | 单元 | 三种变体 + 未知 |
| BalanceService | 单元 + mock 端口 | 状态机、inflight、stale |
| Scheduler | 单元 + fake clock | 退避、抖动、缺 key |
| KeyResolver | 单元 | **无 credentials seam → NO_KEY** |
| HttpDeepSeekClient | 集成 + msw | 200 / 401 / 429 / 5xx |
| HTTP routes | 集成 | 契约快照 |

关键用例：官方 200 fixture 归一化正确；401 两种变体解析正确；429 带/不带 `Retry-After`；乱序快照不重复记账；金额解析与格式化往返一致。

---

## 十五、需要一并修的 UI 侧（五条）

| # | 文件 | 修正 |
|---|---|---|
| 1 | `src/client/model.ts` | 删掉 `selectCurrency` 的挑选逻辑，改读 `response.selected` |
| 2 | `src/client/index.tsx` / 数据层 | 把 `displayCurrency` 作为查询参数传给后端 |
| 3 | `src/client/sidebar/SidebarBalance.tsx` | 币种不匹配判定改用 `selected.currency` vs 配置值（UX 不变） |
| 4 | `src/client/mock/scenarios.ts` | 让 `selected` 与 `displayCurrency` 自洽（`currencyMismatch` 场景已覆盖） |
| 5 | `src/index.ts` | `apiKeyRef` 默认值改 `'DEEPSEEK_API_KEY'`；`inject` 加 `'credentials'`；`installSection` 换 `register` |

**`src/client/api-types.ts` 不用改** —— `thresholds` 已按币种分，`isAvailable` 已是纯 `boolean`。

---

## 十六、待验证（实现阶段第一件事）

| # | 项 | 做法 | 不成立时 |
|---|---|---|---|
| 1 | `credentials.resolve('DEEPSEEK_API_KEY')` 是否命中 | **阶段 0 实测** | 走 env；再不行 → `NO_KEY` |
| 2 | 无 credentials seam 的行为 | 装配测试 | 捕获异常，回落 `NO_KEY` |
| 3 | 401 错误体确切格式 | 无效 key 请求 | 多路径解析（§7.5） |
| 4 | 429 是否带 `Retry-After` | 高频请求 | 无则指数退避 |
| 5 | 余额更新延迟 | 调用后立即拉 | 显示 `ageMs` |
| 6 | 多币种返回顺序 | 多次请求 | 稳定排序（§7.2） |

**fetch 路由的 `path` 不做归一化依赖**：写死精确路径，不带尾随斜杠。

---

## 十七、明确不做

- Estimation（账本 / 投影 / 定价 / 融合估算）
- 诊断层 UI、独立页面、图表
- 多厂商模板（仅 DeepSeek）
- SSE、手工校正

---

## 十八、参考

- UI 契约 → [UI 侧契约与移交](ui-handoff.md)
- 对照审查与定案 → [后端架构文档对照审查](backend-architecture-review.md)
- 模型融合判定 → [连接与官方模型机制的融合判定](model-integration-assessment.md)
- 架构设计 → [架构说明](ARCHITECTURE.md)
- 决策记录 → [.agents/notes/](../.agents/notes/)

---

## 十九、实现细则（维护者补充 7 条）

1. **凭据轮换 → `accountTag` 变 → 旧快照失配**：加载快照时 tag 不匹配**视为空，不混用**。
2. **`role('secret')` 的 redact 是自动还是手动**：`GET /api/v1/config` 是自己构造响应、不走 settings 读 —— **实现时必须先确认掩码是否自动生效**；不自动就手动掩。
3. **handler 每次读最新 config**：配置是动态的（`scope.watch` 更新），闭包捕获旧配置会让用户改了阈值不生效。
4. **handler 内部异常不能抛**：契约规定余额错误走 `200 + state: error`；抛出去会被宿主包成 500，前端拿不到 `error` 结构。**必须自己 catch 所有异常。**
5. **`.salt` 丢失 → `accountTag` 全变 → 旧账本孤立**：文档写明，或改成从固定源派生。
6. **UI 五条改动的先后顺序**：**先 mock → 再 `model.ts` → 再组件**。顺序错了 mock 场景会全崩。
7. **`DS_BALANCE_TIMEOUT_MS` 每次请求读**：改环境变量后立即生效，不用重启。

### 阶段 0 实测结论（已并入 §3.1 / §9.2 / §10）

- `credentials.resolve('DEEPSEEK_API_KEY')` **命中**：`source: 'env'`、`writable: false`。**「凭据继承官方」成立。**
- `writable: false` 的设计含义：**卡片不让用户覆盖宿主凭据**；`apiKey` 是插件自己的设置项，**两者语义分清**。
- 存储域 × 热重挂**通过**：`close()` 释放 `reserved`，热重挂先拆后建。用 `ctx.effect` 关闭即正确。
- `connection.fetch` 的 `/api` 可达性**成立**（组合里挂了 webserver）。

