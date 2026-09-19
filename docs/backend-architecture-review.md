# 后端架构文档对照审查（含定案）

审查对象：架构师转来的《ds-balance 后端架构》。
口径：**以实际情况为准** —— 代码与宿主实现是事实，文档写法有出入的地方以事实为准。
状态：**冲突已全部定案，未写一行实现代码。**

## 一句话结论

方向正确。六处宿主 API 里 **4 处写法有出入、1 处用错信号、1 处一致**；四处与 UI 契约的冲突**已定案**；最严重的一条是**存储方案在默认组合下跑不起来**。

---

## 一、已定案（维护者）

| # | 议题 | 定案 |
|---|---|---|
| 1 | `selected` 归谁 | **后端权威**。前端删掉自己的挑选逻辑，直接用 `response.selected`。`displayCurrency` 由前端传给后端，后端按它挑。**这是唯一需要改 UI 的地方。** |
| 2 | `thresholds` 形状 | **按币种分**：`{ CNY: {warn, critical}, USD: {warn, critical} }`。架构文档按这个改。 |
| 3 | `timeoutMs` | **不进 UI**。后端写死 8 秒；要调走环境变量。 |
| 4 | 注册写法 | **照实际签名**。 |
| 5 | `isAvailable` | **纯 `boolean`**，不可为 null。 |

### 方向（维护者给的，B 已按此查完）

| 项 | 定案 |
|---|---|
| `connection.fetch` | 以实际签名为准 |
| 存储 | **优先用 dsh 官方接缝 `ctx.storageDomain`**，不自己开 sqlite |
| 事件名 | 以实际为准 |
| `$DSH_HOME` | 有官方 helper 就用官方的 |

---

## 二、与宿主 API 的逐条对照

### 2.1 `ctx.connection.fetch.register`

| 项 | 文档 | 实际 | 定案 |
|---|---|---|---|
| 参数 | `path` / `methods` / `fetch` | **`requestBody: 'buffered' \| 'streaming'` 是必填** | 照实际 |
| `methods` | `['GET']` | 只有 `'GET' \| 'HEAD' \| 'POST'`；空数组/重复项注册即抛 | 照实际 |
| `fetch` | `async (req) => {...}` | 入参 **WHATWG `Request`**，**必须 return `Response`** | 照实际 |
| 返回值 | 未提 | **异步 disposer** `() => Promise<void>` | 用 `ctx.effect` 包 |
| `path` | `/api/v1/balance` | **必须含 `/api` 前缀** | 文档写法**正确** |
| 服务名 / inject | `connection` | 一致 | 照实际 |

**隐性前提**：`connection` 只保证注册表在；**HTTP 可达性取决于组合里有没有 webServer**。

### 2.2 `ctx.settings.register`

| 项 | 文档 | 实际 | 定案 |
|---|---|---|---|
| `base` | `'ds-balance'`（字符串） | **`Partial<T>` 的值** | 照实际（传字符串是类型错误） |
| schema | zod `z.object` | **schemastery** | 照实际 |
| 返回值 | 未提 | `SettingsScope`（`get` / `watch` / `update` / `replace`），**不是 disposer** | 照实际 |
| 其余选项 | 未提 | `applies: 'live' \| 'restart'`（默认 `live`）、`validate` 跨字段校验 | 按需 |

**`installSection` 与 `register` 的关系**：`installSection` 内部就是 `register(ns, schema, { base: entry })` 加两个钩子，它是给「provider 缺席要回落」的**可选消费者**用的。

- 本插件是**常驻 owner** → 应该用 **`register`**。
- 我们 UI 侧宿主半边现在用的是 `installSection`（`src/index.ts`），**属于可简化项**，不是错误。

namespace 必须匹配 `/^[a-z][a-z0-9-]*$/` → `ds-balance` 合法。

### 2.3 存储（文档最严重的一处）

文档 §10 打算用 `better-sqlite3` 直写 `$DSH_HOME/ds-balance/core.db`。实际：

- 官方接缝存在：`ctx.storageDomain.open(spec) → Promise<Domain<S>>`。
- **后端路由归部署方**：`spec.backend` 必填，插件**自己选不了 sqlite**。
- **默认组合里没有 sqlite 后端**：base bundle 只挂 `dsh-storage` + `dsh-storage-json`（根 `dshHomePath('storages')`）+ `dsh-storage-domain`（`backend: json`）。全仓 `packages/bundle` 对 `storage-sqlite` **0 命中**。
- **官方 sqlite 用 Node 内置 `node:sqlite`**，不是 `better-sqlite3`。
- **`open` 每进程只能一次**：重名抛 `DomainError('already-open')`。
- **schema 分裂**：插件配置是 schemastery，**domain 内部记录 schema 是 zod**。

**定案：用官方接缝。** 官方自用的完整链路就在宿主仓里：
`packages/workspace/workspace/src/spec.ts`（`defineDomain` + `domainTable` 声明）
→ `src/index.ts`（`ctx.storageDomain.open(spec)` 打开）；规范见
`packages/storage/storage-domain/README.md`。

绕过官方存储的代价（留档，解释为什么不这么做）：

1. **原生模块 ABI**：`better-sqlite3` 是预编译 addon，要匹配 Node ABI / OS / arch；内置模块没有这层。
2. **沙箱不拦也不保护**：`dsh-sandbox` 管的是模型发起的子进程，不管插件宿主代码。
3. **生命周期**：原生句柄不挂 `ctx.effect` 就泄漏；Windows 上还会锁 `.db` 文件。
4. **契约自负**：WAL、锁、迁移、损坏恢复、文件权限都要自己实现（官方后端已处理 `0o600` / `0o700` 与版本戳拒绝）。
5. **路径不属于你**：自建 `$DSH_HOME/ds-balance/` 绕开统一的 `storages/` 落点与权限约定。

