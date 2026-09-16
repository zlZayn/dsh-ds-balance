# 决策：向 dsh-zhihu-search 的工程规范对齐（2026-09-17）

已实施：本轮落地 8 项，明确不抄 2 项，其余等条件成熟。

## 问题

本项目的工程规范是边做边长出来的，同一维护者的另一个 DSH 插件 `dsh-zhihu-search` 更成熟。
需要逐条判定「抄 / 不抄 / 改后抄」，而不是照单全收 —— 两个项目的分层依据、发布阶段、
依赖形态都不同。

## 决策

对照分八个维度：目录结构、文档网络、脚本组织、测试分类与组织、tsconfig 切法、
CI 配置、通用坑与复盘、其他（仓库元数据 / files / 门面）。

**本轮落地**：

1. 加 `LICENSE`（MIT），并加进 `package.json` 的 `files`。
2. CI 三处对齐：`permissions: contents: read`、`actions/checkout@v7` 与 `actions/setup-node@v7`、
   新增「lockfile 版本与 `package.json` 一致」校验步。
3. 新增 `test/artifacts.test.ts`：只读 `lib/`，断言宿主入口可求值并导出契约面、
   浏览器信封的模块 id 等于包名、样式已内联、`exports` 指向真实产物、
   `lib/client.js` 没有被别的模块占掉。
4. `npm test` 改成先 `npm run build` 再跑 vitest；CI 的测试步改用 `npm test`。
5. `tsconfig.test.json` 显式关掉 `declaration` / `declarationMap` / `sourceMap`。
6. 新增 `.github/dependabot.yml`，**只开 github-actions 生态**。
7. 新增 [docs/postmortem/](../../docs/postmortem/)，把五次值得复盘的事故按 5 行骨架立档。
8. 根 [AGENTS.md](../../AGENTS.md) 补「状态」与「事实来源」两节；
   [scripts/README.md](../../scripts/README.md) 补「变更影响路由」节。

**明确不抄**（两条，都是判据不成立而不是懒得做）：

- **测试导入后缀统一成 `.js` 并删掉 `allowImportingTsExtensions`**：
  该判定的前提是「测试只编译宿主半边」。实际上 `test/` 里有三个文件要编译
  `src/client/`，而客户端半边**按设计**使用 `.ts` 后缀（`tsconfig.client.json` 开了那个开关，
  esbuild 也认）。项目级开关删不掉，改成宿主用 `.js`、客户端用 `.ts` 只会让同一个
  `test/` 目录出现两种风格，收益为零。
- **抽 `test/helpers.ts` 共享夹具**：24 个测试文件各自的 harness 只服务本文件，
  它们读的是不同层的替身。抽成共享夹具会把「一个文件自成一体」换成跨文件耦合，
  改一处夹具要回归所有使用者。等出现**第三处完全相同**的夹具再抽。

**等条件成熟**（不在本轮）：发布工作流与 `release-guard` / `compat-swap` 脚本、
契约测试与其独立 config、`docs/PUBLISHING.md`、`assets/` 与英文 README 与
`CONTRIBUTING`、仓库元数据与 README 徽章 —— 分别依赖「已发布」「有稳定远端仓库」
「有真实上游配额」，现在做出来的是空壳。

## 替代方案

- **照单全收**：会把两个不成立的判据也做进去 —— 删掉 `allowImportingTsExtensions`
  会直接让三个客户端测试编译不过；抽共享夹具会让 24 个自洽文件互相牵连。
- **一条都不抄**：本轮真正的缺口是**产物级测试**与**复盘档位**。
  前者能拦住本项目已经踩过的两类构建事故，后者是「防再犯」唯一的落点。
- **只抄 P0**：CI 的三处细节与 `LICENSE` 只解决发布态，不解决校验层缺口。

## 影响

- 代价：`npm test` 变慢（多跑一次 build）；`test/artifacts.test.ts` 让测试**依赖产物**，
  直接跑 `npx vitest run` 而不先构建会失败 —— 这是有意的，产物级断言本来就该在产物上跑。
- 收益：构建链的两类事故（`lib/client.js` 被抢、样式没内联）从「靠人记得」变成断言；
  复盘档位补齐后，活跃坑里的条目有了可追的证据链。
- 未做判定：`docs/PUBLISHING.md` 与三条工作流的完整步骤只读到触发条件与头部注释，
  未逐行核对；本轮按「未读到」处理，不据此下判断。
