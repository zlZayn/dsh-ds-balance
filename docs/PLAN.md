# ds-balance — 进行中计划（跨上下文交接）

> **用途**：上下文压缩或换会话后从这里恢复。
> 读完这份 + 根 [AGENTS.md](../AGENTS.md) 即可继续，不必重读全部文档。
> **状态**：后端与界面均已实现并实机验证；宿主已重启，主实例跑的是最新产物。
> 收尾报告在 [final-report.md](final-report.md)。当前在收「维护者第二轮 UI 反馈」的尾。

## 一、任务大方向

做一个 dsh 插件：在左侧栏底部显示 DeepSeek 账户余额，设置页提供配置卡片。

- **UI 已定稿并实机验收**（阶段 0~6），本轮接上真实数据。
- **后端已完成**：读官方余额，经 `ctx.connection.fetch` 暴露给前端。
- **只做 Core，不做 Estimation**（账本 / 投影 / 定价 / 融合估算）—— 第二版。
- 权威规格：[后端架构（修正版）](backend-architecture.md)。冲突时以实测为准。

## 二、当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 勘察 + 决策 | 阶段 0 勘察、16 项拍板、模型融合判定 | ✅ |
| UI 实现 | 左下角条目 + 设置卡片 + mock | ✅ 实机验收 |
| 后端阶段 0 | 探针实测三项 | ✅ [报告](phase0-verification.md) |
| 后端 §14 第 1~6 步 | 领域 / 端口 / 适配器 / 服务 / 调度 | ✅ |
| 后端 §14 第 7 步 | HTTP routes（`connection.fetch`）+ 宿主组装 | ✅ 端点实测通过 |
| 后端 §14 第 8 步 | UI 五条改动 + 真实数据层 | ✅ Playwright 实测通过 |
| 后端 §14 第 9 步 | 真实 dsh 挂载验证 | ✅ 隔离实例端到端 |
| 后端 §14 第 10 步 | 可观测（内存指标 + healthz 暴露） | ✅ |
| 后端 §14 第 11 步 | 文档同步 + 提交 | ✅ [收尾报告](final-report.md) |
| 维护者反馈第 1 轮 | 刷新按钮置灰 / 改阈值即时刷新 / 五档形状 / 连接组照搬官方 | ✅ 实机验证 |
| 维护者反馈第 2 轮 | 客户端读新字段的版本错位防御 | ✅ 实机验证（宿主已重启） |

**验证命令**：`npm run typecheck`（三段）、`npx --no-install vitest run`、`npm run build`。
数字不在本文件里抄 —— 看 [CI](../.github/workflows/ci.yml) 或现跑。
测试里有一份 **`test/redlines.test.ts`**：依赖分层、插件清单、构建链守卫、宿主写法、UI 约定。
**改红线等于改约定，要单独说明理由。**

## 三、下一步

1. 本轮四项 UI 改动的文档同步与提交**已完成**（三个提交，工作区干净）。
2. 主实例已重启并在跑最新产物 —— 维护者已实机确认界面与功能。
3. 最后一个未验证项（窄视口浮层钳制）已补验：360 / 480 / 600 / 700 / 721 五个宽度全部落在视口内。
3. 规范向 `dsh-zhihu-search` 靠齐的判定与落地清单 →
   [决策记录](../.agents/notes/2026-09-17-zhihu-search-alignment.md)；P3 项等发布条件。
4. 仍待验证：窄视口（<722px）下浮层的钳制；真实 DeepSeek 上游的字段形状。

## 四、已定契约（实现时必须遵守）

- 金额一律**字符串**（8 位小数）出场；内部一律 `bigint` 最小单位。
- **`selected` 后端权威**：前端不再自己挑币种，`displayCurrency` 作为查询参数传给后端。
- `thresholds` **按币种分**：`{ CNY: {warn, critical}, USD: {...} }`。
- `isAvailable` 是**纯 boolean**。
- `timeoutMs` **不进设置 schema**：常量 8000，`DS_BALANCE_TIMEOUT_MS` 覆盖，**每次请求读**。
- **余额错误一律 `200 + state: error`**：handler 必须自己 catch 所有异常，不许让宿主包成 500。
- **每次请求读最新 config**：不许在 handler 里闭包捕获旧配置。
- 状态码集合：`state` = `empty|ok|stale|error`；`severity` = `ok|warn|critical|unavailable|unknown`。

## 五、偏离文档的地方（附理由，全部已落地）

