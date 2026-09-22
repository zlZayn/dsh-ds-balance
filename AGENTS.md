# ds-balance — 维护索引

## 状态

- **已发布 1.1.0**：npm `latest` = 1.1.0，tag `v1.1.0` → `c9a75c5`，[GitHub Release](https://github.com/zlZayn/dsh-ds-balance/releases/tag/v1.1.0) 已建；发布走 [release.yml](.github/workflows/release.yml)（Trusted Publishing，带 provenance）。
- **1.1.0 的产物 = 本仓库 HEAD**：npm 上的 shasum 与本地 `npm pack` 一致。
- `npm run check:release` 当前 0 失败。
- 装法只有一条：`dsh plugin --profile <profile> add dsh-ds-balance`（或源码路径）—— 包内声明了 bundle 层，安装器自己会写进 `dsh.profile.bundles`。**不要再手写 patch 行**，见下面的活跃坑。
- 运行形态：装进某个 dsh profile 的 `node_modules`，由该 profile 的 `dsh.profile.bundles` 装载（bundle 层来自包内的 `cordis.patch.yml`）。
- **本次发版决策**：8 条 UI 修缺里 **7 条完整**发出；**#5「浮层右上角 Plugins 图标」的落点只到 Plugins 面板**，到不了本插件的 bundle 详情页 —— 该条**搁置**（现状与证据见 [sidebar 手册](src/client/sidebar/README.md)）。
  为什么现在发：币种那条是**真 bug** —— 浮层「改用 X」写的是本地偏好、设置页不跟着变，组件重挂就丢，使用者正在用有问题的版本，**等不起**；其余几条一并随这个版本出去。
  发的是哪条线：**alpha 线的 `2.0.0-alpha.N`**（版本号带预发布段 → 发到同名 dist-tag，**`latest` 不动**）；实际版本号与 dist-tag 现查 npm，机制见 [release.yml](.github/workflows/release.yml) 顶部注释与 [PUBLISHING.md](docs/PUBLISHING.md)。
  触发条件：等宿主给出面板深链入口（`selectPanel` 带参数，或 ui-plugin-manager 暴露 `openBundle(name)` 一类客户端服务）后，**再发一个 patch 把图标落点改成直达**。
  **这是有意的取舍，不是遗漏** —— 记在这里免得后人当成漏做的活。

## 全局规则

- 设计决策与防错清单 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 原生集成勘察结论（阶段 0）→ [docs/recon-native-integration.md](docs/recon-native-integration.md)
- 决策理由与替代方案 → [.agents/notes/](.agents/notes/)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **插件展示面（插件页上的标题、描述与图标）住在包根的 [locale/](locale/AGENTS.md) 与 [icon.svg](icon.svg)**：
  宿主**直读**它们，我们的代码一个字节都不读 —— 所以坏了**没有信号**，只会静默回落成包名、
  `package.json` 的 `description` 或宿主的默认图形。发布面（含 icon 那几条判据）在 [check:release](scripts/check-release.mjs)，
  两份语言文件的键集、门面引用与「图标必须与圆环同形」在 [test/redlines.test.ts](test/redlines.test.ts)。
- 颜色只由后端 `severity` 决定；前端读阈值的唯一去处是圆环弧长，且只读 `warn`、只当刻度
- 样式只用 CSS Modules + `--dsw-alias-*`；禁 Tailwind、禁组件库、禁字面色值
- **所有 `@deepseek-ai/dsh-*` 声明的下限不得低于 `engines.dsh` 的下限**，且**形状也要一致**（本仓统一写 `>=<下限>`，不设上限）。两份声明自相矛盾时，使用者按我们给的区间装不出可用的宿主。抬过两批：2026-09-20（peer 8 条 + 仅 dev 的 2 条）与本次接缝迁移（12 条受管包 + `engines.dsh` 一起改），分别见[决策记录](.agents/notes/2026-09-20-declaration-floor-alignment.md)与[本轮记录](.agents/notes/2026-09-22-settings-seam-migration.md)。红线在 [test/redlines.test.ts](test/redlines.test.ts)。
- **依赖写在 peer 还是 dev，判据是「我们与它的关系」，不是它住在哪一侧** —— 两类，缺一类就会出事：
  - **只做类型面（module augmentation）、我们不消费它提供的服务** → 只写 `devDependencies`。目前是
    `@deepseek-ai/dsh-client-ui-plugin-manager`（模块增强）与 `@deepseek-ai/cordis-plugin-loader`（`loader/volatile-update` 的事件键声明）。
  - **我们消费它提供的服务（运行时真的要用）** → 必须 `peerDependencies`（外加同一版本的 `devDependencies`，红线钉着版本相等）：
    装载器得把它与我们装在同一棵树里，否则 `ctx.<服务>` 在运行期就是 undefined。
    `@deepseek-ai/dsh-client-ui-settings` 属于这一类 —— 它是 `configForms` 的**提供方**
    （宿主 `packages/client/ui-settings/src/client/config-form.ts:241` 的 `class ConfigForms extends Service`、
    `:266` 的 `super(ctx, 'configForms')`，行号以当前检出为准），而我们在属性访问 `ctx.configForms`
    （[config-slot.ts](src/client/config-slot.ts) 用它判服务到没到位、[use-config-form.ts](src/client/settings/use-config-form.ts) 真的 `get(ENTRY_ID)`）。
    **它同时也有类型面（我们 `import type`）—— 那不构成「只能写 dev」的理由，两种关系同时成立就该两边都写。**
  理由、机制出处与替代方案见[决策记录](.agents/notes/2026-09-20-plugin-manager-dependency-kind.md)。

## 常用命令

- `npm run build`：宿主 tsc + 客户端 tsc + esbuild 打包，三步缺一不可
- `npm run typecheck`、`npm test`
- `npm run test:contract`：打真实上游的契约测试，要环境里有 `DSH_CI_API_KEY`（专用），缺了回落 `DEEPSEEK_API_KEY`；不进 ci.yml
- `npm run check:release`：发布态不变量；当前 **0 失败**（`dsh.bundle.patch`、`private`、展示面的 `exports` / `files` 覆盖与 icon 那几条都已就位）
- `npm run check:declaration`：声明面 —— 只读 `package.json` 的区间 + 问 npm，判「声明的范围还罩不罩得住被跟的那条线」；**不装依赖**，几十秒出结果
- `node scripts/acceptance.mjs`（端到端验收）、`node scripts/compat-swap.mjs check`（现查三条 dist-tag 线）
- 挂载：`dsh plugin --profile <profile> add <包名或仓库路径>`，然后**重启宿主**。包内声明了 `dsh.bundle.patch`，安装器会把它写进该 profile 的 `dsh.profile.bundles` —— bundle 层只在启动时读。
- **不要再往 profile 的 `cordis.patch.yml` 手写 insert 行**：那是本插件还没声明 `dsh.bundle` 时的开发期做法，现在两者并存就是双挂载（见活跃坑）。
- 排查装载：先看 `dsh.profile.bundles` 里有没有本插件，再决定走哪条路 —— **有 bundles 就不要补 patch 行**。
- **宿主半边改了代码必须重启宿主**：bundle 与 patch 都只在启动时生效，能热换的只有浏览器半边。

## 事实来源（只查不抄）

本文件与各文档一律不抄会漂的值，要精确值时现查：

- 测试数量、类型检查结果 → `npm test` / `npm run typecheck`，或 [CI](.github/workflows/ci.yml) 的运行记录。
- 产物体积与文件清单 → `Get-ChildItem lib`。
- 版本号与依赖范围 → [package.json](package.json)。
- 宿主兼容范围与客户端注入声明 → `package.json` 的 `engines.dsh` 与 `dsh.client`。
- dsh 运行时行为（slot 名、服务门禁、存储接缝） → 宿主源码 `packages/` 下的对应包，行号以当前检出为准。
- 发布态该有什么 → [scripts/check-release.mjs](scripts/check-release.mjs) 的断言集合。

## 验证快照

- 结论一律来自本机实跑或 [CI](.github/workflows/ci.yml)；**数字不在本文档里抄**。
- 领域 / 服务 / 适配器 / HTTP / 浏览器半边：`npm test` 覆盖 —— 跑它，或看 CI。
- 产物级：`test/artifacts.test.ts` 在 `lib/` 上断言（`npm test` 自带 build）。
- 契约级：`npm run test:contract` 打真实上游，要 `DSH_CI_API_KEY`。
- **真机端到端已验**（隔离实例 + 真实 dsh 宿主）：六个端点、`severity` 四档、
  `NO_KEY` / `UPSTREAM_401` / `UPSTREAM_5XX` 三条错误路径、`422` 校验、冷却、配置掩码；
  重启后快照按 `accountTag` 读回、`.salt` 复用、上游不可达降级成 `stale`。
- **界面已由维护者实机验收**：圆环 / 浮层 / 折叠分组 / 与邻居插件共存；
  窄视口 360 / 480 / 600 / 700 / 721 五个宽度浮层都落在视口内。
- **发布前在活宿主上打过真实上游**：余额、浮层三段、凭据徽标，以及错 key 的 `UPSTREAM_401`。
- **1.1.0 已发布**：npm 上的 shasum 与本地 `npm pack` 一致（1.0.0 当时同样对过）。

轮次流水记在 git log 与 [.agents/notes/](.agents/notes/) 里，不在这里堆。

## 待办

- [x] 首次 commit（工程骨架 / 文档网络 / UI 实现三个）
- [x] `test/` 目录与双件
- [x] `LICENSE` 文件（MIT）并加进 `package.json` 的 `files`
- [x] 文档同步与提交
- [ ] 六条待产品决策的默认值 → [决策记录](.agents/notes/2026-09-17-implementation-deviations.md) 末节
- [x] 重启宿主一次让后端半边生效（维护者已做，13:15）
- [x] 本轮 UI 改动的收尾：文档同步、报告回填、提交
- [x] 卡片的折叠头已按原生形态取消：不再有要持久化的折叠状态
- [ ] 阶段 7 交付清单：截图 / 录屏需维护者配合
- [x] **六张门面图已于第三轮全部重拍**（展示元数据 + 图标落地之后）：`settings-card*.png`、
  `settings-cards-position*.png`、`sidebar-popover*.png` 各两张，第三轮实测的拍法与判据写进了
  [assets/AGENTS.md](assets/AGENTS.md)（侧栏按容器几何裁、长元素不碰 viewport）。
- [x] 发布前：加回 `dsh.bundle`、去掉 `private` → `npm run check:release` 0 失败
- [x] 六项发布面全部落地（assets / CONTRIBUTING / PUBLISHING / contract 配置 / 3 个 workflow / 3 个 script）→ [落地记录](.agents/notes/2026-09-17-release-surface-landing.md)
- [x] 两张设置卡片截图已从真实界面实拍（中英各一张）→ 重截判据见 [assets/AGENTS.md](assets/AGENTS.md)
- [x] 首次发布的手动配置：npm Trusted Publisher 已配、仓库 secret `DSH_CI_API_KEY` 已在、`v1.0.0` tag 与 Release 已建
- [x] `release` environment 已由 release.yml 首次运行自动创建；想挂人工审批再加规则 → [发布手册](docs/PUBLISHING.md)
- [ ] **等宿主给出面板深链入口**（`selectPanel` 带参数，或 ui-plugin-manager 暴露 `openBundle(name)` 之类的客户端服务）后，把浮层右上角图标的落点从 Plugins 列表补到本插件的 bundle 详情页 —— 现状、证据与触发条件见 [sidebar 手册](src/client/sidebar/README.md)，在此之前不在插件侧另造页面

## 活跃坑

- **`sidebar.footer.action` 的宿主容器是 row flex（宿主遗漏）**：官方 cordis 面板（`packages/extensions/ui-cordis/src/client/`）把根节点写成满宽且不收缩，横排下条目会被挤到 0 宽。我们已用 `:has()` 反选父元素把它改回纵向堆叠 → [决策](.agents/notes/2026-09-17-footer-stack-override.md)。依赖 `:has()` 与该锚点属性稳定。
- **`dsh plugin` 会把声明了 `dsh.bundle` 的已装包写进 profile 的 `dsh.profile.bundles`**，而 bundle 层与 patch 层的 insert 行**只在启动时读** —— 两条同时存在就是**双挂载**。开发期靠「不声明 `dsh.bundle`」躲开它，发布态不能这么干（包里必须有 bundle 层）。所以装法只能选一种：**`dsh plugin add` 或手写 patch 行，不要都做**。改本机 profile 前先看 `dsh.profile.bundles`。
- **探针脚本绝不要打印凭据文件的整行**：`Select-String` 默认回显整行，会把 `key: value` 里的密钥一起打出来，直接进对话记录。只取捕获组（`$_.Matches[0].Groups[1].Value`）或只做布尔判断。
  **同理别整读 `~/.npmrc`**：它通常带着一枚 `//registry.npmjs.org/:_authToken=`（本轮踩过 —— token 就这么进了对话记录，只能靠轮换补救）。
  要确认 registry 就问 `npm config get registry`，不要 `Get-Content` 整个文件。
- dist-tag 的 `latest` 指向很旧的版本，装依赖必须点名版本线；`@deepseek-ai/schemastery` 与 `@deepseek-ai/cordis` / `@deepseek-ai/cordis-plugin-loader` **不在宿主那条线上**（各有自己的版本号），所以 `compat-swap` 的替换面不覆盖它们，改它们要手工看。实际版本现查：`node scripts/compat-swap.mjs check`。
- **换版脚本保形，不认识的形状会报错停下**：`scripts/compat-swap.mjs` 只换版本号，运算符（`>=` / `^` / `~` …）原样保留；
  认不出的形状（`||`、空格分隔多段、`*`、`1.x`、`workspace:^`）直接红。自检：`node scripts/compat-swap.mjs selftest`（`npm test` 里也有一条）。
- **`npm ci` 会执行 `prepare`**：所以本仓库**不声明** `prepare`。声明了的话 CI 的 `npm ci` 会先产出 `lib/`，typecheck 就再也看不到「干净检出」这个状态 —— 那正是刚修掉的一类缺陷（`test/artifacts.test.ts` 在 CI 上 TS2307，本机因产物早就在而常绿）。见 [决策记录](.agents/notes/2026-09-17-prepare-script-decision.md)。
- **写临时探针别用 `os.tmpdir()`**：进程环境为空时它在 Windows 上返回相对路径 `undefined\temp`，会把文件写进工作区，还会让 `robocopy` 自我递归出一棵超 MAX_PATH 的目录树。用 `$env:TEMP` 或显式绝对路径，用完即删。
- **Agent 的 `write` 工具对「自己刚删掉的文件」会拒绝覆盖**（它缓存里那个文件还在）。换个路径，或用 Node 的 `fs.writeFileSync` 直接写。
- **`package-lock.json` 的根条目会漏 `peerDependencies`**：`npm ci` 不校验它，所以这种漂移能一路绿到底。改完 peer 之后跑一次 `npm install --package-lock-only` 让 lockfile 对齐清单。
- **跨字段约束宿主侧已经拦不住 → [settings 规则层](src/client/settings/AGENTS.md)**：登记接缝被删之后，
  「告急低于预警」只剩消费侧回落与 `POST /api/v1/config` 的写入侧先验两道。**官方 Plugins 页那条写路径拦不住**，
  前端置灰保存只是体验。相关决策见[本轮记录](.agents/notes/2026-09-22-settings-seam-migration.md)。
- **配置改动不会重新挂载宿主半边**：11 个字段全是 `.volatile()`，Loader 只把新值提交进引用并发一次
  `loader/volatile-update`。所以「改了配置要重启」是错的，「改了**代码**要重启」才是真的 ——
  而**只改浏览器半边时连重启都不需要**：profile 用 `link:` 挂绝对路径，`npm run build` 出来的
  `lib/client.js` 就是宿主读的那一份，HMR 一轮询即换（换不到就刷新页面）。
- **插件仓不在官方那条材质门禁的覆盖里**：宿主 `ui-theme/tests/elevation-styles.client.spec.ts` 只扫官方仓的
  `packages/`。所以「菜单填充必须配 `backdrop-filter`」这类约束**在插件侧没有任何自动保护** ——
  本轮反馈 1（浮层没有磨砂）就是这么漏掉的。本仓的同形红线在 [test/redlines.test.ts](test/redlines.test.ts) 的
  「菜单材质成对」一组，改样式前先看它。
- **探测不许盯槽名**：两个配置槽在宿主两条线上**都**在座（历史事实，版本号见
  [决策记录](.agents/notes/2026-09-22-config-entry-back-to-bundle-config.md)），所以「槽在不在」推不出
  「拿不拿得到 form」—— 那是**结构性**的，不是某个版本的问题。能力探测一律盯**服务**（`configForms`），
  见 [config-slot.ts](src/client/config-slot.ts) 的模块头。
- **宿主半边/浏览器半边的装载时机、cordis 服务门禁、构建链三类坑** → [src 规则层](src/AGENTS.md) 与 [scripts 规则层](scripts/AGENTS.md)（进目录即自动注入，这里不重抄）。

## 文档网络与自更新

- **一条事实只有一个 home**：根 [README.md](README.md) 讲门面，本文件讲规则与仪表盘，子目录 `README.md` 讲「有什么 / 改哪」，子目录 `AGENTS.md` 讲「在这里怎么干」，[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 讲不变的设计，[.agents/notes/](.agents/notes/) 讲为什么。别处一律链接。
- **能自证的不抄**：测试数字、产物体积、版本号一律指向 [CI](.github/workflows/ci.yml)、`package.json` 或现查命令；抄一次就要手动跟一次。
- **新增会漂的事实之前，先在下表登记去处**；别处只写指针，不重抄值。

  | 事实 | home | 别处怎么写 |
  |---|---|---|
  | 版本号、依赖范围、`engines` | [package.json](package.json) | 引用，不重抄 |
  | 测试数量、类型检查结果 | [CI](.github/workflows/ci.yml) 或现跑 | 一律不抄 |
  | 产物清单与体积 | `Get-ChildItem lib` 现查 | 一律不抄 |
  | 发布态该有什么 | [scripts/check-release.mjs](scripts/check-release.mjs) 的断言 | 引用断言集合 |
  | dist-tag 三条线的实际版本 | `node scripts/compat-swap.mjs check` 现查 | 只写语义（哪条旧、哪条是我们声明的） |
  | 端点路径与请求形状 | [src/http/routes.ts](src/http/routes.ts) | 引用 |
  | 配置字段与契约 | [src/config.ts](src/config.ts) · [docs/backend-architecture.md](docs/backend-architecture.md) | 引用 |
  | 颜色 / 阈值口径 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 引用 |
  | dsh 运行时行为 | 宿主源码 `packages/` | 带行号引用，行号以当前检出为准 |
  | 发布状态（版本 / tag） | npm 与 GitHub 现查 | 只留一行指针 |
  | 宿主兼容下限与分水岭 | [package.json](package.json) 的 `engines.dsh` | 门面「版本兼容」一节只写分水岭、升级指引与指针，不重抄下限 |
  | 插件在插件页上的标题、描述与图标 | [locale/en.json](locale/en.json) · [locale/zh.json](locale/zh.json) · [icon.svg](icon.svg)（规则见 [locale/AGENTS.md](locale/AGENTS.md)） | 门面点名时逐字一致（红线钉着）；不重抄 |
- **门面「版本兼容」一节的判据**：`package.json` 的 `engines.dsh` 或任一 `@deepseek-ai/dsh-*` 范围变了、或声明罩不住被跟的那条 dist-tag 线（`check:declaration` 变红）→ 同一次改动内更新 [README.md](README.md) 与 [README_en.md](README_en.md) 的那一节。
  「该槽由哪一版 dsh 引入」是**历史事实**，不随下限改；会漂的下限只写 [package.json](package.json) 指针，含版本的那一行必须与 `package.json` 同行（红线在 [test/redlines.test.ts](test/redlines.test.ts)）。过期判据就是这条命令本身。
- **能落成校验的不写散文**：红线 → [test/redlines.test.ts](test/redlines.test.ts)；发布态不变量 → [scripts/check-release.mjs](scripts/check-release.mjs)；**锁文件的 `resolved` 必须指向官方源 → 红线的「锁文件」组**（此前这条只写在另一仓的发布手册里，所以没人执行）；文档链接与换行 → **本仓暂无独立脚本**（`check-links.py` / `check-line-endings.py` 在本仓并不存在，此前是过期指针），改动后自做一次相对链接与锚点检查，再加 `git diff --check`；把它们做成脚本是待办。
- **改一处要查得到同步点**：每个子目录 `README.md` 的「变更影响路由」是同步清单入口；新增或改名文件后必须回填。
- **改根 [README.md](README.md) 必同改 [README_en.md](README_en.md)**：能力清单、上手步骤、指针逐条对齐，冲突以中文为准。
- **坑按作用域分流**：只在某个子目录才会踩的坑写进该目录的 `AGENTS.md`（进入即自动注入），本文件只留跨模块、致命的那几条。

## 文档地图

- 本表只列**层**；每层有什么在它自己的 README 里，不在这里重抄一份。
- 设计、契约、发布手册与事故复盘 → [docs/README.md](docs/README.md)
- 决策记录与验证配方（当时为什么这么定）→ [.agents/notes/](.agents/notes/)（写法见该目录 `AGENTS.md`，不建索引）
- 源码手册 → [src/README.md](src/README.md)；浏览器半边 → [src/client/README.md](src/client/README.md)；领域模型 → [src/domain/README.md](src/domain/README.md)
- 测试手册 → [test/README.md](test/README.md)；构建脚本 → [scripts/README.md](scripts/README.md)
- 门面截图与判据 → [assets/README.md](assets/README.md) · [assets/AGENTS.md](assets/AGENTS.md)
- 插件展示面（插件页上的标题、描述与图标）与改它的规则 → [locale/AGENTS.md](locale/AGENTS.md) · [icon.svg](icon.svg)