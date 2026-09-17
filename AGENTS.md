# ds-balance — 维护索引

## 状态

- **未发布、私有包**（`private: true`）。开发期刻意不声明 `dsh.bundle`，见下面的活跃坑。
- 运行形态：装进某个 dsh profile 的 `node_modules`（符号链接），由 `cordis.patch.yml` 的 insert 行装载。

## 全局规则

- 设计决策与防错清单 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 原生集成勘察结论（阶段 0）→ [docs/recon-native-integration.md](docs/recon-native-integration.md)
- 决策理由与替代方案 → [.agents/notes/](.agents/notes/)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 颜色只由后端 `severity` 决定；前端读阈值的唯一去处是圆环弧长，且只读 `warn`、只当刻度
- 样式只用 CSS Modules + `--dsw-alias-*`；禁 Tailwind、禁组件库、禁字面色值

## 常用命令

- `npm run build`：宿主 tsc + 客户端 tsc + esbuild 打包，三步缺一不可
- `npm run typecheck`、`npm test`
- `npm run test:contract`：打真实上游的契约测试，要环境里有 `DEEPSEEK_API_KEY`；不进 ci.yml
- `npm run check:release`：发布态不变量；开发期会卡在 `dsh.bundle` 与 `private` 两条
- `node scripts/acceptance.mjs`（端到端验收）、`node scripts/compat-swap.mjs check`（现查三条 dist-tag 线）
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
- 窄视口浮层钳制已补验：360 / 480 / 600 / 700 / 721 五个宽度全部落在视口内。
- **后端与界面完成**：实施路线的 11 步全部落地，路线表已从规格文档移出 → [归档记录](.agents/notes/2026-09-17-implementation-roadmap-archive.md)。
- 实现与文档不一致的 15 条 → [决策记录](.agents/notes/2026-09-17-implementation-deviations.md)。
- 端点实测（隔离实例，真实 dsh 宿主）：六个端点全部可用；`severity` 四档、`NO_KEY` / `UPSTREAM_401` / `UPSTREAM_5XX` 三条错误路径、`422` 校验、冷却、配置掩码逐条核过。
- 持久化实测：重启宿主后快照按 `accountTag` 读回，`.salt` 复用；上游不可达时降级成 `stale` 而不是丢数据。
- 界面实测（隔离实例 + 无头浏览器）：左下角圆环显示真实金额，浮层三段金额与相对时间正确，Escape 关闭，控制台零报错。
- 测试与类型检查：跑 `npm test`（自带 build）与 `npm run typecheck`，或看 [CI](.github/workflows/ci.yml)。**数字不在本文档里抄。**
- **主实例已重启**（13:15），跑的是最新产物；维护者已实机确认界面与功能。
- 工程面对齐（同日第二轮）：三个发版脚本、三条 workflow、契约测试层、assets 双件、PUBLISHING、
  CONTRIBUTING 中英、双语门面全部落地；判定与实测见 [落地记录](.agents/notes/2026-09-17-release-surface-landing.md)。
- 维护者第二轮反馈四项全部落地并实测：刷新按钮冷却期内置灰（`disabled` 为真、状态行「N 秒后可再次刷新」）；
  改阈值圆环当场变色且**上游请求数保持 0**；五档形状 ok 绿实弧 / warn 琥珀实弧 / critical 红实弧 / unavailable 红弧+中心叉号 / unknown 灰实弧；
  连接组的只读凭据显示「由启动环境提供（只读）」、Base URL 带官方提示、「自定义设置」折叠里有 apiKey 与 apiKeyRef。

## 待办