| # | 文档说 | 实际做法 | 理由 |
|---|---|---|---|
| 1 | `PUT /api/v1/config` | **`POST /api/v1/config`** | `ConnectionFetchMethod` 只有 `GET` / `HEAD` / `POST`，PUT 注册即被拒 |
| 2 | `role('secret')` 掩码待确认 | **掩码是手动的** | `redactSecrets` 是显式开关（`describe({ redactSecrets: true })`），我们这套响应自己构造，不走 settings 读 |
| 3 | 只返回 `apiKeyMasked` | **固定长度星号串** | 不回密钥的任何片段（用户的安全硬约束）；只是让字段名名副其实 |
| 4 | `inject = ['settings','credentials','connection']` | **只用 `['settings','credentials']`** | 缺 `connection` 只该丢掉 HTTP 半边，不该让设置与调度一起消失；它由 `apply` 内的 `ctx.inject` 单独把门 |
| 5 | 同上，未提 `storageDomain` | **由 `ctx.inject` 把门** | cordis 不许读没 inject 过的服务（实测报 `cannot get property "storageDomain" without inject`）；服务缺席时存储降级 |
| 6 | 存储适配器构造期打开 | **懒打开 + 失败可重试** | 服务可能晚到；一次过早的失败不该把存储永久钉死 |
| 7 | 落盘失败即抓取失败 | **落盘失败只记一次 warn** | 存储是可降级的一层：快照留在内存，界面照常，只是重启后不恢复 |
| 8 | 只改 UI 五条 | **新增 `src/client/data.ts` 数据层** | 五条改动的前提是「前端能拿到后端数据」，此前浏览器半边只读 mock |
| 9 | 未提 mock 的去留 | **默认走真实端点，mock 变显式旁路** | `?dsb=<场景>` 或 localStorage 明确选过才用 mock；`?dsb=live` 清回真实数据 |
| 10 | §12 四个指标 | **内存登记表 + `healthz.metrics` 暴露** | 默认组合没有指标 sink，否则四个指标只是「调用了一个空函数」 |
| 11 | `.salt` 落在「存档目录」 | `$DSH_HOME/.salt` | §10.5 禁止自建 `$DSH_HOME/ds-balance/`；官方先例 `.anonymous-user-id` 也在 home 根 |
| 12 | 未提 `GET /api/v1/config` 的形状 | 多一个 `credential` 段 | 界面要照官方做法决定凭据字段可不可写；这是官方 `describe()` 的逐字形状，**没有装值的槽** |
| 13 | severity 五档各自一色 | **四色 + 一个形状** | 官方 token 里 `error-primary` 与 `error-secondary` 在深色主题下同值，没有第五种色相。`critical` 红实弧、`unavailable` 红弧加中心叉号（维护者拍板） |
| 14 | 连接组是本插件自己的三个字段 | **照搬官方「模型」卡片的两段式** | 维护者要求「继承官方而不是新弄一套」：外面只读凭据状态 + 可编辑 Base URL，`apiKey` / `apiKeyRef` 收进「自定义设置」折叠 |
| 15 | 未提阈值变更的刷新时机 | **配置指纹变化即重问一次后端缓存** | 改阈值要当场看到圆环变色。宿主侧同时收紧了 `scheduler.reset()` 的条件 —— 否则改阈值会顺带打一次官方接口 |

## 六、待用户确认（产品决策，已选合理默认）

维护者第二轮已拍板四项：颜色用「四色 + 叉号」、刷新按钮按冷却置灰、改阈值重问后端缓存、
连接组照搬官方两段式。**剩余**：

1. **`apiKeyMasked` 的形态**：现在是不回任何片段的固定星号串。若希望用户能核对「是不是这把 key」，需要放宽成末 4 位。
2. **`LICENSE` 的版权人**：现在写 `dsh-ds-balance contributors`。要署名本人请给名字。
3. **mock 旁路的开关**：现在是 URL 参数 / localStorage。若希望改成构建期开关或环境变量，需要改法。
4. **`.salt` 的文件名**：`.salt` 名字很泛，理论上可能与别的工具撞。可改成 `.ds-balance-salt`。
5. **左下角默认币种**：沿用「自动（跟随账户）」。若希望默认固定 CNY，需要改 schema 默认值。
6. **是否引入 `lint`**：两边项目都没有，暂不引入。
7. **设置卡片折叠状态不持久化**：v1 有意不做。

## 七、环境与操作手册

### 构建与测试

```bash
npm run build          # tsc + tsc -p tsconfig.client.json + esbuild
npm run typecheck      # 三段：宿主 / 客户端 / 测试
npx --no-install vitest run
node scripts/check-release.mjs       # 发布前检查（开发期预期失败）
```

**导入后缀不对称（重要）**：
- **宿主半边用 `.js`**（`tsconfig.json` 会 emit，没有 `allowImportingTsExtensions`）。
- **客户端半边用 `.ts` / `.tsx`**（`tsconfig.client.json` 开了那个开关）。
- vitest 能解析 `.js` → `.ts`，已验证。

### 挂载（不重启宿主）

