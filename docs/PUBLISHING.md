# 发布手册

面向维护者。本文件讲**流程与判据**；「发布态该有什么」由
[scripts/check-release.mjs](../scripts/check-release.mjs) 的断言集合定义。两者互补，不互相抄。

## 发版前确认

逐条跑，全绿才继续。任何一条红了就停下，不要绕过。

- `npm run check:release` —— 发布态不变量：`dsh.bundle` 加回来了吗、`private` 去掉了吗。
- `npm run typecheck` 与 `npm test`。
- `node scripts/acceptance.mjs` —— 打真实上游的端到端验收，需要环境里有 `DEEPSEEK_API_KEY`。
- `git diff --name-only <上个 tag>..HEAD | node scripts/release-guard.mjs` —— 产物到底变没变。
- 按下面的判定链定档，然后 `npm version <patch|minor|major> --no-git-tag-version`。
  这一步会同时改 `package.json` 与 `package-lock.json`；只手工改前者会被 CI 拦下。

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

## 发布后缺陷处理

**不发 unpublish。** 已经有人装过的版本一旦撤下，他们的 lockfile 就指向一个不存在的版本，
下一次 `npm ci` 直接失败。正确动作是四步固定：

1. `npm deprecate <name>@<version> "原因与替代版本"` —— 装过的人会在安装时看到这句话。
2. 修。
3. 按判定链定档，发新版本。
4. 在 tag 说明里写清影响范围与升级动作。

只有「发布后 72 小时内、且确认无人依赖」才考虑 unpublish；
走这条例外要在提交信息里写明依据，备查。

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

最后一条最微妙：**打包内容变化确实可被观察到**，但「包里多一个 README」
不是使用者会为之升级的东西 —— 它跟着下一个有实质内容的版本一起发就够。

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

配好之后不必再动凭据。仓库里不该出现任何 npm token；出现了就说明配置没生效。

## CI 说明

| 工作流 | 触发 | 跑什么 |
|---|---|---|
| [ci.yml](../.github/workflows/ci.yml) | 每次推 main 与每个 PR | 锁文件版本校验、typecheck、测试 |
| [compat.yml](../.github/workflows/compat.yml) | 每周一 02:00 UTC | 把 `@deepseek-ai/dsh-*` 换到 alpha / next 线后重跑 |
| [contract.yml](../.github/workflows/contract.yml) | 每周一 01:00 UTC | 打真实上游，核对响应指纹 |
| [release.yml](../.github/workflows/release.yml) | 手动 | 上面那条发版流程 |

契约巡检要仓库 secret `DEEPSEEK_API_KEY`；没配会红，并直说是缺 secret。
`release.yml` 的 OIDC 认证不需要任何 secret。

## 兼容性

`@deepseek-ai/dsh-*` 的 dist-tag 语义与常规认知相反。以下是现查得到的实测值，不是抄来的：

- `alpha` —— 本插件声明的那条线，`engines.dsh` 与全部 peer 都在 `^0.1.6-alpha.1` 上。
- `next` —— 比 `alpha` **旧**（实测 `0.1.5-rc.2`）。
- `latest` —— 指向很旧的版本（多数包是 `0.0.1-rc.*`）。

所以**装依赖必须点名版本线**，跟着 `latest` 走会装到很久以前的版本。
`node scripts/compat-swap.mjs check` 会现查三条线的实际版本，不靠记忆。

compat 巡检红了怎么办：

两条线**目前都只记录**：实测 `next` 比 `alpha` 旧，说明声明面与承诺线是错位的，主次还没法定。
判据与恢复条件见[决策记录](../.agents/notes/2026-09-17-compat-lines-advisory.md)。

这不算取消守卫：`swap` 内部的 `verify` 在任何一条线上都会拦「装到旧版本还报绿」。

恢复主次之后，两条线的预期处置是：

- 必绿的那条红了 → **必须修**，说明宿主的新版本破坏了兼容。
- 只记录的那条红了 → 记录，不改声明。

换线前先跑 `compat-swap check`。`verify` 报「假绿」时，那一轮的测试结果不能信。
