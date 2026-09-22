# settings/ — 设置卡片手册

- 职责：把本插件的配置渲染成 Plugins 页里该 bundle 详情页上的一张卡片；四组配置各自可折叠，编辑先落本地草稿，保存是草稿变成设置的唯一出口。
- 变更影响路由：改字段名 → 同步宿主 schema [src/index.ts](../../index.ts) 的 `Config`；改对外可见行为 → 同步 [docs/ui-handoff.md](../../../docs/ui-handoff.md) 的设置小节、根 [README.md](../../../README.md) 与 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 回根 → [../../../AGENTS.md](../../../AGENTS.md)（仓库根）；直接上层是 [../AGENTS.md](../AGENTS.md)（src/client 规则层）。

本文件按**符号名**引用代码，不写行号 —— 行号每改一次代码就会漂，符号名不会。

## 文件

### BalanceSettingsCard.tsx

- 职责：卡片本体。持有分组展开一份局部状态；把 `useConfigForm` 的状态翻译成 JSX。
- 关键导出：`BalanceSettingsCard`、`BalanceSettingsCardProps`，并转发 `ConfigFormOf`（对官方 `ConfigForm<Record<string, unknown>>` 的收窄别名）。
- 分组：连接 → 展示 → 阈值 → 刷新。这是 UI 的排列顺序（按使用频率）；宿主 `Config` 的字段顺序是 连接 → 刷新 → 展示 → 阈值，**两者有意不同**，见 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) 的关键决策。
- 连接组是**两段式**：外面是只读的凭据状态（`ReadOnlyControl`，继承官方、不可改）与可编辑的 Base URL；二级「自定义设置」折叠里只有**凭据引用名**（`apiKeyRef`，默认收起）。
  **界面上唯一的 API Key 就是那个只读框** —— 卡片不再提供填 Key 的入口；Key 仍可由配置文件给出，所以 schema 与写入面没动。
- 默认收起：四组全收起（`DEFAULT_GROUP_OPEN` 全 `false`）—— 进页面先看到四个组名，需要哪组点开哪组；展开状态不持久化，重挂载即回到全收起。
- 组内有非法草稿时该组强制展开（`groupOpenNow`），否则 footer 的「请检查标红的字段」会指向一个收起来的组。
- 被谁依赖：`src/client/index.tsx` 的 `SettingsSeatComponent`。
- 改后必测：四组各自展开与收起；暂存与保存；非法数字禁用保存；测试连接的三种结果。

### BalanceSettingsCard.module.css

- 职责：表单外壳（一列控件 + 保存行）的样式；取值逐条对齐官方 `ui-settings-plugins/PluginConfigForm.module.css` 与 `fields.module.css`。
- 关键规则：`.form`（flex 列；**无外框、无圆角、无底色、无内边距**，控件直接铺在宿主的 `<section data-plugin-config>` 里）、`.readOnly`（`margin: 0 0 12px`）、`.footer`（`padding-top: 16px` + `gap: 8px`；**无 border-top**）、`.save`。
- **保存按钮不右推**：官方没有 `margin-left:auto`，只有失败提示靠 `flex:1` 把按钮顶到右边；没有失败提示时按钮就在左边。
- 字段之间的分隔线不归这里，归 [fields.module.css](fields.module.css) 的 `.fields > * + *`。
- 被谁依赖：`BalanceSettingsCard.tsx`。
- 改后必测：`.form` 上不出现 border / border-radius / background / padding；`.footer` 不出现 border-top 与 `justify-content`；中性实线边框保持 0.5px。
- 错误文本用 `var(--dsw-alias-state-error-primary)`；官方 `--dsw-alias-label-error` 从未定义。

### fields.tsx

