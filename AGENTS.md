# ds-balance — 维护索引

## 状态

- **已发布到哪一版一律现查，不抄进本文档**（抄一次就得多跟一次）：
  `npm view dsh-ds-balance version dist-tags`、`git tag --sort=-creatordate`、
  [GitHub Releases](https://github.com/zlZayn/dsh-ds-balance/releases)。
  发布走 [release.yml](.github/workflows/release.yml)（Trusted Publishing，带 provenance）；
  每版的产物一致性（本地 `npm pack` 的 sha1 对 npm 上的 `dist.shasum`）记在**那次 bump 提交**里。
  **本文档此前抄了「已发布 2.1.1」与逐版流水，落后了两版** —— 这就是不抄的理由。
- `npm run check:release` 当前 0 失败。
- 装法只有一条：`dsh plugin --profile <profile> add dsh-ds-balance`（或源码路径）—— 包内声明了 bundle 层，安装器自己会写进 `dsh.profile.bundles`。**不要再手写 patch 行**，见下面的活跃坑。
- 运行形态：装进某个 dsh profile 的 `node_modules`，由该 profile 的 `dsh.profile.bundles` 装载（bundle 层来自包内的 `cordis.patch.yml`）。
  **跟的是哪条宿主线**：**RC 线**，dist-tag 是 `next`（npm 上**没有 `rc` 这个 tag**）。
  声明下限、`TRACKED_LINE`、README 的安装命令**三处同名**，由 [test/redlines.test.ts](test/redlines.test.ts) 守住。
  换线的事实、替代方案与代价见[决策记录](.agents/notes/2026-10-01-track-rc-line.md)；版本号一律现查，不抄。
- **面板深链的落点是两档，措辞跟着分档**：宿主在 RC 线上于 ui-plugin-manager 里 provide 了
  `pluginNavigation.openBundle(包名)`（alpha 线没有这条服务）。特征检测到该服务就
  `openBundle(BUNDLE_CONFIG_KEY)`，服务缺席或调用抛错退回 Plugins 列表 ——
  见 [src/client/index.tsx](src/client/index.tsx) 的两个 `ctx.inject` 与 `createPluginsNavigation`。
  **「服务在不在」是运行期事实，不是仓库事实**：装上更早的一条 rc 时那条服务不在，
  点下去只到列表页。所以**措辞按落点分档**（能直达才说「打开插件配置页」）——
  勘误、判据与替代方案见[记录](.agents/notes/2026-09-25-deep-link-needs-host-service.md)。
  **这是有意的取舍，不是遗漏** —— 记在这里免得后人当成漏做的活。

## 全局规则

- 设计决策与防错清单 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 原生集成勘察结论（阶段 0，依据类）→ [.agents/notes/recon-native-integration.md](.agents/notes/recon-native-integration.md)
- 决策与依据记录 → [.agents/notes/](.agents/notes/)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **插件展示面（插件页上的标题、描述与图标）住在包根的 [locale/](locale/AGENTS.md) 与 [icon.svg](icon.svg)**：
  宿主**直读**它们，我们的代码一个字节都不读 —— 所以坏了**没有信号**，只会静默回落成包名、
  `package.json` 的 `description` 或宿主的默认图形。发布面（含 icon 那几条判据）在 [check:release](scripts/check-release.mjs)，
  两份语言文件的键集、门面引用与「图标必须与圆环同形」在 [test/redlines.test.ts](test/redlines.test.ts)。
- 颜色只由后端 `severity` 决定；前端读阈值的唯一去处是圆环弧长，且只读 `warn`、只当刻度
- 样式只用 CSS Modules + `--dsw-alias-*`；禁 Tailwind、禁组件库、禁字面色值
- **所有 `@deepseek-ai/dsh-*` 声明与 `engines.dsh` 逐字相同**（同形状、同区间、逐字符）。两份声明自相矛盾时，使用者按我们给的区间装不出可用的宿主。抬过三批：2026-09-20（peer 8 条 + 仅 dev 的 2 条）、本次接缝迁移（12 条受管包 + `engines.dsh` 一起改）、2026-10-10（加回旧 RC 族改成两族并集，23 条 + `engines.dsh` 一起改），分别见[决策记录](.agents/notes/2026-09-20-declaration-floor-alignment.md)、[本轮记录](.agents/notes/2026-09-22-settings-seam-migration.md)与[两族那条](.agents/notes/2026-10-10-two-families-declared.md)。红线在 [test/redlines.test.ts](test/redlines.test.ts)。
- **声明面是若干个族（`||`）的并集**：要同时承诺两族（RC 族与仍可用的旧 RC 族），npm 的预发布语义下单区间罩不住（预发布候选只与「同 `major.minor.patch` 且也带预发布段」的比较子匹配）。换版语义随之是「**保留旧族、只替换目标族**」；巡检矩阵 = **声明面承诺哪些族就测哪些族**（承诺一族 = 声明面加一族 + [compat.yml](.github/workflows/compat.yml) 矩阵加一行；宿主发新族**不**自动进矩阵，是否加承诺人工决定）。
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

- 本地钩子：`pre-commit install`（每个 clone 一次；本体 `uv tool install pre-commit`）——提交前自动 `prettier --write` + `eslint --fix`（`npx --no-install`，不联网）；CI 只读新增 format:check；全量跑 `pre-commit run --all-files`；临时跳过 `git commit --no-verify`；定义见 [.pre-commit-config.yaml](.pre-commit-config.yaml)

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
- **产物的发布后复核**：每次发版把「本地 `npm pack` 的 sha1 与 npm 上 `dist.shasum` 是否逐字节相同」
  记进**那一版的 GitHub Release 正文**（`gh release edit v<版本> --notes-file …`）。
  记在那里而不是 bump 提交里：**这个检查只能发生在发布之后**，而 bump 提交在发布之前就已经推上去了 ——
  写「记在 bump 提交」是一条做不到的规则。历史各版不在这里堆（见顶部「已发布到哪一版一律现查」）。

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
- [x] **面板深链已接上**（2026-09-25）：宿主 `next` 线的 ui-plugin-manager provide 了 `pluginNavigation.openBundle(包名)` → 浮层右上角图标直达本插件的配置格；服务缺席（更早的宿主线）或调用抛错时**退回 Plugins 列表**，两条都不通只 `console.warn` 一笔。**措辞跟着落点分档**；判据、现象与本机宿主的那次勘误见[本轮记录](.agents/notes/2026-09-25-deep-link-needs-host-service.md)
- [x] **深链已在本机生效**（2026-09-25）：维护者把宿主换到 provide 了那条服务的线上并重启，图标直达本插件的配置格。判据仍是**服务在不在**（三条 dist-tag 现查 `npm view @deepseek-ai/dsh dist-tags`），不是版本号
- [x] **npm `latest` 已回填**（2026-09-25）：`dist-tags` 已翻到 `2.1.0`；产物一致性复验通过 —— 本地 `npm pack`（`7ded7f6` 那棵树）的 sha1 与 npm 上 2.1.0 的 `dist.shasum` **逐字节相同**
- [ ] **浮层图标行为变了 → 涉及它的门面截图需重拍**（`sidebar-popover*.png`）：判据见 [assets/AGENTS.md](assets/AGENTS.md)
- [ ] 本机 profile 升到 `2.1.3` 后实机验收本轮计时修复：浮层冷却从冷却值本身开始倒数（不再从 N+1）、按钮在截止时刻就能按、点刷新一定真的打一次上游
- [ ] `node scripts/acceptance.mjs` 的**上游那一段**（要真实 `DEEPSEEK_API_KEY`）：本轮发布前只跑了离线四项，退出码 2
- [ ] **实机验收（两轮合并，都还没刷新看过）**：待维护者刷新界面确认 ——
  ① 处境重构那轮：左下角条目在、括号紧贴标题右侧、叉变小了、没接入时是 ＋ 而不是叉、切会话/切模型跟着换；
  ② **消歧义这轮**：`checking`（首帧）是**一段缺口在转**、不再与「账户没钱」的灰空环同形；
  **账户停用**的红环**带叉**、与「余额恰好为 0」的无叉红环分得开；
  ③ **悬停这轮**：**收起态与展开态停上去显示同一句话**（收起态从前在正常态上什么都不显示）——
  正常 / 偏低 / 告急显**金额**；其余显文案「正在获取 / 读不到余额 / 服务异常 / 尚未配置凭据 /
  账户不可用 / 数据已过期 / 暂无余额」。**注意 `stale` 与 `account-unavailable` 有数字也显文案**。
  mock 逐形态一眼过用 `?dsb=<处境键>`（**11 个处境全造得出来**，含 `checking` / `offline`；
  见 [docs/UI-HANDOFF.md](docs/UI-HANDOFF.md) §八）
- [x] **这一轮已发版（2026-10-01）**：档位按判定链是 **minor** ——
  Q0 有可观察变化；Q1 配置 / 数据 / 习惯**不失效**；Q2 新增「账号登录」来源 + 界面行为变化。
  bump 与发布是两步（**bump 提交 → push → dispatch release.yml**，workflow 只发不 bump）。
  发布后复核已按上面那条规则记进 GitHub Release 正文。
  **这一版同时抬了宿主下限**（alpha 线用户要升到 RC 线），那一条按 Q2 记在同一个 minor 上
- [x] **承诺线已换到 RC 线（2026-10-01）**：`engines.dsh` 与全部 23 条 `@deepseek-ai/dsh-*`
  一起抬到那条线的起点（下限**现查** `package.json`）、删掉那批 token 回落值、README 安装指引改成 `@next`、
  `check-declaration.mjs` 的 `TRACKED_LINE` 与 `compat.yml` 的矩阵都改成 `next`（alpha 停测）。
  → [决策记录](.agents/notes/2026-10-01-track-rc-line.md)（含换线时旧 `node_modules` 会挡住解析这条坑）。
  **同一条预发布语义的固有代价**：宿主换一个补丁位再推预发布，下限会再次罩不住，届时要再抬一次。
  **版本号一律现查，不抄进文档**
- [ ] **下一轮可能的抬下限**：宿主把补丁位往前推再发预发布时，现有下限会罩不住（同 `major.minor.patch` 才匹配），
  届时按上面那条流程再走一遍

## 活跃坑

- **宿主版本可能与 devDeps 错位**：本仓 devDeps 锁在某个宿主编译，实际运行的宿主可能更新。改代码前先跑 `dsh --version` 对比 `package.json` 的 devDeps；错位可能导致编译通过但运行时崩。升级 devDeps 要同步决定 `engines.dsh` 的兼容范围。连带一条：宿主线升级时**宿主包的传递依赖也可能被抬** —— 本仓若把它写死在旧版，包管理器会装出**两份同名包**，类型互不兼容 → 编译报「A 不能赋给 B」而两个路径都是 `node_modules`。判据：报错里出现两个不同层级的 `node_modules`；处置：把本仓那份升到与宿主同源的范围。核验兼容性用**仓库外**的临时目录装目标线宿主包。在仓内建目录的代价是双份的：包管理器把它当 workspace 成员，`add` 会顺带重排本仓 `node_modules`，并往锁文件写一条 **importer** 记录 —— 目录删了记录还在，而**本机安装不带 frozen 校验会静默自愈**，只有 CI 的 frozen 模式才判红（姊妹仓 2026-10-02 三平台齐红，失败在第一步 install）。判据：在锁文件里搜那个目录名；处置：重新解析，别手工编辑锁文件。
- **`sidebar.footer.action` 的宿主容器是 row flex（宿主遗漏）**：官方 cordis 面板（`packages/extensions/ui-cordis/src/client/`）把根节点写成满宽且不收缩，横排下条目会被挤到 0 宽。我们已用 `:has()` 反选父元素把它改回纵向堆叠 → [决策](.agents/notes/2026-09-17-footer-stack-override.md)。依赖 `:has()` 与该锚点属性稳定。
- **`dsh plugin` 会把声明了 `dsh.bundle` 的已装包写进 profile 的 `dsh.profile.bundles`**，而 bundle 层与 patch 层的 insert 行**只在启动时读** —— 两条同时存在就是**双挂载**。开发期靠「不声明 `dsh.bundle`」躲开它，发布态不能这么干（包里必须有 bundle 层）。所以装法只能选一种：**`dsh plugin add` 或手写 patch 行，不要都做**。改本机 profile 前先看 `dsh.profile.bundles`。
- **`link:` 到 profile 外的插件，仓库必须自己装好 peer deps**（`npm install` 会做到）——
  它按**仓库路径**解析 `@deepseek-ai/*`，走不到 profile 的兜底目录；
  少了报 `ERR_MODULE_NOT_FOUND`、插件显示「未运行」。
- **本地起验证实例前先确认端口空闲**：端口被占时 `dsh` 会以 `EADDRINUSE` 启动失败（webserver 是必需插件，`exit code 1`），**但本插件仍然装载、照常抓数** —— 日志里看着像跑起来了，其实没有可访问的 URL。重启前先查 `Get-NetTCPConnection -State Listen -LocalPort <port>`，或直接换端口。
- **兜底会多打一次上游，别写成循环**：取不到数字时按 `FALLBACK_ORDER` 退到另一条官方路，一轮最多「首选一次 + 兜底一次」。以后往里加来源时如果把兜底写成「再试一遍」，两条路会互相触发、上游请求量翻倍（有单测守着：两条都失败时各只打一次）。
- **探针脚本绝不要打印凭据文件的整行**：`Select-String` 默认回显整行，会把 `key: value` 里的密钥一起打出来，直接进对话记录。只取捕获组（`$_.Matches[0].Groups[1].Value`）或只做布尔判断。  **同理别整读 `~/.npmrc`**：它通常带着一枚 `//registry.npmjs.org/:_authToken=`（本轮踩过 —— token 就这么进了对话记录，只能靠轮换补救）。
  要确认 registry 就问 `npm config get registry`，不要 `Get-Content` 整个文件。
- dist-tag 的 `latest` 指向很旧的版本，装依赖必须点名版本线；`@deepseek-ai/schemastery` 与 `@deepseek-ai/cordis` / `@deepseek-ai/cordis-plugin-loader` **不在宿主那条线上**（各有自己的版本号），所以 `compat-swap` 的替换面不覆盖它们，改它们要手工看。实际版本现查：`node scripts/compat-swap.mjs check`。
- **换版脚本按「族」工作（2026-10-10）**：声明面是 `||` 并集，`compat-swap` 把区间拆成族、
  按「元组相同」定位要换的那一族、**其余族原样保留**，运算符与上界原样保留；**单族**区间跨元组换线
  仍合法（单族 = 「就承诺这一条线」），**多族**缺目标族时报错停下（不静默新增承诺）。
  认不出的形状（`*`、`1.x`、`workspace:^`、族内 `||`）仍直接红。自检：`node scripts/compat-swap.mjs selftest`（`npm test` 里也有一条，22 条）。
  - **线的参数既收 dist-tag 也收**版本前缀**（如某条旧 RC 族）**：实测**没有任何 dist-tag 指向它**，
    所以巡检那条记录线靠前缀定位族（取该前缀下最高的已发布版本）。
  - **`--only <前缀>`：测某一族时把声明面临时收窄成只有那一族**。为什么必需 —— 并集区间对 npm 的含义是
    「这几族都合法」，它给每个包选的是**匹配集里最高**的那族（实测：保留两族换到低族时装到的仍是最高族，
    `verify` 全红）。收窄后的清单是**一次性测量、不提交**（提交的那份始终是并集声明面）。
  - **`--drop <前缀>`**：显式删掉一族（换线到新族、放弃旧族时用）。
  - **`swap` 一并改写 `engines.dsh`，`verify` 也先验它**：宿主本体是声明面的另一半，却**既不带 `dsh-` 前缀
    （`@deepseek-ai/dsh` 没有尾横线）、也不在任何依赖段里**，两层都不落在受管面内。曾经只换依赖段，
    于是换线后 `engines.dsh` 与 23 处依赖必然不一致，[test/redlines.test.ts](test/redlines.test.ts) 的
    「区间与 `engines.dsh` 逐字相同」**每次换线必红**，且红的位置恰好盖住真正的不兼容点（typecheck 仍绿）。
    → [决策记录](.agents/notes/2026-10-05-swap-must-move-engines-dsh.md)
- **`npm ci` 会执行 `prepare`**：所以本仓库**不声明** `prepare`。声明了的话 CI 的 `npm ci` 会先产出 `lib/`，typecheck 就再也看不到「干净检出」这个状态 —— 那正是刚修掉的一类缺陷（`test/artifacts.test.ts` 在 CI 上 TS2307，本机因产物早就在而常绿）。见 [决策记录](.agents/notes/2026-09-17-prepare-script-decision.md)。
- **写临时探针别用 `os.tmpdir()`**：进程环境为空时它在 Windows 上返回相对路径 `undefined\temp`，会把文件写进工作区，还会让 `robocopy` 自我递归出一棵超 MAX_PATH 的目录树。用 `$env:TEMP` 或显式绝对路径，用完即删。
- **Agent 的 `write` 工具对「自己刚删掉的文件」会拒绝覆盖**（它缓存里那个文件还在）。换个路径，或用 Node 的 `fs.writeFileSync` 直接写。
- **整份文件被别的文档覆盖：三条文档红线一条都不会响**（本轮真发生过）。`docs/UI-HANDOFF.md` 被整份换成了另一个文件的内容（193 行 → 734 行），而「文档链接」「不抄实测值」两条仍然全绿 —— 文件还在、格式合法、链接可解析、没有会漂的值，**只有职责内容消失了**。
  - 判据：**首行标题**。已加红线「核心活文档的首行标题」覆盖 6 份（`AGENTS.md`、`docs/README.md`、`docs/ARCHITECTURE.md`、`docs/UI-HANDOFF.md`、`docs/BACKEND-CONTRACTS.md`、根 `README.md` 的居中 h1）。
  - 手工判据：`git diff --stat` 里**行数剧变**（不是几十行而是几百行）就是可疑信号，别只看测试绿。
  - 成因：把某个 skill / 文档的**整份内容**读进上下文后，写入时误当成目标文件的内容。**改文档时用定点 `edit`，不用整份 `write`** —— 后者会把「当前上下文里那份东西」整体落盘。
- **提交前先确认自己在哪个分支**：本轮两次把该走 PR 的改动直接提到了 `main`（第二次靠 `--force-with-lease` 回滚重来）。`git branch --show-current` 应当与「这次改动要不要 PR」的判断一致 —— 纯文档措辞可 admin bypass 直提，其余走 PR（理由：红线要在 CI 独立环境跑一遍，且 Release Drafter 只读 PR）。
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
- **引官方 token / 组件 / 符号前，先确认它在「声明下限」那一档存在**：
  下限见 `package.json` 的 `engines.dsh`，而**声明下限就是宿主在跑那条线**（换线之后两者已对齐）。
  存在就**裸引**，不写回落值 —— 下限上一定取得到，回落是死代码；下限上不存在的 token 根本不该引。
  **「下限提到某条 rc」曾经是个死区间**（npm 预发布语义下只匹配同一 `major.minor.patch` 的预发布版，
  而三条 dist-tag 没有一条指向它），所以抬下限 = **换承诺线**，得同批改 README、`TRACKED_LINE` 与 `compat.yml`。
  **版本号一律现查**（`npm view @deepseek-ai/dsh dist-tags` / `node scripts/compat-swap.mjs check`），
  不抄进活文档（下面那条红线的「文档不抄实测值」会红）。
  → [决策记录](.agents/notes/2026-10-01-track-rc-line.md)；
  口径由 [test/redlines.test.ts](test/redlines.test.ts) 的「注释声称照官方」一组守着。
- **界面形态只能从「处境」派生**：环 / 文案 / 来源标签都读 `client/situation.ts` 的形态表；
  组件里出现第二个 `state` / `severity` / `error.code` 分支就是回退。处境判定只有一处
  （`domain/situation.ts` 的 `situationOf`），新增处境要同批改三处（闭集 / 形态表 / locales）。
- **来源切换刻意不给界面提示**：正常路径下切换静默且正确，要提示的只有异常摆动。
  唯一观测出口是 `balance_source_switch_total{from,to}`（`/healthz` 的 metrics 段）。
  同篇还记着另两条刻意保留的边界（失败态轮询会穿透上游、凭据非空换非空不立刻重取）
  → [决策记录](.agents/notes/2026-10-01-boundaries-left-as-is.md)。

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
  | 配置字段与契约 | [src/config.ts](src/config.ts) · [docs/BACKEND-CONTRACTS.md](docs/BACKEND-CONTRACTS.md) | 引用 |
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
- 活文档（设计 / 契约 / 发布手册）→ [docs/README.md](docs/README.md)；事故复盘 → [docs/postmortem/](docs/postmortem/README.md)
- 决策与依据（当时为什么这么定）→ [.agents/notes/](.agents/notes/)（写法见该目录 `AGENTS.md`，不建索引）
- 源码手册 → [src/README.md](src/README.md)；浏览器半边 → [src/client/README.md](src/client/README.md)；领域模型 → [src/domain/README.md](src/domain/README.md)
- 测试手册 → [test/README.md](test/README.md)；构建脚本 → [scripts/README.md](scripts/README.md)
- 门面截图与判据 → [assets/README.md](assets/README.md) · [assets/AGENTS.md](assets/AGENTS.md)
- 插件展示面（插件页上的标题、描述与图标）与改它的规则 → [locale/AGENTS.md](locale/AGENTS.md) · [icon.svg](icon.svg)