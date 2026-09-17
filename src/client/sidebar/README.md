# sidebar/ — 侧栏左下角条目的实现

- 职责：向宿主槽 `sidebar.footer.action` 提供余额条目（状态圆环 + 标签，点击展开信息浮层），并修正宿主 footer 容器的排版遗漏。
- 变更影响路由：改这里的可见行为 → 同步根 [README.md](../../../README.md) 与 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) 的界面小节；改 `footer-stack.module.css` → 同步 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) 的宿主覆盖说明。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 上层手册 → [../README.md](../README.md)。
- 回根 → [../../../AGENTS.md](../../../AGENTS.md)。

## 坐标

- 入口是 [../index.tsx](../index.tsx)：它 import 本目录的 `SidebarBalance`，并以副作用导入 `footer-stack.module.css`。
- 槽位声明、owner props 与渲染点都不在本目录，见根 [AGENTS.md](../../../AGENTS.md) 的「活跃坑」与 [决策记录](../../../.agents/notes/2026-09-17-footer-stack-override.md)。
- 宿主容器 `.footerActions` 的实情：不换行的 row flex、没有 `flex-direction`、没有 `gap`、没有 `flex-wrap`。

## 文件

### SidebarBalance.tsx

- 职责：条目全部行为 —— 场景订阅、币种选择、点击开关浮层、刷新模拟与冷却、Escape 与外部点击关闭。
- 关键导出：`SidebarBalance`（本目录唯一对外组件）、`SidebarBalanceProps`（`wide` / `t` / `config`）。
- 被谁依赖：[../index.tsx](../index.tsx) 的 `SidebarSeatComponent`。
- 改后必测什么：展开态（圆环 + 标签）与折叠态（36×36 圆环）都可见；点条目开浮层、Escape 与外部点击关；`aria-expanded` 跟随开合；**点上方邻居条目要落到邻居身上**。

### SidebarBalance.module.css

- 职责：条目几何 —— 展开态是整行 42px 条目，折叠态是 36×36 圆形命中区，两者各自的上外边距。
- 关键导出：CSS Module 类 `root` / `trigger` / `icon` / `label` / `marker`。
- 被谁依赖：`SidebarBalance.tsx`。
- 改后必测什么：展开态在侧栏 264~420px 全区间都不塌；折叠态与上方条目保持 8px 间距；根节点在纵向堆叠容器里仍占满一行。

### BalancePopover.tsx

- 职责：浮层表面 —— 标题行、余额/赠送/充值三行、币种不匹配的说明与两个动作、底部刷新时间与刷新按钮。
- 关键导出：`BalancePopover`、`BalancePopoverProps`、`BALANCE_PLACEHOLDER`。
- 被谁依赖：`SidebarBalance.tsx`，经 `createPortal` 挂到 `document.body`。
- 改后必测什么：面板 `role="dialog"` 与 `aria-label` 仍在；三行金额与时间文案随场景变化；刷新按钮的进行中与冷却两态；点浮层内部不关闭浮层。

### BalancePopover.module.css

- 职责：浮层皮肤，逐条对齐官方 `ui-chat` 的 `stat-dialog.module.css`（StatsPills 与 TurnUsagePanel 共用那套）。
- 关键导出：CSS Module 类 `panel` / `title` / `titleLabel` / `titleRule` / `details` / `notice` / `noticeText` / `noticeActions` / `footer` / `updated` / `status` / `refresh`。
- 被谁依赖：`BalancePopover.tsx`。
- 改后必测什么：宽度三行（`max-content` + 上下界都随视口收缩）在窄窗口下不溢出；标题与明细之间只有一条分隔线；亮暗两色下文字仍可读。

### PercentRing.tsx

- 职责：折叠与展开**共用**的状态圆环；弧长是「余额 / `warn` 阈值」的比例，颜色只表达状态。
- 关键导出：`PercentRing`、`PercentRingProps`（`state` / `marker` / `ratio` / `size` / `title`）、`RingState`。
- `marker` 是中心符号，目前只有 `'cross'`：`unavailable` 用它把「账户维度不可用」与 `critical` 的「余额维度告急」分开 —— 两者都是红弧，因为官方 token 没有第五种色相（详见 [docs/ui-handoff.md](../../../docs/ui-handoff.md) 第四节）。
- 被谁依赖：`SidebarBalance.tsx`，两个形态都用它；形态由 [../model.ts](../model.ts) 的 `ringSpecOf` 给出，弧长由同一个文件的 `ringRatioOf` 给出。
- 改后必测什么：四档 `state` 各自的颜色；`ratio` 为 0 时 svg 里没有 `.fill` 那条弧、为 1 时是满环；`unavailable` 时 svg 里恰好多两条 `<line>`；svg 自身的 `aria-hidden` 仍在（语义由外层 `aria-label` 承担）；折叠态的 `title` 只在有状态文案时出现。

### PercentRing.module.css

- 职责：圆环几何（轨道 + 进度环 + 中心叉号）与按 `data-state` 的配色。
- 关键导出：CSS Module 类 `ring` / `track` / `fill` / `cross`。
- **颜色只在 `.ring[data-state='...']` 上定一次**（赋给 `color`），弧与叉号都取 `currentColor`；别在两处各写一份 token。
- 被谁依赖：`PercentRing.tsx`。
- 改后必测什么：轨道与环线宽一致（都是 2）；四档 `data-state` 全部命中；叉号比环细一档且随 viewBox 缩放；圆角线帽只加在环与叉号上、轨道保持平头。

### footer-stack.module.css

- 职责：修正宿主 `.footerActions` 的排版遗漏 —— 它被写成不换行的 row flex 且没有 `flex-direction`。
- 关键导出：没有类名，只有一条全局规则 `div:has(> [data-slot='sidebar.footer.action']) { flex-direction: column }`。
- 为什么存在：两个真实占用者（官方 cordis 面板、已装第三方用量面板）都把根节点写成满宽且 `flex: none`，横排下后一个条目会被挤到 0 宽、彻底不可见。
- 关键机制：宿主类名是 CSS Modules 哈希、写不出来，只能用槽锚点反选它的父元素。
- **依赖面：这条规则依赖浏览器支持 `:has()`，并依赖框架统一添加且始终存在的 `data-slot="sidebar.footer.action"` 锚点属性。**
- 锚点为什么唯一：那个锚点是 `display: contents`，所以它的父元素有且只有一个，就是 `.footerActions`。
- 被谁依赖：[../index.tsx](../index.tsx) 的副作用导入。
- 改后必测什么：footer 里多个条目纵向堆叠、每条都完整可见；宿主若以后自行补上 `flex-direction`，本规则与之一致、不冲突。

## 与外部插件的隐式契约

- 已装第三方插件 `dsh-usage-statistics-panel` 用 `button[aria-haspopup="dialog"]` 从它自己的按钮往上逐层查找设置触发按钮，所以我们的触发按钮不带这个属性。
- 同一个插件还扫 `[role="dialog"] nav button` 并按文字匹配注入图标，所以本目录的浮层里不放 `<nav>` 包着的按钮。
- 详情与后果见 [AGENTS.md](AGENTS.md)。
