# 决策：不声明 npm prepare 脚本（2026-09-17）

已否决：本仓库不声明 `prepare`，CI 的 `npm ci` 保持不预生成产物。

## 问题

向 `dsh-zhihu-search` 的工程规范对齐时，它的 `scripts` 里有一个 `prepare`。
能不能照抄，取决于一个问题：**它会不会遮住「typecheck 依赖构建产物」这类缺陷**。

## 决策

不声明 `prepare`。

实测事实（最小包探针，不是推断）：

- **`npm ci` 会执行 `prepare`**。探针包声明 `prepare: node prepare-probe.mjs`，
  装完 `PREPARE_RAN` 文件出现了 —— 也就是说 `npm ci` 与 `npm install` 在这件事上行为一致。
- 于是只要声明 `prepare: npm run build`，任何 `npm ci` 都会在 typecheck 之前先产出 `lib/`。
- [ci.yml](../../.github/workflows/ci.yml) 的顺序是 `npm ci` → typecheck → `npm test`；
  `lib/` 被提前产出后，「干净检出上 typecheck 必须通过」这条验证能力就没有了。
- 本项目刚因这条能力缺失踩过一次真实缺陷：`test/artifacts.test.ts` 的 `../lib/index.js`
  在 CI 上 TS2307，而本机因为 `lib/` 早已构建、一直是绿的（见提交 `0251a1c`）。

## 替代方案（强制）

- **照抄 `prepare: npm run build`**：判据不成立。它的收益场景是「从 git / tarball 安装时自动构建」，
  本项目不涉及；代价是 CI 失去「无产物 typecheck」这条验证能力，且任何 `npm ci` 都会重建 `lib/` ——
  在符号链接安装下等于直接写线上产物（见根 [AGENTS.md](../../AGENTS.md) 活跃坑）。
- **照抄 `prepare`，再在 CI 里加一步 `rm -rf lib`**：能同时保住两者，
  但为一条用不上的收益引入一个必须被记住的步骤；记不住就退化回上一条。
- **给 `npm ci` 加 `--ignore-scripts`**：本项目没有需要忽略的脚本，
  多一个开关只会让下一个人以为这里有脚本要躲。

## 影响

- 代价：将来若要支持「从 git 安装即构建」，补一行 `prepare` 即可，届时需要重新评估上面那条验证能力。
- 收益：`npm ci` 与 typecheck 之间的顺序本身成了断言 ——
  任何「typecheck 偷偷依赖构建产物」的改动都会在 CI 上立刻变红，不必靠人记得。
