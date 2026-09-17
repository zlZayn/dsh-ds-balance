# scripts/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

scripts/ 特有约束：

- 脚本必须能在 Windows PowerShell 与普通 Node 下跑，不依赖 shell 特性。
- 构建失败要抛出可读错误，不许静默产出半成品。
- 产物路径是契约，改动前先查 [README.md](README.md) 的「变更影响路由」。
- 「找到 `npm`」不算 shell 特性：Windows 上它是 `npm.cmd`，`spawnSync` 要 `shell: true` 才找得到（见 [compat-swap.mjs](compat-swap.mjs)）。管道、重定向、通配符仍不许用。
- 发版链路的脚本一律给三档退出码（0 通过 / 1 有未过 / 2 用法或前置条件缺失），别只给 0 和 1。
