# 发布手册

面向维护者。本文件讲**流程与判据**；「发布态该有什么」由
[scripts/check-release.mjs](../scripts/check-release.mjs) 的断言集合定义。两者互补，不互相抄。

## 发版前确认

逐条跑，全绿才继续。任何一条红了就停下，不要绕过。

- `npm run check:release` —— 发布态不变量：`dsh.bundle` 加回来了吗、`private` 去掉了吗。
- `npm run typecheck` 与 `npm test`。
- `node scripts/acceptance.mjs` —— 打真实上游的端到端验收，需要环境里有 `DEEPSEEK_API_KEY`（**插件日常继承的那把**，不是契约巡检的专用 key）。
- `git diff --name-only <上个 tag>..HEAD | node scripts/release-guard.mjs` —— 产物到底变没变。
- 按下面的判定链定档，然后 `npm version <patch|minor|major> --no-git-tag-version`。
  这一步会同时改 `package.json` 与 `package-lock.json`；只手工改前者会被 CI 拦下。
  **版本号其实写在三处**：还有 [src/version.ts](../src/version.ts) 的 `PLUGIN_VERSION`（响应里逐条回传的线上版本常量）。
  `npm version` **不会碰它** —— 忘了改会被 `test/version.test.ts` 拦下；本机 `npm test` 能提前发现，别等 CI 红。

## 发版流程

唯一入口是 [release.yml](../.github/workflows/release.yml)，手动触发。

### bump 是发布**之前**的独立一步，workflow 不 bump

顺序是死的：**先 bump 并提交 → 需要截图就先拍 → 最后发布**。

为什么不能把 bump 塞进 workflow：界面上的**版本 tag 是截图的判废项**，而它显示的就是 `package.json` 里那个号。
只要发布流程自己改版本，工作树就永远停在「上一个已发布版本」—— 截图必然拍出旧号
（2026-09-22 zhihu 那一轮就是这么翻的车）。所以：

- bump 在维护者机器上跑（`npm version <tier> --no-git-tag-version`，见上一节），**提交之后**才谈截图与发布；
- `release.yml` **只发不 bump**：它读现成的版本号、按结果版本推导 dist-tag（带预发布段 → 同名 dist-tag，`latest` 不动）；
- 这条不变量**已落成红线**：`release.yml` 里不得出现 `npm version <tier>` 这类调用（带反向控制），
  见 [test/redlines.test.ts](../test/redlines.test.ts) 的「发布流程」一组。

推论：**发一个版本 = 一次 bump 提交 + 一次 workflow 运行**，两件事分开看；workflow 重跑不会改任何版本号。

它按固定顺序跑，前面任何一步红了都走不到发布：

1. 校验 `package.json` 与 `package-lock.json` 的版本号一致。
2. typecheck。
3. 测试。
4. `npm run check:release`。
5. release-guard。产物没变就中止 —— 发了等于制造一个内容相同的新版本号。
   首次发版还没有任何 tag，这一步自动跳过。
6. 探该版本在不在 npm 上。在就跳过发布，补跑一条流水线不会撞 403。
7. `npm publish --provenance`。认证走 OIDC，仓库里没有任何长期凭据。
8. 打 `v<version>` tag 并推送；tag 已存在则跳过。

`dry-run` 输入只做检查与打包，不发布也不打 tag。

### 手动发布（本机直接 `npm publish`）

`release.yml` 是常规入口，但不是唯一可行的路径。首次发布（或 OIDC 还没配好时）可以在本机直接发 ——
代价与必须补的动作写在下面。**1.0.0 就是这么发的**：当时 Trusted Publisher 刚配好，
本机发布走通之后，tag 与 GitHub Release 是补建的。

它比流水线少三件事：

- **没有 provenance 证明**。`--provenance` 要 CI 的 OIDC 身份，本机拿不到。
- **不会打 tag**。tag 由 workflow 打；手动发完要自己补，否则 `release-guard` 永远没有「上个 tag」这个基准。
- **不会自动跑前置检查**。上面 1~4 步要自己逐条跑。

