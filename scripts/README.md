# scripts/ — 构建与校验脚本手册

- 职责：把源码变成 DSH 能加载的产物；不参与运行时。
- 变更影响路由：改这里 → 同步 [README.md](../README.md) 的「快速上手」与 [AGENTS.md](../AGENTS.md) 的「常用命令」。

## 变更影响路由

- 改产物路径（`lib/client.js`）→ 同步 [package.json](../package.json) 的 `exports["./client"]`、
  [test/artifacts.test.ts](../test/artifacts.test.ts) 与 [test/redlines.test.ts](../test/redlines.test.ts) 的构建链断言。
- 改 `build-client.mjs` 的信封形状 → 同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的构建决策与
  [src/client/README.md](../src/client/README.md)。
- 改 `check-release.mjs` 的断言集合 → 同步 [AGENTS.md](../AGENTS.md) 的常用命令与
  [AGENTS.md](../AGENTS.md) 的「重启前必须再确认一次」那条活跃坑。
- 新增脚本 → 在下面「文件」节补一条，并在 [package.json](../package.json) 的 `scripts` 里给出入口。

## 文件

- `build-client.mjs`：用 esbuild 把 `src/client/` 打成 `lib/client.js`。
  - 产物必须是 DSH 客户端模块系统的 lazy-CJS 信封：`window.__ModuleLoader__.load({ id, factory })`。
  - 官方预设 `packages/client/tsdown.client.ts` 未发布到 npm，仓库外必须自行复刻。
  - 两处非显然的配置：`loader: { '.css': 'local-css' }`（否则 CSS Modules 的类名全是 `undefined`），以及构建后把抽出的 CSS 内联回 factory（DSH 只服务 `lib/client.js`，不加载 `lib/client.css`）。
  - 样式标签形如 `<style data-plugin="包名" data-plugin-css="包名/client.css">`：HMR 的 `removeOwnedStyles` 按 `data-plugin` 逐字匹配来清理。
  - 开头有一段路径冲突守卫：`src/client.ts(x)` 会与输出路径 `lib/client.js` 抢文件，历史上导致过宿主启动 SyntaxError。

## 使用约束与工作偏好

见 [AGENTS.md](AGENTS.md)。
