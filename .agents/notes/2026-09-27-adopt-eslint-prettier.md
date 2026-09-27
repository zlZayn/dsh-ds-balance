# 决策：引入 ESLint + Prettier，四个编译器开关保留

状态：生效

## 问题

`tsconfig.json` 的四个编译器开关（`noUnusedLocals` / `noUnusedParameters` / `noImplicitReturns` / `noFallthroughCasesInSwitch`）只覆盖「通用 lint 那一档」的一部分。**这正是本仓 2026-09-17 那份记录自己写下的代价**：格式类规则（缩进、引号、import 排序）没有机器兜底。

除格式之外，还有两类 tsc 结构性覆盖不到、而本仓真实存在的东西：

- **React hooks 与 promise 用法**：`react-hooks/exhaustive-deps`、未 await 的 promise —— 本仓有浏览器半体（`src/client/`，6 个 `.tsx`）。
- **import 循环与顺序**：编译器不查。

## 决策

引入 ESLint + Prettier，**四个编译器开关原样保留**：

- devDeps：`eslint`、`typescript-eslint`、`@eslint/js`、`globals`、`prettier`、`eslint-config-prettier`。
- `eslint.config.mjs`：flat 配置，Node 全局为主，`src/client` 另给 browser 全局；末项接 `eslint-config-prettier`。
- `.prettierrc.json`：printWidth 100 / 无分号 / 单引号（对齐仓内既有写法）；`.prettierignore` 排除 `.md`、`lib/`、lockfile。
- scripts 加 `lint` / `format` / `format:check`。CI 在测试之后加一步 `npm run lint`。

**分工**：开关管「类型与死代码」，ESLint 管「编译器覆盖不到的那一档」。`test/redlines.test.ts` 的「类型检查开关」组**原样保留** —— 它现在守的是「开关不许被悄悄删掉」，不再承载「不引入 linter」的含义。

## 替代方案

- **维持不引入 linter**（本仓 2026-09-17 那份记录，替代方案一节完整）：它的复审条件是「多人协作，或代码量涨到评审看不完」，两个条件至今都没满足。**本次推翻不是条件触发**，是维护者按统一规范（L3/L4 项目必须有 ESLint + Prettier）主动要求。旧记录保留，用于说明当时为何那样判断 —— 那份论证在它自己的前提下仍然成立。
- **只加 Prettier 不加 ESLint**：格式类解决，但 hooks / promise 两类仍无兜底。
- **把四开关换成 ESLint 等价规则**：丢掉「一次 `tsc` 就拿到」的零配置收益，且让红线从一个地方分裂到两个地方 —— 旧记录正是用这条理由否决了 eslint + typescript-eslint。
- **biome / oxlint**：启动快、配置少，但规则覆盖不及 typescript-eslint（本仓需要 hooks 规则）。

## 影响

- 新增 6 个 devDeps 与 3 个 config 文件；锁文件重建（`resolved` 必须保持官方源，见红线的「锁文件」组）。
- 全量格式化一次性重排源码，独立一刀、单独 commit。
- 对外行为零变化（纯工具链 + 排版），按 PUBLISHING 的问题链属「零行为变更不发版」。
- 旧记录 [不引入 lint，改用编译器开关](2026-09-17-no-linter-decision.md) 状态改「被取代」，指针指向本条。
- **跨仓**：容器 `dsh-plugins/AGENTS.md` 的裁定第 4 条（「四个编译器开关代替 linter」）需同批改口径 —— 本仓是那条裁定的源头之一，但它写在容器仓，本仓不替它决定。