- [x] 首次 commit（工程骨架 / 文档网络 / UI 实现三个）
- [x] `test/` 目录与双件
- [x] `LICENSE` 文件（MIT）并加进 `package.json` 的 `files`
- [x] 文档同步与提交
- [ ] 六条待产品决策的默认值 → [决策记录](.agents/notes/2026-09-17-implementation-deviations.md) 末节
- [x] 重启宿主一次让后端半边生效（维护者已做，13:15）
- [x] 本轮 UI 改动的收尾：文档同步、报告回填、提交
- [ ] 脚本入口缺 `lint`；待定是否引入
- [ ] 设置卡片的折叠状态不持久化（v1 有意不做，官方仅一处先例）
- [ ] 阶段 7 交付清单：截图 / 录屏需维护者配合
- [ ] 发布前：加回 `dsh.bundle`、去掉 `private` —— [check-release.mjs](scripts/check-release.mjs) 会卡
- [x] 六项发布面全部落地（assets / CONTRIBUTING / PUBLISHING / contract 配置 / 3 个 workflow / 3 个 script）→ [落地记录](.agents/notes/2026-09-17-release-surface-landing.md)
- [ ] 两张设置卡片截图仍是占位图 → 按 [assets/AGENTS.md](assets/AGENTS.md) 的流程重截
- [ ] 首次发布前的手动配置：npm Trusted Publishing、仓库 secret `DEEPSEEK_API_KEY`、environment `release` → [发布手册](docs/PUBLISHING.md)

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
- **开发环的版本错位：客户端半边立刻换新，宿主半边要重启才换**。`dsh-client-hmr` 一轮询就换上新的 `lib/client.js`，而 `lib/index.js` 还是进程启动时那份 —— 于是新客户端会去读旧宿主不存在的字段。**客户端读新字段一律加防御**（`字段?.属性` + 形状守卫，缺失就退化成保守默认），否则组件直接崩、整个 slot 条目消失。改完宿主半边要主动重启，别指望 HMR。
- **cordis 不许读没 `inject` 过的服务**：直接访问会抛 `cannot get property "..." without inject`。可选服务（`connection` / `storageDomain`）必须由 `ctx.inject` 把门并留降级路径；把它们塞进顶层 `inject` 会让缺服务的装配整个插件不装载。**降级路径会把这条配置错误伪装成运行时故障**，所以启动日志要当验收项看。
- 符号链接安装下 `npm run build` 直接写线上，未验证的构建会立刻影响正在使用的界面。
- `inject` 门禁按服务名逐字判，点号键不展开成父级。
- dist-tag 的 `latest` 指向很旧的版本，装依赖必须点名版本线；`@deepseek-ai/schemastery` 不在 `0.1.6-alpha.1` 线上。
- `dsh.client.inject` 只列真实客户端图行；`ui-slots` 与 `ui-primitives` 是 staticLinked 平台模块，列进去会被静默跳过。
- **`npm ci` 会执行 `prepare`**：所以本仓库**不声明** `prepare`。声明了的话 CI 的 `npm ci` 会先产出 `lib/`，typecheck 就再也看不到「干净检出」这个状态 —— 那正是刚修掉的一类缺陷（`test/artifacts.test.ts` 在 CI 上 TS2307，本机因产物早就在而常绿）。见 [决策记录](.agents/notes/2026-09-17-prepare-script-decision.md)。
- **写临时探针别用 `os.tmpdir()`**：进程环境为空时它在 Windows 上返回相对路径 `undefined\temp`，会把文件写进工作区，还会让 `robocopy` 自我递归出一棵超 MAX_PATH 的目录树。用 `$env:TEMP` 或显式绝对路径，用完即删。
- **Agent 的 `write` 工具对「自己刚删掉的文件」会拒绝覆盖**（它缓存里那个文件还在）。换个路径，或用 Node 的 `fs.writeFileSync` 直接写。
- **`package-lock.json` 的根条目会漏 `peerDependencies`**：`npm ci` 不校验它，所以这种漂移能一路绿到底。改完 peer 之后跑一次 `npm install --package-lock-only` 让 lockfile 对齐清单。

## 文档网络与自更新

- **一条事实只有一个 home**：根 [README.md](README.md) 讲门面，本文件讲规则与仪表盘，子目录 `README.md` 讲「有什么 / 改哪」，子目录 `AGENTS.md` 讲「在这里怎么干」，[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 讲不变的设计，[.agents/notes/](.agents/notes/) 讲为什么。别处一律链接。
- **能自证的不抄**：测试数字、产物体积、版本号一律指向 [CI](.github/workflows/ci.yml)、`package.json` 或现查命令；抄一次就要手动跟一次。
- **能落成校验的不写散文**：红线 → [test/redlines.test.ts](test/redlines.test.ts)；发布态不变量 → [scripts/check-release.mjs](scripts/check-release.mjs)；文档链接与换行 → `check-links.py` / `check-line-endings.py`。
- **改一处要查得到同步点**：每个子目录 `README.md` 的「变更影响路由」是同步清单入口；新增或改名文件后必须回填。
- **改根 [README.md](README.md) 必同改 [README_en.md](README_en.md)**：能力清单、上手步骤、指针逐条对齐，冲突以中文为准。
- **坑按作用域分流**：只在某个子目录才会踩的坑写进该目录的 `AGENTS.md`（进入即自动注入），本文件只留跨模块、致命的那几条。

## 文档地图

- 架构设计 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 原生集成勘察（设计依据）→ [docs/recon-native-integration.md](docs/recon-native-integration.md)
- 连接与官方模型机制的融合判定（设计依据）→ [docs/model-integration-assessment.md](docs/model-integration-assessment.md)
- 后端架构（修正版，已复审；只含设计与契约）→ [docs/backend-architecture.md](docs/backend-architecture.md)
- 后端架构文档对照审查（设计依据）→ [docs/backend-architecture-review.md](docs/backend-architecture-review.md)
- **UI 侧契约与移交（可原样转发给后端）** → [docs/ui-handoff.md](docs/ui-handoff.md)
- 发布手册（流程与版本号判定链）→ [docs/PUBLISHING.md](docs/PUBLISHING.md)
- 门面截图与其判据 → [assets/README.md](assets/README.md) · [assets/AGENTS.md](assets/AGENTS.md)
- 决策记录 → [.agents/notes/](.agents/notes/)
- 源码手册 → [src/README.md](src/README.md)
- 浏览器半边 → [src/client/README.md](src/client/README.md)
- 领域模型手册 → [src/domain/README.md](src/domain/README.md)
- 测试手册 → [test/README.md](test/README.md)
- 构建脚本 → [scripts/README.md](scripts/README.md)
- 事故复盘 → [docs/postmortem/](docs/postmortem/)
- 验证配方（隔离实例 / stub 上游 / 探针）→ [.agents/notes/2026-09-17-verification-recipes.md](.agents/notes/2026-09-17-verification-recipes.md)