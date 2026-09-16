# ds-balance — 维护索引

## 状态

- **未发布、私有包**（`private: true`）。开发期刻意不声明 `dsh.bundle`，见下面的活跃坑。
- 运行形态：装进某个 dsh profile 的 `node_modules`（符号链接），由 `cordis.patch.yml` 的 insert 行装载。

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
- 挂载（不重启宿主）：先 `dsh plugin --profile <profile> add <仓库路径>`，再确认 profile 的 `dsh.profile.bundles` 里没有本插件，然后把 insert 行写进 profile 的 `cordis.patch.yml`
- **重启前必须再确认一次**：`dsh.profile.bundles` 与 patch 同时存在会导致双挂载（宿主 reconcile 会把 bundles 那条回填）
- 回滚：给 patch 里那行加 `disabled: true`，热生效
- **宿主半边改了代码必须重启宿主**：patch 行的 toggle 只会重新 `apply` **启动时已加载的那个模块**（已实测：改完重建再 toggle，跑的还是旧代码）。toggle 只能用来「拆掉再装上同一个模块」。

## 事实来源（只查不抄）

本文件与各文档一律不抄会漂的值，要精确值时现查：

- 测试数量、类型检查结果 → `npm test` / `npm run typecheck`，或 [CI](.github/workflows/ci.yml) 的运行记录。
- 产物体积与文件清单 → `Get-ChildItem lib`。
- 版本号与依赖范围 → [package.json](package.json)。
- 宿主兼容范围与客户端注入声明 → `package.json` 的 `engines.dsh` 与 `dsh.client`。
- dsh 运行时行为（slot 名、服务门禁、存储接缝） → 宿主源码 `packages/` 下的对应包，行号以当前检出为准。
- 发布态该有什么 → [scripts/check-release.mjs](scripts/check-release.mjs) 的断言集合。

## 验证快照

- 结论一律来自本机实跑或 [CI](.github/workflows/ci.yml)。
- 阶段 0：勘察报告完成，结论均带源文件行号。
- 阶段 1：16 项集成决策已拍板 → [决策记录](.agents/notes/2026-09-17-integration-decisions.md)
- 构建产物：`npm run build` 三步全绿。体积不抄进文档 —— 用 `Get-ChildItem lib` 现查。
- 阶段 6：已用 patch 层热挂载进本机 web profile（符号链接形态），宿主未重启。
- 维护者已实机确认：条目可见、设置卡片渲染、圆环与标签正常。
- 修复过并复测的实机缺陷：footer 三条目互挤、展开态条目不可见、折叠态与邻居贴住、点邻居却弹我们的浮层。
- 维护者已实机验收全部界面：圆环与标签、点击浮层、折叠分组、与邻居插件共存。
- 未验证：窄视口（<722px）下浮层的钳制表现。
- **后端完成**：§14 第 1~10 步落地 —— 进度与偏离项见 [docs/PLAN.md](docs/PLAN.md)。
- 端点实测（隔离实例，真实 dsh 宿主）：六个端点全部可用；`severity` 四档、`NO_KEY` / `UPSTREAM_401` / `UPSTREAM_5XX` 三条错误路径、`422` 校验、冷却、配置掩码逐条核过。
- 持久化实测：重启宿主后快照按 `accountTag` 读回，`.salt` 复用；上游不可达时降级成 `stale` 而不是丢数据。
- 界面实测（隔离实例 + 无头浏览器）：左下角圆环显示真实金额，浮层三段金额与相对时间正确，Escape 关闭，控制台零报错。
- 测试与类型检查：跑 `npm test`（自带 build）与 `npm run typecheck`，或看 [CI](.github/workflows/ci.yml)。**数字不在本文档里抄。**
- **主实例仍是旧宿主模块**：本机运行的宿主进程启动于后端代码之前，toggle patch 行不会换代码，需要重启宿主才生效。

## 待办

- [x] 首次 commit（工程骨架 / 文档网络 / UI 实现三个）
- [x] `test/` 目录与双件
- [x] 后端 §14 第 7~10 步 → 见 [docs/PLAN.md](docs/PLAN.md)
- [x] `LICENSE` 文件（MIT）并加进 `package.json` 的 `files`
- [x] §14 第 11 步收尾：文档同步、[报告](docs/final-report.md)、提交
- [ ] **重启宿主一次**让后端半边生效（Agent 不能重启承载本会话的进程）
- [ ] 脚本入口缺 `lint`；待定是否引入
- [ ] 设置卡片的折叠状态不持久化（v1 有意不做，官方仅一处先例）
- [ ] 阶段 7 交付清单：截图 / 录屏需维护者配合
- [ ] 发布前：加回 `dsh.bundle`、去掉 `private` —— [check-release.mjs](scripts/check-release.mjs) 会卡

## 活跃坑