```
1. dsh plugin --profile <profile> add <仓库路径>
2. 确认 profile 的 dsh.profile.bundles 里没有本插件
3. 把 insert 行写进 profile 的 cordis.patch.yml
4. 宿主半边改动后：给那行加 disabled: true，等一拍，再去掉（重新 apply）
5. 回滚：保持 disabled: true（热生效）
```

- 宿主半边**无模块热更**；浏览器半边由 `dsh-client-hmr` 轮询 `lib/client.js` 自动替换。

### 隔离实例（端到端验证的正确做法）

主实例的 launch token 只在维护者终端里，Agent 拿不到，所以 `/api/*` 一律 401。
验证端点与界面必须起**隔离实例**：

```powershell
$env:DSH_HOME = "<临时 home>"
dsh --profile <新 profile> --from-default-profile web --dump-config   # 只建 profile
dsh plugin --profile <新 profile> add <仓库路径>
# 把 insert 行写进该 profile 的 cordis.patch.yml（注意别在模板的 [] 后面追加，要替换）
dsh --profile <新 profile> --port <空闲端口> --no-open *> server.log
# token 在 server.log 里，解析进变量后直接用，不要回显
```

- 上游可以用一个临时 Node stub 顶上（`baseUrl` 指过去），避免打真实网络。
- 界面用 Python Playwright 验（`webapp-testing` skill 的做法）：首次启动的「内测声明」弹窗会拦截点击，先把它从 DOM 里摘掉。
- **验完即删**：kill 掉端口占用进程 + 删临时 home + 删临时脚本。

### 探针方法论（阶段 0 学到的）

- 宿主进程的 stdout 在维护者终端里，**Agent 读不到** → 隔离实例把 stdout 落文件。
- **绝不在触发动作之后立刻删日志** —— watcher 挂载可能比删除更快，证据会被自己删掉。
- 探针必须**吸收打开失败**、不留未观察的 rejection：已装插件的注释说它曾把整个宿主拖下水。
- **绝不要 `Select-String` 打印凭据文件整行** —— 会把密钥带进对话记录。

## 八、已知风险与陷阱

| 风险 | 说明 | 处置 |
|---|---|---|
| **`dsh plugin` 回填 bundles** | 任何声明 `dsh.bundle` 的已装包都会被写回 `dsh.profile.bundles`，与 patch 行形成双挂载 | 已选**方案 A**：开发期从 `package.json` 去掉 `dsh.bundle`；`scripts/check-release.mjs` 在发布前卡住 |
| 双挂载 | bundles + patch 同 id，**下次重启会撞** | 重启前必须再确认 bundles 里没有本插件 |
| `credentials.writable === false` | 环境层只读 | 卡片**不让用户覆盖宿主凭据**；`apiKey` 是插件自己的设置项，**两者语义分清** |
| cordis 服务门禁 | 读没 inject 过的服务直接抛错 | 可选服务一律走 `ctx.inject` 把门，并留降级路径 |
| 存储域 `already-open` | `open` 每进程一次 | 用 `ctx.effect` 关闭即正确，热重挂先拆后建 |
| `.salt` 丢失 | `accountTag` 全变 → 旧账本孤立 | 读不出来时降级成进程内临时盐并记 error；后果写进架构文档 |
| `src/client.ts(x)` | 与 `lib/client.js` 抢路径 | `scripts/build-client.mjs` 开头有守卫 |
| esbuild CSS Modules | 必须显式 `loader: { '.css': 'local-css' }` | 已在构建脚本里 |
| 侧栏 footer 容器 | 宿主写成 row flex，多条目互挤 | 已用 `:has()` 反选父元素改纵向堆叠 |
| `aria-haspopup` | 邻居用 DOM 遍历找设置按钮，会命中我们 | 侧栏底部按钮**不许**写它 |

## 九、文件地图

```
src/
├── index.ts              宿主入口（Layer 5，组装点）
├── config.ts             设置 schema 与常量（两半的唯一共享字符串来源）
├── version.ts            线上 schema 版本 + 插件版本
├── domain/               Layer 0 纯逻辑
├── ports/                Layer 1 类型与常量
├── adapters/             Layer 2 端口实现
├── services/             Layer 3 应用服务
├── http/                 Layer 4 HTTP 端点（wire / handlers / routes）
└── client/               浏览器半边（含 data.ts 数据层与 mock 旁路）
test/                     与被测模块同名的单元测试 + redlines.test.ts
scripts/                  build-client.mjs / check-release.mjs
docs/                     ARCHITECTURE / backend-architecture / PLAN / …
```

## 十、恢复清单（下一个我先读什么）

1. 本文件。
2. 根 [AGENTS.md](../AGENTS.md) 的活跃坑与待办。
3. [后端架构（修正版）](backend-architecture.md) 的 §4~§14。
4. [阶段 0 验证报告](phase0-verification.md) 的实测结论。
5. 要改哪个目录就读它的 `README.md`，动手前读它的 `AGENTS.md`。
