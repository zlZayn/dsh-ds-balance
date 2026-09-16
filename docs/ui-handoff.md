# ds-balance — UI 侧契约与移交

本文面向后端架构师。
**可原样转发**：全文自包含，不依赖本仓库其它文件即可读懂。

## 一、一句话

UI 已经做完并用 mock 跑通；它只认一组固定字段与一条机械映射规则 —— 后端只要能产出这些形状，对接即可完成。

---

## 二、UI 消费什么 / 不消费什么

### 真实渲染路径消费的字段

| 字段 | UI 用它做什么 |
|---|---|
| `severity` | **唯一的颜色来源**（左下角状态圆环） |
| `balances[]` | 币种与金额；展示用的那个由「显示币种」配置挑选 |
| `selected` | 后端选定的币种 |
| `state` | 空态与错误态的文案分支 |
| `error.code` | 细分分支（如 `NO_KEY`） |
| `ageMs` | 浮层里的「多久之前」 |
| `isAvailable` | 账户不可用态 |

### UI 明确**不**消费的字段

| 字段 | 说明 |
|---|---|
| `todayUsage` 整组 | 第一版不做「今日已用」，`value` / `source` / `confidence` / `needsReview` / `range` 全部不读 |
| `thresholds` | **只存不判**：UI 不做任何金额比较，颜色完全来自 `severity` |
| `requestId` / `schemaVersion` / `accountTag8` | 保留在契约里，当前无消费方 |
| `GET /api/v1/estimate` | UI 侧没有消费方 |

**含义**：后端可以自由改这些字段而不影响当前界面；反过来，它们也**未经任何界面验证**。

---

## 三、UI 依赖的契约不变量

- 金额一律是**字符串**；UI 按字符串裁两位显示，全程不经过浮点数。
- 金额是定点小数（mock 用八位），**相等比较与累加都必须在后端做**。
- `balances` 的**顺序可能跳变**；UI 不依赖顺序做语义判断（只在「回落到第一个」时用到顺序）。
- 可能多币种。
- `selected` **可以为 `null`**。
- `state` 与 `severity` 是**两个独立维度**，UI 不互相推导。
- `severity` 是闭集：`ok` / `warn` / `critical` / `unavailable` / `unknown`；出现未知值时 UI 回落 `unknown`。
- `state` 是闭集：`empty` / `ok` / `stale` / `error`。

---

## 四、severity → 颜色映射（前端只做机械映射）

| `severity` | 语义 | 颜色 token |
|---|---|---|
| `ok` | 正常 | `--dsw-alias-state-success-primary`（绿） |
| `warn` | 预警 | `--dsw-alias-state-warn-primary`（黄） |
| `critical` | 告急 | `--dsw-alias-state-error-primary`（红） |
| `unavailable` | 账户不可用 | `--dsw-alias-state-error-primary`（红） |
| `unknown` | 未知 | `--dsw-alias-label-tertiary`（灰） |

**这条映射是 UI 与后端之间唯一的「策略」接口**：阈值定在哪、何时算告急，全在后端，前端不参与。

---

## 五、币种行为（UI 侧已固化的规则）

设置里有「显示币种」选项（默认「自动」）。规则是**不静默、不惩罚、不偷偷改设置**：

| 场景 | 界面表现 |
|---|---|
| 选「自动」 | 用 `selected`；永不提示不匹配 |
| 选定币种存在 | 正常显示 |
| 选定币种不存在，但有其它币种 | 显示实际存在的那个，并加一个提示标记 |
| 账户完全没有余额 | 显示 `--` 并加标记 |

- 浮层里给说明与两个动作：**改用实际币种** / **去设置**。
- **设置页保留用户的选择，不自动改**；当前卡片内不渲染这条提示，币种不匹配的说明只出现在浮层里。
- 该币种后续到账后，提示自动消失并切回用户选定的币种。

**后端需要保证的**：`balances` 里出现的 `currency` 是稳定的代码（如 `CNY` / `USD`），UI 用它与用户选择做不区分大小写的比对。

---

## 六、配置契约（后端要服务的命名空间）

- 命名空间：`ds-balance`（宿主 schema 与浏览器半边用同一字符串配对）。
- 落点：`$DSH_HOME/settings.yaml` 的顶层键 `ds-balance`。
- 设置界面挂在「设置 → 插件 → DeepSeek 余额」。

