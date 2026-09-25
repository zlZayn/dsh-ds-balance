# sidebar/ — 侧栏左下角条目的实现

- 职责：向宿主槽 `sidebar.footer.action` 提供余额条目（状态圆环 + 标签，点击展开信息浮层），并修正宿主 footer 容器的排版遗漏。
- 变更影响路由：改这里的可见行为 → 同步根 [README.md](../../../README.md) 与 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) 的界面小节；改 `footer-stack.module.css` → 同步 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) 的宿主覆盖说明。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 上层手册 → [../README.md](../README.md)。
- 回根 → [../../../AGENTS.md](../../../AGENTS.md)。

## 坐标

- 入口是 [../index.tsx](../index.tsx)：它 import 本目录的 `SidebarBalance`，并以副作用导入 `footer-stack.module.css`。
- 槽位声明、owner props 与渲染点都不在本目录，见根 [活跃坑](../../../AGENTS.md#活跃坑) 与 [决策记录](../../../.agents/notes/2026-09-17-footer-stack-override.md)。
- 宿主容器 `.footerActions` 的实情：不换行的 row flex、没有 `flex-direction`、没有 `gap`、没有 `flex-wrap`。

## 文件

### SidebarBalance.tsx

- 职责：条目全部行为 —— 场景订阅、**币种选择**（浮层的「改用 X」直接写设置作用域的 `displayCurrency`，与设置卡片共用同一条写路径，见 [决策记录](../../../.agents/notes/2026-09-19-currency-single-source.md)）、点击开关浮层、**展开态悬浮条目报出余额金额**、刷新模拟与冷却、Escape 与外部点击关闭。
- 关键导出：`SidebarBalance`（本目录唯一对外组件）、`SidebarBalanceProps`（`wide` / `t` / `config` / `configSlotProbe`）。
- `configSlotProbe` 由 [../index.tsx](../index.tsx) 建好后经 props 传进来，本目录只订阅它的三态（`useConfigSlotState`）；**提示必须可撤销**，所以订阅而不是读一次。
- **悬浮气泡只挂展开态**：整条按钮包一层官方 `Tooltip`，内容是「Balance 那一条」的金额（`formatMoney`，与浮层第一行同源），标题 / 赠送充值拆分 / 状态解释都不加；底色用原语自带的 `--dsw-alias-tooltip-bg`，**不许自绘黑底**（字面色值红线，自绘也会跟主题脱节）。没有金额时回落到状态文案，两者都没有就不挂 —— 不留空气泡。
  折叠态（rail）**不挂**：那里已经由 `PercentRing` 的原生 `title` 承担同一件事，再叠一层就是两层提示。
- **同一时刻只允许一个气泡**：标记（感叹号）那层 `Tooltip` 嵌在外层里，原语用 `TooltipSuppression` 上下文让内层可见时压掉祖先；**浮层已打开时外层 `disabled`**（面板里就有这份数据，且指针通常还停在条目上）。动这两层包装要实机复核。
- 被谁依赖：[../index.tsx](../index.tsx) 的 `SidebarSeatComponent`。
- 改后必测什么：展开态（圆环 + 标签）与折叠态（36×36 圆环）都可见；**折叠态的悬浮背景与上方官方条目同为 12px 圆角（不是正圆）**；点条目开浮层、Escape 与外部点击关；`aria-expanded` 跟随开合；**点上方邻居条目要落到邻居身上**；展开态悬浮出气泡且只报金额、**指针停在感叹号上只有一个气泡**、浮层打开时不出气泡、折叠态不挂 Tooltip。

### SidebarBalance.module.css

- 职责：条目几何 —— 展开态是整行 42px 条目；折叠态是 36×36 命中区，**悬浮背景是 12px 圆角矩形**（与官方 `.collapsed .iconButton` 同款；圆角形状由全局 `--dsw-corner-shape` 的 `superellipse(1.5)` 决定，本处**不写** `corner-shape: round`），两者各自的上外边距。
- 关键导出：CSS Module 类 `root` / `trigger` / `icon` / `label` / `marker`。
- **`.marker` 的 1.5px 相对位移是墨迹对齐，不是布局修正**：三个盒子（按钮 42 / 标签 22 / 标记 12）的中心逐值相同，偏的是**墨迹** —— 图标墨迹就在它自己的盒中心，文字墨迹比 22px 行盒中心低（实测中文标签 +1.25px、英文 +2.00px），所以图标看着**偏高**。补偿只写这一格（`position: relative; top: 1.5px`，两种标签的残差 0.25 / 0.50px），**不动 `.label`、不动行高** —— 那会改到整行几何与邻居。
- 被谁依赖：`SidebarBalance.tsx`。
- 改后必测什么：展开态在侧栏 264~420px 全区间都不塌；折叠态与上方条目保持 8px 间距；根节点在纵向堆叠容器里仍占满一行；**`.marker` 的 1.5px 还在**（删掉它就回到「图标偏高」）。

### BalancePopover.tsx

- 职责：浮层表面 —— 标题行（**左端图标与文字是一个外链**、**右端一个无文字的 Plugins 图标按钮**，见下）、余额/赠送/充值三行、币种不匹配的说明与**只剩一个**的动作（「改用 X」）、缺配置槽的诊断行、底部刷新时间与刷新按钮。
- 关键导出：`BalancePopover`、`BalancePopoverProps`（除 `configSlotWarning` 外，还有 `useShownDisabled` 与 `pluginsAction`；`onOpenPlugins` / `onOpenSettings` 已随落点改档与「去设置」删掉）、`PluginsAction`（动作 + 落点，见下）、`BALANCE_PLACEHOLDER`。
- `configSlotWarning` 非 null 时复用既有的 `notice` / `noticeText` 渲染一行英文 `[WARN]`（无动作按钮、无新增样式）。
- 标题行是外链：`https://platform.deepseek.com/usage`，`target="_blank"` + `rel="noopener noreferrer"`，新标签页打开官网用量页；文字带下划线但**颜色 `inherit`**（宿主没有「链接色」这类语义 token，硬套会破配色纪律），图标是 svg、不吃 `text-decoration`。
- **标题行右端的 Plugins 图标按钮**：无可见文字，`aria-label` 与 tooltip **逐字同源**（同一个 `pluginsLabel`）；图标 `IconPluginPinwheelOutlineRegular` 与宿主侧栏 Plugins 条目同字形（图标按**笔画粗细**分 `Regular` / `Medium`，尺寸走 `size` prop），样式逐值照抄宿主 `.iconButton`（28×28、全圆角**成对写** `corner-shape: round`、hover 用 `--dsw-alias-interactive-bg-hover`），并显式 `cursor: pointer`（浮层面板自己写了 `cursor: default`）。点它跳转并**关闭浮层**。
- **落点是两档，措辞跟着分档**（`PluginsAction.reachesConfig`，由 [../index.tsx](../index.tsx) 的 `createPluginsNavigation` 按**服务在不在**给出）：
  ① 宿主 provide 了跨插件深链服务 `pluginNavigation.openBundle(包名)` 时**直达本插件的配置格**，话术是「打开插件配置页」；
  ② 服务缺席（更早的宿主线）或深链抛错时退回 `ctx.layout.selectPanel('plugins')` 的 **Plugins 列表页**，话术跟着退回「打开插件页」。
  **不许用一句话盖住两种落点** —— 说了去哪就得去哪，这与「不留按不动的死按钮」是同一条纪律。
  两条链各自 `ctx.inject`、各有挂载点（谁先到都不影响另一个）；`layout` 服务缺席时**整块不渲染**，深链与 `selectPanel` 的抛错各有具名 catch，都只 `console.warn` 一笔。
  面板 id 与包名都用字面量（`'plugins'` / `BUNDLE_CONFIG_KEY`），**不 import 别的 feature plugin 的值导出**。宿主侧的缝：`ui-plugin-manager/src/client/index.ts` 的 `ctx.reflect.provide('pluginNavigation', …)` 与 `ui-layout/src/client/service.ts` 的 `selectPanel`。
  **判据是服务在不在，不是版本号**：同一份产物在不同宿主线上落点不同 —— 装到没有那条服务的宿主上，深链这一档整条不存在（本机踩过，见[本轮记录](../../../.agents/notes/2026-09-25-deep-link-needs-host-service.md)）。
- 被谁依赖：`SidebarBalance.tsx`，经 `createPortal` 挂到 `document.body`。
- 改后必测什么：面板 `role="dialog"` 与 `aria-label` 仍在；三行金额与时间文案随场景变化；刷新按钮的进行中与冷却两态；点浮层内部不关闭浮层；点标题确认新标签页打开官网用量页、当前页不跳转、浮层不关、文字颜色与改动前一致；**右上角图标的悬浮文字与它真正的落点一致**（有深链服务 ⇒「打开插件配置页」且落在本插件的配置格；没有 ⇒「打开插件页」且落在列表页）且点击后浮层关闭；宿主无 `layout` 服务时该图标不出现；币种不匹配那段只有一个按钮。

### BalancePopover.module.css

- 职责：浮层皮肤 —— **容器句**逐条对齐官方 `ui-chat` 的 `stat-dialog.module.css`（StatsPills 与 TurnUsagePanel 共用那套），**材质句**照同槽邻居的官方 cordis 面板 `packages/extensions/ui-cordis/src/client/CordisPanel.module.css`。
- 关键导出：CSS Module 类 `panel` / `panel::before` / `title` / `titleLabel` / `titleRule` / `iconButton` / `details` / `notice` / `noticeText` / `noticeActions` / `footer` / `updated` / `status` / `refresh`。
- **材质分两层，别合回一层**：`.panel` 只留 `isolation: isolate` / `z-index` / 圆角 / `box-shadow` 与描边重绑；半透明填充与 `backdrop-filter: var(--dsw-menu-backdrop-filter)` 画在 `.panel::before` 上。理由两层：
  ① 官方规范要求写 `--dsw-specific-menu` 的表面在同一条规则里配那条滤镜（官方把菜单材质拆成了这两条 token）；
  ② 滤镜非 `none` 的元素会成为 fixed 后代的包含块，而本面板内部有两个**非 portal** 的 Tooltip 气泡（Plugins 图标与刷新按钮）——写在 `.panel` 上会让它们按视口算好的坐标变成相对面板的偏移，气泡直接跑出屏幕。
- 被谁依赖：`BalancePopover.tsx`。
- 改后必测什么：宽度三行（`max-content` + 上下界都随视口收缩）在窄窗口下不溢出；标题与明细之间只有一条分隔线；亮暗两色下文字仍可读；**悬停右上角 Plugins 图标与右下角刷新按钮时，气泡仍紧贴各自的按钮**（材质层回归判据）；**面板背后有内容时看得出模糊**。

### PercentRing.tsx

- 职责：折叠与展开**共用**的状态圆环；弧长是「余额 / `warn` 阈值」的比例，颜色只表达状态。
- 关键导出：`PercentRing`、`PercentRingProps`（`state` / `marker` / `ratio` / `size` / `title`）、`RingState`。
- `marker` 是中心符号，目前只有 `'cross'`：`unavailable` 用它把「账户维度不可用」与 `critical` 的「余额维度告急」分开 —— 两者都是红弧，因为官方 token 没有第五种色相（详见 [docs/ui-handoff.md](../../../docs/ui-handoff.md)）。
- 被谁依赖：`SidebarBalance.tsx`，两个形态都用它；形态由 [../model.ts](../model.ts) 的 `ringSpecOf` 给出，弧长由同一个文件的 `ringRatioOf` 给出。
- **几何分两处照官方，不是整份照抄同一个文件**：网格与笔画照左栏那批图标（`viewBox="0 0 16 16"`、笔画 1 = 宿主 `ui-primitives/src/icons/index.tsx:21` 的 `ICON_REGULAR_STROKE`），弧的读法照官方 `ContextMeter`（宿主 `packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx:117-127`）。圆心 (8,8)、`r=6.5`（与官方 `ContextMeter` 同一个公式：边长/2 − 圆留白 − 笔画/2）：墨迹外径 14 落在 16 的格里、四周各留 1，与官方字形 12–13.75 的墨迹跨度同档（另加一格容差，见红线）。
- 改后必测什么：四档 `state` 各自的颜色；`ratio` 为 0 时 svg 里没有 `.fill` 那条弧、为 1 时是满环；`unavailable` 时 svg 里恰好多两条 `<line>`；svg 自身的 `aria-hidden` 仍在（语义由外层 `aria-label` 承担）；折叠态的 `title` 只在有状态文案时出；**弧的接缝仍在 12 点** —— 靠 `transform="rotate(-90 8 8)"`（圆心跟着 `VIEW` 走），**不是 `stroke-dashoffset`**（换成 dashoffset 会把接缝挪回 3 点）。

### PercentRing.module.css

- 职责：圆环几何（轨道 + 进度环 + 中心叉号）与按 `data-state` 的配色。
- 关键导出：CSS Module 类 `ring` / `track` / `fill` / `cross`。
- **颜色只在 `.ring[data-state='...']` 上定一次**（赋给 `color`），弧与叉号都取 `currentColor`；别在两处各写一份 token。
- 被谁依赖：`PercentRing.tsx`。
- 改后必测什么：轨道与环线宽一致（都是 1）；**四档 `data-state` 全部命中，含 `idle` 走 `--dsw-alias-state-idle-primary`**；叉号与环同宽（都是 1）且随 viewBox 缩放；圆角线帽只加在环与叉号上、轨道保持平头。

### footer-stack.module.css

- 职责：修正宿主 `.footerActions` 的排版遗漏 —— 它被写成不换行的 row flex 且没有 `flex-direction`。
- 关键导出：没有类名，只有一条全局规则 `div:has(> [data-slot='sidebar.footer.action']) { flex-direction: column }`。
- 为什么存在：两个真实占用者（官方 cordis 面板、已装第三方用量面板）都把根节点写成满宽且 `flex: none`，横排下后一个条目会被挤到 0 宽、彻底不可见。
- 关键机制：宿主类名是 CSS Modules 哈希、写不出来，只能用槽锚点反选它的父元素。
- **依赖面：这条规则依赖浏览器支持 `:has()`，并依赖框架统一添加且始终存在的 `data-slot="sidebar.footer.action"` 锚点属性。**
- 锚点为什么唯一：那个锚点是 `display: contents`，所以它的父元素有且只有一个，就是 `.footerActions`。
- 被谁依赖：[../index.tsx](../index.tsx) 的副作用导入。
- 改后必测什么：footer 里多个条目纵向堆叠、每条都完整可见；宿主若以后自行补上 `flex-direction`，本规则与之一致、不冲突。

## 时效

- 后端只说「这份快照到现在多久」（`ageMs`），本地年龄由前端自己推。
- **基准是「收到那份响应的时刻」**，不是组件挂载时刻。基准不跟着响应走的话，
  自动轮询带回来的新快照永远拨不回「刚刚」，只有手动刷新看起来才会动 —— 那是一条真实缺陷。
- 判据只有一处：[../model.ts](../model.ts) 的 `currentAgeMs`（已知年龄 + 此后流逝的时间）。
- 视图与基准在 `SidebarBalance.tsx` 里合成同一份状态（`view`）：两者必须一起换。
- **端点不可达时不动基准**：那条路上没有新快照，说「刚刚」是假话。
- 浮层只收一个算好的 `ageMs`，自己不做时间算术；年龄只在浮层打开时按秒推进。

## 与外部插件的隐式契约

- 已装第三方插件 `dsh-usage-statistics-panel` 用 `button[aria-haspopup="dialog"]` 从它自己的按钮往上逐层查找设置触发按钮，所以我们的触发按钮不带这个属性。
- 同一个插件还扫 `[role="dialog"] nav button` 并按文字匹配注入图标，所以本目录的浮层里不放 `<nav>` 包着的按钮。
- 详情与后果见 [AGENTS.md](AGENTS.md)。
- **存史**：上面两条的依据是**当时**邻居插件自己的实现 —— 它不是我们的依赖；记下来是为了解释这两个"不做"为什么存在，完整事故见 [postmortem](../../../docs/postmortem/2026-09-17-aria-haspopup-neighbour-collision.md)。
