# ds-balance — 进行中计划（跨上下文交接）

> **用途**：上下文压缩或换会话后从这里恢复。
> 读完这份 + 根 [AGENTS.md](../AGENTS.md) 即可继续，不必重读全部文档。
> **状态**：实现中。勘察与全部决策已完成，后端按 `docs/backend-architecture.md` §14 推进。

## 一、任务大方向

做一个 dsh 插件：在左侧栏底部显示 DeepSeek 账户余额，设置页提供配置卡片。

- **UI 已定稿并实机验收**（阶段 0~6 完成）。
- **现在在做后端**：读取官方余额，经 `ctx.connection.fetch` 暴露给前端。
- **只做 Core，不做 Estimation**（账本 / 投影 / 定价 / 融合估算）—— 第二版。
- 权威规格：[后端架构（修正版）](backend-architecture.md)。冲突时以实测为准。

## 二、当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 勘察 + 决策 | 阶段 0 勘察、16 项拍板、模型融合判定 | ✅ |
| UI 实现 | 左下角条目 + 设置卡片 + mock | ✅ 实机验收 |
| 后端阶段 0 | 探针实测三项 | ✅ [报告](phase0-verification.md) |
| 后端 §14 第 1 步 | Money / Errors | ✅ 24 测试 |
| 后端 §14 第 2 步 | Balance / Severity / Select / Normalize | ✅ 57 测试全过 |
| 后端 §14 第 3 步 | DeepSeekClient + HttpDeepSeekClient | ✅ 69 测试 |
| 后端 §14 第 4 步 | DomainCoreStore（官方存储接缝） | ✅ 82 测试 |
| 后端 §14 第 5 步 | KeyResolver / ConfigService | ⬜ **下一步** |
| 后端 §14 第 6 步 | BalanceService / Scheduler | ⬜ |
| 后端 §14 第 7 步 | HTTP routes（`connection.fetch`） | ⬜ |
| 后端 §14 第 8 步 | UI 五条改动 | ⬜ |
| 后端 §14 第 9~11 步 | 挂载验证 / 可观测 / 文档同步 | ⬜ |

**验证命令**：`npx --no-install tsc --noEmit`（宿主）+ `npx --no-install vitest run`。
当前：typecheck 绿，**82 tests passed**（7 个文件）。

## 三、下一步（严格顺序）

1. **§14 第 5 步**：`src/services/key-resolver.ts` + `src/services/config-service.ts` + `src/config.ts`。
   - 把 schemastery 的 `Config` 从 `src/index.ts` 抽到 `src/config.ts`，加上 `SETTINGS_NAMESPACE` 与 `resolveTimeoutMs()`（读 `DS_BALANCE_TIMEOUT_MS`，**每次请求读**）。
   - 需要新增端口 `src/ports/credentials.ts`（`resolve` / `describe`），便于用替身测试。
   - `KeyResolver` 的解析链：配置 `apiKey` → `credentials.resolve(apiKeyRef)` → `process.env[apiKeyRef]` → 抛 `NoKeyError`。**无 credentials seam 时捕获异常回落 `NO_KEY`。**
   - `accountTag` = HMAC-SHA256(serverSalt, apiKey) 前 32 hex；serverSalt 落 `.salt`（路径用 `@deepseek-ai/dsh-home-paths` 的 `dshHomePath()`）。
2. 依次推进 §14 第 6~7 步。

### 已落地的实现约定（后续沿用）

- `KvTable` 的真实 API：`get`（同步、内存）/ `keys()` / `put`（**插入或覆盖**）/ `delete` / `update`（键不存在会 reject）。**插入用 `put`。**
- 域记录 schema 用 **zod**（`^4.6.5`，已加进 `dependencies`，是运行时真依赖）；插件配置用 **schemastery**。
- `@deepseek-ai/dsh-storage-domain` 按平台包分层：**peer + dev**。
- 域声明**不写 `backend`** —— 路由归部署方。
- 存储适配器构造期**永不抛错**，打开失败降级为「每次操作抛 `StorageError`」。
3. **第 8 步的 UI 五条改动必须按序**：先 mock → 再 `model.ts` → 再组件。
   **顺序错了 mock 场景会全崩。**
4. UI 改动与后端实现**放同一个提交**。

## 四、已定契约（实现时必须遵守）

- 金额一律**字符串**（8 位小数）出场；内部一律 `bigint` 最小单位。
- **`selected` 后端权威**：前端不再自己挑币种，`displayCurrency` 作为查询参数传给后端。
- `thresholds` **按币种分**：`{ CNY: {warn, critical}, USD: {...} }`。
- `isAvailable` 是**纯 boolean**。
- `timeoutMs` **不进设置 schema**：常量 8000，`DS_BALANCE_TIMEOUT_MS` 覆盖，**每次请求读**。
- **余额错误一律 `200 + state: error`**：handler 必须自己 catch 所有异常，不许让宿主包成 500。
- **每次请求读最新 config**：不许在 handler 里闭包捕获旧配置。
- 状态码集合：`state` = `empty|ok|stale|error`；`severity` = `ok|warn|critical|unavailable|unknown`。

## 五、实现细则（维护者给的 7 条，逐条落实）