手动发的顺序：

1. 跑「发版前确认」那一节的全部条目（`npm test` 会顺带 `npm run build`）。
2. 确认 `lib/` 是**刚构建过**的：`files` 里写着 `lib`，而它被 `.gitignore` 忽略 ——
   干净检出上直接 `npm publish` 会发出去一个没有产物的包，且 npm 不会报错。
3. `npm publish`。
4. `git tag v<version> && git push origin v<version>` —— 补上 workflow 本该打的那个 tag。
5. 以后再走 `release.yml` 时不必担心重复发：它的幂等探测会认出这个版本已发布并跳过。

## 发布后缺陷处理

**不发 unpublish。** 已经有人装过的版本一旦撤下，他们的 lockfile 就指向一个不存在的版本，
下一次 `npm ci` 直接失败。正确动作是四步固定：

1. `npm deprecate <name>@<version> "原因与替代版本"` —— 装过的人会在安装时看到这句话。
2. 修。
3. 按判定链定档，发新版本。
4. 在 tag 说明里写清影响范围与升级动作。

只有「发布后 72 小时内、且确认无人依赖」才考虑 unpublish；
走这条例外要在提交信息里写明依据，备查。

**deprecate 只留给真实缺陷。** 宿主侧的搬家（配置界面换了一格槽、或设置接缝换代导致旧版本在当前宿主上
不再显示配置区）不算插件缺陷，不给那些旧版本加 deprecate：喊狼来了会稀释真正的那几条警告。
代价是明确的取舍 —— 停在旧宿主（或装着旧版本）的用户在安装时**收不到任何提示**，
分水岭只由 [README.md](../README.md) 的「版本兼容」一节传达。

## 版本号判定链

按顺序问，第一个答「是」的档位就是它。
**问的是使用者的处境，不是代码 diff 的大小。**

- **Q0：使用者能观察到任何变化吗？**（行为、界面、输出、配置项、包内容）
  答「否」→ **不发版**。纯文档、纯测试、纯 CI、行为等价的重构全在这一档，搭下一次发布的车。
- **Q1：会让使用者现有的配置、数据或习惯失效吗？** 答「是」→ **major**。
- **Q2：有没有新增或改变对外可见的能力？**（新端点、新配置项、界面行为变化）答「是」→ **minor**。
- **Q3：以上都不是，只是把坏掉的东西修回它承诺的样子？** → **patch**。

Q0 是这道链上最常被跳过的一问：一个几百行的内部重构，答案仍然是「否」。

### 预发布线（`alpha`）上的定档

版本号带预发布段时（`2.0.0-alpha.N`），**Q1–Q3 判出来的仍是那个 major/minor/patch 档**，
只是它落在已经抬高的那个号上，再往预发布计数上加一位。三个后果：

- **已发布的预发布版本无法被替换**：npm 不许覆盖同一个版本号，所以「改完之后应该和 alpha.0 一样」
  这种说法不成立 —— 入口曾经不同，那条历史就在 npm 上。要发就只能是 `alpha.(N+1)`。
- **预发布计数只是通道内的序号**，不表达兼容性承诺；承诺由它前面那个 major 号承担。
- 因此**「已发布的 alpha 是什么样」要当既有事实读**（`npm view <包名> versions`），
  而不是当草稿：定档与写「版本兼容」一节时都要先查它。

### 判例库

判例取自本仓库真实历史，不是编的。

