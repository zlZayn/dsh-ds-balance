# client/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

src/client/ 特有约束：

- 组件拿不到 `ctx`；数据只能走 props 或注册项的 `inject` 工厂。
- 金额一律按字符串处理，禁止 `parseFloat` 后比较或累加。
- 颜色只由 `severity` 决定。唯一允许读阈值的地方是 [model.ts](model.ts) 的 `ringRatioOf`（只定弧长、只读 `warn`，金额比较走整数不走浮点）；其余任何地方不许拿阈值做判断或配色。
- 主题直接读 `--dsw-*` CSS 变量，禁止写 `[data-ds-dark-theme]` 或 `prefers-color-scheme` 选择器。
- 不许 import `ui-settings-plugins` 等官方包的内部构件；只能照抄模式。
- **菜单材质成对写**：凡用 `--dsw-specific-menu` 画背景的表面，必须在**同一条规则**里带
  `backdrop-filter: var(--dsw-menu-backdrop-filter)`（官方把菜单材质拆成了这两条 token；官方那条门禁只扫官方仓，
  所以本仓自己在 [test/redlines.test.ts](../../test/redlines.test.ts) 里有一条同形的）。
  **且不许把 `backdrop-filter` 写在带 fixed 浮层的容器上**：它会成为那些后代的包含块，把按视口算好的坐标
  变成相对容器的偏移 —— 余额浮层里有两个非 portal 的 Tooltip 气泡，踩中就是气泡跑出屏幕。
  配方抄同槽邻居的官方 cordis 面板：容器 `isolation: isolate`，填充与滤镜画在 `::before`。
- **槽 key 与 `configForms.get()` 的实参是两个 id**：前者取**包名**，后者取**本插件那一行的 Loader 条目 id**。
  它们今天同串，却不是一个概念 —— 传错的表现是「卡片在、表单永远只读」，不报错。断言在 `test/redlines.test.ts`。
- 相对导入保留 `.ts` / `.tsx` 后缀。
- 左下角条目在 `sidebar.footer.action` 里与别的插件共存：根节点不许声明整行宽度（见根 [AGENTS.md](../../AGENTS.md) 活跃坑）。