- 职责：字段行的容器与全部控件，以及分组的折叠头。
- 关键导出：`FieldGroup`、`FieldFrame`、`FieldBadges`、`TextControl`、`ReadOnlyControl`、`SelectorControl`、`ActionRow`、`DetailsGroup`，以及类型 `FieldStatus` 与 `SelectorOption`。
- `FieldGroup` 的折叠头用原语 `DisclosureRow`，不自己画；展开体由原语在 open 时条件渲染，无动画。
- `ReadOnlyControl` 是只读输入：字段照常渲染、**只 `readOnly` 不 `disabled`**（常态空框，不降透明度），**框内不写任何文字**，形态照官方「网页搜索」卡片的凭据字段。只读的因由由标签行右侧的状态徽章与它下方的说明行承担，两处文案都来自词典。
  **交互一律不响应**（`fields.module.css` 的 `input.inputStatic`，含 `pointer-events: none`）：悬停不换描边、指针是普通箭头不是插入符、点了也不出焦点环 —— 看着像能编辑才是错的。
- 凭据徽章只有两态（已配置密钥。/ 未配置密钥。），与官方「网页搜索」卡片一致；四档判据（覆盖 > 环境 > 配没配）只决定二级折叠里那两个字段的状态。
- `DetailsGroup` 是**二级折叠**，用原生 `<details>`/`<summary>` 而不是 `DisclosureRow` —— 官方那一处也是原生 details 配一个 `::before` 折角。它是受控但跟手的：`open` 由 state 持有，用户拨动时从 DOM 读回真实状态，卡片重渲染不会把它弹回去。
- 类名拼接统一用官方 `clsx`（平台样式规则要求），不自备工具函数。
- 被谁依赖：`BalanceSettingsCard.tsx`。
- 改后必测：数字字段仍是 `type="text"` + `inputMode="numeric"`；选择器仍是 pill + `Menu`；`FieldFrame` 在没有 hint 时不渲染说明行。

### fields.module.css

- 职责：字段行、行容器、控件与提示的样式；**纵向节奏的唯一所有者**。
- 关键规则：`.group`（顶部 12px）、`.groupLast`（尾部 12px）、`.groupNote`（margin-top 4px）、`.fields > * + *`（字段间 0.5px 分隔线）、`.field`（padding 12px 0）、`.row`（整行选择型，padding 12px 0）、`.input`（h34 r8）、`.selector`（h36 r18）。
- 被谁依赖：`fields.tsx`；`BalanceSettingsCard.tsx` 另用它的 `.field` 包住测试连接那一行。
- 改后必测：新增元素的纵向间距必须落在 12px 这一档；中性实线边框 0.5px、状态色边框 1px；全圆角与 `corner-shape: round` 成对。

### use-credential-state.ts

- 职责：问 `GET /api/v1/config` 要凭据的三个事实（`configured` / `source` / `writable`），决定只读凭据行显示哪一档。
- 关键导出：`useCredentialState(ref)`（返回 `CredentialInfo | null`）、`credentialViewOf(credential, overridden)` 与类型 `CredentialView`。
- `credentialViewOf` 是四档的唯一判据，优先级是 覆盖 > 环境 > 配没配；**组件里不许另写一份分支**。
- **读不到一律当 `null`**：宿主旧版本、请求失败、字段缺失都走这一条，绝不把 `undefined` 漏进组件（否则卡片会崩、整个 slot 条目消失）。
- 引用名一变就重读一次；用的是**生效**引用名，草稿未保存时后端认的仍是存下来的那个。
- 被谁依赖：`BalanceSettingsCard.tsx`。
- 改后必测：宿主回旧结构时卡片仍渲染（读不到一律当「环境提供」）；四档的优先级有专门用例，见 [test/use-credential-state.test.ts](../../../test/use-credential-state.test.ts)。

### use-config-form.ts

- 职责：字段规格表、草稿状态机、保存与读回判定，以及「测试连接」的本地模拟。
- 关键导出：`useConfigForm`、`writeFieldValue`、`ConfigFormOf`、`CONFIG_FIELDS`、`SPEC_BY_FIELD`、`FieldState`、`ConfigFormState`、`TestState`、`ConfigFormApi`、`textField` / `numberField` / `selectField`、`currencyCodes`、`AUTO_CURRENCY`、`KNOWN_CURRENCIES`、`probeFailure`、`TEST_LATENCY_MS`、`THRESHOLD_PAIRS`、`thresholdsOk`。
- **成对校验**：`thresholdsOk` 判「同一币种内告急 < 预警」，草稿为空时按**默认值**算（不是旧值），
  所以 `THRESHOLD_PAIRS` 里存了一份默认值 —— 两个半体不许值导入，这份抄写由 [test/threshold-pairs.test.ts](../../../test/threshold-pairs.test.ts) 对着宿主 schema 对账。
