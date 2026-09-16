# 后端架构文档对照审查

审查对象：架构师转来的《ds-balance 后端架构》。
口径：**以实际情况为准** —— 代码与宿主实现是事实，文档写法有出入的地方以事实为准。
未写一行实现代码。

## 一句话结论

方向正确，六处引用的宿主 API 里 **4 处写法有出入、1 处用错信号、1 处完全一致**；另有 **4 处与现有 UI 契约的冲突**必须先定，否则实现出来对不上。

---

## 一、与宿主 API 的出入（按严重度）

### 1. 存储：文档的方案在默认组合下**根本跑不起来**（最严重）

文档 §10 打算用 `better-sqlite3` 直接写 `$DSH_HOME/ds-balance/core.db`。实际：

- **官方存储服务存在**：`ctx.storageDomain.open(spec) → Promise<Domain<S>>`。
- **后端路由归部署方**：`spec.backend` 必填，插件**自己选不了 sqlite**。
- **默认 profile 里没有 sqlite 后端**：`bundle/base/cordis.patch.yml` 只挂 `dsh-storage` + `dsh-storage-json`（根 = `dshHomePath('storages')`）+ `dsh-storage-domain`（`backend: json`）。全仓 `packages/bundle` 对 `storage-sqlite` **0 命中**。
- **官方 sqlite 用的是 Node 内置 `node:sqlite` 的 `DatabaseSync`**，不是 `better-sqlite3`。
- **`open` 每进程只能一次**：重名抛 `DomainError('already-open')`。
- **schema 分裂**：插件配置是 schemastery，**domain 内部的记录 schema 是 zod**。

绕过官方存储的代价（逐条）：

1. **原生模块 ABI**：`better-sqlite3` 是预编译 addon，要匹配 Node ABI / OS / arch；官方路线用内置模块，没有这层。
2. **沙箱不拦但也不保护**：`dsh-sandbox` 管的是模型发起的子进程，不管插件宿主代码。
3. **生命周期**：原生句柄不挂 `ctx.effect` 就泄漏；Windows 上还会锁 `.db` 文件。
4. **契约自负**：WAL、锁、迁移、损坏恢复、文件权限都要自己实现，官方后端已经处理好（文件 `0o600`、目录 `0o700`、版本失配直接拒绝）。
5. **路径不属于你**：自建 `$DSH_HOME/ds-balance/` 绕开统一的 `storages/` 落点与权限约定。

**可照抄的第三方先例**：`dsh-usage-statistics-panel/src/store.ts` 用 `defineDomain` + `domainTable` + `ctx.open(domain)`，落盘 `$DSH_HOME/storages/usage_history.json`。

**建议**：本版直接用官方 storage seam（json 后端足够），把 `better-sqlite3` 整条去掉。

### 2. `ctx.connection.fetch.register`（4 处出入）

| 文档 | 真实 |
|---|---|
| 只给 `path` / `methods` / `fetch` | **`requestBody: 'buffered' \| 'streaming'` 是必填** |
| `methods: ['GET']` | 只有 `'GET' \| 'HEAD' \| 'POST'`；空数组/重复项注册即抛 |
| `fetch: async (req) => {...}` | 入参是 **WHATWG `Request`**，**必须 return `Response`** |
| 未提返回值 | 返回 **异步 disposer** `() => Promise<void>` |

- `path` **必须含 `/api` 前缀**（文档写的 `/api/v1/balance` 是对的）。
- 真实用法是 `ctx.effect(() => ctx.connection.fetch.register({...}))`。
- **隐性前提**：`connection` 只保证注册表在；HTTP 可达性取决于组合里有没有 webServer。

### 3. `ctx.settings.register`（3 处出入）

| 文档 | 真实 |
|---|---|
| `{ base: 'ds-balance' }` | **`base` 是值（`Partial<T>`），不是字符串** —— 传字符串是类型错误 |
| zod 的 `z.object` | **schemastery** |
| 未提 `applies` / `validate` | `applies: 'live' \| 'restart'`（默认 `live`）、`validate` 做跨字段校验，抛错即拒绝写入 |

- 返回的是 `SettingsScope`（`get` / `watch` / `update` / `replace`），**不是 disposer**。
- namespace 必须匹配 `/^[a-z][a-z0-9-]*$/` → `ds-balance` 合法。
- **`installSection` 与 `register` 的关系**：`installSection` 内部就是 `register(ns, schema, { base: entry })` 加两个钩子。它是给「provider 缺席要回落」的**可选消费者**用的；**常驻 owner 应该用 `register`**。我们 UI 侧目前用的是 `installSection`，属于可简化项。

