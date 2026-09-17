# 决策：发布面十一项落地（2026-09-17）

已实施：上一轮挂起的六项全部兑现，另有五项一并补齐。
本轮不自造条目，逐条向 `dsh-zhihu-search` 的工程面判定「抄 / 改后抄 / 不抄」。

## 问题

上一轮的[挂起记录](2026-09-17-deferred-release-surface.md)把六项挂起并写明触发条件。
远端仓库建好、契约测试有了凭据来源之后这些条件成熟，维护者要求按清单补齐。

## 决策

### 抄（结构照搬，值换成自己的）

- `scripts/release-guard.mjs` / `acceptance.mjs` / `compat-swap.mjs`：三档退出码、stdin 收 diff、
  两条线分流、换版后必须 verify。
- `.github/workflows/` 的 compat / contract / release：schedule 错开、`node-version-file`、
  锁文件版本校验、OIDC 无 token。
- `docs/PUBLISHING.md` 的九节结构；判例库换成**本仓库自己的**九个判例。
- `assets/` 双件：规则层判「什么时候必须重截」，文档层讲「有什么、被谁引用、风格基准」。
- `CONTRIBUTING` 中英双件、`vitest.contract.config.ts`、根门面的徽章行。

### 改后抄（结构照搬，做法因本项目而变）

- **契约测试打 `GET /user/balance`**：它是查询接口，不消耗余额；
  凭据用本机已有的 `DEEPSEEK_API_KEY`，不需要新 secret。
- **`acceptance.mjs` 的默认目标改成当前目录**：参考项目的默认值是「本机 profile 里装的那一份」，
  那要求脚本里写死一个 profile 名。本项目有「不得出现本机硬编码」的硬约束，
  改成 `--target <dir>` 默认 `.`；要验 profile 里那份，把路径传进来。
- **`compat-swap.mjs` 查 dist-tags 走 HTTP 打 registry**，不调 `npm view`：少一层 shell 依赖。
- **徽章里的版本号用 dynamic/json 现读** `package.json`，不写死 —— 写死就是「会漂的值抄了一份」。
- **`compat.yml` 的两条线主次反过来**：参考项目是 next 必绿、alpha 只记录；
  本项目声明的是 alpha 线（实测 next 比 alpha 旧），所以 alpha 必绿、next 只记录。
- **`assets/` 先放占位图**：门面要引用这两张图，引用一个不存在的文件会让链接校验直接报错。

### 不抄（判据不成立，不是懒得做）

- **`prepare` 脚本**：`npm ci` 会执行它，从而在 typecheck 之前先产出 `lib/`，
  遮住「类型检查偷偷依赖构建产物」这类缺陷。单独记在 [prepare 决策](2026-09-17-prepare-script-decision.md)。
- **`dsh.bundle.patch`**：开发期声明它会被 `dsh plugin` 回填进 profile 的 `dsh.profile.bundles`，
  与 patch 层的 insert 行形成双挂载。发布前才加回，[check-release.mjs](../../scripts/check-release.mjs) 会卡。
- **compat 的排除包清单**：参考项目要排除 cordis / schemastery，因为它们的 next 比 latest 旧。
  本项目的替换面是 `@deepseek-ai/dsh-` 前缀，这两个包不带该前缀、天然在面外 —— 不必另写排除表。
- **`assets/` 的 banner / logo / slogan**：维护者明确不要；本目录只放界面截图。

## 替代方案（强制）

- **照单全收**：会把 `prepare` 与 `dsh.bundle.patch` 一起抄进来 ——
  前者遮住 CI 的验证能力，后者在下次重启宿主时炸双挂载。
- **一条都不抄**：本轮真正的缺口是发版链路的**可执行判据**（版本号判定链、产物守卫、假绿守卫）。
  这些不做，第一次发版就得靠人记得每一步。
- **只补文件不写判据**：`PUBLISHING.md` 不写 Q0-Q3 与判例库，就只是一份步骤清单，
  下次遇到「这个改动要不要发版」还是得现想。

## 影响

- 代价：CI 多了三条 workflow，每周多两个定时任务；`scripts/` 从 4 个文件涨到 7 个。
- 收益：发版的每一步都有可执行判据 —— 产物没变发不出去、装到旧依赖上会被 verify 拦下、
  版本号档位有判例可循。
- 未闭合：两张设置卡片截图仍是占位图，按 [assets/AGENTS.md](../../assets/AGENTS.md) 的流程重截。

## 关联

- [上一轮挂起记录](2026-09-17-deferred-release-surface.md) · [工程规范对齐](2026-09-17-zhihu-search-alignment.md) · [prepare 决策](2026-09-17-prepare-script-decision.md) · [发布手册](../../docs/PUBLISHING.md)