- **`sidebar.footer.action` 的宿主容器是 row flex（宿主遗漏）**：官方 cordis 面板与 `dsh-usage-statistics-panel` 都把根节点写成满宽且不收缩，横排下条目会被挤到 0 宽。我们已用 `:has()` 反选父元素把它改回纵向堆叠 → [决策](.agents/notes/2026-09-17-footer-stack-override.md)。依赖 `:has()` 与该锚点属性稳定。
- **`dsh plugin` 会把声明了 `dsh.bundle` 的已装包回填进 profile 的 `dsh.profile.bundles`**，与 patch 层的 insert 行形成**双挂载**（bundles 只在启动时读，所以下次重启才炸）。已选方案 A：开发期从 `package.json` 去掉 `dsh.bundle`，`node scripts/check-release.mjs` 在发布前卡住。
- **探针脚本绝不要打印凭据文件的整行**：`Select-String` 默认回显整行，会把 `key: value` 里的密钥一起打出来，直接进对话记录。只取捕获组（`$_.Matches[0].Groups[1].Value`）或只做布尔判断。
- **不要在侧栏底部写 `aria-haspopup="dialog"`**：已装的 `dsh-usage-statistics-panel` 用它从自己按钮往上逐层 `querySelector` 来找设置触发按钮，假设整条底部只有一个这样的按钮；我们的按钮会被它先命中并被 `click()`，表现为「点邻居却弹出我们的浮层」。改用 `aria-expanded`。同一插件的另一条隐式契约：它的 MutationObserver 会扫 `[role="dialog"] nav button`，所以浮层里不要放 `<nav>` 包着的按钮。
- **向上展开的浮层在「打开时」会盖住上方邻居那一格**：footer 条目纵向堆叠，`side: 'top'` 的浮层底边正落在邻居底边。这是既定取舍（官方 cordis 面板同构）—— 关闭时点邻居落到邻居身上才是关键，那由「不写 `aria-haspopup`」保证。曾试图用右侧哨兵让两者不相交，实机上看位置与触发元素脱节、不优雅，已回退。
- **esbuild 的 CSS Modules 必须显式开 `loader: { '.css': 'local-css' }`**，否则 `import css from './x.module.css'` 拿到 `{}`、类名全是 `undefined`。
- **esbuild 把 CSS 抽成独立文件**，而 DSH 只服务 `lib/client.js`：样式必须在构建后内联回 factory，否则卡片渲染出来但一条样式都不生效。
- **`src/client.ts(x)` 会与浏览器信封的输出路径 `lib/client.js` 抢文件**：历史上导致宿主启动 SyntaxError。构建脚本开头有守卫。
- 宿主半边无热更；浏览器半边由 `dsh-client-hmr` 轮询 `lib/client.js` 自动替换。
- **cordis 不许读没 `inject` 过的服务**：直接访问会抛 `cannot get property "..." without inject`。可选服务（`connection` / `storageDomain`）必须由 `ctx.inject` 把门并留降级路径；把它们塞进顶层 `inject` 会让缺服务的装配整个插件不装载。**降级路径会把这条配置错误伪装成运行时故障**，所以启动日志要当验收项看。
- 符号链接安装下 `npm run build` 直接写线上，未验证的构建会立刻影响正在使用的界面。
- `inject` 门禁按服务名逐字判，点号键不展开成父级。
- dist-tag 的 `latest` 指向很旧的版本，装依赖必须点名版本线；`@deepseek-ai/schemastery` 不在 `0.1.6-alpha.1` 线上。
- `dsh.client.inject` 只列真实客户端图行；`ui-slots` 与 `ui-primitives` 是 staticLinked 平台模块，列进去会被静默跳过。

## 文档网络与自更新

- **一条事实只有一个 home**：根 [README.md](README.md) 讲门面，本文件讲规则与仪表盘，子目录 `README.md` 讲「有什么 / 改哪」，子目录 `AGENTS.md` 讲「在这里怎么干」，[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 讲不变的设计，[.agents/notes/](.agents/notes/) 讲为什么。别处一律链接。
- **能自证的不抄**：测试数字、产物体积、版本号一律指向 [CI](.github/workflows/ci.yml)、`package.json` 或现查命令；抄一次就要手动跟一次。
- **能落成校验的不写散文**：红线 → [test/redlines.test.ts](test/redlines.test.ts)；发布态不变量 → [scripts/check-release.mjs](scripts/check-release.mjs)；文档链接与换行 → `check-links.py` / `check-line-endings.py`。
- **改一处要查得到同步点**：每个子目录 `README.md` 的「变更影响路由」是同步清单入口；新增或改名文件后必须回填。
- **坑按作用域分流**：只在某个子目录才会踩的坑写进该目录的 `AGENTS.md`（进入即自动注入），本文件只留跨模块、致命的那几条。

## 文档地图

- 架构设计 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 原生集成勘察 → [docs/recon-native-integration.md](docs/recon-native-integration.md)
- 连接与官方模型机制的融合判定 → [docs/model-integration-assessment.md](docs/model-integration-assessment.md)
- 后端架构（修正版，已复审）→ [docs/backend-architecture.md](docs/backend-architecture.md)
- 阶段 0 验证报告（探针实测）→ [docs/phase0-verification.md](docs/phase0-verification.md)
- 后端架构文档对照审查 → [docs/backend-architecture-review.md](docs/backend-architecture-review.md)
- **UI 侧契约与移交（可原样转发给后端）** → [docs/ui-handoff.md](docs/ui-handoff.md)
- 决策记录 → [.agents/notes/](.agents/notes/)
- 源码手册 → [src/README.md](src/README.md)
- 浏览器半边 → [src/client/README.md](src/client/README.md)
- **进行中计划（跨上下文交接）** → [docs/PLAN.md](docs/PLAN.md)
- 领域模型手册 → [src/domain/README.md](src/domain/README.md)
- 测试手册 → [test/README.md](test/README.md)
- 构建脚本 → [scripts/README.md](scripts/README.md)
- 事故复盘 → [docs/postmortem/](docs/postmortem/)
- **收尾报告（完成标准逐条证据 / 偏离 / 待确认）** → [docs/final-report.md](docs/final-report.md)