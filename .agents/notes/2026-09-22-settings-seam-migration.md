# 设置接缝迁移：作用域服务 → configForms + volatile 配置引用

> **状态（2026-09-22，同一天晚些时候）：其中两条已被
> [2026-09-22-config-entry-back-to-bundle-config.md](2026-09-22-config-entry-back-to-bundle-config.md) 取代** ——
> 「决策 2：探测目标槽改成 `plugins.row.config`」与「决策 3：只注册 `plugins.row.config`」。
> 接缝本身（configForms / volatile 引用 / 声明区间 / 命名空间）**不变**，被取代的只有**配置卡片落在哪一格**：
> 它与那条探测为什么不能盯槽名。下文保留作历史。

**类型**：决策记录（问题 / 决策 / 替代方案 / 影响）。
**这一轮的另一半**：跨仓的派活、裁决与验收口径记在中转站，读完即作废；本文件是本仓的长期记录。

## 问题

宿主升到 alpha 线之后，本插件的两个功能**一起失效**，而且**没有任何报错**：
cordis 的 `inject` 是**激活门禁** —— 客户端半边顶层 `inject` 里列着 `settingsScope`，
而那个服务在宿主里已经不存在，于是 `apply` 根本不执行。宿主半边同理：
`ctx.settings.register` 被删，编译期就过不去。

## 事实（都来自实测，出处给到文件）

- **客户端作用域服务被删**：`packages/` 下 `settingsScope` / `SettingsScope` 0 命中（全 tag 的命中只在 `.agents/notes/` 里）。
- **`plugins.bundle.config` 没有被删**：`slot-contract.ts` 里两个槽都在。变的是**它渲染时不带 `form`**
  （插件页只在 row 那一格递 `{ view, form }`），所以卡片拿不到宿主给的表单。
- **`.check()` 不存在**：`vendor/schemastery` 的方法表里没有它，全 tag 没有 schema 侧调用点。
  官方 `docs/cookbook/adding-a-settings-card.md` 承诺了它 —— **文档写错了**，照抄会卡死。
- **根节点套 wrapper 会杀掉整张卡片**：`volatileForm()` 只认 `meta.volatile` 或 `type === 'object'`，
  套 `transform` / `intersect` 一律返回 `undefined` ⇒ 该行整条退出 `describe()`。
- **设置命名空间 = 活动 profile 的 Loader 条目 id**（不是包名，也不是我们自造的短名）。
  本插件那一行是 `dsh-ds-balance`，而旧命名空间是 `ds-balance` —— **两者不相等**。
- **配置值以引用形式到达**：字段标记 `.volatile()` 后，`apply` 收到的是 `Volatile<T>`（只有 `get()`），
  变更经 `loader/volatile-update` 通知。全字段 volatile ⇒ 改配置**永不重挂**。
- **写设置只有一条路**：`ctx.settings.mutate(entryId, ops)`，一次原子提交、一道修订栅栏。
- **alpha 线还把 `ui-primitives` 的图标改名了**：`IconApiOutline14` → `IconApiOutlineRegular` 一类，
  分档从「尺寸」变成「笔画粗细」（`Regular` 1px / `Medium` 1.3px），尺寸走 `size` prop。**与本次迁移无关，但会挡住构建**。

## 决策（逐条对应落地）

1. **声明区间**：`engines.dsh` 与 12 个受管 `@deepseek-ai/dsh-*` 一起写成 `>=0.1.7-alpha.1`（形状也一致）。
   连带：红线的版本正则收 `>`；`compat-swap.mjs` 改成**保形写回**（见替代方案 9）。
2. **能力探测保留**，重新定义为「卡片在这一格拿不到 form」，探测目标槽跟着卡片改成 `plugins.row.config`。
3. **只注册 `plugins.row.config`**，key 逐字 `<包名>#<行 id>`；key 写成字面量（产物级断言要照字面找到它）。
4. **11 个字段全部 `.volatile()`**（含 `apiKey`）：漏一个的症状是那个字段在表单里消失，不报错。
5. **跨字段校验降级**：`validateThresholds` 保留为纯判据，落点改成「消费侧回落 + 我们自己的写路径 `422`」。
6. **两个半体的 `ENTRY_ID` 各写一份字面量**，由红线对账（不许跨半体值导入）。
7. **客户端 `inject` 只留 `slots` / `locale`**，`configForms` 由 `ctx.inject` 把门并留降级路径。
8. **`orderPairWrites` 删除**（连同 5 个用例）。
9. **截图本轮不重拍**，在 `assets/` 记一条待重截。

