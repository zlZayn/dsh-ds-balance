# 凭据换来源的生效时机：跟着宿主层走，插件不追

状态：生效

**类型**：决策记录（问题 / 事实 / 决策 / 替代方案 / 影响）。
**缘起**：维护者问「打开 DSH 之后改了环境变量、或者把 key 换成另一个账号，插件有没有刷新机制」。答案是**没有专门机制** —— 刷新照旧，而且环境变量那一路在宿主里根本不可观测。

## 问题

插件每轮抓取都**现读**密钥（`KeyResolver.resolve` 的解析链 = 配置 `apiKey` → `credentials.resolve(apiKeyRef)` → `process.env`），所以上游的值真的变了，下一轮就会用上新值。没被写下来的是三件事：有哪几条「上游」、各自什么时候才真的变；变了之后多久生效、中间界面显示什么；要不要为「凭据变了」加一条事件订阅，把生效时机压进一个周期以内。

## 事实（实测，出处给到文件）

- **插件侧的触发面只有一条**：`apply` 里 `ctx.on('loader/volatile-update')`，且只有路径命中 `SCHEDULE_FIELDS`（`serverRefreshSeconds` / `baseUrl` / `apiKey` / `apiKeyRef`）才 `scheduler.reset()`。**没有订阅 `credentials/reference-updated`** —— `src/` 全域只有对凭据服务的调用，没有任何 `credentials/` 事件监听。
- **DSH 的启动环境是冻结快照**：启动时读「继承环境 + 项目 `.env` + home `.env`」之后 `provide('launchEnvironment', …)`，该快照的注释明写 nothing mutates it afterwards。凭据服务解析时**先读这份快照的 process 层**，再读 `.credentials.yaml` 的文件层，最后才是 `.env` 回落；官方凭据事件的文档也写着：环境变量的变化**不可观测、永不 emit**。
- **凭据库那一路是可观测的**：`.credentials.yaml` 有监听，外部编辑比对出差异后 emit `credentials/reference-updated`，值当场换新 —— 但本插件没听，所以只能等下一次定时抓取。
- **本机这把 key 只可能来自启动环境**：desktop profile 的 patch 层没有本插件的配置覆盖（`apiKey` 空串、`apiKeyRef` 是默认引用名）、`$DSH_HOME/.credentials.yaml` 的 `refs` 里没有 `DEEPSEEK_API_KEY`、候选 `.env`（仓库目录 / 项目目录 / `$DSH_HOME`）都不存在。结论与 [model-integration-assessment](model-integration-assessment.md) §七.3 相同 —— 那一条当时挂的是「待验证」，本轮验证完毕。
- **一次真实换账本的实测**：`storages/ds_balance.json` 里两个账本 —— 旧的 `dedb3793…` 共 3618 条（最后一条 2026-09-30 01:47:06），新的 `2d36c58b…` 从 **01:47:58** 起；同日宿主进程的启动时间是 **01:47:54** ⇒ 新账本的第一条快照出现在**重启后 4 秒**。换 key 生效靠的是重启，不是运行期刷新。

## 决策

1. **不订阅 `credentials/reference-updated`，生效时机以宿主层为准**：环境变量那一路**只能重启**（不可观测，没有第二选择），凭据库那一路**等下一个刷新周期**（节奏由 `serverRefreshSeconds` 决定）。
2. **把边界写进对外门面**：根 [README.md](../../README.md) / [README_en.md](../../README_en.md) 的「凭据」小节给出用户能执行的三条事实；[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)「关键决策」留一条指针指到本条。
3. **切换窗口期内界面显示旧账本，已知并接受**：本轮不作废快照、不加界面提示。

## 替代方案（想过，为什么不选）

1. **订阅 `credentials/reference-updated`，命中当前 `apiKeyRef` 就 `scheduler.reset()`。** 不选：它买到的只是「把等一个周期压到秒级」，代价是把「谁在改凭据」拉进插件的生命周期，还要处理「事件只给引用名、不给值」带来的误报（同一引用名重写成同一个值也会白抓一次）。留作备选，反转时新写一条并交叉引用本条。
2. **插件自己再读一遍环境**（轮询 `process.env`，或自己解析 `.env`）。不选：宿主启动时已经把这份环境定死了，`process.env` 对**外部**改动本来就不会变 —— 再读一遍是读同一份死值，属于假装解决了。
3. **文档里写「改环境变量立即生效，不用重启」。** 不选：那是句做不到的话。真正能立刻生效的只有「在官方的模型页 / 凭据库换 key + 点手动刷新」这条。
4. **把已经在契约里的 `accountTag8` 渲染到浮层**，让用户自己看出「还是旧账本」。想过，没做：本轮不动界面；真要解决观感，这比订阅事件便宜。

## 影响

- 用户侧的行为边界成为可查的三句话，不必读代码。
- 刷新路径仍是三条（定时 / 插件配置变更 / 手动），没有新增订阅。
- [BACKEND-CONTRACTS.md](../../docs/BACKEND-CONTRACTS.md) 里那句「`DS_BALANCE_TIMEOUT_MS` 每次请求读：改环境变量后立即生效，不用重启」只对**进程内**改写成立，外部改环境变量同样要重启；两处口径的差异留给下一次动那份文档时对齐。
- 若将来决定订阅事件，本条状态改「被取代」并指向新记录。
