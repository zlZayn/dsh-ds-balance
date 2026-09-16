# src/client/settings/ — 设置卡片手册

- 职责：把本插件的配置渲染成设置页里的一张卡片；四组配置各自可折叠，编辑先落本地草稿，保存是草稿变成设置的唯一出口。
- 变更影响路由：改字段名 → 同步宿主 schema [src/index.ts](../../index.ts) 的 `Config`；改对外可见行为 → 同步 [docs/ui-handoff.md](../../../docs/ui-handoff.md) 的设置小节、根 [README.md](../../../README.md) 与 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 回根 → [../../../AGENTS.md](../../../AGENTS.md)（仓库根）；直接上层是 [../AGENTS.md](../AGENTS.md)（src/client 规则层）。

本文件按**符号名**引用代码，不写行号 —— 行号每改一次代码就会漂，符号名不会。

## 文件

### BalanceSettingsCard.tsx

- 职责：卡片本体。持有卡片展开、密钥显隐、分组展开三份局部状态，外加一个保存起始标记（ref）；把 `useConfigForm` 的状态翻译成 JSX。
- 关键导出：`BalanceSettingsCard`、`BalanceSettingsCardProps`，并转发 `SettingsScope`。
- 分组：连接 → 展示 → 阈值 → 刷新。这是 UI 的排列顺序（按使用频率）；宿主 `Config` 的字段顺序是 连接 → 刷新 → 展示 → 阈值，**两者有意不同**，见 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) 的关键决策。
- 默认展开：四组全收起（`DEFAULT_GROUP_OPEN` 全 `false`），卡片一打开只占四行折叠头。
- 组内有非法草稿时该组强制展开（`groupOpenNow`），否则 footer 的「请检查标红的字段」会指向一个收起来的组。
- 被谁依赖：`src/client/index.tsx` 的 `SettingsSeatComponent`。
- 改后必测：四组各自展开与收起；暂存、保存、放弃；非法数字禁用保存；密钥显隐切换；测试连接的三种结果。

### BalanceSettingsCard.module.css

- 职责：卡片外壳与卡级提示的样式；取值逐条对齐官方 `ui-settings-plugins/PluginCard.module.css`。
- 关键规则：`.card`（0.5px 边框 + radius 16）、`.header`、`.body`（border-top 0.5px + margin 0 16px + **padding-bottom 0**）、`.footer`（padding 12px 0 4px + border-top 0.5px）。
- 被谁依赖：`BalanceSettingsCard.tsx`。
- 改后必测：`.body` 的 `padding-bottom` 保持 0（尾部间距归 `.groupLast`）；中性边框保持 0.5px。
- 错误文本用 `var(--dsw-alias-state-error-primary)`；官方 `--dsw-alias-label-error` 从未定义。

### fields.tsx

- 职责：字段行的容器与全部控件，以及分组的折叠头。
- 关键导出：`FieldGroup`、`FieldFrame`、`FieldBadges`、`TextControl`、`SecretControl`、`SelectorControl`、`ActionRow`，以及类型 `FieldStatus` 与 `SelectorOption`。
- `FieldGroup` 的折叠头用原语 `DisclosureRow`，不自己画；展开体由原语在 open 时条件渲染，无动画。
- 类名拼接统一用官方 `clsx`（平台样式规则要求），不自备工具函数。
- 被谁依赖：`BalanceSettingsCard.tsx`。
- 改后必测：数字字段仍是 `type="text"` + `inputMode="numeric"`；选择器仍是 pill + `Menu`；`FieldFrame` 在没有 hint 时不渲染说明行。

### fields.module.css

- 职责：字段行、行容器、控件与提示的样式；**纵向节奏的唯一所有者**。
- 关键规则：`.group`（顶部 12px）、`.groupLast`（尾部 12px）、`.groupNote`（margin-top 4px）、`.fields > * + *`（字段间 0.5px 分隔线）、`.field`（padding 12px 0）、`.row`（整行选择型，padding 12px 0）、`.input`（h34 r8）、`.selector`（h36 r18）。
- 被谁依赖：`fields.tsx`；`BalanceSettingsCard.tsx` 另用它的 `.field` 包住测试连接那一行。
- 改后必测：新增元素的纵向间距必须落在 12px 这一档；中性实线边框 0.5px、状态色边框 1px；全圆角与 `corner-shape: round` 成对。

