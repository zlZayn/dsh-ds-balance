## Postmortem: 侧栏底部按钮被邻居插件的 DOM 遍历命中（2026-09-17）

- 摘要：点侧栏底部的邻居条目，弹出的却是我们的余额浮层。我们的触发按钮写了 `aria-haspopup="dialog"`，而已装的 `dsh-usage-statistics-panel` 用它从自己的按钮往上逐层 `querySelector` 找设置触发按钮，假设整条底部只有一个这样的按钮 —— 我们注册得比它晚，于是被先命中并被 `click()`。
- 时间线：UI 实机挂载后由维护者发现 → 定位到邻居的 `SidebarEntry.tsx` 选择器 → 去掉 `aria-haspopup`、改用 `aria-expanded` → 复测通过。**精确时刻未记录**。
- 根因：跨插件共享同一个 slot 容器时，**没有显式契约**约束「用 DOM 遍历找同类按钮」这种隐式耦合；后注册的一方无法从自己的代码看出会被别人的选择器命中。
- 防再犯：`test/redlines.test.ts` 断言侧栏两个组件里不出现 `aria-haspopup`；`src/client/sidebar/AGENTS.md` 写明理由与替代属性；同一条还记进根 AGENTS.md 的活跃坑。同一插件的另一条隐式契约（MutationObserver 扫 `[role="dialog"] nav button`）也一并写进了规则层。
- 关联：[规则层](../../src/client/sidebar/AGENTS.md) · [架构说明](../ARCHITECTURE.md)
- **追记（2026-09-20）**：成因是**当时**邻居插件自己的实现 —— 它不是我们的依赖（第三方已装插件，
  见工作区 `ENVIRONMENT.md` 的「第三方已装插件」）。此篇存史：侧栏的两条规则（触发按钮不带
  `aria-haspopup`、浮层不放 `<nav>`）因此而来，至今有效；官方设置触发按钮本身也带该属性
  （宿主仓 `apps/web/tests/settings-chrome.e2e.ts`），所以按属性找并非无据，"假设整条只有一个"才是问题。
