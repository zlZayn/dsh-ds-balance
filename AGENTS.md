# ds-balance — 维护索引

## 全局规则

- 设计决策与防错清单 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 原生集成勘察结论（阶段 0）→ [docs/recon-native-integration.md](docs/recon-native-integration.md)
- 决策理由与替代方案 → [.agents/notes/](.agents/notes/)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 颜色只由后端 `severity` 决定；前端不做金额阈值判断
- 样式只用 CSS Modules + `--dsw-alias-*`；禁 Tailwind、禁组件库、禁字面色值

## 常用命令

- `npm run build`：宿主 tsc + 客户端 tsc + esbuild 打包，三步缺一不可
- `npm run typecheck`、`npm test`
- 挂载（不重启宿主）：`dsh plugin --profile web add <仓库路径>` → 从 profile 的 `dsh.profile.bundles` 移除 → 把 insert 行写进 profile 的 `cordis.patch.yml`
- 回滚：给 patch 里那行加 `disabled: true`，热生效

## 验证快照

- 无 CI。结论一律来自本机实跑。
- 阶段 0：勘察报告完成，结论均带源文件行号。
- 阶段 1：16 项集成决策已拍板 → [决策记录](.agents/notes/2026-09-17-integration-decisions.md)
- 阶段 2~5：`npm run build` 三步全绿；`lib/client.js` 约 80 KB（含内联样式约 13.6 KB），`lib/index.js` 约 2 KB。
- 阶段 6：已用 patch 层热挂载进本机 web profile（符号链接形态），宿主未重启。
- 维护者已实机确认：条目可见、设置卡片渲染、圆环与标签正常。
- 修复过并复测的实机缺陷：footer 三条目互挤、展开态条目不可见、折叠态与邻居贴住、点邻居却弹我们的浮层。
- 尚未验证：折叠分组与浮层改版后的最终形态。

## 待办

- [ ] 首次 commit（此前全部改动都还没入库）
- [ ] `test/` 目录与双件（目前零测试）
- [ ] 加 `LICENSE` 文件（`package.json` 已声明 MIT，`files` 里暂未列）
- [ ] 脚本入口缺 `lint`；待定是否引入
- [ ] 设置卡片的折叠状态不持久化（v1 有意不做，官方仅一处先例）
- [ ] 阶段 7 交付清单：截图 / 录屏需维护者配合（Agent 进不去浏览器会话）

## 活跃坑

- **`sidebar.footer.action` 的宿主容器是 row flex（宿主遗漏）**：官方 cordis 面板与 `dsh-usage-statistics-panel` 都把根节点写成满宽且不收缩，横排下条目会被挤到 0 宽。我们已用 `:has()` 反选父元素把它改回纵向堆叠 → [决策](.agents/notes/2026-09-17-footer-stack-override.md)。依赖 `:has()` 与该锚点属性稳定。
- **不要在侧栏底部写 `aria-haspopup="dialog"`**：已装的 `dsh-usage-statistics-panel` 用它从自己按钮往上逐层 `querySelector` 来找设置触发按钮，假设整条底部只有一个这样的按钮；我们的按钮会被它先命中并被 `click()`，表现为「点邻居却弹出我们的浮层」。改用 `aria-expanded`。同一插件的另一条隐式契约：它的 MutationObserver 会扫 `[role="dialog"] nav button`，所以浮层里不要放 `<nav>` 包着的按钮。
- **向上展开的浮层在「打开时」会盖住上方邻居那一格**：footer 条目纵向堆叠，`side: 'top'` 的浮层底边正落在邻居底边。这是既定取舍（官方 cordis 面板同构）—— 关闭时点邻居落到邻居身上才是关键，那由「不写 `aria-haspopup`」保证。曾试图用右侧哨兵让两者不相交，实机上看位置与触发元素脱节、不优雅，已回退。
- **esbuild 的 CSS Modules 必须显式开 `loader: { '.css': 'local-css' }`**，否则 `import css from './x.module.css'` 拿到 `{}`、类名全是 `undefined`。
- **esbuild 把 CSS 抽成独立文件**，而 DSH 只服务 `lib/client.js`：样式必须在构建后内联回 factory，否则卡片渲染出来但一条样式都不生效。
- **`src/client.ts(x)` 会与浏览器信封的输出路径 `lib/client.js` 抢文件**：历史上导致宿主启动 SyntaxError。构建脚本开头有守卫。
- 宿主半边无默认热更；浏览器半边由 `dsh-client-hmr` 轮询 `lib/client.js` 自动替换。
- 符号链接安装下 `npm run build` 直接写线上，未验证的构建会立刻影响正在使用的界面。
- `inject` 门禁按服务名逐字判，点号键不展开成父级。
- dist-tag 的 `latest` 指向很旧的版本，装依赖必须点名版本线；`@deepseek-ai/schemastery` 不在 `0.1.6-alpha.1` 线上。
- `dsh.client.inject` 只列真实客户端图行；`ui-slots` 与 `ui-primitives` 是 staticLinked 平台模块，列进去会被静默跳过。

## 文档地图

- 架构设计 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 原生集成勘察 → [docs/recon-native-integration.md](docs/recon-native-integration.md)
- **UI 侧契约与移交（可原样转发给后端）** → [docs/ui-handoff.md](docs/ui-handoff.md)
- 决策记录 → [.agents/notes/](.agents/notes/)
- 源码手册 → [src/README.md](src/README.md)
- 浏览器半边 → [src/client/README.md](src/client/README.md)
- 构建脚本 → [scripts/README.md](scripts/README.md)
