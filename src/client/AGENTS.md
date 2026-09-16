# src/client/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

src/client/ 特有约束：

- 组件拿不到 `ctx`；数据只能走 props 或注册项的 `inject` 工厂。
- 金额一律按字符串处理，禁止 `parseFloat` 后比较或累加。
- 颜色只由 `severity` 决定；这里不许出现任何金额阈值判断。
- 主题直接读 `--dsw-*` CSS 变量，禁止写 `[data-ds-dark-theme]` 或 `prefers-color-scheme` 选择器。
- 不许 import `ui-settings-plugins` 等官方包的内部构件；只能照抄模式。
- 相对导入保留 `.ts` / `.tsx` 后缀。
- 左下角条目在 `sidebar.footer.action` 里与别的插件共存：根节点不许声明整行宽度（见根 [AGENTS.md](../../AGENTS.md) 活跃坑）。
