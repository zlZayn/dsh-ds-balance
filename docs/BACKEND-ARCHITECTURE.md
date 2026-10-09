# 后端架构（修正版）

> 本文是**后端契约的 home**：领域模型、端口、应用服务、HTTP API、配置、存储、安全与可观测。
> **不变的设计与防错清单不在这里** → [ARCHITECTURE.md](ARCHITECTURE.md)。
> 来源：架构师原稿 + 本仓[后端架构文档对照审查](../.agents/notes/backend-architecture-review.md)的九条修正。

## 〇、一句话任务

在现有 UI 基础上实现后端：读取 DeepSeek 官方余额，通过 `ctx.connection.fetch` 暴露给前端，产出 [UI 侧契约与移交](UI-HANDOFF.md) 定义的契约形状。

**不做 Estimation**（账本 / 投影 / 估算）—— 那是第二版。

---

## 一、与 UI 的边界

### 1.1 UI 消费什么

| 字段 | 类型 | 说明 |
|---|---|---|
| `situation` | 闭集 11 个取值 | **界面唯一的分支入口**：环 / 文案 / 来源标签都由它派生 |
| `state` | `empty` / `ok` / `stale` / `error` | 缓存状态（**兼容字段**，新界面不据它拼形态） |
| `severity` | `ok` / `warn` / `critical` / `unavailable` / `unknown` | 「有数字那一族」的颜色（同上） |
| `balances[]` | 数组 | 全币种 |
| `selected` | 对象或 `null` | **后端选定的币种；前端直接读它，不再自己挑** |
| `isAvailable` | **纯 `boolean`** | 账户可用性（参与处境判定） |
| `ageMs` | number 或 `null` | 后端算好的年龄 |
| `error.code` | 字符串或 `null` | 错误码（参与处境判定） |
| `fetchedAt` | number 或 `null` | 时间戳 |

**`selected` 的权威性**：前端把 `displayCurrency` 作为查询参数传给后端，后端按它挑，前端只负责显示。

**币种不匹配的判定**在 UI 侧用 `selected.currency` 与配置的 `displayCurrency` 比较得出（浮层一段说明 + **一个动作**「改用 X」，它直接写设置作用域的 `displayCurrency`；去插件页的入口在浮层标题行右端）。

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
- `state` 与 `severity` 是**两个独立维度**，但**都不再由界面直接消费** ——
  它们与 `isAvailable` / `error.code` 一起进 `situationOf`，界面只读判出来的 `situation`。
  保留这两个字段是为了旧客户端能活（两半体的装载时机不同）。
