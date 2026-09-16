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
  - 这里不许出现任何金额阈值判断，也不许为标记另起一套配色。
- 样式只写 CSS Modules 类与 `--dsw-alias-*` 语义 token。
  - 禁止字面色值；禁止 `[data-ds-dark-theme]` 与 `prefers-color-scheme` 选择器。
- 全圆角必须成对写 `corner-shape: round`；中性实线边框统一 `0.5px`。
  - 高程表面写 `border: 0` + `box-shadow: var(--dsw-elevation-*)`，两者不同时用。
- 组件拿不到 `ctx`，数据只走 props。
- 相对导入保留 `.ts` / `.tsx` 后缀。
- `footer-stack.module.css` 的选择器不许加类名，改动它必须知道它依赖 `:has()` 与 `data-slot` 锚点属性。
  - 宿主类名是 CSS Modules 哈希、写不出来；锚点是 `display: contents`，所以父元素唯一。