| 字段 | 类型 | 默认 | 范围 |
|---|---|---|---|
| `apiKey` | string，`role('secret')` | `''` | — |
| `apiKeyRef` | string，`role('credential-ref')` | `DEEPSEEK_API_KEY` | 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$` |
| `baseUrl` | string | `https://api.deepseek.com` | — |
| `serverRefreshSeconds` | 自然数 | 60 | 10–3600 |
| `clientPollSeconds` | 自然数 | 30 | 5–600 |
| `manualRefreshCooldownSeconds` | 自然数 | 30 | 0–600 |
| `displayCurrency` | string | `auto` | `auto` 或币种代码 |
| `cnyWarn` | 数 | 10 | ≥0 |
| `cnyCritical` | 数 | 5 | ≥0 |
| `usdWarn` | 数 | 2 | ≥0 |
| `usdCritical` | 数 | 1 | ≥0 |

**四个阈值只存不判**：它们是给后端的输入，界面不据其做任何上色或判断。

---

## 七、刷新交互

| 触发 | 界面行为 | 对后端的期望 |
|---|---|---|
| 打开浮层 | 不发请求，用现有快照 | — |
| 点浮层里的刷新 | 图标旋转、按钮禁用 | 一次手动刷新；冷却期内不重复发 |
| 冷却中再点 | 不旋转，提示剩余秒数 | — |
| 后台轮询 | 按 `clientPollSeconds` | 客户端只读缓存；不要每次都穿透到上游 |

- **服务端刷新频率**与**客户端轮询频率**是两个独立旋钮，前者是后端去上游取数的节奏，后者是浏览器来取缓存的节奏。
- 手动刷新冷却由前端计时；后端可以再有一层自己的节流。

---

## 八、mock 已覆盖的场景（后端可逐条对照）

场景键即 URL 参数 `?dsb=<键>`，权威清单在代码里（`src/client/mock/scenarios.ts`）。

覆盖的状态组合：

- `state` 四档：`ok` / `stale` / `error` / `empty`。
- `severity` 五档：`ok` / `warn` / `critical` / `unavailable` / `unknown`。
- 无 Key（`error.code = NO_KEY`）。
- 多币种（CNY + USD）。
- 选定币种不存在。
- 账户完全没有余额。
- `todayUsage` 为 `null` 与「需复核」两种（保留作契约回归，界面不展示）。

---

## 九、数据通道候选（平台事实，供后端选型）

浏览器半边拿不到 `ctx`，宿主与浏览器之间只有这四类通道。

| 通道 | 语义 | 代价 |
|---|---|---|
| `ctx.connection.fetch.register({ path, methods, requestBody, fetch })` | 注册 HTTP 端点；物理载体**已先施加信任与浏览器鉴权** | 推荐承载余额这类数据 |
| `ctx.connection.rpc.handle` + 客户端 `ctx.connection.rpc.call` | 自定义 RPC | 需要自己定义方法与序列化 |
| Typert `@Remote` | 类型化 RPC；一元调用永不 reject，返回 `RemoteResult<T>` | 需要额外的清单入口与单体仓库的 codegen 步骤，第三方接入成本高 |
| `ctx.webServer.register({ kind, path, handler })` | 任意 HTTP 路由，**无鉴权** | 承载敏感数据必须自带信任围栏 |

**前端希望后端选第一条**：余额与 Key 都属于敏感面，第一条已经把信任与鉴权做完。

---

## 十、待后端确认

1. `GET /api/v1/balance` 走哪条通道？（建议 `connection.fetch`）
2. `POST /refresh` 的实际路径与语义（现有 mock 未实现，前端只留了冷却计时）。
3. `error.code` 的**完整枚举**：目前前端只按 `NO_KEY` 分支，其余一律落到通用错误文案。
4. `severity` 与 `isAvailable` 在「账户不可用」时是否总是同时为 `unavailable` / `false`。
5. `ageMs` 是后端算好给前端，还是前端用 `fetchedAt` 自己算？（前端目前优先用 `ageMs`，因为它不受两端时钟差影响）
6. `todayUsage` 第二版是否回归；若回归，前端需要知道 `source` 的展示口径。
7. 阈值改动的生效时机：是否需要前端立即重新取数，还是等下一轮轮询。

---

## 十一、本阶段边界

- 前端**没有**接任何真实接口，所有数据来自仓库内的 mock 模块。
- 前端**没有**实现「测试连接」的真实往返，当前是本地模拟。
- 「今日已用」「本轮消耗」「账本 / 投影 / 手工校正」「诊断层」「独立页面」「图表」均**未做**。
- 界面颜色完全由 `severity` 决定，前端不含任何阈值策略。

---

## 参考

- 本仓库的架构与不变约束 → [ARCHITECTURE.md](ARCHITECTURE.md)
- 原生集成勘察（Slot / 设计系统 / 运行时通道）→ [recon-native-integration.md](recon-native-integration.md)
- 决策记录（含每条被否决的替代方案）→ [../.agents/notes/](../.agents/notes/)