- `situation`、`severity`、`state` 都是**闭集**，未知回落。

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
  pruneByTag(accountTag: string, keepN: number): Promise<number>
  health(): Promise<{ ok: boolean; detail?: string }>
}
```

`loadLatestSnapshot` 与 `pruneByTag` 都是 **tag 作用域**：按账本分桶、只动自己那个桶。
`keepN` 由领域层传入 —— 端口只执行「留几条」，不决定该留几条。
保留策略见 §10.4。

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

**字段名与 [UI 侧契约与移交](UI-HANDOFF.md) 第六节逐字一致，共 11 个。**

```ts
const Config = z.object({
  // 连接
  apiKey: z.string().role('secret').default(''),
  apiKeyRef: z.string().role('credential-ref').default('DEEPSEEK_API_KEY'),
  baseUrl: z.string().default(''),          // 留空 = 官方默认地址；空串只在 endpointOf 翻译一次

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

`forceRefresh` 先查冷却（`manualRefreshCooldownSeconds`）——**锚点是上一次手动刷新，不是上一次抓取**：调度与轮询也在抓，锚在 `snapshot.fetchedAt` 上会让一次自动刷新吞掉用户刚按下的一下。冷却中返回 `{ triggered: false, cooldownMs: 剩余毫秒 }`；有 inflight 则返回 `{ triggered: true, joined: true }`；时刻取**决定触发那一刻**，比客户端「拿到结果那一刻」早一个往返。

**来源选择（两条官方取数路）**：服务的形态是**门面 + 每来源一份账本**（`SourceLedger`）——
门面只决定「这一轮谁活跃」，账本各自持快照、状态、失败退避与手动冷却，互不影响。
判据是四层回落：

1. 客户端带上来的**当前会话路由**（`provider` 提示）；
2. **全局默认路由**（宿主 `agentDefaultModel.currentSelection().provider`）；
3. **固定顺序** `FALLBACK_ORDER`（Key 优先，账号兜底）；
4. 一条都不可用 → 回默认来源，由它自然报 `NO_KEY`。

**本插件只记官方那一个数字**，所以读到的数据还会再兜一次底：

- 首选那条拿不出数字 → 按 `FALLBACK_ORDER` 退到另一条官方路（**有旧快照也算**，显示旧快照胜过画叉）；
- **两条都拿不出数字**，才回到默认来源、由它报 `NO_KEY`（那时界面才提示）；
- 一轮最多「首选一次 + 兜底一次」，**不来回重试**（ping-pong）。

**展示 / 刷新 / 标签只认同一条**：哪条把数字交出去（`mark(served)`），响应里的 `source` 就是它，
调度与手动刷新也刷它。手动刷新因此刷的是「用户看到的那条」—— 首选那条一条数字都没有时，刷的是兜底那条。

**严重度分两种「看不到」，处境把它落成两个取值**（判定在 `src/domain/situation.ts` 的 `situationOf`）：

- 一条凭据都没有（`NO_KEY`、无快照）→ **`no-credential`**：空环 + 中心**＋**，文案「尚未配置凭据」；
- 有凭据但这次没抓到（网络 / 上游 / 账号查询失败）→ **`fetch-failed`**：叉，文案「读不到余额」。
  这一句**刻意不带「暂时」**：它接住的错误码里既有等一等就好的（网络 / 超时 / 429 / 5xx），
  也有**等不好的**（`UPSTREAM_401` key 失效、`UPSTREAM_402` 欠费）—— 对后者说「暂时」是有害的假话；
- 账户停用（`isAvailable: false`）→ **`account-unavailable`**：叉，文案「账户不可用」。
  它与 `critical`（余额恰好为 0）都画红环，**分开它们的是那个叉** —— 收起态没有文案，
  环必须自己把两种处境说开（不变量见 [决策记录](../.agents/notes/2026-10-01-ring-must-tell-situation-apart.md)）。

**处境是界面唯一的分支入口**（11 个取值，宿主判 9 个、客户端补 `checking` / `offline`）。
它的输出同时决定环、文案与来源标签 —— 从前那三样各读各的字段，于是会出现
「环说 A、文案说 B」。两条刻意的优先级：

- **没接入压过一切**：NO_KEY **且无快照**才是 `no-credential`；有快照说明曾经读到过，那就不是「没接入」。
- **账户停用压过「数据已过期」**：`isAvailable: false` 有快照即判 `account-unavailable` ——
  上游明确给的事实比「数字旧了」更强，说后者的原文案会把真问题藏起来。

调度刷**当前活跃来源**（不重新解析，否则会话级的来源会被全局默认无声顶掉），
并在发现活跃来源不可用时重判一次 —— 宿主刚起来时判据可能还没齐：
**「服务已注册」不等于「它自己的凭据已可读」**，那一刻只按兜底走，下一轮自愈。
判据只有一处：`src/services/source-selector.ts`；新增一个来源 = 那里加一行 + 装配处多一份 reader 与账本。

### 6.4 Scheduler

**`setTimeout` 链，不用 `setInterval`。**

- 首拉延迟 1s。
- 正常间隔 `serverRefreshSeconds * 1000`，**单边抖动**（`jitterWithin`）：落在 `[base × 0.8, base - 1s]`。
  上界必须留在缓存窗口之内，否则窗口先过期、界面轮询会替它代打一次，紧接着这一轮 tick 又打一次。
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

**Query**：`currency`（可选；前端传 `displayCurrency`）、`provider`（可选；客户端把**当前会话在用的模型路由**当提示带上）。

`provider` 只当提示：认不出来或没给，就按全局默认路由判；两条路都不可用时按固定顺序回落（Key 优先）。
选源规则见 §6.3，来源写在响应的 `source` 字段里。

**响应 200**：

```json
{
  "requestId": "req_...",
  "schemaVersion": 1,
  "source": "deepseek-http",
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

`source` 取 `deepseek-http`（API Key 那条）或 `deepseek-account`（账号登录那条）：界面据此在标题里标来源。
**判据是「这一份数字真的在屏幕上」**（`shown !== null`）：还没取到数时说「这份数字是哪来的」没有意义。

**状态码始终 `200`**，业务错误走 `state` + `error`。理由：UI 需要拿到 `error` 结构展示，不应被 HTTP 错误吞掉。

### 8.4 `POST /api/v1/balance/refresh`

请求 `{ "reason": "manual", "provider": "deepseek-account" }`（两个字段都可省略）；响应 `{ triggered, joined, cooldownMs, state }`。
`provider` 与读取端点同义：刷新要刷**用户正在看的那个来源**。

### 8.5 `GET /api/v1/config`

返回掩码后的配置。**`apiKey` 永不返回，只返回 `apiKeyMasked`。**
另回一段 `credential`（`{ ref, configured, source, writable }`），形状逐字对齐官方
`credentialProvider.describe()`：**只有三个事实，没有装值的槽**。界面靠它决定凭据字段是
「可编辑」还是「由启动环境提供」。凭据端口缺席或 `describe` 失败时回 `null`。

### 8.6 `PUT /api/v1/config`

请求为任意字段子集；校验失败 `422`；成功后调用 §9.4 的钩子。

### 8.7 `POST /api/v1/test-connection`

请求 `{ baseUrl, apiKey?, timeoutMs? }`；**不动活动缓存**。成功返回延迟与余额预览，失败返回 `code` + `message`。

### 8.8 `GET /api/v1/healthz`

返回 `situation` / `state` / **`source`（当前活跃来源）** / `lastSuccessAt` / `consecutiveFailures` / `scheduler.nextRunAt` / `store.ok` / `version`。
两条路并存时，`source` 是唯一能一眼看出「现在服务的是哪条」的地方；指标键也带 `source` 标签。
`situation` 让**不开浏览器也能知道界面此刻会画成什么**（判定口径与余额端点完全同源）。
`mark()` 还记 `balance_source_switch_total{from,to}` —— 来源切换刻意不给界面提示，那是唯一观测出口。

---

## 九、配置与集成

> **§9.1 / §9.4 已被取代（保留作历史）**：这一节写的是「向宿主登记一个设置命名空间」那套接缝 ——
> `ctx.settings.register`、它返回的 `SettingsScope`、以及 `scope.watch` 都已经被宿主删除。
> 现在的形态是：配置值以 `Volatile` 引用到达 `apply`，写回走 `ctx.settings.mutate(ENTRY_ID, ops)`，
> 变更通知走 `loader/volatile-update`。**活契约以代码为准**：`src/config.ts`（schema 与命名空间）、
> `src/index.ts`（装配与写回）、`src/services/config-service.ts`（端口形状，未变）。
> 为什么这么改、替代方案是什么 → [决策记录](../.agents/notes/2026-09-22-settings-seam-migration.md)。

### 9.1 注册设置命名空间（已被取代）

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

### 9.4 配置变更（已被取代）

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

可照抄的现行先例（**官方自用**）：宿主仓 `packages/workspace/workspace/src/spec.ts` 用
`defineDomain` + `domainTable` 声明域，`src/index.ts` 用 `ctx.storageDomain.open(spec)` 打开它 ——
官方自己的完整链路就在那里，不用去别处找样例。

### 10.2 域定义

> 下例的**字段形状以官方实现为准** —— 本文没有逐字转录 `defineDomain` / `domainTable` 的类型定义。
> 实现时对照宿主仓：规范看 `packages/storage/storage-domain/README.md`，
> 官方自用范例看 `packages/workspace/workspace/src/spec.ts`，不要照抄本文的示意。

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

**契约**（本文件只写契约；理由与被否方案见「为什么」那条指针）：

- 每个账本保留最近 **20** 条快照，常量 `SNAPSHOT_KEEP_N` 定义在
  [../src/domain/balance.ts](../src/domain/balance.ts)。**不是配置项。**
- **保留是按账本的，总量 = 20 × 账本数**。账本由 `accountTag` 决定，
  切换账号/凭据会开新账本，各留各的 20 条。
  ⇒ 文件里有上百条**不代表没清干净**，先数账本数。
- 超期清理有**两处**，缺一不可：
  - **写入路径**：`persist()` 落盘后调 `pruneByTag`（跨账本不动）。
  - **启动路径**：域 `open` 成功后、**任何读取之前**，把所有账本桶各修剪一次。
- **单次清理有上限**（适配器内部常量，不上端口）：每桶每次最多删一批，
  剩下的交给后续启动或写入路径。**单次启动的清理时间因此有确定上界**，
  但**总收敛时间取决于启动频率与写入频率，不是确定的短时间** ——
  收敛只保证「每次都有进展」，不保证「多久到终态」。

**为什么是 20 条、为什么不用时间维度、为什么必须有启动清理、单次上限为什么是 500、
以及七个被否方案与实测数字**：见[快照保留策略](../.agents/notes/2026-10-09-snapshot-retention.md)
的「决策」与「替代方案」两节 —— 那里是**理由与证据的唯一 home**，本文件不重抄，
否则改一处要跟两处。

实现层（分几批删、失败怎么处置、进度日志字段）见
[../src/adapters/README.md](../src/adapters/README.md) 的 `domain-core-store.ts` 一节。

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

## 十七、明确不做

- Estimation（账本 / 投影 / 定价 / 融合估算）
- 诊断层 UI、独立页面、图表
- 多厂商模板（仅 DeepSeek）
- SSE、手工校正

---

## 十八、参考

- UI 契约 → [UI 侧契约与移交](UI-HANDOFF.md)
- 对照审查与定案 → [后端架构文档对照审查](../.agents/notes/backend-architecture-review.md)
- 模型融合判定 → [连接与官方模型机制的融合判定](../.agents/notes/model-integration-assessment.md)
- 架构设计 → [架构说明](ARCHITECTURE.md)
- 决策记录与依据 → [.agents/notes/](../.agents/notes/)