### 4. 配置变更信号：用错了（1 处）

- 文档用 `ctx.on('settings/document-updated', (evt) => ...)`，且把参数当成对象。
- 真实签名：`(ns: SettingsNamespace, revision: number) => void` —— **两个参数**。
- **更合适的信号**：
  - 注册了 namespace 的 owner 用 **`scope.watch((next, prev) => ...)`** —— 只关心自己那一节、拿的是解析值、自带 disposer。
  - 进程级关心任意 namespace 用 `ctx.on('settings/updated', (ns, next, prev, source) => ...)`。
  - `document-updated` 只适合「需要知道 revision 过期」的场景。

### 5. `$DSH_HOME`：漏了官方 helper（1 处）

有 `@deepseek-ai/dsh-home-paths`：`resolveDshHome` / `dshHomePath` / `dshCachePath` / `dshHomeDisplay`。

**不要自己读 `process.env.DSH_HOME`** —— 会漏掉显式配置层与空白值处理。

### 6. `inject: ['settings','credentials','connection']` —— 一致

三个服务名都真实存在。注意 `connection` 的类型声明包叫 `@deepseek-ai/dsh-client-connection`（名字带 client，实际是宿主半边）。

---

## 二、与现有 UI 契约的冲突（必须先定）

### ① `selected` 到底归谁

文档 §1.1 说它是「UI 必须消费的字段」—— **不成立**。客户端**从不读 `response.selected`**。

现状是**两个独立选择器**：

- 后端 `pickBalance()`：偏好 `CNY` 且 `total > 0`；
- 前端 `selectCurrency()`：按用户配置 + `balances` 数组首个。

**同一次响应可以显示成两个不同币种。**

二选一：把 `selected` 定为唯一权威（要改前端），或后端不产出它。

### ② `thresholds` 形状不一致

- 文档 §8.3：`{ "warn": "...", "critical": "..." }`（扁的）
- 我们的契约：`Record<currency, { warn, critical }>`（按币种分）

前端不消费它，但契约必须统一。

### ③ `timeoutMs` 是多出来的字段

文档说「字段名与 `ui-handoff.md` 逐字一致」，但它是 **12 个**，UI 与 handoff 都是 **11 个**。全仓 `timeoutMs` **0 命中** → 前端没有这个输入项。

### ④ `isAvailable` 可为 null？

文档 §1.1 写「boolean 或 null」，我们的类型是 `boolean`。

---

## 三、文档自己指出的两条，判断正确

| 文档 §15 | 核对结果 |
|---|---|
| `apiKeyRef` 默认值应为 `DEEPSEEK_API_KEY` | ✅ 对。现在是 `'deepseek-api-key'`，连字符非法 |
| `inject` 加 `'credentials'` | ✅ 对。现在只有 `['settings']` |
| 「若 UI 已显示 `apiKeyRef` 默认值，同步改」 | ⚪ **空操作** —— 客户端没有硬编码默认值，卡片直接读作用域快照 |

---

## 四、宿主自身的一处文档 bug（顺带发现）

`ConnectionFetchRoute.path` 的 JSDoc 写「Absolute path below `/api`」，与实现要求的「含 `/api` 的完整 pathname」矛盾。**以实现与测试为准**。

---

## 五、待验证

- `credentials.resolve('DEEPSEEK_API_KEY')` 在宿主是否命中（**唯一硬证据**，仍未实跑）。
- fetch 路由的 `path` 是否允许尾随斜杠 / 大小写差异（实现是 Map 精确键匹配、无归一化）。
- 无 credentials seam 时的行为。

---

## 六、未找到

- **未找到**默认组合挂载 `storage-sqlite` 的任何证据。
- **未找到**宿主对「插件写 `$DSH_HOME` 下自有目录」的明文禁令 —— 更像没有成文约束，而不是被允许。

---

## 参考

- 原始核验（临时目录，被 `.gitignore` 忽略）：`recon/16-backend-doc-api-verification.md`
- UI 侧契约 → [UI 侧契约与移交](ui-handoff.md)
- 模型融合判定 → [连接与官方模型机制的融合判定](model-integration-assessment.md)
- 架构设计 → [架构说明](ARCHITECTURE.md)
