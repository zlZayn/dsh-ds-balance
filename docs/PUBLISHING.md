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

**deprecate 只留给真实缺陷。** 宿主侧的搬家（比如配置界面的槽换了一格、旧版本因此在当前宿主上不再显示配置区）
不算插件缺陷，不给那些旧版本加 deprecate：喊狼来了会稀释真正的那几条警告。
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

倒数第二条最微妙：**打包内容变化确实可被观察到**，但「包里多一个 README」
不是使用者会为之升级的东西 —— 它跟着下一个有实质内容的版本一起发就够。

**首次发版不适用这道链**：第一版没有「上一版」，Q0-Q3 无从问起，档位由维护者定。
本仓库选 `1.0.0` —— 对外接口按稳定版看待，而不是先挂一个 `0.x` 再等它长大。

## 打包内容

[package.json](../package.json) 的 `files` 是唯一来源，别处不再抄一份清单。
当前打包：`lib/`（去掉 sourcemap）、`cordis.patch.yml`、`README.md`、`README_en.md`、`LICENSE`。
`package.json` 由 npm 强制包含。

`assets/`、`docs/`、`test/`、`scripts/`、`.github/`、`.agents/` 都不进包。

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

声明是**窄**的：下限是引入 `plugins.bundle.config` 的那一版，上限排掉下一个可能不兼容的大版本
（0.x 线上就是下一个 minor）—— 既不留「以后都兼容」，也不把更早的版本算进来。
预发布段仍可能把声明甩在后面（同一个 `major.minor.patch` 之外的新 alpha 就罩不住），
于是宿主每推一个新的 alpha，声明都可能过期 —— 这不是缺陷，是刻意的：**声明过期得由人确认后再改**，
`declaration` 作业就是那个提醒。两件事是耦合的：把范围写宽能省掉红，但会让「声明」变成一句没人验证过的话。