- **保存是一次原子提交**：`form.mutate(ops, revision)` 把全部字段放进同一道修订栅栏、一次宿主校验、一次落盘决定，
  所以**没有中间态**，成对字段的写入顺序不需要排。原先那个 `orderPairWrites` 因此退役（见接缝迁移的决策记录）。
- **失焦才提示**：`touch` / `touched` 记「哪些字段失焦过」，卡片据此决定要不要显示成对提示，避免打字中途闪一下。
  保存按钮不按这条走 —— 它看 `state.invalid`，有非法项立刻置灰。
- `CONFIG_FIELDS` 是字段清单的唯一来源：`SPEC_BY_FIELD` 由它派生，卡片渲染的每个字段都必须在这里登记。
- 被谁依赖：`BalanceSettingsCard.tsx`、`src/client/index.tsx`（`writeFieldValue` 供浮层「改用 X」）。
- 改后必测：字段名与宿主 `Config` 一一对应；`set` 返回值的透传（见下）；`probeFailure` 的两条失败规则。

## 对外事实

### ConfigForm 是最小依赖面

- 依赖面就是**官方的 `ctx.configForms.get(ENTRY_ID)`**，没有自家适配层：`getSnapshot()`、`subscribe(listener)`、
  `mutate(ops, revision)`、`set(field, value)`、`unset(field)`。
- 卡片只取快照里的四片：`value`（可为 `undefined`，首帧如此）、`user`、`writable`、`status === 'ready'`（收成 `available`）。
- **`available` 为假时卡片什么都不渲染**：与官方每张卡片一致（`ui-primitives` 的 `SettingsFormModel` 同样按 `status === 'ready'` 判）。
  空控件配一个能点的保存按钮，比不渲染更坏。
- 表单对象在 `apply` 期建一次、引用稳定，所以订阅回调与 `getSnapshot` 都不会每帧换新。
- 快照必须**引用稳定**地交给 `useSyncExternalStore`：`useConfigForm` 里那层缓存就是为它准备的（`asRecord(undefined)` 每次都造新对象）。

### 保存成败由返回值直接给出

- `set` / `unset` / `mutate` 返回 `Promise<boolean>`：**true = 宿主接受，false = 拒绝或整批跳过**（传输失败才 reject）。
- 所以「写完读回 user 层猜成败」那一套（原 `settle` / `landedWrite`）已经删掉 —— 判据更少，也更准。
- 保存是**一次 `mutate`**：草稿全量折成 ops 一起提交，接受就清草稿、拒绝就保留草稿并出 `role="status"` 提示。

### 纵向间距只有两个所有者

- `.group` 出顶部 12px，`.groupLast` 出尾部 12px。
- `.body` 的 `padding-bottom` 是 0，卡片 body 不再贡献纵向节奏。
- 只有卡片里的最后一组（刷新）带 `last`，由 `FieldGroup` 拼上 `.groupLast`。
- 12px 是块间距单位：组间距、字段上下边距、footer 分割线的上下距、按钮到卡片下缘的留白。4px 只用于组级说明贴标题。
- 效果：最后一组到 footer 分割线的距离，收起时等于组间距、展开时等于「末字段到下一组」的距离。

## 依赖面

- 运行时只 `require` `react`、`react/jsx-runtime` 与 `@deepseek-ai/dsh-client-ui-primitives`，其余全部内联。
- 用到的原语：`DisclosureRow`、`Menu`、`Tag`，以及 `IconChevronDownOutlineRegular` / `IconApiOutlineRegular` / `IconGlobeOutlineRegular` / `IconWarningOutlineRegular` / `IconRefreshOutlineRegular`（图标按**笔画粗细**分 `Regular` / `Medium`，尺寸走 `size` prop）。
- 颜色只走 `--dsw-alias-*` 语义令牌；主题信号只有 CSS 变量，不写 `prefers-color-scheme` 或 `[data-ds-dark-theme]`。
- 类名拼接用 `clsx`（devDependency，构建期内联）。