## 替代方案（试过 / 想过，为什么不行）

1. **把跨字段校验留在 schema 里** —— 想用 `.check()`：**API 不存在**（见上）。
   退而想用 `z.transform(inner, cb)` 或 `z.intersect` 包一层：`volatileForm()` 会返回 `undefined`，
   **卡片彻底不出现** —— 把约束留在 schema 等于把配置页杀掉。
2. **把根 `z.object` 整个 `.volatile()`** —— 技术上可行（`volatileForm` 走 `plainSchema` 分支），
   但那会把全部字段塞进一个表单节点、把 `apply` 的入参变成单枚 `Volatile<Config>`，
   与官方「每字段各自 volatile」的形态背离，字段级修订也随之丢失。不做。
3. **消费侧「违反就让端点报错」** —— 把一次手改配置文件变成整个插件不可用，惩罚过重。
4. **干脆不校验** —— 会产生「预警档不存在」的静默错误：余额恰好压线时同时判成 warn 与 critical。
   这正是原判据要避免的那件事，所以必须回落 + 记一次 warn。
5. **保留 `orderPairWrites` 当护栏**（万一以后又变回逐字段写）—— 一个没有调用方的排序函数会持续给出
   「这个约束还在被强制执行」的**假信号**，反向的散文。删掉；失效模式消失是机制换掉了，不是被解决了。
6. **客户端从 `../config.ts` 值导入 `ENTRY_ID`** —— 跨半体值导入是本仓红线，且会把宿主半边
   （`node:crypto`、zod）拖进浏览器包。两份字面量由红线对账。
7. **同时注册 bundle 槽与 row 槽** —— 同一个表单会出现两次，且 bundle 那份拿不到 `form`。
8. **删掉能力探测** —— `engines` 是 advisory，装到旧宿主不报错，那会丢掉本插件唯一的跨版本诊断。
   但探测**必须跟着卡片改槽**：盯错一格会在新宿主上说 available 而卡片其实在别处。
9. **用 `^0.1.7-alpha.1` 代替 `>=0.1.7-alpha.1`** —— `^` 在预发布段上只罩同一个 `major.minor.patch`，
   宿主推一个新 alpha 就再次变红，变成**每周必红**的巡检（噪音掩盖真问题）。
   选 `>=` 就必须同批修 `compat-swap.mjs`：它曾经无条件写回 `^`，会把形状静默改回去。
10. **`@deepseek-ai/cordis` / `schemastery` 维持旧声明** —— `Volatile` 类型与 `.volatile()` 成员分别在
    4.0.3 / 3.18.3 才出现，而原声明是 `^4.0.2` / `^3.18.2`（**实测本机装到的 4.0.2 与 3.18.2 都没有**）。
    声明不改就是「按我们给的区间装不出能用的东西」，所以一起抬到 `^4.0.3` / `^3.18.3`。

## 影响

- **宿主侧不再强制跨字段约束**：官网 Plugins 页那条写路径拦不住，只有前端置灰（体验）与消费侧回落（兜底）。
  **手改配置文件写成非法组合不会再报错**，而是那一对阈值被回落成默认值并各记一次 warn —— 这条必须写在 README 里。
- **卡片入口变了**：从 bundle 详情页搬到那一行的 **Configure** 子页。四张界面截图全部失效，待重拍。
- **旧配置值不会自动迁移**：命名空间从 `ds-balance` 变成 `dsh-ds-balance`，而旧值当初就没导入成功
  （实测 `~/.dsh/settings.yaml.imported` 顶层有 `ds-balance` 这个键，但没有任何条目叫 `ds-balance`）。
  那份导入文件只读一次、不会重跑（`settings.yaml` 已被改名），所以**只能重填**。
- **卡片在拿不到 form 时什么都不渲染**（与官方每张卡片一致）：这是探测那行提示存在的理由。
- 图标改名不是我们的决定，但同类漂移会再发生：**声明面动了就重跑一次 typecheck**，别只看红线。