1. **凭据轮换 → `accountTag` 变 → 旧快照失配**：加载快照时 tag 不匹配视为**空**，不混用。
2. **`role('secret')` 的 redact 是自动还是手动**：`GET /api/v1/config` 是自己构造响应、不走 settings 读 —— **要确认掩码是否自动生效**；不自动就手动掩。
3. **handler 每次读最新 config**（见上）。
4. **handler 内部异常不能抛**（见上）。
5. **`.salt` 丢失 → `accountTag` 全变 → 旧账本孤立**：文档要写明，或改成从固定源派生。
6. **UI 五条改动的先后顺序**：mock → `model.ts` → 组件。
7. **`DS_BALANCE_TIMEOUT_MS` 每次请求读**，改完立即生效，无需重启。

## 六、环境与操作手册

### 构建与测试

```bash
npm run build          # tsc + tsc -p tsconfig.client.json + esbuild
npx --no-install tsc --noEmit        # 宿主类型检查
npx --no-install vitest run          # 测试
node scripts/check-release.mjs       # 发布前检查（开发期预期失败）
```

**导入后缀不对称（重要）**：
- **宿主半边用 `.js`**（`tsconfig.json` 会 emit，没有 `allowImportingTsExtensions`）。
- **客户端半边用 `.ts` / `.tsx`**（`tsconfig.client.json` 开了那个开关）。
- vitest 能解析 `.js` → `.ts`，已验证。

### 挂载（不重启宿主）

```
1. dsh plugin --profile web add <仓库路径>
2. 把该包从 profile 的 dsh.profile.bundles 里删掉
3. 把 insert 行写进 profile 的 cordis.patch.yml
4. 回滚：给那行加 disabled: true（热生效）
```

- 宿主：`http://127.0.0.1:3080`，进程 pid 11464（承载本会话，**不要重启**）。
- 宿主半边**无模块热更**；浏览器半边由 `dsh-client-hmr` 轮询 `lib/client.js` 自动替换。

### 探针方法论（阶段 0 学到的）

- 宿主进程的 stdout 在维护者终端里，**Agent 读不到** → 探针把结果写到 `%TEMP%` 的 jsonl。
- **绝不在触发动作之后立刻删日志** —— watcher 挂载可能比删除更快，证据会被自己删掉。
- 探针必须**吸收打开失败**、不留未观察的 rejection：已装插件的注释说它曾把整个宿主拖下水。
- **绝不要 `Select-String` 打印凭据文件整行** —— 会把密钥带进对话记录。

## 七、已知风险与陷阱

| 风险 | 说明 | 处置 |
|---|---|---|
| **`dsh plugin` 回填 bundles** | 任何声明 `dsh.bundle` 的已装包都会被写回 `dsh.profile.bundles`，与 patch 行形成双挂载 | 已选**方案 A**：开发期从 `package.json` 去掉 `dsh.bundle`；`scripts/check-release.mjs` 在发布前卡住 |
| 双挂载 | bundles + patch 同 id，**下次重启会撞** | 重启前必须再确认 bundles 里没有本插件 |
| `credentials.writable === false` | 环境层只读 | 卡片**不让用户覆盖宿主凭据**；`apiKey` 是插件自己的设置项，**两者语义分清** |
| 存储域 `already-open` | `open` 每进程一次 | 已实测**通过**：用 `ctx.effect` 关闭即正确，热重挂先拆后建 |
| `src/client.ts(x)` | 与 `lib/client.js` 抢路径 | `scripts/build-client.mjs` 开头有守卫 |
| esbuild CSS Modules | 必须显式 `loader: { '.css': 'local-css' }` | 已在构建脚本里 |
| 侧栏 footer 容器 | 宿主写成 row flex，多条目互挤 | 已用 `:has()` 反选父元素改纵向堆叠 |
| `aria-haspopup` | 邻居用 DOM 遍历找设置按钮，会命中我们 | 侧栏底部按钮**不许**写它 |

## 八、文件地图

```
src/
├── index.ts              宿主入口（Layer 5，待扩展）
├── domain/               Layer 0 ✅ 已写
│   ├── money.ts / errors.ts / balance.ts / severity.ts / select.ts / normalize.ts
├── ports/                Layer 1 ⬜ 待写
├── adapters/             Layer 2 ⬜ 待写
├── services/             Layer 3 ⬜ 待写
├── http/                 Layer 4 ⬜ 待写
└── client/               浏览器半边 ✅ 已定稿
test/                      ✅ 5 个文件 57 测试
scripts/                   build-client.mjs / check-release.mjs
docs/                      ARCHITECTURE / backend-architecture / phase0-verification / …
```

## 九、恢复清单（下一个我先读什么）

1. 本文件。
2. 根 [AGENTS.md](../AGENTS.md) 的活跃坑与待办。
3. [后端架构（修正版）](backend-architecture.md) 的 §4~§14。
4. [阶段 0 验证报告](phase0-verification.md) 的实测结论。
5. 要改哪个目录就读它的 `README.md`，动手前读它的 `AGENTS.md`。

**还没做但记着的**：`test/` 与 `src/domain/` 的双件（本文件同批在写）、`LICENSE`、`lint` 入口。
