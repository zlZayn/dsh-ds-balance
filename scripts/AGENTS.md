# scripts/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

scripts/ 特有约束：

- 脚本必须能在 Windows PowerShell 与普通 Node 下跑，不依赖 shell 特性。
- 构建失败要抛出可读错误，不许静默产出半成品。
- 产物路径是契约，改动前先查 [变更影响路由](README.md#变更影响路由)。
- 「找到 `npm`」不算 shell 特性：Windows 上它是 `npm.cmd`，`spawnSync` 要 `shell: true` 才找得到（见 [compat-swap.mjs](compat-swap.mjs)）。管道、重定向、通配符仍不许用。
- 发版链路的脚本一律给三档退出码（0 通过 / 1 有未过 / 2 用法或前置条件缺失），别只给 0 和 1。
- **esbuild 的 CSS Modules 必须显式开 `loader: { '.css': 'local-css' }`**，否则 `import css from './x.module.css'` 拿到 `{}`、类名全是 `undefined`。
- **esbuild 会把 CSS 抽成独立文件，而 DSH 只服务 `lib/client.js`**：样式必须在构建后内联回 factory，否则界面渲染出来但一条样式都不生效。
- **`src/client.ts(x)` 会与浏览器信封的输出路径 `lib/client.js` 抢文件**：历史上导致宿主启动 SyntaxError。`build-client.mjs` 开头有守卫，别删。
- 符号链接安装下 `npm run build` 直接写线上：未验证的构建会立刻影响正在使用的界面。
