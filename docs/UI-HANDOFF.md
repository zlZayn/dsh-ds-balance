# UI 侧契约与移交

本文是**界面侧的 home**，面向后端架构师。
**活文档**：改了界面（处境表、通道映射、来源标签规则、mock 覆盖）就在同一次改动里同步它 ——
这些都必须与代码一致，`test/client-situation.test.ts` 的分层表断言与 §四 逐行对账。
**正文自包含**：不点开任何链接就能读懂这套契约；文中的相对链接只是深入阅读的入口。

## 一、一句话

UI 已经做完并用 mock 跑通；它只认一组固定字段与一条机械映射规则 —— 后端只要能产出这些形状，对接即可完成。

---

## 二、UI 消费什么 / 不消费什么

### 真实渲染路径消费的字段

| 字段 | UI 用它做什么 |
|---|---|
| `situation` | **界面唯一的分支入口**：环 / 文案 / 来源标签都由它派生 |
| `severity` | 只用来给「有数字那一族」上色（绿 / 琥珀 / 红） |
| `balances[]` | 币种与金额；展示用的那个由「显示币种」配置挑选 |
| `selected` | 后端选定的币种 |
| `source` | 标题右侧的来源括号标签（**只在真的有数字时标**：闸门是「有没有选中币种」，不是处境） |
| `ageMs` | 浮层里的「多久之前」 |
| `state` / `error.code` / `isAvailable` | **兼容字段**：新界面不据它们拼形态；仅旧宿主路径用它现推处境 |

### UI 明确**不**消费的字段

| 字段 | 说明 |
|---|---|
| `todayUsage` 整组 | 第一版不做「今日已用」，`value` / `source` / `confidence` / `needsReview` / `range` 全部不读 |
| `thresholds` | UI 不用它配色；只用 `warn` 当圆环弧长的刻度；颜色走处境 → `severity`（见 §四） |
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
- `situation` 是**界面唯一的分支入口**，闭集 11 个取值：宿主判 9 个
  （`internal-error` / `no-credential` / `fetch-failed` / `account-unavailable` / `stale` /
  `empty-wallet` / `ok` / `low` / `critical`），客户端补 2 个本地事实
  （`checking` 首帧、`offline` 插件端点不可达）。
  **取不到 `situation`（旧宿主）或它不是闭集里的值时，回落是「按旧字段现推处境」**
  （`legacySituationOf`），不是一个固定的 `checking` —— 它推出来可能是任意一个旧契约可达的处境。
  （`checking` 只在一种很窄的形状下才推得出来：没快照 + 没有 error + `state === 'empty'`。）
- `state`（`empty` / `ok` / `stale` / `error`）与 `severity`
  （`ok` / `warn` / `critical` / `unavailable` / `unknown`）仍是闭集，但**降级为兼容字段** ——
  新界面不据它们拼形态，只有旧宿主路径用它现推处境。
- **「没数字」与「有数字」决定来源标签**，而判据是**那一份数字真的在不在屏幕上** ——
  组件里判 `shown !== null`（`shown` 由 `selectionOf` 从 `selected` + `balances` 读出），
  **不是**判处境、也不是判族。同一个处境下「有没有数字」还会变：
  `account-unavailable`（账户停用）上游可能给空的余额列表，那时并没有数字，标了就是在一份空浮层里
  写「（API Key）」。所以这一列在 §四 的表里写作「有数字才标」。

---

## 四、处境 → 形态映射（前端只做机械映射）

**收起态只有 5 个视觉族**（那一个圆环能表达的区别就这么多），内部处境有 11 个。
每一处合并、每一处拆分都是**有意的**，写在 `client/situation.ts` 的形态表里，
并由 `test/render-matrix.test.ts` **渲真组件**钉住一条不变量：**跨族同形 = 歧义，必须为 0**。

| 视觉族 | 环长什么样 | 合并了哪些处境 | 用户此刻要做什么 |
|---|---|---|---|
| **仪表** | 彩弧（绿 / 琥珀 / 红）+ 有弧长 | `ok` `low` `critical` `stale` | 看数字（红=考虑充值） |
| **加载中** | 灰环 + **一段缺口在转** | `checking` | 等 |
| **读不到** | 红环 + **中心叉**（斜交） | `offline` `fetch-failed` `internal-error` `account-unavailable` | 去查（网络 / 凭据 / 账户） |
| **待配置** | 灰环 + **中心＋**（正交） | `no-credential` | **去配置**（唯一需要动手的一族） |
| **空** | 灰环（空） | `empty-wallet` | 什么都不用做 |

