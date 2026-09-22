# sidebar/ — 规则层

继承根规则，见 [../../../AGENTS.md](../../../AGENTS.md)。

sidebar/ 特有约束：

- 触发按钮**不许**写 `aria-haspopup`。
  - 理由：已装的 `dsh-usage-statistics-panel` 用 `button[aria-haspopup="dialog"]` 从它自己的按钮往上逐层 `querySelector` 去找设置触发按钮，并假设整条侧栏底部只有一个这样的按钮。
  - 后果：我们与它同在一个槽容器里、注册得又比它晚，那个选择器会先命中我们并 `click()`，表现成「点邻居却弹出我们的浮层」。
  - 替代：用 `aria-expanded` 表达同一个事实，它不会被那条启发式命中；浮层面板自己的 `role="dialog"` 不受影响。
  - 落地位置与完整说明：`SidebarBalance.tsx` 里触发按钮上方的注释。
- 浮层里**不许**放 `<nav>` 包着的按钮。
  - 理由：同一个插件的 MutationObserver 会扫 `[role="dialog"] nav button`。
  - 后果：按钮文字若与它自己的分区名相同，它会摘掉该按钮的第一个 `<svg>` 并塞进自己的图标。
- **存史（2026-09-20）**：上面两条的成因是**当时**邻居插件自己的实现 —— 它不是我们的依赖，
  也不属本工作区。此两条仅存史，解释触发按钮与浮层的形状为什么是这样；
  完整事故见 [postmortem](../../../docs/postmortem/2026-09-17-aria-haspopup-neighbour-collision.md)。
- 折叠与展开**共用同一个 `PercentRing`**，不许出现形态切换。
  - 即：侧栏开合时图标不能从一种图形换成另一种，两态只能相差尺寸。
- 浮层**关闭态必须是卸载**（`{open ? createPortal(...) : null}`），不许留下任何可命中区域。
  - 理由：面板是 `position: fixed` 的大盒子，若留在 DOM 里会参与命中测试并盖住邻居。
- 浮层只经 `createPortal` 挂到 `document.body`，外部点击判定必须传第 4 个参数 `panelRef`。
  - 理由：面板 portal 出去后不再是根元素的 DOM 后代，不传就会被判成「外部」，点浮层内部也会关闭。
- 浮层定位只用 `useAnchoredPosition`（`side: 'top'` / `gap: 8` / `margin: 12`）配 `MEASURE_STYLE`，不许手写 `getBoundingClientRect` 定位。
  - 理由：滚动（capture 阶段）、窗口缩放、面板自身尺寸变化的重算都在那个 hook 里。
  - 注意：它的 `side` 只有 `'top'` 与 `'bottom'`，水平方向没有分支。
- 金额一律按字符串处理，只用 `../model.ts` 的 `formatMoney` / `formatAmount`。
  - 禁止 `parseFloat` 后比较或累加；相等与累加都在后端。
- 颜色只由 `severity` 决定，链路是 `severity → dotStateOf → RingState → data-state → token`。
  - 唯一例外是弧长：由 `../model.ts` 的 `ringRatioOf` 用 `total` 与 `warn` 阈值算出，它是几何不是配色。
  - 不许为标记另起一套配色，也不许拿阈值决定任何颜色。
- 样式只写 CSS Modules 类与 `--dsw-alias-*` 语义 token。
  - 禁止字面色值；禁止 `[data-ds-dark-theme]` 与 `prefers-color-scheme` 选择器。
- 全圆角必须成对写 `corner-shape: round`；中性实线边框统一 `0.5px`。
  - 高程表面写 `border: 0` + `box-shadow: var(--dsw-elevation-*)`，两者不同时用。
- 组件拿不到 `ctx`，数据只走 props。
- 相对导入保留 `.ts` / `.tsx` 后缀。
- 跨插件**只走 Cordis 服务**，不许运行时 import 别的 feature plugin 的值导出。
  - 理由：仓库红线，`bundle-purity gate` 会拒；`ui-plugin-manager` 的 `PANEL_ID` 正是值导出。
  - 替代：面板 id 用本目录的字面量常量（`'plugins'`），注释里带宿主 `路径:行号` 引用 —— 见 `../index.tsx` 的 `PLUGINS_PANEL_ID`，对照 `ui-plugin-manager/src/client/index.ts:47`。
- 消费宿主的跨插件服务一律**鸭子类型收窄**，不 import 宿主包的类型、不为它新增 npm 依赖。
  - 理由：那些包不在本仓的 `node_modules` 与 `package-lock.json` 里，`import type` 也会给声明面添一条边。
  - 先例：`../index.tsx` 的 `LayoutFace`（公开面见宿主 `ui-layout/src/client/service.ts:28-52` 的 `ILayout`）。
  - **配置表单不必再走这一手**：`ctx.configForms.get(ENTRY_ID)` 是官方客户端服务，
    类型可以直接引（原先那个 `RawScope` 鸭子类型适配层随被删的客户端作用域服务一起删了）。
- 可选服务**不许塞顶层 `inject`**（缺服务会让整个插件不装载），必须 `ctx.inject([...], …)` 把门并留降级路径。
  - 降级的表现是**不留死入口**，而不是「假装能用」：服务缺席时那枚图标整块不渲染，只留一句可撤销的说明。
- 调宿主**会抛**的接口要**具名 catch**：注释写清抛因与后果，并留一行记录（`console.warn`）。
  - 理由：宿主拒绝不是错误信号，不写清楚下一个人只看到「点了没反应」。
  - 先例：`../index.tsx` 的 `selectPanel` 那处 —— 面板 id 未注册时会抛（宿主 `ui-layout/src/client/service.ts:69-71`），profile 里没装 plugin-manager 时那个面板不存在。
  - 例外：纯粹降级的分支可用带注释的 `catch {}`，但注释要写清退化成什么（`BalancePopover.tsx` 的 `Intl` 退化）。
- 状态值**本身是函数**时，必须走 setter 的 updater 形式（`setX(() => fn)`），不能 `setX(fn)`。
  - 理由：React 见到函数就当更新器，状态恒为它的返回值 —— 本目录踩过一次，图标因此永不渲染 → [决策记录](../../../.agents/notes/2026-09-19-setstate-function-value-updater.md)。
- `footer-stack.module.css` 的选择器不许加类名，改动它必须知道它依赖 `:has()` 与 `data-slot` 锚点属性。
  - 宿主类名是 CSS Modules 哈希、写不出来；锚点是 `display: contents`，所以父元素唯一。
- 浮层向上展开，**打开时会盖住上方邻居那一格**：footer 条目纵向堆叠，`side: 'top'` 的浮层底边正落在邻居底边。
  - 这是既定取舍（与官方 cordis 面板同构），**不许用右侧哨兵之类的办法去「顺便修好」** —— 实机上看位置与触发元素脱节，已回退过。
  - 关键只在于「关闭时点邻居落到邻居身上」，那由触发按钮不写 `aria-haspopup` 保证。
