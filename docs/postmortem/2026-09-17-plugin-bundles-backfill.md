## Postmortem: `dsh plugin` 回填 profile bundles 埋下双挂载（2026-09-17）

- 摘要：跑 `dsh plugin --profile <p> add <本仓库>` 之后，本插件同时存在于 profile 的 `dsh.profile.bundles` 与 `cordis.patch.yml` 的 insert 行里。bundles 只在启动时读一次，所以当时不炸 —— **下一次重启才会双挂载**。
- 时间线：阶段 0 的安装步骤 → 发现 bundles 里多了一行 → 对照探针（未声明 `dsh.bundle`，因此没被回填）确认触发条件 → 清理 bundles 并记录。
- 根因：安装器把「声明了 `dsh.bundle` 的已装包」视为 profile 层并回填进 bundles；而开发期我们又用 patch 层手工插入同一行，两条装载路径互不知情。
- 防再犯：开发期从 `package.json` 去掉 `dsh.bundle`（方案 A），安装输出会明说「installed as a plain dependency, not a profile layer」；`scripts/check-release.mjs` 在发布前把「必须加回 `dsh.bundle.patch`」变成失败项；根 AGENTS.md 写明「重启前必须再确认一次 bundles 里没有本插件」。
- 关联：[发布前检查](../../scripts/check-release.mjs) · [后端架构](../backend-architecture.md)
