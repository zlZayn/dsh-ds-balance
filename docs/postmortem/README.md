# postmortem/ — 事故复盘

- 职责：按日期归档的事故复盘，只记证据链与机制缺口。
- 写新复盘的规则 → [AGENTS.md](AGENTS.md)；层与归属 → 上层 [docs/README.md](../README.md)。
- 回根 → [../../AGENTS.md](../../AGENTS.md)。

## 记录

| 复盘 | 根因一句话 |
|---|---|
| [侧栏底部按钮被邻居插件的 DOM 遍历命中](2026-09-17-aria-haspopup-neighbour-collision.md) | 跨插件共享 slot 容器时没有显式契约，后注册的一方会被别人的选择器先命中。 |
| [客户端半边换新、宿主半边没换](2026-09-17-client-host-version-skew.md) | 两半装载时机不同，构建一跑就出现「新客户端 + 旧宿主」的合法中间态。 |
| [浏览器半体产物覆盖宿主模块](2026-09-17-client-js-path-collision.md) | `tsc` 的 outDir 与 esbuild 的 outfile 指向同一路径，没有机制发现覆盖。 |
| [探针把凭据文件整行打进对话记录](2026-09-17-credential-line-leak.md) | 把「查一条事实」写成了「打印匹配行」，凭据文件每行都是敏感面。 |
| [`dsh plugin` 回填 profile bundles](2026-09-17-plugin-bundles-backfill.md) | 安装器回填 bundles 与开发期手写的 patch insert 行并存，成了双挂载。 |
| [没 inject 的存储服务被静默降级](2026-09-17-storage-domain-not-injected.md) | 服务门禁要求显式 inject，降级路径把门禁错误伪装成运行时故障。 |
