# scripts/ — 构建与校验脚本手册

- 职责：把源码变成 DSH 能加载的产物；不参与运行时。
- 变更影响路由：改这里 → 同步根 [README.md](../README.md) 安装一节的步骤与 [常用命令](../AGENTS.md#常用命令)。

## 变更影响路由

- 改产物路径（`lib/client.js`）→ 同步 [package.json](../package.json) 的 `exports["./client"]`、
  [test/artifacts.test.ts](../test/artifacts.test.ts) 与 [test/redlines.test.ts](../test/redlines.test.ts) 的构建链断言。
- 改 `build-client.mjs` 的信封形状 → 同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的构建决策与
  [src/client/README.md](../src/client/README.md)。
- 改 `check-release.mjs` 的断言集合 → 同步 [常用命令](../AGENTS.md#常用命令) 与
  [事实来源](../AGENTS.md#事实来源只查不抄) 里「发布态该有什么」那一行。
- 新增脚本 → 在下面「文件」节补一条，并在 [package.json](../package.json) 的 `scripts` 里给出入口。
- 改 `release-guard.mjs` 的分类常量 → 同步 [发版前确认](../docs/PUBLISHING.md#发版前确认)。
- 改 `compat-swap.mjs` 的受管前缀 → 同步 [compat.yml](../.github/workflows/compat.yml) 的矩阵。
- 改 `check-declaration.mjs` 的 `TRACKED_LINE` → 同步 [README.md](../README.md) 的「版本兼容」一节与 [AGENTS.md](../AGENTS.md) 的判据。
- 改 `report-compat-failure.mjs` 的固定标题或标签 → 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「兼容性」一节。
- 改 [compat.yml](../.github/workflows/compat.yml) 的作业集合 → 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「CI 说明」表。

## 文件

- `build-client.mjs`：用 esbuild 把 `src/client/` 打成 `lib/client.js`。
  - 产物必须是 DSH 客户端模块系统的 lazy-CJS 信封：`window.__ModuleLoader__.load({ id, factory })`。
  - 官方预设 `packages/client/tsdown.client.ts` 未发布到 npm，仓库外必须自行复刻。
  - 两处非显然的配置：`loader: { '.css': 'local-css' }`（否则 CSS Modules 的类名全是 `undefined`），以及构建后把抽出的 CSS 内联回 factory（DSH 只服务 `lib/client.js`，不加载 `lib/client.css`）。
  - 样式标签形如 `<style data-plugin="包名" data-plugin-css="包名/client.css">`：HMR 的 `removeOwnedStyles` 按 `data-plugin` 逐字匹配来清理。
  - 开头有一段路径冲突守卫：`src/client.ts(x)` 会与输出路径 `lib/client.js` 抢文件，历史上导致过宿主启动 SyntaxError。
- `release-guard.mjs`：发版守卫。stdin 收 `git diff --name-only`，按路径分出「会改变已发布产物」与「不会」。
  - 退出码：0 = 有产物改动 / 1 = 只有非产物改动（不该发版）/ 2 = 用法错误。
  - 判据是**路径**不是语义：改注释、抽常量这类行为等价的改动也会被判成「有产物改动」，那部分交给人回答。
  - 用「逐个排除」而不是「逐个收录」：未识别的路径一律算改变产物 —— 宁可漏判，不误拦。
  - 由 [release.yml](../.github/workflows/release.yml) 调用。
- `acceptance.mjs`：对一个**已构建的安装目录**跑真实链路验收；`--target <dir>` 默认当前目录（本仓库自己就是那个安装目录）。
  - 退出码：0 = 全过 / 1 = 有未过 / 2 = 缺凭据（上游那一段没跑）。
  - **不进 CI**：打真实上游，要真实凭据，也占真实配额。
  - 凭据只从环境变量 `DEEPSEEK_API_KEY` 读，只出现在请求头里，不打印、不落盘。
- `compat-swap.mjs`：把 `@deepseek-ai/dsh-*` 的声明区间换到指定 dist-tag 线上。子命令 `check` / `swap --line <line>` / `verify --line <line>`。
  - **`verify` 不是可选项**：`npm install` 会假绿 —— 它失败但 `node_modules` 停在旧版本上，测试于是跑在旧依赖上、给出与事实相反的信号。
  - 只换 `@deepseek-ai/dsh-` 前缀；`@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 不带这个前缀，天然在替换面之外（它们的 `next` 比 `latest` 旧）。
  - 查 dist-tags 用 HTTP 打 registry，不调 `npm view` —— 少一层 shell 依赖。
  - 由 [compat.yml](../.github/workflows/compat.yml) 调用。
- `check-declaration.mjs`：声明面检查。只读 `package.json` 的声明区间（`engines.dsh` 与三个依赖段里的 `@deepseek-ai/dsh-*`）+ 问 npm 被跟的那条线指向什么版本，判「罩不罩得住」。
  - 判据：声明区间必须能覆盖**我们告诉用户去装的那条线**（`TRACKED_LINE`，与 [README.md](../README.md) 的「版本兼容」一节对齐）；覆盖不到退出 1。
  - **不装任何依赖**，所以能单独成一个几十秒的作业；与「换线之后还跑不跑得起来」是两件事，混在一起会互相遮蔽。
  - 区间是否成立**问 npm 自己**，不自己算：预发布段的规则很绕（一个 caret 区间罩得住**同一个** `major.minor.patch` 里的预发布版本，罩不住下一个补丁位的预发布版本），手写一套等于制造假绿。`npm view <pkg>@<range> version --json` 回的是区间内**全部**匹配版本，于是「那条线的版本在不在列表里」就是精确判定。
  - **不走 shell**：区间里的 `^` 是 shell 元字符（Windows 上还是转义符），所以用 `process.execPath` 直接跑 npm 的 CLI 入口。只监控区间的包，`@deepseek-ai/cordis` 等不带前缀的天然在外面。
  - 退出码：0 = 罩得住 / 1 = 有罩不住的 / 2 = 用法或前置条件缺失（registry、npm 入口）。由 [compat.yml](../.github/workflows/compat.yml) 的 `declaration` 作业调用，**不阻断**任何 PR。
- `report-compat-failure.mjs`：失败可见。把巡检的红变成**一条固定标题**的跟踪 issue：没有就开、有就追一条评论、关了就先重开、同一处失败不重复刷。
  - 正文里**不放时间戳**：同一处失败每次长一样，正文一致判重才成立。
  - 由 [compat.yml](../.github/workflows/compat.yml) 的两个作业在 `if: failure()` 里调用；需要 `issues: write`（已写在该 workflow 的 permissions 里）。
  - 退出码：0 = 已记录（含「已经记过」）/ 1 = 记录失败 / 2 = 用法或前置条件缺失。

## 使用约束与工作偏好

见 [AGENTS.md](AGENTS.md)。