### 2.4 `$DSH_HOME`

**用官方包 `@deepseek-ai/dsh-home-paths`**：`resolveDshHome` / `dshHomePath` / `dshCachePath` / `dshHomeDisplay`。

**不要自己读 `process.env.DSH_HOME`** —— 会漏掉显式配置层与空白值处理。

### 2.5 配置变更信号

| 项 | 文档 | 实际 | 定案 |
|---|---|---|---|
| 事件名 | `settings/document-updated` | 存在，签名是 `(ns, revision)` **两个参数** | 名字对，参数写法改 |
| 更合适的 | — | owner 用 `scope.watch((next, prev) => ...)` | **改用这个** |

- `scope.watch` 只关心自己那一节、拿的是**解析值**、自带 disposer。
- 进程级关心任意 namespace 用 `ctx.on('settings/updated', (ns, next, prev, source) => ...)`。
- `document-updated` 只适合「需要知道 revision 过期」的场景。

### 2.6 `inject`

`['settings','credentials','connection']` 三个服务名**全部真实**。

注意 `connection` 的类型声明包叫 `@deepseek-ai/dsh-client-connection`（名字带 client，实际是宿主半边）。

---

## 三、与 UI 契约的对照（已定案）

| # | 冲突 | 定案 | 需要动谁 |
|---|---|---|---|
| ① | 前端从不读 `response.selected`，自己另挑一遍 → 同一次响应可显示两个币种 | **后端权威**：前端删掉自己的挑选逻辑，直接用 `selected`；`displayCurrency` 传给后端 | **改 UI**（唯一一处） |
| ② | `thresholds` 文档是扁的，我们是 `Record<currency, ...>` | **按币种分** | 改**文档** |
| ③ | `timeoutMs` 文档有、UI 没有 | **不进 UI**；后端写死 8 秒，要调走环境变量 | 改**文档** |
| ④ | `isAvailable` 文档说可为 null | **纯 `boolean`** | 改**文档** |

### 由此产生的 UI 侧改动清单（待做，现在不动）

1. `src/client/model.ts`：删掉 `selectCurrency` 的挑选逻辑，改为直接读 `response.selected`。
2. 前端把 `displayCurrency` 作为查询参数传给后端。
3. 「币种不匹配」的判定改为 **`selected.currency` vs 配置的 `displayCurrency`**（UX 不变：浮层说明 + 两个动作）。
  （已推翻：「去设置」已删除，只剩「改用 X」一个动作、且它直接写设置作用域的 `displayCurrency`；去插件页的入口改由浮层标题行右端的图标按钮承担 → [币种收敛](../.agents/notes/2026-09-19-currency-single-source.md) · [跳转入口](../.agents/notes/2026-09-19-setstate-function-value-updater.md)）
4. mock 层要让 `selected` 与 `displayCurrency` 自洽（现有 `currencyMismatch` 场景正好覆盖）。
5. `api-types.ts` 的 `thresholds` / `isAvailable` **已经是对的**，不用改。

### `timeoutMs` 的落法（待架构师确认命名）

不进设置 schema。建议：常量默认 `8000`，环境变量覆盖，候选名 **`DS_BALANCE_TIMEOUT_MS`**。

---

## 四、文档自己指出的两条，判断正确

| 文档 §15 | 核对结果 |
|---|---|
| `apiKeyRef` 默认值应为 `DEEPSEEK_API_KEY` | ✅ 对。现在是 `'deepseek-api-key'`，连字符非法 |
| `inject` 加 `'credentials'` | ✅ 对。现在只有 `['settings']` |
| 「若 UI 已显示 `apiKeyRef` 默认值，同步改」 | ⚪ **空操作** —— 客户端没有硬编码默认值 |

---

## 五、需要回给架构师的修正清单

1. §1.1：删掉「`selected` 是 UI 必须消费的字段」这一说法，改为「**后端权威**」；`isAvailable` 改为纯 `boolean`。
2. §1.1 / §8.3：`thresholds` 改为按币种分。
3. §6.2 / §9.1：`timeoutMs` 移出设置 schema，改常量 + 环境变量。
4. §9.1：`register(ns, schema, { base: <值> })`，schema 是 **schemastery**；常驻 owner 用 `register` 而不是 `installSection`。
5. §9.4：改用 `scope.watch`。
6. §3.3 / §8.1：`fetch` 注册补 `requestBody`，`fetch` 返回 `Response`，返回值是异步 disposer，用 `ctx.effect` 包。
7. §10：整节重写为「用 `ctx.storageDomain` + `defineDomain` / `domainTable`」，删掉 `better-sqlite3` 与自建目录。
8. 补：`$DSH_HOME` 用 `@deepseek-ai/dsh-home-paths`，不要读环境变量。
9. 补：`connection` 的 HTTP 可达性依赖组合里有 webServer。

---

## 六、待验证

- **`credentials.resolve('DEEPSEEK_API_KEY')` 在宿主是否真的命中** —— 「复用官方凭据」成立与否的唯一硬证据，仍未实跑。
- fetch 路由的 `path` 是否允许尾随斜杠 / 大小写差异（实现是 Map 精确键匹配、无归一化）。
- 无 credentials seam 时的行为。

---

## 七、未找到

- **未找到**默认组合挂载 `storage-sqlite` 的任何证据。
- **未找到**宿主对「插件写 `$DSH_HOME` 下自有目录」的明文禁令 —— 更像没有成文约束，而不是被允许。

---

## 参考

- UI 侧契约 → [UI 侧契约与移交](ui-handoff.md)
- 模型融合判定 → [连接与官方模型机制的融合判定](model-integration-assessment.md)
- 架构设计 → [架构说明](ARCHITECTURE.md)