- 弧长：余额占该币种 `warn` 阈值的几分之几。**只有「仪表」族画弧**。
- **悬停文案（收起态与展开态同一份）**：规则是「**数字可信才显数字，否则显这个处境自己的文案**」——
  所以只有 `ok` / `low` / `critical` 显金额，其余八个处境显文案。
  `stale` 与 `account-unavailable` **手里有数字也不显**（旧快照 / 停用账户上的数字不可信、不可用，
  环已经把问题画出来了），这是与「按有没有数字判」最容易搞混的一处。
  文案的真源是 [locales.ts](../src/client/locales.ts) 的 `situation.*`（七条，`offline` 与
  `fetch-failed` 共用一条）；**两态一致性**由 `test/hover-parity.test.ts` 渲真组件守着。
  交付通道分两条（收起态走 SVG 原生 `<title>`，展开态走官方 `Tooltip` 原语），
  **但「说什么」只有一处**。
- **两个「红环」靠叉分开**：`account-unavailable`（账户停用）带叉，`critical`（余额恰好为 0）不带 ——
  两者其余通道逐值相同（都是红环、都不画弧）。**叉的语义是「这里没有可用的数字」**，
  读不到**或用不了**都算。
  这一条**不是新增**：处境重构之前 `ringSpecOf` 就是 `marker: severity === 'unavailable' ? 'cross' : null`，
  重构搬进形态表时漏成了 `null`。本轮的修复是把它**恢复**回来（并守住）。
- **「加载中」用一条不完整的转弧**（照官方 `StateDot` 的 `ongoing`）：
  圆是对称的，整圈转等于没转，必须有缺口在动。没有它时「加载中」与「账户没钱」
  都是灰空环、**逐像素相同**，而两者要做的事相反（等 vs 不用管）。
- 两个记号**几何同源**：同一个 `MARK_ARM`、外接框逐值相等（4.2426 见方），只差 45° 朝向 ——
  所以灰度、色盲、12px 下都分得开，不靠颜色。
- **颜色只对「仪表」族有意义**：其余四族的颜色由处境定死，换 `severity` 不变。

**这条映射是 UI 与后端之间唯一的「策略」接口**：阈值定在哪、何时算告急，全在后端，前端不参与。

**为什么两档都用红**：官方 token 里 `error-primary` 与 `error-secondary` 在深色主题下是同一个值，
可用色相只有绿 / 琥珀 / 红 / 品牌蓝 / 灰五个，没有第五种「红系」可分。
于是颜色编码**数值严重度**，形状编码**用户处境**：`critical` 是余额维度、`unavailable` 是账户维度，
后者多一个中心叉号；「待配置」用正交的＋与叉区分（朝向不依赖颜色）。色盲与 12px 小尺寸下依然分得开。

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
  （已推翻：「去设置」已删除，只剩「改用实际币种」一个动作；去插件页的入口改由标题行右端的 Plugins 图标按钮承担，经宿主 `ctx.layout.selectPanel('plugins')` 跳转，**服务缺席时整个图标不渲染** → [记录](../.agents/notes/2026-09-19-setstate-function-value-updater.md)）
- **设置页保留用户的选择，不自动改**；当前卡片内不渲染这条提示，币种不匹配的说明只出现在浮层里。
  （已推翻：「改用实际币种」现在直接写 `ds-balance` 作用域的 `displayCurrency`，与设置卡片同一条写路径、按读回快照判落盘；宿主不可写时按钮置灰 → [决策记录](../.agents/notes/2026-09-19-currency-single-source.md)）
- 该币种后续到账后，提示自动消失并切回用户选定的币种。

**后端需要保证的**：`balances` 里出现的 `currency` 是稳定的代码（如 `CNY` / `USD`），UI 用它与用户选择做不区分大小写的比对。

---

## 六、配置契约（后端要服务的命名空间）

- 命名空间：`dsh-ds-balance`（宿主 schema 与浏览器半边用同一字符串配对；自设置接缝那次迁移起，它 = Loader 条目 id = `cordis.patch.yml` 的 insert 行 id）。**迁移发生在哪一版不写在这里** —— 会漂，要现查就 `node scripts/compat-swap.mjs check`。
- **它与包名今天同串，但不是宿主要求的同一个概念**：槽 key（`plugins.bundle.config`）取包名，`configForms.get()` / `settings.mutate` 取这个命名空间 —— 漂开的表现是「卡片在、表单永远只读」，不报错。由 `test/redlines.test.ts` 与 `test/artifacts.test.ts` 对账。
- 落点：`$DSH_HOME/settings.yaml` 的顶层键 `dsh-ds-balance`（历史：迁移前是 `ds-balance`，**旧值不自动迁移**）。
- 设置界面挂在 Plugins 页里该 bundle 的详情页：宿主按包名 `dsh-ds-balance` 取 `plugins.bundle.config` 这一格（原「设置 → 插件」入口已不存在）。

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

