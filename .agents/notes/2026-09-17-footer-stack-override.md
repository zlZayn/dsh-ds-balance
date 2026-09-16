# 决策：插件侧把 footer 容器改回纵向堆叠（2026-09-17）

已实施。

## 问题

`sidebar.footer.action` 的宿主容器 `.footerActions` 被写成不换行的 row flex：`{ flex:none; width:100%; min-width:0; display:flex }`，没有 `flex-wrap`、没有 `gap`。

已装的两个占用者又都是「满宽 + 不可收缩」：

- 官方 cordis 面板 `.layer`：`flex:none; width:100%`。
- `dsh-usage-statistics-panel` 的 `.entry`：`width: calc(100% + 4px); flex:none`。

横排容器内容宽 276px，用量条目的外边距盒正好吃满 276px，负剩余空间全部落到后注册的条目上。我们的条目被压到 0 宽、再被自己的 `overflow:hidden` 裁光，于是展开态完全看不见。

折叠态同理：容器 fit-content 为 72px，可用只有 56px，居中后两侧各溢出，每个 36px 控件只露 28px。

## 决策

在插件侧把该容器改回纵向堆叠，并让自己的条目恢复整行几何。

- 新增 `src/client/sidebar/footer-stack.module.css`，用槽锚点反选父元素：`div:has(> [data-slot='sidebar.footer.action']) { flex-direction: column }`。
- `SidebarBalance.module.css` 的展开态改回整行：`width: calc(100% + 4px); margin: 4px -2px 0`，与官方 Settings 行同一套几何。
- 去掉临时方案里的 `order: -1` 与固定 `width: 96px`。

依据：同一侧栏另一个 list 槽容器 `.panelList` 就是 `flex-direction: column`；两个真实占用者都用垂直外边距；宿主注释写的是「additive actions stack above Settings」。缺 `flex-direction` 属宿主遗漏。

## 替代方案

- **固定宽度 + `order: -1` 抢行首**：能让自己可见，但折叠态算术上无解（要两项都不越界需 `b ≤ 20`，低于 WCAG 2.2 的 24×24 最小目标），且把第一个位置从官方 cordis 面板手里拿走。曾短暂上线，被本决策取代。
- **不改，只上报宿主遗漏**：接受宽态不可见，等于插件没有展示位。
- **换落点（如 `shell.overlay` 自行定位）**：脱离原生布局契约，还要自己处理侧栏折叠，代价大于收益。
- **改宿主源码加一行 `flex-direction: column`**：任务书明令不改 dsh 核心；且宿主升级会覆盖。

## 影响

- 这是插件对宿主布局的覆盖，依赖 `:has()`（Chromium 已支持）与 `data-slot` 锚点属性稳定。
- 副作用是正向的：官方 cordis 面板与用量面板的条目也一并恢复完整可见。
- 宿主若将来自行补上 `flex-direction`，本规则与之一致，不会打架。
- 尚未在浏览器实测，只到「运行中 CSS 字节 + 算式 + 本地构建产物审计」。