| 提交 | 内容 | 定档 | 为什么 |
|---|---|---|---|
| `9e2840c` | 后端第 1~3 步：领域层、端口、HTTP 客户端 | 不发版 | 代码量很大，但当时一个端点都还没注册，使用者观察不到 |
| `4edffe5` | 采纳工程规范：补产物级测试与 CI 细节 | 不发版 | 纯校验层，产物内容一字未变 |
| `022c186` | 后端第 7~11 步：注册 HTTP 端点、UI 接真实数据 | minor | Q2：对外可见的能力第一次出现 |
| `71389e1` | 设置卡片四组默认全收起 | minor | Q2：界面默认行为变了 |
| `06dd713` | 修回按钮到卡片下缘的留白 | patch | Q3：把样式修回它承诺的样子 |
| `eb9fbd8` | 改用 clsx、补齐 `engines.dsh`、修正失效引用 | patch | 无行为变化；`engines.dsh` 只是把已成立的约束写出来 |
| `712aafc` | 剪规格文档、补英文门面、挂起六项发布面 | 不发版 | 门面结构尚未定稿，此时没有可发的版本 |
| `0251a1c` | CI 修复：产物级测试移出类型检查项目 | 不发版 | Q0 答否：使用者观察不到，这条只影响我们自己的 CI |
| `dba1e19` | 补仓库元数据、`files` 加 `README_en.md` | 不发版 | 打包内容确实变了，但多发一个门面文件不是升级理由，搭下次车 |
| `f9917a2` | 发布态就位：加回 `dsh.bundle.patch`、去掉 `private` | 不发版 | 还没有任何已发布版本；这次改的是「准备发」的状态，不是内容 |
| `9cbcbd2` | 文档分层：docs/ 与 .agents/notes/ 各加一份索引，门面去掉实测版本号 | 不发版 | Q0 答否：只动文档、CI 注释与仓库内的截图；与 `dba1e19` 同档 |
| `5e3eb20` | 浮层时效：年龄基准跟着响应走 | patch | Q3：把「数据新鲜度」修回它承诺的样子 —— 没有新能力、不动配置与数据 |
| `d1e3b8f` | 凭据行文案照官方、只读框改常态空框 | patch | Q3：把「凭据字段长什么样」修回它承诺的样子（照官方卡片） |
| `4f9c878` | 接口地址默认留空（留空即官方端点）+ 徽章收成两态 | minor | Q2：界面默认值变了 —— 地址那格从写死官方地址变成空串 |
| `1120892` | 去掉卡片里可填的 API Key | minor | Q2：界面不再暴露覆盖入口；老配置与 schema 都没动 |
| `b2f3e57` | 只读凭据框不再响应悬停 / 指针 / 焦点 | patch | Q3：把「只读格看着像静态文本」修回它承诺的样子 |
| 配置入口回退那一次（2.0.0-alpha.2 的内容） | 配置入口回 `plugins.bundle.config`（不再多一次 Configure）+ 浮层磨砂 + 圆环同官方网格 | patch 档，发到 `2.0.0-alpha.2` | Q0 答「是」（界面变了）；Q1 答「否」——**入口是回到 1.1.0 那条直接页面**，配置值与键名一字未改，没有谁的配置或数据因此失效；Q2 答「否」——能力一条没加；Q3 答「是」。**已发布的 `2.0.0-alpha.1` 不可覆盖**，所以台阶加在预发布位上（见[「预发布线」](#预发布线alpha上的定档)） |
| 插件展示元数据那一次（同属 `2.0.0-alpha.2` 的内容） | 加 `locale/en.json` + `locale/zh.json`（插件页上的标题与描述），并把 `exports` / `files` 的覆盖补上 | patch 档，台阶落在**已就位**的 `2.0.0-alpha.2` 上，不再加一位 | Q0 答「是」（插件页的卡片与详情页都画它，标题从包名换成显示名，描述第一次出现）；Q1 答「否」——配置值与键名一字未改，包名、槽 key、Loader 条目 id 都没动；Q2 答「否」——能力一条没加，动的是**既有的展示面**换文案；Q3 答「是」——把插件在插件页上的显示名修回它**已经用着的**那个名字（左边栏条目本来就叫「DeepSeek 余额」）。没占新计数位是因为 `2.0.0-alpha.2` **尚未发布**（现查 `npm view dsh-ds-balance versions`） |

倒数第二条最微妙：**打包内容变化确实可被观察到**，但「包里多一个 README」
不是使用者会为之升级的东西 —— 它跟着下一个有实质内容的版本一起发就够。

**首次发版不适用这道链**：第一版没有「上一版」，Q0-Q3 无从问起，档位由维护者定。
本仓库选 `1.0.0` —— 对外接口按稳定版看待，而不是先挂一个 `0.x` 再等它长大。

## 打包内容

[package.json](../package.json) 的 `files` 是唯一来源，别处不再抄一份清单。
当前打包：`lib/`（去掉 sourcemap）、`cordis.patch.yml`、`locale/*.json`（插件展示元数据的中英两份）、
`icon.svg`（插件图标）、`README.md`、`README_en.md`、`LICENSE`。`package.json` 由 npm 强制包含。

`assets/`、`docs/`、`test/`、`scripts/`、`.github/`、`.agents/` 都不进包；`locale/AGENTS.md` 也不进 ——
那是有意的：宿主只枚举 `locale/` 下的 `*.json`，规则文档留在仓库里，不跟着包出去。

**展示面**（`files` 覆盖到每个语言文件、`exports` 暴露 `./locale/*.json` 与 `./package.json`、字段是非空字符串，
以及图标那条：相对路径 / 扩展名 / 留在清单目录内 / 普通文件 / ≤256 KiB / 进包）由
[check-release.mjs](../scripts/check-release.mjs) 断言 —— 任何一条不满足都只会**静默**回落成包名、
`package.json` 的 `description` 或宿主的默认图形，界面上不报错。规则见 [locale 规则层](../locale/AGENTS.md)。

要确认实际打进去的是什么，跑 `npm pack --dry-run` 看清单，不要靠读 `files` 推断。

## 构建链事实

- `npm run build` 三步缺一不可：宿主 `tsc`、客户端 `tsc`（只出声明）、esbuild 打浏览器信封。
- `lib/` 不在版本控制里，所以发布前必须先构建，别指望 checkout 出来就有产物。
- 本仓库**不声明 `prepare`**：`npm ci` 会执行它，从而在 typecheck 之前先产出 `lib/`，
  遮住「类型检查偷偷依赖构建产物」这类缺陷。理由见
  [决策记录](../.agents/notes/2026-09-17-prepare-script-decision.md)。

## 认证与发布

用 npm Trusted Publishing（OIDC），不需要 `NPM_TOKEN`。一次性配置：

1. 在 npmjs.com 打开本包 → Settings → Trusted Publisher。
2. 选 GitHub Actions，填仓库与工作流文件名 `release.yml`，环境填 `release`。
3. 在 GitHub 仓库设置里建同名 environment `release`，可以给它挂人工审批。
4. 确认该包的 publishing access 允许 trusted publisher。

另外两件一次性配置，与 npm 无关，但同属「跑起来之前要手动做」：

1. 仓库 secret `DSH_CI_API_KEY` —— 契约巡检的专用 key，见 [CI 说明](#ci-说明)。
2. 本地环境变量 `DEEPSEEK_API_KEY` —— 插件日常继承的那把；跑 `acceptance.mjs` 时要它在环境里。
   本机跑 `npm run test:contract` 时，缺 `DSH_CI_API_KEY` 也会回落用它，所以不必为本地另配一把。

**两把 key 不要混用**：前者每周打一次真上游，混进主 key 的调用记录里就分不清是谁在调。

配好之后不必再动凭据。仓库里不该出现任何 npm token；出现了就说明配置没生效。

## CI 说明

| 工作流 | 触发 | 跑什么 |
|---|---|---|
| [ci.yml](../.github/workflows/ci.yml) | 每次推 main 与每个 PR | 锁文件版本校验、typecheck、测试 |
| [compat.yml](../.github/workflows/compat.yml) | 每周一 02:00 UTC | 声明面先单独判一次（`declaration`，不装任何依赖），再把 `@deepseek-ai/dsh-*` 换到 alpha / next 线后重跑 |
| [contract.yml](../.github/workflows/contract.yml) | 每周一 01:00 UTC | 打真实上游，核对响应指纹 |
| [release.yml](../.github/workflows/release.yml) | 手动 | 上面那条发版流程 |

契约巡检要仓库 secret `DSH_CI_API_KEY`（专用 key，与插件继承的 `DEEPSEEK_API_KEY` 是两把）；没配会红，并直说是缺 secret。
`release.yml` 的 OIDC 认证不需要任何 secret。

compat 巡检**不阻断任何 PR**（它根本不在 PR 上跑），但**失败必须可见**：两个作业各自在 `if: failure()` 里开或更新
**一条固定标题的跟踪 issue**（打固定标签，同一处失败只追一条评论，已关闭的先重开）。这需要 workflow 上的
`issues: write`。定时任务的失败邮件只发给最后改过 cron 的人，不能当主通知。

## 兼容性

`@deepseek-ai/dsh-*` 的 dist-tag 语义与常规认知相反：

- `alpha` —— 本插件声明的那条线（`engines.dsh` 与全部 peer 都在它上面）。
- `next` —— 实测比 `alpha` **旧**。
- `latest` —— 指向很旧的版本。

**具体版本号不写在这里**：它会漂，抄一次就得手动跟一次。要现查就跑下面这条，
它读 npm registry 的三条线并逐包打印：

```bash
node scripts/compat-swap.mjs check
```

推论有两条：**装依赖必须点名版本线**（跟着 `latest` 走会装到很久以前的版本）；
哪条线该跟、主次怎么定，见[决策记录](../.agents/notes/2026-09-17-compat-lines-advisory.md)。

compat 巡检红了怎么办：

两条线**目前都只记录**：实测 `next` 比 `alpha` 旧，说明声明面与承诺线是错位的，主次还没法定。
判据与恢复条件见[决策记录](../.agents/notes/2026-09-17-compat-lines-advisory.md)。

这不算取消守卫：`swap` 内部的 `verify` 在任何一条线上都会拦「装到旧版本还报绿」。

恢复主次之后，两条线的预期处置是：

- 必绿的那条红了 → **必须修**，说明宿主的新版本破坏了兼容。
- 只记录的那条红了 → 记录，不改声明。

换线前先跑 `compat-swap check`。`verify` 报「假绿」时，那一轮的测试结果不能信。

### 声明面单独判

`declaration` 作业只读 `package.json` 的声明区间（`engines.dsh` 与三个依赖段里的 `@deepseek-ai/dsh-*`）
+ 问 npm 被跟的那条线指向什么版本，判**声明还罩不罩得住那条线**。它不装任何依赖，几十秒出结果 ——
与「换到那条线上还构不构得出来」是两件事，混在一起会互相遮蔽（见 [scripts/README.md](../scripts/README.md)）。
判据：覆盖不到就是红；被跟的那条线由 [README.md](../README.md) 的「版本兼容」一节点名。

声明是**窄**的：下限是**我们实测过的那一版**，写成 `>=<下限>`，**不设上限**。
- 为什么是 `>=` 而不是 `^<下限>`：`^` 在预发布段上的语义是「同一个 `major.minor.patch` 内的预发布版本」，
  所以宿主推一个新的 alpha（补丁位不变、预发布计数变）就可能罩不住 —— 那会变成**每周都红**的巡检，
  而长期必红的任务正是「噪音掩盖真问题」。`>=` 表达的是我们真正想说的话：从这一版起，之后由使用者自担。
- 代价：不再排掉「下一个可能不兼容的大版本」。这是**有意的**取舍 —— 声明本该是一句我们验证过的话，
  而不是一个假装能预测未来的区间。
- **换版脚本必须保形**：`compat-swap` 只换版本号，运算符原样保留（`selftest` 子命令把它变成可执行的断言）。
  它曾经无条件写回 `^`，那会把这里的 `>=` 静默改回去。
两件事是耦合的：把范围写宽能省掉红，但会让「声明」变成一句没人验证过的话。