### use-config-form.ts

- 职责：字段规格表、草稿状态机、保存与读回判定，以及「测试连接」的本地模拟。
- 关键导出：`useConfigForm`、`SettingsScope`、`SettingsScopeSnapshotLike`、`CONFIG_FIELDS`、`SPEC_BY_FIELD`、`FieldState`、`ConfigFormState`、`TestState`、`ConfigFormApi`、`textField` / `numberField` / `selectField`、`currencyCodes`、`AUTO_CURRENCY`、`KNOWN_CURRENCIES`、`probeFailure`、`TEST_LATENCY_MS`。
- `CONFIG_FIELDS` 是字段清单的唯一来源：`SPEC_BY_FIELD` 由它派生，卡片渲染的每个字段都必须在这里登记。
- 被谁依赖：`BalanceSettingsCard.tsx`；`src/client/index.tsx` 只用它的两个类型。
- 改后必测：字段名与宿主 `Config` 一一对应；保存后的读回判定（见下）；`probeFailure` 的两条失败规则。

## 对外事实

### SettingsScope 是最小依赖面

- 只有四个成员：`getSnapshot()`、`subscribe(listener)`、`set(field, value)`、`unset(field)`。
- 快照只取三片：`value`、`user`、`writable`（`SettingsScopeSnapshotLike`）。
- 真实 `ctx.settingsScope.bind()` 的快照还带 `status` / `base` / `revision` / `mode`，多余字段不影响结构兼容。
- 适配层在 `src/client/index.tsx` 的 `adaptScope`：它把 `value` 的 `undefined` 收窄成 `{}`、把 `user` 收窄成对象，并在方法缺失时退化成只读。
- 适配层必须返回引用稳定的对象，并在 `apply` 期建一次；`subscribe` / `getSnapshot` 都以它为依赖，每帧换新对象会导致每帧重订阅。
- 改这个接口就是改跨文件契约，必须同时改 `src/client/index.tsx` 的适配层。

### 保存成败靠读回快照判定

- 宿主拒绝写入时**不抛错**：`set` / `unset` 正常 resolve。
- 因此每个字段写完都要读回：`clear` 要求 `user` 层不再有该字段；`set` 要求 `user` 层有该字段且值相等（`landedWrite`）。
- 任一字段没落定即整体判失败，草稿保留，footer 出 `role="status"` 提示。
- `set` / `unset` 的返回值必须原样透传（真实实现返回 Promise）；把 Promise 丢掉，读回时永远看不到落定，每次保存都会误报失败。

### 纵向间距只有两个所有者

- `.group` 出顶部 12px，`.groupLast` 出尾部 12px。
- `.body` 的 `padding-bottom` 是 0，卡片 body 不再贡献纵向节奏。
- 只有卡片里的最后一组（刷新）带 `last`，由 `FieldGroup` 拼上 `.groupLast`。
- 12px 是块间距单位；4px 只用于组级说明贴标题与卡片下缘的按钮外余量。
- 效果：最后一组到 footer 分割线的距离，收起时等于组间距、展开时等于「末字段到下一组」的距离。

## 依赖面

- 运行时只 `require` `react`、`react/jsx-runtime` 与 `@deepseek-ai/dsh-client-ui-primitives`，其余全部内联。
- 用到的原语：`DisclosureRow`、`Menu`、`Tag`，以及 `IconChevronDownOutline14` / `IconInspectOutline12` / `IconApiOutline14` / `IconGlobeOutline14` / `IconWarningOutline16` / `IconRefreshOutline14`。
- 颜色只走 `--dsw-alias-*` 语义令牌；主题信号只有 CSS 变量，不写 `prefers-color-scheme` 或 `[data-ds-dark-theme]`。
- 类名拼接用 `clsx`（devDependency，构建期内联）。