**四个阈值只存不判**：它们是给后端的输入，界面不据其做任何上色或判断（唯一例外是圆环弧长拿 `warn` 当刻度）。

**成对约束**：同一币种内 `critical` 必须**严格低于** `warn`，否则拒绝写入。
宿主在合并后的完整值上校验，所以成对的字段必须按顺序写（先告急后预警），见 [架构说明](ARCHITECTURE.md)。

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

**11 个处境全部造得出来**（17 个场景键），含两个客户端本地的：

- `checking` → `?dsb=checking`；`offline` → `?dsb=offline`。
  **更正**：这两条从前被写成「造不出来、只能真机验」，那是错的 ——
  mock 表从 `ecb5114` 起就带着这两个键，而文档是**在那之后**写的
  （`git log -S "造不出来"` → `87220b2`），所以文档写反了整整一轮。
  它们的 `situation` 字段是显式声明的，`situationOfResponse` 逐字返回，不走现推。
- `no-credential`（无 Key）→ `?dsb=noKey`；`fetch-failed`（无值失败）→ `?dsb=error`；
  `internal-error`（我们自己抛错）→ `?dsb=internalError`
- `account-unavailable`（读到了但账户停用）→ `?dsb=unavailable`
- `stale`（有旧值、本轮失败）→ `?dsb=stale`
- `empty-wallet`（连上了但没有可展示币种）→ `?dsb=empty` / `?dsb=noBalanceAtAll`
- `ok` / `low` / `critical` 三档 → `?dsb=ok` / `?dsb=warn` / `?dsb=critical`
- 来源为账号那条路 → `?dsb=account`；多币种 → `?dsb=multiCurrency`；
  选定币种不存在 → `?dsb=currencyMismatch`
- `todayUsage` 为 `null` → `?dsb=usageMissing`；「需复核」→ `?dsb=usageNeedsReview`
  （保留作契约回归，界面不展示）

**这条覆盖关系有测试守着**（`test/mock-scenarios.test.ts`）：mock 表声明过的 `situation`
必须**覆盖整个闭集** —— 少一个就红。「文档与代码各说各话」正是它被漏掉一轮的原因。

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

1. ~~`GET /api/v1/balance` 走哪条通道？~~ **已定**：`ctx.connection.fetch.register`
   （物理载体已做完信任与浏览器鉴权，见 [BACKEND-CONTRACTS.md](BACKEND-CONTRACTS.md) §8）。
2. ~~`POST /refresh` 的实际路径与语义~~ **已定**：`POST /api/v1/balance/refresh`，
   请求体 `{ reason, provider }`，回 `{ triggered, joined, cooldownMs, state }`；
   冷却的权威在后端。
3. ~~`error.code` 的完整枚举~~ **已定**：18 个码的闭集，见
   [src/domain/errors.ts](../src/domain/errors.ts) 的 `ErrorCode`。
   **但新界面不再按码分支** —— 码只在宿主侧参与处境判定（`NO_KEY` 且无快照 = 没接入）。
4. ~~`severity` 与 `isAvailable` 在「账户不可用」时是否总是同时为 `unavailable` / `false`~~
   **已定且已解耦**：两者不必同时出现，判定统一走 `situationOf`；`isAvailable: false`
   只要有快照就判 `account-unavailable`（压过 `stale`）。
5. `ageMs` 是后端算好给前端，还是前端用 `fetchedAt` 自己算？（前端目前优先用 `ageMs`，因为它不受两端时钟差影响）
6. `todayUsage` 第二版是否回归；若回归，前端需要知道 `source` 的展示口径。
7. ~~阈值改动的生效时机~~ **已定**：前端按配置指纹立刻重问一次 `/api/v1/balance`；
   后端从缓存快照按新阈值重算，**不打上游**。

---

## 十一、本阶段边界

- 前端**没有**接任何真实接口，所有数据来自仓库内的 mock 模块。
- 前端**没有**实现「测试连接」的真实往返，当前是本地模拟。
- 「今日已用」「本轮消耗」「账本 / 投影 / 手工校正」「诊断层」「独立页面」「图表」均**未做**。
- 界面形态完全由**处境**决定（见 §四）；其中「有数字那一族」的颜色来自 `severity`。
  前端只用 `warn` 当圆环弧长的刻度：不配色、不读 `critical`。

---

## 参考

- 本仓库的架构与不变约束 → [ARCHITECTURE.md](ARCHITECTURE.md)
- 原生集成勘察（Slot / 设计系统 / 运行时通道）→ [recon-native-integration.md](../.agents/notes/recon-native-integration.md)
- 决策与依据记录（含每条被否决的替代方案）→ [../.agents/notes/](../.agents/notes/)